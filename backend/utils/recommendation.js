/**
 * Motor de recomendación por balance de patrones.
 *
 * Criterios (todos ajustables por query param, ver DEFAULTS):
 *
 *  1. Ventana        — últimas N sesiones, descartando las más viejas que X días.
 *                      Se mide en SESIONES y no en días de calendario a propósito:
 *                      un parate de 10 días vacía una ventana de "últimos 30 días"
 *                      y deja al motor decidiendo sobre 3 sesiones.
 *
 *  2. Score          — dos fuerzas por patrón:
 *                        · déficit  = qué tan por debajo del objetivo está su share
 *                        · frescura = días sin tocarlo, saturada en `recoveryDays`
 *                      La saturación es lo que hace que el motor aguante los parates
 *                      sin caso especial: entrenando seguido, la frescura evita
 *                      repetir patrón; después de un parate todos los patrones
 *                      saturan a 1, la frescura deja de discriminar y manda el
 *                      balance — que es justo lo que hay que mirar al volver.
 *
 *  3. Correctivo     — mientras tracción esté por debajo de su objetivo, su déficit
 *                      se multiplica por `correctiveFactor`. Cuando lo alcanza el
 *                      déficit deja de ser positivo y el refuerzo se apaga solo:
 *                      no hay que acordarse de desactivarlo.
 *
 *  4. Asignación     — los 4 slots no-core se asignan de a uno, RE-SCOREANDO después
 *                      de cada asignación. Así un patrón muy atrasado se lleva dos
 *                      slots, y cuando todo está parejo la sesión cubre los 4
 *                      patrones distintos por sí sola.
 *
 *  5. Ejercicios     — primero los que nunca hiciste (tope `maxNew` por sesión para
 *                      que una tanda de altas no te deje una sesión entera de
 *                      movimientos desconocidos), después el más descansado.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

// Los 4 patrones que compiten por los slots de bodyweight/overload. `core` queda
// afuera: tiene bloque propio y aparece en todas las sesiones, así que no compite.
const PATRONES_BALANCE = ["empuje", "traccion", "rodilla_dominante", "cadera_dominante"];

const DEFAULTS = {
  windowSessions: 12,
  maxAgeDays: 60,
  recoveryDays: 7,
  wBalance: 0.65,
  wFresh: 0.35,
  correctivePattern: "traccion",
  correctiveFactor: 1.5,
  maxNew: 2,
  avoidLastSessions: 1,
  slotsCore: 1,
  slotsBodyweight: 2,
  slotsOverload: 2,
  alternatives: 2,
};

function num(value, def, { min, max }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

function round(n, d = 3) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function clamp01(n) {
  return Math.min(Math.max(n, 0), 1);
}

function normalize(name) {
  return String(name ?? "").trim().toLowerCase();
}

/** Lee y valida los parámetros del motor desde el query string. */
function readParams(query) {
  const q = query || {};
  const p = {
    windowSessions: num(q.windowSessions, DEFAULTS.windowSessions, { min: 3, max: 60 }),
    maxAgeDays: num(q.maxAgeDays, DEFAULTS.maxAgeDays, { min: 7, max: 365 }),
    recoveryDays: num(q.recoveryDays, DEFAULTS.recoveryDays, { min: 1, max: 30 }),
    wBalance: num(q.wBalance, DEFAULTS.wBalance, { min: 0, max: 1 }),
    wFresh: num(q.wFresh, DEFAULTS.wFresh, { min: 0, max: 1 }),
    correctivePattern:
      q.correctivePattern === "none"
        ? null
        : PATRONES_BALANCE.includes(normalize(q.correctivePattern))
        ? normalize(q.correctivePattern)
        : DEFAULTS.correctivePattern,
    correctiveFactor: num(q.correctiveFactor, DEFAULTS.correctiveFactor, { min: 1, max: 4 }),
    maxNew: num(q.maxNew, DEFAULTS.maxNew, { min: 0, max: 5 }),
    avoidLastSessions: num(q.avoidLastSessions, DEFAULTS.avoidLastSessions, { min: 0, max: 5 }),
    slots: {
      core: num(q.slotsCore, DEFAULTS.slotsCore, { min: 0, max: 3 }),
      bodyweight: num(q.slotsBodyweight, DEFAULTS.slotsBodyweight, { min: 0, max: 5 }),
      overload: num(q.slotsOverload, DEFAULTS.slotsOverload, { min: 0, max: 5 }),
    },
    alternatives: num(q.alternatives, DEFAULTS.alternatives, { min: 0, max: 5 }),
  };

  // Los pesos se normalizan para que sumen 1: así `?wBalance=2&wFresh=1` es
  // legible como "el balance pesa el doble" sin tener que calcular fracciones.
  const total = p.wBalance + p.wFresh;
  if (total > 0) {
    p.wBalance = p.wBalance / total;
    p.wFresh = p.wFresh / total;
  } else {
    p.wBalance = 1;
    p.wFresh = 0;
  }

  return p;
}

