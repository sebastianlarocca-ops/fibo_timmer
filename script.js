/**
 * Shared Web Audio beep helper. Each timer can use different frequencies.
 */
function playTone(freqHz, durationMs, gainValue = 0.07) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  const audioCtx = new AudioCtx();
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = freqHz;
  gainNode.gain.value = gainValue;

  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  oscillator.start();
  oscillator.stop(audioCtx.currentTime + durationMs / 1000);

  oscillator.onended = () => {
    audioCtx.close();
  };
}

/** Short pulse when a work/rest phase switches (guarded for unsupported APIs). */
function vibratePhaseTransition() {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(70);
  }
}

/** Stronger pattern when a workout block completes. */
function vibrateWorkoutComplete() {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate([90, 45, 90, 45, 140]);
  }
}

/** Fibonacci: higher pitch transition beep */
function playFibTransitionBeep() {
  playTone(880, 160);
  vibratePhaseTransition();
}

/** Fibonacci: two-tone completion */
function playFibCompleteSound() {
  playTone(880, 120, 0.08);
  setTimeout(() => playTone(1174, 180, 0.08), 140);
  vibrateWorkoutComplete();
}

/** Tabata: lower pitch so it is distinct from Fibonacci */
function playTabataTransitionBeep() {
  playTone(660, 150);
  vibratePhaseTransition();
}

/** Tabata: distinct completion (minor third up) */
function playTabataCompleteSound() {
  playTone(660, 110, 0.08);
  setTimeout(() => playTone(880, 200, 0.08), 120);
  vibrateWorkoutComplete();
}

