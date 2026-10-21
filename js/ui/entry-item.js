// =============================================================
// ui/entry-item.js — Une ligne d'entrée dans une liste
// -------------------------------------------------------------
// Rendez-vous : horaire, titre, lieu.
// Tâche : case à cocher, titre, priorité.
// Toucher la ligne ouvre la fiche de détails.
// Toucher la case coche ou décoche la tâche directement.
// =============================================================

import { el } from './dom.js';
import { getEventSchedule, priorityLabel } from '../entries.js';

/** Texte de l'horaire : « 14:00 – 15:00 » (ou « …, fin le lendemain »). */
export function formatEventHours(schedule) {
  const hours = `${schedule.startTime} – ${schedule.endTime}`;
  return schedule.endDate !== schedule.startDate ? `${hours} (fin le lendemain)` : hours;
}

/**
 * Fabrique une ligne <li> pour une entrée.
 * `onOpen(id)` : ouvrir la fiche. `onToggleDone(id)` : cocher une tâche.
 */
export function renderEntryItem(entry, { onOpen, onToggleDone }) {
  const open = () => onOpen(entry.id);

  if (entry.type === 'event') {
    const schedule = getEventSchedule(entry);
    return el('li', { class: 'entry entry-event' },
      el('button', { type: 'button', class: 'entry-main', 'data-focus-key': `ouvrir-${entry.id}`, onclick: open },
        el('span', { class: 'entry-time' }, formatEventHours(schedule)),
        el('span', { class: 'entry-title' }, entry.title),
        entry.location ? el('span', { class: 'entry-meta' }, entry.location) : null,
      ),
    );
  }

  const checkbox = el('input', {
    type: 'checkbox',
    checked: entry.done,
    'data-focus-key': `faite-${entry.id}`,
    onchange: () => onToggleDone(entry.id),
  });
  return el('li', { class: entry.done ? 'entry entry-task is-done' : 'entry entry-task' },
    el('label', { class: 'entry-check' },
      checkbox,
      el('span', { class: 'visually-hidden' }, `Tâche faite : ${entry.title}`),
    ),
    el('button', { type: 'button', class: 'entry-main', 'data-focus-key': `ouvrir-${entry.id}`, onclick: open },
      el('span', { class: 'entry-kind' }, 'Tâche'),
      el('span', { class: 'entry-title' }, entry.title),
      entry.priority === 'high'
        ? el('span', { class: 'entry-priority' }, `Priorité ${priorityLabel(entry.priority).toLowerCase()}`)
        : null,
    ),
  );
}
