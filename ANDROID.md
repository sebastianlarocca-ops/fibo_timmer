# Workout Timer — la app Android

La misma app que está en Vercel, empaquetada como APK con [Capacitor](https://capacitorjs.com).
No se publica en Google Play: se instala por APK (sideload). Misma receta que Respiración.

| | |
|---|---|
| Nombre | **Workout Timer** |
| Package id | `com.larocca.workout` — **no se puede cambiar** sin que Android la trate como otra app |
| Compila contra | Android 16 (API 36), JDK 21 |

---

## Lo primero: respaldá la keystore

```
~/Documents/Claves/workout-release.keystore
~/Documents/Claves/.workout-pass.txt
```

**Copiá esos dos archivos a algún lado que no sea esta Mac.** Android solo instala una
actualización encima de la app si viene firmada con **la misma** clave. Si la perdés, la única
salida es desinstalar y reinstalar, y eso borra los datos locales: el entrenamiento en curso y
la cola de entrenamientos sin enviar.

> Lo que no se pierde nunca: los entrenamientos guardados. Viven en MongoDB, no en el teléfono.

`android/keystore.properties` apunta a la keystore y tiene la contraseña. Está en `.gitignore`
junto con `*.keystore`.

---

## Compilar

```bash
npm run apk
```

Deja el APK firmado en `android/app/build/outputs/apk/release/app-release.apk`.
Copia los archivos del sitio a `www/`, sincroniza con el proyecto Android y compila con Gradle.
`scripts/env.sh` encuentra solo el JDK y el SDK.

```bash
npm run www      # solo copiar los archivos del sitio a www/
```

```bash
npm run sync     # copiar + sincronizar con Android, sin compilar
```

---

## Instalar y actualizar

**Por cable:** con Depuración USB activada en el teléfono:

```bash
npm run install-apk
```

**Sin cable:** pasá `app-release.apk` por Drive o WhatsApp y abrilo en el teléfono.

**Cada actualización:**

```bash
npm run bump && npm run apk
```

Sin el `bump`, Android rechaza la instalación (mismo `versionCode`).

> **Ojo:** el APK lleva una copia de los archivos. Un push a `main` actualiza la web en Vercel,
> pero **no** la app: para eso hay que recompilar e instalar.

---

## Qué cambia respecto de la web

La regla: **la web no cambió de comportamiento.** Lo nativo pasa por `native.js`, que en el
navegador deja `Native.isNative` en `false` y `setAwake` como no-op.

| | Web | App Android |
|---|---|---|
| Timers, dashboard, ejercicios | sí | sí |
| Pantalla encendida mientras corre el timer | no | **sí** (plugin KeepAwake) |
| Service worker | sí | no — los archivos ya son locales |
| Ícono propio, sin barra de navegador | como PWA | sí |

La pantalla se mantiene prendida mientras haya un timer corriendo (`WorkoutTimer._running`) y
se libera al pausar, resetear o terminar. Con la pantalla apagada Android suspende la WebView y
los beeps de cambio de fase no sonarían.

No pide permisos además de `INTERNET`.

---

## Archivos

| Archivo | Qué es |
|---|---|
| `native.js` | Capa nativa, inerte en el navegador. Se publica también en la web |
| `capacitor.config.json` | Nombre, package id y `webDir` |
| `package.json` | Capacitor y los comandos. **La web sigue sin build step** |
| `scripts/env.sh` | Encuentra el JDK y el SDK |
| `scripts/build-www.mjs` | Copia los archivos del sitio a `www/` |
| `scripts/make-icon.mjs` | Genera `assets/` desde el reloj del favicon |
| `scripts/bump-version.mjs` | Sube el `versionCode` |
| `android/` | El proyecto Android. Se commitea; los artefactos de build no |

`www/` es generado: no se edita y está en `.gitignore`.

Si agregás un archivo al sitio, va en `SITE_FILES` de `scripts/build-www.mjs` (y, si es
privado, en `.vercelignore`).

### El ícono

```bash
node scripts/make-icon.mjs && npx capacitor-assets generate --android --splashBackgroundColor '#000000' --splashBackgroundColorDark '#000000'
```
