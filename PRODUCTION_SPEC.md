# Especificación funcional — VERSIÓN EN PRODUCCIÓN

> Documento de referencia para el redesign. Describe **exclusivamente** lo que hoy está
> corriendo en producción. No describe la rama `redesign` ni el working copy local.
> Objetivo: que ninguna funcionalidad se pierda en la transición.

---

## 0. Qué es "producción" y cómo se verificó

| Capa | Dónde vive | Fuente de verdad |
|---|---|---|
| Frontend | Vercel — `https://fibonacci-workout-timer.vercel.app` y `https://project-kgwmk.vercel.app` (mismo deploy) | rama **`main`**, commit `dabcbad` |
| Backend | Railway — `https://angelic-dream-production-e221.up.railway.app` (servicio `angelic-dream`) | carpeta `backend/` (idéntica en `main` y en working copy) |
| Base de datos | MongoDB Atlas — cluster `cluster0.xbrgkcu.mongodb.net`, DB **`fibo_workouts`** | — |
| Repo | `https://github.com/sebastianlarocca-ops/fibo_timmer` | push directo a `main`, sin PRs |

**Verificación hecha (25-jul-2026):**

- `index.html`, `script.js`, `styles.css`, `service-worker.js` y `manifest.json` descargados
  del dominio de Vercel → **byte-idénticos** a los de la rama `main` (SHA-1 de `script.js`:
  `80b669fe74778d8541551d0a4e2f68630b6c3058`).
- `backend/` no tiene diferencias entre `main` y el working copy (`git diff main -- backend/` vacío).
- `GET /health` responde `{"status":"ok","db":"connected"}`.
- Estado real de datos al momento del relevamiento: **25 workouts**, **46 exercises**,
  `current-workout` vacío.

> ⚠️ La rama `redesign` (working copy actual) **no** está en producción. Todo lo que aparece
> ahí y no en este documento es funcionalidad nueva, no funcionalidad a preservar:
> anillos SVG, modal bottom-sheet de Tabata, pill de Tabata, barra "SESSION PLAN",
> steppers +/−, label de tiempo total de Tabata, limpieza del plan al completar,
> recarga automática por `controllerchange`, fuente Inter Tight.

---

## 1. Qué es la app, en una frase

PWA vanilla (sin framework, sin build step) con **dos timers de entrenamiento independientes**
—Fibonacci y Tabata—, un **plan de ejercicios por bloque** que se sincroniza a MongoDB entre
dispositivos, y **dos vistas de historial** (Dashboard y Exercises) alimentadas por la misma API.

---

## 2. Stack y archivos

### Frontend (raíz del repo, se sirve tal cual)

| Archivo | Líneas | Rol |
|---|---|---|
| `index.html` | 258 | Todo el markup. Single-page, 3 vistas + panel Tabata |
| `script.js` | 1653 | Toda la lógica. Un solo script clásico, sin módulos |
| `styles.css` | 1272 | Design system neumórfico, tokens en `:root` |
| `service-worker.js` | 82 | Cache-first para GET same-origin. `CACHE_NAME = "workout-timer-pwa-v11"` |
| `manifest.json` | 22 | PWA manifest |
| `favicon.svg`, `icons/icon-192.png`, `icons/icon-512.png` | — | Íconos |
| `vercel.json` | — | `framework: null`, `outputDirectory: "."`, sin build |

Sin bundler, sin transpilación, sin dependencias npm en el frontend.
Única dependencia externa: Google Fonts (`Inter` 400/500/600/700 + `JetBrains Mono` 400/500/600).

### Backend (`backend/`)

| Archivo | Rol |
|---|---|
| `server.js` | App Express, CORS, JSON parser, wiring de routers, `/health`, 404, error handler, conexión Mongo |
| `routes/workouts.js` | `POST /`, `GET /`, `GET /:id` |
| `routes/exercises.js` | `GET /`, `POST /backfill` |
| `routes/current-workout.js` | `GET /`, `POST /`, `DELETE /all`, `DELETE /:id` |
| `models/workout.js` | Schema `Workout` |
| `models/exercise.js` | Schema `Exercise` |
| `models/currentWorkout.js` | Schema `CurrentWorkout` |
| `utils/exerciseStats.js` | `computeExerciseStats(name)` |
| `railway.json` | Config de deploy |

Node ≥ 18, Express `^4.19.2`, Mongoose `^8.4.1`, cors `^2.8.5`, dotenv `^16.4.5`.
Start: `node server.js`. Dev: `nodemon server.js`.

Variables de entorno: **`MONGODB_URI`** (obligatoria, el proceso hace `exit(1)` si falta) y
**`PORT`** (Railway inyecta `8080`; fallback `3000`).
El URI **debe** incluir `/fibo_workouts`, si no Mongoose conecta a la DB default equivocada.

---

## 3. Modelo de datos (MongoDB — DB `fibo_workouts`)

### 3.1 `workouts` — una sesión Fibonacci completada

| Campo | Tipo | Req. | Default | Notas |
|---|---|---|---|---|
| `date` | Date | sí | `Date.now` | **Indexado**. Momento en que se completó |
| `core` | [String] | no | `[]` | Ejercicios del bloque de 3 min |
| `bodyweight` | [String] | no | `[]` | Ejercicios del bloque de 5 min |
| `overload` | [String] | no | `[]` | Ejercicios del bloque de 8 min |
| `durationSec` | Number | no | `null` | El cliente manda `1380` |
| `createdAt` / `updatedAt` | Date | auto | — | `timestamps: true` |

Los nombres se guardan **tal como los tipeó el usuario** (con mayúsculas, acentos, etc.).
La normalización a minúsculas ocurre sólo al derivar `exercises`.

### 3.2 `exercises` — un doc por nombre único de ejercicio

| Campo | Tipo | Notas |
|---|---|---|
| `name` | String | `unique`, `trim`, `lowercase` — siempre normalizado a minúsculas |
| `lastPerformed` | Date | `null` por default |
| `daysPerformed` | Number | Cantidad de **días calendario distintos** en que se hizo, no cantidad de sesiones |
| `modalidad` | String | `"core"` \| `"bodyweight"` \| `"overload"` \| `null` (default). Bloque en el que se cargó el ejercicio la última vez |
| `link` | String | URL `http`/`https` a un video de referencia. `null` (default) = sin video |
| `patrones` | [String] | Patrones de movimiento. `[]` (default) = sin clasificar |
| `createdAt` / `updatedAt` | Date | `timestamps: true` |

Se recalcula por upsert en cada `POST /api/workouts`.
`modalidad` se deriva del bloque en el que vino el ejercicio en ese workout; si aparece en más de
un bloque en la misma sesión gana el primero (`core` → `bodyweight` → `overload`). Un workout
posterior **pisa** la modalidad anterior. También se puede fijar a mano vía `PATCH /api/exercises/:name`.

**Patrones de movimiento.** Enum de 5 valores, definido en `backend/models/exercise.js` y exportado
como `Exercise.PATRONES`:

| Patrón | Criterio |
|---|---|
| `empuje` | El peso se aleja del cuerpo |
| `traccion` | El peso se acerca al cuerpo |
| `rodilla_dominante` | Sentadilla o zancada, motor cuádriceps |
| `cadera_dominante` | Bisagra de cadera, motor glúteo e isquios |
| `core` | Estabilización o flexión del tronco |

Es un **array**, no un valor único: `[]` es sin clasificar, un elemento es un ejercicio simple y dos
o más es un ejercicio complejo. No hay flag `es_complejo` — lo dice el largo del array.
A diferencia de `modalidad`, **ningún workout lo toca**: se carga a mano vía `PATCH` o en lote con
`backend/scripts/import-patrones.js`.

