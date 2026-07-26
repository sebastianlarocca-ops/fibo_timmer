# v2 — versión de prueba del redesign

Front rediseñado (Raw Energy), **funcionalmente equivalente a producción**.
Autocontenido: no toca la raíz del repo ni el backend.

## Cómo levantarlo

```bash
npx serve v2
```

Se sirve en `http://localhost:3000` (o el puerto que asigne). Está configurado en
`.claude/launch.json` como `fitness-timer-v2`.

## Guardia de escritura

Mientras `DEV_BLOCK_WORKOUT_SAVE = true` en `script.js`:

- **`POST /api/workouts` NO se ejecuta.** Al completar un workout se loguea en consola
  el payload exacto que se habría mandado y se corta ahí.
- El payload **tampoco se encola** en `pendingWorkouts_v1` — si se encolara, se
  terminaría escribiendo en producción en el próximo arranque.
- `flushPendingWorkouts()` también queda bloqueado.
- Una banda amarilla fija abajo lo recuerda en todo momento.

Todo lo demás **sí** le pega a la API real de Railway: sync del plan, dashboard,
exercises y autocomplete trabajan contra datos de producción de verdad.

Las escrituras de `current-workout` (agregar/quitar un ejercicio del plan) **sí pasan**.
Es una colección efímera y se limpia sola, pero tenelo presente.

Para probar el guardado real, una de estas dos:

```js
window.__ALLOW_WORKOUT_SAVE = true   // desde la consola, sin tocar el archivo
```

o poner `DEV_BLOCK_WORKOUT_SAVE = false` en `script.js`.

## Qué se corrigió respecto de la rama `redesign`

| # | Problema | Corrección |
|---|---|---|
| 1 | `TAB_RING_C` se usaba antes de declararse → `ReferenceError` que abortaba el script y rompía 13 funcionalidades | Todas las invocaciones top-level se centralizaron en `bootstrap()`, al final del archivo |
| 2 | `controllerchange` + `clients.claim()` → loop de recargas | Se ignora el primer `controllerchange` cuando la página cargó sin controller, + flag anti-doble-disparo |
| 3 | Al completar el Tabata se ocultaba el display de running → nunca se veía "Tabata Complete" | Se mantiene visible; la config vuelve con Reset |
| 4 | La barra "SESSION PLAN" decía `16 MIN` hardcodeado | Se deriva de `FIB_SEQUENCE` → `23 MIN`, la duración real de la sesión |
| 5 | Dashboard y Exercises interpolaban nombres de ejercicio con `innerHTML` sin escapar (heredado de producción) | Reescritos con `createElement` + `textContent` |
| 6 | **El anillo nunca cambiaba de color entre work y rest.** El JS lo pintaba con `setAttribute("stroke", …)`, pero los atributos de presentación de SVG pierden contra cualquier regla CSS, y `.ring-progress` fija `stroke` en la hoja de estilos. El anillo quedaba clavado en el gradiente de work | `paintRing()` usa `style.stroke` (inline), que sí gana |

## Semántica de color

**WORK = verde · REST = naranja**, en el timer principal y en el Tabata, para la tag,
el anillo, la barra de progreso, el texto del ejercicio y el tinte de página.

Vive en los tokens `--phase-work*` / `--phase-rest*` de `styles.css`, deliberadamente
separados del acento de marca (`--work*` / `--rest*`), que sigue siendo naranja para
nav, inputs, chips, cards y el botón primario. Si algún día cambia el naranja de la
identidad, los colores de fase no se mueven.

Cualquier regla nueva que dependa de la fase tiene que usar `--phase-*`, nunca `--work`/`--rest`.

## Sonido

Los avisos eran muy bajos por tres razones acumuladas, todas en el código —
ninguna tenía que ver con el volumen del dispositivo:

| | Antes | Ahora |
|---|---|---|
| Ganancia | `0.07` (7% de amplitud) | `0.9` con compresor/limitador al final |
| Onda | `sine` — sin armónicos, se tapa con cualquier ruido | `square` filtrado — atraviesa el ruido ambiente |
| Frecuencia | 880 / 660 Hz, debajo de la banda sensible del oído | 1.3–3.1 kHz, dentro de los 2–5 kHz donde más se percibe |
| Patrón | un pulso único | 2 pulsos en cambio de fase, 4 ascendentes al completar |

