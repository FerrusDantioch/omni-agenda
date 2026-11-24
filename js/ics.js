// =============================================================
// ics.js — Export au format standard iCalendar (RFC 5545, .ics)
// -------------------------------------------------------------
// Fabrique un fichier .ics conforme à la RFC 5545 :
//  - fins de ligne strictes CRLF (\r\n) ;
//  - échappement RFC 5545 (§3.3.11) et suppression des caractères
//    de contrôle pour empêcher toute injection de propriétés ;
//  - pliage à 75 octets UTF-8 sans couper les caractères multi-octets ;
//  - VEVENT (journée entière, horaire UTC ou récurrent flottant, RRULE, VALARM) ;
//  - VTODO pour les tâches.
// =============================================================

import { APP_VERSION } from './config.js';
import { addDays, toISODate } from './dates.js';
import { getEventSchedule } from './entries.js';
import { RECURRENCE_FREQS } from './recurrence.js';
import { htmlToText } from './sanitize.js';
import { isLocked, isSecurityReady } from './security.js';

const encoder = new TextEncoder();
const PRIORITY_ICS = { high: 1, normal: 5, low: 9 };

function pad2(n) {
  return String(n).padStart(2, '0');
}

function yyyymmdd(iso) {
  return iso.replaceAll('-', '');
}

function hhmmss(time) {
  return `${time.replace(':', '')}00`;
}

function toUtcIcs(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return toUtcIcs(new Date());
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

/** Échappe un texte selon RFC 5545 §3.3.11 et retire les caractères de contrôle dangereux. */
export function escapeIcsText(text) {
  return String(text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n|\r|\n/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** Plie une ligne iCalendar à 75 octets UTF-8 au maximum (sans couper un point de code). */
export function foldIcsLine(line) {
  const str = String(line ?? '');
  if (encoder.encode(str).length <= 75) return str;

  const lines = [];
  let current = '';
  let currentBytes = 0;
  let maxBytes = 75;

  for (const ch of str) {
    const chBytes = encoder.encode(ch).length;
    if (currentBytes + chBytes > maxBytes && current !== '') {
      lines.push(current);
      current = ch;
      currentBytes = chBytes;
      maxBytes = 74; // Les lignes suivantes commencent par un espace (1 octet).
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current !== '') lines.push(current);
  return lines.join('\r\n ');
}

function buildRrule(entry) {
  const rule = entry.recurrence;
  if (!rule || !Object.hasOwn(RECURRENCE_FREQS, rule.freq)) return null;
  const parts = [`FREQ=${rule.freq.toUpperCase()}`];
  if (Number.isInteger(rule.interval) && rule.interval > 1) {
    parts.push(`INTERVAL=${rule.interval}`);
  }
  if (rule.until) {
    parts.push(entry.allDay
      ? `UNTIL=${yyyymmdd(rule.until)}`
      : `UNTIL=${yyyymmdd(rule.until)}T235959`);
  } else if (Number.isInteger(rule.count) && rule.count >= 1) {
    parts.push(`COUNT=${rule.count}`);
  }
  return `RRULE:${parts.join(';')}`;
}

function eventLines(entry, stamp) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(entry.id)}@omni-agenda.local`,
    `DTSTAMP:${stamp}`,
    `CREATED:${toUtcIcs(entry.createdAt)}`,
    `LAST-MODIFIED:${toUtcIcs(entry.updatedAt)}`,
    `SUMMARY:${escapeIcsText(entry.title)}`,
  ];

  const descriptionText = htmlToText(entry.description ?? '').trim();
  if (descriptionText) lines.push(`DESCRIPTION:${escapeIcsText(descriptionText)}`);
  if (entry.location) lines.push(`LOCATION:${escapeIcsText(entry.location)}`);

  if (entry.allDay) {
    const endInclusive = entry.endDate && entry.endDate >= entry.date ? entry.endDate : entry.date;
    lines.push(`DTSTART;VALUE=DATE:${yyyymmdd(entry.date)}`);
    lines.push(`DTEND;VALUE=DATE:${yyyymmdd(addDays(endInclusive, 1))}`);
  } else if (!entry.recurrence) {
    const schedule = getEventSchedule(entry);
    lines.push(`DTSTART:${toUtcIcs(schedule.start)}`);
    lines.push(`DTEND:${toUtcIcs(schedule.end)}`);
  } else {
    const endDate = entry.endTime < entry.startTime ? addDays(entry.date, 1) : entry.date;
    lines.push(`DTSTART:${yyyymmdd(entry.date)}T${hhmmss(entry.startTime)}`);
    lines.push(`DTEND:${yyyymmdd(endDate)}T${hhmmss(entry.endTime)}`);
  }

  const rrule = buildRrule(entry);
  if (rrule) lines.push(rrule);

  if (entry.reminderMinutes !== null && entry.reminderMinutes !== undefined) {
    const trigger = entry.reminderMinutes === 0 ? 'PT0S' : `-PT${entry.reminderMinutes}M`;
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Rappel', `TRIGGER:${trigger}`, 'END:VALARM');
  }

  lines.push('END:VEVENT');
  return lines;
}

function taskLines(entry, stamp) {
  const lines = [
    'BEGIN:VTODO',
    `UID:${escapeIcsText(entry.id)}@omni-agenda.local`,
    `DTSTAMP:${stamp}`,
    `CREATED:${toUtcIcs(entry.createdAt)}`,
    `LAST-MODIFIED:${toUtcIcs(entry.updatedAt)}`,
    `SUMMARY:${escapeIcsText(entry.title)}`,
  ];

  const descriptionText = htmlToText(entry.description ?? '').trim();
  if (descriptionText) lines.push(`DESCRIPTION:${escapeIcsText(descriptionText)}`);
  if (entry.dueDate) lines.push(`DUE;VALUE=DATE:${yyyymmdd(entry.dueDate)}`);
  lines.push(`PRIORITY:${PRIORITY_ICS[entry.priority] ?? 5}`);
  lines.push(`STATUS:${entry.done ? 'COMPLETED' : 'NEEDS-ACTION'}`);
  if (entry.done) {
    lines.push(`COMPLETED:${toUtcIcs(entry.doneAt || entry.updatedAt)}`);
    lines.push('PERCENT-COMPLETE:100');
  }
  lines.push('END:VTODO');
  return lines;
}

/**
 * Génère le contenu iCalendar (.ics) pour une liste d'entrées.
 * Fonction pure (n'accède ni au stockage ni au DOM).
 */
export function exportEntriesToIcs(entries, { now = new Date(), appVersion = APP_VERSION } = {}) {
  const stamp = toUtcIcs(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Omni-Agenda//Omni-Agenda ${escapeIcsText(appVersion)}//FR`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.type === 'event') lines.push(...eventLines(entry, stamp));
    else if (entry.type === 'task') lines.push(...taskLines(entry, stamp));
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

/** Exporte uniquement si la session est initialisée et déverrouillée (fail-closed). */
export function exportAgendaIcs(entries, options = {}) {
  if (!isSecurityReady() || isLocked()) {
    throw new Error('Agenda verrouillé : export .ics impossible.');
  }
  return exportEntriesToIcs(entries, options);
}

/** Nom de fichier suggéré pour l'export .ics. */
export function icsFileName(dateISO = toISODate(new Date())) {
  return `omni-agenda-${dateISO}.ics`;
}