function formatTime(totalSeconds) {
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/**
 * Reusable interval timer: own state, own setInterval, no globals.
 * @param {object} options
 * @param {() => Array<{ type: string, durationSec: number }>} options.getSequence
 * @param {(timer: WorkoutTimer) => void} options.onRender
 * @param {() => void} [options.onTransitionBeep]
 * @param {() => void} [options.onCompleteBeep]
 * @param {number} [options.tickMs]
 */
class WorkoutTimer {
  constructor(options) {
    this._getSequence = options.getSequence;
    this._onRender = options.onRender;
    this._onTransitionBeep = options.onTransitionBeep || (() => {});
    this._onCompleteBeep = options.onCompleteBeep || (() => {});
    this._tickMs = options.tickMs ?? 100;

    this._intervalId = null;
    this._isRunning = false;
    this._isComplete = false;
    this._currentIndex = 0;
    this._sequence = [];
    this._remainingMs = 0;
    this._phaseEndTime = 0;
    this._elapsedBeforePhaseSec = 0;

    this._loadSequence();
  }

  _loadSequence() {
    this._sequence = this._getSequence();
    if (!this._sequence.length) {
      this._remainingMs = 0;
      return;
    }
    this._remainingMs = this._sequence[0].durationSec * 1000;
  }

  isRunning() {
    return this._isRunning;
  }

  isComplete() {
    return this._isComplete;
  }

  get currentIndex() {
    return this._currentIndex;
  }

  get remainingMs() {
    return this._remainingMs;
  }

  get sequence() {
    return this._sequence;
  }

  get elapsedBeforePhaseSec() {
    return this._elapsedBeforePhaseSec;
  }

  reset() {
    this._stopInterval();
    this._isRunning = false;
    this._isComplete = false;
    this._currentIndex = 0;
    this._elapsedBeforePhaseSec = 0;
    this._loadSequence();
    if (this._sequence.length) {
      this._remainingMs = this._sequence[0].durationSec * 1000;
    }
    this._phaseEndTime = 0;
    this._onRender(this);
  }

  start() {
    if (this._isComplete) {
      this.reset();
    }
    if (this._isRunning) return;
    if (!this._sequence.length) return;

    this._isRunning = true;
    this._phaseEndTime = Date.now() + this._remainingMs;

    if (this._intervalId === null) {
      this._intervalId = setInterval(() => this._tick(), this._tickMs);
    }
    this._onRender(this);
  }

  pause() {
    if (!this._isRunning || this._isComplete) return;
    this._isRunning = false;
    this._remainingMs = Math.max(0, this._phaseEndTime - Date.now());
    this._onRender(this);
  }

  _stopInterval() {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  _tick() {
    if (!this._isRunning || this._isComplete) return;

    this._remainingMs = Math.max(0, this._phaseEndTime - Date.now());
    this._onRender(this);

    if (this._remainingMs <= 0) {
      this._advancePhase();
    }
  }

  _advancePhase() {
    const ended = this._sequence[this._currentIndex];
    this._elapsedBeforePhaseSec += ended.durationSec;
    this._currentIndex += 1;

    if (this._currentIndex >= this._sequence.length) {
      this._finish();
      return;
    }

    this._remainingMs = this._sequence[this._currentIndex].durationSec * 1000;
    this._phaseEndTime = Date.now() + this._remainingMs;
    this._onTransitionBeep();
    this._onRender(this);
  }

  _finish() {
    this._isRunning = false;
    this._isComplete = true;
    this._remainingMs = 0;
    this._stopInterval();
    this._onCompleteBeep();
    this._onRender(this);
  }
}

// --- Fibonacci sequence (fixed) ---
const FIB_SEQUENCE = [
  { type: "work", durationSec: 60 },
  { type: "rest", durationSec: 30 },
  { type: "work", durationSec: 120 },
  { type: "rest", durationSec: 30 },
  { type: "work", durationSec: 180 },
  { type: "rest", durationSec: 60 },
  { type: "work", durationSec: 300 },
  { type: "rest", durationSec: 120 },
  { type: "work", durationSec: 480 },
];

const FIB_TOTAL_SEC = FIB_SEQUENCE.reduce((s, x) => s + x.durationSec, 0);
const FIB_TOTAL_BLOCKS = 5;

const FIB_BLOCK_TYPES = ["core", "bodyweight", "overload"];

/** Persisted JSON arrays (one key per block). */
const FIB_EXERCISE_LIST_STORAGE_KEYS = {
  core: "fibWorkoutExerciseListCore",
  bodyweight: "fibWorkoutExerciseListBodyweight",
  overload: "fibWorkoutExerciseListOverload",
};

/** Legacy single-string keys (migrated to lists when present). */
const FIB_EXERCISE_LEGACY_SINGLE_KEYS = {
  core: "fibWorkoutExerciseCore",
  bodyweight: "fibWorkoutExerciseBodyweight",
  overload: "fibWorkoutExerciseOverload",
};

const fibExerciseLists = {
  core: [],
  bodyweight: [],
  overload: [],
};

const coreExercises = fibExerciseLists.core;
const bodyweightExercises = fibExerciseLists.bodyweight;
const overloadExercises = fibExerciseLists.overload;

const FIB_FALLBACK_BLOCK_LABEL = {
  core: "Core",
  bodyweight: "Bodyweight",
  overload: "Overload",
};

/** Wall-clock ms when the current Fibonacci session should end; null when idle / reset / complete. */
let fibonacciWorkoutEndAtMs = null;

/**
 * Sum of all Fibonacci intervals (work + rest) in milliseconds.
 */
function calculateFibonacciTotalDurationMs() {
  return FIB_SEQUENCE.reduce((ms, seg) => ms + seg.durationSec * 1000, 0);
}

/**
 * Expected finish time for a full Fibonacci workout if it begins at `fromTimestamp`.
 * @param {number} [fromTimestamp] DOMHighResTimeStamp-style ms since epoch (default: now)
 * @returns {Date}
 */
function calculateWorkoutEndTime(fromTimestamp = Date.now()) {
  return new Date(fromTimestamp + calculateFibonacciTotalDurationMs());
}

function formatClock24HHMM(date) {
  const h = date.getHours();
  const m = date.getMinutes();
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatFibonacciHumanTotal() {
  const m = Math.floor(FIB_TOTAL_SEC / 60);
  const s = FIB_TOTAL_SEC % 60;
  return `${m} min ${String(s).padStart(2, "0")} sec`;
}

const fibCard = document.getElementById("fibonacciCard");
const phaseLabel = document.getElementById("phaseLabel");
const timeLabel = document.getElementById("timeLabel");
const blockLabel = document.getElementById("blockLabel");
const fibTotalDurationLabel = document.getElementById("fibTotalDuration");
const fibEndsAtLabel = document.getElementById("fibEndsAt");
const fibInputCore = document.getElementById("fibInputCore");
const fibInputBodyweight = document.getElementById("fibInputBodyweight");
const fibInputOverload = document.getElementById("fibInputOverload");
/** @type {Record<string, HTMLInputElement | null>} */
const fibInputByType = {
  core: fibInputCore,
  bodyweight: fibInputBodyweight,
  overload: fibInputOverload,
};
/** @type {Record<string, HTMLUListElement | null>} */
const fibListByType = {
  core: document.getElementById("fibListCore"),
  bodyweight: document.getElementById("fibListBodyweight"),
  overload: document.getElementById("fibListOverload"),
};
const fibCurrentExerciseEl = document.getElementById("fibCurrentExercise");
const progressBar = document.getElementById("progressBar");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");

function loadFibExerciseListsFromStorage() {
  try {
    FIB_BLOCK_TYPES.forEach((type) => {
      const list = fibExerciseLists[type];
      const raw = localStorage.getItem(FIB_EXERCISE_LIST_STORAGE_KEYS[type]);
      list.length = 0;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            parsed.forEach((item) => {
              const s = String(item).trim();
              if (s) list.push(s);
            });
            return;
          }
        } catch {
          /* fall through to legacy */
        }
      }
      const legacy = localStorage.getItem(FIB_EXERCISE_LEGACY_SINGLE_KEYS[type]);
      if (legacy && legacy.trim()) list.push(legacy.trim());
    });
  } catch {
    /* private mode / disabled storage */
  }
}

