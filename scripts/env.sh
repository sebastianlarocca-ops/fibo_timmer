#!/bin/sh
#
# El entorno de compilación de Android, dentro del proyecto.
#
# POR QUÉ ACÁ Y NO EN ~/.zshrc
# Compilar el APK necesita un JDK 21 y el SDK de Android. Eso podría vivir
# en el shell global, pero entonces el proyecto dependería de un archivo
# que no está en el repo: en otra máquina (o después de limpiar el shell)
# `npm run apk` fallaría sin decir por qué. Acá las rutas se detectan solas
# y el proyecto se compila con el shell tal como viene.
#
# Se usa así, y los scripts de package.json ya lo hacen:
#     . ./scripts/env.sh
#
# Si querés además tener `adb` a mano en cualquier terminal, eso sí va en
# tu ~/.zshrc y lo agregás vos — ver ANDROID.md.

# ─── JDK 21 ────────────────────────────────────────────────────────────
# Capacitor 8 compila contra Java 21 (sourceCompatibility VERSION_21).
# Se acepta cualquier distribución: Zulu, Temurin, Microsoft, Corretto.
if [ -z "$JAVA_HOME" ] || [ ! -x "$JAVA_HOME/bin/javac" ]; then
  for _candidate in /Library/Java/JavaVirtualMachines/*21*/Contents/Home; do
    if [ -x "$_candidate/bin/javac" ]; then
      JAVA_HOME="$_candidate"
      break
    fi
  done
  unset _candidate
fi

if [ -z "$JAVA_HOME" ] || [ ! -x "$JAVA_HOME/bin/javac" ]; then
  echo "No encuentro un JDK 21. Instalalo con:" >&2
  echo "    brew install --cask zulu@21" >&2
  return 1 2>/dev/null || exit 1
fi

# ─── SDK de Android ────────────────────────────────────────────────────
if [ -z "$ANDROID_HOME" ] || [ ! -d "$ANDROID_HOME" ]; then
  for _candidate in \
    /opt/homebrew/share/android-commandlinetools \
    "$HOME/Library/Android/sdk" \
    /usr/local/share/android-commandlinetools
  do
    if [ -d "$_candidate" ]; then
      ANDROID_HOME="$_candidate"
      break
    fi
  done
  unset _candidate
fi

if [ -z "$ANDROID_HOME" ] || [ ! -d "$ANDROID_HOME" ]; then
  echo "No encuentro el SDK de Android. Instalalo con:" >&2
  echo "    brew install --cask android-commandlinetools" >&2
  return 1 2>/dev/null || exit 1
fi

export JAVA_HOME
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
