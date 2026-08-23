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
 * Suma un ejercicio al plan de la sesión: estado en memoria, localStorage, DB,
 * y refresca todo lo que lo muestra. Compartido por el input del Timer y por
 * el click en una fila de la pestaña List.
 * @param {string} name
 * @param {"core"|"bodyweight"|"overload"} type
 * @returns {boolean} si se agregó
 */
function addExerciseToPlan(name, type) {
  if (!FIB_BLOCK_TYPES.includes(type)) return false;
  const text = String(name).trim();
  if (!text) return false;

  const idx = fibExerciseLists[type].length;
  fibExerciseLists[type].push(text);
  fibExerciseDbIds[type].push(null); // filled after async POST response

  persistFibExerciseLists();
  renderExerciseList(type);
  refreshFibWorkoutExerciseDisplay();
  updateSessionPlanSummary();
  updateExerciseCacheWith(text);

  postExerciseToCurrentWorkout(text, type).then((id) => {
    if (id) fibExerciseDbIds[type][idx] = id;
  });
  return true;
}

/**
 * @param {"core"|"bodyweight"|"overload"} type
 */
function addExercise(type) {
  const input = fibInputByType[type];
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  if (addExerciseToPlan(text, type)) input.value = "";
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
    handleFibonacciComplete();
  },
});

function fibonacciResetUi() {
  fibonacciWorkoutEndAtMs = null;
  fibonacciTimer.reset();
}

/* ── Recomendación por balance de patrones ────────────────────────────────
 *
 * Un GET a /api/analytics/recommendation y sus ejercicios pintados como filas
 * clickeables. Cada fila usa addExerciseFromList(), la misma función que las
 * filas de la pestaña List: chequea duplicados, resuelve el bloque por
 * modalidad, postea a la DB y muestra el toast. Acá no se replica nada de eso.
 *
 * El endpoint es determinístico: dos clicks seguidos devuelven lo mismo. Por eso
 * cada slot muestra también sus alternativas — es la única variedad disponible
 * sin meterle azar al motor, que lo volvería imposible de auditar.
 */

const REC_PATRON_LABEL = {
  empuje: "Push",
  traccion: "Pull",
  rodilla_dominante: "Knee",
  cadera_dominante: "Hip",
  core: "Core",
};

let _recCargando = false;
let _recColapsado = false;

/** Una línea con lo esencial: qué patrones toca y cuántos ejercicios propone. */
function recResumenLinea(data) {
  const core = data.recomendacion?.core || [];
  const trabajo = data.recomendacion?.trabajo || [];
  const total = core.length + trabajo.length;
  if (!total) return "No suggestions";

  const patrones = [...new Set(trabajo.map((s) => s.patron))].map(recLabel);
  const cuenta = `${total} exercise${total > 1 ? "s" : ""}`;
  return patrones.length ? `${patrones.join(" + ")} · ${cuenta}` : cuenta;
}

/** Colapsa el panel a su cabecera, o lo vuelve a abrir. */
function recSetColapsado(colapsado) {
  _recColapsado = colapsado;
  const box = document.getElementById("recResult");
  if (!box) return;

  box.classList.toggle("rec-result--collapsed", colapsado);
  const body = box.querySelector(".rec-body");
  if (body) body.hidden = colapsado;
  const toggle = box.querySelector(".rec-head__toggle");
  if (toggle) toggle.setAttribute("aria-expanded", String(!colapsado));
}

/** Cierra el panel y deja el botón como estaba. */
function recCerrar() {
  const box = document.getElementById("recResult");
  if (box) {
    box.replaceChildren();
    box.hidden = true;
    box.classList.remove("rec-result--collapsed");
  }
  _recColapsado = false;
  const btn = document.getElementById("suggestPlanBtn");
  if (btn) btn.setAttribute("aria-expanded", "false");
}

/**
 * Cabecera del panel: el resumen de una línea, el toggle de colapso y el cierre.
 * Es lo único que queda visible cuando está colapsado, así que el resumen tiene
 * que bastar para saber qué hay abajo sin abrirlo.
 */
function recHeader(resumen, { colapsable = true } = {}) {
  const head = document.createElement("div");
  head.className = "rec-head";

  if (colapsable) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "rec-head__toggle";
    toggle.setAttribute("aria-expanded", String(!_recColapsado));
    toggle.setAttribute("aria-controls", "recBody");

    const chevron = document.createElement("span");
    chevron.className = "rec-head__chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "\u25BE";
    toggle.appendChild(chevron);

    const texto = document.createElement("span");
    texto.className = "rec-head__summary";
    texto.textContent = resumen;
    toggle.appendChild(texto);

    toggle.addEventListener("click", () => recSetColapsado(!_recColapsado));
    head.appendChild(toggle);
  } else {
    const texto = document.createElement("span");
    texto.className = "rec-head__summary rec-head__summary--static";
    texto.textContent = resumen;
    head.appendChild(texto);
  }

  const cerrar = document.createElement("button");
  cerrar.type = "button";
  cerrar.className = "rec-head__close";
  cerrar.setAttribute("aria-label", "Dismiss suggestion");
  cerrar.textContent = "\u00D7";
  cerrar.addEventListener("click", recCerrar);
  head.appendChild(cerrar);

  return head;
}

/** "NEW" para los que nunca hiciste, "45D" para el resto. */
function recMetaLabel(esNuevo, daysSinceLast) {
  if (esNuevo) return "NEW";
  if (daysSinceLast === null || daysSinceLast === undefined) return "";
  if (daysSinceLast === 0) return "TODAY";
  return `${daysSinceLast}D`;
}

/**
 * Una fila clickeable. `bloque` es la modalidad: el motor filtra los candidatos
 * por `modalidad === bloque`, así que son lo mismo y no hace falta ir al catálogo.
 */
function recRow({ name, bloque, patron, esNuevo, daysSinceLast, esAlternativa }) {
  const row = document.createElement("div");
  row.className = "rec-row" + (esAlternativa ? " rec-row--alt" : "");
  row.setAttribute("role", "button");
  row.tabIndex = 0;
  row.setAttribute("aria-label", `Add ${name} to ${bloque}`);

  const nameEl = document.createElement("span");
  nameEl.className = "rec-row__name";
  nameEl.textContent = name; // textContent, no innerHTML: es input del usuario
  row.appendChild(nameEl);

  if (patron) {
    const chip = document.createElement("span");
    chip.className = "rec-row__patron";
    chip.textContent = REC_PATRON_LABEL[patron] || patron;
    row.appendChild(chip);
  }

  const meta = recMetaLabel(esNuevo, daysSinceLast);
  if (meta) {
    const metaEl = document.createElement("span");
    metaEl.className = "rec-row__meta" + (esNuevo ? " rec-row__meta--new" : "");
    metaEl.textContent = meta;
    row.appendChild(metaEl);
  }

  const add = () => addExerciseFromList({ name, modalidad: bloque }, row);
  row.addEventListener("click", add);
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      add();
    }
  });

  return row;
}

const recPct = (n) => `${Math.round((n || 0) * 100)}%`;
const recLabel = (p) => REC_PATRON_LABEL[p] || p;

