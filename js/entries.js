// =============================================================
// entries.js — Ce qu'est un rendez-vous et une tâche
// -------------------------------------------------------------
// Une « entrée » est soit un rendez-vous, soit une tâche.
//
// Rendez-vous (type 'event') :
//   id, type, title, description, date, endDate, allDay, startTime,
//   endTime, timeZone, location, reminderMinutes, recurrence,
//   createdAt, updatedAt
//
// Tâche (type 'task') :
//   id, type, title, description, dueDate, priority, done,
//   doneAt, createdAt, updatedAt
//
// Si l'heure de fin est plus tôt que l'heure de début
// (ex. 22:00 → 01:00), le rendez-vous se termine le lendemain.
// =============================================================

import {
  addDays, getDeviceTimeZone, instantToZoned, isValidISODate, isValidTime,
  isValidTimeZone, normalizeTime, wallTimeExists, zonedTimeToInstant,
} from './dates.js';
import {
  MAX_RECURRENCE_COUNT, MAX_RECURRENCE_INTERVAL, RECURRENCE_FREQS,
} from './recurrence.js';
import { htmlToText, sanitizeHtml } from './sanitize.js';

export const TYPE_LABELS = { event: 'Rendez-vous', task: 'Tâche' };

export const PRIORITIES = [
  { id: 'low', label: 'Basse' },
  { id: 'normal', label: 'Normale' },
  { id: 'high', label: 'Haute' },
];
export const DEFAULT_PRIORITY = 'normal';
const PRIORITY_RANK = { low: 0, normal: 1, high: 2 };

/** Rappels proposés (en minutes avant le début ; null = pas de rappel). */
export const REMINDER_OPTIONS = [
  { minutes: null, label: 'Aucun rappel' },
  { minutes: 0, label: "À l'heure du rendez-vous" },
  { minutes: 5, label: '5 minutes avant' },
  { minutes: 15, label: '15 minutes avant' },
  { minutes: 30, label: '30 minutes avant' },
  { minutes: 60, label: '1 heure avant' },
  { minutes: 120, label: '2 heures avant' },
  { minutes: 1440, label: '1 jour avant' },
  { minutes: 2880, label: '2 jours avant' },
];

/** Longueurs maximales (en caractères). */
export const LIMITS = { title: 200, location: 200, description: 20000 };

// ---------------------------------------------------------------
// Petits outils
// ---------------------------------------------------------------

/** Fabrique un identifiant unique et aléatoire (format « UUID »). */
export function createId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Nettoie un texte d'une ligne : retire les caractères invisibles et les espaces autour. */
function cleanLine(value, maxLength) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

/** Vrai si c'est une date-heure enregistrée au format ISO complet. */
function isTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && value.includes('T');
}

/** Vrai si c'est une priorité connue (« Object.hasOwn » ignore les noms spéciaux comme « toString »). */
function isPriority(value) {
  return typeof value === 'string' && Object.hasOwn(PRIORITY_RANK, value);
}

function findReminder(value) {
  const minutes = value === '' || value === null || value === undefined ? null : Number(value);
  return REMINDER_OPTIONS.find((option) => option.minutes === minutes) ?? null;
}

