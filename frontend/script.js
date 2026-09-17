// Static frontend for "Guess the Baby". The intentionally accessible answer
// key lives in Don't Peek/answers.js so the game works without a backend.

const IMG_DIR = "images/";
const NUM_CHOICES = 4;
const gameData = window.GAME_DATA;

let sessionId = null;
let localSession = null;
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

function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildQuestions() {
  const photoQuestions = shuffle(gameData.roster.flatMap((person) =>
    person.photos.map((photo) => ({
      name: person.name,
      photo,
      decoyGroup: gameData.decoyGroups[person.name],
    })),
  ));
  const decoyPools = Object.fromEntries(
    Object.entries(gameData.decoyPools).map(([group, photos]) => [group, shuffle(photos)]),
  );
  const targetTwoPictureCount = Math.min(
    Math.floor(photoQuestions.length / 2),
    Object.values(decoyPools).reduce((total, photos) => total + photos.length, 0),
  );
  let twoPictureCount = 0;

  const questions = photoQuestions.map((question) => {
    const pool = decoyPools[question.decoyGroup] || [];
    const twoPicture = twoPictureCount < targetTwoPictureCount && pool.length > 0;
    const decoyPhoto = twoPicture ? pool.pop() : null;
    if (twoPicture) twoPictureCount += 1;
    return { ...question, twoPicture, decoyPhoto };
  });

  return shuffle(questions);
}

function buildNameChoices(question) {
  const names = gameData.roster.map((person) => person.name);
  const femaleNames = [
    "Carolina",
    "Olivia",
    "Sanchita",
    "Mrinali",
    ...gameData.extraNames,
  ];
  const requiredNames = {
    Russell: ["Russell", "Steve"],
    Steve: ["Russell", "Steve"],
    Mrinali: ["Mrinali", "Sanchita"],
    Sanchita: ["Mrinali", "Sanchita"],
    Carolina: ["Carolina", "Olivia", ...gameData.extraNames],
    Olivia: ["Carolina", "Olivia", ...gameData.extraNames],
    Glenn: ["Glenn", "Martin", "John", "Kai"],
    Martin: ["Glenn", "Martin", "John", "Kai"],
    John: ["Glenn", "Martin", "John", "Kai"],
    Kai: ["Glenn", "Martin", "John", "Kai"],
  }[question.name] || [question.name];
  const choicePool = femaleNames.includes(question.name) ? femaleNames : names;
  const excludedNames = gameData.limitedChoiceNames.includes(question.name)
    ? gameData.excludedForLimitedChoices
    : [];
  const availableOthers = choicePool.filter(
    (name) => !requiredNames.includes(name) && !excludedNames.includes(name),
  );
  const extraNames = requiredNames.filter((name) => name !== question.name);
  return shuffle([
    question.name,
    ...extraNames,
    ...shuffle(availableOthers).slice(0, NUM_CHOICES - requiredNames.length),
  ]).slice(0, NUM_CHOICES);
}

function publicState() {
  if (localSession.done || localSession.index >= localSession.questions.length) {
    return {
      done: true,
      score: localSession.score,
      maxScore: localSession.maxScore,
      total: localSession.questions.length,
    };
  }
  const question = localSession.questions[localSession.index];
  const round = {
    index: localSession.index,
    total: localSession.questions.length,
    twoPicture: question.twoPicture,
  };
  if (question.twoPicture && !question.pairAnswered) {
    round.phase = "photo";
    round.pairPhotos = question.pairOrder.map(({ token, src }) => ({ token, src }));
  } else {
    round.phase = "teammate";
    round.choices = question.choices;
    if (question.twoPicture) {
      round.pairResult = question.pairResult;
    } else {
      round.photo = question.photo;
    }
  }
  return {
    done: false,
    score: localSession.score,
    maxScore: localSession.maxScore,
    round,
  };
}

function createLocalSession() {
  const questions = buildQuestions().map((question) => {
    question.choices = buildNameChoices(question);
    question.pairAnswered = false;
    if (question.twoPicture) {
      question.pairOrder = shuffle([
        { token: "a", src: question.photo, real: true },
        { token: "b", src: question.decoyPhoto, real: false },
      ]);
    }
    return question;
  });
  localSession = {
    questions,
    index: 0,
    score: 0,
    maxScore: questions.reduce((total, question) => total + (question.twoPicture ? 2 : 1), 0),
    done: false,
  };
  return { sessionId: crypto.randomUUID(), ...publicState() };
}

function answerLocally(body) {
  const question = localSession.questions[localSession.index];
  if (body.phase === "photo") {
    const chosen = question.pairOrder.find((entry) => entry.token === body.token);
    if (!chosen) throw new Error("Unknown photo choice.");
    if (chosen.real) localSession.score += 1;
    question.pairAnswered = true;
    question.pairResult = {
      correct: chosen.real,
      chosenToken: body.token,
      realToken: question.pairOrder.find((entry) => entry.real).token,
    };
    return {
      result: {
        correct: chosen.real,
        correctToken: question.pairResult.realToken,
        score: localSession.score,
        maxScore: localSession.maxScore,
      },
      next: publicState(),
    };
  }

  const correct = body.name === question.name;
  if (correct) localSession.score += 1;
  const result = {
    correct,
    correctName: question.name,
    score: localSession.score,
    maxScore: localSession.maxScore,
  };
  localSession.index += 1;
  localSession.done = localSession.index >= localSession.questions.length;
  return { result, next: publicState() };
}

async function api(path, options = {}) {
  if (!gameData) throw new Error("The answer key could not be loaded.");
  if (path === "/api/session" && options.method === "POST") {
    return createLocalSession();
  }
  if (path === `/api/session/${sessionId}` && !options.method) {
    return publicState();
  }
  if (path === `/api/session/${sessionId}/answer` && options.method === "POST") {
    return answerLocally(JSON.parse(options.body));
  }
  throw new Error("Unknown local game action.");
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
