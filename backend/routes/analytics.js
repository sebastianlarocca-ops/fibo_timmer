const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const Workout = require("../models/workout");
const Exercise = require("../models/exercise");
const { readParams, buildRecommendation } = require("../utils/recommendation");
const { dayKey, diasDeCalendario } = require("../utils/dias");

const PATRONES = Exercise.PATRONES; // empuje, traccion, rodilla_dominante, cadera_dominante, core
const BLOQUES = ["core", "bodyweight", "overload"];

// Ventanas (en días) sobre las que se reporta frecuencia por patrón.
const VENTANAS = [7, 14, 28];

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Token opcional. Si la env var ANALYTICS_TOKEN está definida, el endpoint
 * exige `?token=<valor>`. Si no está definida, queda abierto — igual que el
 * resto de la API hoy. Se compara con longitud fija para no filtrar el token
 * por timing.
 */
function checkToken(req, res) {
  const expected = process.env.ANALYTICS_TOKEN;
  if (!expected) return true;

  const got = String(req.query.token || "");
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    res.status(401).json({ error: "Invalid or missing token." });
    return false;
  }
  return true;
}

function normalize(name) {
  return String(name ?? "").trim().toLowerCase();
}

function toIntParam(value, { def, min, max }) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

/**
 * Días de calendario en la zona del usuario, no bloques de 24h transcurridas.
 * El porqué está en utils/dias.js; acá sólo se le pone el nombre que ya usaba
 * el resto del archivo.
 */
const daysAgo = diasDeCalendario;

function round(n, decimals = 2) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

