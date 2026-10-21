// =============================================================
// themes.js — Choix et application du thème de couleurs
// -------------------------------------------------------------
// Les couleurs elles-mêmes sont dans css/themes.css. Ici, on
// indique simplement à la page quel thème utiliser, et on le
// mémorise.
// =============================================================

import { setSetting, updateAppearanceCache } from './storage.js';

/**
 * Liste des thèmes proposés.
 * `barColor` colore la barre du navigateur sur téléphone
 * (même couleur que la barre du haut de l'application).
 */
export const THEMES = [
  {
    id: 'omni',
    label: 'Omni-système',
    description: 'Fond sombre, accents violets lumineux',
    barColor: '#1b1726',
  },
  {
    id: 'dark',
    label: 'Sombre',
    description: 'Gris foncés, accents bleu doux',
    barColor: '#202226',
  },
  {
    id: 'light',
    label: 'Clair',
    description: 'Tons crème, sans blanc éblouissant',
    barColor: '#efebe3',
  },
];

export const DEFAULT_THEME = 'omni';

let transitionTimer = null;

/** Trouve un thème par son identifiant (ou le thème par défaut). */
function findTheme(id) {
  return THEMES.find((theme) => theme.id === id) || THEMES.find((theme) => theme.id === DEFAULT_THEME);
}

/**
 * Applique un thème à la page.
 * Avec `animate: true`, les couleurs changent en douceur (0,35 s),
 * sauf si l'appareil demande de réduire les animations.
 * Renvoie l'identifiant du thème réellement appliqué.
 */
export function applyTheme(id, { animate = false } = {}) {
  const theme = findTheme(id);
  const root = document.documentElement;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (animate && !reduceMotion) {
    root.classList.add('theme-transition');
    clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => root.classList.remove('theme-transition'), 400);
  }

  root.dataset.theme = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.barColor);
  return theme.id;
}

/** Mémorise le thème choisi. */
export async function saveTheme(id) {
  const theme = findTheme(id);
  updateAppearanceCache({ theme: theme.id });
  await setSetting('theme', theme.id);
}