function persistFibExerciseLists() {
  try {
    FIB_BLOCK_TYPES.forEach((type) => {
      localStorage.setItem(FIB_EXERCISE_LIST_STORAGE_KEYS[type], JSON.stringify(fibExerciseLists[type]));
    });
  } catch {
    /* ignore */
  }
}

/**
 * @param {"core"|"bodyweight"|"overload"} type
 */
function renderExerciseList(type) {
  const ul = fibListByType[type];
  if (!ul) return;
  ul.replaceChildren();
  fibExerciseLists[type].forEach((label, index) => {
    const li = document.createElement("li");
    li.className = "fib-exercise-list-item";
    const name = document.createElement("span");
    name.className = "fib-exercise-list-item__text";
    name.textContent = label;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fib-exercise-remove";
    btn.textContent = "×";
    btn.setAttribute("aria-label", `Remove ${label}`);
    btn.addEventListener("click", () => removeExercise(type, index));
    li.append(name, btn);
    ul.appendChild(li);
  });
}

/**
 * @param {"core"|"bodyweight"|"overload"} type
 */
function addExercise(type) {
  if (!FIB_BLOCK_TYPES.includes(type)) return;
  const input = fibInputByType[type];
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  fibExerciseLists[type].push(text);
  input.value = "";
  persistFibExerciseLists();
  renderExerciseList(type);
  refreshFibWorkoutExerciseDisplay();
}

/**
 * @param {"core"|"bodyweight"|"overload"} type
 */
function removeExercise(type, index) {
  if (!FIB_BLOCK_TYPES.includes(type)) return;
  const list = fibExerciseLists[type];
  if (index < 0 || index >= list.length) return;
  list.splice(index, 1);
  persistFibExerciseLists();
  renderExerciseList(type);
  refreshFibWorkoutExerciseDisplay();
}

function refreshFibWorkoutExerciseDisplay() {
  if (fibonacciTimer.isRunning() || !isFibIdleBeforeStart(fibonacciTimer)) {
    renderFibonacci(fibonacciTimer);
  }
}

/** Text for current work block (lists, warm-up, rest); null hides the row. */
function getFibonacciCurrentExerciseLine(timer) {
  if (timer.isComplete()) return null;
  if (isFibIdleBeforeStart(timer)) return null;

  const current = timer.sequence[timer.currentIndex];
  if (current.type === "rest") return "Rest";

  const d = current.durationSec;
  if (d === 60 || d === 120) return "Warm-up";

  /** @type {"core"|"bodyweight"|"overload"|null} */
  let blockType = null;
  if (d === 180) blockType = "core";
  else if (d === 300) blockType = "bodyweight";
  else if (d === 480) blockType = "overload";

  if (!blockType) return "Warm-up";

  const list = fibExerciseLists[blockType];
  const fallback = FIB_FALLBACK_BLOCK_LABEL[blockType];
  if (!list.length) return fallback;
  if (list.length === 1) return list[0];
  return list.map((x) => `• ${x}`).join("\n");
}

function updateFibCurrentExerciseUi(timer) {
  if (!fibCurrentExerciseEl) return;
  const line = getFibonacciCurrentExerciseLine(timer);
  if (line === null) {
    fibCurrentExerciseEl.textContent = "";
    fibCurrentExerciseEl.hidden = true;
    return;
  }
  fibCurrentExerciseEl.hidden = false;
  fibCurrentExerciseEl.textContent = line.includes("\n") ? `Current:\n${line}` : `Current: ${line}`;
}

