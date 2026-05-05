const Workout = require("../models/workout");

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * For a given (lowercase) exercise name, query all workouts that include it
 * (case-insensitive) and return { lastPerformed, daysPerformed }.
 */
async function computeExerciseStats(name) {
  const pattern = new RegExp(`^${escapeRegex(name)}$`, "i");
  const workouts = await Workout.find({
    $or: [{ core: pattern }, { bodyweight: pattern }, { overload: pattern }],
  })
    .select("date")
    .lean();

  if (!workouts.length) return { lastPerformed: null, daysPerformed: 0 };

  const days = new Set(
    workouts.map((w) => {
      const d = new Date(w.date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })
  );

  const lastPerformed = new Date(
    Math.max(...workouts.map((w) => new Date(w.date).getTime()))
  );

  return { lastPerformed, daysPerformed: days.size };
}

module.exports = { computeExerciseStats };
