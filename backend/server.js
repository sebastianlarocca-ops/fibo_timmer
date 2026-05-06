// Load environment variables first (before any other imports)
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const workoutsRouter = require("./routes/workouts");
const exercisesRouter = require("./routes/exercises");
const currentWorkoutRouter = require("./routes/current-workout");

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

// Allow requests from any origin (tighten to your Render/GitHub Pages URL in production)
app.use(cors());

// Parse JSON bodies up to 1 MB
app.use(express.json({ limit: "1mb" }));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use("/api/workouts", workoutsRouter);
app.use("/api/exercises", exercisesRouter);
app.use("/api/current-workout", currentWorkoutRouter);

// Health-check — useful for Render's zero-downtime checks
app.get("/health", (_req, res) => {
  res.json({ status: "ok", db: mongoose.connection.readyState === 1 ? "connected" : "disconnected" });
});

// 404 catch-all for unknown routes
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found." });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error("[unhandled error]", err);
  res.status(500).json({ error: "Internal server error." });
});

// ---------------------------------------------------------------------------
// Database → Server
// ---------------------------------------------------------------------------
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("❌  MONGODB_URI is not defined. Check your .env file.");
  process.exit(1);
}

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log("✅  Connected to MongoDB — database: fibo_workouts");
    app.listen(PORT, () => {
      console.log(`🚀  Server running → http://localhost:${PORT}`);
      console.log(`   POST /api/workouts            — save a workout`);
      console.log(`   GET  /api/workouts            — list recent workouts`);
      console.log(`   GET  /api/exercises              — list exercises with stats`);
      console.log(`   POST /api/exercises/backfill     — seed from existing workouts`);
      console.log(`   GET  /api/current-workout        — get current exercise plan`);
      console.log(`   POST /api/current-workout        — add one exercise to plan`);
      console.log(`   DELETE /api/current-workout/:id  — remove one exercise`);
      console.log(`   DELETE /api/current-workout/all  — clear the whole plan`);
      console.log(`   GET  /health                     — connection check`);
    });
  })
  .catch((err) => {
    console.error("❌  MongoDB connection failed:", err.message);
    process.exit(1);
  });