function updateFibonacciScheduleUi(timer) {
  if (fibTotalDurationLabel) {
    fibTotalDurationLabel.textContent = `Total: ${formatFibonacciHumanTotal()}`;
  }

  if (!fibEndsAtLabel) return;

  if (timer.isComplete() || fibonacciWorkoutEndAtMs === null) {
    fibEndsAtLabel.textContent = "";
    fibEndsAtLabel.hidden = true;
    return;
  }

  fibEndsAtLabel.hidden = false;
  fibEndsAtLabel.textContent = `Ends at: ${formatClock24HHMM(new Date(fibonacciWorkoutEndAtMs))}`;
}

function fibWorkBlockNumber(index) {
  let count = 0;
  for (let i = 0; i <= index; i += 1) {
    if (FIB_SEQUENCE[i].type === "work") count += 1;
  }
  return count;
}

function setFibCardBackground(kind) {
  fibCard.classList.remove("fib-bg-idle", "fib-bg-work", "fib-bg-rest", "fib-bg-done");
  fibCard.classList.add(`fib-bg-${kind}`);
}

function isFibIdleBeforeStart(timer) {
  if (timer.isComplete() || timer.isRunning()) return false;
  if (timer.currentIndex !== 0 || timer.elapsedBeforePhaseSec !== 0) return false;
  const first = timer.sequence[0];
  if (!first) return false;
  return timer.remainingMs === first.durationSec * 1000;
}

function renderFibonacci(timer) {
  if (timer.isComplete()) {
    fibonacciWorkoutEndAtMs = null;
    phaseLabel.textContent = "Workout Complete";
    timeLabel.textContent = "00:00";
    blockLabel.textContent = `Block ${FIB_TOTAL_BLOCKS} of ${FIB_TOTAL_BLOCKS}`;
    progressBar.style.width = "100%";
    setFibCardBackground("done");
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    updateFibonacciScheduleUi(timer);
    updateFibCurrentExerciseUi(timer);
    return;
  }

  if (isFibIdleBeforeStart(timer)) {
    phaseLabel.textContent = "Ready";
    timeLabel.textContent = formatTime(Math.ceil(timer.remainingMs / 1000));
    blockLabel.textContent = `Block 0 of ${FIB_TOTAL_BLOCKS}`;
    progressBar.style.width = "0%";
    setFibCardBackground("idle");
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    updateFibonacciScheduleUi(timer);
    updateFibCurrentExerciseUi(timer);
    return;
  }

  const current = timer.sequence[timer.currentIndex];
  const label = current.type === "work" ? "Work" : "Rest";
  phaseLabel.textContent = label;
  timeLabel.textContent = formatTime(Math.ceil(timer.remainingMs / 1000));
  blockLabel.textContent = `Block ${fibWorkBlockNumber(timer.currentIndex)} of ${FIB_TOTAL_BLOCKS}`;

  let completedSec = timer.elapsedBeforePhaseSec;
  const curTotal = current.durationSec;
  const curRem = Math.ceil(timer.remainingMs / 1000);
  completedSec += Math.max(0, curTotal - curRem);
  const pct = Math.min(100, (completedSec / FIB_TOTAL_SEC) * 100);
  progressBar.style.width = `${pct}%`;

  setFibCardBackground(current.type === "work" ? "work" : "rest");
  startBtn.disabled = timer.isRunning();
  pauseBtn.disabled = !timer.isRunning();
  updateFibonacciScheduleUi(timer);
  updateFibCurrentExerciseUi(timer);
}

const fibonacciTimer = new WorkoutTimer({
  getSequence: () => FIB_SEQUENCE,
  onRender: renderFibonacci,
  onTransitionBeep: playFibTransitionBeep,
  // Play the completion sound AND persist to MongoDB.
  // saveCompletedWorkoutToAPI() is async/non-blocking — any error is swallowed
  // so a network failure never breaks the in-browser experience.
  onCompleteBeep: () => {
    playFibCompleteSound();
    saveCompletedWorkoutToAPI();
  },
});

function fibonacciResetUi() {
  fibonacciWorkoutEndAtMs = null;
  fibonacciTimer.reset();
}

