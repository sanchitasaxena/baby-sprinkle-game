// Frontend for "Guess the Baby" — this file holds NO answers. Every photo,
// name choice, and correctness check comes from the API (see ../worker/),
// which is the only place the real roster mapping lives.

const IMG_DIR = "images/";

let sessionId = null;
let phase = null; // "photo" | "teammate" | "done"
let score = 0;
let maxScore = 0;

const startScreen = document.getElementById("start-screen");
const gameScreen = document.getElementById("game-screen");
const endScreen = document.getElementById("end-screen");
const startBtn = document.getElementById("start-btn");
const startError = document.getElementById("start-error");
const playAgainBtn = document.getElementById("play-again-btn");
const roundPrompt = document.getElementById("round-prompt");
const singlePhotoFrame = document.getElementById("single-photo-frame");
const photoImg = document.getElementById("photo-img");
const pairFrame = document.getElementById("pair-frame");
const pairChoices = document.getElementById("pair-choices");
const choices = document.getElementById("choices");
const feedback = document.getElementById("feedback");
const wrongAnimation = document.getElementById("wrong-animation");
const nextBtn = document.getElementById("next-btn");
const progress = document.getElementById("progress");
const scoreEl = document.getElementById("score");
const finalScore = document.getElementById("final-score");
const finalMessage = document.getElementById("final-message");

startBtn.addEventListener("click", startGame);
playAgainBtn.addEventListener("click", startGame);
nextBtn.addEventListener("click", advance);

