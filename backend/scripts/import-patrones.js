/**
 * Importa la clasificación de patrones desde la planilla a la colección
 * `exercises`. Una fila por (ejercicio, patrón): los ejercicios con más de un
 * patrón aparecen repetidos y se colapsan en un array.
 *
 * La planilla trae una columna `es_complejo` que acá se ignora: es redundante
 * con el largo del array.
 *
 * Uso — exportá la hoja "Ejercicios" como CSV y desde backend/:
 *   node scripts/import-patrones.js ../patrones.csv --dry-run
 *   node scripts/import-patrones.js ../patrones.csv
 *
 * El script no crea ejercicios: los nombres de la planilla que no estén en la
 * base se reportan y se saltean. Los que están en la base y no en la planilla
 * quedan con `patrones: []` (sin clasificar).
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const mongoose = require("mongoose");
const Exercise = require("../models/exercise");

const { PATRONES } = Exercise;

/** Parser CSV mínimo con soporte de comillas — los nombres traen comas. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }

    if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }

  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((a) => !a.startsWith("--"));

  if (!file) {
    console.error("Falta el CSV. Uso: node scripts/import-patrones.js <archivo.csv> [--dry-run]");
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  const header = rows.shift().map((h) => h.trim().toLowerCase());
  const iName = header.findIndex((h) => h === "ejercicio" || h === "nombre" || h === "name");
  const iPatron = header.findIndex((h) => h === "patron" || h === "patrón");

  if (iName === -1 || iPatron === -1) {
    console.error(`El CSV necesita columnas "ejercicio" y "patron". Encontré: ${header.join(", ")}`);
    process.exit(1);
  }

  // Colapsa las filas en un map nombre → [patrones], deduplicando y validando.
  const byName = new Map();
  const invalid = [];

  rows.forEach((r, idx) => {
    const name = String(r[iName] || "").trim().toLowerCase();
    const patron = String(r[iPatron] || "").trim().toLowerCase();
    if (!name || !patron) return;

    if (!PATRONES.includes(patron)) {
      invalid.push(`fila ${idx + 2}: "${patron}" (${name})`);
      return;
    }
    if (!byName.has(name)) byName.set(name, []);
    const list = byName.get(name);
    if (!list.includes(patron)) list.push(patron);
  });

  if (invalid.length) {
    console.error(`Patrones fuera del enum [${PATRONES.join(", ")}]:`);
    invalid.forEach((l) => console.error("  " + l));
    process.exit(1);
  }

  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI no está definida. Revisá backend/.env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const existing = await Exercise.find().select("name patrones").lean();
  const existingNames = new Set(existing.map((e) => e.name));

  const missingInDb = [...byName.keys()].filter((n) => !existingNames.has(n));
  const unclassified = existing
    .filter((e) => !byName.has(e.name))
    .map((e) => e.name);

  console.log(`Planilla: ${byName.size} ejercicios · Base: ${existing.length}`);
  if (missingInDb.length) {
    console.log(`\nEn la planilla pero NO en la base (se saltean):`);
    missingInDb.forEach((n) => console.log("  - " + n));
  }
  if (unclassified.length) {
    console.log(`\nEn la base pero NO en la planilla (quedan con patrones: []):`);
    unclassified.forEach((n) => console.log("  - " + n));
  }

  const complejos = [...byName.entries()].filter(([, p]) => p.length > 1);
  console.log(`\nCon más de un patrón (${complejos.length}):`);
  complejos.forEach(([n, p]) => console.log(`  - ${n}: ${p.join(" + ")}`));

  if (dryRun) {
    console.log("\n--dry-run: no se escribió nada.");
    await mongoose.disconnect();
    return;
  }

  const ops = existing.map((e) => ({
    updateOne: {
      filter: { name: e.name },
      update: { $set: { patrones: byName.get(e.name) || [] } },
    },
  }));

  const result = await mongoose.connection
    .collection("exercises")
    .bulkWrite(ops);

  console.log(`\nActualizados: ${result.modifiedCount} de ${ops.length}`);

  // Conteo final por patrón, para chequear contra el resumen de la planilla.
  const counts = {};
  PATRONES.forEach((p) => (counts[p] = 0));
  existing.forEach((e) => (byName.get(e.name) || []).forEach((p) => counts[p]++));
  console.log("\nEjercicios por patrón:");
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([p, c]) => console.log(`  ${p.padEnd(18)} ${c}`));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Import falló:", err.message);
  process.exit(1);
});