function buildRecurrenceFromInput(input, date, errors) {
  let freq = '';
  let intervalRaw = 1;
  let endMode = 'never';
  let untilRaw = null;
  let countRaw = null;

  if (input.recurrence && typeof input.recurrence === 'object') {
    freq = input.recurrence.freq ?? '';
    intervalRaw = input.recurrence.interval ?? 1;
    untilRaw = input.recurrence.until ?? null;
    countRaw = input.recurrence.count ?? null;
    endMode = untilRaw ? 'until' : countRaw !== null && countRaw !== '' ? 'count' : 'never';
  } else if ('recurrenceFreq' in input) {
    freq = input.recurrenceFreq ?? '';
    intervalRaw = input.recurrenceInterval ?? 1;
    endMode = input.recurrenceEndMode ?? 'never';
    untilRaw = input.recurrenceUntil ?? null;
    countRaw = input.recurrenceCount ?? null;
  }

  if (!freq) return null;

  if (!Object.hasOwn(RECURRENCE_FREQS, freq)) {
    errors.recurrenceFreq = 'Choisis une fréquence valide.';
    return null;
  }

  const intervalStr = String(intervalRaw).trim();
  const interval = intervalStr === '' ? NaN : Number(intervalStr);
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_RECURRENCE_INTERVAL) {
    errors.recurrenceInterval = `Choisis un intervalle entre 1 et ${MAX_RECURRENCE_INTERVAL}.`;
  }

  let until = null;
  let count = null;
  if (endMode === 'until') {
    if (!isValidISODate(untilRaw)) {
      errors.recurrenceUntil = 'Choisis une date de fin de répétition valide.';
    } else if (!errors.date && untilRaw < date) {
      errors.recurrenceUntil = 'La fin de répétition doit être égale ou postérieure au début.';
    } else {
      until = untilRaw;
    }
  } else if (endMode === 'count') {
    const countStr = countRaw === null || countRaw === undefined ? '' : String(countRaw).trim();
    const parsedCount = countStr === '' ? NaN : Number(countStr);
    if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > MAX_RECURRENCE_COUNT) {
      errors.recurrenceCount = `Choisis un nombre de répétitions entre 1 et ${MAX_RECURRENCE_COUNT}.`;
    } else {
      count = parsedCount;
    }
  } else if (endMode !== 'never') {
    errors.recurrenceEndMode = 'Choisis une fin de répétition valide.';
  }

  return {
    freq,
    interval: Number.isInteger(interval) && interval >= 1 ? Math.min(interval, MAX_RECURRENCE_INTERVAL) : 1,
    until,
    count,
  };
}

function normalizeRecurrence(raw, date) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.freq !== 'string' || !Object.hasOwn(RECURRENCE_FREQS, raw.freq)) return null;
  const interval = Number.isInteger(raw.interval) && raw.interval >= 1
    ? Math.min(raw.interval, MAX_RECURRENCE_INTERVAL)
    : 1;
  const until = isValidISODate(raw.until) && raw.until >= date ? raw.until : null;
  const count = until
    ? null
    : (Number.isInteger(raw.count) && raw.count >= 1
      ? Math.min(raw.count, MAX_RECURRENCE_COUNT)
      : null);
  return { freq: raw.freq, interval, until, count };
}

// ---------------------------------------------------------------
// Création et modification (depuis le formulaire)
// ---------------------------------------------------------------

/**
 * Construit une entrée à partir des valeurs du formulaire.
 * `existing` est l'entrée d'origine en cas de modification.
 * Renvoie { entry, errors } : `errors` associe chaque champ fautif
 * à un message en français. S'il est vide, `entry` est prêt à enregistrer.
 */
