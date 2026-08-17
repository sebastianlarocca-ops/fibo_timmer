const mongoose = require("mongoose");

// Patrones de movimiento. Un ejercicio puede tener 0, 1 o varios: el array vacío
// es "sin clasificar" y dos o más valores es lo que en la planilla figuraba como
// `es_complejo` — acá no hace falta el flag, lo dice el largo del array.
const PATRONES = [
  "empuje",
  "traccion",
  "rodilla_dominante",
  "cadera_dominante",
  "core",
];

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
    // Link a un video de referencia (http/https). Vacío = sin video cargado.
    link: {
      type: String,
      default: null,
      trim: true,
    },
    // Patrones de movimiento que trabaja el ejercicio. Ver PATRONES arriba.
    patrones: {
      type: [{ type: String, enum: PATRONES }],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Exercise", exerciseSchema);
module.exports.PATRONES = PATRONES;