### 3.3 `currentworkouts` — plan de ejercicios de la sesión en curso

| Campo | Tipo | Notas |
|---|---|---|
| `exercise` | String | `required`, `trim` |
| `block` | String | `required`, `enum: ["core","bodyweight","overload"]` |
| `createdAt` / `updatedAt` | Date | `createdAt` define el orden de la lista |

Colección efímera: es el "carrito" del entrenamiento que todavía no arrancó.
Es lo que permite armar el plan en la compu y entrenar con el celular.

---

## 4. API backend — contrato completo

Base URL: `https://angelic-dream-production-e221.up.railway.app`
CORS: `cors()` sin opciones → **todos los orígenes permitidos**. Sin autenticación de ningún tipo.
Body parser: `express.json({ limit: "1mb" })`.

### `GET /health`
```json
{ "status": "ok", "db": "connected" | "disconnected" }
```
`db` refleja `mongoose.connection.readyState === 1`. Es el healthcheck de Railway.

### `POST /api/workouts` — guardar sesión completada
Request:
```json
{ "date": "2026-07-25T14:49:06.898Z", "core": ["sit ups"],
  "bodyweight": ["squat","pull ups"], "overload": ["press"], "durationSec": 1380 }
```
Validación: `core`, `bodyweight` y `overload` **deben ser arrays** → si no, `400 { error: "core, bodyweight, and overload must be arrays." }`.
`date` ausente ⇒ `new Date()`. `durationSec` no numérico ⇒ `null`.

Efecto secundario: junta los tres arrays, normaliza a `trim().toLowerCase()`, deduplica,
y por cada nombre corre `computeExerciseStats(name)` + `Exercise.updateOne(..., { upsert: true })`.

Respuesta `201`:
```json
{ "message": "Workout saved successfully.", "id": "<ObjectId>", "date": "<ISO>" }
```
Error → `500 { error: "Failed to save workout." }`.

### `GET /api/workouts?limit=N` — historial
`limit` default **50**, máximo **1000**. Orden `date: -1` (más reciente primero). Excluye `__v`.
```json
{ "count": 25, "workouts": [ { "_id": "...", "date": "...", "core": [], "bodyweight": [], "overload": [], "durationSec": 1380, "createdAt": "...", "updatedAt": "..." } ] }
```
> El frontend siempre pide `?limit=100`.

### `GET /api/workouts/:id`
Devuelve un workout o `404 { error: "Workout not found." }`. **No se usa desde el frontend.**

### `GET /api/exercises`
Orden: `lastPerformed: -1`, luego `name: 1`.
Proyección `name lastPerformed daysPerformed modalidad link patrones -_id` → **no devuelve `_id`**.
```json
[ { "name": "sit ups", "daysPerformed": 11, "lastPerformed": "2026-07-25T14:49:06.898Z",
    "modalidad": "core", "link": null, "patrones": ["core"] } ]
```

### `POST /api/exercises`
Alta manual. Body: `{ "name": "...", "modalidad": "core" | "bodyweight" | "overload",
"link": "https://..." (opcional), "patrones": ["core", ...] (opcional) }`.
`name` y `modalidad` son obligatorios; el nombre se normaliza (trim + minúsculas).
`daysPerformed` arranca en `0` y `lastPerformed` en `null` — los completa
`POST /api/workouts` recién cuando el ejercicio aparece en un entrenamiento terminado.
- `400` si falta el nombre, la modalidad no es válida, el link no es `http`/`https` o algún patrón
  cae fuera del enum.
- `409 { error, exercise }` si ya existe (también ante colisión del índice único).
- `201` con el ejercicio creado.

### `PATCH /api/exercises/:name`
Clasifica manualmente un ejercicio ya existente. `:name` va URL-encodeado y se normaliza a
minúsculas. Body: cualquier combinación de `modalidad`, `link` y `patrones` — **sólo se tocan los
campos presentes**, así que un PATCH de link no pisa la modalidad ni los patrones.
- `patrones` se **reemplaza entero**, no hace merge: mandar `[]` es desclasificar. Se deduplica y se
  normaliza a minúsculas conservando el orden de llegada.
- `400` si la modalidad no es válida, el link no es `http`/`https`, `patrones` no es un array, algún
  patrón cae fuera del enum, o el body no trae ninguno de los tres campos.
- `404 { error: "Exercise not found." }` si el nombre no existe (**no crea ejercicios**).
- `200` con el doc actualizado.

Lo llama la pestaña List en cada cambio del `<select>` de modalidad.

### `backend/scripts/import-patrones.js` — carga en lote (no es un endpoint)
Importa la clasificación de patrones desde la planilla. Una fila por par (ejercicio, patrón): los
ejercicios complejos aparecen repetidos y se colapsan en un array. La columna `es_complejo` de la
planilla se ignora por redundante.
```bash
node scripts/import-patrones.js ../patrones.csv --dry-run   # muestra el plan, no escribe
node scripts/import-patrones.js ../patrones.csv
```
Aborta antes de conectarse si algún patrón cae fuera del enum. **No crea ejercicios**: los nombres de
la planilla que no estén en la base se reportan y se saltean. Los que están en la base y no en la
planilla quedan en `[]`.

### `POST /api/exercises/backfill`
Reconstruye toda la colección `exercises` desde los `workouts` existentes. Idempotente (upsert).
Carga todos los workouts en memoria y calcula en JS (evita N round-trips).
También propone `modalidad` a partir del bloque del **workout más reciente** que incluye el
ejercicio, pero **sólo la escribe si está vacía** — nunca pisa una clasificación manual.
Respuesta: `{ "processed": <n> }`. **Herramienta de mantenimiento, el frontend no la llama.**

### `GET /api/current-workout`
Orden `createdAt: 1`. Proyección `exercise block createdAt` (**sí incluye `_id`**).
```json
[ { "_id": "...", "exercise": "plancha", "block": "core", "createdAt": "..." } ]
```

### `POST /api/current-workout`
Request `{ "exercise": "plancha", "block": "core" }`.
Validaciones:
- `exercise` string no vacío → si no, `400 { error: "exercise is required." }`
- `block` ∈ `core|bodyweight|overload` → si no, `400 { error: "block must be core, bodyweight, or overload." }`

Respuesta `201 { "id": "<ObjectId>" }`.

### `DELETE /api/current-workout/all`
`deleteMany({})` → `{ "message": "Current workout cleared." }`.
> **Orden de rutas importante:** `/all` está declarada **antes** que `/:id`. Invertirlas rompe el borrado masivo.

### `DELETE /api/current-workout/:id`
`findByIdAndDelete`. `404 { error: "Item not found." }` si no existe.

### Comportamiento global
- Ruta desconocida → `404 { error: "Route not found." }`
- Excepción no manejada → `500 { error: "Internal server error." }`, log `[unhandled error]`
- El server **sólo empieza a escuchar después** de que Mongoose conecte. Si la conexión falla, `process.exit(1)`.

### Railway (`backend/railway.json`)
| Setting | Valor |
|---|---|
| Builder | NIXPACKS |
| Start | `node server.js` |
| Healthcheck | `/health`, timeout 30 s |
| Restart policy | `ON_FAILURE`, máx 3 reintentos |

Plan pago (Hobby) → **siempre encendido, sin cold starts**. Esto es la razón por la que el
frontend no tiene lógica de reintentos.

---

## 5. Estructura del frontend — vistas y navegación

Tres vistas hermanas, todas presentes en el DOM, alternadas con el atributo `hidden`:

| `id` | Botón nav (`data-view`) | Label visible |
|---|---|---|
| `view-timer` | `timer` | Timer |
| `view-dashboard` | `dashboard` | Dashboard |
| `view-exercises` | `exercises` | Exercises |

