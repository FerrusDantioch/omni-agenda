// =============================================================
// views/agenda-data.js — Ranger les entrées pour l'affichage
// -------------------------------------------------------------
// Avant de dessiner les pages, on range une fois les entrées
// fixes par jour, et on garde les multi-jours / récurrences pour
// les évaluer à la demande avec un cache par jour (dayCache).
// =============================================================

import {
  MAX_DATE, MIN_DATE, addDays, daysBetween, getDeviceTimeZone,
} from '../dates.js';
import { compareEntries, getEntryDay, getEventSchedule } from '../entries.js';
import { getOccurrencesInRange, occurrenceIndexOnDate } from '../recurrence.js';

const frozenIndexCache = new WeakMap();

/**
 * Construit le rangement.
 *  - entriesOn(jour) : entrées d'un jour (rendez-vous puis tâches) ;
 *  - undated : tâches sans échéance ;
 *  - overdue : tâches non faites dont l'échéance est passée.
 */
export function buildAgendaIndex(entries, today) {
  const deviceZone = getDeviceTimeZone();
  const cacheKey = `${today}|${deviceZone}`;
  if (Object.isFrozen(entries)) {
    const byKey = frozenIndexCache.get(entries);
    if (byKey?.has(cacheKey)) return byKey.get(cacheKey);
  }

  const byDay = new Map();
  const multiDayEvents = [];
  const recurringEvents = [];
  const undated = [];
  const overdue = [];

  for (const entry of entries) {
    if (entry.type === 'task') {
      if (!entry.dueDate) {
        undated.push(entry);
        continue;
      }
      if (!byDay.has(entry.dueDate)) byDay.set(entry.dueDate, []);
      byDay.get(entry.dueDate).push(entry);
      if (!entry.done && entry.dueDate < today) overdue.push(entry);
      continue;
    }

    if (entry.recurrence) {
      recurringEvents.push(entry);
      continue;
    }

    if (entry.allDay && entry.endDate && entry.endDate > entry.date) {
      multiDayEvents.push(entry);
      continue;
    }

    const day = getEntryDay(entry);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(entry);
  }

  for (const list of byDay.values()) list.sort(compareEntries);
  undated.sort(compareEntries);
  overdue.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : compareEntries(a, b)));

  const dayCache = new Map();

  function entriesOn(day) {
    if (typeof day !== 'string' || day < MIN_DATE || day > MAX_DATE) return [];
    if (dayCache.has(day)) return dayCache.get(day);

    const fixed = byDay.get(day);
    let extras = null;

    for (const event of multiDayEvents) {
      if (day >= event.date && day <= event.endDate) {
        if (!extras) extras = [];
        extras.push(event);
      }
    }

    for (const event of recurringEvents) {
      const spanDays = event.allDay && event.endDate && event.endDate > event.date
        ? daysBetween(event.date, event.endDate)
        : 0;

      if (event.allDay || event.timeZone === deviceZone) {
        if (spanDays === 0) {
          if (occurrenceIndexOnDate(event.date, event.recurrence, day) !== null) {
            if (!extras) extras = [];
            extras.push({
              ...event,
              date: day,
              endDate: event.allDay ? day : null,
              occurrenceDate: day,
            });
          }
        } else {
          const searchStart = addDays(day, -spanDays);
          const occs = getOccurrencesInRange(event, searchStart < MIN_DATE ? MIN_DATE : searchStart, day, {
            maxOccurrences: Math.min(Math.max(8, spanDays + 1), 1000),
          });
          for (const occStart of occs) {
            const occEnd = addDays(occStart, spanDays);
            if (day >= occStart && day <= occEnd) {
              if (!extras) extras = [];
              extras.push({
                ...event,
                date: occStart,
                endDate: occEnd,
                occurrenceDate: occStart,
              });
            }
          }
        }
      } else {
        for (const offset of [-2, -1, 0, 1, 2]) {
          const occDate = addDays(day, offset);
          if (occDate < MIN_DATE || occDate > MAX_DATE) continue;
          if (occurrenceIndexOnDate(event.date, event.recurrence, occDate) !== null) {
            const occ = { ...event, date: occDate, occurrenceDate: occDate };
            if (getEventSchedule(occ).startDate === day) {
              if (!extras) extras = [];
              extras.push(occ);
            }
          }
        }
      }
    }

    const result = extras
      ? [...(fixed ?? []), ...extras].sort(compareEntries)
      : (fixed ?? []);
    dayCache.set(day, result);
    return result;
  }

  const index = {
    today,
    isEmpty: entries.length === 0,
    undated,
    overdue,
    entriesOn,
  };

  if (Object.isFrozen(entries)) {
    let byKey = frozenIndexCache.get(entries);
    if (!byKey) {
      byKey = new Map();
      frozenIndexCache.set(entries, byKey);
    }
    byKey.set(cacheKey, index);
  }

  return index;
}
