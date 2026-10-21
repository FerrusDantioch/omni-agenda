// =============================================================
// dates.js — Calcul et affichage des dates et des heures
// -------------------------------------------------------------
// Vocabulaire utilisé dans ce fichier :
//   - « date ISO » : une date écrite '2026-10-21' (année-mois-jour) ;
//   - « heure »    : une heure écrite '14:30' ;
//   - « fuseau »   : le fuseau horaire, par exemple 'Europe/Paris' ;
//   - « instant »  : un moment précis dans le temps, identique
//                    partout dans le monde (objet Date de JavaScript).
//
// Principe pour les rendez-vous : on enregistre l'heure telle
// qu'elle se lit sur l'horloge (« 14:00 ») et le fuseau horaire.
// Ainsi, un rendez-vous à 14 h reste à 14 h même si l'heure d'été
// ou d'hiver arrive entre-temps.
// =============================================================

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Ajoute un zéro devant les nombres à un chiffre : 7 → '07'. */
function pad(number) {
  return String(number).padStart(2, '0');
}

// ---------------------------------------------------------------
// Vérifications
// ---------------------------------------------------------------

/** Vrai si `value` est une vraie date ISO (le 30 février est refusé). */
export function isValidISODate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900 || year > 2200) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

/** Vrai si `value` est une heure valide '00:00' à '23:59'. */
export function isValidTime(value) {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

/** Vrai si le navigateur connaît ce fuseau horaire. */
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Le fuseau horaire de l'appareil, par exemple 'Europe/Paris'. */
export function getDeviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// ---------------------------------------------------------------
// Conversions simples
// ---------------------------------------------------------------

/** '2026-10-21' → { year: 2026, month: 10, day: 21 } */
export function parseISODate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

/** Date JavaScript → '2026-10-21' (selon l'horloge de l'appareil). */
export function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Date JavaScript → '14:30' (selon l'horloge de l'appareil). */
export function toTimeString(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** La date du jour, par exemple '2026-10-21'. */
export function todayISO() {
  return toISODate(new Date());
}

/**
 * Ajoute (ou retire) des jours à une date ISO.
 * Le calcul se fait en temps universel : les changements d'heure
 * ne peuvent donc pas le fausser.
 */
export function addDays(iso, days) {
  const { year, month, day } = parseISODate(iso);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`;
}

/** '14:30' → 870 (nombre de minutes depuis minuit). */
export function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** 870 → '14:30'. Les valeurs hors d'une journée « font le tour » de l'horloge. */
export function minutesToTime(totalMinutes) {
  const minutesInDay = ((totalMinutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(minutesInDay / 60))}:${pad(minutesInDay % 60)}`;
}

// ---------------------------------------------------------------
// Fuseaux horaires et changements d'heure
// ---------------------------------------------------------------

const zoneFormatters = new Map();

/** Prépare (une seule fois par fuseau) un outil qui lit l'heure dans ce fuseau. */
function getZoneFormatter(timeZone) {
  if (!zoneFormatters.has(timeZone)) {
    zoneFormatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }));
  }
  return zoneFormatters.get(timeZone);
}

/** Lit la date et l'heure affichées par une horloge du fuseau donné, à un instant donné. */
function readZoneClock(timeZone, instantMs) {
  const parts = {};
  for (const part of getZoneFormatter(timeZone).formatToParts(new Date(instantMs))) {
    parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Décalage du fuseau par rapport au temps universel, en millisecondes, à un instant donné. */
function getZoneOffsetMs(timeZone, instantMs) {
  const clock = readZoneClock(timeZone, instantMs);
  const clockAsUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
  return clockAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Transforme « telle date, telle heure, dans tel fuseau » en instant précis.
 *
 * Deux cas particuliers liés aux changements d'heure :
 *  - heure qui n'existe pas (passage à l'heure d'été, ex. 02:30 le
 *    dernier dimanche de mars en France) : on avance de la durée du saut
 *    (02:30 devient 03:30) ;
 *  - heure qui existe deux fois (passage à l'heure d'hiver) : on prend
 *    la première des deux.
 */
export function zonedTimeToInstant(dateISO, time, timeZone) {
  const zone = isValidTimeZone(timeZone) ? timeZone : getDeviceTimeZone();
  const { year, month, day } = parseISODate(dateISO);
  const [hours, minutes] = time.split(':').map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, hours, minutes);

  // Décalages en vigueur la veille et le lendemain (un changement d'heure
  // au plus peut se trouver entre les deux).
  const offsetBefore = getZoneOffsetMs(zone, wallAsUtc - 86400000);
  const offsetAfter = getZoneOffsetMs(zone, wallAsUtc + 86400000);

  // On garde les candidats qui « retombent » bien sur l'heure demandée.
  const candidates = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => wallAsUtc - offset)
    .filter((instant) => getZoneOffsetMs(zone, instant) === wallAsUtc - instant)
    .sort((a, b) => a - b);

  if (candidates.length > 0) return new Date(candidates[0]);
  // Heure inexistante : on applique le décalage d'avant le saut.
  return new Date(wallAsUtc - offsetBefore);
}

/** Instant → { date: '2026-10-21', time: '14:30' } tel que lu dans le fuseau donné. */
export function instantToZoned(instant, timeZone) {
  const clock = readZoneClock(timeZone, instant.getTime());
  return {
    date: `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`,
    time: `${pad(clock.hour)}:${pad(clock.minute)}`,
  };
}

/** Faux si cette heure n'existe pas ce jour-là dans ce fuseau (passage à l'heure d'été). */
export function wallTimeExists(dateISO, time, timeZone) {
  const back = instantToZoned(zonedTimeToInstant(dateISO, time, timeZone), timeZone);
  return back.date === dateISO && back.time === time;
}

// ---------------------------------------------------------------
// Affichage en français
// ---------------------------------------------------------------

const longDateFormat = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Met une majuscule à la première lettre : « mercredi » → « Mercredi ». */
export function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Date JavaScript → « Mercredi 21 octobre 2026 ». */
export function formatLongDate(date) {
  return capitalize(longDateFormat.format(date));
}

/**
 * Date ISO → « Mercredi 21 octobre 2026 ».
 * On place l'heure à midi pour éviter tout effet d'un changement d'heure à minuit.
 */
export function formatISODateLong(iso) {
  const { year, month, day } = parseISODate(iso);
  return formatLongDate(new Date(year, month - 1, day, 12));
}

/** « Aujourd'hui », « Demain », « Hier », ou null pour les autres jours. */
export function relativeDayLabel(iso) {
  const today = todayISO();
  if (iso === today) return "Aujourd'hui";
  if (iso === addDays(today, 1)) return 'Demain';
  if (iso === addDays(today, -1)) return 'Hier';
  return null;
}
