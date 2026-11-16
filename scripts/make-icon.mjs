/*
 * Genera assets/ (el ícono de origen del APK) desde el motivo del favicon:
 * el reloj naranja sobre gris casi negro. Después:
 *     npx capacitor-assets generate --android
 * (ver ANDROID.md para los flags de color).
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
await mkdir(OUT, { recursive: true });

// El reloj del favicon, en su viewBox de 32. `scale` lo achica para que
// entre en la zona segura del ícono adaptativo (Android recorta el borde).
const clock = (scale) => `
  <g transform="translate(16 16) scale(${scale}) translate(-16 -16)">
    <circle cx="16" cy="16" r="11" fill="none" stroke="#d97548" stroke-width="2"/>
    <line x1="16" y1="16" x2="16" y2="9" stroke="#d97548" stroke-width="2" stroke-linecap="round"/>
    <line x1="16" y1="16" x2="21" y2="18" stroke="#e8855a" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="16" cy="16" r="1.5" fill="#d97548"/>
  </g>`;
const svg = (body, bg) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="1024" height="1024">${bg ? '<rect width="32" height="32" fill="#1a1a1d"/>' : ''}${body}</svg>`);

await sharp(svg(clock(0.85), true)).png().toFile(join(OUT, 'icon.png'));
await sharp(svg(clock(0.6), false)).png().toFile(join(OUT, 'icon-foreground.png'));
await sharp(svg('', true)).png().toFile(join(OUT, 'icon-background.png'));
console.log('assets/ listo');
