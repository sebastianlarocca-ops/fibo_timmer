const mongoose = require("mongoose");

const exerciseSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    lastPerformed: {
      type: Date,
      default: null,
    },
    daysPerformed: {
      type: Number,
      default: 0,
    },
    // Bloque en el que se cargó el ejercicio por última vez.
    modalidad: {
      type: String,
      enum: ["core", "bodyweight", "overload", null],
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Exercise", exerciseSchema);