`showView(name)`:
1. `hidden = el.id !== "view-" + name` sobre todos los `.app-view`
2. `.nav-btn--active` sobre el botón correspondiente
3. Si `name === "dashboard"` → `loadDashboard()`
4. Si `name === "exercises"` → `loadExercises()`

`initNavigation()` engancha un listener por botón (`querySelectorAll(".nav-btn")`).

**Comportamiento a preservar:** cada visita a Dashboard o Exercises **dispara una recarga de datos**.
No hay routing por URL ni hash: al recargar la página siempre se vuelve a **Timer**.
La vista activa no se persiste.

---

## 6. Motor de timers — clase `WorkoutTimer`

Una sola clase reutilizable; los dos timers son instancias independientes con estado propio.
No hay globales compartidos entre ellos.

**Opciones del constructor:** `getSequence()`, `onRender(timer)`, `onTransitionBeep?`,
`onCompleteBeep?`, `tickMs?` (default **100 ms**).

**Estado interno:** `_isRunning`, `_isComplete`, `_currentIndex`, `_sequence`, `_remainingMs`,
`_phaseEndTime`, `_elapsedBeforePhaseSec`.

**Getters públicos:** `isRunning()`, `isComplete()`, `currentIndex`, `remainingMs`, `sequence`,
`elapsedBeforePhaseSec`.

**Semántica exacta — respetar al pie de la letra:**

- **Reloj de pared, no acumulador de ticks.** Al arrancar guarda
  `_phaseEndTime = Date.now() + _remainingMs`. Cada tick recalcula
  `_remainingMs = max(0, _phaseEndTime - Date.now())`. **No hay drift acumulado**, aunque el
  navegador estrangule el `setInterval` en background.
- `start()` sobre un timer completo → hace `reset()` primero y arranca de cero.
- `start()` sobre uno ya corriendo → no-op. `start()` con secuencia vacía → no-op.
- `pause()` congela `_remainingMs` desde `_phaseEndTime - Date.now()`. **El `setInterval` sigue vivo**
  durante la pausa (el tick sale temprano por el guard). Sólo se limpia en `reset()` y al terminar.
- `_advancePhase()`: suma la duración de la fase que terminó a `_elapsedBeforePhaseSec`, avanza el
  índice, recarga `_remainingMs`, dispara `onTransitionBeep()` y re-renderiza.
  **El beep de transición no suena al terminar la última fase** — ahí suena `onCompleteBeep()`.
- `_finish()`: `isRunning=false`, `isComplete=true`, `remainingMs=0`, limpia el interval,
  dispara `onCompleteBeep()` y renderiza.
- `reset()` vuelve a llamar `getSequence()` → por eso el Tabata recoge la config nueva de los inputs.

---

## 7. Timer Fibonacci

### 7.1 Secuencia (fija, hardcodeada)

| # | Tipo | Duración | Bloque de trabajo |
|---|---|---|---|
| 0 | work | 60 s | Warm-up 1 |
| 1 | rest | 30 s | |
| 2 | work | 120 s | Warm-up 2 |
| 3 | rest | 30 s | |
| 4 | work | 180 s | **Core** |
| 5 | rest | 60 s | |
| 6 | work | 300 s | **Bodyweight** |
| 7 | rest | 120 s | |
| 8 | work | 480 s | **Overload** |

- `FIB_TOTAL_SEC = 1380` s = **23 min 00 s** exactos.
- `FIB_TOTAL_BLOCKS = 5` (los 5 tramos de trabajo).
- Trabajo puro: 19 min. Descanso: 4 min.
- Los bloques se identifican **por duración**, no por índice: `180 → core`, `300 → bodyweight`,
  `480 → overload`; `60` y `120` → "Warm-up".

### 7.2 Dos modos de la tarjeta — `setFibMode(mode)`

| | `setup` | `running` |
|---|---|---|
| `.fib-exercise-setup` | visible | oculto |
| `#fibTimerDisplay` | oculto | visible |
| `#tabataPanel` (aside) | **oculto** | **visible** |
| `#view-timer` | — | clase `.timer-running` |

**Consecuencia crítica de producción:** el **Tabata sólo es accesible mientras el Fibonacci está
corriendo, pausado o completo**. Con el Fibonacci en idle, el panel Tabata no existe visualmente.
Cualquier redesign que cambie esto está cambiando el modelo de interacción.

La clase `.timer-running` además activa el modo compacto: achica el dial vía custom properties
(`--dial-size: 220px` en desktop, `195px` en ≤680 px).

### 7.3 Estado idle — `isFibIdleBeforeStart(timer)`

Devuelve `true` sólo si: no completo, no corriendo, `currentIndex === 0`,
`elapsedBeforePhaseSec === 0` y `remainingMs === duración de la fase 0`.
Es decir: "recién reseteado, nunca arrancado". Una pausa en el segundo 59 del primer bloque
**no** es idle → sigue mostrando el display de running.

### 7.4 Render — `renderFibonacci(timer)`

**Rama COMPLETO:**
- modo `running`, `fibonacciWorkoutEndAtMs = null`
- `#phaseLabel` = `"Workout Complete"`, `#timeLabel` = `"00:00"`
- `#blockLabel` = `"Block 5 of 5"`, `#fibCountdown` = `"00:00"`
- `#progressBar` width `100%`, fondo `done`
- Start habilitado, Pause deshabilitado

**Rama IDLE:** modo `setup`, fondo `idle`, Start habilitado, Pause deshabilitado. Sale temprano —
no toca labels ni progreso.

**Rama CORRIENDO / PAUSADO:**
- `#phaseLabel` = `"Work"` o `"Rest"`
- `#timeLabel` = `formatTime(ceil(remainingMs/1000))` → `MM:SS`
- `#blockLabel` = `"Block N of 5"`, donde N = cantidad de fases `work` hasta el índice actual
  (durante un `rest`, sigue mostrando el número del bloque de trabajo que acaba de terminar)
- progreso: `completed = elapsedBeforePhaseSec + (duraciónFase − restanteFase)`;
  `#progressBar.width = completed / 1380 × 100 %`
- `#fibCountdown` = `formatTime(1380 − completed)` → tiempo total restante de la sesión
- fondo `work` o `rest`
- Start deshabilitado sólo mientras corre (**pausado ⇒ Start habilitado**, funciona como Resume)

### 7.5 Fondos por estado — `setFibCardBackground(kind)`

Aplica **dos** cosas a la vez:
- en `#fibonacciCard`: `.fib-bg-idle|work|rest|done` (mutuamente excluyentes)
- en `<body>`: `.page-idle|page-work|page-rest|page-done`

El tinte de humor está en el **fondo de página**, no en la tarjeta (la tarjeta mantiene su
superficie neumórfica). Transición `background 500ms ease`.

| Estado | Gradiente del body |
|---|---|
| idle | `var(--bg)` plano `#1a1a1d` |
| work | `linear-gradient(180deg, #271c16, #1a120d)` — cálido |
| rest | `linear-gradient(180deg, #152019, #0f1612)` — verde |
| done | `linear-gradient(180deg, #1d1d2d, #141422)` — violáceo |

### 7.6 `#fibCurrentExercise` — qué se muestra en el dial

`getFibonacciCurrentExerciseLine(timer)`:
- completo o idle → `null` ⇒ el `<p>` se oculta
- fase `rest` → `"Rest"`
- fase de 60 s o 120 s → `"Warm-up"`
- 180/300/480 s → lista del bloque correspondiente:
  - lista vacía → label fallback `"Core"` / `"Bodyweight"` / `"Overload"`
  - 1 ejercicio → el nombre pelado
  - 2+ → `"• a\n• b"` (multilínea)

