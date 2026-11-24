// =============================================================
// recurrence.js — Répétitions de rendez-vous (bornées 1900–2200)
// -------------------------------------------------------------
// Calcul O(1) d'occurrence pour un jour donné et expansion bornée
// sur un intervalle, sans jamais générer toute la plage 1900–2200.
// =============================================================

import {
  MAX_DATE, MIN_DATE, addDays, clampDate, daysBetween, daysInMonth,
  formatISODateLong, isValidISODate, parseISODate,
} from './dates.js';

export const RECURRENCE_FREQS = {
  daily: 'Tous les jours',
  weekly: 'Toutes les semaines',
  monthly: 'Tous les mois',
  yearly: 'Tous les ans',
};

export const MAX_RECURRENCE_INTERVAL = 999;
export const MAX_RECURRENCE_COUNT = 999;

function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

function normalizeInterval(raw) {
  return Number.isInteger(raw) && raw >= 1 ? Math.min(raw, MAX_RECURRENCE_INTERVAL) : 1;
}

function normalizeCount(raw) {
  return Number.isInteger(raw) && raw >= 1 ? Math.min(raw, MAX_RECURRENCE_COUNT) : null;
}

/** Date ISO de la n-ième occurrence (n >= 0), ou null si hors [MIN_DATE, MAX_DATE]. */
function occurrenceDateForIndex(startISO, rule, n) {
  if (!Number.isInteger(n) || n < 0) return null;
  const interval = normalizeInterval(rule.interval);
  let iso = null;

  if (rule.freq === 'daily') {
    const stepDays = n * interval;
    if (stepDays > 120000) return null;
    iso = addDays(startISO, stepDays);
  } else if (rule.freq === 'weekly') {
    const stepDays = n * interval * 7;
    if (stepDays > 120000) return null;
    iso = addDays(startISO, stepDays);
  } else if (rule.freq === 'monthly') {
    const s = parseISODate(startISO);
    const totalMonths = s.year * 12 + (s.month - 1) + n * interval;
    const year = Math.floor(totalMonths / 12);
    const month = (totalMonths % 12) + 1;
    if (year < 1900 || year > 2200) return null;
    const day = Math.min(s.day, daysInMonth(year, month));
    iso = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  } else if (rule.freq === 'yearly') {
    const s = parseISODate(startISO);
    const year = s.year + n * interval;
    if (year < 1900 || year > 2200) return null;
    const day = Math.min(s.day, daysInMonth(year, s.month));
    iso = `${pad(year, 4)}-${pad(s.month)}-${pad(day)}`;
  }

  if (!iso || iso < MIN_DATE || iso > MAX_DATE || !isValidISODate(iso)) return null;
  return iso;
}

/**
 * Rang (0, 1, 2…) de l'occurrence qui tombe exactement le `targetISO`,
 * ou `null` si ce jour n'est pas une occurrence de la série.
 * Complexité O(1), aucune boucle.
 */
export function occurrenceIndexOnDate(startISO, rule, targetISO) {
  if (!rule || typeof rule !== 'object' || !Object.hasOwn(RECURRENCE_FREQS, rule.freq)) return null;
  if (!isValidISODate(startISO) || !isValidISODate(targetISO)) return null;
  if (targetISO < MIN_DATE || targetISO > MAX_DATE) return null;
  if (targetISO < startISO) return null;
  if (rule.until && (!isValidISODate(rule.until) || targetISO > rule.until)) return null;

  const interval = normalizeInterval(rule.interval);
  const count = normalizeCount(rule.count);
  let index = null;

  if (rule.freq === 'daily') {
    const diff = daysBetween(startISO, targetISO);
    if (diff % interval !== 0) return null;
    index = diff / interval;
  } else if (rule.freq === 'weekly') {
    const diff = daysBetween(startISO, targetISO);
    const step = interval * 7;
    if (diff % step !== 0) return null;
    index = diff / step;
  } else if (rule.freq === 'monthly') {
    const s = parseISODate(startISO);
    const t = parseISODate(targetISO);
    const monthDiff = (t.year - s.year) * 12 + (t.month - s.month);
    if (monthDiff < 0 || monthDiff % interval !== 0) return null;
    if (t.day !== Math.min(s.day, daysInMonth(t.year, t.month))) return null;
    index = monthDiff / interval;
  } else if (rule.freq === 'yearly') {
    const s = parseISODate(startISO);
    const t = parseISODate(targetISO);
    const yearDiff = t.year - s.year;
    if (yearDiff < 0 || yearDiff % interval !== 0) return null;
    if (t.month !== s.month || t.day !== Math.min(s.day, daysInMonth(t.year, s.month))) return null;
    index = yearDiff / interval;
  }

  if (index === null) return null;
  if (count !== null && index >= count) return null;
  return index;
}

