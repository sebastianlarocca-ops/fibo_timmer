/*
 * Llena `www/`, que es lo único que Capacitor copia adentro del APK.
 *
 * POR QUÉ EXISTE
 * La raíz del repo no se puede empaquetar tal cual: tiene `backend/` (vive
 * en Railway y nunca sale de ahí), `v2/`, los .md internos, node_modules y
 * el propio proyecto Android. Capacitor quiere una carpeta que SEA el
 * sitio, y esto la arma.
 *
 * Es una copia, no un build. Sin bundling ni minificación: los archivos de
 * `www/` son idénticos a los que editás. El deploy web no usa este script;
 * Vercel sigue subiendo la raíz como siempre.
 *
 * SITE_FILES es lo mismo que `.vercelignore` deja pasar. Si agregás un
 * archivo al sitio, va en los dos lugares.
 */

import { mkdir, rm, cp, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = join(ROOT, 'www');

const SITE_FILES = [
  'index.html',
  'script.js',
  'styles.css',
  'native.js',       // capacidades nativas (inerte en la web)
  'manifest.json',
  'favicon.svg',
  'icons',           // carpeta
  // service-worker.js NO va: adentro del APK los archivos ya son locales,
  // y script.js no lo registra cuando corre como app nativa.
];

/* Arrancar limpio: algo que sale de SITE_FILES tiene que desaparecer del
   APK, no quedar de una copia anterior. */
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const missing = [];
for (const name of SITE_FILES) {
  try {
    await access(join(ROOT, name));
  } catch {
    missing.push(name);
    continue;
  }
  await cp(join(ROOT, name), join(OUT, name), { recursive: true });
}

if (missing.length) {
  console.error(`\nFaltan archivos del sitio: ${missing.join(', ')}`);
  console.error('Si los renombraste, actualizá SITE_FILES en scripts/build-www.mjs.\n');
  process.exit(1);
}

console.log(`www/ listo — ${SITE_FILES.length} entradas copiadas.`);