Prefijo al pintar: `"Current: <línea>"`, o `"Current:\n<líneas>"` si es multilínea.

### 7.7 `#fibEndsAt` — hora de finalización

- Al arrancar desde idle o desde completo se fija
  `fibonacciWorkoutEndAtMs = Date.now() + 1 380 000`.
- Se muestra `"Ends at: HH:MM"` en **formato 24 h, hora local**.
- Se oculta cuando el timer está completo o cuando `fibonacciWorkoutEndAtMs === null`.
- **No se recalcula al pausar.** Si pausás 5 minutos, la hora mostrada queda desactualizada.
  Es el comportamiento actual; documentado como tal.

### 7.8 Panel colapsable de plan — `#fibSummary`

Visible sólo dentro de `#fibTimerDisplay` (o sea, con el timer activo).

- Toggle `#fibSummaryToggle` (con `aria-expanded`), flecha `▾`, cuerpo `#fibSummaryBody`.
- Label colapsado `#fibSummaryLabel`: bloques no vacíos como `"Core (2) · Overload (1)"`,
  o `"No exercises planned"` si están todos vacíos.
- Cuerpo: los 3 bloques siempre, con headers `"Core — 3 min"`, `"Bodyweight — 5 min"`,
  `"Overload — 8 min"`; ejercicios como `"• nombre"`; bloque vacío → `"—"`.
- Se **re-renderiza y se fuerza colapsado** en cada Start que venga de idle o de completo.
- Clase `.fib-summary--open` en el contenedor cuando está abierto.

### 7.9 Controles

| Botón | id | Acción |
|---|---|---|
| Start | `startBtn` | `fibonacciTimer.start()`; si venía de idle o de completo, además fija `fibonacciWorkoutEndAtMs`, re-renderiza, repuebla el summary y lo colapsa |
| Pause | `pauseBtn` | `fibonacciTimer.pause()` |
| Reset | `resetBtn` | `fibonacciResetUi()` → pone `fibonacciWorkoutEndAtMs = null` y `timer.reset()` |

En producción los tres botones están en **una sola fila horizontal**.

---

## 8. Plan de ejercicios (los 3 bloques)

### 8.1 Estructura en memoria

```js
fibExerciseLists = { core: [], bodyweight: [], overload: [] }   // nombres
fibExerciseDbIds = { core: [], bodyweight: [], overload: [] }   // _id de Mongo, paralelo por índice
```
`fibExerciseDbIds[type][i] === null` ⇒ el ejercicio vino de localStorage y todavía no tiene id en la DB.

### 8.2 Persistencia local

| Clave localStorage | Contenido |
|---|---|
| `fibWorkoutExerciseListCore` | JSON array de strings |
| `fibWorkoutExerciseListBodyweight` | idem |
| `fibWorkoutExerciseListOverload` | idem |
| `fibWorkoutExerciseCore` / `...Bodyweight` / `...Overload` | **legacy**: string único. Sólo se lee si la clave nueva no existe o no parsea |

Toda lectura/escritura de localStorage va envuelta en `try/catch` (modo privado / storage lleno).

### 8.3 Agregar — `addExercise(type)`

1. Lee el input, `trim()`. Vacío ⇒ no hace nada.
2. Push del texto en `fibExerciseLists[type]` + push de `null` en `fibExerciseDbIds[type]`.
3. Limpia el input, persiste en localStorage, re-renderiza la lista.
4. `refreshFibWorkoutExerciseDisplay()` — repinta el timer si no está en idle.
5. `updateExerciseCacheWith(text)` — mete el nombre en minúsculas al **frente** del cache de autocomplete.
6. `POST /api/current-workout` **async, no bloqueante**; cuando responde, guarda el `id` en la
   posición correspondiente de `fibExerciseDbIds`.

Disparadores: click en `[data-fib-add]` (`+`), tecla **Enter** en el input, o click en una
sugerencia del autocomplete.

### 8.4 Quitar — `removeExercise(type, index)`

Toma el `dbId` **antes** de hacer el splice, saca el elemento de ambos arrays, persiste,
re-renderiza y —sólo si había `dbId`— dispara `DELETE /api/current-workout/:id`.
Un ejercicio agregado offline (sin id) se borra localmente y nunca se llega a borrar en la DB
(porque nunca llegó).

### 8.5 Render de la lista

`<ul id="fibList{Core|Bodyweight|Overload}">` con `<li class="fib-exercise-list-item">`,
un `<span class="fib-exercise-list-item__text">` con el nombre y un botón `×`
(`.fib-exercise-remove`, `aria-label="Remove <nombre>"`).
Todo con `createElement` + `textContent` — **sin `innerHTML`**, así que acá no hay riesgo de inyección.

### 8.6 Sincronización con la DB al arrancar — `loadCurrentWorkoutFromDB()`

Se ejecuta una vez, al cargar la página.

1. `#dbSyncStatus` ← `"⏳ Syncing with DB…"`
2. `GET /api/current-workout`
3. Si la respuesta no es OK → `"❌ Sync failed: <status> — <error>"` y **corta** (las listas locales quedan como estaban)
4. Si es OK: **la DB es autoritativa** → vacía las listas locales y las repuebla con lo que vino,
   guardando los `_id` en `fibExerciseDbIds`
5. Persiste en localStorage, re-renderiza las 3 listas, refresca el display del timer
6. `#dbSyncStatus` ← `"Synced — N exercise(s) loaded"`
7. Llama a `flushPendingWorkouts()`

**Sin reintentos ni timeout.** Un solo intento, porque Railway está siempre encendido.
Si el fetch tira excepción → `"❌ Sync failed: <mensaje>"`.

> Esto es lo que permite armar el plan en un dispositivo y entrenar en otro.
> Es también la razón por la que un plan viejo puede "reaparecer": la colección
> `currentworkouts` sólo se limpia al completar un workout **y sólo si el POST del workout tuvo éxito** (ver §9.2).

### 8.7 Autocomplete de ejercicios

- Un dropdown `<ul class="ex-autocomplete">` inyectado dentro del `parentElement` de cada uno de
  los 3 inputs.
- Fuente: `GET /api/exercises` una sola vez por sesión, cacheado en `_exerciseNameCache`
  (array de nombres, ya en minúsculas y ordenados por `lastPerformed`). Si falla, devuelve `[]`
  y el autocomplete simplemente no aparece.
- Filtro: `name.includes(query)` — **substring, no prefijo** — sobre el texto en minúsculas,
  **máximo 8 resultados**.
- La porción coincidente se resalta con `<mark class="ex-match">`.
- Se abre en `input` y en `focus`; se cierra en `Escape` y en `blur` (con 150 ms de delay para
  que el click alcance a registrarse).
- Teclado: `ArrowDown` / `ArrowUp` mueven `.ex-autocomplete__item--active`; `Enter` con un ítem
  activo lo selecciona y llama a `addExercise`.
- Guard de carrera: si el usuario siguió tipeando mientras se resolvía el fetch, el resultado viejo se descarta.
- Selección con mouse: `mousedown` con `preventDefault()` para no perder el foco.

**Detalle de orden que importa:** `initExerciseAutocomplete()` se llama **antes** que
`initFibExerciseListsUi()` a propósito. El handler de `Enter` del autocomplete usa
`stopImmediatePropagation()` para ganarle al handler de `Enter → addExercise`; si se registran
al revés, elegir una sugerencia con Enter agrega el texto crudo en lugar de la sugerencia.

---

## 9. Guardado del workout completado

### 9.1 Disparador

