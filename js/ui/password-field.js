// =============================================================
// ui/password-field.js — Un champ de mot de passe
// -------------------------------------------------------------
// Les caractères tapés sont cachés par des points. Le bouton
// « Afficher » permet de vérifier ce qu'on a tapé.
// =============================================================

import { el } from './dom.js';

let idCounter = 0;

/**
 * Fabrique un champ de mot de passe avec son étiquette.
 *  - `autocomplete` : 'current-password' (mot de passe existant) ou
 *    'new-password' (nouveau) : aide les gestionnaires de mots de passe ;
 *  - `hint` : petite aide facultative, sous le champ.
 * Renvoie { element, input }.
 */
export function passwordField({ label, autocomplete = 'current-password', hint = null }) {
  const id = `mot-de-passe-${++idCounter}`;
  const hintId = `${id}-aide`;

  const input = el('input', {
    type: 'password',
    id,
    autocomplete,
    autocapitalize: 'off',
    spellcheck: 'false',
    'aria-describedby': hint ? hintId : null,
  });

  const toggle = el('button', { type: 'button', class: 'btn btn-small password-toggle', 'aria-controls': id }, 'Afficher');
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Masquer' : 'Afficher';
    input.focus();
  });

  const element = el('div', { class: 'field' },
    el('label', { for: id }, label),
    el('div', { class: 'password-row' }, input, toggle),
    hint ? el('p', { class: 'field-hint', id: hintId }, hint) : null,
  );
  return { element, input };
}
