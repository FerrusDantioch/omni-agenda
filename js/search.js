// =============================================================
// search.js — Recherche locale (strictement bloquée si verrouillé)
// -------------------------------------------------------------
// Recherche insensible à la casse et aux accents, par mots-clés
// (tous les mots doivent correspondre), sur le titre, le lieu,
// la description en texte brut, la date, l'horaire, le type,
// la répétition, la priorité et l'état d'avancement.
// =============================================================

import { formatISODateLong } from './dates.js';
import {
  TYPE_LABELS, compareEntries, getEntryDay, getEventSchedule, priorityLabel,
} from './entries.js';
import { formatRecurrenceLabel } from './recurrence.js';
import { htmlToText } from './sanitize.js';
import { isLocked, isSecurityReady } from './security.js';

/** Normalise une chaîne pour la recherche (sans accents, minuscules, ligatures dépliées). */
export function normalizeSearchText(text) {
  return String(text ?? '')
    .replace(/[œŒ]/g, 'oe')
    .replace(/[æÆ]/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Texte complet indexable pour une entrée. */
export function entrySearchableText(entry) {
  const parts = [
    entry.title,
    htmlToText(entry.description ?? ''),
    TYPE_LABELS[entry.type] ?? '',
  ];

  if (entry.type === 'event') {
    parts.push('événement');
    if (entry.location) parts.push(entry.location);
    if (entry.date) {
      parts.push(entry.date, formatISODateLong(entry.date));
    }
    if (entry.endDate && entry.endDate !== entry.date) {
      parts.push(entry.endDate, formatISODateLong(entry.endDate));
    }
    if (entry.allDay) {
      parts.push('journée entière');
    } else {
      const schedule = getEventSchedule(entry);
      parts.push(schedule.startTime ?? '', schedule.endTime ?? '');
      if (schedule.shifted) parts.push(entry.startTime ?? '', entry.endTime ?? '');
    }
    if (entry.recurrence) {
      parts.push(formatRecurrenceLabel(entry.recurrence));
    }
  } else {
    parts.push(entry.dueDate ? `${entry.dueDate} ${formatISODateLong(entry.dueDate)}` : 'sans échéance');
    parts.push(priorityLabel(entry.priority));
    parts.push(entry.done ? 'terminée faite' : 'à faire');
  }

  return parts.filter(Boolean).join(' ');
}

/**
 * Filtre et trie les entrées correspondant à `query`.
 * Bloque strictement toute recherche tant que la sécurité n'est pas prête
 * ou que l'agenda est verrouillé (retourne []).
 */
export function searchEntries(entries, query, { locked = isLocked(), ready = isSecurityReady() } = {}) {
  if (!ready || locked) return [];
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const matches = [];
  for (const entry of entries) {
    const haystack = normalizeSearchText(entrySearchableText(entry));
    if (tokens.every((token) => haystack.includes(token))) {
      matches.push(entry);
    }
  }

  return matches.sort((a, b) => {
    const dayA = getEntryDay(a);
    const dayB = getEntryDay(b);
    if (dayA && dayB && dayA !== dayB) return dayA < dayB ? -1 : 1;
    if (dayA !== dayB) return dayA ? -1 : 1;
    return compareEntries(a, b);
  });
}
