const mongoose = require("mongoose");

const currentWorkoutSchema = new mongoose.Schema(
  {
    exercise: {
      type: String,
      required: true,
      trim: true,
    },
    block: {
      type: String,
      required: true,
      enum: ["core", "bodyweight", "overload"],
    },
  },
  {
    timestamps: true, // createdAt used for ordering; updatedAt for debugging
  }
);

module.exports = mongoose.model("CurrentWorkout", currentWorkoutSchema);
