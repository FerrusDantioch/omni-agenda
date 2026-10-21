// =============================================================
// views/page-parts.js — Morceaux de page partagés par les vues
// -------------------------------------------------------------
// « ctx » (le contexte) contient :
//   - index   : les entrées rangées par jour (agenda-data.js) ;
//   - today   : la date du jour ;
//   - actions : ce qui se passe quand on touche quelque chose
//               (ouvrir une fiche, cocher, ajouter, aller à un jour…).
// =============================================================

import { el, icon } from '../ui/dom.js';
import { renderEntryItem } from '../ui/entry-item.js';
import { formatISODateLong, formatMonthYearLower, formatWeekday, parseISODate } from '../dates.js';

/** Une page de l'agenda (feuille de papier). */
export function createPage(...children) {
  return el('section', { class: 'page' }, ...children);
}

/**
 * Grand en-tête de date, façon agenda papier :
 *   Mercredi
 *   21
 *   octobre 2026
 * Pour les lecteurs d'écran, c'est un titre « Mercredi 21 octobre 2026 ».
 */
export function pageDateHeading(iso, today) {
  const { day } = parseISODate(iso);
  return el('h2', { class: iso === today ? 'page-date is-today' : 'page-date' },
    el('span', { class: 'page-weekday' }, formatWeekday(iso)),
    ' ',
    el('span', { class: 'page-daynum' }, day === 1 ? '1er' : String(day)),
    ' ',
    el('span', { class: 'page-month' }, formatMonthYearLower(iso)),
    iso === today ? el('span', { class: 'today-tag' }, "Aujourd'hui") : null,
  );
}

/** Liste d'entrées, ou un petit texte si elle est vide. */
export function entryList(entries, ctx, { compact = false, showDueDate = false, emptyText = 'Rien de prévu.' } = {}) {
  if (entries.length === 0) {
    return emptyText ? el('p', { class: 'page-empty' }, emptyText) : null;
  }
  const actions = { onOpen: ctx.actions.onOpen, onToggleDone: ctx.actions.onToggleDone, showDueDate };
  return el('ul', { class: compact ? 'entry-list is-compact' : 'entry-list' },
    entries.map((entry) => renderEntryItem(entry, actions)),
  );
}

/** Tâches en retard (affichées sur la page du jour). */
export function overdueSection(ctx) {
  if (ctx.index.overdue.length === 0) return null;
  return el('section', { class: 'page-section' },
    el('h3', {}, 'En retard'),
    entryList(ctx.index.overdue, ctx, { showDueDate: true }),
  );
}

// L'encadré « Tâches sans échéance » reste ouvert ou fermé d'une page à l'autre.
let undatedOpen = false;

/** Encadré repliable des tâches sans échéance (en bas de la dernière page). */
export function undatedSection(ctx) {
  const tasks = ctx.index.undated;
  if (tasks.length === 0) return null;
  const details = el('details', { class: 'page-notes', open: undatedOpen },
    el('summary', {}, `Tâches sans échéance (${tasks.length})`),
    entryList(tasks, ctx),
  );
  details.addEventListener('toggle', () => {
    undatedOpen = details.open;
  });
  return details;
}

/** Bouton « Ajouter » d'un jour : ouvre le formulaire avec cette date. */
export function addButton(iso, ctx) {
  return el('button', {
    type: 'button',
    class: 'btn btn-ghost btn-small page-add',
    'aria-label': `Ajouter une entrée le ${formatISODateLong(iso)}`,
    'data-focus-key': `ajouter-${iso}`,
    onclick: () => ctx.actions.onAdd(iso),
  }, icon('plus'), 'Ajouter');
}

/** Contenu complet d'une journée : entrées, retards (si c'est aujourd'hui), bouton Ajouter. */
export function dayContent(iso, ctx) {
  return [
    entryList(ctx.index.entriesOn(iso), ctx),
    iso === ctx.today ? overdueSection(ctx) : null,
    addButton(iso, ctx),
  ];
}
