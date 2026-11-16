/* ════════════════════════════════════════════════════════════════════════
   NATIVE — la capa fina que agrega la app Android, y que la web ignora
   ────────────────────────────────────────────────────────────────────────
   EL CONTRATO: en el navegador `Native.isNative` es false y cada método es
   un no-op. Nada que pase por este archivo cambia cómo se comporta la web.
   Es lo único que sabe si estamos adentro del APK.

   No hay bundler ni build step: Capacitor expone sus plugins en
   `window.Capacitor.Plugins` en runtime, así que esto es JavaScript de
   <script> como el resto. Vercel también lo publica; ahí simplemente nunca
   encuentra un `window.Capacitor`.

   QUÉ HACE
   `setAwake(true|false)` — mantiene la pantalla encendida mientras corre un
   timer. Si Android apaga la pantalla, suspende la WebView y los beeps de
   cambio de fase dejan de sonar. Con la pantalla prendida, además, el
   número grande se ve desde el piso.
════════════════════════════════════════════════════════════════════════ */

window.Native = (function () {
  'use strict';

  const cap = window.Capacitor;
  const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  const KeepAwake = isNative ? (cap.Plugins && cap.Plugins.KeepAwake) : null;

  if (!isNative || !KeepAwake) {
    return { isNative, setAwake: () => Promise.resolve(false) };
  }

  /* Idempotente: start() se llama al reanudar tras cada pausa, y no hace
     falta cruzar el puente nativo si el estado no cambió. */
  let awake = false;

  async function setAwake(on) {
    on = !!on;
    if (on === awake) return true;
    awake = on;
    try {
      await (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep());
      return true;
    } catch (err) {
      awake = !on;
      console.warn('KeepAwake falló:', err);
      return false;
    }
  }

  return { isNative, setAwake };
})();
