const mongoose = require("mongoose");

/**
 * Carga real de un bloque AMRAP — se completa en el formulario que aparece al
 * terminar el entrenamiento. Es opcional: si el usuario hace "skip", el campo
 * `performance` no existe en el documento.
 *
 * `entries` es un array plano (con `block` adentro) en vez de anidado por
 * bloque a propósito: así una query por ejercicio es directa
 * ({ "performance.entries.name": "press militar" }) y sirve para progresión y PRs.
 */
const performanceEntrySchema = new mongoose.Schema(
  {
    block: {
      type: String,
      enum: ["bodyweight", "overload"],
      required: true,
    },
    name: { type: String, required: true },
    reps: { type: Number, default: null },
    // Siempre en kg. null en bodyweight (y en overload sin peso cargado).
    weightKg: { type: Number, default: null },
  },
  { _id: false }
);

const performanceSchema = new mongoose.Schema(
  {
    rounds: {
      bodyweight: { type: Number, default: null },
      overload: { type: Number, default: null },
    },
    entries: { type: [performanceEntrySchema], default: [] },
  },
  { _id: false }
);

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
 * performance  – reps/pesos/vueltas cargados al terminar (opcional, ver arriba)
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
    // `default: undefined` para que los workouts sin carga no guarden un objeto
    // vacío: la ausencia del campo es la señal de "se hizo skip".
    performance: {
      type: performanceSchema,
      default: undefined,
    },
  },
  {
    // Automatically adds createdAt / updatedAt timestamps
    timestamps: true,
  }
);

module.exports = mongoose.model("Workout", workoutSchema);
