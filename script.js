// ---------------------------------------------------------------------------
// AUDIO — avisos de cambio de fase
// ---------------------------------------------------------------------------
//
// Pensado para escucharse en un gimnasio, con música de fondo y el teléfono en
// el piso. Tres decisiones que definen cuánto se escucha:
//
//   1. Volumen. Antes el gain era 0.07 (7% de amplitud). Ahora va cerca del
//      máximo, con un compresor al final de la cadena que impide que sature.
//   2. Forma de onda. Un `sine` puro concentra toda su energía en una sola
//      frecuencia y se tapa con cualquier ruido. Un `square` filtrado tiene
//      armónicos que atraviesan el ruido ambiente muchísimo mejor.
//   3. Frecuencia. El oído humano es más sensible entre 2 y 5 kHz. Los 880/660 Hz
//      originales quedaban por debajo de esa banda: a igual amplitud se perciben
//      bastante más bajos.
//
// Además cada aviso es un patrón de varios pulsos, no un pitido único: es mucho
// más difícil que se te pase mientras estás entrenando.

/** Volumen maestro, 0..1. Único lugar para subir o bajar todo. */
const BEEP_VOLUME = 0.9;

let _audioCtx = null;
let _audioMaster = null;   // entrada de la cadena: acá se conectan los pulsos
let _audioOut = null;      // salida: compresor, último nodo antes del destino

/**
 * Un único AudioContext compartido para toda la app.
 *
 * El código anterior creaba y cerraba un AudioContext por cada tono. Los
 * navegadores limitan cuántos podés tener abiertos a la vez (Chrome ~6) y cada
 * creación tiene costo; además, uno creado sin gesto del usuario arranca
 * `suspended` y no suena.
 */
function getAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  if (!_audioCtx) {
    _audioCtx = new AudioCtx();

    // El compresor permite empujar el volumen hasta arriba sin distorsionar
    // cuando se superponen pulsos.
    const compressor = _audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 18;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;

    _audioMaster = _audioCtx.createGain();
    _audioMaster.gain.value = BEEP_VOLUME;

    _audioMaster.connect(compressor);
    compressor.connect(_audioCtx.destination);
    _audioOut = compressor;
  }

  if (_audioCtx.state === "suspended") _audioCtx.resume();
  return _audioCtx;
}

/**
 * Se llama desde el click de Start. Los navegadores exigen un gesto del usuario
 * para habilitar audio: si el contexto se crea recién en el primer cambio de
 * fase (sin gesto de por medio), ese aviso puede no sonar.
 */
function primeAudio() {
  getAudioContext();
}

/**
 * Un pulso con envolvente ADSR.
 *
 * La envolvente no es cosmética: sin ella el oscilador arranca y corta de golpe
 * y se escucha un "click". El ataque de 6 ms es lo bastante rápido para sonar
 * percusivo y lo bastante suave para no chasquear.
 */
function playPulse({ freq, durationMs, delayMs = 0, gain = 1, type = "square" }) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const t0 = ctx.currentTime + delayMs / 1000;
  const dur = durationMs / 1000;

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);

  // Redondea los armónicos más agudos del cuadrado: mantiene la capacidad de
  // cortar el ruido sin que resulte estridente.
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(Math.min(freq * 3.5, 9000), t0);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);          // ataque
  env.gain.setValueAtTime(gain, t0 + Math.max(0.01, dur * 0.65));   // sostenido
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);          // release

  osc.connect(lowpass);
  lowpass.connect(env);
  env.connect(_audioMaster);

  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Encadena varios pulsos: [{ freq, durationMs, gapMs }] */
