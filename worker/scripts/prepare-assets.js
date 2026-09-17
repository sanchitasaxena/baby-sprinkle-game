#!/usr/bin/env node
/**
 * Renames every game photo to an opaque, non-identifying filename and copies
 * the results into frontend/images/. It also writes worker/roster-data.json,
 * a PRIVATE file (git-ignored) containing the real name <-> photo mapping.
 * That file (or its contents, via `wrangler secret put ROSTER_DATA`) is the
 * only place the answers live — it must never be committed to git or copied
 * into the frontend.
 *
 * Run this once whenever you add/change photos:
 *   node worker/scripts/prepare-assets.js
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..", "..");
const SOURCE_IMAGES_DIR = path.join(ROOT, "game", "images");
const OUT_IMAGES_DIR = path.join(ROOT, "frontend", "images");
const OUT_ROSTER_PATH = path.join(ROOT, "worker", "roster-data.json");

// ----- Source of truth for real identities (edit this, not script.js) -----
const ROSTER = [
  { name: "Martin", photos: ["martin.png"] },
  { name: "Russell", photos: ["RUSSEL.jpg", "RUSSEL-2.jpg", "RUSSEL-3.jpg"] },
  { name: "Steve", photos: ["STEVE.png", "STEVE-2.png", "STEVE-3.png"] },
  { name: "John", photos: ["JOHN.png"] },
  { name: "Carolina", photos: ["CAROLINA.JPG", "CAROLINA-2.JPG"] },
  { name: "Sanchita", photos: ["SANCHITA.jpeg", "SANCHITA-2.JPG", "SANCHITA-3.JPG"] },
  { name: "Olivia", photos: ["OLIVIA.jpeg", "OLIVIA-1.jpeg", "OLIVIA-2.jpeg", "OLIVIA-3.jpeg"] },
  { name: "Mrinali", photos: ["MRINALI.jpeg"] },
  { name: "Glenn", photos: ["GLENN.png", "GLENN-2.png"] },
  { name: "Kai", photos: ["Kai_bb.jpg"] },
];

const DECOY_POOLS = {
  boy: [
    "decoys/boy.webp", "decoys/boy_1.webp", "decoys/boy_3.webp",
    "decoys/boy_4.webp", "decoys/boy_5.webp", "decoys/boy_7.webp",
  ],
  girl: [
    "decoys/girl.webp", "decoys/girl_1.webp", "decoys/girl_3.webp",
    "decoys/girl_4.webp", "decoys/girl_6.webp",
  ],
  special: ["decoys/mrinali_sanchita_decoy.webp"],
};

const DECOY_GROUPS = {
  Glenn: "boy",
  Russell: "boy",
  Martin: "boy",
  Steve: "boy",
  Nicola: "girl",
  Valeriia: "girl",
  Carolina: "girl",
  Olivia: "girl",
  Sanchita: "special",
  Mrinali: "special",
};

const EXTRA_NAMES = ["Nicola", "Valeriia"];
const LIMITED_CHOICE_NAMES = ["Steve", "Russell", "Glenn", "John", "Martin", "Kai"];
const EXCLUDED_FOR_LIMITED_CHOICES = ["Sanchita", "Mrinali", "Nicola", "Valeriia", "Carolina"];
// EXTRA_NAMES (Nicola & Valeriia) have no photos in this game — they only
// ever appear as answer choices, never as a correct answer.

// ----------------------------------------------------------------------

fs.mkdirSync(OUT_IMAGES_DIR, { recursive: true });
// Clear out any previously generated (opaque-named) images so stale files
// don't linger if the roster shrinks.
for (const existing of fs.readdirSync(OUT_IMAGES_DIR)) {
  fs.rmSync(path.join(OUT_IMAGES_DIR, existing), { recursive: true, force: true });
}

const rename = new Map(); // original relative path -> opaque filename
function opaqueNameFor(relativePath) {
  if (rename.has(relativePath)) return rename.get(relativePath);
  const ext = path.extname(relativePath);
  let opaque;
  do {
    opaque = `p-${crypto.randomBytes(6).toString("hex")}${ext.toLowerCase()}`;
  } while ([...rename.values()].includes(opaque));
  rename.set(relativePath, opaque);
  return opaque;
}

function copyImage(relativePath) {
  const opaque = opaqueNameFor(relativePath);
  const src = path.join(SOURCE_IMAGES_DIR, relativePath);
  const dest = path.join(OUT_IMAGES_DIR, opaque);
  fs.copyFileSync(src, dest);
  return opaque;
}

const rosterOut = ROSTER.map((person) => ({
  name: person.name,
  photos: person.photos.map(copyImage),
}));

const decoyPoolsOut = Object.fromEntries(
  Object.entries(DECOY_POOLS).map(([group, photos]) => [group, photos.map(copyImage)]),
);

const rosterData = {
  roster: rosterOut,
  decoyPools: decoyPoolsOut,
  decoyGroups: DECOY_GROUPS,
  extraNames: EXTRA_NAMES,
  limitedChoiceNames: LIMITED_CHOICE_NAMES,
  excludedForLimitedChoices: EXCLUDED_FOR_LIMITED_CHOICES,
};

fs.writeFileSync(OUT_ROSTER_PATH, JSON.stringify(rosterData, null, 2));

console.log(`Copied ${rename.size} images into frontend/images/ with opaque names.`);
console.log(`Wrote private answer mapping to ${path.relative(ROOT, OUT_ROSTER_PATH)}`);
console.log(`This file is git-ignored. Load it into the worker with:`);
console.log(`  cd worker && npx wrangler secret put ROSTER_DATA < roster-data.json`);
