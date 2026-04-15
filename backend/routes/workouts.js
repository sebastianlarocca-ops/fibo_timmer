const express = require("express");
const router = express.Router();
const Workout = require("../models/workout");

// ---------------------------------------------------------------------------
// POST /api/workouts
// Save a completed Fibonacci workout session.
// ---------------------------------------------------------------------------
router.post("/", async (req, res) => {
  try {
    const { date, core, bodyweight, overload, durationSec } = req.body;

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
    });

    const saved = await workout.save();

    console.log(`[workout saved] id=${saved._id}  date=${saved.date.toISOString()}`);

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
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
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
