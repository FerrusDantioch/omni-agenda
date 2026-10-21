// =============================================================
// views/day-view.js — Vue « Jour »
// -------------------------------------------------------------
// Une page = un jour.
//  - Deux pages (grand écran) : le jour choisi à gauche, le
//    lendemain à droite. « Suivant » avance de deux jours.
//  - Une page (téléphone en portrait) : un jour à la fois.
// =============================================================

import { addDays, formatDayMonth, formatISODateLong, formatWeekday, parseISODate } from '../dates.js';
import { createPage, dayContent, pageDateHeading, undatedSection } from './page-parts.js';

export const dayView = {
  id: 'day',
  label: 'Jour',
  previousLabel: 'Jours précédents',
  nextLabel: 'Jours suivants',

  /** Premier jour affiché (sert à savoir dans quel sens tourner la page). */
  periodStart(date) {
    return date;
  },

  /** Date obtenue en avançant (direction = 1) ou en reculant (-1). */
  step(date, direction, mode) {
    return addDays(date, direction * (mode === 'spread' ? 2 : 1));
  },

  /** Titre de la période affichée. */
  title(date, mode) {
    if (mode !== 'spread') return formatISODateLong(date);
    const next = addDays(date, 1);
    const a = parseISODate(date);
    const b = parseISODate(next);
    if (a.year !== b.year) return `${formatISODateLong(date)} et ${formatISODateLong(next).toLowerCase()}`;
    if (a.month !== b.month) {
      return `${formatWeekday(date)} ${formatDayMonth(date)} et ${formatWeekday(next).toLowerCase()} ${formatDayMonth(next)} ${b.year}`;
    }
    return `${formatWeekday(date)} ${a.day === 1 ? '1er' : a.day} et ${formatWeekday(next).toLowerCase()} ${formatDayMonth(next)} ${b.year}`;
  },

  /** Les pages à afficher : une ou deux. */
  pages(date, mode, ctx) {
    const days = mode === 'spread' ? [date, addDays(date, 1)] : [date];
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
