const express = require("express");
const router = express.Router();
const Exercise = require("../models/exercise");
const Workout = require("../models/workout");
const { computeExerciseStats } = require("../utils/exerciseStats");

const MODALIDADES = ["core", "bodyweight", "overload"];
const EX_FIELDS = "name lastPerformed daysPerformed modalidad link -_id";

/**
 * Normaliza el link de video que manda el cliente.
 * Devuelve { ok: true, value } o { ok: false, error }.
 * Sólo http/https: cualquier otro esquema (javascript:, data:) se rechaza
 * porque el link termina en un href que abre el navegador.
 */
function normalizeLink(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { ok: true, value: null };
  }
  const value = String(raw).trim();
  if (value.length > 500) {
    return { ok: false, error: "link is too long (max 500 chars)." };
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: "link must be a valid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "link must start with http:// or https://." };
  }
  return { ok: true, value };
}

// GET /api/exercises — return all exercises sorted by most recently performed
router.get("/", async (req, res) => {
  try {
    const exercises = await Exercise.find()
      .sort({ lastPerformed: -1, name: 1 })
      .select(EX_FIELDS);
    return res.json(exercises);
  } catch (err) {
    console.error("[GET /api/exercises] error:", err.message);
    return res.status(500).json({ error: "Failed to fetch exercises." });
  }
});

// POST /api/exercises — alta manual de un ejercicio.
// Sólo nombre + modalidad: `lastPerformed` y `daysPerformed` los completa el
// sistema recién cuando el ejercicio aparece en un entrenamiento terminado.
router.post("/", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim().toLowerCase();
    const modalidad = String(req.body?.modalidad || "").trim().toLowerCase();

    if (!name) return res.status(400).json({ error: "name is required." });
    if (!MODALIDADES.includes(modalidad)) {
      return res.status(400).json({
        error: `modalidad must be one of: ${MODALIDADES.join(", ")}.`,
      });
    }

    const link = normalizeLink(req.body?.link);
    if (!link.ok) return res.status(400).json({ error: link.error });

    const existing = await Exercise.findOne({ name }).select(EX_FIELDS);
    if (existing) {
      return res.status(409).json({ error: "Exercise already exists.", exercise: existing });
    }

    const created = await Exercise.create({
      name,
      modalidad,
      link: link.value,
      daysPerformed: 0,
      lastPerformed: null,
    });

    console.log(`[exercise created] ${name} (${modalidad})${link.value ? " +link" : ""}`);
    return res.status(201).json({
      name: created.name,
      modalidad: created.modalidad,
      link: created.link,
      daysPerformed: created.daysPerformed,
      lastPerformed: created.lastPerformed,
    });
  } catch (err) {
    // Carrera contra el índice único: dos altas del mismo nombre a la vez
    if (err.code === 11000) {
      return res.status(409).json({ error: "Exercise already exists." });
    }
    console.error("[POST /api/exercises] error:", err.message);
    return res.status(500).json({ error: "Failed to create exercise." });
  }
});

// PATCH /api/exercises/:name — clasificar la modalidad y/o cargar el link.
// Sólo toca los campos que vengan en el body: un PATCH de link no pisa la
// modalidad ya cargada, y viceversa.
router.patch("/:name", async (req, res) => {
  try {
    const name = String(req.params.name || "").trim().toLowerCase();
    const body = req.body || {};

    if (!name) return res.status(400).json({ error: "Missing exercise name." });

    const $set = {};

    if ("modalidad" in body) {
      const { modalidad } = body;
      const value =
        modalidad === null || modalidad === "" || modalidad === undefined
          ? null
          : String(modalidad).trim().toLowerCase();

      if (value !== null && !MODALIDADES.includes(value)) {
        return res.status(400).json({
          error: `modalidad must be one of: ${MODALIDADES.join(", ")} (or null).`,
        });
      }
      $set.modalidad = value;
    }

    if ("link" in body) {
      const link = normalizeLink(body.link);
      if (!link.ok) return res.status(400).json({ error: link.error });
      $set.link = link.value;
    }

    if (!Object.keys($set).length) {
      return res.status(400).json({ error: "Nothing to update: send modalidad and/or link." });
    }

    const updated = await Exercise.findOneAndUpdate(
      { name },
      { $set },
      { new: true }
    ).select(EX_FIELDS);

    if (!updated) return res.status(404).json({ error: "Exercise not found." });

    console.log(
      `[exercise patch] ${name} → ${Object.entries($set)
        .map(([k, v]) => `${k}=${v ?? "null"}`)
        .join(" ")}`
    );
    return res.json(updated);
  } catch (err) {
    console.error("[PATCH /api/exercises/:name] error:", err.message);
    return res.status(500).json({ error: "Failed to update exercise." });
  }
});

// POST /api/exercises/backfill
// Seeds the exercises collection from all existing workouts.
// Safe to call multiple times — uses upsert, recomputes stats from scratch.
router.post("/backfill", async (req, res) => {
  try {
    // Load all workouts into memory once to avoid N DB round-trips
    const workouts = await Workout.find()
      .select("date core bodyweight overload")
      .lean();

    // Collect every unique exercise name (lowercase)
    const nameSet = new Set();
    workouts.forEach((w) => {
      [...(w.core || []), ...(w.bodyweight || []), ...(w.overload || [])].forEach((e) => {
        const n = String(e).trim().toLowerCase();
        if (n) nameSet.add(n);
      });
    });

    const names = [...nameSet];
    if (!names.length) return res.json({ processed: 0 });

    // Compute stats in JS (workouts already in memory — no extra DB queries)
    function escapeRegex(str) {
      return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    await Promise.all(
      names.map(async (name) => {
        const pattern = new RegExp(`^${escapeRegex(name)}$`, "i");
        const matching = workouts.filter(
          (w) =>
            (w.core || []).some((e) => pattern.test(e)) ||
            (w.bodyweight || []).some((e) => pattern.test(e)) ||
            (w.overload || []).some((e) => pattern.test(e))
        );

        const days = new Set(
          matching.map((w) => {
            const d = new Date(w.date);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          })
        );

        const lastPerformed =
          matching.length
            ? new Date(Math.max(...matching.map((w) => new Date(w.date).getTime())))
            : null;

        // Modalidad sugerida: bloque del workout más reciente que lo incluye.
        let modalidad = null;
        if (matching.length) {
          const latest = matching.reduce((a, b) =>
            new Date(a.date).getTime() >= new Date(b.date).getTime() ? a : b
          );
          modalidad =
            ["core", "bodyweight", "overload"].find((block) =>
              (latest[block] || []).some((e) => pattern.test(e))
            ) || null;
        }

        await Exercise.updateOne(
          { name },
          { $set: { name, lastPerformed, daysPerformed: days.size } },
          { upsert: true }
        );

        // No pisa una clasificación manual: sólo completa las que están vacías.
        if (modalidad) {
          await Exercise.updateOne({ name, modalidad: null }, { $set: { modalidad } });
        }
      })
    );

    console.log(`[backfill] upserted ${names.length} exercises`);
    return res.json({ processed: names.length });
  } catch (err) {
    console.error("[POST /api/exercises/backfill] error:", err.message);
    return res.status(500).json({ error: "Backfill failed." });
  }
});

module.exports = router;
