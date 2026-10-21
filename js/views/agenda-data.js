// =============================================================
// views/agenda-data.js — Ranger les entrées pour l'affichage
// -------------------------------------------------------------
// Avant de dessiner les pages, on range une fois toutes les
// entrées « par jour ». Chaque page n'a plus qu'à demander
// « qu'y a-t-il tel jour ? ».
// =============================================================

import { compareEntries, getEntryDay } from '../entries.js';

/**
 * Construit le rangement.
 *  - entriesOn(jour) : entrées d'un jour (rendez-vous puis tâches) ;
 *  - undated : tâches sans échéance ;
 *  - overdue : tâches non faites dont l'échéance est passée.
 */
export function buildAgendaIndex(entries, today) {
  const byDay = new Map();
  const undated = [];
  const overdue = [];

  for (const entry of entries) {
    if (entry.type === 'task' && !entry.dueDate) {
      undated.push(entry);
      continue;
    }
    const day = getEntryDay(entry);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(entry);
    if (entry.type === 'task' && !entry.done && entry.dueDate < today) overdue.push(entry);
  }

  for (const list of byDay.values()) list.sort(compareEntries);
  undated.sort(compareEntries);
  overdue.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : compareEntries(a, b)));

  return {
    today,
    isEmpty: entries.length === 0,
    undated,
    overdue,
    entriesOn: (day) => byDay.get(day) ?? [],
  };
}