/**
 * Liste des dates ISO d'occurrences de `event` dans [rangeStart, rangeEnd],
 * strictement bornée à [1900-01-01, 2200-12-31] et `maxOccurrences`.
 */
export function getOccurrencesInRange(event, rangeStart, rangeEnd, { maxOccurrences = 1000 } = {}) {
  if (!event || event.type !== 'event' || !isValidISODate(event.date)) return [];
  const clampedStart = clampDate(rangeStart);
  const clampedEnd = clampDate(rangeEnd);
  if (clampedStart > clampedEnd) return [];

  if (!event.recurrence) {
    return event.date >= clampedStart && event.date <= clampedEnd ? [event.date] : [];
  }

  const rule = event.recurrence;
  if (!Object.hasOwn(RECURRENCE_FREQS, rule.freq)) return [];

  const effectiveStart = event.date > clampedStart ? event.date : clampedStart;
  let effectiveEnd = clampedEnd;
  if (rule.until) {
    if (!isValidISODate(rule.until)) return [];
    if (rule.until < effectiveEnd) effectiveEnd = rule.until;
  }
  if (effectiveStart > effectiveEnd) return [];

  const interval = normalizeInterval(rule.interval);
  const count = normalizeCount(rule.count);

  let nStart = 0;
  if (rule.freq === 'daily') {
    nStart = Math.max(0, Math.floor(daysBetween(event.date, effectiveStart) / interval));
  } else if (rule.freq === 'weekly') {
    nStart = Math.max(0, Math.floor(daysBetween(event.date, effectiveStart) / (interval * 7)));
  } else if (rule.freq === 'monthly') {
    const s = parseISODate(event.date);
    const e = parseISODate(effectiveStart);
    nStart = Math.max(0, Math.floor(((e.year - s.year) * 12 + (e.month - s.month)) / interval));
  } else if (rule.freq === 'yearly') {
    const s = parseISODate(event.date);
    const e = parseISODate(effectiveStart);
    nStart = Math.max(0, Math.floor((e.year - s.year) / interval));
  }

  const out = [];
  const hardLimit = Math.max(0, Math.min(maxOccurrences, 10000));
  for (let n = nStart; out.length < hardLimit; n += 1) {
    if (count !== null && n >= count) break;
    const occ = occurrenceDateForIndex(event.date, rule, n);
    if (!occ || occ > effectiveEnd || occ > MAX_DATE) break;
    if (occ >= effectiveStart) out.push(occ);
  }
  return out;
}

/** Libellé court : « Tous les jours », « Toutes les 2 semaines »… */
export function recurrenceShortLabel(rule) {
  if (!rule || !Object.hasOwn(RECURRENCE_FREQS, rule.freq)) return '';
  const interval = normalizeInterval(rule.interval);
  if (interval === 1) return RECURRENCE_FREQS[rule.freq];
  switch (rule.freq) {
    case 'daily': return `Tous les ${interval} jours`;
    case 'weekly': return `Toutes les ${interval} semaines`;
    case 'monthly': return `Tous les ${interval} mois`;
    case 'yearly': return `Tous les ${interval} ans`;
    default: return '';
  }
}

/** Libellé complet avec limite éventuelle (« … (5 fois) » ou « …, jusqu'au … »). */
export function formatRecurrenceLabel(rule) {
  const base = recurrenceShortLabel(rule);
  if (!base) return '';
  if (rule.until && isValidISODate(rule.until)) {
    return `${base}, jusqu'au ${formatISODateLong(rule.until).toLowerCase()}`;
  }
  const count = normalizeCount(rule.count);
  if (count !== null) {
    return `${base} (${count} fois)`;
  }
  return base;
}
