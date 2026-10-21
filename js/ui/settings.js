// =============================================================
// ui/settings.js — L'écran « Réglages »
// -------------------------------------------------------------
// Construit les choix (thème, police, taille du texte) et réagit quand
// l'utilisateur en sélectionne un : le changement s'applique
// tout de suite et il est mémorisé.
// =============================================================

import { el } from './dom.js';
import { THEMES, applyTheme, saveTheme } from '../themes.js';
import { FONTS, TEXT_SIZES, applyFont, applyTextSize, saveFont, saveTextSize } from '../fonts.js';

/**
 * Prépare l'écran des réglages.
 * `current` contient les réglages actuels : { theme, font, textSize }.
 * `onSaveError` est appelé si l'enregistrement échoue.
 */
export function initSettings(current, onSaveError) {
  renderThemeChoices(current.theme, onSaveError);
  renderFontChoices(current.font, onSaveError);
  renderTextSizeChoices(current.textSize, onSaveError);
}

/** Les trois cartes de thème, chacune avec un aperçu miniature. */
function renderThemeChoices(selectedId, onSaveError) {
  const container = document.getElementById('choix-theme');

  const cards = THEMES.map((theme) =>
    el('label', { class: 'choice-card' },
      el('input', {
        type: 'radio',
        name: 'theme',
        value: theme.id,
        checked: theme.id === selectedId,
        onchange: () => {
          applyTheme(theme.id, { animate: true });
          saveTheme(theme.id).catch(onSaveError);
        },
      }),
      themePreview(theme.id),
      el('span', { class: 'choice-text' },
        el('span', { class: 'choice-title' }, theme.label),
        el('span', { class: 'choice-desc' }, theme.description),
      ),
    ),
  );

  container.replaceChildren(...cards);
}

/** Aperçu miniature : il porte data-theme, donc il prend les couleurs de ce thème. */
function themePreview(themeId) {
  const page = (accentFirst) =>
    el('span', { class: 'theme-preview-page' },
      el('span', { class: accentFirst ? 'theme-preview-line is-accent' : 'theme-preview-line' }),
      el('span', { class: 'theme-preview-line' }),
    );
  return el('span', { class: 'theme-preview', 'data-theme': themeId, 'aria-hidden': 'true' }, page(true), page(false));
}

/** Les choix de police : chaque carte est écrite dans sa propre police. */
function renderFontChoices(selectedId, onSaveError) {
  const container = document.getElementById('choix-police');

  const cards = FONTS.map((font) =>
    el('label', { class: 'choice-card' },
      el('input', {
        type: 'radio',
        name: 'police',
        value: font.id,
        checked: font.id === selectedId,
        onchange: () => {
          applyFont(font.id);
          saveFont(font.id).catch(onSaveError);
        },
      }),
      el('span', { class: 'choice-text font-sample', 'data-font': font.id },
        el('span', { class: 'choice-title' }, font.label),
        el('span', { class: 'choice-desc' }, font.description),
      ),
    ),
  );

  container.replaceChildren(...cards);
}

/** Les choix de taille du texte, avec un exemple « Aa » à la bonne taille. */
function renderTextSizeChoices(selectedId, onSaveError) {
  const container = document.getElementById('choix-taille-texte');

  const cards = TEXT_SIZES.map((size) => {
    const sample = el('span', { class: 'size-sample', 'aria-hidden': 'true' }, 'Aa');
    // Taille de l'exemple, relative à la taille actuelle du texte.
    sample.style.fontSize = `${size.scale / 100}em`;

    return el('label', { class: 'choice-card' },
      el('input', {
        type: 'radio',
        name: 'taille-texte',
        value: size.id,
        checked: size.id === selectedId,
        onchange: () => {
          applyTextSize(size.id);
          saveTextSize(size.id).catch(onSaveError);
        },
      }),
      el('span', { class: 'choice-text' },
        sample,
        el('span', { class: 'choice-title' }, size.label),
      ),
    );
  });

  container.replaceChildren(...cards);
}
