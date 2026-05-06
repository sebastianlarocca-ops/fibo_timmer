const express = require("express");
const router = express.Router();
const CurrentWorkout = require("../models/currentWorkout");

// GET /api/current-workout — all items ordered by when they were added
router.get("/", async (req, res) => {
  try {
    const items = await CurrentWorkout.find()
      .sort({ createdAt: 1 })
      .select("exercise block createdAt -__v");
    return res.json(items);
  } catch (err) {
    console.error("[GET /api/current-workout] error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/current-workout — add one exercise to the plan
router.post("/", async (req, res) => {
  try {
    const { exercise, block } = req.body;
    if (!exercise || typeof exercise !== "string" || !exercise.trim()) {
      return res.status(400).json({ error: "exercise is required." });
    }
    if (!["core", "bodyweight", "overload"].includes(block)) {
      return res.status(400).json({ error: "block must be core, bodyweight, or overload." });
    }
    const item = await CurrentWorkout.create({ exercise: exercise.trim(), block });
    console.log(`[current-workout] added "${item.exercise}" → ${item.block}`);
    return res.status(201).json({ id: item._id });
  } catch (err) {
    console.error("[POST /api/current-workout] error:", err.message);
    return res.status(500).json({ error: "Failed to save exercise." });
  }
});

// DELETE /api/current-workout/all — wipe the whole plan
router.delete("/all", async (req, res) => {
  try {
    await CurrentWorkout.deleteMany({});
    console.log("[current-workout] cleared all");
    return res.json({ message: "Current workout cleared." });
  } catch (err) {
    console.error("[DELETE /api/current-workout/all] error:", err.message);
    return res.status(500).json({ error: "Failed to clear workout." });
  }
});

// DELETE /api/current-workout/:id — remove one exercise by ID
router.delete("/:id", async (req, res) => {
  try {
    const result = await CurrentWorkout.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: "Item not found." });
    console.log(`[current-workout] removed "${result.exercise}" from ${result.block}`);
    return res.json({ message: "Exercise removed." });
  } catch (err) {
    console.error("[DELETE /api/current-workout/:id] error:", err.message);
    return res.status(500).json({ error: "Failed to remove exercise." });
  }
});

module.exports = router;
