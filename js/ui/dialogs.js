// =============================================================
// ui/dialogs.js — Fenêtres par-dessus la page
// -------------------------------------------------------------
// On utilise l'élément <dialog> du navigateur : il garde le
// clavier à l'intérieur de la fenêtre et se ferme avec Échap.
//
// En plus, chaque fenêtre ouverte ajoute une étape dans
// l'historique : le bouton « retour » du téléphone ferme la
// fenêtre au lieu de quitter l'écran.
// =============================================================

import { el } from './dom.js';

// Fenêtres ouvertes → jeton qui identifie leur étape d'historique.
const openModals = new Map();
// Fenêtres dont la fermeture est déjà demandée (on attend le « retour » du navigateur).
const closingModals = new Set();
let tokenCounter = 0;

// Après un rechargement, une ancienne étape « fenêtre » peut rester
// dans l'historique : on la neutralise.
if (history.state?.omniModal) history.replaceState(null, '');

function forceClose(dialog) {
  openModals.delete(dialog);
  closingModals.delete(dialog);
  if (dialog.open) dialog.close();
}

// Bouton « retour » : on ferme les fenêtres dont l'étape a été quittée.
window.addEventListener('popstate', () => {
  for (const [dialog, token] of openModals) {
    if (history.state?.omniModal !== token) forceClose(dialog);
  }
});

/** Ouvre une fenêtre (et ajoute une étape dans l'historique). */
export function openModal(dialog) {
  if (dialog.open) return;
  const token = `fenetre-${Date.now()}-${++tokenCounter}`;
  openModals.set(dialog, token);
  history.pushState({ omniModal: token }, '');
  dialog.showModal();
}

/** Ferme une fenêtre (en retirant son étape de l'historique). */
export function closeModal(dialog) {
  // Fermeture déjà en cours : on ne recule pas une deuxième fois dans
  // l'historique (cela ferait quitter l'application).
  if (closingModals.has(dialog)) return;
  const token = openModals.get(dialog);
  if (token && history.state?.omniModal === token) {
    // Revenir en arrière déclenche « popstate », qui ferme la fenêtre.
    closingModals.add(dialog);
    history.back();
  } else {
    forceClose(dialog);
  }
}

/**
 * Demande une confirmation. Renvoie une promesse : vrai si
 * l'utilisateur confirme, faux s'il annule (bouton, Échap ou retour).
 * Le bouton « Annuler » est sélectionné par défaut : un appui
 * accidentel sur Entrée ne détruit rien.
 */
export function confirmAction({ title, message, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false }) {
  return new Promise((resolve) => {
    const titleId = `confirmation-titre-${++tokenCounter}`;
    const messageId = `${titleId}-message`;

    const cancelButton = el('button', { type: 'button', class: 'btn' }, cancelLabel);
    const confirmButton = el('button', { type: 'button', class: danger ? 'btn btn-danger' : 'btn btn-primary' }, confirmLabel);

    const dialog = el('dialog', { class: 'panel panel-small', 'aria-labelledby': titleId, 'aria-describedby': messageId },
      el('div', { class: 'panel-body' },
        el('h2', { id: titleId }, title),
        el('p', { id: messageId }, message),
      ),
      el('div', { class: 'panel-footer' }, cancelButton, confirmButton),
    );

    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      window.removeEventListener('popstate', onBack);
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(result);
    };
    const onBack = () => finish(false);

    cancelButton.addEventListener('click', () => finish(false));
    confirmButton.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    window.addEventListener('popstate', onBack);

    document.body.append(dialog);
    dialog.showModal();
    cancelButton.focus();
  });
}
