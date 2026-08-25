/**
 * Días de calendario en la zona horaria del usuario.
 *
 * Por qué existe este módulo
 * --------------------------
 * Todo el backend contaba `Math.floor(elapsed / 24h)`, que no son días sino
 * bloques de 24 horas. Una sesión del domingo a las 22:45 seguía dando 1 el
 * martes a la tarde, porque habían pasado 42 horas: un solo bloque completo.
 * Entrenando de noche el contador se atrasa un día entero, y eso alimenta el
 * veto por patrón reciente y los badges "3D" de los ejercicios.
 *
 * La otra mitad del problema es la zona horaria. El server corre en UTC, así que
 * agrupar por `toISOString().slice(0,10)` mete esa sesión del domingo 22:45 en
 * el lunes. Se rotula por la fecha local del usuario, que es la que él ve en el
 * historial ("SUN 23 AUG") y la única que coincide con lo que realmente pasó.
 *
 * `APP_TIMEZONE` la deja configurable sin tocar código. El default es la zona de
 * quien usa la app; si algún día hay más de un usuario, esto pasa a ser un dato
 * por usuario y no una constante del proceso.
 */

const TIMEZONE = process.env.APP_TIMEZONE || "America/Argentina/Buenos_Aires";

const DIA_MS = 24 * 60 * 60 * 1000;

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Fecha → "YYYY-MM-DD" en la zona del usuario. Sirve para agrupar por día y como
 * base de la resta de días.
 *
 * Se arma desde `formatToParts` y no desde un locale que ya devuelva ISO: el
 * formato de un locale es un detalle de ICU y puede cambiar entre versiones de
 * Node, mientras que los `type` de las partes son estables.
 */
function dayKey(date) {
  const parts = fmt.formatToParts(new Date(date));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Cuántas medianoches locales hay entre `date` y `now`. Mismo día → 0, ayer → 1.
 *
 * Las dos fechas se anclan a medianoche UTC de su día local antes de restar, así
 * que la diferencia siempre es un múltiplo exacto de 24h y el cambio de horario
 * (días de 23 o 25 horas) no se cuela en la cuenta.
 */
function diasDeCalendario(date, now) {
  const a = Date.parse(`${dayKey(date)}T00:00:00Z`);
  const b = Date.parse(`${dayKey(now)}T00:00:00Z`);
  return Math.round((b - a) / DIA_MS);
}

module.exports = { TIMEZONE, dayKey, diasDeCalendario };