/** "Hip and Pull" / "Hip, Pull and Push" — enumeración con "and" al final. */
function recEnumerar(items) {
  if (items.length <= 1) return items[0] || "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * El porqué en prosa. Sin esto el botón es una caja negra: se ve QUÉ propone
 * pero no CONTRA QUÉ, que es lo único que hace que valga la pena confiarle la
 * sesión. Cada frase sale de `balanceActual` y `contexto`, no hay nada
 * calculado de nuevo acá.
 */
function recNarrativa(data) {
  const balance = data.balanceActual || [];
  const trabajo = data.recomendacion?.trabajo || [];
  const ctx = data.contexto || {};
  if (!balance.length || !trabajo.length) return [];

  const porPatron = new Map(balance.map((b) => [b.patron, b]));
  const sesiones = ctx.sesionesEnVentana ?? 0;
  const objetivo = recPct(balance[0]?.target ?? 0.25);
  const frases = [];

  // Slots que se llevó cada patrón, en el orden en que los asignó el motor.
  const slotsPorPatron = new Map();
  trabajo.forEach((s) => slotsPorPatron.set(s.patron, (slotsPorPatron.get(s.patron) || 0) + 1));

  // 1. Contra qué se está corrigiendo: el patrón que más espacio ocupa.
  const masAlto = [...balance].sort((a, b) => b.share - a.share)[0];
  if (masAlto && masAlto.share > masAlto.target) {
    const afuera = !slotsPorPatron.has(masAlto.patron);
    frases.push(
      `${recLabel(masAlto.patron)} leads your last ${sesiones} sessions at ${recPct(masAlto.share)} against a ${objetivo} target` +
        (afuera ? `, so it sits this one out.` : `, so it only gets what's left.`)
    );
  }

  // 2. Qué entra y por qué. El déficit es lo que ordena el reparto.
  const entran = [...slotsPorPatron.entries()].map(([patron, n]) => {
    const b = porPatron.get(patron) || {};
    return `${recLabel(patron)} at ${recPct(b.share)} (${n} slot${n > 1 ? "s" : ""})`;
  });
  if (entran.length) {
    // La coletilla sólo se puede afirmar si TODOS los que entran están debajo
    // del objetivo. Cuando la sesión cubre los 4 patrones — lo normal al volver
    // de un parate — alguno está por arriba y decir "furthest below target"
    // sería mentira.
    const todosEnDeficit = [...slotsPorPatron.keys()].every(
      (patron) => (porPatron.get(patron)?.deficit ?? 0) > 0
    );
    const cubreTodo = slotsPorPatron.size >= balance.length;

    let cola = "";
    if (cubreTodo) cola = ` — the whole board in one session.`;
    else if (todosEnDeficit) cola = entran.length === 1 ? ` — the furthest below target.` : ` — the ones furthest below target.`;
    else cola = `.`;

    frases.push(`Today goes to ${recEnumerar(entran)}${cola}`);
  }

  // 3. El correctivo, que se apaga solo al llegar al objetivo.
  const conCorrectivo = [...new Set(
    trabajo.filter((s) => s.porQue?.correctivoAplicado).map((s) => s.patron)
  )];
  if (conCorrectivo.length) {
    frases.push(
      `${recEnumerar(conCorrectivo.map(recLabel))} also carries an extra push that switches itself off once it reaches ${objetivo}.`
    );
  }

  // 4. Descanso. Tras un parate la frescura deja de discriminar y decide el
  //    balance solo — vale decirlo, porque cambia qué está mirando el motor.
  const dias = ctx.diasDesdeUltimoEntrenamiento;
  if (ctx.vueltaDeParate && dias !== null && dias !== undefined) {
    frases.push(`It's been ${dias} days since you trained, so everything is rested — this is balance alone, not recovery.`);
  }

  // 5. Novedad.
  if (ctx.cupoNovedadUsado > 0) {
    frases.push(
      ctx.cupoNovedadUsado === 1
        ? `One of these you've never done.`
        : `${ctx.cupoNovedadUsado} of these you've never done.`
    );
  }

  return frases;
}

/**
 * El balance en barras: cada patrón contra el objetivo del 25%. Es la misma
 * información que la prosa, pero de un vistazo se ve cuánto falta y para dónde.
 */
function recBalanceChart(data) {
  const balance = [...(data.balanceActual || [])].sort((a, b) => b.share - a.share);
  if (!balance.length) return null;

  const trabajo = data.recomendacion?.trabajo || [];
  const enSesion = new Set(trabajo.map((s) => s.patron));
  const objetivo = balance[0]?.target ?? 0.25;

  // Escala común para las 4 barras, con aire arriba para que la más larga no
  // toque el borde y el tick del objetivo quede siempre adentro.
  const escala = Math.max(...balance.map((b) => b.share || 0), objetivo) * 1.12 || 1;

  const wrap = document.createElement("div");
  wrap.className = "rec-balance";

  balance.forEach((b) => {
    const fila = document.createElement("div");
    fila.className = "rec-bal" + (enSesion.has(b.patron) ? " rec-bal--in" : "");

    const name = document.createElement("span");
    name.className = "rec-bal__name";
    name.textContent = recLabel(b.patron);
    fila.appendChild(name);

    const track = document.createElement("span");
    track.className = "rec-bal__track";

    const fill = document.createElement("span");
    fill.className = "rec-bal__fill";
    fill.style.width = `${((b.share || 0) / escala) * 100}%`;
    track.appendChild(fill);

    const tick = document.createElement("span");
    tick.className = "rec-bal__target";
    tick.style.left = `${(objetivo / escala) * 100}%`;
    tick.setAttribute("title", `Target ${recPct(objetivo)}`);
    track.appendChild(tick);

    fila.appendChild(track);

    const val = document.createElement("span");
    val.className = "rec-bal__pct";
    val.textContent = recPct(b.share);
    fila.appendChild(val);

    wrap.appendChild(fila);
  });

  const pie = document.createElement("p");
  pie.className = "rec-balance__foot";
  pie.textContent = `Share of the last ${data.contexto?.sesionesEnVentana ?? 0} sessions · the line marks the ${recPct(objetivo)} target`;
  wrap.appendChild(pie);

  return wrap;
}

/** Pinta el resultado: la línea de criterio y las filas agrupadas por bloque. */
function renderRecommendation(data) {
  const box = document.getElementById("recResult");
  if (!box) return;

  box.replaceChildren();
  box.hidden = false;
  // Sincronizar la clase con el estado: si se re-renderiza después de haber
  // colapsado, la clase quedaría pegada y la flecha apuntaría de costado con el
  // panel abierto.
  box.classList.toggle("rec-result--collapsed", _recColapsado);
  box.appendChild(recHeader(recResumenLinea(data)));

  // Todo lo que no sea la cabecera vive acá adentro: colapsar es esconder este
  // div, no re-renderizar, así que abrir y cerrar no vuelve a pegarle al server
  // ni pierde el scroll.
  const body = document.createElement("div");
  body.className = "rec-body";
  body.id = "recBody";
  body.hidden = _recColapsado;
  box.appendChild(body);

  const frases = recNarrativa(data);
  if (frases.length) {
    const why = document.createElement("div");
    why.className = "rec-why";
    frases.forEach((texto) => {
      const p = document.createElement("p");
      p.className = "rec-why__line";
      p.textContent = texto;
      why.appendChild(p);
    });
    body.appendChild(why);
  }

  const chart = recBalanceChart(data);
  if (chart) body.appendChild(chart);

  // Avisos que cambian cuánto confiar en la recomendación. Sólo aparecen cuando
  // aplican, así que en el caso normal el panel queda limpio.
  const avisos = [];
  if (data.contexto?.ventanaDegradada) {
    avisos.push("Not much recent history — using older sessions.");
  }
  if (data.contexto?.topePatronRelajado) {
    avisos.push("Not enough exercises to spread the session further.");
  }
  const sinClasificar = data.contexto?.ejerciciosSinClasificar || [];
  if (sinClasificar.length) {
    avisos.push(
      `${sinClasificar.length} exercise${sinClasificar.length > 1 ? "s" : ""} without a pattern ` +
      `(${sinClasificar.slice(0, 3).join(", ")}${sinClasificar.length > 3 ? "…" : ""}) — set it in List to sharpen this.`
    );
  }
  avisos.forEach((texto) => {
    const el = document.createElement("p");
    el.className = "rec-note";
    el.textContent = texto;
    body.appendChild(el);
  });

  const core = data.recomendacion?.core || [];
  const trabajo = data.recomendacion?.trabajo || [];

  if (!core.length && !trabajo.length) {
    const vacio = document.createElement("p");
    vacio.className = "rec-note";
    vacio.textContent = "No suggestions right now — try adding exercises to your catalog.";
    body.appendChild(vacio);
    return;
  }

  // Agrupado por bloque, en el mismo orden que los bloques de abajo. No se
  // asume 1+2+2: si un patrón se queda sin inventario en un bloque, ese slot no
  // viene, y el grupo vacío simplemente no se dibuja.
  const grupos = [
    { bloque: "core", label: "Core", slots: core.map((c) => ({ ...c, bloque: "core" })) },
    { bloque: "bodyweight", label: "Bodyweight", slots: trabajo.filter((s) => s.bloque === "bodyweight") },
    { bloque: "overload", label: "Overload", slots: trabajo.filter((s) => s.bloque === "overload") },
  ];

  // Las alternativas se calculan por slot, así que dos slots del mismo patrón
  // ofrecen la misma banca — y el elegido de un slot suele ser alternativa del
  // anterior. Sin este filtro el panel repite nombres y no se entiende cuál es
  // cuál. Los elegidos siempre se pintan; las alternativas, sólo si son nuevas.
  const yaListados = new Set();
  const clave = (name) => String(name).trim().toLowerCase();

  grupos.forEach(({ bloque, label, slots }) => {
    if (!slots.length) return;

    const head = document.createElement("div");
    head.className = "rec-group";
    head.textContent = label;
    body.appendChild(head);

    slots.forEach((slot) => {
      yaListados.add(clave(slot.ejercicio));
      body.appendChild(
        recRow({
          name: slot.ejercicio,
          bloque,
          patron: slot.patron || (slot.patrones || [])[0],
          esNuevo: slot.esNuevo,
          daysSinceLast: slot.daysSinceLast,
        })
      );
    });

    // Las alternativas van después de los elegidos del bloque, no intercaladas:
    // así los slots de la sesión se leen de corrido y las opciones de recambio
    // quedan juntas abajo.
    slots.forEach((slot) => {
      (slot.alternativas || []).forEach((alt) => {
        if (yaListados.has(clave(alt.name))) return;
        yaListados.add(clave(alt.name));
        body.appendChild(
          recRow({
            name: alt.name,
            bloque,
            patron: null,
            esNuevo: alt.esNuevo,
            daysSinceLast: alt.daysSinceLast,
            esAlternativa: true,
          })
        );
      });
    });
  });
}

/** Muestra un mensaje en el panel sin romper el resto de la pantalla. */
function recShowMessage(texto) {
  const box = document.getElementById("recResult");
  if (!box) return;
  box.replaceChildren();
  box.classList.remove("rec-result--collapsed");
  // Sin colapsar: un mensaje de una línea no tiene nada que esconder, pero sí
  // hay que poder sacárselo de encima.
  box.appendChild(recHeader("Suggestion", { colapsable: false }));
  const p = document.createElement("p");
  p.className = "rec-note rec-note--alone";
  p.textContent = texto;
  box.appendChild(p);
  box.hidden = false;
}

async function fetchRecommendation() {
  const btn = document.getElementById("suggestPlanBtn");
  if (_recCargando) return;

  _recCargando = true;
  // Un pedido nuevo siempre abre expandido: si quedó colapsado de la vez
  // anterior, el resultado nuevo pasaría desapercibido.
  _recColapsado = false;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Thinking…";
    btn.setAttribute("aria-expanded", "true");
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/analytics/recommendation`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderRecommendation(await res.json());
  } catch (err) {
    // Igual que el resto de la app: un fallo de red no rompe la pantalla, el
    // plan se sigue armando a mano.
    console.warn("[recommendation] no se pudo obtener:", err.message);
    recShowMessage("Couldn't load the suggestion. Check your connection and try again.");
  } finally {
    _recCargando = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Suggest session";
    }
  }
}

function initSuggestPlan() {
  const btn = document.getElementById("suggestPlanBtn");
  if (!btn) return;
  btn.addEventListener("click", fetchRecommendation);
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
 * POST a completed workout payload to /api/workouts.
 * Lo dispara el formulario de carga (Guardar o Skip) al terminar el Fibonacci.
 * If the server is unreachable, the payload is queued in localStorage and
 * retried automatically on the next startup once the server is awake.
 */
async function saveCompletedWorkoutToAPI(payload) {
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

// ---------------------------------------------------------------------------
// Formulario de carga post-entrenamiento
// ---------------------------------------------------------------------------
//
// Al terminar el Fibonacci ya no se postea directo: primero se abre un modal
// para cargar reps / peso / vueltas de los bloques bodyweight y overload (la
// lógica AMRAP del entrenamiento). El POST sale una sola vez, con o sin carga,
// cuando el usuario toca "Guardar" o "Skip".
//
// Como el POST queda diferido, el snapshot del entrenamiento se escribe en
// localStorage en el mismo instante en que suena el beep final: si la app se
// cierra con el modal abierto, el entrenamiento se recupera en el próximo
// arranque en vez de perderse.

const PENDING_COMPLETION_KEY = "pendingCompletion_v1";

/** Bloques que se cargan en el formulario. Core queda afuera a propósito. */
const LOG_BLOCKS = [
  { key: "bodyweight", label: "Bodyweight", hasWeight: false },
  { key: "overload",   label: "Overload",   hasWeight: true  },
];

/** Pasadas 12 h el formulario ya no tiene sentido: el workout se postea solo. */
const PENDING_COMPLETION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Snapshot del entrenamiento terminado mientras el modal está abierto. */
let pendingCompletion = null;

/**
 * Modo en el que está abierto el formulario:
 *   "create" → entrenamiento recién terminado, todavía sin postear (POST)
 *   "edit"   → workout ya guardado, se edita su carga desde el dashboard (PATCH)
 */
let logModalContext = { mode: "create", workout: null };

function readPendingCompletion() {
  try {
    const raw = localStorage.getItem(PENDING_COMPLETION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.core)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePendingCompletion(payload) {
  try {
    localStorage.setItem(PENDING_COMPLETION_KEY, JSON.stringify(payload));
  } catch { /* storage full */ }
}

function clearPendingCompletion() {
  try {
    localStorage.removeItem(PENDING_COMPLETION_KEY);
  } catch { /* ignore */ }
}

/**
 * Corre una sola vez cuando el timer Fibonacci llega al final.
 * Toma el snapshot de las listas ANTES de limpiarlas y abre el formulario.
 */
function handleFibonacciComplete() {
  const snapshot = {
    date: new Date().toISOString(),
    core: [...fibExerciseLists.core],
    bodyweight: [...fibExerciseLists.bodyweight],
    overload: [...fibExerciseLists.overload],
    durationSec: FIB_TOTAL_SEC,
  };

  // El plan (DB + local) se limpia igual que antes: el snapshot ya tiene los
  // nombres, así que la pantalla de setup queda lista para la próxima sesión.
  clearCurrentWorkoutCollection();
  resetFibExercisePlan();

  // Sin ejercicios que cargar, el formulario no aporta nada: se postea directo.
  const hasLoggableBlocks = LOG_BLOCKS.some(({ key }) => snapshot[key].length > 0);
  if (!hasLoggableBlocks) {
    saveCompletedWorkoutToAPI(snapshot);
    return;
  }

  pendingCompletion = snapshot;
  writePendingCompletion(snapshot);
  openWorkoutLogModal(snapshot);
}

/** "" / basura → null. Nunca 0: sin cargar ≠ cero reps. */
function parseLogNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function buildLogField(labelText, attribute, { decimal = false, value = null } = {}) {
  const label = document.createElement("label");
  label.className = "log-field";

  const caption = document.createElement("span");
  caption.className = "log-field__label";
  caption.textContent = labelText;

  const input = document.createElement("input");
  input.type = "number";
  input.className = "log-input";
  input.min = "0";
  input.placeholder = "—";
  input.inputMode = decimal ? "decimal" : "numeric";
  input.step = decimal ? "0.5" : "1";
  input.max = decimal ? "999" : "999";
  input.setAttribute(attribute, "");
  if (value !== null && value !== undefined) input.value = String(value);

  label.append(caption, input);
  return label;
}

/** Arma las secciones del formulario a partir del snapshot, precargando los
 *  valores ya guardados cuando se está editando. */
function renderWorkoutLogSections(snapshot, performance) {
  const previo = performance
    ? buildPerformanceLookup({ performance })
    : { bodyweight: new Map(), overload: new Map() };
  const vueltas = (performance && performance.rounds) || {};
  const container = document.getElementById("logSections");
  if (!container) return;
  container.replaceChildren();

  LOG_BLOCKS.forEach(({ key, label, hasWeight }) => {
    const names = snapshot[key] || [];
    if (!names.length) return; // bloque vacío → sección oculta

    const section = document.createElement("section");
    section.className = "log-block";

    const head = document.createElement("div");
    head.className = "log-block__head";

    const title = document.createElement("p");
    title.className = "log-block__title";
    title.textContent = label;

    const roundsLabel = document.createElement("label");
    roundsLabel.className = "log-rounds";
    const roundsCaption = document.createElement("span");
    roundsCaption.className = "log-rounds__label";
    roundsCaption.textContent = "VUELTAS";
    const roundsInput = document.createElement("input");
    roundsInput.type = "number";
    roundsInput.className = "log-input log-input--rounds";
    roundsInput.min = "0";
    roundsInput.max = "99";
    roundsInput.step = "1";
    roundsInput.inputMode = "numeric";
    roundsInput.placeholder = "—";
    roundsInput.setAttribute("data-log-rounds", key);
    if (vueltas[key] !== null && vueltas[key] !== undefined) {
      roundsInput.value = String(vueltas[key]);
    }
    roundsLabel.append(roundsCaption, roundsInput);

    head.append(title, roundsLabel);

    const rows = document.createElement("ul");
    rows.className = "log-rows";

    names.forEach((name) => {
      const row = document.createElement("li");
      row.className = "log-row";
      row.setAttribute("data-log-row", "");
      row.setAttribute("data-log-block", key);
      row.setAttribute("data-log-name", name);

      // textContent, no innerHTML: los nombres de ejercicio son input del usuario
      const nameEl = document.createElement("span");
      nameEl.className = "log-row__name";
      nameEl.textContent = name;

      const guardado = previo[key].get(String(name).trim().toLowerCase());

      const fields = document.createElement("div");
      fields.className = "log-row__fields";
      fields.appendChild(
        buildLogField("REPS", "data-log-reps", { value: guardado && guardado.reps })
      );
      if (hasWeight) {
        fields.appendChild(
          buildLogField("KG", "data-log-weight", { decimal: true, value: guardado && guardado.weightKg })
        );
      }

      row.append(nameEl, fields);
      rows.appendChild(row);
    });

    section.append(head, rows);
    container.appendChild(section);
  });
}

const LOG_MODAL_TEXTS = {
  create: { eyebrow: "WORKOUT COMPLETO", title: "Cargá la vuelta", secondary: "Skip" },
  edit:   { eyebrow: "EDITAR CARGA",     title: "Editar la vuelta", secondary: "Cancelar" },
};

function openWorkoutLogModal(workout, mode = "create") {
  const modal = document.getElementById("logModal");
  if (!modal) {
    // Sin modal en el DOM (versión vieja cacheada) no hay que perder el workout.
    if (mode === "create") finishWorkoutLog(null);
    return;
  }

  logModalContext = { mode, workout };

  const textos = LOG_MODAL_TEXTS[mode];
  const eyebrowEl   = document.getElementById("logModalEyebrow");
  const titleEl     = document.getElementById("logModalTitle");
  const secondaryEl = document.getElementById("logSkipBtn");
  if (eyebrowEl)   eyebrowEl.textContent = textos.eyebrow;
  if (titleEl)     titleEl.textContent = textos.title;
  if (secondaryEl) secondaryEl.textContent = textos.secondary;

  const dateEl = document.getElementById("logModalDate");
  if (dateEl) dateEl.textContent = dashFormatDayHeader(new Date(workout.date));

  renderWorkoutLogSections(workout, mode === "edit" ? workout.performance : null);
  modal.hidden = false;
  modal.scrollTop = 0;
}

function closeWorkoutLogModal() {
  const modal = document.getElementById("logModal");
  if (modal) modal.hidden = true;
  const container = document.getElementById("logSections");
  if (container) container.replaceChildren();
  logModalContext = { mode: "create", workout: null };
}

/**
 * Lee el formulario. Devuelve null si no se cargó ni un dato — un formulario en
 * blanco se comporta igual que un skip.
 */
function collectWorkoutLogPerformance() {
  const container = document.getElementById("logSections");
  if (!container) return null;

  const rounds = { bodyweight: null, overload: null };
  container.querySelectorAll("[data-log-rounds]").forEach((input) => {
    rounds[input.getAttribute("data-log-rounds")] = parseLogNumber(input.value);
  });

  const entries = [];
  container.querySelectorAll("[data-log-row]").forEach((row) => {
    const reps = parseLogNumber(row.querySelector("[data-log-reps]")?.value);
    const weightKg = parseLogNumber(row.querySelector("[data-log-weight]")?.value);
    if (reps === null && weightKg === null) return; // fila sin cargar
    entries.push({
      block: row.getAttribute("data-log-block"),
      name: row.getAttribute("data-log-name"),
      reps,
      weightKg,
    });
  });

  const hasRounds = rounds.bodyweight !== null || rounds.overload !== null;
  if (!entries.length && !hasRounds) return null;

  return { rounds, entries };
}

/** Cierra el formulario y postea el workout, con carga (`performance`) o sin ella. */
function finishWorkoutLog(performance) {
  const snapshot = pendingCompletion;
  pendingCompletion = null;
  clearPendingCompletion();
  closeWorkoutLogModal();
  if (!snapshot) return;
  saveCompletedWorkoutToAPI(performance ? { ...snapshot, performance } : snapshot);
}

/**
 * PATCH de la carga de un workout ya guardado. `performance: null` la borra.
 * A diferencia del alta, acá no hay cola de reintentos: si falla, se avisa y el
 * usuario reintenta — el workout ya está a salvo en la DB.
 */
async function patchWorkoutPerformance(id, performance) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/workouts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ performance }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Cache invalidado + refetch: el dashboard vuelve a dibujarse con lo guardado.
    try { localStorage.removeItem(DASH_CACHE_KEY); } catch { /* ignore */ }
    await loadDashboard();
  } catch (err) {
    console.warn("[API] No se pudo actualizar la carga:", err.message);
    const msg = document.getElementById("dashMessage");
    if (msg) {
      msg.textContent = "No se pudo guardar la carga — probá de nuevo.";
      msg.className   = "dash-message dash-message--error";
      msg.hidden      = false;
    }
  }
}

/** Submit del formulario, en cualquiera de los dos modos. */
function submitWorkoutLog() {
  const { mode, workout } = logModalContext;
  const performance = collectWorkoutLogPerformance();

  if (mode === "edit") {
    closeWorkoutLogModal();
    if (workout) patchWorkoutPerformance(workout._id, performance);
    return;
  }
  finishWorkoutLog(performance);
}

/** Botón secundario: "Skip" en el alta, "Cancelar" en la edición. */
function dismissWorkoutLog() {
  if (logModalContext.mode === "edit") {
    closeWorkoutLogModal(); // cancelar no toca nada
    return;
  }
  finishWorkoutLog(null);
}

function initWorkoutLogModal() {
  const form = document.getElementById("logForm");
  const skip = document.getElementById("logSkipBtn");

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submitWorkoutLog();
    });
  }
  if (skip) skip.addEventListener("click", dismissWorkoutLog);
}

/**
 * Guard de arranque: si quedó un entrenamiento sin postear (la app se cerró con
 * el formulario abierto), se reabre el formulario. Si ya pasaron más de 12 h,
 * se postea solo sin carga para no arrastrarlo indefinidamente.
 */
function resumePendingCompletion() {
  const snapshot = readPendingCompletion();
  if (!snapshot) return;

  pendingCompletion = snapshot;

  const ageMs = Date.now() - new Date(snapshot.date).getTime();
  if (!Number.isFinite(ageMs) || ageMs > PENDING_COMPLETION_MAX_AGE_MS) {
    finishWorkoutLog(null);
    return;
  }

  openWorkoutLogModal(snapshot);
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

function dashMonthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Últimos 6 meses (el actual incluido), del más viejo al más nuevo:
 * [{ key, label, count }]
 */
function lastSixMonths(byMonth) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const out = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(currentYear, now.getMonth() - i, 1);
    const key = dashMonthKey(d);
    const short = MONTH_NAMES[d.getMonth()].slice(0, 3);
    out.push({
      key,
      label: d.getFullYear() === currentYear
        ? short
        : `${short} '${String(d.getFullYear()).slice(-2)}`,
      count: byMonth[key] ?? 0,
    });
  }
  return out;
}

