// =============================================================
// ui/dom.js — Petit outil pour fabriquer des éléments de page
// -------------------------------------------------------------
// On construit les éléments un par un (au lieu d'écrire du HTML
// sous forme de texte). C'est plus sûr : un texte saisi par
// l'utilisateur ne peut jamais être pris pour du code.
// =============================================================

/**
 * Crée un élément HTML.
 * Exemple : el('button', { class: 'btn', type: 'button', onclick: maFonction }, 'Valider')
 *  - les attributs qui commencent par « on » deviennent des réactions aux événements ;
 *  - les enfants peuvent être du texte ou d'autres éléments.
 */
export function el(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);

  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      element.addEventListener(name.slice(2), value);
    } else {
      element.setAttribute(name, value === true ? '' : String(value));
    }
  }

  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    // Un texte est toujours inséré comme du texte, jamais comme du code.
    element.append(child instanceof Node ? child : String(child));
  }

  return element;
}

// ---------------------------------------------------------------
// Icônes (petits dessins au trait)
// ---------------------------------------------------------------

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** Tracés des icônes utilisées par l'application. */
export const ICONS = {
  close: 'M18 6 6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
};

/** Fabrique une icône décorative (ignorée par les lecteurs d'écran). */
export function icon(name) {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

// ---------------------------------------------------------------
// Garder le focus clavier pendant un réaffichage
// ---------------------------------------------------------------

/**
 * Exécute `render()` (qui remplace une partie de la page) puis remet le
 * focus sur l'élément équivalent : celui qui porte le même attribut
 * data-focus-key. Sans cela, cocher une tâche au clavier ferait
 * « perdre sa place » à l'utilisateur.
 */
export function keepFocus(container, render) {
  const key = container.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
  render();
  if (key) container.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)?.focus();
}
