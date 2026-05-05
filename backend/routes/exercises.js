const express = require("express");
const router = express.Router();
const Exercise = require("../models/exercise");

// GET /api/exercises — return all known exercises sorted alphabetically
router.get("/", async (req, res) => {
  try {
    const exercises = await Exercise.find().sort({ name: 1 }).select("name -_id");
    return res.json(exercises.map((e) => e.name));
  } catch (err) {
    console.error("[GET /api/exercises] error:", err.message);
    return res.status(500).json({ error: "Failed to fetch exercises." });
  }
});

module.exports = router;