/**
 * Score de un patrón dado un conteo de slots.
 *
 * `deficitScore` mapea el déficit a 0..1, donde 0.5 = justo en el objetivo.
 * `freshScore` es 0 recién trabajado y 1 a partir de `recoveryDays` días.
 */
function scorePattern(patron, counts, lastSeenDays, params) {
  const totalSlots = PATRONES_BALANCE.reduce((acc, p) => acc + (counts[p] || 0), 0);
  const target = 1 / PATRONES_BALANCE.length;

  // Sin historial en la ventana no hay balance que medir: todos empatan en el
  // objetivo y decide la frescura.
  const share = totalSlots > 0 ? (counts[patron] || 0) / totalSlots : target;
  let deficit = target - share;

  const corrective = params.correctivePattern === patron && deficit > 0;
  if (corrective) deficit *= params.correctiveFactor;

  // El déficit vive en (-target, +target). Se lleva a 0..1 con 0.5 = en objetivo.
  const deficitScore = clamp01((deficit + target) / (2 * target));

  const days = lastSeenDays[patron];
  const freshScore = days === null || days === undefined ? 1 : clamp01(days / params.recoveryDays);

  return {
    patron,
    score: round(params.wBalance * deficitScore + params.wFresh * freshScore, 4),
    share: round(share, 3),
    target: round(target, 3),
    deficit: round(target - share, 3), // el crudo, sin el factor correctivo
    corrective,
    deficitScore: round(deficitScore, 3),
    freshScore: round(freshScore, 3),
    daysSinceLast: days ?? null,
    slotsInWindow: counts[patron] || 0,
  };
}

/**
 * Construye la recomendación completa.
 *
 * @param workouts  sesiones ordenadas por fecha DESC (documentos lean de Mongo)
 * @param exercises catálogo completo (documentos lean de Mongo)
 * @param params    salida de readParams()
 * @param now       timestamp en ms
 */
