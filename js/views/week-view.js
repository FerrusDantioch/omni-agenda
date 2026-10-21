// =============================================================
// views/week-view.js — Vue « Semaine » (du lundi au dimanche)
// -------------------------------------------------------------
//  - Deux pages : du lundi au jeudi à gauche, du vendredi au
//    dimanche à droite, comme un semainier papier.
//  - Une page : les sept jours l'un sous l'autre.
// Toucher le nom d'un jour ouvre ce jour dans la vue « Jour ».
// =============================================================

import { el, icon } from '../ui/dom.js';
import {
  addDays, formatDayMonth, formatISODateLong, formatWeekday, isoWeekNumber, parseISODate, startOfWeek,
} from '../dates.js';
import { createPage, entryList, overdueSection, undatedSection } from './page-parts.js';

/** « du 19 au 25 octobre 2026 », « du 26 octobre au 1er novembre 2026 »… */
function weekRange(monday) {
  const sunday = addDays(monday, 6);
  const a = parseISODate(monday);
  const b = parseISODate(sunday);
  if (a.year !== b.year) return `du ${formatDayMonth(monday)} ${a.year} au ${formatDayMonth(sunday)} ${b.year}`;
  if (a.month !== b.month) return `du ${formatDayMonth(monday)} au ${formatDayMonth(sunday)} ${b.year}`;
  return `du ${a.day === 1 ? '1er' : a.day} au ${formatDayMonth(sunday)} ${b.year}`;
}

/** Un jour de la semaine : son nom (cliquable), ses entrées, un bouton « + ». */
function weekDayBlock(iso, ctx) {
  const isToday = iso === ctx.today;
  const { day } = parseISODate(iso);
  return el('section', { class: isToday ? 'week-day is-today' : 'week-day' },
    el('div', { class: 'week-day-header' },
      el('h3', { class: 'week-day-title' },
        el('button', {
          type: 'button',
          class: 'week-day-link',
          'aria-label': `${formatISODateLong(iso)} : afficher la journée`,
          'data-focus-key': `jour-${iso}`,
          onclick: () => ctx.actions.onShowDay(iso),
        },
          el('span', { class: 'week-day-name' }, formatWeekday(iso)),
          ' ',
          el('span', { class: 'week-day-num' }, day === 1 ? '1er' : String(day)),
        ),
        isToday ? el('span', { class: 'today-tag' }, "Aujourd'hui") : null,
      ),
      el('button', {
        type: 'button',
        class: 'btn btn-ghost btn-icon week-day-add',
        'aria-label': `Ajouter une entrée le ${formatISODateLong(iso)}`,
        'data-focus-key': `ajouter-${iso}`,
        onclick: () => ctx.actions.onAdd(iso),
      }, icon('plus')),
    ),
    entryList(ctx.index.entriesOn(iso), ctx, { compact: true, emptyText: '' }),
    isToday ? overdueSection(ctx) : null,
  );
}

export const weekView = {
  id: 'week',
  label: 'Semaine',
  previousLabel: 'Semaine précédente',
  nextLabel: 'Semaine suivante',

  periodStart(date) {
    return startOfWeek(date);
  },

  step(date, direction) {
    return addDays(date, 7 * direction);
  },

  title(date) {
    const monday = startOfWeek(date);
    return `Semaine ${isoWeekNumber(monday)} · ${weekRange(monday)}`;
  },

  pages(date, mode, ctx) {
    const monday = startOfWeek(date);
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const header = (text) => el('h2', { class: 'page-week-title' }, text);
    const weekLabel = `Semaine ${isoWeekNumber(monday)}`;

    if (mode !== 'spread') {
      return [createPage(header(weekLabel), ...days.map((day) => weekDayBlock(day, ctx)), undatedSection(ctx))];
    }
    return [
      createPage(header(weekLabel), ...days.slice(0, 4).map((day) => weekDayBlock(day, ctx))),
      createPage(header(`${weekLabel} (suite)`), ...days.slice(4).map((day) => weekDayBlock(day, ctx)), undatedSection(ctx)),
    ];
  },
};
