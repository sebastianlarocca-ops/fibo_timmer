const express = require("express");
const router = express.Router();
const Workout = require("../models/workout");
const Exercise = require("../models/exercise");
const { computeExerciseStats } = require("../utils/exerciseStats");

const PERF_BLOCKS = ["bodyweight", "overload"];

/**
 * Convierte un valor del formulario en número o null. Vacío/basura → null
 * (nunca 0: "no cargué el dato" y "hice 0 reps" no son lo mismo).
 */
function toNumberOrNull(value, { max, decimals = 0 }) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.min(Math.max(n, 0), max);
  const factor = 10 ** decimals;
  return Math.round(clamped * factor) / factor;
}

/**
 * Normaliza el `performance` que manda el cliente. Devuelve undefined cuando no
 * hay nada que guardar (skip, o formulario enviado en blanco), de modo que el
 * documento quede sin el campo en vez de con un objeto vacío.
 */
function sanitizePerformance(raw) {
  if (!raw || typeof raw !== "object") return undefined;

  const rounds = {
    bodyweight: toNumberOrNull(raw.rounds?.bodyweight, { max: 99 }),
    overload: toNumberOrNull(raw.rounds?.overload, { max: 99 }),
  };

  const entries = (Array.isArray(raw.entries) ? raw.entries : [])
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const block = String(entry.block || "");
      const name = String(entry.name || "").trim();
      if (!PERF_BLOCKS.includes(block) || !name) return null;

      return {
        block,
        name,
        reps: toNumberOrNull(entry.reps, { max: 999 }),
        // El peso sólo tiene sentido en overload; en bodyweight se descarta.
        weightKg:
          block === "overload"
            ? toNumberOrNull(entry.weightKg, { max: 999, decimals: 1 })
            : null,
      };
    })
    // Una fila sin ningún dato cargado no aporta nada: se descarta.
    .filter((entry) => entry && (entry.reps !== null || entry.weightKg !== null));

  const hasRounds = rounds.bodyweight !== null || rounds.overload !== null;
  if (!entries.length && !hasRounds) return undefined;

  return { rounds, entries };
}

// ---------------------------------------------------------------------------
// POST /api/workouts
// Save a completed Fibonacci workout session.
// ---------------------------------------------------------------------------
router.post("/", async (req, res) => {
  try {
    const { date, core, bodyweight, overload, durationSec, performance } = req.body;

    // Basic structural validation
    if (
      !Array.isArray(core) ||
      !Array.isArray(bodyweight) ||
      !Array.isArray(overload)
    ) {
      return res.status(400).json({
        error: "core, bodyweight, and overload must be arrays.",
      });
    }

    const workout = new Workout({
      date: date ? new Date(date) : new Date(),
      core: core.map(String),
      bodyweight: bodyweight.map(String),
      overload: overload.map(String),
      durationSec: typeof durationSec === "number" ? durationSec : null,
      performance: sanitizePerformance(performance),
    });

    const saved = await workout.save();

    console.log(`[workout saved] id=${saved._id}  date=${saved.date.toISOString()}`);

    // Upsert exercises with latest stats (lowercase, deduplicated).
    // `modalidad` = bloque en el que se cargó el ejercicio en esta sesión.
    // Si aparece en más de un bloque, gana el primero (core → bodyweight → overload).
    const modalidadByName = new Map();
    [
      ["core", core],
      ["bodyweight", bodyweight],
      ["overload", overload],
    ].forEach(([modalidad, listado]) => {
      listado.forEach((e) => {
        const n = String(e).trim().toLowerCase();
        if (n && !modalidadByName.has(n)) modalidadByName.set(n, modalidad);
      });
    });

    const unique = [...modalidadByName.keys()];
    if (unique.length) {
      await Promise.all(
        unique.map(async (name) => {
          const stats = await computeExerciseStats(name);
          return Exercise.updateOne(
            { name },
            { $set: { name, ...stats, modalidad: modalidadByName.get(name) } },
            { upsert: true }
          );
        })
      );
      console.log(`[exercises upserted] ${unique.join(", ")}`);
    }

    return res.status(201).json({
      message: "Workout saved successfully.",
      id: saved._id,
      date: saved.date,
    });
  } catch (err) {
    console.error("[POST /api/workouts] error:", err.message);
    return res.status(500).json({ error: "Failed to save workout." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/workouts
// Retrieve the 50 most recent workouts (newest first).
// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 1000);
    const workouts = await Workout.find()
      .sort({ date: -1 })
      .limit(limit)
      .select("-__v");

    return res.json({ count: workouts.length, workouts });
  } catch (err) {
    console.error("[GET /api/workouts] error:", err.message);
    return res.status(500).json({ error: "Failed to fetch workouts." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/workouts/:id
// Editar sólo la carga (reps / peso / vueltas) de un workout ya guardado.
// El resto del documento — fecha, listas de ejercicios, duración — no se toca:
// esto existe para completar lo que quedó en blanco al hacer "skip".
// `performance: null` (o vacío) borra la carga.
// ---------------------------------------------------------------------------
router.patch("/:id", async (req, res) => {
  try {
    const performance = sanitizePerformance(req.body.performance);
    const update = performance
      ? { $set: { performance } }
      : { $unset: { performance: "" } };

    const workout = await Workout.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    }).select("-__v");

    if (!workout) return res.status(404).json({ error: "Workout not found." });

    console.log(
      `[workout patched] id=${workout._id}  performance=${performance ? "set" : "unset"}`
    );
    return res.json(workout);
  } catch (err) {
    console.error("[PATCH /api/workouts/:id] error:", err.message);
    return res.status(500).json({ error: "Failed to update workout." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/workouts/:id
// Retrieve a single workout by MongoDB ObjectId.
// ---------------------------------------------------------------------------
router.get("/:id", async (req, res) => {
  try {
    const workout = await Workout.findById(req.params.id).select("-__v");
    if (!workout) return res.status(404).json({ error: "Workout not found." });
    return res.json(workout);
  } catch (err) {
    console.error("[GET /api/workouts/:id] error:", err.message);
    return res.status(500).json({ error: "Failed to fetch workout." });
  }
});

module.exports = router;
