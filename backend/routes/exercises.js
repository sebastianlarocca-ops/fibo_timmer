const express = require("express");
const router = express.Router();
const Exercise = require("../models/exercise");
const Workout = require("../models/workout");
const { computeExerciseStats } = require("../utils/exerciseStats");

// GET /api/exercises — return all exercises sorted by most recently performed
router.get("/", async (req, res) => {
  try {
    const exercises = await Exercise.find()
      .sort({ lastPerformed: -1, name: 1 })
      .select("name lastPerformed daysPerformed -_id");
    return res.json(exercises);
  } catch (err) {
    console.error("[GET /api/exercises] error:", err.message);
    return res.status(500).json({ error: "Failed to fetch exercises." });
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
      names.map((name) => {
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

        return Exercise.updateOne(
          { name },
          { $set: { name, lastPerformed, daysPerformed: days.size } },
          { upsert: true }
        );
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
