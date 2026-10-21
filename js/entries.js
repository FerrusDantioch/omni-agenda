// =============================================================
// entries.js — Ce qu'est un rendez-vous et une tâche
// -------------------------------------------------------------
// Une « entrée » est soit un rendez-vous, soit une tâche.
//
// Rendez-vous (type 'event') :
//   id, type, title, description, date, startTime, endTime,
//   timeZone, location, reminderMinutes, createdAt, updatedAt
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
  isValidTimeZone, wallTimeExists, zonedTimeToInstant,
} from './dates.js';
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

/** Une heure de champ de formulaire peut contenir des secondes : on les retire. */
function normalizeTime(value) {
  return typeof value === 'string' ? value.slice(0, 5) : '';
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
    const startTime = normalizeTime(input.startTime);
    const endTime = normalizeTime(input.endTime);
    // On enregistre toujours dans le fuseau actuel de l'appareil :
    // l'heure saisie est l'heure lue sur l'horloge ici.
    const timeZone = getDeviceTimeZone();

    if (!isValidISODate(date)) errors.date = 'Choisis une date valide.';
    if (!isValidTime(startTime)) errors.startTime = "Choisis l'heure de début.";
    if (!isValidTime(endTime)) errors.endTime = "Choisis l'heure de fin.";

    if (!errors.date && !errors.startTime && !errors.endTime) {
      const endDate = endTime < startTime ? addDays(date, 1) : date;
      if (startTime === endTime) {
        errors.endTime = "L'heure de fin doit être différente de l'heure de début.";
      } else if (!wallTimeExists(date, startTime, timeZone)) {
        errors.startTime = "Cette heure n'existe pas ce jour-là (passage à l'heure d'été). Choisis une autre heure.";
      } else if (!wallTimeExists(endDate, endTime, timeZone)) {
        errors.endTime = "Cette heure n'existe pas ce jour-là (passage à l'heure d'été). Choisis une autre heure.";
      }
    }

    const reminder = findReminder(input.reminderMinutes);
    if (!reminder) errors.reminderMinutes = 'Choisis un rappel dans la liste.';

    Object.assign(entry, {
      date,
      startTime,
      endTime,
      timeZone,
      location: cleanLine(input.location, LIMITS.location),
      reminderMinutes: reminder ? reminder.minutes : null,
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
    const startTime = normalizeTime(raw.startTime);
    const endTime = normalizeTime(raw.endTime);
    if (!isValidISODate(raw.date) || !isValidTime(startTime) || !isValidTime(endTime)) return null;
    Object.assign(entry, {
      date: raw.date,
      startTime,
      endTime,
      timeZone: isValidTimeZone(raw.timeZone) ? raw.timeZone : getDeviceTimeZone(),
      location: cleanLine(raw.location, LIMITS.location),
      reminderMinutes: findReminder(raw.reminderMinutes)?.minutes ?? null,
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

/**
 * Calcule les horaires d'un rendez-vous dans le fuseau de l'appareil.
 * Renvoie { start, end, startDate, startTime, endDate, endTime, shifted }.
 *  - start / end : instants précis (objets Date) ;
 *  - shifted : vrai si le rendez-vous a été créé dans un autre fuseau
 *    horaire et que les heures ont donc été converties.
 */
export function getEventSchedule(event) {
  const endDate = event.endTime < event.startTime ? addDays(event.date, 1) : event.date;
  const start = zonedTimeToInstant(event.date, event.startTime, event.timeZone);
  const end = zonedTimeToInstant(endDate, event.endTime, event.timeZone);
  const deviceZone = getDeviceTimeZone();

  if (event.timeZone === deviceZone) {
    // Cas habituel : même fuseau, on affiche l'heure telle qu'elle a été saisie.
    return { start, end, startDate: event.date, startTime: event.startTime, endDate, endTime: event.endTime, shifted: false };
  }

  const localStart = instantToZoned(start, deviceZone);
  const localEnd = instantToZoned(end, deviceZone);
  return {
    start,
    end,
    startDate: localStart.date,
    startTime: localStart.time,
    endDate: localEnd.date,
    endTime: localEnd.time,
    shifted: true,
  };
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
 * d'abord les rendez-vous (par heure), puis les tâches
 * (à faire avant faites, puis priorité haute d'abord).
 */
export function compareEntries(a, b) {
  if (a.type !== b.type) return a.type === 'event' ? -1 : 1;
  if (a.type === 'event') {
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
