const express = require("express");
const router = express.Router();
const Exercise = require("../models/exercise");
const Workout = require("../models/workout");
const { computeExerciseStats } = require("../utils/exerciseStats");

const MODALIDADES = ["core", "bodyweight", "overload"];

// GET /api/exercises — return all exercises sorted by most recently performed
router.get("/", async (req, res) => {
  try {
    const exercises = await Exercise.find()
      .sort({ lastPerformed: -1, name: 1 })
      .select("name lastPerformed daysPerformed modalidad -_id");
    return res.json(exercises);
  } catch (err) {
    console.error("[GET /api/exercises] error:", err.message);
    return res.status(500).json({ error: "Failed to fetch exercises." });
  }
});

// PATCH /api/exercises/:name — clasificar manualmente la modalidad
router.patch("/:name", async (req, res) => {
  try {
    const name = String(req.params.name || "").trim().toLowerCase();
    const { modalidad } = req.body;

    if (!name) return res.status(400).json({ error: "Missing exercise name." });

    const value =
      modalidad === null || modalidad === "" || modalidad === undefined
        ? null
        : String(modalidad).trim().toLowerCase();

    if (value !== null && !MODALIDADES.includes(value)) {
      return res.status(400).json({
        error: `modalidad must be one of: ${MODALIDADES.join(", ")} (or null).`,
      });
    }

    const updated = await Exercise.findOneAndUpdate(
      { name },
      { $set: { modalidad: value } },
      { new: true }
    ).select("name lastPerformed daysPerformed modalidad -_id");

    if (!updated) return res.status(404).json({ error: "Exercise not found." });

    console.log(`[exercise modalidad] ${name} → ${value ?? "null"}`);
    return res.json(updated);
  } catch (err) {
    console.error("[PATCH /api/exercises/:name] error:", err.message);
    return res.status(500).json({ error: "Failed to update exercise." });
  }
});

// POST /api/exercises/backfill
// Seeds the exercises collection from all existing workouts.
// Safe to call multiple times — uses upsert, recomputes stats from scratch.
router.post("/backfill", async (req, res) => {
  try {
    // Load all workouts into memory once to avoid N DB round-trips
    const workouts = await Workout.find()
      .select("date core bodyweight overload")
      .lean();

    // Collect every unique exercise name (lowercase)
    const nameSet = new Set();
    workouts.forEach((w) => {
      [...(w.core || []), ...(w.bodyweight || []), ...(w.overload || [])].forEach((e) => {
        const n = String(e).trim().toLowerCase();
        if (n) nameSet.add(n);
      });
    });

    const names = [...nameSet];
    if (!names.length) return res.json({ processed: 0 });

    // Compute stats in JS (workouts already in memory — no extra DB queries)
    function escapeRegex(str) {
      return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    await Promise.all(
      names.map(async (name) => {
        const pattern = new RegExp(`^${escapeRegex(name)}$`, "i");
        const matching = workouts.filter(
          (w) =>
            (w.core || []).some((e) => pattern.test(e)) ||
            (w.bodyweight || []).some((e) => pattern.test(e)) ||
            (w.overload || []).some((e) => pattern.test(e))
        );

        const days = new Set(
          matching.map((w) => {
            const d = new Date(w.date);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          })
        );

        const lastPerformed =
          matching.length
            ? new Date(Math.max(...matching.map((w) => new Date(w.date).getTime())))
            : null;

        // Modalidad sugerida: bloque del workout más reciente que lo incluye.
        let modalidad = null;
        if (matching.length) {
          const latest = matching.reduce((a, b) =>
            new Date(a.date).getTime() >= new Date(b.date).getTime() ? a : b
          );
          modalidad =
            ["core", "bodyweight", "overload"].find((block) =>
              (latest[block] || []).some((e) => pattern.test(e))
            ) || null;
        }

        await Exercise.updateOne(
          { name },
          { $set: { name, lastPerformed, daysPerformed: days.size } },
          { upsert: true }
        );

        // No pisa una clasificación manual: sólo completa las que están vacías.
        if (modalidad) {
          await Exercise.updateOne({ name, modalidad: null }, { $set: { modalidad } });
        }
      })
    );

    console.log(`[backfill] upserted ${names.length} exercises`);
    return res.json({ processed: names.length });
  } catch (err) {
    console.error("[POST /api/exercises/backfill] error:", err.message);
    return res.status(500).json({ error: "Backfill failed." });
  }
});

module.exports = router;
