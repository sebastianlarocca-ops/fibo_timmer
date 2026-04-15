const mongoose = require("mongoose");

/**
 * A single completed Fibonacci workout session.
 *
 * Fields
 * ------
 * date        – when the workout finished (stored in UTC, indexed for sorting)
 * core        – exercises shown during the 3-minute block
 * bodyweight  – exercises shown during the 5-minute block
 * overload    – exercises shown during the 8-minute block
 * durationSec – total elapsed seconds (optional, sent by client)
 */
const workoutSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      default: Date.now,
      required: true,
      index: true,
    },
    core: {
      type: [String],
      default: [],
    },
    bodyweight: {
      type: [String],
      default: [],
    },
    overload: {
      type: [String],
      default: [],
    },
    durationSec: {
      type: Number,
      default: null,
    },
  },
  {
    // Automatically adds createdAt / updatedAt timestamps
    timestamps: true,
  }
);

module.exports = mongoose.model("Workout", workoutSchema);