export function buildEntry(input, existing = null) {
  const errors = {};
  const now = new Date().toISOString();
  const type = existing ? existing.type : input.type;
  if (!Object.hasOwn(TYPE_LABELS, type)) throw new Error(`Type d'entrée inconnu : ${type}`);

  const title = cleanLine(input.title, LIMITS.title);
  if (!title) errors.title = 'Écris un titre.';

  const description = sanitizeHtml(input.description ?? '');
  if (htmlToText(description).length > LIMITS.description) {
    errors.description = `La description est trop longue (${LIMITS.description} caractères au maximum).`;
  }

  const entry = {
    id: existing?.id ?? createId(),
    type,
    title,
    description,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (type === 'event') {
    const date = input.date;
    const allDay = Boolean(input.allDay);
    if (!isValidISODate(date)) errors.date = 'Choisis une date valide.';

    let endDate = null;
    let startTime = null;
    let endTime = null;
    let timeZone = null;

    if (allDay) {
      endDate = input.endDate ? input.endDate : date;
      if (!isValidISODate(endDate)) {
        errors.endDate = 'Choisis une date de fin valide.';
      } else if (!errors.date && endDate < date) {
        errors.endDate = 'La date de fin doit être égale ou postérieure à la date de début.';
      }
    } else {
      startTime = normalizeTime(input.startTime);
      endTime = normalizeTime(input.endTime);
      // On enregistre toujours dans le fuseau actuel de l'appareil :
      // l'heure saisie est l'heure lue sur l'horloge ici.
      timeZone = getDeviceTimeZone();

      if (!isValidTime(startTime)) errors.startTime = "Choisis l'heure de début.";
      if (!isValidTime(endTime)) errors.endTime = "Choisis l'heure de fin.";

      if (!errors.date && !errors.startTime && !errors.endTime) {
        const computedEndDate = endTime < startTime ? addDays(date, 1) : date;
        if (startTime === endTime) {
          errors.endTime = "L'heure de fin doit être différente de l'heure de début.";
        } else if (!wallTimeExists(date, startTime, timeZone)) {
          errors.startTime = "Cette heure n'existe pas ce jour-là (passage à l'heure d'été). Choisis une autre heure.";
        } else if (!wallTimeExists(computedEndDate, endTime, timeZone)) {
          errors.endTime = "Cette heure n'existe pas ce jour-là (passage à l'heure d'été). Choisis une autre heure.";
        }
      }
    }

    const reminder = findReminder(input.reminderMinutes);
    if (!reminder) errors.reminderMinutes = 'Choisis un rappel dans la liste.';
    const recurrence = buildRecurrenceFromInput(input, date, errors);

    Object.assign(entry, {
      date,
      endDate,
      allDay,
      startTime,
      endTime,
      timeZone,
      location: cleanLine(input.location, LIMITS.location),
      reminderMinutes: reminder ? reminder.minutes : null,
      recurrence,
    });
  } else {
    const dueDate = input.dueDate ? input.dueDate : null;
    if (dueDate !== null && !isValidISODate(dueDate)) errors.dueDate = 'Choisis une date valide, ou laisse vide.';

    const priority = isPriority(input.priority) ? input.priority : DEFAULT_PRIORITY;
    const done = Boolean(input.done);
    Object.assign(entry, {
      dueDate,
      priority,
      done,
      // On garde la date d'achèvement d'origine si la tâche était déjà faite.
      doneAt: done ? (existing?.done && existing.doneAt ? existing.doneAt : now) : null,
    });
  }

  return { entry, errors };
}

// ---------------------------------------------------------------
// Vérification d'une entrée lue (stockage ou fichier importé)
// ---------------------------------------------------------------

/**
 * Vérifie et nettoie une entrée venant du stockage ou d'un fichier.
 * Renvoie l'entrée propre, ou null si elle est inutilisable.
 * Les champs facultatifs abîmés reprennent une valeur par défaut.
 */
export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Object.hasOwn(TYPE_LABELS, raw.type)) return null;
  if (typeof raw.id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(raw.id)) return null;

  const title = cleanLine(raw.title, LIMITS.title);
  if (!title) return null;

  const createdAt = isTimestamp(raw.createdAt) ? raw.createdAt : new Date().toISOString();
  const entry = {
    id: raw.id,
    type: raw.type,
    title,
    description: sanitizeHtml(typeof raw.description === 'string' ? raw.description : ''),
    createdAt,
    updatedAt: isTimestamp(raw.updatedAt) ? raw.updatedAt : createdAt,
  };

  if (raw.type === 'event') {
    if (!isValidISODate(raw.date)) return null;
    const allDay = raw.allDay === true;
    let endDate = null;
    let startTime = null;
    let endTime = null;
    let timeZone = null;

    if (allDay) {
      endDate = isValidISODate(raw.endDate) && raw.endDate >= raw.date ? raw.endDate : raw.date;
    } else {
      startTime = normalizeTime(raw.startTime);
      endTime = normalizeTime(raw.endTime);
      if (!isValidTime(startTime) || !isValidTime(endTime)) return null;
      timeZone = isValidTimeZone(raw.timeZone) ? raw.timeZone : getDeviceTimeZone();
    }

    Object.assign(entry, {
      date: raw.date,
      endDate,
      allDay,
      startTime,
      endTime,
      timeZone,
      location: cleanLine(raw.location, LIMITS.location),
      reminderMinutes: findReminder(raw.reminderMinutes)?.minutes ?? null,
      recurrence: normalizeRecurrence(raw.recurrence, raw.date),
    });
  } else {
    const done = raw.done === true;
    Object.assign(entry, {
      dueDate: isValidISODate(raw.dueDate) ? raw.dueDate : null,
      priority: isPriority(raw.priority) ? raw.priority : DEFAULT_PRIORITY,
      done,
      doneAt: done && isTimestamp(raw.doneAt) ? raw.doneAt : null,
    });
  }
  return entry;
}