Es el `onCompleteBeep` del `fibonacciTimer`, o sea: se dispara **exactamente una vez**, cuando
termina la última fase de 8 minutos. En producción hace dos cosas:

```js
onCompleteBeep: () => {
  playFibCompleteSound();
  saveCompletedWorkoutToAPI();
}
```

> En producción **NO** se limpia el plan local ni la colección `currentworkouts` de forma
> independiente. Sólo se limpia la colección remota dentro del camino de éxito del POST (ver abajo).
> Las listas locales **quedan cargadas** después de completar: la próxima sesión arranca con los
> mismos ejercicios ya puestos.

### 9.2 `saveCompletedWorkoutToAPI()`

Payload:
```json
{ "date": "<ISO now>", "core": [...], "bodyweight": [...], "overload": [...], "durationSec": 1380 }
```

- **Éxito:** log `[API] Workout saved to MongoDB — id: …`, borra `dashCache_v3` de localStorage,
  y dispara `DELETE /api/current-workout/all` (fire-and-forget).
- **Respuesta no-OK:** log de warning y **encola el payload** en `pendingWorkouts_v1`.
- **Excepción de red:** log de warning y encola igual.

En ambos caminos de fallo, `currentworkouts` **no** se limpia.

Es `async` pero no se espera: un fallo de red nunca rompe la experiencia en el navegador.

### 9.3 Cola de workouts pendientes

Clave localStorage: **`pendingWorkouts_v1`** — array de payloads.

- `enqueuePendingWorkout(payload)` hace push.
- `flushPendingWorkouts()` recorre la cola, reintenta el POST de cada uno:
  - OK → log `[API] Flushed pending workout — id: …`, borra el cache del dashboard
  - no-OK o excepción → lo deja en la cola para el próximo intento
  - reescribe la cola con los que sobrevivieron
- Se llama **sólo** desde el camino de éxito de `loadCurrentWorkoutFromDB()`, es decir:
  al abrir la app con el server accesible.

---

## 10. Timer Tabata

### 10.1 Configuración

| Input | id | min | max | default |
|---|---|---|---|---|
| Work (seg) | `tabWork` | 1 | 999 | 20 |
| Rest (seg) | `tabRest` | 1 | 999 | 10 |
| Rounds | `tabRounds` | 1 | 99 | 8 |

Son `<input type="number">` dentro de `<label class="tabata-field">`, en un `#tabataConfig`.
En producción **no hay botones +/− ni label de tiempo total**.

`parsePositiveInt(input, fallback)` — cualquier valor no finito o `< 1` cae al default.

### 10.2 Secuencia

`buildTabataSequence()` genera, por cada round: `work` y después `rest`.
8 rounds ⇒ **16 segmentos** (8 work + 8 rest). Siempre termina en un `rest`.
`tabataMeta = { rounds }` se actualiza en cada `getSequence()`.

`tabataRoundFromIndex(i, R) = min(R, floor(i/2) + 1)`.

### 10.3 Render — `renderTabata(timer)`

**Completo:** `"Tabata Complete"`, `00:00`, `"Round R of R"`, progreso 100 %, fondo `done`,
inputs **habilitados**.
**Idle:** `"Ready"`, tiempo = duración del primer work, `"Round 0 of R"`, progreso 0 %,
fondo `idle`, inputs habilitados.
**Corriendo:** `"Work"`/`"Rest"`, `MM:SS`, `"Round N of R"`, progreso sobre el total de la
secuencia, fondo `work`/`rest`, **inputs deshabilitados mientras corre**.

Los fondos se aplican con `.tabata-bg-*` sobre `#tabataCard` — **no** tocan el `<body>`
(el tinte de página lo controla sólo el Fibonacci).

### 10.4 Reactividad de la config

`onTabataConfigChange()` está enganchado al evento **`change`** (no `input`) de los tres campos:
si el timer **no** está corriendo **ni** completo, hace `tabataTimer.reset()`, que llama a
`getSequence()` y reconstruye la secuencia con los valores nuevos.
Si está corriendo o completo, ignora el cambio.

### 10.5 Alcance

- Totalmente independiente del Fibonacci: estado propio, interval propio, sonidos distintos.
- **No se persiste nada.** Ni la config ni las sesiones completadas. Ningún endpoint.
- Sólo visible mientras el Fibonacci no está en idle (§7.2).

---

## 11. Dashboard

### 11.1 Carga — `loadDashboard()`

Estrategia **cache-first + revalidación en background**:

1. Lee `dashCache_v3` de localStorage → `{ workouts, patrones, ts }`
2. Hay cache → renderiza **al instante**, sin skeleton
   - cache fresco (`< 5 min`) → **corta, no toca la red**
   - cache stale → sigue y refresca en silencio
3. No hay cache → muestra skeleton (`.dash-loading` + 3 `<li class="dash-skeleton-item">`)
4. `GET /api/workouts?limit=400` + `GET /api/exercises` **en paralelo**, escribe cache, renderiza
5. Fallo de red **con** cache → no muestra error (los datos viejos siguen en pantalla)
6. Fallo de red **sin** cache → `"Could not load data — server may be offline."`
   con clase `.dash-message--error`

`fetchAllWorkouts()` acepta las dos formas de respuesta: array pelado o `{ workouts: [...] }`.
El backend hoy devuelve la segunda.
`fetchExercisePatrones()` **nunca tira error**: devuelve `null` si falla, y el dashboard se dibuja
igual pero sin la sección de balance de patrones.

**Constantes:** `DASH_CACHE_KEY = "dashCache_v3"`, `DASH_CACHE_TTL = 5 * 60 * 1000`.
El cache se invalida al guardar un workout con éxito y al vaciar la cola de pendientes.

### 11.2 Estadísticas — `computeDashStats(workouts)`

Devuelve `{ firstDate, lastDate, daysSinceLast, thisMonthCount, streak, byMonth }`.

**Sólo se pintan dos:**

| Elemento | id | Contenido |
|---|---|---|
| This Month | `dashMonthCount` | Cantidad de workouts del mes calendario actual |
| Last Workout | `dashLastDays` | `"Today"` si `daysSinceLast === 0`, si no `"Nd ago"` |

`firstDate`, `byMonth` y **`streak` se calculan pero nunca se muestran**.
`calcStreak()` está implementado y funciona (días consecutivos terminando hoy o ayer);
es una feature lista para exponer, hoy invisible.

### 11.3 Balance de patrones — `computePatronBalance(workouts, patronesByName)`

Responde "¿qué fracción de lo que programé en cada bloque fue a cada patrón?", para detectar
desbalances y corregirlos en la programación siguiente.

**Ventana:** últimos **30 días** (`PATRON_WINDOW_DAYS`), por `w.date`.
**Bloques:** sólo `bodyweight` y `overload`. El bloque `core` se omite a propósito — es 100% patrón
`core` por definición, no informa nada.

**Ponderación.** Cada ejercicio de la sesión vale **1** y lo reparte en partes iguales entre sus
patrones: un burpee (`empuje` + `rodilla_dominante`) suma 0,5 a cada uno. Así los porcentajes de
cada bloque suman 100% y se leen como fracción del volumen programado, no como presencia.

**Cruce de nombres.** Los workouts guardan el nombre **tal como se tipeó** y `exercises` lo guarda
en minúsculas: el join va por `String(raw).trim().toLowerCase()`. Sin eso falla en cualquier
ejercicio cargado con mayúsculas.

**Redondeo.** `sharesToPercent()` reparte 100 puntos enteros por el método del mayor resto.
Redondear cada porcentaje por separado daría sumas de 99 o 101.

**Fuera del cálculo.** Un ejercicio con `patrones: []` no entra en el reparto y se cuenta aparte;
si hay alguno, el bloque muestra `"N sin clasificar (fuera del cálculo)"`. Sin esa nota los
porcentajes mentirían en silencio.

