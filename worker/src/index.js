/**
 * "Guess the Baby" answer-checking API.
 *
 * The ONLY place real names are ever known is inside this worker, loaded at
 * runtime from the ROSTER_DATA secret (never committed to git). The frontend
 * only ever receives opaque photo filenames and a shuffled list of name
 * choices — never which choice is correct — until a guess is submitted.
 *
 * Routes:
 *   POST /api/session               -> start a new game, returns { sessionId, totalRounds, maxScore, round }
 *   GET  /api/session/:id           -> current public round + score state
 *   POST /api/session/:id/answer    -> submit a guess for the current phase
 */

const NUM_CHOICES = 4;
const SESSION_TTL_SECONDS = 60 * 60 * 6; // 6 hours

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, env, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(env),
      ...(init.headers || {}),
    },
  });
}

function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getRosterData(env) {
  if (!env.ROSTER_DATA) {
    throw new Error("ROSTER_DATA secret is not configured on this worker.");
  }
  return JSON.parse(env.ROSTER_DATA);
}

function buildQuestions(rosterData) {
  const { roster, decoyPools } = rosterData;
  const photoQuestions = shuffle(
    roster.flatMap((person) =>
      person.photos.map((photo) => ({
        name: person.name,
        photo,
        decoyGroup: rosterData.decoyGroups[person.name],
      })),
    ),
  );
  const decoyPoolsCopy = Object.fromEntries(
    Object.entries(decoyPools).map(([group, photos]) => [group, shuffle(photos)]),
  );
  const targetTwoPictureCount = Math.min(
    Math.floor(photoQuestions.length / 2),
    Object.values(decoyPoolsCopy).reduce((total, photos) => total + photos.length, 0),
  );
  let twoPictureCount = 0;

  const builtQuestions = photoQuestions.map((question) => {
    const pool = decoyPoolsCopy[question.decoyGroup] || [];
    const twoPicture = twoPictureCount < targetTwoPictureCount && pool.length > 0;
    const decoyPhoto = twoPicture ? pool.pop() : null;
    if (twoPicture) twoPictureCount += 1;
    return { ...question, twoPicture, decoyPhoto };
  });

  return shuffle(builtQuestions);
}

function buildNameChoices(question, rosterData) {
  const names = rosterData.roster.map((person) => person.name);
  const requiredNames = {
    Russell: ["Russell", "Steve"],
    Steve: ["Russell", "Steve"],
    Mrinali: ["Mrinali", "Sanchita"],
    Sanchita: ["Mrinali", "Sanchita"],
    Carolina: ["Carolina", "Olivia", ...rosterData.extraNames],
    Olivia: ["Carolina", "Olivia", ...rosterData.extraNames],
    Martin: ["Martin", "John", "Kai"],
    John: ["Martin", "John", "Kai"],
    Kai: ["Martin", "John", "Kai"],
  }[question.name] || [question.name];
  const excludedNames = rosterData.limitedChoiceNames.includes(question.name)
    ? rosterData.excludedForLimitedChoices
    : [];
  const availableOthers = names.filter(
    (name) => !requiredNames.includes(name) && !excludedNames.includes(name),
  );
  const extraNames = requiredNames.filter((name) => name !== question.name);
  return shuffle([
    question.name,
    ...extraNames,
    ...shuffle(availableOthers).slice(0, NUM_CHOICES - requiredNames.length),
  ]).slice(0, NUM_CHOICES);
}

// Pair-photo order is randomized once per question and then stored, so it
// stays stable across repeated requests for the same round.
function shuffleForPair(question) {
  return question.pairOrder.map((entry) => ({ token: entry.token, src: entry.src }));
}

async function createSession(env) {
  const rosterData = getRosterData(env);
  const questions = buildQuestions(rosterData).map((q) => {
    if (q.twoPicture) {
      const pairOrder = shuffle([
        { token: "a", src: q.photo, real: true },
        { token: "b", src: q.decoyPhoto, real: false },
      ]);
      q.pairOrder = pairOrder;
    }
    q.choices = buildNameChoices(q, rosterData);
    q.pairAnswered = false;
    return q;
  });
  const maxScore = questions.reduce((total, q) => total + (q.twoPicture ? 2 : 1), 0);
  const sessionId = crypto.randomUUID();
  const session = { questions, index: 0, score: 0, maxScore, done: false };
  await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return { sessionId, session };
}