function buildRecommendation(workouts, exercises, params, now) {
  const BLOQUES = ["core", "bodyweight", "overload"];

  const byName = new Map();
  exercises.forEach((ex) => byName.set(normalize(ex.name), ex));

  const patronesDe = (name) => byName.get(normalize(name))?.patrones || [];

  // ---- Ventana ------------------------------------------------------------
  const minDate = now - params.maxAgeDays * DIA_MS;
  let windowWorkouts = workouts
    .filter((w) => new Date(w.date).getTime() >= minDate)
    .slice(0, params.windowSessions);

  // Parate largo: si el tope de antigüedad deja la ventana casi vacía, el
  // balance se calcularía sobre nada y los 4 patrones empatarían — la
  // recomendación pasaría a ser arbitraria justo cuando volvés y más importa
  // acertar. En ese caso se ignora el tope y se usan las últimas N sesiones,
  // por viejas que sean: historia vieja es peor que nada, pero mucho mejor que
  // el vacío.
  const MIN_SESIONES_UTILES = 3;
  let ventanaDegradada = false;
  if (windowWorkouts.length < MIN_SESIONES_UTILES && workouts.length) {
    windowWorkouts = workouts.slice(0, params.windowSessions);
    ventanaDegradada = true;
  }

  // ---- Conteo de slots por patrón dentro de la ventana --------------------
  const counts = {};
  PATRONES_BALANCE.forEach((p) => (counts[p] = 0));

  const sinClasificar = new Set();

  windowWorkouts.forEach((w) => {
    BLOQUES.forEach((bloque) => {
      (w[bloque] || []).forEach((raw) => {
        const name = normalize(raw);
        if (!name) return;
        const patrones = patronesDe(name);
        if (!patrones.length) sinClasificar.add(name);
        patrones.forEach((p) => {
          if (p in counts) counts[p] += 1;
        });
      });
    });
  });

  // ---- Días desde la última vez que se tocó cada patrón -------------------
  // Se mide sobre TODO el histórico, no sólo la ventana: si un patrón quedó
  // fuera de la ventana justamente por abandonado, su frescura tiene que
  // reflejar el abandono real y no un null.
  const lastSeenDays = {};
  PATRONES_BALANCE.forEach((p) => (lastSeenDays[p] = null));

  for (const w of workouts) {
    const age = Math.floor((now - new Date(w.date).getTime()) / DIA_MS);
    const enSesion = new Set();
    BLOQUES.forEach((bloque) =>
      (w[bloque] || []).forEach((raw) => patronesDe(raw).forEach((p) => enSesion.add(p)))
    );
    enSesion.forEach((p) => {
      if (p in lastSeenDays && lastSeenDays[p] === null) lastSeenDays[p] = age;
    });
    if (PATRONES_BALANCE.every((p) => lastSeenDays[p] !== null)) break;
  }

  // ---- Ejercicios a evitar por uso reciente -------------------------------
  const usadosReciente = new Set();
  workouts.slice(0, params.avoidLastSessions).forEach((w) =>
    BLOQUES.forEach((bloque) =>
      (w[bloque] || []).forEach((raw) => usadosReciente.add(normalize(raw)))
    )
  );

  // ---- Estado inicial: cómo está el balance antes de recomendar -----------
  const balanceBefore = PATRONES_BALANCE.map((p) =>
    scorePattern(p, counts, lastSeenDays, params)
  ).sort((a, b) => b.score - a.score);

  // ---- Asignación de slots ------------------------------------------------
  // Un slot a la vez, re-scoreando después de cada asignación. Eso es lo que
  // hace que un patrón muy atrasado se lleve dos slots y que, con todo parejo,
  // la sesión cubra sola los 4 patrones distintos.
  const trabajo = { ...counts };
  const elegidos = [];
  const usadosEnEstaSesion = new Set();
  let nuevosUsados = 0;

  // Copia mutable de la frescura. Cuando un patrón se lleva un slot pasa a
  // contar como trabajado HOY para las decisiones que siguen dentro de la misma
  // sesión. Sin esto un patrón descansado gana todos los slots seguidos: el
  // share apenas se mueve con un slot más, así que su ventaja de frescura queda
  // intacta y vuelve a ganar. Es la diferencia entre repartir la sesión entre
  // patrones y hacer una sesión monotemática.
  const frescura = { ...lastSeenDays };

  /** Candidatos para (patrón, bloque), ya ordenados por la regla de selección. */
  function candidatos(patron, bloque) {
    return exercises
      .filter((ex) => {
        if (ex.modalidad !== bloque) return false;
        if (!(ex.patrones || []).includes(patron)) return false;
        const n = normalize(ex.name);
        if (usadosEnEstaSesion.has(n)) return false;
        if (usadosReciente.has(n)) return false;
        return true;
      })
      .map((ex) => {
        const esNuevo = (ex.daysPerformed || 0) === 0;
        const dias = ex.lastPerformed
          ? Math.floor((now - new Date(ex.lastPerformed).getTime()) / DIA_MS)
          : null;
        return { name: ex.name, esNuevo, daysSinceLast: dias, daysPerformed: ex.daysPerformed || 0 };
      })
      .sort((a, b) => {
        // Los nunca hechos primero — salvo que ya se haya agotado el cupo de
        // novedad de la sesión, en cuyo caso pierden la prioridad.
        const cupo = nuevosUsados < params.maxNew;
        if (cupo && a.esNuevo !== b.esNuevo) return a.esNuevo ? -1 : 1;
        if (!cupo && a.esNuevo !== b.esNuevo) return a.esNuevo ? 1 : -1;
        // Después, el más descansado.
        const av = a.daysSinceLast === null ? Infinity : a.daysSinceLast;
        const bv = b.daysSinceLast === null ? Infinity : b.daysSinceLast;
        if (bv !== av) return bv - av;
        return a.name.localeCompare(b.name);
      });
  }

  // ---- Slot(s) de core ----------------------------------------------------
  // El bloque de core se elige por modalidad, no por patrón: en tu catálogo hay
  // ejercicios cargados como core que no son patrón core (caminata de cangrejo
  // es empuje) y así se respeta cómo usás el bloque en la práctica.
  const coreElegidos = [];
  for (let i = 0; i < params.slots.core; i++) {
    const opciones = exercises
      .filter((ex) => {
        const n = normalize(ex.name);
        return ex.modalidad === "core" && !usadosEnEstaSesion.has(n) && !usadosReciente.has(n);
      })
      .map((ex) => ({
        name: ex.name,
        esNuevo: (ex.daysPerformed || 0) === 0,
        patrones: ex.patrones || [],
        daysSinceLast: ex.lastPerformed
          ? Math.floor((now - new Date(ex.lastPerformed).getTime()) / DIA_MS)
          : null,
      }))
      .sort((a, b) => {
        const cupo = nuevosUsados < params.maxNew;
        if (cupo && a.esNuevo !== b.esNuevo) return a.esNuevo ? -1 : 1;
        if (!cupo && a.esNuevo !== b.esNuevo) return a.esNuevo ? 1 : -1;
        const av = a.daysSinceLast === null ? Infinity : a.daysSinceLast;
        const bv = b.daysSinceLast === null ? Infinity : b.daysSinceLast;
        if (bv !== av) return bv - av;
        return a.name.localeCompare(b.name);
      });

    if (!opciones.length) break;
    const pick = opciones[0];
    usadosEnEstaSesion.add(normalize(pick.name));
    if (pick.esNuevo) nuevosUsados += 1;
    // El core se elige antes que los slots de trabajo justamente para que, si el
    // ejercicio elegido arrastra otro patrón (caminata de cangrejo es empuje),
    // eso ya pese en el reparto de los 4 slots que siguen.
    pick.patrones.forEach((p) => {
      if (p in trabajo) {
        trabajo[p] += 1;
        frescura[p] = 0;
      }
    });

    coreElegidos.push({
      bloque: "core",
      ejercicio: pick.name,
      patrones: pick.patrones,
      esNuevo: pick.esNuevo,
      daysSinceLast: pick.daysSinceLast,
      alternativas: opciones.slice(1, 1 + params.alternatives).map((o) => ({
        name: o.name,
        esNuevo: o.esNuevo,
        daysSinceLast: o.daysSinceLast,
      })),
    });
  }

  // Bloques a llenar, en orden. Bodyweight primero porque es el bloque con menos
  // inventario (sólo 3 opciones de tracción y 3 de cadera): conviene que elija
  // cuando todavía tiene todos los patrones disponibles.
  const slotsAllenar = [
    ...Array(params.slots.bodyweight).fill("bodyweight"),
    ...Array(params.slots.overload).fill("overload"),
  ];

  slotsAllenar.forEach((bloque, i) => {
    const ranking = PATRONES_BALANCE.map((p) =>
      scorePattern(p, trabajo, frescura, params)
    ).sort((a, b) => b.score - a.score);

    for (const cand of ranking) {
      const opciones = candidatos(cand.patron, bloque);
      if (!opciones.length) continue; // sin inventario para ese patrón en ese bloque

      const pick = opciones[0];
      usadosEnEstaSesion.add(normalize(pick.name));
      if (pick.esNuevo) nuevosUsados += 1;
      trabajo[cand.patron] += 1;
      frescura[cand.patron] = 0; // ya se trabaja en esta sesión

      // Un complejo cubre más de un patrón: los otros también quedan trabajados.
      (byName.get(normalize(pick.name))?.patrones || []).forEach((p) => {
        if (p !== cand.patron && p in frescura) {
          frescura[p] = 0;
          trabajo[p] += 1;
        }
      });

      elegidos.push({
        slot: i + 1,
        bloque,
        patron: cand.patron,
        ejercicio: pick.name,
        esNuevo: pick.esNuevo,
        daysSinceLast: pick.daysSinceLast,
        porQue: {
          score: cand.score,
          shareEnVentana: cand.share,
          objetivo: cand.target,
          deficit: cand.deficit,
          correctivoAplicado: cand.corrective,
          diasSinElPatron: cand.daysSinceLast,
        },
        alternativas: opciones.slice(1, 1 + params.alternatives).map((o) => ({
          name: o.name,
          esNuevo: o.esNuevo,
          daysSinceLast: o.daysSinceLast,
        })),
      });
      return;
    }
  });

  // ---- Balance proyectado -------------------------------------------------
  const totalDespues = PATRONES_BALANCE.reduce((acc, p) => acc + trabajo[p], 0);
  const balanceAfter = PATRONES_BALANCE.map((p) => ({
    patron: p,
    slots: trabajo[p],
    share: totalDespues ? round(trabajo[p] / totalDespues, 3) : 0,
  })).sort((a, b) => b.share - a.share);

  const ultima = workouts[0];
  const diasDesdeUltimo = ultima
    ? Math.floor((now - new Date(ultima.date).getTime()) / DIA_MS)
    : null;

  return {
    generatedAt: new Date(now).toISOString(),
    params: {
      windowSessions: params.windowSessions,
      maxAgeDays: params.maxAgeDays,
      recoveryDays: params.recoveryDays,
      wBalance: round(params.wBalance, 3),
      wFresh: round(params.wFresh, 3),
      correctivePattern: params.correctivePattern,
      correctiveFactor: params.correctiveFactor,
      maxNew: params.maxNew,
      avoidLastSessions: params.avoidLastSessions,
      slots: params.slots,
    },
    contexto: {
      sesionesEnVentana: windowWorkouts.length,
      ventanaDegradada, // true = se ignoró maxAgeDays porque no había datos recientes
      ventanaDesde: windowWorkouts.length
        ? new Date(windowWorkouts[windowWorkouts.length - 1].date).toISOString()
        : null,
      diasDesdeUltimoEntrenamiento: diasDesdeUltimo,
      // Un parate largo no cambia la lógica, pero sí vale avisarlo en el mail.
      vueltaDeParate: diasDesdeUltimo !== null && diasDesdeUltimo >= params.recoveryDays,
      ejerciciosSinClasificar: [...sinClasificar],
      cupoNovedadUsado: nuevosUsados,
    },
    balanceActual: balanceBefore,
    recomendacion: {
      core: coreElegidos,
      trabajo: elegidos,
    },
    balanceProyectado: balanceAfter,
  };
}

module.exports = {
  PATRONES_BALANCE,
  DEFAULTS,
  readParams,
  scorePattern,
  buildRecommendation,
};