// ---------------------------------------------------------------
// Horaires d'un rendez-vous, vus depuis l'appareil
// ---------------------------------------------------------------

const scheduleCache = new WeakMap();

/**
 * Calcule les horaires d'un rendez-vous dans le fuseau de l'appareil.
 * Renvoie { allDay, start, end, startDate, startTime, endDate, endTime, shifted }.
 *  - start / end : instants précis (objets Date) ;
 *  - shifted : vrai si le rendez-vous a été créé dans un autre fuseau
 *    horaire et que les heures ont donc été converties.
 */
export function getEventSchedule(event) {
  const deviceZone = getDeviceTimeZone();
  const isAllDay = event.allDay === true;
  const signature = isAllDay
    ? `1|${event.date}|${event.endDate ?? event.date}|${deviceZone}`
    : `0|${event.date}|${event.startTime}|${event.endTime}|${event.timeZone}|${deviceZone}`;

  const cached = scheduleCache.get(event);
  if (cached && cached.signature === signature) return cached.schedule;

  let schedule;
  if (isAllDay) {
    const startDate = event.date;
    const endDate = event.endDate && event.endDate >= startDate ? event.endDate : startDate;
    const start = zonedTimeToInstant(startDate, '00:00', deviceZone);
    const end = zonedTimeToInstant(addDays(endDate, 1), '00:00', deviceZone);
    schedule = Object.freeze({
      allDay: true,
      start,
      end,
      startDate,
      startTime: null,
      endDate,
      endTime: null,
      shifted: false,
    });
  } else {
    const endDate = event.endTime < event.startTime ? addDays(event.date, 1) : event.date;
    const start = zonedTimeToInstant(event.date, event.startTime, event.timeZone);
    const end = zonedTimeToInstant(endDate, event.endTime, event.timeZone);

    if (event.timeZone === deviceZone) {
      // Cas habituel : même fuseau, on affiche l'heure telle qu'elle a été saisie.
      schedule = Object.freeze({
        allDay: false,
        start,
        end,
        startDate: event.date,
        startTime: event.startTime,
        endDate,
        endTime: event.endTime,
        shifted: false,
      });
    } else {
      const localStart = instantToZoned(start, deviceZone);
      const localEnd = instantToZoned(end, deviceZone);
      schedule = Object.freeze({
        allDay: false,
        start,
        end,
        startDate: localStart.date,
        startTime: localStart.time,
        endDate: localEnd.date,
        endTime: localEnd.time,
        shifted: true,
      });
    }
  }

  scheduleCache.set(event, { signature, schedule });
  return schedule;
}

// ---------------------------------------------------------------
// Rangement
// ---------------------------------------------------------------

/** Le jour (date ISO) où l'entrée apparaît, ou null pour une tâche sans échéance. */
export function getEntryDay(entry) {
  return entry.type === 'event' ? getEventSchedule(entry).startDate : entry.dueDate;
}

/**
 * Ordre d'affichage dans une même journée :
 * d'abord les rendez-vous (journée entière en tête, puis par heure),
 * puis les tâches (à faire avant faites, puis priorité haute d'abord).
 */
export function compareEntries(a, b) {
  if (a.type !== b.type) return a.type === 'event' ? -1 : 1;
  if (a.type === 'event') {
    const aAllDay = Boolean(a.allDay);
    const bAllDay = Boolean(b.allDay);
    if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;
    return getEventSchedule(a).start - getEventSchedule(b).start || a.title.localeCompare(b.title, 'fr');
  }
  if (a.done !== b.done) return a.done ? 1 : -1;
  return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || a.title.localeCompare(b.title, 'fr');
}

/** Libellés pour l'affichage. */
export function priorityLabel(id) {
  return PRIORITIES.find((priority) => priority.id === id)?.label ?? '';
}

export function reminderLabel(minutes) {
  return findReminder(minutes)?.label ?? 'Aucun rappel';
}
