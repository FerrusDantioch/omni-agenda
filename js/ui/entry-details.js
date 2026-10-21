// =============================================================
// ui/entry-details.js — Fiche de détails d'une entrée
// -------------------------------------------------------------
// Affiche toutes les informations d'un rendez-vous ou d'une
// tâche, avec les boutons « Modifier » et « Supprimer ».
// =============================================================

import { el } from './dom.js';
import { formatEventHours } from './entry-item.js';
import { TYPE_LABELS, getEventSchedule, priorityLabel, reminderLabel } from '../entries.js';
import { formatISODateLong, relativeDayLabel } from '../dates.js';
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
 *  - onEdit(), onDelete(), onToggleDone().
 * Renvoie un élément contenant le corps et le pied de la fiche.
 */
export function renderEntryDetails(entry, { notice = null, onEdit, onDelete, onToggleDone }) {
  const rows = [];

  if (entry.type === 'event') {
    const schedule = getEventSchedule(entry);
    rows.push(row('Date', formatDay(schedule.startDate)));
    rows.push(row('Horaire', formatEventHours(schedule)));
    if (entry.location) rows.push(row('Lieu', entry.location));
    rows.push(row('Rappel', reminderLabel(entry.reminderMinutes)));
    if (schedule.shifted) {
      rows.push(row('Fuseau horaire',
        `Créé dans le fuseau ${entry.timeZone} (${entry.startTime} là-bas). Les heures ci-dessus sont celles de ton appareil.`));
    }
  } else {
    rows.push(row('Échéance', entry.dueDate ? formatDay(entry.dueDate) : 'Aucune'));
    rows.push(row('Priorité', priorityLabel(entry.priority)));
    rows.push(row('État',
      el('label', { class: 'checkbox-row' },
        el('input', { type: 'checkbox', checked: entry.done, 'data-focus-key': 'faite', onchange: () => onToggleDone() }),
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
      el('button', { type: 'button', class: 'btn btn-danger', 'data-focus-key': 'supprimer', onclick: () => onDelete() }, 'Supprimer'),
      el('button', { type: 'button', class: 'btn btn-primary', 'data-focus-key': 'modifier', onclick: () => onEdit() }, 'Modifier'),
    ),
  );
}