/** Returns { "YYYY-MM": count } for every workout */
function groupByMonth(workouts) {
  return workouts.reduce((acc, w) => {
    const key = dashMonthKey(new Date(w.date));
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

/** Returns { "YYYY-MM-DD": { date, core[], bodyweight[], overload[] } } */
/**
 * Agrupa por día conservando cada workout entero (no fusiona las listas): la
 * carga de reps/peso pertenece a un workout puntual, y el historial necesita el
 * `_id` de cada uno. Dos sesiones el mismo día se dibujan como dos tablas.
 */
function groupByDay(workouts) {
  const map = {};
  workouts.forEach((w) => {
    const d = new Date(w.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!map[key]) map[key] = { date: d, workouts: [] };
    map[key].workouts.push(w);
  });
  // Orden cronológico dentro del día (la API los devuelve del más nuevo al más viejo)
  Object.values(map).forEach((day) => {
    day.workouts.sort((a, b) => new Date(a.date) - new Date(b.date));
  });
  return map;
}

/** Índice bloque → nombre normalizado → entry, para pintar la carga en la tabla. */
function buildPerformanceLookup(workout) {
  const byBlock = { bodyweight: new Map(), overload: new Map() };
  const entries = (workout.performance && workout.performance.entries) || [];
  entries.forEach((entry) => {
    const map = byBlock[entry.block];
    if (map) map.set(String(entry.name).trim().toLowerCase(), entry);
  });
  return byBlock;
}

/** "10 × 22.5kg" / "10 reps" / "22.5kg" / "" según lo que se haya cargado. */
function formatLoadLabel(entry) {
  if (!entry) return "";
  const reps = entry.reps ?? null;
  const kg = entry.weightKg ?? null;
  if (reps !== null && kg !== null) return `${reps} × ${kg}kg`;
  if (reps !== null) return `${reps} reps`;
  if (kg !== null) return `${kg}kg`;
  return "";
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
  // 400 para que el resumen de los últimos 6 meses no quede truncado
  const res = await fetch(`${API_BASE_URL}/api/workouts?limit=400`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return Array.isArray(body) ? body : (body.workouts ?? []);
}

/**
 * Mapa nombre → patrones[], para cruzar contra los ejercicios de cada workout.
 * Devuelve `null` si falla: el dashboard sigue funcionando sin la sección de
 * patrones en vez de romperse entero.
 */
async function fetchExercisePatrones() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/exercises`);
    if (!res.ok) return null;
    const data = await res.json();
    const out = {};
    data.forEach((e) => { out[e.name] = e.patrones || []; });
    return out;
  } catch {
    return null;
  }
}

// ── Dashboard cache (localStorage) ──────────────────────────────────────────

// v2: el cache viejo guardaba sólo 100 workouts — insuficiente para 6 meses
// v3: suma el mapa de patrones por ejercicio
const DASH_CACHE_KEY = "dashCache_v3";
const DASH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function readDashCache() {
  try {
    const raw = localStorage.getItem(DASH_CACHE_KEY);
    if (!raw) return null;
    const { workouts, patrones, ts } = JSON.parse(raw);
    if (!Array.isArray(workouts)) return null;
    return { workouts, patrones: patrones ?? null, stale: Date.now() - ts > DASH_CACHE_TTL };
  } catch {
    return null;
  }
}

function writeDashCache(workouts, patrones) {
  try {
    localStorage.setItem(
      DASH_CACHE_KEY,
      JSON.stringify({ workouts, patrones, ts: Date.now() })
    );
  } catch { /* storage full / private mode */ }
}

// ── Stats computation ─────────────────────────────────────────────────────────

function computeDashStats(workouts) {
  if (!workouts.length) return null;

  const sorted = [...workouts].sort((a, b) => new Date(a.date) - new Date(b.date));
  const curKey = dashMonthKey(new Date());
  const byMonth = groupByMonth(workouts);

  // Promedio sobre los 6 meses listados (el actual, parcial, incluido)
  const months = lastSixMonths(byMonth);
  const total  = months.reduce((sum, m) => sum + m.count, 0);

  return {
    firstDate:      sorted[0].date,
    lastDate:       sorted[sorted.length - 1].date,
    daysSinceLast:  dashDaysSince(sorted[sorted.length - 1].date),
    thisMonthCount: byMonth[curKey] ?? 0,
    streak:         calcStreak(workouts),
    byMonth,
    months,
    avgPerMonth:    total / months.length,
  };
}

// ── Balance de patrones ──────────────────────────────────────────────────────

// Orden fijo: las dos columnas (BD y OV) quedan alineadas fila a fila, así se
// comparan de un vistazo. El patrón más pesado se resalta en vez de reordenarse.
const PATRON_ORDER  = ["empuje", "traccion", "rodilla_dominante", "cadera_dominante", "core"];
const PATRON_LABELS = {
  empuje:            "Push",
  traccion:          "Pull",
  rodilla_dominante: "Knee",
  cadera_dominante:  "Hip",
  core:              "Core",
};
// Sólo BD y OV: el bloque de core es 100% patrón core por definición.
const PATRON_BLOCKS = [
  { key: "bodyweight", label: "Bodyweight" },
  { key: "overload",   label: "Overload" },
];
const PATRON_WINDOW_DAYS = 30;

/**
 * Reparte 100 puntos enteros respetando las proporciones (método del mayor
 * resto). Sin esto, redondear cada porcentaje por separado da sumas de 99 o 101
 * y el reparto deja de leerse como un 100% exacto.
 */
function sharesToPercent(weights, total) {
  if (!total) return weights.map(() => 0);

  const exact  = weights.map((w) => (w / total) * 100);
  const out    = exact.map(Math.floor);
  let leftover = 100 - out.reduce((a, b) => a + b, 0);

  exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
    .forEach(({ i }) => {
      if (leftover > 0) { out[i]++; leftover--; }
    });

  return out;
}

/**
 * Reparto de patrones por bloque en los últimos 30 días.
 * Cada ejercicio vale 1 y lo reparte en partes iguales entre sus patrones: un
 * burpee suma 0,5 a `empuje` y 0,5 a `rodilla_dominante`. Así los porcentajes
 * de cada bloque suman 100% y se leen como fracción del volumen programado.
 */
function computePatronBalance(workouts, patronesByName) {
  if (!patronesByName) return null;

  const since  = Date.now() - PATRON_WINDOW_DAYS * 86_400_000;
  const recent = workouts.filter((w) => new Date(w.date).getTime() >= since);

  const blocks = PATRON_BLOCKS.map(({ key, label }) => {
    const weights = {};
    PATRON_ORDER.forEach((p) => (weights[p] = 0));
    let total = 0;
    let unclassified = 0;

    recent.forEach((w) => {
      (w[key] || []).forEach((raw) => {
        // Los workouts guardan el nombre tal como se tipeó; `exercises` lo
        // normaliza a minúsculas — sin esto el cruce falla en la mitad de los casos.
        const patrones = patronesByName[String(raw).trim().toLowerCase()];
        if (!patrones || !patrones.length) { unclassified++; return; }

        const share = 1 / patrones.length;
        patrones.forEach((p) => {
          if (!(p in weights)) return; // patrón que el backend agregó y este front no conoce
          weights[p] += share;
          total += share;
        });
      });
    });

    const pcts = sharesToPercent(PATRON_ORDER.map((p) => weights[p]), total);
    const rows = PATRON_ORDER.map((p, i) => ({
      patron: p,
      label:  PATRON_LABELS[p],
      weight: weights[p],
      pct:    pcts[i],
    }));

    const topWeight = Math.max(...rows.map((r) => r.weight));

    return {
      key,
      label,
      rows,
      total,
      unclassified,
      // Sin datos no hay nada que resaltar; con empate se resaltan los dos.
      topWeight: total ? topWeight : -1,
    };
  });

  return {
    days:         PATRON_WINDOW_DAYS,
    workoutCount: recent.length,
    blocks,
    hasData:      blocks.some((b) => b.total > 0),
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

function setDashText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/** Lista de los últimos 6 meses con su cantidad de entrenamientos */
function renderDashMonths(months) {
  const list = document.getElementById("dashMonthsList");
  if (!list) return;

  list.replaceChildren();
  const max = Math.max(...months.map((m) => m.count), 1);

  months.forEach(({ label, count }) => {
    const li = document.createElement("li");
    li.className = "dash-month";

    const name = document.createElement("span");
    name.className = "dash-month__label";
    name.textContent = label;

    const track = document.createElement("span");
    track.className = "dash-month__track";
    const bar = document.createElement("span");
    bar.className = "dash-month__bar";
    // los meses sin entrenamientos quedan con la barra vacía
    bar.style.width = count ? `${Math.max((count / max) * 100, 4)}%` : "0";
    track.appendChild(bar);

    const value = document.createElement("span");
    value.className = "dash-month__count";
    value.textContent = count;

    li.append(name, track, value);
    list.appendChild(li);
  });
}

/** Reparto de patrones por bloque, una lista de barras por bloque. */
function renderPatronBalance(balance) {
  const section = document.getElementById("dashPatrones");
  const holder  = document.getElementById("dashPatronesBlocks");
  const meta    = document.getElementById("dashPatronesMeta");
  if (!section || !holder) return;

  // Sin ejercicios clasificados en la ventana no hay nada que mostrar: la
  // sección se esconde entera en vez de dibujar cinco barras en cero.
  if (!balance || !balance.hasData) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  if (meta) {
    const n = balance.workoutCount;
    meta.textContent = `${n} workout${n === 1 ? "" : "s"} · share of programmed volume`;
  }

  holder.replaceChildren();

  balance.blocks.forEach((block) => {
    const wrap = document.createElement("div");
    wrap.className = `dash-patron-block dash-patron-block--${block.key}`;

    const head = document.createElement("h3");
    head.className = "dash-patron-block__title";
    head.textContent = block.label;

    const count = document.createElement("span");
    count.className = "dash-patron-block__count";
    count.textContent = block.total
      ? `${Number.isInteger(block.total) ? block.total : block.total.toFixed(1)} ex`
      : "—";
    head.appendChild(count);

    const list = document.createElement("ul");
    list.className = "dash-patron-block__list";

    block.rows.forEach((row) => {
      const li = document.createElement("li");
      li.className = "dash-patron";
      if (row.weight === block.topWeight) li.classList.add("dash-patron--top");
      if (row.weight === 0) li.classList.add("dash-patron--zero");

      const label = document.createElement("span");
      label.className = "dash-patron__label";
      label.textContent = row.label;

      const track = document.createElement("span");
      track.className = "dash-patron__track";
      const bar = document.createElement("span");
      bar.className = "dash-patron__bar";
      // El track es el 100%: el ancho ES el porcentaje, no una escala relativa.
      bar.style.width = `${row.pct}%`;
      track.appendChild(bar);

      const pct = document.createElement("span");
      pct.className = "dash-patron__pct";
      pct.textContent = `${row.pct}%`;

      li.append(label, track, pct);
      list.appendChild(li);
    });

    wrap.append(head, list);

    // Un ejercicio sin patrones cargados no entra en el reparto: avisarlo, si no
    // los porcentajes mienten en silencio.
    if (block.unclassified) {
      const note = document.createElement("p");
      note.className = "dash-patron-block__note";
      note.textContent = `${block.unclassified} sin clasificar (fuera del cálculo)`;
      wrap.appendChild(note);
    }

    holder.appendChild(wrap);
  });
}

/** Workouts dibujados en el historial, por id — los usa el modal de edición. */
const dashWorkoutsById = new Map();

/**
 * Un solo listener en la lista del historial: las tablas se redibujan enteras en
 * cada render, así que enganchar botón por botón se perdería en el próximo.
 */
function initDashboardEditing() {
  const historyList = document.getElementById("dashHistoryList");
  if (!historyList) return;

  historyList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-edit-workout]");
    if (!btn) return;
    const workout = dashWorkoutsById.get(btn.getAttribute("data-edit-workout"));
    if (workout) openWorkoutLogModal(workout, "edit");
  });
}

function renderDashboard(workouts, patronesByName) {
  const wrapper     = document.querySelector(".dash-wrapper");
  const cards       = document.getElementById("dashCards");
  const months      = document.getElementById("dashMonths");
  const historyList = document.getElementById("dashHistoryList");
  const msg         = document.getElementById("dashMessage");
  const patrones    = document.getElementById("dashPatrones");

  // Remove loading state
  if (wrapper) wrapper.classList.remove("dash-loading");

  if (!workouts.length) {
    if (cards) cards.hidden = true;
    if (months) months.hidden = true;
    if (patrones) patrones.hidden = true;
    if (historyList) historyList.replaceChildren();
    if (msg) {
      msg.textContent = "No workouts yet. Complete a Fibonacci session to start tracking!";
      msg.className   = "dash-message";
      msg.hidden      = false;
    }
    return;
  }

  if (cards)  cards.hidden  = false;
  if (months) months.hidden = false;
  if (msg)    msg.hidden    = true;

  const s = computeDashStats(workouts);

  setDashText("dashMonthCount",  s.thisMonthCount);
  setDashText("dashLastDays",    s.daysSinceLast === 0 ? "Today" : `${s.daysSinceLast}d ago`);
  setDashText("dashAvgPerMonth", Number.isInteger(s.avgPerMonth)
    ? s.avgPerMonth
    : s.avgPerMonth.toFixed(1));

  renderDashMonths(s.months);
  renderPatronBalance(computePatronBalance(workouts, patronesByName));

  if (!historyList) return;
  historyList.replaceChildren();
  dashWorkoutsById.clear();

  const byDay = groupByDay(workouts);
  Object.keys(byDay)
    .sort()
    .reverse()
    .forEach((key) => {
      const { date, workouts: dayWorkouts } = byDay[key];

      const li = document.createElement("li");
      li.className = "dash-history__item";

      const dateEl = document.createElement("span");
      dateEl.className = "dash-history__date";
      dateEl.textContent = dashFormatDayHeader(date);

      const head = document.createElement("div");
      head.className = "dash-history__head";
      head.appendChild(dateEl);

      // Con una sola sesión el botón entra en la línea de la fecha; con varias,
      // cada una lleva el suyo junto a su hora.
      const variasSesiones = dayWorkouts.length > 1;
      if (!variasSesiones) head.appendChild(buildEditButton(dayWorkouts[0]));

      li.appendChild(head);
      dayWorkouts.forEach((w) => {
        dashWorkoutsById.set(String(w._id), w);
        li.appendChild(buildWorkoutBlock(w, variasSesiones));
      });
      historyList.appendChild(li);
    });
}

/** Botón que abre el formulario de carga sobre un workout ya guardado. */
function buildEditButton(workout) {
  const rounds = (workout.performance && workout.performance.rounds) || {};
  const tieneCarga = !!(workout.performance && (
    ((workout.performance.entries || []).length) ||
    rounds.bodyweight !== null && rounds.bodyweight !== undefined ||
    rounds.overload !== null && rounds.overload !== undefined
  ));

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dash-workout__edit";
  btn.textContent = tieneCarga ? "Editar" : "+ Carga";
  btn.setAttribute("data-edit-workout", String(workout._id));
  return btn;
}

/**
 * Un workout dentro del historial. Con varias sesiones en el día lleva su propia
 * barra (hora + botón); con una sola, el botón ya está junto a la fecha.
 */
function buildWorkoutBlock(workout, conBarra) {
  const wrap = document.createElement("div");
  wrap.className = "dash-workout";

  if (conBarra) {
    const bar = document.createElement("div");
    bar.className = "dash-workout__bar";

    const time = document.createElement("span");
    time.className = "dash-workout__time";
    time.textContent = new Date(workout.date).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

    bar.append(time, buildEditButton(workout));
    wrap.appendChild(bar);
  }

  wrap.appendChild(buildWorkoutTable(workout));
  return wrap;
}

/** Tabla de un workout: Core / BD / OV, con las vueltas en el encabezado y la
 *  carga (reps × kg) debajo de cada ejercicio. */
function buildWorkoutTable(workout) {
  const core       = workout.core || [];
  const bodyweight = workout.bodyweight || [];
  const overload   = workout.overload || [];
  const rows = Math.max(core.length, bodyweight.length, overload.length, 1);

  const perf   = buildPerformanceLookup(workout);
  const rounds = (workout.performance && workout.performance.rounds) || {};

  const table = document.createElement("table");
  table.className = "dash-day-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  [
    { label: "Core", block: null },
    { label: "BD",   block: "bodyweight" },
    { label: "OV",   block: "overload" },
  ].forEach(({ label, block }) => {
    const th = document.createElement("th");
    th.textContent = label;
    const vueltas = block ? rounds[block] ?? null : null;
    if (vueltas !== null) {
      const badge = document.createElement("span");
      badge.className = "dash-day-table__rounds";
      badge.textContent = `×${vueltas}`;
      th.appendChild(badge);
    }
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  for (let i = 0; i < rows; i++) {
    const tr = document.createElement("tr");
    [
      { name: core[i],       block: null },
      { name: bodyweight[i], block: "bodyweight" },
      { name: overload[i],   block: "overload" },
    ].forEach(({ name, block }) => {
      const td = document.createElement("td");
      // Sin nombre la celda queda vacía a propósito: `td:empty::after` dibuja el "—".
      if (name) {
        // textContent, no innerHTML: los nombres de ejercicio son input del usuario
        const nameEl = document.createElement("span");
        nameEl.textContent = name;
        td.appendChild(nameEl);

        const load = block
          ? formatLoadLabel(perf[block].get(String(name).trim().toLowerCase()))
          : "";
        if (load) {
          const loadEl = document.createElement("span");
          loadEl.className = "dash-load";
          loadEl.textContent = load;
          td.appendChild(loadEl);
        }
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }

  table.append(thead, tbody);
  return table;
}

function setDashLoadingState() {
  const wrapper = document.querySelector(".dash-wrapper");
  if (wrapper) wrapper.classList.add("dash-loading");

  ["dashMonthCount", "dashLastDays", "dashAvgPerMonth"].forEach((id) => setDashText(id, "—"));

  const monthsList = document.getElementById("dashMonthsList");
  if (monthsList) monthsList.replaceChildren();

  const patrones = document.getElementById("dashPatrones");
  if (patrones) patrones.hidden = true;

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
    renderDashboard(cached.workouts, cached.patrones);
    if (!cached.stale) return; // cache is fresh — skip network trip
    // Stale cache: data is already visible, refresh silently in background
  } else {
    // First ever load — show skeleton animation while we wait
    setDashLoadingState();
  }

  try {
    // Los patrones van en paralelo y nunca tiran error: si el fetch falla el
    // dashboard se dibuja igual, sólo sin la sección de balance.
    const [workouts, patrones] = await Promise.all([
      fetchAllWorkouts(),
      fetchExercisePatrones(),
    ]);
    writeDashCache(workouts, patrones);
    renderDashboard(workouts, patrones);
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
let _exModalidadFilter = ""; // "" = todas
let _exPatronFilter = "";    // "" = todos

/**
 * Un ejercicio pasa los filtros. Los tres se cruzan con AND.
 * `patron` matchea si el ejercicio **incluye** ese patrón: un complejo aparece
 * bajo los dos.
 */
function exerciseMatches(e, { q, modalidad, patron }) {
  return (
    (!q || e.name.includes(q)) &&
    (!modalidad || e.modalidad === modalidad) &&
    (!patron || (e.patrones || []).includes(patron))
  );
}

function currentExFilters() {
  return {
    q: document.getElementById("exSearch")?.value.trim().toLowerCase() || "",
    modalidad: _exModalidadFilter,
    patron: _exPatronFilter,
  };
}

/** Lo que se ve: cruce del buscador con los filtros de modalidad y patrón. */
function visibleExercises() {
  const f = currentExFilters();
  return _allExercises.filter((e) => exerciseMatches(e, f));
}

/**
 * Cuántos ejercicios quedarían si se tocara ese chip, con los otros filtros
 * como están. Así el contador responde "si toco esto, cuántos veo" en vez de un
 * total absoluto que miente cuando hay otro filtro activo.
 */
function countExercisesWith(overrides) {
  const f = { ...currentExFilters(), ...overrides };
  return _allExercises.filter((e) => exerciseMatches(e, f)).length;
}

function refreshExercisesView() {
  renderExercises(visibleExercises());
}

// Modalidad = bloque en el que se carga el ejercicio. Mismo orden que el timer.
const EX_MODALIDADES = [
  { value: "core",       label: "Core"    },
  { value: "bodyweight", label: "Body"    },
  { value: "overload",   label: "Over"    },
];
const EX_MODALIDAD_RANK = { core: 1, bodyweight: 2, overload: 3 };
// Nombre del bloque tal como aparece en la pantalla del Timer.
const EX_BLOCK_LABEL = { core: "CORE", bodyweight: "BODYWEIGHT", overload: "OVERLOAD" };

let _exToastHide = null;
let _exToastClear = null;

/** Aviso flotante, visible sin importar dónde esté scrolleada la lista. */
function showExToast(message, isWarn = false) {
  const el = document.getElementById("exToast");
  if (!el) return;

  clearTimeout(_exToastHide);
  clearTimeout(_exToastClear);

  el.textContent = message;
  el.classList.toggle("ex-toast--warn", isWarn);
  el.hidden = false;
  void el.offsetWidth; // reinicia la transición si ya estaba visible
  el.classList.add("ex-toast--show");

  _exToastHide = setTimeout(() => {
    el.classList.remove("ex-toast--show");
    _exToastClear = setTimeout(() => { el.hidden = true; }, 250);
  }, 2200);
}

/** Click en una fila de la lista → suma el ejercicio al bloque de su modalidad. */
function addExerciseFromList(exercise, tr) {
  const type = exercise.modalidad;

  if (!type) {
    showExToast(`"${exercise.name}" no tiene modalidad asignada`, true);
    return;
  }

  const yaEsta = fibExerciseLists[type].some(
    (x) => String(x).trim().toLowerCase() === exercise.name
  );
  if (yaEsta) {
    showExToast(`Ya está en ${EX_BLOCK_LABEL[type]}`, true);
    return;
  }

  if (!addExerciseToPlan(exercise.name, type)) return;

  showExToast(`${exercise.name} → ${EX_BLOCK_LABEL[type]}`);
  tr.classList.remove("ex-row--added");
  void tr.offsetWidth; // reinicia la animación si se toca dos veces seguidas
  tr.classList.add("ex-row--added");
}

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

    // Con un filtro de modalidad activo, la fila reclasificada ya no pertenece
    // a lo que se está viendo: se re-renderiza para que salga de la lista.
    // Sin filtro no se re-renderiza, así el orden no salta bajo el dedo.
    if (_exModalidadFilter && _exModalidadFilter !== (modalidad || null)) {
      refreshExercisesView();
    } else {
      updateExerciseFilterChips();
    }
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

/**
 * Guarda (o borra) el link de video. Optimista: revierte si el PATCH falla.
 * Devuelve true si quedó guardado.
 */
async function updateExerciseLink(name, link) {
  const record = _allExercises.find((e) => e.name === name);
  const previous = record ? record.link ?? null : null;
  if (record) record.link = link || null;
  refreshExercisesView();

  try {
    const res = await fetch(
      `${API_BASE_URL}/api/exercises/${encodeURIComponent(name)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link: link || null }),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showExToast(link ? `Link guardado en ${name}` : `Link borrado de ${name}`);
    return true;
  } catch (err) {
    console.warn("[Exercises] link update failed:", err.message);
    if (record) record.link = previous;
    refreshExercisesView();
    showExToast("No se pudo guardar el link", true);
    return false;
  }
}

/** Sólo http/https: el valor termina en un href que abre el navegador. */
function isValidExLink(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Pide el link por prompt. Vacío = borrar el que estaba. */
function promptExerciseLink(exercise) {
  const answer = window.prompt(`Link de video para "${exercise.name}"`, exercise.link || "https://");
  if (answer === null) return; // cancelado

  const value = answer.trim();
  if (value === "" || value === "https://") {
    if (exercise.link) updateExerciseLink(exercise.name, null);
    return;
  }
  if (!isValidExLink(value)) {
    showExToast("El link tiene que empezar con http:// o https://", true);
    return;
  }
  updateExerciseLink(exercise.name, value);
}

function exLinkCell(exercise) {
  const td = document.createElement("td");
  td.className = "ex-td ex-td--link";

  // Con link: ▶ abre el video en el navegador + lápiz chico para corregirlo.
  // Sin link: sólo el lápiz, que lo carga desde la misma lista.
  if (exercise.link) {
    const open = document.createElement("a");
    open.className = "ex-link-btn";
    open.href = exercise.link;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.title = exercise.link;
    open.setAttribute("aria-label", `Open video for ${exercise.name}`);
    open.textContent = "▶";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "ex-link-edit";
    edit.setAttribute("aria-label", `Edit video link for ${exercise.name}`);
    edit.textContent = "✎";
    edit.addEventListener("click", () => promptExerciseLink(exercise));

    td.append(open, edit);
    return td;
  }

  const add = document.createElement("button");
  add.type = "button";
  add.className = "ex-link-btn ex-link-btn--empty";
  add.setAttribute("aria-label", `Add video link for ${exercise.name}`);
  add.textContent = "✎";
  add.addEventListener("click", () => promptExerciseLink(exercise));

  td.appendChild(add);
  return td;
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

  updateExerciseFilterChips();

  if (!exercises.length && _allExercises.length) {
    if (msg) { msg.textContent = "No exercises match the current filters."; msg.hidden = false; }
    if (counter) counter.textContent = "";
    return;
  }

  if (msg) msg.hidden = true;
  // Con filtro activo el total sin filtrar solo confunde: se muestra el recorte.
  if (counter) {
    counter.textContent =
      exercises.length === _allExercises.length
        ? `${_allExercises.length} total`
        : `${exercises.length} of ${_allExercises.length}`;
  }

  const sorted = sortExercises(exercises);

  const wrap = document.createElement("div");
  wrap.className = "ex-table-wrap";

  const table = document.createElement("table");
  table.className = "ex-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  const cols = [
    { key: "name",          label: "Exercise" },
    { key: "link",          label: "Link", sortable: false },
    { key: "modalidad",     label: "Modality" },
    { key: "lastPerformed", label: "Last"     },
    { key: "daysPerformed", label: "Days"     },
  ];

  cols.forEach(({ key, label, sortable = true }) => {
    if (!sortable) {
      const th = document.createElement("th");
      th.className = "ex-th ex-th--static";
      th.textContent = label;
      headerRow.appendChild(th);
      return;
    }

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
      refreshExercisesView();
    });
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  sorted.forEach((exercise) => {
    const { name, lastPerformed, daysPerformed } = exercise;
    const tr = document.createElement("tr");

    // Toda la fila suma el ejercicio al plan; el <select> de modalidad queda
    // excluido para que clasificar no dispare un alta sin querer.
    tr.className = "ex-row";
    tr.setAttribute("role", "button");
    tr.tabIndex = 0;
    tr.setAttribute("aria-label", `Add ${name} to the session plan`);
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".ex-mod-select, .ex-td--link")) return;
      addExerciseFromList(exercise, tr);
    });
    tr.addEventListener("keydown", (e) => {
      if (e.target.closest(".ex-mod-select, .ex-td--link")) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        addExerciseFromList(exercise, tr);
      }
    });

    // textContent, no innerHTML: `name` es input del usuario
    const nameTd = document.createElement("td");
    nameTd.className = "ex-td ex-td--name";
    nameTd.textContent = name;
    tr.appendChild(nameTd);

    tr.appendChild(exLinkCell(exercise));
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
      <td class="ex-td"><span class="ex-sk-cell" style="width:20px"></span></td>
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
  _exModalidadFilter = ""; // arranca en "todas", igual que el buscador
  _exPatronFilter = "";

  setExercisesLoadingState();

  try {
    const res = await fetch(`${API_BASE_URL}/api/exercises`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _allExercises = await res.json();
    refreshExercisesView();
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
  input.addEventListener("input", refreshExercisesView);
}

/** Patrones tildados en el form de alta, en el orden canónico. */
function readNewExercisePatrones() {
  const wrap = document.getElementById("exAddPatrones");
  if (!wrap) return [];
  return [...wrap.querySelectorAll('.ex-patron-chip[aria-pressed="true"]')]
    .map((b) => b.dataset.patron);
}

function clearNewExercisePatrones() {
  document
    .querySelectorAll('#exAddPatrones .ex-patron-chip[aria-pressed="true"]')
    .forEach((b) => b.setAttribute("aria-pressed", "false"));
}

/**
 * Alta manual de un ejercicio: nombre + modalidad, con patrones y link
 * opcionales. `lastPerformed` y `daysPerformed` quedan vacíos hasta que el
 * ejercicio aparezca en un entrenamiento terminado — de eso se encarga
 * POST /api/workouts.
 */
async function submitNewExercise(event) {
  event.preventDefault();

  const nameEl = document.getElementById("exAddName");
  const modEl  = document.getElementById("exAddModalidad");
  const linkEl = document.getElementById("exAddLink");
  const btn    = document.querySelector(".ex-add__btn");
  if (!nameEl || !modEl) return;

  const name = nameEl.value.trim();
  const modalidad = modEl.value;
  const link = linkEl ? linkEl.value.trim() : "";
  const patrones = readNewExercisePatrones();

  if (!name) { showExToast("Escribí un nombre", true); nameEl.focus(); return; }
  if (!modalidad) { showExToast("Elegí una modalidad", true); modEl.focus(); return; }
  if (link && !isValidExLink(link)) {
    showExToast("El link tiene que empezar con http:// o https://", true);
    linkEl.focus();
    return;
  }

  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/exercises`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, modalidad, link: link || null, patrones }),
    });

    if (res.status === 409) {
      showExToast(`"${name.toLowerCase()}" ya existe`, true);
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const created = await res.json();
    _allExercises.push(created);
    updateExerciseCacheWith(created.name);

    nameEl.value = "";
    modEl.value = "";
    if (linkEl) linkEl.value = "";
    clearNewExercisePatrones();
    refreshExercisesView();

    const pats = (created.patrones || []).map((p) => PATRON_LABELS[p] || p).join(" + ");
    showExToast(
      `${created.name} → ${EX_BLOCK_LABEL[created.modalidad]}${pats ? ` · ${pats}` : ""}`
    );
    flashExerciseRow(created.name);
  } catch (err) {
    console.warn("[Exercises] create failed:", err.message);
    showExToast("No se pudo guardar — servidor caído?", true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** Trae la fila recién creada a la vista y la destella (queda al final del orden). */
function flashExerciseRow(name) {
  const tr = [...document.querySelectorAll(".ex-row")].find(
    (r) => r.children[0].textContent === name
  );
  if (!tr) return;
  tr.scrollIntoView({ block: "center", behavior: "smooth" });
  tr.classList.add("ex-row--added");
}

function initExerciseAddForm() {
  document.getElementById("exAddForm")?.addEventListener("submit", submitNewExercise);

  // Chips de patrón: multi-selección. Un ejercicio puede no tener ninguno, tener
  // uno, o tener varios si es complejo — por eso son toggles y no un <select>.
  const wrap = document.getElementById("exAddPatrones");
  if (!wrap) return;

  wrap.replaceChildren();
  PATRON_ORDER.forEach((patron) => {
    const btn = document.createElement("button");
    // type=button: si no, cada chip enviaría el form
    btn.type = "button";
    btn.className = "ex-patron-chip";
    btn.dataset.patron = patron;
    btn.setAttribute("aria-pressed", "false");
    btn.textContent = PATRON_LABELS[patron];
    wrap.appendChild(btn);
  });

  wrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".ex-patron-chip");
    if (!btn) return;
    btn.setAttribute("aria-pressed", btn.getAttribute("aria-pressed") === "true" ? "false" : "true");
  });
}

/** Chips de modalidad: uno por bloque + "All". Volver a tocar el activo lo limpia. */
function initExercisesModalidadFilter() {
  const wrap = document.getElementById("exFilters");
  if (!wrap) return;
  wrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".ex-filter");
    if (!btn) return;
    const value = btn.dataset.modalidad || "";
    _exModalidadFilter = value && value === _exModalidadFilter ? "" : value;
    refreshExercisesView();
  });
}

/**
 * Chips de patrón: uno por patrón + "All". Selección única (no multi como en el
 * form de alta): acá el objetivo es aislar un patrón para programar sobre él.
 * Volver a tocar el activo lo limpia.
 * Se pintan desde PATRON_ORDER para no desincronizarse del enum del backend.
 */
function initExercisesPatronFilter() {
  const wrap = document.getElementById("exPatronFilters");
  if (!wrap) return;

  wrap.replaceChildren();
  [{ value: "", label: "All" }, ...PATRON_ORDER.map((p) => ({ value: p, label: PATRON_LABELS[p] }))]
    .forEach(({ value, label }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ex-filter";
      btn.dataset.patron = value;
      btn.setAttribute("aria-pressed", String(value === _exPatronFilter));
      btn.append(label + " ");
      const count = document.createElement("span");
      count.className = "ex-filter__count";
      btn.appendChild(count);
      wrap.appendChild(btn);
    });

  wrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".ex-filter");
    if (!btn) return;
    const value = btn.dataset.patron || "";
    _exPatronFilter = value && value === _exPatronFilter ? "" : value;
    refreshExercisesView();
  });
}

/** Marca los chips activos de las dos filas y actualiza los contadores. */
function updateExerciseFilterChips() {
  document.querySelectorAll("#exFilters .ex-filter").forEach((btn) => {
    const value = btn.dataset.modalidad || "";
    const activo = value === _exModalidadFilter;
    btn.classList.toggle("ex-filter--active", activo);
    btn.setAttribute("aria-pressed", String(activo));

    const countEl = btn.querySelector(".ex-filter__count");
    if (countEl) countEl.textContent = countExercisesWith({ modalidad: value });
  });

  document.querySelectorAll("#exPatronFilters .ex-filter").forEach((btn) => {
    const value = btn.dataset.patron || "";
    const activo = value === _exPatronFilter;
    btn.classList.toggle("ex-filter--active", activo);
    btn.setAttribute("aria-pressed", String(activo));

    const countEl = btn.querySelector(".ex-filter__count");
    if (countEl) countEl.textContent = countExercisesWith({ patron: value });
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
  initWorkoutLogModal();
  initDashboardEditing();
  initNavigation();
  initExercisesSearch();
  initExercisesModalidadFilter();
  initExercisesPatronFilter();
  initExerciseAddForm();
  initSuggestPlan();

  // 2. Primer render
  fibonacciResetUi();
  tabataTimer.reset();
  updateTabataTotalTime();
  updateSessionPlanSummary();

  // 3. Sync remoto (async) — la DB es autoritativa sobre el plan local,
  //    y su camino de éxito dispara el flush de workouts pendientes.
  loadCurrentWorkoutFromDB();

  // 4. Guard: entrenamiento terminado que quedó sin postear (ver
  //    PENDING_COMPLETION_KEY). Va último para que el modal quede arriba de todo.
  resumePendingCompletion();
}

bootstrap();