**Render — `renderPatronBalance(balance)`.** La sección `#dashPatrones` se **oculta entera** si el
fetch de ejercicios falló, si no hay workouts en la ventana, o si nada quedó clasificado.
Dos cards (`.dash-patron-block--bodyweight` naranja, `--overload` verde), cada una con las 5 filas
en **orden fijo** (`empuje`, `traccion`, `rodilla_dominante`, `cadera_dominante`, `core`) — así las
dos columnas se comparan fila a fila. Etiquetas cortas: `Push` / `Pull` / `Knee` / `Hip` / `Core`.

- El track es el 100%: el **ancho de la barra ES el porcentaje**, no una escala relativa al máximo
  (a diferencia de `.dash-month__bar`).
- `.dash-patron--top` (puede haber empate) resalta el patrón más programado: barra a opacidad plena
  y texto en `--fg`.
- `.dash-patron--zero` pinta el `0%` en el color del bloque — un patrón ausente es tan accionable
  como el dominante.

### 11.4 Historial

`groupByDay(workouts)` agrupa por `YYYY-MM-DD` **en hora local** y **concatena** los ejercicios
si hubo más de un workout el mismo día. Orden: descendente por día.

Por cada día, un `<li class="dash-history__item">` con:
- `<span class="dash-history__date">` con formato `"Sat 25 Jul"` (`weekday short` + día + `month short`)
- una `<table class="dash-day-table">` con headers **`Core` / `BD` / `OV`** y tantas filas
  como el máximo entre los tres arrays (mínimo 1). Las celdas faltantes van vacías.

Sin workouts → se ocultan las cards y aparece
`"No workouts yet. Complete a Fibonacci session to start tracking!"`.

> ⚠️ Las filas se arman con **`innerHTML` interpolando los nombres de ejercicio sin escapar**
> (`script.js` ~línea 1264). Un nombre con HTML se inyecta en la página. Es un dato que entra el
> propio usuario, así que hoy es de bajo riesgo, pero conviene arreglarlo en el redesign.

---

## 12. Vista Exercises

### 12.1 Carga — `loadExercises()`

Cada visita a la pestaña: oculta el mensaje, **limpia el campo de búsqueda**, muestra skeleton
(6 filas de 4 celdas, con `<span class="ex-sk-cell">` de anchos `100/140/80/120/95/110 px`), y hace
`GET /api/exercises`. Guarda todo en `_allExercises`.
**Sin cache** — siempre pega a la red. Fallo → `"Could not load exercises — server may be offline."`.

### 12.2 Tabla

Cuatro columnas, todas clickeables para ordenar:

| Columna | `key` | Contenido |
|---|---|---|
| Exercise | `name` | nombre (guardado en minúsculas; el CSS lo capitaliza) |
| Modality | `modalidad` | `<select>` editable: `—` / `Core` / `Body` / `Over` |
| Last | `lastPerformed` | `"Jul 25"` (`month short` + día), `"—"` si es `null` |
| Days | `daysPerformed` | número, `0` si falta |

**Orden inicial:** `lastPerformed` descendente.
**Toggle:** click en la columna activa invierte la dirección; click en otra columna la activa con
dirección default (`asc` para `name` y `modalidad`, `desc` para las numéricas/fecha).
**Orden por modalidad:** `core` → `bodyweight` → `overload` (invertido en `desc`), desempate por
nombre; los **sin clasificar quedan siempre al final**, en las dos direcciones.
Indicadores: `↕` inactiva, `↑`/`↓` activa; la `<th>` activa lleva `.ex-th--active`.
El estado de orden (`_exSortKey`, `_exSortDir`) **sobrevive** al filtrado y a cambios de pestaña,
pero no a un reload.

### 12.3 Buscador

`#exSearch`, filtrado **client-side** en cada `input`: `name.includes(query.toLowerCase())`.
Contador `#exCount` = `"N total"` (siempre el total sin filtrar).
Sin resultados pero con datos cargados → `"No exercises match your search."` y el contador se vacía.

### 12.4 Clasificación manual de modalidad

Cada fila trae un `<select class="ex-mod-select">`. Al cambiarlo (`updateExerciseModalidad()`):
1. Actualiza `_allExercises` **en el acto** (optimista) y deshabilita el select.
2. `PATCH /api/exercises/<name URL-encodeado>` con `{ modalidad }` (`""` → `null`).
3. Si falla: revierte el valor anterior en memoria y en el `<select>`, y muestra
   `"Could not save modality for "<nombre>"."` en `#exMessage`.

No re-renderiza la tabla al guardar — el orden no salta bajo el dedo mientras se clasifica.
El select vacío lleva `.ex-mod-select--empty` (color apagado).

### 12.5 Alta manual de ejercicios

Formulario `#exAddForm` entre los chips y la tabla: nombre (texto, máx. 80) +
`<select>` de modalidad + botón `+`. Al ser un `<form>`, Enter también envía.

`submitNewExercise()` valida en el cliente (nombre no vacío, modalidad elegida) y
hace `POST /api/exercises`. Con la respuesta: mete el ejercicio en `_allExercises`,
lo suma al cache del autocompletado, limpia el formulario, re-renderiza, avisa por
toast y trae la fila nueva a la vista destellando — que si no, con el orden por
`lastPerformed` queda al fondo de la lista, invisible.

| Caso | Aviso |
|---|---|
| Nombre vacío | `Escribí un nombre` |
| Sin modalidad | `Elegí una modalidad` |
| Ya existe (409) | `"<nombre>" ya existe` |
| Falla la red | `No se pudo guardar — servidor caído?` |

### 12.6 Click en la fila → suma al plan de la sesión

Cada `<tr>` es `role="button"` + `tabIndex=0` y responde a click y a Enter/Espacio.
`addExerciseFromList()` suma el ejercicio al bloque de su `modalidad` vía
`addExerciseToPlan()` — el mismo camino que usa el input del Timer (memoria +
localStorage + `POST /api/current-workout`), así que el plan queda sincronizado
entre dispositivos igual que si se hubiera tipeado.

Tres casos en los que **no** agrega, cada uno con su aviso:
| Caso | Aviso |
|---|---|
| El ejercicio no tiene `modalidad` | `"<nombre>" no tiene modalidad asignada` |
| Ya está en ese bloque del plan | `Ya está en <BLOQUE>` |
| Click sobre el `<select>` de modalidad | (ninguno — se ignora el evento) |

El `<select>` se excluye con `e.target.closest(".ex-mod-select")`, para que clasificar
no dispare un alta sin querer.

**Feedback:** `#exToast`, un aviso flotante `position: fixed` abajo y centrado, visible
sin importar el scroll de la lista. Dura 2,2 s y se desvanece. Variante `--warn` (gris)
para los casos que no agregan. Además la fila destella con `.ex-row--added` (0,6 s).
El duplicado se chequea sólo acá; el input del Timer sigue permitiendo repetir.

> Mismo detalle de `innerHTML` sin escapar en las filas de la tabla.

---

## 13. Audio y vibración

Helper compartido `playTone(freqHz, durationMs, gain = 0.07)`: crea un `AudioContext` nuevo por
tono, oscilador **sine**, y **cierra el contexto** en `onended`. Si el navegador no soporta
`AudioContext`, sale sin hacer nada.

