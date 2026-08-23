const mongoose = require("mongoose");

// Patrones de movimiento. Un ejercicio puede tener 0, 1 o varios: el array vacío
// es "sin clasificar" y dos o más valores es lo que en la planilla figuraba como
// `es_complejo` — acá no hace falta el flag, lo dice el largo del array.
//
// `empuje` se partió en horizontal (pectoral: push ups, press de banca) y vertical
// (deltoides: press militar, hand stand). Eran el mismo patrón y escondían el
// desbalance entre los dos: sumados daban 38.6% de la ventana contra un objetivo
// de 25%, pero partidos quedan en 20.5% y 18.2% contra el nuevo objetivo de 20%.
// El sesgo no era "demasiado empuje", era que no se distinguían.
const PATRONES = [
  "empuje_horizontal",
  "empuje_vertical",
  "traccion",
  "rodilla_dominante",
  "cadera_dominante",
  "core",
  // Legado: se acepta para que los documentos sin migrar no rompan al guardarse.
  // Sale del enum una vez que la colección no lo use más.
  "empuje",
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