// ---------------------------------------------------------------------------
// GET /api/analytics/history
//
// Devuelve el histórico ya cruzado con los patrones de movimiento, agregado y
// compacto — pensado para que un agente lo lea entero sin truncarse.
//
// Query params
//   ?sessions=N  cuántas sesiones recientes detallar   (def 15, máx 60)
//   ?days=N      ventana del análisis por patrón       (def 90, máx 730)
//   ?token=...   requerido sólo si ANALYTICS_TOKEN está seteada
//
// Este endpoint NO recomienda nada: sólo expone los hechos. La lógica de
// recomendación vive fuera, para poder cambiarla sin tocar ni redeployar la API.
// ---------------------------------------------------------------------------
router.get("/history", async (req, res) => {
  if (!checkToken(req, res)) return;

  try {
    const nSessions = toIntParam(req.query.sessions, { def: 15, min: 1, max: 60 });
    const windowDays = toIntParam(req.query.days, { def: 90, min: 7, max: 730 });

    const now = Date.now();
    const windowStart = new Date(now - windowDays * DIA_MS);

    // Tope duro: el análisis mira como mucho las últimas 1000 sesiones. El
    // total real se cuenta aparte para que el resumen no mienta si algún día
    // se pasa de ese tope.
    const MAX_DOCS = 1000;

    const [workouts, exercises, totalWorkouts] = await Promise.all([
      Workout.find().sort({ date: -1 }).limit(MAX_DOCS).select("-__v").lean(),
      Exercise.find().select("name patrones modalidad lastPerformed daysPerformed link -_id").lean(),
      Workout.countDocuments(),
    ]);

    // ---- Índice ejercicio → patrones -------------------------------------
    const patronesByName = new Map();
    exercises.forEach((ex) => patronesByName.set(normalize(ex.name), ex.patrones || []));

    // Ejercicios que aparecen en workouts pero no están en la colección, o que
    // están sin clasificar. Es el punto ciego del análisis: si crece, las
    // recomendaciones pierden base.
    const sinClasificar = new Set();

    /** Devuelve los patrones de un nombre suelto, registrando los huérfanos. */
    function patronesDe(name) {
      const key = normalize(name);
      if (!key) return [];
      const p = patronesByName.get(key);
      if (!p || !p.length) {
        sinClasificar.add(key);
        return [];
      }
      return p;
    }

    /** Todos los nombres de ejercicio de un workout, con su bloque. */
    function slotsDe(workout) {
      const slots = [];
      BLOQUES.forEach((bloque) => {
        (workout[bloque] || []).forEach((name) => {
          const key = normalize(name);
          if (key) slots.push({ bloque, name: key, patrones: patronesDe(key) });
        });
      });
      return slots;
    }

    // ---- Sesiones recientes en detalle -----------------------------------
    const recentSessions = workouts.slice(0, nSessions).map((w) => {
      const slots = slotsDe(w);

      // Patrones tocados en esta sesión, con cuántos ejercicios los trabajan.
      const patrones = {};
      slots.forEach((s) =>
        s.patrones.forEach((p) => {
          patrones[p] = (patrones[p] || 0) + 1;
        })
      );

      const session = {
        id: String(w._id),
        date: new Date(w.date).toISOString(),
        daysAgo: daysAgo(w.date, now),
        durationSec: w.durationSec ?? null,
        // Los documentos viejos no tienen el campo: son todos de fuerza.
        type: w.type || "strength",
        core: w.core || [],
        bodyweight: w.bodyweight || [],
        overload: w.overload || [],
        patrones,
        sinClasificar: slots.filter((s) => !s.patrones.length).map((s) => s.name),
      };

      // La carga real es opcional (el form se puede saltear).
      if (w.performance) {
        session.performance = {
          rounds: w.performance.rounds || null,
          entries: (w.performance.entries || []).map((e) => ({
            name: e.name,
            block: e.block,
            reps: e.reps,
            weightKg: e.weightKg,
          })),
        };
      }

      return session;
    });

    // ---- Estadística por patrón ------------------------------------------
    // Un patrón "se trabajó" en una sesión si al menos un ejercicio lo cubre.
    // Se cuentan además los slots, que es la medida real de volumen: una sesión
    // con tres ejercicios de cadera no es lo mismo que una con uno solo.
    const patternStats = {};
    PATRONES.forEach((p) => {
      patternStats[p] = {
        lastDate: null,
        daysSinceLast: null,
        sessionsTotal: 0,
        slotsTotal: 0,
        sessionsInWindow: 0,
        slotsInWindow: 0,
        shareInWindow: 0,
        perWeekInWindow: 0,
        byBlock: { core: 0, bodyweight: 0, overload: 0 },
      };
      VENTANAS.forEach((d) => {
        patternStats[p][`sessionsLast${d}d`] = 0;
      });
    });

    let sessionsInWindow = 0;

    workouts.forEach((w) => {
      const when = new Date(w.date);
      const inWindow = when >= windowStart;
      const age = daysAgo(w.date, now);
      if (inWindow) sessionsInWindow += 1;

      const slots = slotsDe(w);
      const patronesEnSesion = new Set();

      slots.forEach((s) =>
        s.patrones.forEach((p) => {
          if (!patternStats[p]) return;
          patronesEnSesion.add(p);
          patternStats[p].slotsTotal += 1;
          patternStats[p].byBlock[s.bloque] += 1;
          if (inWindow) patternStats[p].slotsInWindow += 1;
        })
      );

      patronesEnSesion.forEach((p) => {
        const st = patternStats[p];
        st.sessionsTotal += 1;
        if (inWindow) st.sessionsInWindow += 1;
        VENTANAS.forEach((d) => {
          if (age < d) st[`sessionsLast${d}d`] += 1;
        });
        // `workouts` viene ordenado desc, así que el primero que toca el patrón
        // es el más reciente.
        if (st.lastDate === null) {
          st.lastDate = when.toISOString();
          st.daysSinceLast = age;
        }
      });
    });

    const totalSlotsInWindow = PATRONES.reduce(
      (acc, p) => acc + patternStats[p].slotsInWindow,
      0
    );
    const weeksInWindow = windowDays / 7;

    PATRONES.forEach((p) => {
      const st = patternStats[p];
      st.shareInWindow = totalSlotsInWindow
        ? round(st.slotsInWindow / totalSlotsInWindow, 3)
        : 0;
      st.perWeekInWindow = round(st.sessionsInWindow / weeksInWindow, 2);
    });

    // ---- Cadencia de entrenamiento ---------------------------------------
    // Días distintos con entrenamiento, y el hueco entre sesiones consecutivas.
    const fechas = workouts.map((w) => new Date(w.date).getTime()).sort((a, b) => b - a);
    const gaps = [];
    for (let i = 0; i < fechas.length - 1; i++) {
      gaps.push(round((fechas[i] - fechas[i + 1]) / DIA_MS, 1));
    }
    const gapsRecientes = gaps.slice(0, 10);
    const avgGap = gapsRecientes.length
      ? round(gapsRecientes.reduce((a, b) => a + b, 0) / gapsRecientes.length, 1)
      : null;

    const diasConEntrenamiento = new Set(workouts.map((w) => dayKey(w.date)));

    // ---- Catálogo de ejercicios disponibles ------------------------------
    // Con esto se puede armar la sesión concreta, no sólo decir "tocá tracción".
    const catalogo = exercises
      .map((ex) => ({
        name: ex.name,
        patrones: ex.patrones || [],
        modalidad: ex.modalidad,
        daysPerformed: ex.daysPerformed || 0,
        daysSinceLast: ex.lastPerformed ? daysAgo(ex.lastPerformed, now) : null,
      }))
      .sort((a, b) => {
        // Primero los más "descansados": nunca hechos, después por antigüedad.
        const av = a.daysSinceLast === null ? Infinity : a.daysSinceLast;
        const bv = b.daysSinceLast === null ? Infinity : b.daysSinceLast;
        return bv - av;
      });

    return res.json({
      generatedAt: new Date(now).toISOString(),
      window: { days: windowDays, from: windowStart.toISOString() },
      summary: {
        totalWorkouts,
        analyzedWorkouts: workouts.length,
        distinctTrainingDays: diasConEntrenamiento.size,
        firstWorkout: workouts.length
          ? new Date(workouts[workouts.length - 1].date).toISOString()
          : null,
        lastWorkout: workouts.length ? new Date(workouts[0].date).toISOString() : null,
        daysSinceLastWorkout: workouts.length ? daysAgo(workouts[0].date, now) : null,
        sessionsInWindow,
        avgGapDaysLast10: avgGap,
        recentGapsDays: gapsRecientes,
        exercisesInCatalog: exercises.length,
        exercisesUnclassified: [...sinClasificar],
      },
      patternStats,
      recentSessions,
      catalogo,
    });
  } catch (err) {
    console.error("[GET /api/analytics/history] error:", err.message);
    return res.status(500).json({ error: "Failed to build analytics history." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/analytics/pulse
//
// Versión mínima: sólo lo necesario para responder "¿hay algo nuevo?" sin
// traerse el histórico entero. Pensada para el chequeo diario.
// ---------------------------------------------------------------------------
router.get("/pulse", async (req, res) => {
  if (!checkToken(req, res)) return;

  try {
    const now = Date.now();
    const [last, total] = await Promise.all([
      Workout.findOne().sort({ date: -1 }).select("date updatedAt").lean(),
      Workout.countDocuments(),
    ]);

    return res.json({
      generatedAt: new Date(now).toISOString(),
      totalWorkouts: total,
      lastWorkoutId: last ? String(last._id) : null,
      lastWorkoutDate: last ? new Date(last.date).toISOString() : null,
      lastWorkoutUpdatedAt: last?.updatedAt ? new Date(last.updatedAt).toISOString() : null,
      daysSinceLastWorkout: last ? daysAgo(last.date, now) : null,
    });
  } catch (err) {
    console.error("[GET /api/analytics/pulse] error:", err.message);
    return res.status(500).json({ error: "Failed to build pulse." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/analytics/recommendation
//
// Recomendación del próximo entrenamiento por balance de patrones.
// Toda la parametrización del motor va por query string, así que ajustar los
// criterios NO requiere redeploy. Ver DEFAULTS en utils/recommendation.js:
//
//   windowSessions=12     últimas N sesiones que se miran
//   maxAgeDays=60         se descartan las sesiones más viejas que esto
//   recoveryDays=7        días hasta que un patrón cuenta como "descansado"
//   wBalance=0.65         peso del déficit de balance   (se normaliza con wFresh)
//   wFresh=0.35           peso de la frescura
//   correctivePattern=traccion   patrón con refuerzo correctivo ("none" lo apaga)
//   correctiveFactor=1.5  cuánto se amplifica su déficit mientras esté por debajo
//   maxNew=2              tope de ejercicios sin estrenar por sesión
//   avoidLastSessions=1   no repetir ejercicios de las últimas N sesiones
//   slotsCore=1 slotsBodyweight=2 slotsOverload=2
//   alternatives=2        recambios que se ofrecen por slot
// ---------------------------------------------------------------------------
router.get("/recommendation", async (req, res) => {
  if (!checkToken(req, res)) return;

  try {
    const params = readParams(req.query);

    // Las sesiones de running quedan afuera del motor. No traen ejercicios, así
    // que dentro de la ventana de N sesiones sólo gastarían un slot y diluirían
    // el balance de patrones: correr no descansa ni trabaja ningún patrón de
    // fuerza. `$ne` en vez de `$eq: "strength"` porque los documentos viejos no
    // tienen el campo.
    const [workouts, exercises] = await Promise.all([
      Workout.find({ type: { $ne: "running" } })
        .sort({ date: -1 })
        .limit(1000)
        .select("date core bodyweight overload")
        .lean(),
      Exercise.find().select("name patrones modalidad lastPerformed daysPerformed link -_id").lean(),
    ]);

    if (!exercises.length) {
      return res.status(409).json({
        error: "El catálogo de ejercicios está vacío: no hay con qué armar una sesión.",
      });
    }

    const result = buildRecommendation(workouts, exercises, params, Date.now());
    return res.json(result);
  } catch (err) {
    console.error("[GET /api/analytics/recommendation] error:", err.message);
    return res.status(500).json({ error: "Failed to build recommendation." });
  }
});

module.exports = router;
