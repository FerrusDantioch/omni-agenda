// =============================================================
// views/agenda-view.js — L'écran de l'agenda (chef d'orchestre)
// -------------------------------------------------------------
// Il retient ce qui est affiché :
//   - la vue (jour, semaine ou mois) ;
//   - la date choisie ;
//   - le mode : deux pages côte à côte, ou une seule page.
// Il relie les boutons (précédent, suivant, aujourd'hui, aller à
// une date, jour/semaine/mois) et demande au livre d'afficher les
// pages fabriquées par la vue choisie.
//
// Pourquoi une seule page sur téléphone en portrait ? Deux pages
// côte à côte y feraient chacune moins de 200 pixels de large :
// le texte serait illisible et les boutons trop petits.
// =============================================================

import { keepFocus } from '../ui/dom.js';
import { isValidISODate, todayISO } from '../dates.js';
import { getEntries, onEntriesChange, toggleTaskDone } from '../entry-store.js';
import { buildAgendaIndex } from './agenda-data.js';
import { createBook } from './book.js';
import { dayView } from './day-view.js';
import { weekView } from './week-view.js';
import { monthView } from './month-view.js';

const VIEWS = { day: dayView, week: weekView, month: monthView };
export const DEFAULT_VIEW = 'day';

// Largeurs (en « rem », donc proportionnelles à la taille du texte)
// à partir desquelles on affiche deux pages.
const SPREAD_MIN_WIDTH_REM = 44;
const SPREAD_MIN_WIDTH_LANDSCAPE_REM = 34;

const state = { view: DEFAULT_VIEW, date: todayISO(), mode: 'single', today: todayISO() };
let refs = null;
let book = null;
let actions = null;
let onViewChangeCallback = null;

/** Deux pages si la place le permet, sinon une seule. */
function computeMode() {
  const width = refs.wrap.clientWidth;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const landscape = window.innerWidth > window.innerHeight;
  const spread = width >= SPREAD_MIN_WIDTH_REM * rem || (landscape && width >= SPREAD_MIN_WIDTH_LANDSCAPE_REM * rem);
  return spread ? 'spread' : 'single';
}

/** Dessine tout l'écran. `direction` : sens de l'animation (0 = aucune). */
function render(direction = 0) {
  state.today = todayISO();
  const view = VIEWS[state.view];
  const ctx = { index: buildAgendaIndex(getEntries(), state.today), today: state.today, actions };

  refs.empty.hidden = !ctx.index.isEmpty;

  // Le titre n'est modifié que s'il change (il est lu par les lecteurs d'écran).
  const title = view.title(state.date, state.mode);
  if (refs.title.textContent !== title) refs.title.textContent = title;

  refs.previousLabel.textContent = view.previousLabel;
  refs.nextLabel.textContent = view.nextLabel;
  refs.jump.value = state.date;
  for (const button of refs.viewButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  }

  refs.book.dataset.view = state.view;
  book.show(view.pages(state.date, state.mode, ctx), { mode: state.mode, direction });
}

/** Va à une date (et éventuellement change de vue), avec l'animation adaptée. */
function navigate(date, viewId = state.view) {
  const before = VIEWS[state.view].periodStart(state.date, state.mode);
  const viewChanged = viewId !== state.view;
  state.view = viewId;
  state.date = date;
  const after = VIEWS[viewId].periodStart(date, state.mode);
  // Même période (ex. : autre jour du même mois) → pas de page tournée.
  const direction = viewChanged || before === after ? 0 : after > before ? 1 : -1;
  render(direction);
  if (viewChanged) onViewChangeCallback?.(viewId);
}

/** Page suivante (1) ou précédente (-1). */
function turnPage(direction) {
  navigate(VIEWS[state.view].step(state.date, direction, state.mode));
}

/** Après un rendu, donne le focus clavier à un jour du calendrier. */
function focusMonthDay(iso) {
  refs.book.querySelector(`.month-day[data-date="${iso}"]`)?.focus();
}

/** Si minuit est passé pendant que l'application était ouverte, on met à jour. */
function refreshIfDayChanged() {
  if (document.visibilityState === 'visible' && todayISO() !== state.today) render();
}

/**
 * Prépare l'écran de l'agenda.
 *  - initialView : vue mémorisée ('day', 'week' ou 'month') ;
 *  - onOpen(id) : ouvrir la fiche d'une entrée ;
 *  - onAdd(date) : ajouter une entrée à cette date ;
 *  - onError(error) : prévenir d'un échec d'enregistrement ;
 *  - onViewChange(view) : la vue a changé (pour la mémoriser).
 */
export function initAgendaView({ initialView, onOpen, onAdd, onError, onViewChange }) {
  refs = {
    wrap: document.getElementById('livre-conteneur'),
    book: document.getElementById('livre'),
    title: document.getElementById('titre-agenda'),
    previous: document.getElementById('bouton-precedent'),
    next: document.getElementById('bouton-suivant'),
    previousLabel: document.querySelector('#bouton-precedent .nav-label'),
    nextLabel: document.querySelector('#bouton-suivant .nav-label'),
    today: document.getElementById('bouton-aujourdhui'),
    jump: document.getElementById('aller-a-la-date'),
    viewButtons: [...document.querySelectorAll('[data-view]')],
    empty: document.getElementById('accueil-vide'),
  };
  state.view = Object.hasOwn(VIEWS, initialView) ? initialView : DEFAULT_VIEW;
  onViewChangeCallback = onViewChange;

  actions = {
    onOpen,
    onToggleDone: (id) => toggleTaskDone(id).catch(onError),
    onAdd,
    onShowDay: (iso) => navigate(iso, 'day'),
    onSelectDay: (iso, { focus = false } = {}) => {
      navigate(iso);
      if (focus) focusMonthDay(iso);
    },
  };

  book = createBook(refs.book, { onSwipe: turnPage });

  refs.previous.addEventListener('click', () => turnPage(-1));
  refs.next.addEventListener('click', () => turnPage(1));
  refs.today.addEventListener('click', () => navigate(todayISO()));
  refs.jump.addEventListener('change', () => {
    if (isValidISODate(refs.jump.value) && refs.jump.value !== state.date) navigate(refs.jump.value);
  });
  for (const button of refs.viewButtons) {
    button.addEventListener('click', () => navigate(state.date, button.dataset.view));
  }

  // Une ou deux pages : on recalcule quand la taille change
  // (rotation du téléphone, fenêtre redimensionnée, taille du texte).
  state.mode = computeMode();
  new ResizeObserver(() => {
    const mode = computeMode();
    if (mode !== state.mode) {
      state.mode = mode;
      render();
    }
  }).observe(refs.wrap);

  // Les entrées ont changé : on redessine sans animation, en gardant le focus.
  onEntriesChange(() => keepFocus(refs.book, () => render()));

  setInterval(refreshIfDayChanged, 60000);
  document.addEventListener('visibilitychange', refreshIfDayChanged);

  render();
}

/** La date actuellement choisie dans l'agenda. */
export function getAgendaDate() {
  return state.date;
}
