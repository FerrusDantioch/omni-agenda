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
