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
import { formatDayMonth } from '../dates.js';
import { recurrenceShortLabel } from '../recurrence.js';

/** Texte de l'horaire : « 14:00 – 15:00 », « …, fin le lendemain » ou « Journée entière ». */
export function formatEventHours(schedule, entry = null) {
  if (schedule?.allDay || entry?.allDay) {
    if (schedule?.startDate && schedule?.endDate && schedule.endDate !== schedule.startDate) {
      return `Journée entière (${formatDayMonth(schedule.startDate)} – ${formatDayMonth(schedule.endDate)})`;
    }
    return 'Journée entière';
  }
  const hours = `${schedule.startTime} – ${schedule.endTime}`;
  return schedule.endDate !== schedule.startDate ? `${hours} (fin le lendemain)` : hours;
}

/**
 * Fabrique une ligne <li> pour une entrée.
 * `onOpen(id, occurrenceDate)` : ouvrir la fiche. `onToggleDone(id)` : cocher une tâche.
 * `showDueDate` : afficher la date d'échéance (tâches en retard / recherche).
 * `showDate` : afficher la date du rendez-vous (recherche).
 */
export function renderEntryItem(entry, { onOpen, onToggleDone, showDueDate = false, showDate = false, focusScope = '' }) {
  const occurrenceDate = entry.occurrenceDate ?? null;
  const open = () => onOpen(entry.id, occurrenceDate);
  const prefix = focusScope ? `${focusScope}-` : '';
  const focusId = occurrenceDate ? `${entry.id}-${occurrenceDate}` : entry.id;

  if (entry.type === 'event') {
    const schedule = getEventSchedule(entry);
    const liClass = schedule.allDay ? 'entry entry-event entry-all-day' : 'entry entry-event';
    return el('li', { class: liClass },
      el('button', { type: 'button', class: 'entry-main', 'data-focus-key': `${prefix}ouvrir-${focusId}`, onclick: open },
        el('span', { class: 'entry-time' }, formatEventHours(schedule, entry)),
        el('span', { class: 'entry-title' }, entry.title),
        showDate ? el('span', { class: 'entry-meta' }, formatDayMonth(schedule.startDate)) : null,
        entry.location ? el('span', { class: 'entry-meta' }, entry.location) : null,
        entry.recurrence ? el('span', { class: 'entry-meta entry-recurrence' }, `Récurrent · ${recurrenceShortLabel(entry.recurrence)}`) : null,
      ),
    );
  }

  const checkbox = el('input', {
    type: 'checkbox',
    checked: entry.done,
    'data-focus-key': `${prefix}faite-${entry.id}`,
    onchange: () => onToggleDone(entry.id),
  });
  return el('li', { class: entry.done ? 'entry entry-task is-done' : 'entry entry-task' },
    el('label', { class: 'entry-check' },
      checkbox,
      el('span', { class: 'visually-hidden' }, `Tâche faite : ${entry.title}`),
    ),
    el('button', { type: 'button', class: 'entry-main', 'data-focus-key': `${prefix}ouvrir-${entry.id}`, onclick: open },
      el('span', { class: 'entry-kind' }, 'Tâche'),
      el('span', { class: 'entry-title' }, entry.title),
      showDueDate && entry.dueDate ? el('span', { class: 'entry-meta' }, `Prévue le ${formatDayMonth(entry.dueDate)}`) : null,
      entry.priority === 'high'
        ? el('span', { class: 'entry-priority' }, `Priorité ${priorityLabel(entry.priority).toLowerCase()}`)
        : null,
    ),
  );
}