function playPattern(steps) {
  let offset = 0;
  steps.forEach(({ freq, durationMs, gapMs = 0 }) => {
    playPulse({ freq, durationMs, delayMs: offset });
    offset += durationMs + gapMs;
  });
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

// Se mantiene la relación original: el Fibonacci suena más agudo que el Tabata,
// para poder distinguir de oído cuál de los dos avisó cuando corren juntos.

/** Fibonacci — cambio de fase: doble pulso agudo. */
function playFibTransitionBeep() {
  playPattern([
    { freq: 2637, durationMs: 95, gapMs: 65 },
    { freq: 2637, durationMs: 95 },
  ]);
  vibratePhaseTransition();
}

/** Fibonacci — workout completo: cuatro pulsos ascendentes, el último largo. */
function playFibCompleteSound() {
  playPattern([
    { freq: 1976, durationMs: 110, gapMs: 45 },
    { freq: 2637, durationMs: 110, gapMs: 45 },
    { freq: 3136, durationMs: 110, gapMs: 60 },
    { freq: 3136, durationMs: 420 },
  ]);
  vibrateWorkoutComplete();
}

/** Tabata — cambio de fase: doble pulso, registro más grave que el Fibonacci. */
function playTabataTransitionBeep() {
  playPattern([
    { freq: 1760, durationMs: 90, gapMs: 60 },
    { freq: 1760, durationMs: 90 },
  ]);
  vibratePhaseTransition();
}

/** Tabata — completo: ascendente en su propio registro. */
function playTabataCompleteSound() {
  playPattern([
    { freq: 1319, durationMs: 105, gapMs: 45 },
    { freq: 1760, durationMs: 105, gapMs: 45 },
    { freq: 2093, durationMs: 105, gapMs: 55 },
    { freq: 2093, durationMs: 380 },
  ]);
  vibrateWorkoutComplete();
}

/**
 * Prueba los cuatro avisos sin esperar a que cambie una fase.
 * Desde la consola:  __testSounds()
 */
window.__testSounds = async function () {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const cues = [
    ["Fibonacci · cambio de fase", playFibTransitionBeep],
    ["Fibonacci · completo",       playFibCompleteSound],
    ["Tabata · cambio de fase",    playTabataTransitionBeep],
    ["Tabata · completo",          playTabataCompleteSound],
  ];
  for (const [label, play] of cues) {
    console.log("🔊 " + label);
    play();
    await wait(1800);
  }
  console.log(`Volumen maestro actual: BEEP_VOLUME = ${BEEP_VOLUME}`);
};

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

// Parallel arrays that track the MongoDB _id for each exercise in fibExerciseLists.
// null means the exercise came from localStorage (no DB id yet).
const fibExerciseDbIds = {
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
const fibCountdownLabel   = document.getElementById("fibCountdown");
const fibTimerDisplay     = document.getElementById("fibTimerDisplay");
const fibExerciseSetup    = document.querySelector(".fib-exercise-setup");
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

  const idx = fibExerciseLists[type].length;
  fibExerciseLists[type].push(text);
  fibExerciseDbIds[type].push(null); // filled after async POST response

  input.value = "";
  persistFibExerciseLists();
  renderExerciseList(type);
  refreshFibWorkoutExerciseDisplay();
  updateSessionPlanSummary();
  updateExerciseCacheWith(text);

  postExerciseToCurrentWorkout(text, type).then((id) => {
    if (id) fibExerciseDbIds[type][idx] = id;
  });
}

/**
 * @param {"core"|"bodyweight"|"overload"} type
 */
function removeExercise(type, index) {
  if (!FIB_BLOCK_TYPES.includes(type)) return;
  const list = fibExerciseLists[type];
  if (index < 0 || index >= list.length) return;

  const dbId = fibExerciseDbIds[type][index];
  list.splice(index, 1);
  fibExerciseDbIds[type].splice(index, 1);

  persistFibExerciseLists();
  renderExerciseList(type);
  refreshFibWorkoutExerciseDisplay();
  updateSessionPlanSummary();

  if (dbId) deleteExerciseFromCurrentWorkout(dbId);
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

  if (!fibEndsAtLabel) return;

  if (timer.isComplete() || fibonacciWorkoutEndAtMs === null) {
    fibEndsAtLabel.textContent = "";
    fibEndsAtLabel.hidden = true;
    return;
  }

  fibEndsAtLabel.hidden = false;
  fibEndsAtLabel.textContent = `Ends at: ${formatClock24HHMM(new Date(fibonacciWorkoutEndAtMs))}`;
}

/**
 * Controles en dos slots. El primario alterna Start/Pause en el mismo lugar,
 * y Reset sólo existe cuando hay una sesión en curso:
 *
 *   sin arrancar → sólo Start
 *   corriendo    → Pause + Reset
 *   pausado      → Start + Reset   (el primario "vuelve" a Start)
 *   completo     → Start + Reset
 *
 * Start y Pause nunca están visibles a la vez.
 */
function updateTimerControls({ startEl, pauseEl, resetEl, isRunning, isIdle }) {
  if (startEl) startEl.hidden = isRunning;
  if (pauseEl) pauseEl.hidden = !isRunning;
  if (resetEl) resetEl.hidden = isIdle;
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
  // Full-page mood tint via body class
  document.body.classList.remove("page-idle", "page-work", "page-rest", "page-done");
  document.body.classList.add(`page-${kind}`);
}

function isFibIdleBeforeStart(timer) {
  if (timer.isComplete() || timer.isRunning()) return false;
  if (timer.currentIndex !== 0 || timer.elapsedBeforePhaseSec !== 0) return false;
  const first = timer.sequence[0];
  if (!first) return false;
  return timer.remainingMs === first.durationSec * 1000;
}

function setFibMode(mode) {
  const setup = mode === "setup";
  if (fibExerciseSetup) fibExerciseSetup.hidden = !setup;
  if (fibTimerDisplay)  fibTimerDisplay.hidden  =  setup;

  // Tabata pill appears when Fibonacci is active (modal is separate)
  const tabataPillBtn = document.getElementById("tabataPill");
  if (tabataPillBtn) tabataPillBtn.hidden = setup;

  const viewTimer = document.getElementById("view-timer");
  if (viewTimer)   viewTimer.classList.toggle("timer-running", !setup);
}

function renderFibonacci(timer) {
  if (timer.isComplete()) {
    setFibMode("running");
    fibonacciWorkoutEndAtMs = null;
    phaseLabel.textContent = "Workout Complete";
    timeLabel.textContent = "00:00";
    blockLabel.textContent = `Block ${FIB_TOTAL_BLOCKS} of ${FIB_TOTAL_BLOCKS}`;
    if (fibCountdownLabel) fibCountdownLabel.textContent = "00:00";
    progressBar.style.width = "100%";
    setFibCardBackground("done");
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    updateTimerControls({ startEl: startBtn, pauseEl: pauseBtn, resetEl: resetBtn, isRunning: false, isIdle: false });
    updateFibonacciScheduleUi(timer);
    updateFibCurrentExerciseUi(timer);
    updateFibRing(timer);
    updateTabataFibTimeMirror();
    return;
  }

  if (isFibIdleBeforeStart(timer)) {
    setFibMode("setup");
    setFibCardBackground("idle");
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    updateTimerControls({ startEl: startBtn, pauseEl: pauseBtn, resetEl: resetBtn, isRunning: false, isIdle: true });
    updateSessionPlanSummary();
    return;
  }

  setFibMode("running");
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
  if (fibCountdownLabel) fibCountdownLabel.textContent = formatTime(Math.max(0, FIB_TOTAL_SEC - completedSec));

  setFibCardBackground(current.type === "work" ? "work" : "rest");
  startBtn.disabled = timer.isRunning();
  pauseBtn.disabled = !timer.isRunning();
  updateTimerControls({ startEl: startBtn, pauseEl: pauseBtn, resetEl: resetBtn, isRunning: timer.isRunning(), isIdle: false });
  updateFibonacciScheduleUi(timer);
  updateFibCurrentExerciseUi(timer);
  updateFibRing(timer);
  updateTabataFibTimeMirror();
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
    clearCurrentWorkoutCollection();
    resetFibExercisePlan();
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
const API_BASE_URL = "https://angelic-dream-production-e221.up.railway.app";


// ---------------------------------------------------------------------------
// Pending workout queue — survives Render cold-start failures
// ---------------------------------------------------------------------------

const PENDING_WORKOUTS_KEY = "pendingWorkouts_v1";

function readPendingWorkouts() {
  try {
    const raw = localStorage.getItem(PENDING_WORKOUTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingWorkouts(queue) {
  try {
    localStorage.setItem(PENDING_WORKOUTS_KEY, JSON.stringify(queue));
  } catch { /* storage full */ }
}

function enqueuePendingWorkout(payload) {
  const queue = readPendingWorkouts();
  queue.push(payload);
  writePendingWorkouts(queue);
}

async function flushPendingWorkouts() {
  const queue = readPendingWorkouts();
  if (!queue.length) return;

  const remaining = [];
  for (const payload of queue) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/workouts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`[API] Flushed pending workout — id: ${data.id}, date: ${payload.date}`);
        // Bust the dashboard cache so the next visit shows fresh data
        try { localStorage.removeItem(DASH_CACHE_KEY); } catch { /* ignore */ }
      } else {
        remaining.push(payload);
      }
    } catch {
      remaining.push(payload); // still offline — try again next time
    }
  }
  writePendingWorkouts(remaining);
}

/**
 * POST the current exercise lists + timestamp to /api/workouts.
 * Fires exactly once (via onCompleteBeep) when the Fibonacci timer finishes.
 * If the server is unreachable, the payload is queued in localStorage and
 * retried automatically on the next startup once the server is awake.
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
      enqueuePendingWorkout(payload);
      return;
    }

    const data = await res.json();
    console.log(`[API] Workout saved to MongoDB — id: ${data.id}`);
    // Bust the dashboard cache so the next visit shows today's workout
    try { localStorage.removeItem(DASH_CACHE_KEY); } catch { /* ignore */ }
  } catch (err) {
    console.warn("[API] Could not reach workout server — queued for retry:", err.message);
    enqueuePendingWorkout(payload);
  }
}

