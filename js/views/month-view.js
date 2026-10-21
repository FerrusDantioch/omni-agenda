// =============================================================
// views/month-view.js — Vue « Mois »
// -------------------------------------------------------------
//  - Deux pages : le calendrier du mois à gauche, le jour
//    choisi à droite.
//  - Une page : le calendrier, puis le jour choisi en dessous.
// Dans le calendrier, chaque jour montre de petits points :
//   ● plein = rendez-vous, ○ cercle = tâche à faire.
// Au clavier, les flèches déplacent le jour choisi.
// =============================================================

import { el } from '../ui/dom.js';
import {
  addDays, addMonths, daysInMonth, formatISODateLong, formatMonthYear, formatWeekday,
  formatWeekdayShort, parseISODate, startOfMonth, weekdayIndex,
} from '../dates.js';
import { createPage, dayContent, pageDateHeading, undatedSection } from './page-parts.js';

// Un lundi quelconque, pour écrire les noms des jours (lundi → dimanche).
const A_MONDAY = '2024-01-01';
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => addDays(A_MONDAY, i));
const MAX_MARKERS = 3;

/** Même jour du mois dans un autre mois (le 31 devient le 30 si besoin). */
function sameDayInMonth(iso, months) {
  const target = addMonths(iso, months);
  const { year, month } = parseISODate(target);
  const day = Math.min(parseISODate(iso).day, daysInMonth(year, month));
  return `${target.slice(0, 8)}${String(day).padStart(2, '0')}`;
}

/** Touches du clavier dans le calendrier → nouveau jour choisi. */
function dateForKey(key, iso) {
  switch (key) {
    case 'ArrowLeft': return addDays(iso, -1);
    case 'ArrowRight': return addDays(iso, 1);
    case 'ArrowUp': return addDays(iso, -7);
    case 'ArrowDown': return addDays(iso, 7);
    case 'Home': return addDays(iso, -weekdayIndex(iso));
    case 'End': return addDays(iso, 6 - weekdayIndex(iso));
    case 'PageUp': return sameDayInMonth(iso, -1);
    case 'PageDown': return sameDayInMonth(iso, 1);
    default: return null;
  }
}

/** Un jour du calendrier (bouton). */
function dayCell(iso, selected, monthPrefix, ctx) {
  const entries = ctx.index.entriesOn(iso);
  const events = entries.filter((entry) => entry.type === 'event').length;
  const tasks = entries.filter((entry) => entry.type === 'task' && !entry.done).length;

  // Description complète pour les lecteurs d'écran.
  const parts = [formatISODateLong(iso)];
  if (events) parts.push(`${events} rendez-vous`);
  if (tasks) parts.push(tasks > 1 ? `${tasks} tâches à faire` : '1 tâche à faire');
  if (!events && !tasks) parts.push('rien de prévu');

  const markers = [
    ...Array.from({ length: events }, () => 'marker marker-event'),
    ...Array.from({ length: tasks }, () => 'marker marker-task'),
  ];
  const visible = markers.length > MAX_MARKERS ? markers.slice(0, MAX_MARKERS - 1) : markers;

  const classes = ['month-day'];
  if (iso === ctx.today) classes.push('is-today');
  if (!iso.startsWith(monthPrefix)) classes.push('is-outside');

  return el('button', {
    type: 'button',
    class: classes.join(' '),
    'data-date': iso,
    'data-focus-key': `mois-${iso}`,
    tabindex: iso === selected ? '0' : '-1',
    'aria-pressed': String(iso === selected),
    'aria-current': iso === ctx.today ? 'date' : false,
    'aria-label': parts.join(', '),
    onclick: () => ctx.actions.onSelectDay(iso),
  },
    el('span', { class: 'month-day-num', 'aria-hidden': 'true' }, String(parseISODate(iso).day)),
    el('span', { class: 'month-markers', 'aria-hidden': 'true' },
      visible.map((className) => el('span', { class: className })),
      markers.length > MAX_MARKERS ? el('span', { class: 'marker-more' }, '+') : null,
    ),
  );
}

/** Le calendrier du mois (tableau de 4 à 6 semaines). */
function monthGrid(selected, ctx) {
  const first = startOfMonth(selected);
  const { year, month } = parseISODate(first);
  const offset = weekdayIndex(first);
  const weeks = Math.ceil((offset + daysInMonth(year, month)) / 7);
  const gridStart = addDays(first, -offset);
  const monthPrefix = first.slice(0, 7);

  const table = el('table', { class: 'month-grid' },
    el('caption', { class: 'visually-hidden' }, `Calendrier de ${formatMonthYear(first).toLowerCase()}. Les flèches du clavier changent de jour.`),
    el('thead', {},
      // Nom court (« Lun. ») ou initiale (« L ») selon la place disponible ;
      // « abbr » donne le nom complet aux lecteurs d'écran.
      el('tr', {}, WEEKDAYS.map((day) =>
        el('th', { scope: 'col', abbr: formatWeekday(day) },
          el('span', { class: 'weekday-short' }, formatWeekdayShort(day)),
          el('span', { class: 'weekday-narrow' }, formatWeekday(day).charAt(0)),
        ),
      )),
    ),
    el('tbody', {},
      Array.from({ length: weeks }, (_, week) =>
        el('tr', {}, Array.from({ length: 7 }, (_, dayOfWeek) =>
          el('td', {}, dayCell(addDays(gridStart, week * 7 + dayOfWeek), selected, monthPrefix, ctx)),
        )),
      ),
    ),
  );

  table.addEventListener('keydown', (event) => {
    const target = event.target.closest('.month-day');
    if (!target) return;
    const next = dateForKey(event.key, target.dataset.date);
    if (!next) return;
    event.preventDefault();
    ctx.actions.onSelectDay(next, { focus: true });
  });

  return table;
}

/** Le jour choisi : sa date, ses entrées, et un bouton vers la vue « Jour ». */
function selectedDay(iso, ctx) {
  return [
    pageDateHeading(iso, ctx.today),
    ...dayContent(iso, ctx),
    el('button', {
      type: 'button',
      class: 'btn btn-small page-show-day',
      'data-focus-key': 'voir-journee',
      onclick: () => ctx.actions.onShowDay(iso),
    }, 'Voir la journée'),
  ];
}

export const monthView = {
  id: 'month',
  label: 'Mois',
  previousLabel: 'Mois précédent',
  nextLabel: 'Mois suivant',

  periodStart(date) {
    return startOfMonth(date);
  },

  /** On passe au 1er du mois précédent ou suivant. */
  step(date, direction) {
    return addMonths(date, direction);
  },

  title(date) {
    return formatMonthYear(date);
  },

  pages(date, mode, ctx) {
    const title = el('h2', { class: 'page-month-title' }, formatMonthYear(date));
    if (mode !== 'spread') {
      return [createPage(title, monthGrid(date, ctx),
        el('div', { class: 'month-selected' }, ...selectedDay(date, ctx)),
        undatedSection(ctx))];
    }
    return [
      createPage(title, monthGrid(date, ctx)),
      createPage(...selectedDay(date, ctx), undatedSection(ctx)),
    ];
  },
};