function initFibExerciseListsUi() {
  loadFibExerciseListsFromStorage();
  FIB_BLOCK_TYPES.forEach((type) => renderExerciseList(type));

  document.querySelectorAll("[data-fib-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.getAttribute("data-fib-add");
      if (type && FIB_BLOCK_TYPES.includes(type)) addExercise(type);
    });
  });

  FIB_BLOCK_TYPES.forEach((type) => {
    const input = fibInputByType[type];
    if (!input) return;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addExercise(type);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// MongoDB API — save completed workout
// ---------------------------------------------------------------------------

/** Base URL of the Express backend. Change this to your Render URL when deployed. */
const API_BASE_URL = "https://fibo-workout-backend.onrender.com";

/**
 * POST the current exercise lists + timestamp to /api/workouts.
 * Fires exactly once (via onCompleteBeep) when the Fibonacci timer finishes.
 * Errors are logged but never surface to the user — the app keeps working.
 */
async function saveCompletedWorkoutToAPI() {
  const payload = {
    date: new Date().toISOString(),
    core: [...fibExerciseLists.core],
    bodyweight: [...fibExerciseLists.bodyweight],
    overload: [...fibExerciseLists.overload],
    durationSec: FIB_TOTAL_SEC,
  };

  try {
    const res = await fetch(`${API_BASE_URL}/api/workouts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn("[API] Failed to save workout:", err.error || res.status);
      return;
    }

    const data = await res.json();
    console.log(`[API] Workout saved to MongoDB — id: ${data.id}`);
  } catch (err) {
    // Network error or server offline — silently swallow so the app is unaffected
    console.warn("[API] Could not reach workout server (offline?):", err.message);
  }
}

// --- Persistence: named wrappers (spec-required API) ---

function saveToLocalStorage() {
  persistFibExerciseLists();
}

function loadFromLocalStorage() {
  loadFibExerciseListsFromStorage();
}

// --- Export to TXT ---

function exportToTXT() {
  const sections = [
    { label: "CORE", type: "core" },
    { label: "BODYWEIGHT", type: "bodyweight" },
    { label: "OVERLOAD", type: "overload" },
  ];
  const lines = [];
  sections.forEach(({ label, type }, i) => {
    if (i > 0) lines.push("");
    lines.push(`${label}:`);
    fibExerciseLists[type].forEach((ex) => lines.push(ex));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "routine.txt";
  a.click();
  URL.revokeObjectURL(url);
  showFibIOFeedback("Routine exported!");
}

// --- Import from TXT ---

function parseTXTRoutine(text) {
  const result = { core: [], bodyweight: [], overload: [] };
  const sectionMap = { CORE: "core", BODYWEIGHT: "bodyweight", OVERLOAD: "overload" };
  let current = null;
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.endsWith(":")) {
      const key = trimmed.slice(0, -1).toUpperCase();
      if (sectionMap[key]) { current = sectionMap[key]; return; }
    }
    if (current) result[current].push(trimmed);
  });
  return result;
}

function importFromTXT(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = parseTXTRoutine(e.target.result);
      const hasContent = FIB_BLOCK_TYPES.some((t) => parsed[t].length > 0);
      if (!hasContent) { showFibIOFeedback("No valid sections found.", true); return; }
      FIB_BLOCK_TYPES.forEach((type) => {
        fibExerciseLists[type].length = 0;
        parsed[type].forEach((ex) => fibExerciseLists[type].push(ex));
      });
      saveToLocalStorage();
      FIB_BLOCK_TYPES.forEach((type) => renderExerciseList(type));
      refreshFibWorkoutExerciseDisplay();
      showFibIOFeedback("Routine imported!");
    } catch {
      showFibIOFeedback("Invalid file format.", true);
    }
  };
  reader.readAsText(file);
}

// --- IO feedback banner ---

function showFibIOFeedback(msg, isError = false) {
  const el = document.getElementById("fibIOFeedback");
  if (!el) return;
  el.textContent = msg;
  el.className = `fib-io-feedback${isError ? " fib-io-feedback--error" : ""}`;
  el.hidden = false;
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.hidden = true; el.textContent = ""; }, 2500);
}

// --- Wire Export / Import buttons ---

function initFibIO() {
  const exportBtn = document.getElementById("fibExportBtn");
  const importBtn = document.getElementById("fibImportBtn");
  const importFile = document.getElementById("fibImportFile");

  if (exportBtn) exportBtn.addEventListener("click", exportToTXT);
  if (importBtn && importFile) {
    importBtn.addEventListener("click", () => importFile.click());
    importFile.addEventListener("change", () => {
      if (importFile.files && importFile.files[0]) {
        importFromTXT(importFile.files[0]);
        importFile.value = "";
      }
    });
  }
}

// --- Tabata: configurable sequence from inputs ---
const tabWork = document.getElementById("tabWork");
const tabRest = document.getElementById("tabRest");
const tabRounds = document.getElementById("tabRounds");
const tabCard = document.getElementById("tabataCard");
const tabPhaseLabel = document.getElementById("tabPhaseLabel");
const tabTimeLabel = document.getElementById("tabTimeLabel");
const tabRoundLabel = document.getElementById("tabRoundLabel");
const tabProgressBar = document.getElementById("tabProgressBar");
const tabStartBtn = document.getElementById("tabStartBtn");
const tabPauseBtn = document.getElementById("tabPauseBtn");
const tabResetBtn = document.getElementById("tabResetBtn");
const tabataConfig = document.getElementById("tabataConfig");

function parsePositiveInt(input, fallback) {
  const n = parseInt(input.value, 10);
  if (Number.isFinite(n) && n >= 1) return n;
  return fallback;
}

/**
 * Each round = work then rest (8 rounds => 8 work + 8 rest segments).
 */
function buildTabataSequence() {
  const workSec = parsePositiveInt(tabWork, 20);
  const restSec = parsePositiveInt(tabRest, 10);
  const rounds = parsePositiveInt(tabRounds, 8);
  const seq = [];
  for (let r = 0; r < rounds; r += 1) {
    seq.push({ type: "work", durationSec: workSec });
    seq.push({ type: "rest", durationSec: restSec });
  }
  return { seq, rounds };
}

function tabataTotalSec(sequence) {
  return sequence.reduce((a, b) => a + b.durationSec, 0);
}

/** Current round 1..R for display (work and rest phases). */
function tabataRoundFromIndex(index, totalRounds) {
  return Math.min(totalRounds, Math.floor(index / 2) + 1);
}

function setTabataCardBackground(kind) {
  tabCard.classList.remove("tabata-bg-idle", "tabata-bg-work", "tabata-bg-rest", "tabata-bg-done");
  tabCard.classList.add(`tabata-bg-${kind}`);
}

let tabataMeta = { rounds: 8 };

function isTabataIdleBeforeStart(timer) {
  if (timer.isComplete() || timer.isRunning()) return false;
  if (timer.currentIndex !== 0 || timer.elapsedBeforePhaseSec !== 0) return false;
  const first = timer.sequence[0];
  if (!first) return false;
  return timer.remainingMs === first.durationSec * 1000;
}

function renderTabata(timer) {
  const { rounds } = tabataMeta;

  if (timer.isComplete()) {
    tabPhaseLabel.textContent = "Tabata Complete";
    tabTimeLabel.textContent = "00:00";
    tabRoundLabel.textContent = `Round ${rounds} of ${rounds}`;
    tabProgressBar.style.width = "100%";
    setTabataCardBackground("done");
    tabStartBtn.disabled = false;
    tabPauseBtn.disabled = true;
    tabWork.disabled = false;
    tabRest.disabled = false;
    tabRounds.disabled = false;
    return;
  }

  if (isTabataIdleBeforeStart(timer)) {
    tabPhaseLabel.textContent = "Ready";
    tabTimeLabel.textContent = formatTime(Math.ceil(timer.remainingMs / 1000));
    tabRoundLabel.textContent = `Round 0 of ${rounds}`;
    tabProgressBar.style.width = "0%";
    setTabataCardBackground("idle");
    tabStartBtn.disabled = false;
    tabPauseBtn.disabled = true;
    tabWork.disabled = false;
    tabRest.disabled = false;
    tabRounds.disabled = false;
    return;
  }

  const current = timer.sequence[timer.currentIndex];
  tabPhaseLabel.textContent = current.type === "work" ? "Work" : "Rest";
  tabTimeLabel.textContent = formatTime(Math.ceil(timer.remainingMs / 1000));
  tabRoundLabel.textContent = `Round ${tabataRoundFromIndex(timer.currentIndex, rounds)} of ${rounds}`;

  const totalSec = tabataTotalSec(timer.sequence);
  let completedSec = timer.elapsedBeforePhaseSec;
  const curTotal = current.durationSec;
  const curRem = Math.ceil(timer.remainingMs / 1000);
  completedSec += Math.max(0, curTotal - curRem);
  const pct = totalSec > 0 ? Math.min(100, (completedSec / totalSec) * 100) : 0;
  tabProgressBar.style.width = `${pct}%`;

  setTabataCardBackground(current.type === "work" ? "work" : "rest");
  tabStartBtn.disabled = timer.isRunning();
  tabPauseBtn.disabled = !timer.isRunning();
  tabWork.disabled = timer.isRunning();
  tabRest.disabled = timer.isRunning();
  tabRounds.disabled = timer.isRunning();
}

const tabataTimer = new WorkoutTimer({
  getSequence: () => {
    const { seq, rounds } = buildTabataSequence();
    tabataMeta = { rounds };
    return seq;
  },
  onRender: renderTabata,
  onTransitionBeep: playTabataTransitionBeep,
  onCompleteBeep: playTabataCompleteSound,
});

// --- Wire controls (each timer isolated) ---
startBtn.addEventListener("click", () => {
  const wasComplete = fibonacciTimer.isComplete();
  const idleBeforeStart = isFibIdleBeforeStart(fibonacciTimer);
  fibonacciTimer.start();
  if (wasComplete || idleBeforeStart) {
    fibonacciWorkoutEndAtMs = calculateWorkoutEndTime(Date.now()).getTime();
    renderFibonacci(fibonacciTimer);
  }
});
pauseBtn.addEventListener("click", () => fibonacciTimer.pause());
resetBtn.addEventListener("click", () => fibonacciResetUi());

tabStartBtn.addEventListener("click", () => tabataTimer.start());
tabPauseBtn.addEventListener("click", () => tabataTimer.pause());
tabResetBtn.addEventListener("click", () => tabataTimer.reset());

/** When idle, changing Tabata settings rebuilds the sequence */
function onTabataConfigChange() {
  if (!tabataTimer.isRunning() && !tabataTimer.isComplete()) {
    tabataTimer.reset();
  }
}

tabWork.addEventListener("change", onTabataConfigChange);
tabRest.addEventListener("change", onTabataConfigChange);
tabRounds.addEventListener("change", onTabataConfigChange);

// --- Tabata: slide-in drawer (fixed; no impact on Fibonacci layout) ---
function initTabataDrawer() {
  const overlay = document.getElementById("tabataDrawerOverlay");
  const drawer = document.getElementById("tabataDrawer");
  const openBtn = document.getElementById("tabataDrawerOpenBtn");
  const closeBtn = document.getElementById("tabataDrawerClose");

  if (!overlay || !drawer || !openBtn || !closeBtn) return;

  function openTabataDrawer() {
    overlay.classList.add("active");
    drawer.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    drawer.setAttribute("aria-hidden", "false");
    openBtn.setAttribute("aria-expanded", "true");
  }

  function closeTabataDrawer() {
    overlay.classList.remove("active");
    drawer.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
    drawer.setAttribute("aria-hidden", "true");
    openBtn.setAttribute("aria-expanded", "false");
  }

  openBtn.addEventListener("click", openTabataDrawer);
  closeBtn.addEventListener("click", closeTabataDrawer);
  overlay.addEventListener("click", closeTabataDrawer);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawer.classList.contains("open")) {
      closeTabataDrawer();
    }
  });
}

initTabataDrawer();

// --- PWA: service worker + optional install prompt ---
// Service workers require a secure context (HTTPS or localhost) in production.

let deferredInstallPrompt = null;

/**
 * Register the service worker after load. Uses a URL relative to the page so
 * file:// and subdirectory deploys behave predictably; production should be HTTPS.
 */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    const swUrl = new URL("service-worker.js", window.location.href);
    navigator.serviceWorker.register(swUrl).catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

registerServiceWorker();

const installAppBtn = document.getElementById("installAppBtn");

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (installAppBtn) {
    installAppBtn.hidden = false;
  }
});

if (installAppBtn) {
  installAppBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => {});
    deferredInstallPrompt = null;
    installAppBtn.hidden = true;
  });
}

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  if (installAppBtn) installAppBtn.hidden = true;
});

initFibExerciseListsUi();
initFibIO();

// Initial paint
fibonacciResetUi();
tabataTimer.reset();

// ===========================================================================
// DASHBOARD
// ===========================================================================

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ── Utilities ───────────────────────────────────────────────────────────────

function dashFormatDate(isoStr) {
  return new Date(isoStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function dashDaysSince(isoStr) {
  return Math.floor((Date.now() - new Date(isoStr).getTime()) / 86_400_000);
}

/** Returns { "YYYY-MM": count } for every workout */
function groupByMonth(workouts) {
  return workouts.reduce((acc, w) => {
    const d = new Date(w.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

/** Consecutive training days ending today or yesterday */
function calcStreak(workouts) {
  if (!workouts.length) return 0;

  const toDay = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const uniqueDays = [...new Set(workouts.map((w) => toDay(new Date(w.date))))].sort().reverse();

  const today = toDay(new Date());
  const yesterday = toDay(new Date(Date.now() - 86_400_000));

  if (uniqueDays[0] !== today && uniqueDays[0] !== yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < uniqueDays.length; i++) {
    const prev = new Date(uniqueDays[i - 1]);
    const curr = new Date(uniqueDays[i]);
    if (Math.round((prev - curr) / 86_400_000) === 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// ── Data fetching ────────────────────────────────────────────────────────────

async function fetchAllWorkouts() {
  const res = await fetch(`${API_BASE_URL}/api/workouts?limit=500`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return Array.isArray(body) ? body : (body.workouts ?? []);
}

// ── Stats computation ─────────────────────────────────────────────────────────

function computeDashStats(workouts) {
  if (!workouts.length) return null;

  const sorted = [...workouts].sort((a, b) => new Date(a.date) - new Date(b.date));
  const now    = new Date();
  const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const byMonth = groupByMonth(workouts);

  return {
    firstDate:      sorted[0].date,
    lastDate:       sorted[sorted.length - 1].date,
    daysSinceLast:  dashDaysSince(sorted[sorted.length - 1].date),
    thisMonthCount: byMonth[curKey] ?? 0,
    streak:         calcStreak(workouts),
    byMonth,
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

function setDashText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function renderDashboard(workouts) {
  const cards       = document.getElementById("dashCards");
  const historyList = document.getElementById("dashHistoryList");
  const msg         = document.getElementById("dashMessage");

  if (!workouts.length) {
    if (cards) cards.hidden = true;
    if (historyList) historyList.replaceChildren();
    if (msg) {
      msg.textContent = "No workouts yet. Complete a Fibonacci session to start tracking!";
      msg.className   = "dash-message";
      msg.hidden      = false;
    }
    return;
  }

  if (cards) cards.hidden = false;
  if (msg)  msg.hidden    = true;

  const s = computeDashStats(workouts);

  setDashText("dashFirstDate",   dashFormatDate(s.firstDate));
  setDashText("dashMonthCount",  s.thisMonthCount);
  setDashText("dashLastDays",    s.daysSinceLast === 0 ? "Today" : `${s.daysSinceLast}d ago`);
  setDashText("dashStreak",      `${s.streak} day${s.streak !== 1 ? "s" : ""}`);

  if (!historyList) return;
  historyList.replaceChildren();

  Object.keys(s.byMonth)
    .sort()
    .reverse()
    .forEach((key) => {
      const [year, month] = key.split("-");
      const count = s.byMonth[key];
      const li    = document.createElement("li");
      li.className = "dash-history__item";
      li.innerHTML = `
        <span class="dash-history__period">${year} — ${MONTH_NAMES[parseInt(month, 10) - 1]}</span>
        <span class="dash-history__count">${count} workout${count !== 1 ? "s" : ""}</span>`;
      historyList.appendChild(li);
    });
}

function setDashLoadingState() {
  ["dashFirstDate","dashMonthCount","dashLastDays","dashStreak"].forEach((id) =>
    setDashText(id, "…")
  );
  const list = document.getElementById("dashHistoryList");
  if (list) list.replaceChildren();
}

// ── Load (fetch → compute → render) ─────────────────────────────────────────

async function loadDashboard() {
  setDashLoadingState();
  const msg = document.getElementById("dashMessage");
  if (msg) msg.hidden = true;

  try {
    const workouts = await fetchAllWorkouts();
    renderDashboard(workouts);
  } catch (err) {
    console.warn("[Dashboard] fetch failed:", err.message);
    if (msg) {
      msg.textContent = "Could not load data — server may be offline.";
      msg.className   = "dash-message dash-message--error";
      msg.hidden      = false;
    }
  }
}

// ── View router ───────────────────────────────────────────────────────────────

function showView(name) {
  document.querySelectorAll(".app-view").forEach((el) => {
    el.hidden = el.id !== `view-${name}`;
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("nav-btn--active", btn.dataset.view === name);
  });
  // Tabata FAB is only meaningful inside the timer view
  const tabataFab = document.getElementById("tabataDrawerOpenBtn");
  if (tabataFab) tabataFab.hidden = name !== "timer";

  if (name === "dashboard") loadDashboard();
}

function initNavigation() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });
}

initNavigation();