// --- Persistence: named wrappers (spec-required API) ---

function saveToLocalStorage() {
  persistFibExerciseLists();
}

function loadFromLocalStorage() {
  loadFibExerciseListsFromStorage();
}

// ---------------------------------------------------------------------------
// currentWorkout API — cross-device exercise plan sync
// ---------------------------------------------------------------------------

async function postExerciseToCurrentWorkout(exercise, block) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/current-workout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exercise, block }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.id;
  } catch {
    return null;
  }
}

async function deleteExerciseFromCurrentWorkout(id) {
  try {
    await fetch(`${API_BASE_URL}/api/current-workout/${id}`, { method: "DELETE" });
  } catch {
    // silently swallow — local state is already updated
  }
}

/**
 * Wipe the currentWorkout collection (DB) — fires once per completed workout,
 * independent of whether saveCompletedWorkoutToAPI's POST succeeds, so a flaky
 * network never leaves a finished session's plan sitting around for the next one.
 */
function clearCurrentWorkoutCollection() {
  fetch(`${API_BASE_URL}/api/current-workout/all`, { method: "DELETE" }).catch(() => {});
}

/** Clear the local exercise-plan state (memory + localStorage) and re-render, so
 * the setup screen is empty and ready for the next workout without manual cleanup. */
function resetFibExercisePlan() {
  FIB_BLOCK_TYPES.forEach((type) => {
    fibExerciseLists[type].length = 0;
    fibExerciseDbIds[type].length = 0;
  });
  persistFibExerciseLists();
  FIB_BLOCK_TYPES.forEach((type) => renderExerciseList(type));
  refreshFibWorkoutExerciseDisplay();
  updateSessionPlanSummary();
  renderFibSummary();
}

/**
 * On startup, fetch the persisted exercise plan from the DB and overwrite
 * local state so all devices stay in sync. Retries on failure to handle
 * Render free-tier cold starts (server can take up to ~60s to wake).
 */