Medido con `OfflineAudioContext`: **+22.2 dB de pico** y **+18.5 dB de RMS**.
Pico final ~0.90 (sin saturar); el compresor solo aplica 0.3–1.6 dB de reducción,
funcionando como red de seguridad y no como efecto.

Se mantiene la relación original: el Fibonacci suena más agudo que el Tabata, para
distinguir de oído cuál de los dos avisó cuando corren juntos.

**Volumen:** `BEEP_VOLUME` en `script.js` (0..1). Está en 0.9 — el pico ya llega
a −0.9 dBFS, o sea prácticamente el máximo digital. Para más volumen no queda
margen en la app: hay que subir el del dispositivo.

**Probar los cuatro avisos** sin esperar un cambio de fase, desde la consola:

```js
__testSounds()
```

Un solo `AudioContext` compartido para toda la app, creado/reanudado en el click de
Start (`primeAudio()`). El código anterior creaba y cerraba un contexto por tono:
los navegadores limitan cuántos podés tener abiertos y uno creado sin gesto del
usuario arranca suspendido y no suena.

### Limitaciones que no dependen del código

- **iPhone con el switch de silencio activado:** Web Audio queda muteado. Es del sistema.
- **Pantalla bloqueada o app en segundo plano:** el navegador estrangula los timers
  y puede suspender el audio. Es la limitación de background que ya tenía producción.

## Controles

Dos slots. El primario alterna Start/Pause en el mismo lugar (nunca visibles a la vez)
y Reset sólo existe con una sesión en curso:

| Estado | Botones |
|---|---|
| Sin arrancar | sólo **Start** |
| Corriendo | **Pause** + Reset |
| Pausado | **Start** + Reset |
| Completo | **Start** + Reset |

Aplica igual al timer principal y al Tabata. La lógica está en `updateTimerControls()`,
llamada desde las tres ramas de `renderFibonacci()` y `renderTabata()`.

Tabata arranca por default en **6 vueltas** (antes 8).

## Diferencia de comportamiento deliberada vs producción

Al completar un workout, v2 **limpia el plan de ejercicios** (listas locales +
colección `currentworkouts`), y lo hace **independientemente de si el POST del workout
salió bien**.

Producción no hace esto: sólo limpia la colección remota dentro del camino de éxito del
POST, y nunca limpia las listas locales. Eso es lo que causa el bug del "plan huérfano"
(limitación #8 de `PRODUCTION_SPEC.md`): si falla la red al guardar, el plan viejo
reaparece en la sesión siguiente.

Viene de la rama `redesign` y se conservó por ser una mejora real. **Es la única
diferencia de comportamiento intencional.** Si preferís paridad estricta, sacar
`clearCurrentWorkoutCollection()` y `resetFibExercisePlan()` del `onCompleteBeep`
del `fibonacciTimer`.

## Antes de promover a producción

1. Borrar el bloque `DEV_BLOCK_WORKOUT_SAVE` de `script.js` y sus tres usos
   (`saveCompletedWorkoutToAPI`, `flushPendingWorkouts`, `renderDevGuardBadge`).
2. Borrar el bloque `#devGuardBadge` del final de `styles.css`.
3. Borrar `renderDevGuardBadge()` de `bootstrap()`.
4. **No copiar `serve.json` ni este `README.md`** a la raíz.
5. Poner `CACHE_NAME` en `service-worker.js` con el número que sigue al de producción
   (producción está en `workout-timer-pwa-v11`).
6. Copiar `index.html`, `styles.css`, `script.js`, `service-worker.js` a la raíz.
   `manifest.json`, `favicon.svg` e `icons/` son idénticos a los de la raíz.

## Nota sobre `serve.json`

`serve` por default hace un 301 de `/index.html` → `/`. `cache.addAll()` del service
worker rechaza respuestas redirigidas, así que la instalación del SW fallaba en loop.
`serve.json` desactiva `cleanUrls` para evitarlo.

Es un artefacto del servidor local: Vercel sirve `/index.html` con 200 directo, por eso
producción nunca tuvo este problema. **Este archivo no va a producción.**