function currentPublicState(session) {
  const total = session.questions.length;
  if (session.done || session.index >= total) {
    return {
      done: true,
      score: session.score,
      maxScore: session.maxScore,
      total,
    };
  }
  const question = session.questions[session.index];
  const round = {
    index: session.index,
    total,
    twoPicture: question.twoPicture,
  };
  if (question.twoPicture && !question.pairAnswered) {
    round.phase = "photo";
    round.pairPhotos = shuffleForPair(question);
  } else {
    round.phase = "teammate";
    round.choices = question.choices;
    if (question.twoPicture) {
      round.pairResult = question.pairResult; // set after photo phase answered
    } else {
      round.photo = question.photo;
    }
  }
  return {
    done: false,
    score: session.score,
    maxScore: session.maxScore,
    round,
  };
}

async function getSession(env, sessionId) {
  const raw = await env.SESSIONS.get(`session:${sessionId}`);
  if (!raw) return null;
  return JSON.parse(raw);
}

async function saveSession(env, sessionId, session) {
  await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
}

async function submitAnswer(env, sessionId, body) {
  const session = await getSession(env, sessionId);
  if (!session) return { error: "Session not found or expired.", status: 404 };
  if (session.done || session.index >= session.questions.length) {
    return { error: "Game already finished.", status: 400 };
  }
  const question = session.questions[session.index];
  const expectedPhase = question.twoPicture && !question.pairAnswered ? "photo" : "teammate";
  if (body.phase !== expectedPhase) {
    return { error: `Expected an answer for phase "${expectedPhase}".`, status: 400 };
  }

  let result;
  if (expectedPhase === "photo") {
    const chosen = question.pairOrder.find((entry) => entry.token === body.token);
    if (!chosen) return { error: "Unknown photo token.", status: 400 };
    const correct = chosen.real;
    if (correct) session.score += 1;
    question.pairAnswered = true;
    question.pairResult = {
      correct,
      chosenToken: body.token,
      realToken: question.pairOrder.find((entry) => entry.real).token,
    };
    result = {
      correct,
      correctToken: question.pairResult.realToken,
      score: session.score,
      maxScore: session.maxScore,
    };
  } else {
    const correct = body.name === question.name;
    if (correct) session.score += 1;
    result = {
      correct,
      correctName: question.name,
      score: session.score,
      maxScore: session.maxScore,
    };
    session.index += 1;
    if (session.index >= session.questions.length) session.done = true;
  }

  await saveSession(env, sessionId, session);
  const next = currentPublicState(session);
  return { result, next };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    try {
      if (method === "POST" && pathname === "/api/session") {
        const { sessionId, session } = await createSession(env);
        return json(
          { sessionId, ...currentPublicState(session) },
          env,
          { status: 201 },
        );
      }

      const sessionMatch = pathname.match(/^\/api\/session\/([a-f0-9-]+)$/);
      if (method === "GET" && sessionMatch) {
        const session = await getSession(env, sessionMatch[1]);
        if (!session) return json({ error: "Session not found or expired." }, env, { status: 404 });
        return json(currentPublicState(session), env);
      }

      const answerMatch = pathname.match(/^\/api\/session\/([a-f0-9-]+)\/answer$/);
      if (method === "POST" && answerMatch) {
        const body = await request.json();
        const outcome = await submitAnswer(env, answerMatch[1], body);
        if (outcome.error) return json({ error: outcome.error }, env, { status: outcome.status || 400 });
        return json(outcome, env);
      }

      return json({ error: "Not found" }, env, { status: 404 });
    } catch (err) {
      return json({ error: err.message || "Internal error" }, env, { status: 500 });
    }
  },
};