async function loadCurrentWorkoutFromDB() {
  const statusEl = document.getElementById("dbSyncStatus");
  const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

  setStatus("⏳ Syncing with DB…");

  try {
    const res = await fetch(`${API_BASE_URL}/api/current-workout`);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setStatus(`❌ Sync failed: ${res.status} — ${body.error || "unknown error"}`);
      return;
    }

    const items = await res.json(); // [{ _id, exercise, block, createdAt }]

    // DB is authoritative — wipe local lists and repopulate
    FIB_BLOCK_TYPES.forEach((type) => {
      fibExerciseLists[type].length = 0;
      fibExerciseDbIds[type].length = 0;
    });

    items.forEach(({ _id, exercise, block }) => {
      if (!FIB_BLOCK_TYPES.includes(block)) return;
      fibExerciseLists[block].push(exercise);
      fibExerciseDbIds[block].push(_id);
    });

    persistFibExerciseLists(); // keep localStorage in sync
    FIB_BLOCK_TYPES.forEach((type) => renderExerciseList(type));
    refreshFibWorkoutExerciseDisplay();
    updateSessionPlanSummary();
    setStatus(`Synced — ${items.length} exercise(s) loaded`);

    // Flush any workouts that failed to save previously
    flushPendingWorkouts();
  } catch (err) {
    setStatus(`❌ Sync failed: ${err.message}`);
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
  const rounds = parsePositiveInt(tabRounds, 6);
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

let tabataMeta = { rounds: 6 };

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
    updateTimerControls({ startEl: tabStartBtn, pauseEl: tabPauseBtn, resetEl: tabResetBtn, isRunning: false, isIdle: false });
    // Mantener visible el display de running: "Tabata Complete", el anillo lleno
    // y la barra al 100% viven ahí. Con `false` el usuario nunca ve que terminó.
    // La config vuelve a aparecer al hacer Reset.
    updateTabataRunningDisplay(true);
    updateTabataRing(timer);
    updateTabataPill(timer);
    updateTabataTotalTime();
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
    updateTimerControls({ startEl: tabStartBtn, pauseEl: tabPauseBtn, resetEl: tabResetBtn, isRunning: false, isIdle: true });
    updateTabataRunningDisplay(false);
    updateTabataRing(timer);
    updateTabataPill(timer);
    updateTabataTotalTime();
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
  updateTimerControls({ startEl: tabStartBtn, pauseEl: tabPauseBtn, resetEl: tabResetBtn, isRunning: timer.isRunning(), isIdle: false });
  updateTabataRunningDisplay(true);
  updateTabataRing(timer);
  updateTabataPill(timer);
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

// ---------------------------------------------------------------------------
// Workout plan summary — collapsible panel shown while timer runs
// ---------------------------------------------------------------------------

const fibSummaryEl     = document.getElementById("fibSummary");
const fibSummaryToggle = document.getElementById("fibSummaryToggle");
const fibSummaryLabel  = document.getElementById("fibSummaryLabel");
const fibSummaryBody   = document.getElementById("fibSummaryBody");

let fibSummaryOpen = false;

const FIB_BLOCK_LABELS = {
  core:        "Core — 3 min",
  bodyweight:  "Bodyweight — 5 min",
  overload:    "Overload — 8 min",
};

function renderFibSummary() {
  if (!fibSummaryBody) return;

  // Collapsed label — list non-empty blocks
  const filled = FIB_BLOCK_TYPES.filter((t) => fibExerciseLists[t].length > 0);
  if (fibSummaryLabel) {
    fibSummaryLabel.textContent = filled.length
      ? filled.map((t) => `${t.charAt(0).toUpperCase() + t.slice(1)} (${fibExerciseLists[t].length})`).join(" · ")
      : "No exercises planned";
  }

  // Body content
  fibSummaryBody.replaceChildren();
  FIB_BLOCK_TYPES.forEach((type) => {
    const block = document.createElement("div");
    block.className = "fib-summary__block";

    const label = document.createElement("span");
    label.className = "fib-summary__block-label";
    label.textContent = FIB_BLOCK_LABELS[type];
    block.appendChild(label);

    const exercises = fibExerciseLists[type];
    if (exercises.length) {
      exercises.forEach((name) => {
        const ex = document.createElement("span");
        ex.className = "fib-summary__exercise";
        ex.textContent = `• ${name}`;
        block.appendChild(ex);
      });
    } else {
      const empty = document.createElement("span");
      empty.className = "fib-summary__empty";
      empty.textContent = "—";
      block.appendChild(empty);
    }

    fibSummaryBody.appendChild(block);
  });
}

function setFibSummaryOpen(open) {
  fibSummaryOpen = open;
  if (fibSummaryBody) fibSummaryBody.hidden = !open;
  if (fibSummaryEl)   fibSummaryEl.classList.toggle("fib-summary--open", open);
  if (fibSummaryToggle) fibSummaryToggle.setAttribute("aria-expanded", String(open));
}

if (fibSummaryToggle) {
  fibSummaryToggle.addEventListener("click", () => setFibSummaryOpen(!fibSummaryOpen));
}

// --- Wire controls (each timer isolated) ---
startBtn.addEventListener("click", () => {
  primeAudio(); // habilita el audio con el gesto del usuario
  const wasComplete = fibonacciTimer.isComplete();
  const idleBeforeStart = isFibIdleBeforeStart(fibonacciTimer);
  fibonacciTimer.start();
  if (wasComplete || idleBeforeStart) {
    fibonacciWorkoutEndAtMs = calculateWorkoutEndTime(Date.now()).getTime();
    renderFibonacci(fibonacciTimer);
    renderFibSummary();      // populate with current exercise lists
    setFibSummaryOpen(false); // always start collapsed
  }
});
pauseBtn.addEventListener("click", () => fibonacciTimer.pause());
resetBtn.addEventListener("click", () => fibonacciResetUi());

tabStartBtn.addEventListener("click", () => {
  primeAudio();
  tabataTimer.start();
});
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

// NOTE: la secuencia de arranque vive en bootstrap(), al final del archivo.
// No agregues llamadas de inicialización sueltas acá: este archivo es un script
// clásico y cualquier invocación que se ejecute antes de una `const`/`let`
// declarada más abajo tira ReferenceError por TDZ y aborta el resto del script.

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

/** Returns { "YYYY-MM-DD": { date, core[], bodyweight[], overload[] } } */
function groupByDay(workouts) {
  const map = {};
  workouts.forEach((w) => {
    const d = new Date(w.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!map[key]) map[key] = { date: d, core: [], bodyweight: [], overload: [] };
    map[key].core.push(...(w.core || []));
    map[key].bodyweight.push(...(w.bodyweight || []));
    map[key].overload.push(...(w.overload || []));
  });
  return map;
}

function dashFormatDayHeader(d) {
  const day   = d.toLocaleDateString("en-US", { weekday: "short" });
  const month = d.toLocaleDateString("en-US", { month: "short" });
  return `${day} ${d.getDate()} ${month}`;
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
  const res = await fetch(`${API_BASE_URL}/api/workouts?limit=100`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return Array.isArray(body) ? body : (body.workouts ?? []);
}

// ── Dashboard cache (localStorage) ──────────────────────────────────────────

const DASH_CACHE_KEY = "dashCache_v1";
const DASH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function readDashCache() {
  try {
    const raw = localStorage.getItem(DASH_CACHE_KEY);
    if (!raw) return null;
    const { workouts, ts } = JSON.parse(raw);
    if (!Array.isArray(workouts)) return null;
    return { workouts, stale: Date.now() - ts > DASH_CACHE_TTL };
  } catch {
    return null;
  }
}

function writeDashCache(workouts) {
  try {
    localStorage.setItem(DASH_CACHE_KEY, JSON.stringify({ workouts, ts: Date.now() }));
  } catch { /* storage full / private mode */ }
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
  const wrapper     = document.querySelector(".dash-wrapper");
  const cards       = document.getElementById("dashCards");
  const historyList = document.getElementById("dashHistoryList");
  const msg         = document.getElementById("dashMessage");

  // Remove loading state
  if (wrapper) wrapper.classList.remove("dash-loading");

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

  setDashText("dashMonthCount",  s.thisMonthCount);
  setDashText("dashLastDays",    s.daysSinceLast === 0 ? "Today" : `${s.daysSinceLast}d ago`);

  if (!historyList) return;
  historyList.replaceChildren();

  const byDay = groupByDay(workouts);
  Object.keys(byDay)
    .sort()
    .reverse()
    .forEach((key) => {
      const { date, core, bodyweight, overload } = byDay[key];
      const rows = Math.max(core.length, bodyweight.length, overload.length, 1);

      const li = document.createElement("li");
      li.className = "dash-history__item";

      const dateEl = document.createElement("span");
      dateEl.className = "dash-history__date";
      dateEl.textContent = dashFormatDayHeader(date);

      const table = document.createElement("table");
      table.className = "dash-day-table";

      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      ["Core", "BD", "OV"].forEach((label) => {
        const th = document.createElement("th");
        th.textContent = label;
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);

      const tbody = document.createElement("tbody");
      for (let i = 0; i < rows; i++) {
        const tr = document.createElement("tr");
        // textContent, no innerHTML: los nombres de ejercicio son input del usuario
        [core[i], bodyweight[i], overload[i]].forEach((name) => {
          const td = document.createElement("td");
          td.textContent = name || "";
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      }

      table.append(thead, tbody);
      li.append(dateEl, table);
      historyList.appendChild(li);
    });
}

function setDashLoadingState() {
  const wrapper = document.querySelector(".dash-wrapper");
  if (wrapper) wrapper.classList.add("dash-loading");

  ["dashMonthCount", "dashLastDays"].forEach((id) => setDashText(id, "—"));

  // Skeleton placeholder cards in the history list
  const list = document.getElementById("dashHistoryList");
  if (list) {
    list.replaceChildren();
    for (let i = 0; i < 3; i++) {
      const li = document.createElement("li");
      li.className = "dash-skeleton-item";
      list.appendChild(li);
    }
  }
}

// ── Load: cache-first, then refresh in background ────────────────────────────

async function loadDashboard() {
  const msg = document.getElementById("dashMessage");
  if (msg) msg.hidden = true;

  const cached = readDashCache();

  if (cached) {
    // Show cached data instantly — no loading state shown to the user
    renderDashboard(cached.workouts);
    if (!cached.stale) return; // cache is fresh — skip network trip
    // Stale cache: data is already visible, refresh silently in background
  } else {
    // First ever load — show skeleton animation while we wait
    setDashLoadingState();
  }

  try {
    const workouts = await fetchAllWorkouts();
    writeDashCache(workouts);
    renderDashboard(workouts);
  } catch (err) {
    console.warn("[Dashboard] fetch failed:", err.message);
    if (cached) return; // cached data is still showing — no need to show an error
    // No cache and network failed — show error
    const wrapper = document.querySelector(".dash-wrapper");
    if (wrapper) wrapper.classList.remove("dash-loading");
    if (msg) {
      msg.textContent = "Could not load data — server may be offline.";
      msg.className   = "dash-message dash-message--error";
      msg.hidden      = false;
    }
  }
}

// ===========================================================================
// EXERCISE AUTOCOMPLETE (timer view input fields)
// ===========================================================================

let _exerciseNameCache = null;

async function getExerciseNames() {
  if (_exerciseNameCache) return _exerciseNameCache;
  try {
    const res = await fetch(`${API_BASE_URL}/api/exercises`);
    if (!res.ok) return [];
    const data = await res.json();
    _exerciseNameCache = data.map((e) => e.name); // already lowercase, sorted by lastPerformed
    return _exerciseNameCache;
  } catch {
    return [];
  }
}

function updateExerciseCacheWith(text) {
  const lower = text.trim().toLowerCase();
  if (!lower || !_exerciseNameCache) return;
  if (!_exerciseNameCache.includes(lower)) {
    _exerciseNameCache.unshift(lower); // prepend — newly added ranks first
  }
}

function createAutocomplete(input, type) {
  const dropdown = document.createElement("ul");
  dropdown.className = "ex-autocomplete";
  dropdown.hidden = true;
  input.parentElement.appendChild(dropdown);

  let activeIndex = -1;
  let lastQuery = "";

  function getItems() {
    return dropdown.querySelectorAll(".ex-autocomplete__item");
  }

  function buildItem(name, q) {
    const li = document.createElement("li");
    li.className = "ex-autocomplete__item";
    if (q) {
      const idx = name.indexOf(q);
      if (idx !== -1) {
        li.appendChild(document.createTextNode(name.slice(0, idx)));
        const mark = document.createElement("mark");
        mark.className = "ex-match";
        mark.textContent = name.slice(idx, idx + q.length);
        li.appendChild(mark);
        li.appendChild(document.createTextNode(name.slice(idx + q.length)));
      } else {
        li.textContent = name;
      }
    } else {
      li.textContent = name;
    }
    li.addEventListener("mousedown", (e) => {
      e.preventDefault(); // keep focus on input
      input.value = name;
      closeDropdown();
      addExercise(type);
    });
    return li;
  }

  function showDropdown(names, q) {
    dropdown.replaceChildren();
    activeIndex = -1;
    if (!names.length) { dropdown.hidden = true; return; }
    names.forEach((name) => dropdown.appendChild(buildItem(name, q)));
    dropdown.hidden = false;
  }

  function closeDropdown() {
    dropdown.hidden = true;
    activeIndex = -1;
  }

  function setActive(index) {
    const items = getItems();
    items.forEach((item, i) => item.classList.toggle("ex-autocomplete__item--active", i === index));
    activeIndex = index;
  }

  async function refresh() {
    const q = input.value.trim().toLowerCase();
    lastQuery = q;
    if (!q) { closeDropdown(); return; }
    const names = await getExerciseNames();
    if (lastQuery !== q) return; // stale — user kept typing
    const matches = names.filter((n) => n.includes(q)).slice(0, 8);
    showDropdown(matches, q);
  }

  input.addEventListener("input", refresh);

  input.addEventListener("keydown", (e) => {
    const items = getItems();
    if (dropdown.hidden) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      e.stopImmediatePropagation(); // prevent the existing Enter→addExercise handler
      input.value = items[activeIndex].textContent;
      closeDropdown();
      addExercise(type);
    } else if (e.key === "Escape") {
      closeDropdown();
    }
  });

  input.addEventListener("blur", () => setTimeout(closeDropdown, 150));

  input.addEventListener("focus", refresh);
}

function initExerciseAutocomplete() {
  FIB_BLOCK_TYPES.forEach((type) => {
    const input = fibInputByType[type];
    if (input) createAutocomplete(input, type);
  });
}

// ===========================================================================
// EXERCISES VIEW
// ===========================================================================

let _allExercises = [];
let _exSortKey = "lastPerformed";
let _exSortDir = "desc";

// Modalidad = bloque en el que se carga el ejercicio. Mismo orden que el timer.
const EX_MODALIDADES = [
  { value: "core",       label: "Core"    },
  { value: "bodyweight", label: "Body"    },
  { value: "overload",   label: "Over"    },
];
const EX_MODALIDAD_RANK = { core: 1, bodyweight: 2, overload: 3 };

function exFormatDate(isoStr) {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function sortExercises(list) {
  return [...list].sort((a, b) => {
    if (_exSortKey === "name") {
      return _exSortDir === "asc"
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name);
    }
    let va, vb;
    if (_exSortKey === "lastPerformed") {
      va = a.lastPerformed ? new Date(a.lastPerformed).getTime() : 0;
      vb = b.lastPerformed ? new Date(b.lastPerformed).getTime() : 0;
    } else if (_exSortKey === "modalidad") {
      // Sin clasificar siempre al final, sea cual sea la dirección.
      va = EX_MODALIDAD_RANK[a.modalidad] ?? 0;
      vb = EX_MODALIDAD_RANK[b.modalidad] ?? 0;
      if (!va && !vb) return a.name.localeCompare(b.name);
      if (!va) return 1;
      if (!vb) return -1;
      if (va === vb) return a.name.localeCompare(b.name);
    } else {
      va = a.daysPerformed ?? 0;
      vb = b.daysPerformed ?? 0;
    }
    return _exSortDir === "asc" ? va - vb : vb - va;
  });
}

/** Persist a manual modalidad change. Optimista: revierte si el PATCH falla. */
async function updateExerciseModalidad(name, modalidad, select) {
  const record = _allExercises.find((e) => e.name === name);
  const previous = record ? record.modalidad ?? "" : "";
  if (record) record.modalidad = modalidad || null;
  select.classList.toggle("ex-mod-select--empty", !modalidad);
  select.disabled = true;

  const msg = document.getElementById("exMessage");
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/exercises/${encodeURIComponent(name)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modalidad: modalidad || null }),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (msg) msg.hidden = true;
  } catch (err) {
    console.warn("[Exercises] modalidad update failed:", err.message);
    if (record) record.modalidad = previous || null;
    select.value = previous;
    select.classList.toggle("ex-mod-select--empty", !previous);
    if (msg) {
      msg.textContent = `Could not save modality for "${name}".`;
      msg.className   = "dash-message dash-message--error";
      msg.hidden      = false;
    }
  } finally {
    select.disabled = false;
  }
}

function exModalidadCell(exercise) {
  const td = document.createElement("td");
  td.className = "ex-td ex-td--mod";

  const select = document.createElement("select");
  select.className = "ex-mod-select";
  select.setAttribute("aria-label", `Modality for ${exercise.name}`);

  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "—";
  select.appendChild(blank);

  EX_MODALIDADES.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  });

  const current = exercise.modalidad || "";
  select.value = current;
  select.classList.toggle("ex-mod-select--empty", !current);
  select.addEventListener("change", () =>
    updateExerciseModalidad(exercise.name, select.value, select)
  );

  td.appendChild(select);
  return td;
}

