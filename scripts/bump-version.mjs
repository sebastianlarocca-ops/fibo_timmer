/*
 * Sube la versión de la app antes de compilar un APK nuevo.
 *
 *     npm run bump            → 1.0.0 (2)  — sube solo el versionCode
 *     npm run bump -- minor   → 1.1.0 (2)
 *     npm run bump -- major   → 2.0.0 (2)
 *     npm run bump -- patch   → 1.0.1 (2)
 *
 * POR QUÉ IMPORTA
 * Android se niega a instalar un APK encima de otro si el versionCode no
 * es mayor. Si no lo subís, la única forma de actualizar es desinstalar —
 * y desinstalar borra los datos locales de la app: el entrenamiento en
 * curso y la cola de entrenamientos sin enviar. (Los que ya se guardaron
 * están en MongoDB y no se pierden nunca.)
 *
 * El versionCode sube SIEMPRE. El versionName es para vos.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT   = join(dirname(fileURLToPath(import.meta.url)), '..');
const GRADLE = join(ROOT, 'android/app/build.gradle');

const bump = (process.argv[2] || 'build').toLowerCase();
if (!['build', 'patch', 'minor', 'major'].includes(bump)) {
  console.error(`No conozco "${bump}". Usá: build | patch | minor | major`);
  process.exit(1);
}

let gradle = await readFile(GRADLE, 'utf8');

const codeMatch = gradle.match(/versionCode\s+(\d+)/);
const nameMatch = gradle.match(/versionName\s+"([^"]+)"/);
if (!codeMatch || !nameMatch) {
  console.error('No encuentro versionCode/versionName en android/app/build.gradle');
  process.exit(1);
}

const nextCode = Number(codeMatch[1]) + 1;

let [major, minor, patch] = nameMatch[1].split('.').map((n) => Number(n) || 0);
if (bump === 'major') { major += 1; minor = 0; patch = 0; }
if (bump === 'minor') { minor += 1; patch = 0; }
if (bump === 'patch') { patch += 1; }
const nextName = `${major}.${minor}.${patch}`;

gradle = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${nextCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${nextName}"`);

await writeFile(GRADLE, gradle);

console.log(`${nameMatch[1]} (${codeMatch[1]})  →  ${nextName} (${nextCode})`);
