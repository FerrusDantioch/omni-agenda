// =============================================================
// reminders.js — Quand afficher un rappel, et quoi y écrire
// -------------------------------------------------------------
// Un rendez-vous peut avoir un rappel (ex. : 15 minutes avant).
// Le rappel s'affiche à partir de son heure, et tant que le
// rendez-vous n'a pas commencé. Ainsi, si l'application est
// ouverte un peu après l'heure du rappel, il s'affiche quand même.
// Un rappel « à l'heure du rendez-vous » peut s'afficher jusqu'à
// 10 minutes après le début.
//
// Ce fichier ne fait que des calculs : l'affichage est dans
// js/notifications.js.
// =============================================================

import { getEventSchedule } from './entries.js';
import { formatDayMonth, formatWeekday, relativeDayLabel } from './dates.js';

const MINUTE = 60 * 1000;
const ON_TIME_GRACE_MS = 10 * MINUTE;

/** Identifiant d'un rappel : il change si l'heure du rendez-vous ou du rappel change. */
function reminderKey(entry, fireAt) {
  return `${entry.id}|${fireAt}`;
}

/**
 * Les rappels à afficher à l'instant `now` (objet Date).
 * Renvoie [{ key, entry, schedule }], du rendez-vous le plus proche au plus lointain.
 */
export function getDueReminders(entries, now) {
  const time = now.getTime();
  const due = [];
  for (const entry of entries) {
    if (entry.type !== 'event' || entry.reminderMinutes === null) continue;
    const schedule = getEventSchedule(entry);
    const start = schedule.start.getTime();
    const fireAt = start - entry.reminderMinutes * MINUTE;
    const until = entry.reminderMinutes === 0 ? start + ON_TIME_GRACE_MS : start;
    if (time >= fireAt && time < until) due.push({ key: reminderKey(entry, fireAt), entry, schedule });
  }
  return due.sort((a, b) => a.schedule.start - b.schedule.start);
}

/** « Dans 15 minutes, à 14:00 », « Commence maintenant (14:00) », « Demain à 14:00 »… */
function whenText(schedule, now) {
  const minutesLeft = Math.round((schedule.start.getTime() - now.getTime()) / MINUTE);
  if (minutesLeft <= 0) return `Commence maintenant (${schedule.startTime})`;
  if (minutesLeft < 60) {
    return `Dans ${minutesLeft} ${minutesLeft > 1 ? 'minutes' : 'minute'}, à ${schedule.startTime}`;
  }
  const day = relativeDayLabel(schedule.startDate)
    ?? `${formatWeekday(schedule.startDate)} ${formatDayMonth(schedule.startDate)}`;
  return `${day} à ${schedule.startTime}`;
}

/**
 * Le texte de la notification : { title, body }.
 * `discreet` : vrai si un mot de passe est actif. Le titre et le lieu ne
 * sont alors pas montrés, car une notification peut se lire sur l'écran
 * verrouillé du téléphone.
 */
export function reminderText({ entry, schedule }, now, { discreet = false } = {}) {
  const when = whenText(schedule, now);
  if (discreet) return { title: 'Rappel de rendez-vous', body: `${when}. Ouvre Omni-Agenda pour le voir.` };
  return { title: entry.title, body: entry.location ? `${when} · ${entry.location}` : when };
}