function exArrow(key) {
  if (_exSortKey !== key) return '<span class="ex-arrow">↕</span>';
  return `<span class="ex-arrow">${_exSortDir === "asc" ? "↑" : "↓"}</span>`;
}

function renderExercises(exercises) {
  const list    = document.getElementById("exList");
  const msg     = document.getElementById("exMessage");
  const counter = document.getElementById("exCount");

  if (!list) return;
  list.replaceChildren();

  if (!exercises.length && _allExercises.length) {
    if (msg) { msg.textContent = "No exercises match your search."; msg.hidden = false; }
    if (counter) counter.textContent = "";
    return;
  }

  if (msg) msg.hidden = true;
  if (counter) counter.textContent = `${_allExercises.length} total`;

  const sorted = sortExercises(exercises);

  const wrap = document.createElement("div");
  wrap.className = "ex-table-wrap";

  const table = document.createElement("table");
  table.className = "ex-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  const cols = [
    { key: "name",          label: "Exercise" },
    { key: "modalidad",     label: "Modality" },
    { key: "lastPerformed", label: "Last"     },
    { key: "daysPerformed", label: "Days"     },
  ];

  cols.forEach(({ key, label }) => {
    const th = document.createElement("th");
    th.className = "ex-th" + (_exSortKey === key ? " ex-th--active" : "");
    th.innerHTML = `${label}${exArrow(key)}`;
    th.addEventListener("click", () => {
      if (_exSortKey === key) {
        _exSortDir = _exSortDir === "asc" ? "desc" : "asc";
      } else {
        _exSortKey = key;
        _exSortDir = key === "name" || key === "modalidad" ? "asc" : "desc";
      }
      const q = document.getElementById("exSearch")?.value.trim().toLowerCase() || "";
      renderExercises(q ? _allExercises.filter((e) => e.name.includes(q)) : _allExercises);
    });
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  sorted.forEach((exercise) => {
    const { name, lastPerformed, daysPerformed } = exercise;
    const tr = document.createElement("tr");

    // textContent, no innerHTML: `name` es input del usuario
    const nameTd = document.createElement("td");
    nameTd.className = "ex-td ex-td--name";
    nameTd.textContent = name;
    tr.appendChild(nameTd);

    tr.appendChild(exModalidadCell(exercise));

    [
      ["ex-td ex-td--date", exFormatDate(lastPerformed)],
      ["ex-td ex-td--days", String(daysPerformed ?? 0)],
    ].forEach(([cls, value]) => {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = value;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
  list.appendChild(wrap);
}

function setExercisesLoadingState() {
  const list    = document.getElementById("exList");
  const counter = document.getElementById("exCount");
  if (counter) counter.textContent = "";
  if (!list) return;
  list.replaceChildren();

  const wrap = document.createElement("div");
  wrap.className = "ex-table-wrap";
  const table = document.createElement("table");
  table.className = "ex-table";
  const tbody = document.createElement("tbody");
  [100, 140, 80, 120, 95, 110].forEach((w) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="ex-td"><span class="ex-sk-cell" style="width:${w}px"></span></td>
      <td class="ex-td"><span class="ex-sk-cell" style="width:52px"></span></td>
      <td class="ex-td"><span class="ex-sk-cell" style="width:44px"></span></td>
      <td class="ex-td ex-td--days"><span class="ex-sk-cell" style="width:22px"></span></td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  list.appendChild(wrap);
}

async function loadExercises() {
  const msg    = document.getElementById("exMessage");
  const search = document.getElementById("exSearch");
  if (msg) msg.hidden = true;
  if (search) search.value = "";

  setExercisesLoadingState();

  try {
    const res = await fetch(`${API_BASE_URL}/api/exercises`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _allExercises = await res.json();
    renderExercises(_allExercises);
  } catch (err) {
    console.warn("[Exercises] fetch failed:", err.message);
    const list = document.getElementById("exList");
    if (list) list.replaceChildren();
    if (msg) {
      msg.textContent = "Could not load exercises — server may be offline.";
      msg.className   = "dash-message dash-message--error";
      msg.hidden      = false;
    }
  }
}

function initExercisesSearch() {
  const input = document.getElementById("exSearch");
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    renderExercises(q ? _allExercises.filter((e) => e.name.includes(q)) : _allExercises);
  });
}

// ── View router ───────────────────────────────────────────────────────────────

function showView(name) {
  document.querySelectorAll(".app-view").forEach((el) => {
    el.hidden = el.id !== `view-${name}`;
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("nav-btn--active", btn.dataset.view === name);
  });
  if (name === "dashboard") loadDashboard();
  if (name === "exercises")  loadExercises();
}

function initNavigation() {
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest(".nav-btn");
    if (btn?.dataset?.view) showView(btn.dataset.view);
  });
}

// ===========================================================================
// REDESIGN — Ring timer, Tabata modal, session plan summary, steppers
// ===========================================================================

// ── SVG ring — Fibonacci ──────────────────────────────────────────────────

const FIB_RING_C = 2 * Math.PI * 116; // matches r=116 in SVG

/**
 * Pinta el anillo con un gradiente.
 *
 * OJO: tiene que ser `style.stroke` (estilo inline) y NO `setAttribute("stroke")`.
 * Los atributos de presentación de SVG tienen menos prioridad que cualquier regla
 * CSS, y `.ring-progress` define `stroke: url(#ringGradWork)` en la hoja de estilos.
 * Con setAttribute el anillo se quedaba clavado en el gradiente de work y nunca
 * cambiaba de color al pasar a rest.
 */
function paintRing(ring, gradientId, glow) {
  ring.style.stroke = `url(#${gradientId})`;
  ring.style.filter = glow || "";
}

function updateFibRing(timer) {
  const ring = document.getElementById("fibRingProgress");
  if (!ring) return;

  if (timer.isComplete()) {
    ring.style.strokeDashoffset = "0";
    paintRing(ring, "ringGradDone", "drop-shadow(0 0 12px rgba(123,127,186,.5))");
    return;
  }

  if (isFibIdleBeforeStart(timer)) {
    ring.style.strokeDashoffset = FIB_RING_C;
    paintRing(ring, "ringGradWork", "");
    return;
  }

  const current = timer.sequence[timer.currentIndex];
  const phaseTotalMs = current.durationSec * 1000;
  const phaseElapsedMs = phaseTotalMs - timer.remainingMs;
  const pct = Math.min(1, Math.max(0, phaseElapsedMs / phaseTotalMs));

  ring.style.strokeDashoffset = FIB_RING_C * (1 - pct);

  if (current.type === "work") {
    paintRing(ring, "ringGradWork", "drop-shadow(0 0 14px rgba(44,207,180,.5))");   // verde
  } else {
    paintRing(ring, "ringGradRest", "drop-shadow(0 0 14px rgba(255,106,44,.4))");   // naranja
  }
}

// ── SVG ring — Tabata ────────────────────────────────────────────────────

const TAB_RING_C = 2 * Math.PI * 84; // matches r=84 in SVG

function updateTabataRing(timer) {
  const ring = document.getElementById("tabRingProgress");
  if (!ring) return;

  if (timer.isComplete()) {
    ring.style.strokeDashoffset = "0";
    paintRing(ring, "ringGradDone", "drop-shadow(0 0 10px rgba(123,127,186,.45))");
    return;
  }

  if (isTabataIdleBeforeStart(timer)) {
    ring.style.strokeDashoffset = TAB_RING_C;
    paintRing(ring, "ringGradWork", "");
    return;
  }

  const current = timer.sequence[timer.currentIndex];
  const phaseTotalMs = current.durationSec * 1000;
  const phaseElapsedMs = phaseTotalMs - timer.remainingMs;
  const pct = Math.min(1, Math.max(0, phaseElapsedMs / phaseTotalMs));

  ring.style.strokeDashoffset = TAB_RING_C * (1 - pct);
  if (current.type === "work") {
    paintRing(ring, "ringGradWork", "drop-shadow(0 0 10px rgba(44,207,180,.45))");   // verde
  } else {
    paintRing(ring, "ringGradRest", "drop-shadow(0 0 10px rgba(255,106,44,.35))");   // naranja
  }
}

// ── Tabata running display (hide config, show ring) ──────────────────────

function updateTabataRunningDisplay(isRunning) {
  const config  = document.getElementById("tabataConfig");
  const running = document.getElementById("tabataRunningDisplay");
  if (config)  config.hidden  =  isRunning;
  if (running) running.hidden = !isRunning;
}

// ── Tabata pill state ────────────────────────────────────────────────────

function updateTabataPill(timer) {
  const pill = document.getElementById("tabataPill");
  if (!pill) return;

  if (timer.isComplete()) {
    pill.textContent = "⏱ Tabata — Done";
    pill.className = "tabata-pill tabata-pill--done";
    return;
  }

  if (isTabataIdleBeforeStart(timer)) {
    pill.textContent = "⏱ Tabata";
    pill.className = "tabata-pill";
    return;
  }

  const current = timer.sequence[timer.currentIndex];
  const phase = current.type === "work" ? "WORK" : "REST";
  const time  = formatTime(Math.ceil(timer.remainingMs / 1000));
  const round = tabataRoundFromIndex(timer.currentIndex, tabataMeta.rounds);
  pill.textContent = `TABATA · ${phase} · ${time} · R${round}/${tabataMeta.rounds}`;
  pill.className = `tabata-pill tabata-pill--running-${current.type}`;
}

// ── Fibonacci time mirror in Tabata modal top bar ────────────────────────

function updateTabataFibTimeMirror() {
  const el = document.getElementById("tabataFibTime");
  if (!el) return;
  if (fibonacciTimer.isComplete()) {
    el.textContent = "done";
    return;
  }
  el.textContent = formatTime(Math.ceil(fibonacciTimer.remainingMs / 1000));
}

// ── Session plan summary bar ─────────────────────────────────────────────

function updateSessionPlanSummary() {
  const el = document.getElementById("sessionPlanSummary");
  if (!el) return;
  const total = FIB_BLOCK_TYPES.reduce((n, t) => n + fibExerciseLists[t].length, 0);
  // Derivado de FIB_SEQUENCE, no hardcodeado: es la duración real de la sesión
  // completa (23 min), que es lo que el usuario va a estar entrenando.
  const mins = Math.round(FIB_TOTAL_SEC / 60);
  el.textContent = `${total} EXERCISE${total !== 1 ? "S" : ""} · ${mins} MIN`;
}

// ── Tabata total time display ────────────────────────────────────────────

function updateTabataTotalTime() {
  const el = document.getElementById("tabTotalTime");
  if (!el) return;
  const work   = parseInt(tabWork.value,   10) || 20;
  const rest   = parseInt(tabRest.value,   10) || 10;
  const rounds = parseInt(tabRounds.value, 10) || 6;
  const total  = rounds * (work + rest);
  const min    = Math.floor(total / 60);
  const sec    = total % 60;
  const tStr   = sec > 0 ? `${min}:${String(sec).padStart(2, "0")}` : `${min}:00`;
  el.textContent = `${tStr} · ${rounds} × ${work + rest}s`;
}

// ── Tabata stepper buttons ───────────────────────────────────────────────

function initTabataSteppers() {
  [
    ["tabWorkDec",   "tabWorkInc",   "tabWork"],
    ["tabRestDec",   "tabRestInc",   "tabRest"],
    ["tabRoundsDec", "tabRoundsInc", "tabRounds"],
  ].forEach(([decId, incId, inputId]) => {
    const dec   = document.getElementById(decId);
    const inc   = document.getElementById(incId);
    const input = document.getElementById(inputId);
    if (!dec || !inc || !input) return;

    dec.addEventListener("click", () => {
      const v = parseInt(input.value, 10);
      if (v > parseInt(input.min, 10)) {
        input.value = v - 1;
        onTabataConfigChange();
        updateTabataTotalTime();
      }
    });
    inc.addEventListener("click", () => {
      const v = parseInt(input.value, 10);
      if (v < parseInt(input.max, 10)) {
        input.value = v + 1;
        onTabataConfigChange();
        updateTabataTotalTime();
      }
    });
  });

  // Also update total time when typing directly
  [tabWork, tabRest, tabRounds].forEach((input) => {
    if (input) input.addEventListener("input", updateTabataTotalTime);
  });
}

// ── Tabata modal open / close ────────────────────────────────────────────

function openTabataModal() {
  const modal = document.getElementById("tabataModal");
  if (modal) modal.hidden = false;
}

function closeTabataModal() {
  const modal = document.getElementById("tabataModal");
  if (modal) modal.hidden = true;
}

function initTabataModal() {
  const pill     = document.getElementById("tabataPill");
  const minimize = document.getElementById("tabataMinimize");
  const scrim    = document.getElementById("tabataScrim");

  if (pill)     pill.addEventListener("click", openTabataModal);
  if (minimize) minimize.addEventListener("click", closeTabataModal);
  if (scrim)    scrim.addEventListener("click", closeTabataModal);
}

/**
 * Reload the page whenever a new service worker takes control so users
 * always run the latest cached script without a manual refresh.
 */
function initServiceWorkerAutoReload() {
  if (!("serviceWorker" in navigator)) return;

  // Si la página cargó SIN controller, el primer `controllerchange` es
  // simplemente el service worker tomando control por `clients.claim()` — no es
  // una actualización. Recargar ahí genera un loop: reload → sin controller →
  // claim → controllerchange → reload → …
  if (!navigator.serviceWorker.controller) return;

  let alreadyReloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (alreadyReloaded) return; // el evento puede dispararse más de una vez
    alreadyReloaded = true;
    window.location.reload();
  });
}

// ===========================================================================
// BOOTSTRAP — único punto de arranque
// ===========================================================================
//
// Todas las invocaciones top-level viven acá, después de que TODAS las
// declaraciones del archivo fueron evaluadas. Las `function` se hoistean, pero
// las `const`/`let` no: llamar a una función que lee una `const` declarada más
// abajo tira "Cannot access X before initialization" y aborta el script entero
// silenciosamente. Mantener este bloque al final es lo que lo previene.

function bootstrap() {
  // 1. Wiring de eventos (no depende de estado)
  registerServiceWorker();
  initServiceWorkerAutoReload();
  initExerciseAutocomplete();  // DEBE ir antes de initFibExerciseListsUi:
  initFibExerciseListsUi();    // el handler de Enter del autocomplete usa
                               // stopImmediatePropagation() para ganarle al de addExercise
  initTabataSteppers();
  initTabataModal();
  initNavigation();
  initExercisesSearch();

  // 2. Primer render
  fibonacciResetUi();
  tabataTimer.reset();
  updateTabataTotalTime();
  updateSessionPlanSummary();

  // 3. Sync remoto (async) — la DB es autoritativa sobre el plan local,
  //    y su camino de éxito dispara el flush de workouts pendientes.
  loadCurrentWorkoutFromDB();
}

bootstrap();