| Evento | Sonido | Vibración |
|---|---|---|
| Fibonacci — cambio de fase | 880 Hz, 160 ms | `70 ms` |
| Fibonacci — completo | 880 Hz 120 ms, y a los 140 ms 1174 Hz 180 ms (gain 0.08) | `[90,45,90,45,140]` |
| Tabata — cambio de fase | 660 Hz, 150 ms | `70 ms` |
| Tabata — completo | 660 Hz 110 ms, y a los 120 ms 880 Hz 200 ms (gain 0.08) | `[90,45,90,45,140]` |

Las frecuencias del Tabata son deliberadamente **más graves** para poder distinguir de oído qué
timer sonó cuando corren los dos a la vez. `navigator.vibrate` va con guard de soporte.

**Limitación real:** no hay cuenta regresiva de 3-2-1 antes de cada cambio; el beep suena
**cuando la fase ya cambió**.

---

## 14. PWA

### 14.1 Service worker (`workout-timer-pwa-v11`)

- **Precache en `install`:** `./index.html`, `./styles.css`, `./script.js`, `./manifest.json`,
  `./icons/icon-192.png`, `./icons/icon-512.png` (resueltos contra `registration.scope`), + `skipWaiting()`.
- **`activate`:** borra todos los caches cuyo nombre no sea el actual, + `clients.claim()`.
- **`fetch`:** ignora todo lo que no sea `GET`; ignora todo lo que **no sea same-origin**.
  Cache-first: si hay copia cacheada la devuelve; si no y es una navegación, cae al `index.html`
  cacheado; si no, va a la red (y **no** cachea la respuesta nueva).

**Implicancias:**
- Las llamadas a Railway son cross-origin ⇒ **nunca pasan por el SW**. La app abre offline pero
  sin datos: el dashboard vive del cache de localStorage y el plan de las listas locales.
- Cache-first sin revalidación ⇒ hay que **bumpear `CACHE_NAME` a mano en cada deploy**,
  si no los usuarios instalados siguen con los archivos viejos.
- Producción **no** tiene listener de `controllerchange`: tras activarse un SW nuevo, el usuario
  necesita recargar (o cerrar y reabrir la app) para ver la versión nueva.

### 14.2 Manifest

```json
{ "name": "Fibonacci Workout Timer", "short_name": "Workout Timer",
  "start_url": ".", "display": "standalone",
  "background_color": "#000000", "theme_color": "#000000",
  "icons": [ 192x192 any, 512x512 any ] }
```
`<meta name="theme-color" content="#000000">`. Íconos declarados `purpose: "any"` — **no hay
ícono maskable**, en Android el ícono no se recorta a la forma del sistema.

### 14.3 Botón de instalación

`#installAppBtn`, oculto por default. Se muestra al capturar `beforeinstallprompt`
(con `preventDefault()`, guardando el evento). Al hacer click: `prompt()`, espera `userChoice`,
descarta el evento y se vuelve a ocultar. También se oculta con el evento `appinstalled`.
Posición: fijo, centrado arriba (`position: fixed; top: .75rem; left: 50%`).
En iOS Safari el evento no existe ⇒ el botón nunca aparece; se instala con "Agregar a inicio".

---

## 15. Sistema de diseño actual (para saber de qué se parte)

Estética: **neumorfismo oscuro**, cálido, con sombras dobles.

### Tokens (`:root` de `styles.css`)

```
Superficies   --bg #1a1a1d   --bg-deep #141416   --surface #1f1f23
              --surface-2 #25252a   --surface-3 #2b2b30
Acento cálido --accent-warm #d97548   --accent-warm-hi #e8855a   --accent-warm-lo #b85e36   (WORK / primario)
Acento frío   --accent-cool #5a8064   --accent-cool-hi #6f9779   --accent-cool-lo #466150   (REST / éxito)
Completado    --accent-done #7b7fba
Texto         --fg #e8e6e3   --fg-mute #a09e9b   --fg-dim #6b6967
Sombras       --sh-light rgba(255,255,255,.04)   --sh-dark rgba(0,0,0,.55)  (+ variantes -hi)
Presets       --raised  --raised-sm  --inset  --inset-deep  --pressed
Dial          --dial-size 260px  --dial-inner 210px  --dial-sm 190px  --dial-inner-sm 150px
Radios        --r-sm 8  --r-md 12  --r-lg 18  --r-xl 26
Tipografía    --font-ui 'Inter'   --font-num 'JetBrains Mono'
```

### Layout

- Nav sticky arriba (`z-index: 500`) con 3 pills.
- `.timer-view-layout`: flex con wrap, gap `1.5rem`, padding `1.25rem`.
  - `.fib-section`: `flex 1 1 340px`, `max-width 520px`
  - `.tabata-panel`: `flex 1 1 260px`, `max-width 340px`
  - ⇒ en desktop con el timer corriendo, **dos columnas lado a lado**
- `#view-timer.timer-running` reduce las custom properties del dial (modo compacto).
- **≤ 680 px**: ambas secciones a `flex-basis: 100%` ⇒ **apilado vertical**, Tabata debajo del
  Fibonacci; dial a `195px`; tipografías y paddings reducidos.
- El tiempo usa `clamp()` para escalar con el viewport.

### Elementos característicos
Dial circular con anillo interno tintado según fase (no es un anillo de progreso animado — el
progreso vive en la barra lineal), pill de estado con punto luminoso (`● WORK`), botones
neumórficos con estados raised/pressed, barra de progreso lineal, tabla de historial embebida
por día.

---

## 16. Inventario completo de identificadores

### IDs del DOM

**Globales:** `installAppBtn`

**Timer / Fibonacci:** `view-timer`, `fibonacciCard`, `fibTitle`, `dbSyncStatus`,
`fibInputCore`, `fibInputBodyweight`, `fibInputOverload`,
`fibListCore`, `fibListBodyweight`, `fibListOverload`,
`fibTimerDisplay`, `blockLabel`, `phaseLabel`, `fibCurrentExercise`, `timeLabel`,
`fibCountdown`, `fibEndsAt`, `progressBar`,
`fibSummary`, `fibSummaryToggle`, `fibSummaryLabel`, `fibSummaryBody`,
`startBtn`, `pauseBtn`, `resetBtn`

**Tabata:** `tabataPanel`, `tabataCard`, `tabataHeading`, `tabataConfig`,
`tabWork`, `tabRest`, `tabRounds`,
`tabRoundLabel`, `tabPhaseLabel`, `tabTimeLabel`, `tabProgressBar`,
`tabStartBtn`, `tabPauseBtn`, `tabResetBtn`

**Dashboard:** `view-dashboard`, `dashCards`, `dashMonthCount`, `dashLastDays`,
`dashHistoryList`, `dashMessage`

**Exercises:** `view-exercises`, `exCount`, `exSearch`, `exList`, `exMessage`

### Clases con significado funcional (no sólo estética)

`.app-view`, `.nav-btn`, `.nav-btn--active`, `.timer-running`,
`.fib-bg-idle|work|rest|done`, `.tabata-bg-idle|work|rest|done`,
`.page-idle|page-work|page-rest|page-done` (en `<body>`),
`.fib-summary--open`, `.dash-loading`, `.dash-skeleton-item`, `.dash-message--error`,
`.ex-autocomplete`, `.ex-autocomplete__item`, `.ex-autocomplete__item--active`, `.ex-match`,
`.ex-th`, `.ex-th--active`, `.ex-arrow`, `.ex-sk-cell`

### Atributos de datos
`data-view` (nav), `data-fib-block` (contenedor de bloque), `data-fib-add` (botón `+`)

### Claves de localStorage
`fibWorkoutExerciseListCore`, `fibWorkoutExerciseListBodyweight`, `fibWorkoutExerciseListOverload`,
`fibWorkoutExerciseCore` / `Bodyweight` / `Overload` (legacy),
`dashCache_v3`, `pendingWorkouts_v1`