async function api(path, options) {
  const base = window.API_BASE_URL;
  if (!base || base.includes("YOUR-SUBDOMAIN")) {
    throw new Error("The game API isn't configured yet (see frontend/config.js).");
  }
  const response = await fetch(base + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

async function startGame() {
  startError.classList.add("hidden");
  startBtn.disabled = true;
  startBtn.textContent = "Loading...";
  try {
    const data = await api("/api/session", { method: "POST" });
    sessionId = data.sessionId;
    score = data.score;
    maxScore = data.maxScore;
    startScreen.classList.add("hidden");
    endScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
    renderRound(data.round);
  } catch (err) {
    startError.textContent = `⚠️ ${err.message}`;
    startError.classList.remove("hidden");
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "Start Guessing →";
  }
}

function updateScore() {
  scoreEl.textContent = `Score: ${score} / ${maxScore}`;
}

function renderRound(round) {
  phase = round.phase;
  progress.textContent = `Round ${round.index + 1} of ${round.total}`;
  feedback.textContent = "";
  feedback.className = "feedback";
  wrongAnimation.classList.remove("show");
  nextBtn.classList.add("hidden");
  choices.innerHTML = "";
  pairChoices.innerHTML = "";
  pairFrame.innerHTML = "";
  choices.classList.add("hidden");
  pairChoices.classList.add("hidden");
  singlePhotoFrame.classList.toggle("hidden", round.twoPicture);
  pairFrame.classList.toggle("hidden", !round.twoPicture);
  updateScore();

  if (round.twoPicture && round.phase === "photo") {
    roundPrompt.textContent = "Which baby is on the registry team?";
    renderPair(round.pairPhotos);
    return;
  }

  roundPrompt.textContent = "Who is this baby?";

  if (!round.twoPicture) {
    renderSingle(round.photo);
  }
  choices.classList.remove("hidden");
  renderNameChoices(round);

  if (round.twoPicture && round.pairResult) {
    // Coming back into a round we already answered the photo phase of
    // (e.g. after a page refresh) — reflect that outcome immediately.
    reflectPairResult(round.pairResult);
  }
}

function renderSingle(photo) {
  photoImg.classList.remove("hidden");
  photoImg.src = IMG_DIR + photo;
  photoImg.alt = "Guess this teammate's real baby photo";
}

function renderPair(pairPhotos) {
  pairPhotos.forEach((photo, index) => {
    const button = document.createElement("button");
    button.className = "pair-photo";
    button.type = "button";
    button.dataset.token = photo.token;
    button.innerHTML = `<img src="${IMG_DIR + photo.src}" alt="Guess which baby photo is the real teammate" /><span>${index + 1}</span>`;
    button.addEventListener("click", () => selectPair(button, photo.token));
    pairFrame.appendChild(button);
  });
}

function renderNameChoices(round) {
  const target = round.twoPicture ? pairChoices : choices;
  target.innerHTML = "";
  round.choices.forEach((name) => {
    const button = document.createElement("button");
    button.className = "choice-btn";
    button.type = "button";
    button.textContent = name;
    button.addEventListener("click", () => selectTeammate(button, name));
    target.appendChild(button);
  });
}

function reflectPairResult(pairResult) {
  pairFrame.querySelectorAll(".pair-photo").forEach((btn) => {
    btn.disabled = true;
    if (btn.dataset.token === pairResult.realToken) btn.classList.add("correct");
    if (btn.dataset.token === pairResult.chosenToken && !pairResult.correct) {
      btn.classList.add("incorrect");
    }
  });
  pairChoices.classList.remove("hidden");
}

async function selectPair(button, token) {
  if (phase !== "photo") return;
  pairFrame.querySelectorAll(".pair-photo").forEach((btn) => (btn.disabled = true));
  try {
    const data = await api(`/api/session/${sessionId}/answer`, {
      method: "POST",
      body: JSON.stringify({ phase: "photo", token }),
    });
    const { result, next } = data;
    score = result.score;
    maxScore = result.maxScore;
    reflectPairResult({
      correct: result.correct,
      chosenToken: token,
      realToken: result.correctToken,
    });
    if (result.correct) {
      feedback.textContent = "🎉 Correct!";
      feedback.className = "feedback correct-text";
    } else {
      feedback.textContent = "This baby was never on our team.";
      feedback.className = "feedback incorrect-text";
      wrongAnimation.classList.remove("show");
      void wrongAnimation.offsetWidth;
      wrongAnimation.classList.add("show");
    }
    updateScore();
    phase = "teammate";
    renderNameChoices(next.round);
  } catch (err) {
    feedback.textContent = `⚠️ ${err.message}`;
    feedback.className = "feedback incorrect-text";
  }
}

async function selectTeammate(button, chosenName) {
  if (phase !== "teammate") return;
  phase = "done";
  const answerChoices = pairChoices.classList.contains("hidden") ? choices : pairChoices;
  answerChoices.querySelectorAll(".choice-btn").forEach((choice) => (choice.disabled = true));
  try {
    const data = await api(`/api/session/${sessionId}/answer`, {
      method: "POST",
      body: JSON.stringify({ phase: "teammate", name: chosenName }),
    });
    const { result, next } = data;
    score = result.score;
    maxScore = result.maxScore;
    answerChoices.querySelectorAll(".choice-btn").forEach((choice) => {
      if (choice.textContent === result.correctName) choice.classList.add("correct");
    });
    if (result.correct) {
      button.classList.add("correct");
      feedback.textContent = "🎉 You got it!";
      feedback.className = "feedback correct-text";
    } else {
      button.classList.add("incorrect");
      feedback.textContent = `❌ Nope — that's ${result.correctName}!`;
      feedback.className = "feedback incorrect-text";
    }
    updateScore();
    nextBtn.classList.remove("hidden");
    nextBtn.textContent = next.done ? "See Results" : "Next Round →";
  } catch (err) {
    feedback.textContent = `⚠️ ${err.message}`;
    feedback.className = "feedback incorrect-text";
  }
}

async function advance() {
  try {
    const data = await api(`/api/session/${sessionId}`);
    if (data.done) {
      showResults(data);
    } else {
      renderRound(data.round);
    }
  } catch (err) {
    feedback.textContent = `⚠️ ${err.message}`;
    feedback.className = "feedback incorrect-text";
  }
}

function showResults(data) {
  score = data.score;
  maxScore = data.maxScore;
  gameScreen.classList.add("hidden");
  endScreen.classList.remove("hidden");
  finalScore.textContent = `${score} / ${maxScore}`;
  const pct = score / maxScore;
  finalMessage.textContent = pct === 1
    ? "🏆 PERFECT! You know this team inside and out."
    : pct >= 0.75
      ? "🌟 So close to baby-photo expert status!"
      : pct >= 0.5
        ? "👶 Not bad! You know your teammates... mostly."
        : "😅 Time to ask the group chat for more childhood stories!";
}
