// =============================================================
// ui/entry-details.js — Fiche de détails d'une entrée
// -------------------------------------------------------------
// Affiche toutes les informations d'un rendez-vous ou d'une
// tâche, avec les boutons « Modifier » et « Supprimer ».
// =============================================================

import { el } from './dom.js';
import { formatEventHours } from './entry-item.js';
import { TYPE_LABELS, getEventSchedule, priorityLabel, reminderLabel } from '../entries.js';
import { addDays, daysBetween, formatISODateLong, relativeDayLabel } from '../dates.js';
import { formatRecurrenceLabel } from '../recurrence.js';
import { sanitizeToFragment } from '../sanitize.js';

/** « Aujourd'hui — Mercredi 21 octobre 2026 » ou « Jeudi 29 octobre 2026 ». */
function formatDay(iso) {
  const relative = relativeDayLabel(iso);
  return relative ? `${relative} — ${formatISODateLong(iso)}` : formatISODateLong(iso);
}

/** Une ligne « intitulé : valeur » de la fiche. */
function row(label, value) {
  return el('div', { class: 'details-row' }, el('dt', {}, label), el('dd', {}, value));
}

/**
 * Fabrique le contenu de la fiche.
 *  - notice : message à afficher en haut ({ text, isError }) ou null ;
 *  - occurrenceDate : date de l'occurrence cliquée (si récurrent) ;
 *  - onEdit(), onDelete(), onToggleDone().
 * Renvoie un élément contenant le corps et le pied de la fiche.
 */
export function renderEntryDetails(entry, { notice = null, occurrenceDate = null, onEdit, onDelete, onToggleDone }) {
  const rows = [];

  if (entry.type === 'event') {
    const schedule = getEventSchedule(entry);
    const displaySchedule = occurrenceDate
      ? getEventSchedule({
        ...entry,
        date: occurrenceDate,
        endDate: entry.allDay && entry.endDate ? addDays(occurrenceDate, daysBetween(entry.date, entry.endDate)) : entry.endDate,
      })
      : schedule;
    if (occurrenceDate && occurrenceDate !== entry.date) {
      rows.push(row('Occurrence', formatDay(displaySchedule.startDate)));
      rows.push(row('Première date', formatDay(schedule.startDate)));
    } else if (displaySchedule.allDay && displaySchedule.endDate !== displaySchedule.startDate) {
      rows.push(row('Dates', `Du ${formatISODateLong(displaySchedule.startDate)} au ${formatISODateLong(displaySchedule.endDate)}`));
    } else {
      rows.push(row('Date', formatDay(displaySchedule.startDate)));
    }
    rows.push(row('Horaire', formatEventHours(displaySchedule, entry)));
    if (entry.recurrence) rows.push(row('Répétition', formatRecurrenceLabel(entry.recurrence)));
    if (entry.location) rows.push(row('Lieu', entry.location));
    rows.push(row('Rappel', reminderLabel(entry.reminderMinutes)));
    if (!displaySchedule.allDay && displaySchedule.shifted) {
      rows.push(row('Fuseau horaire',
        `Créé dans le fuseau ${entry.timeZone} (${entry.startTime} là-bas). Les heures ci-dessus sont celles de ton appareil.`));
    }
  } else {
    rows.push(row('Échéance', entry.dueDate ? formatDay(entry.dueDate) : 'Aucune'));
    rows.push(row('Priorité', priorityLabel(entry.priority)));
    rows.push(row('État',
      el('label', { class: 'checkbox-row' },
        el('input', { type: 'checkbox', checked: entry.done, 'data-focus-key': `details-faite-${entry.id}`, onchange: () => onToggleDone() }),
        el('span', {}, 'Tâche terminée'),
      ),
    ));
  }

  const description = entry.description
    ? el('div', { class: 'rich-text' }, sanitizeToFragment(entry.description))
    : el('p', { class: 'muted' }, 'Aucune description.');

  return el('div', { class: 'panel-content' },
    el('div', { class: 'panel-body' },
      notice ? el('p', { class: notice.isError ? 'notice notice-error' : 'notice', role: notice.isError ? 'alert' : 'status' }, notice.text) : null,
      el('p', { class: `entry-badge entry-badge-${entry.type}` }, TYPE_LABELS[entry.type]),
      el('dl', { class: 'details-list' }, rows),
      el('h3', {}, 'Description'),
      description,
    ),
    el('div', { class: 'panel-footer' },
      el('button', { type: 'button', class: 'btn btn-danger', 'data-focus-key': `details-supprimer-${entry.id}`, onclick: () => onDelete() }, 'Supprimer'),
      el('button', { type: 'button', class: 'btn btn-primary', 'data-focus-key': `details-modifier-${entry.id}`, onclick: () => onEdit() }, 'Modifier'),
    ),
  );
}