### Constantes de JS
`FIB_SEQUENCE`, `FIB_TOTAL_SEC` (1380), `FIB_TOTAL_BLOCKS` (5), `FIB_BLOCK_TYPES`,
`FIB_EXERCISE_LIST_STORAGE_KEYS`, `FIB_EXERCISE_LEGACY_SINGLE_KEYS`, `FIB_FALLBACK_BLOCK_LABEL`,
`FIB_BLOCK_LABELS`, `API_BASE_URL`, `PENDING_WORKOUTS_KEY`, `DASH_CACHE_KEY`, `DASH_CACHE_TTL`,
`MONTH_NAMES`

### Orden de inicialización al cargar (importa)
```
registerServiceWorker()          → registra en el evento 'load'
initExerciseAutocomplete()       → ANTES que initFibExerciseListsUi (ver §8.7)
initFibExerciseListsUi()         → carga localStorage, pinta listas, engancha + y Enter
fibonacciResetUi()               → primer render del Fibonacci
tabataTimer.reset()              → primer render del Tabata
loadCurrentWorkoutFromDB()       → sync remoto (async) + flush de pendientes
initNavigation()
initExercisesSearch()
```

---

## 17. Comportamientos sutiles que el redesign no debe romper

1. **El Tabata sólo aparece con el Fibonacci activo.** Es el modelo de interacción actual (§7.2).
2. **Pausado ≠ idle.** Con el Fibonacci pausado el botón Start queda habilitado y funciona como
   Resume, y la vista sigue siendo la de running, no la de setup.
3. **La DB pisa a localStorage al arrancar.** Si el `GET /api/current-workout` sale bien, lo que
   había local se descarta. Si falla, lo local sobrevive.
4. **El plan NO se limpia al completar** (en producción). Las listas locales quedan pobladas para
   la próxima sesión; la colección remota se limpia sólo si el POST del workout salió bien.
5. **`durationSec` guardado = 1380.** Cambiar la secuencia cambia el dato histórico. Los registros
   viejos de la época de Render tienen otros valores.
6. **Los bloques se detectan por duración** (180/300/480), no por índice.
7. **El beep suena después del cambio de fase**, no antes.
8. **El timer usa reloj de pared** — no reimplementar con un contador incremental de ticks.
9. **Los inputs del Tabata se bloquean mientras corre** y se reactivan al completar o resetear.
10. **El `change` del Tabata resetea el timer** sólo si está idle.
11. **El autocomplete filtra por substring**, no por prefijo, y corta en 8 resultados.
12. **La búsqueda de Exercises se limpia** en cada visita a la pestaña; el orden no.
13. **El cache del dashboard se invalida** al guardar un workout y al vaciar pendientes.
14. **`CACHE_NAME` del service worker se bumpea a mano** en cada deploy.
15. **Sin auth, sin usuarios.** La API es pública y global: un solo "usuario" implícito.
16. **Todos los textos de UI están en inglés**, aunque los nombres de ejercicios que carga el
    usuario estén en español.

---

## 18. Limitaciones y deuda conocidas de producción

| # | Tema | Detalle |
|---|---|---|
| 1 | XSS | `renderDashboard` y `renderExercises` interpolan nombres de ejercicio con `innerHTML` sin escapar |
| 2 | API abierta | CORS wildcard, sin auth, sin rate limiting. Cualquiera puede leer/escribir la DB |
| 3 | Streak invisible | `calcStreak()` se calcula en cada render del dashboard y nunca se muestra |
| 4 | Código muerto | `dashFormatDate`, `formatFibonacciHumanTotal`, `saveToLocalStorage`, `loadFromLocalStorage`, y los alias `coreExercises` / `bodyweightExercises` / `overloadExercises` no se usan en ningún lado |
| 5 | Sin wake lock | La pantalla se apaga durante el entrenamiento; no se usa `navigator.wakeLock` |
| 6 | Timers en background | El reloj de pared mantiene la cuenta exacta, pero con la pestaña en background el navegador estrangula el interval: las transiciones de fase (y su beep) pueden dispararse con retraso |
| 7 | `Ends at` congelado | No se recalcula al pausar (§7.7) |
| 8 | Plan huérfano | Si el POST del workout falla, `currentworkouts` no se limpia y el plan viejo reaparece en la próxima sesión |
| 9 | Tabata sin persistencia | No se guarda config ni sesiones completadas |
| 10 | Sin ícono maskable | El manifest sólo declara `purpose: "any"` |
| 11 | Sin cache-busting automático | Cache-first sin revalidación + sin `controllerchange` ⇒ los usuarios instalados pueden quedarse con una versión vieja hasta que recarguen |
| 12 | Sin edición | No se puede renombrar ni reordenar un ejercicio del plan: sólo agregar y borrar |
| 13 | Sin borrado de historial | No hay UI para borrar ni editar un workout ya guardado |
| 14 | Endpoints sin usar | `GET /api/workouts/:id` y `POST /api/exercises/backfill` no se llaman desde el frontend |

---

## 19. Checklist de aceptación para el redesign

Un redesign está completo cuando **todo** esto sigue funcionando:

**Timer Fibonacci**
- [ ] Secuencia exacta de 9 fases, 1380 s totales
- [ ] Start / Pause / Resume / Reset, con los estados `disabled` correctos
- [ ] Label de bloque `N de 5`, label de fase Work/Rest/Complete
- [ ] Tiempo de la fase actual en `MM:SS`
- [ ] Cuenta regresiva del total de la sesión
- [ ] `Ends at: HH:MM`
- [ ] Ejercicio(s) del bloque actual, con fallback a Warm-up / Rest / nombre del bloque
- [ ] Barra de progreso de la sesión completa
- [ ] Fondo de página que cambia por fase (idle / work / rest / done)
- [ ] Panel colapsable de plan, que se repuebla y se colapsa en cada Start

**Plan de ejercicios**
- [ ] Tres bloques (Core 3 min / Bodyweight 5 min / Overload 8 min)
- [ ] Agregar con botón y con Enter; quitar con `×`
- [ ] Persistencia en localStorage + migración de las claves legacy
- [ ] Sync bidireccional con `currentworkouts` (POST al agregar, DELETE al quitar)
- [ ] Sync al arrancar, con la DB como autoritativa, y mensaje de estado visible
- [ ] Autocomplete con substring, resaltado, teclado y máx. 8 resultados

**Persistencia**
- [ ] POST del workout al completar, con `durationSec` correcto
- [ ] Cola `pendingWorkouts_v1` con flush al arrancar
- [ ] Invalidación del cache del dashboard

**Tabata**
- [ ] Work / Rest / Rounds configurables con sus min-max
- [ ] Round N de R, fase, tiempo, barra de progreso
- [ ] Inputs bloqueados mientras corre
- [ ] Reset automático al cambiar la config estando idle
- [ ] Sonidos y vibraciones distintos de los del Fibonacci

**Dashboard**
- [ ] This Month + Last Workout
- [ ] Historial por día con tabla Core / BD / OV
- [ ] Cache de 5 min con revalidación en background
- [ ] Skeleton en la primera carga y mensajes de vacío / error

**Exercises**
- [ ] Tabla con las 3 columnas ordenables y sus indicadores
- [ ] Buscador client-side, contador de total
- [ ] Skeleton y mensajes de vacío / error

**Plataforma**
- [ ] Navegación entre las 3 vistas, con recarga de datos al entrar
- [ ] Service worker con precache y `CACHE_NAME` bumpeado
- [ ] Manifest e íconos válidos
- [ ] Botón de instalación PWA
- [ ] Audio + vibración en todas las transiciones
- [ ] Layout usable en mobile (el uso real es en el celular, apilado vertical)
