// =============================================================
// views/day-view.js — Vue « Jour »
// -------------------------------------------------------------
// Une page = un jour.
//  - Deux pages (grand écran) : le jour choisi à gauche, le
//    lendemain à droite. « Suivant » avance de deux jours.
//  - Une page (téléphone en portrait) : un jour à la fois.
// =============================================================

import {
  MAX_DATE, MIN_DATE, addDays, clampDate, formatDayMonth, formatISODateLong, formatWeekday, parseISODate,
} from '../dates.js';
import { createPage, dayContent, pageDateHeading, undatedSection } from './page-parts.js';

const MAX_SPREAD_START = addDays(MAX_DATE, -1);

function spreadStart(date) {
  const clamped = clampDate(date);
  return clamped > MAX_SPREAD_START ? MAX_SPREAD_START : clamped;
}

export const dayView = {
  id: 'day',
  label: 'Jour',
  previousLabel: 'Jours précédents',
  nextLabel: 'Jours suivants',

  /** Premier jour affiché (sert à savoir dans quel sens tourner la page). */
  periodStart(date, mode) {
    return mode === 'spread' ? spreadStart(date) : clampDate(date);
  },

  /** Date obtenue en avançant (direction = 1) ou en reculant (-1). */
  step(date, direction, mode) {
    const target = addDays(date, direction * (mode === 'spread' ? 2 : 1));
    const max = mode === 'spread' ? MAX_SPREAD_START : MAX_DATE;
    if (target < MIN_DATE) return MIN_DATE;
    if (target > max) return max;
    return target;
  },

  /** Titre de la période affichée. */
  title(date, mode) {
    if (mode !== 'spread') return formatISODateLong(clampDate(date));
    const start = spreadStart(date);
    const next = addDays(start, 1);
    const a = parseISODate(start);
    const b = parseISODate(next);
    if (a.year !== b.year) return `${formatISODateLong(start)} et ${formatISODateLong(next).toLowerCase()}`;
    if (a.month !== b.month) {
      return `${formatWeekday(start)} ${formatDayMonth(start)} et ${formatWeekday(next).toLowerCase()} ${formatDayMonth(next)} ${b.year}`;
    }
    return `${formatWeekday(start)} ${a.day === 1 ? '1er' : a.day} et ${formatWeekday(next).toLowerCase()} ${formatDayMonth(next)} ${b.year}`;
  },

  /** Les pages à afficher : une ou deux. */
  pages(date, mode, ctx) {
    const start = mode === 'spread' ? spreadStart(date) : clampDate(date);
    const days = mode === 'spread' ? [start, addDays(start, 1)] : [start];
    return days.map((day, position) =>
      createPage(
        pageDateHeading(day, ctx.today),
        ...dayContent(day, ctx),
        // Les tâches sans échéance se trouvent en bas de la dernière page.
        position === days.length - 1 ? undatedSection(ctx) : null,
      ),
    );
  },
};
