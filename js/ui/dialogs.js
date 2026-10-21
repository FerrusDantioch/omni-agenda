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

// ---------------------------------------------------------------
// Petites fenêtres de question (confirmation, choix)
// ---------------------------------------------------------------

/**
 * Affiche une petite fenêtre temporaire et gère sa fermeture.
 *  - Comme les autres fenêtres, elle ajoute une étape dans l'historique :
 *    le bouton « retour » du téléphone ferme seulement cette fenêtre.
 *  - Échap ou « retour » donnent la réponse `cancelAnswer`.
 *  - Pendant un traitement (`isBusy()` vrai, ex. : chiffrement en cours),
 *    la fenêtre reste ouverte jusqu'à la fin du traitement.
 * Renvoie { finish, stayOpen, answered } :
 *  - finish(réponse) ferme la fenêtre avec cette réponse ;
 *  - stayOpen() est à appeler quand un traitement se termine sans fermer la fenêtre ;
 *  - answered est une promesse, tenue avec la réponse une fois l'étape d'historique
 *    retirée : la suite (une autre fenêtre, par exemple) part d'un historique propre.
 */
function presentDialog(dialog, focusTarget, cancelAnswer, isBusy = () => false) {
  const token = `question-${Date.now()}-${++tokenCounter}`;
  let answer = cancelAnswer;
  let finishing = false;
  let settled = false;
  // Vrai si « retour » a été pressé pendant un traitement : l'étape est déjà retirée.
  let stepRemoved = false;
  let resolveAnswered;
  const answered = new Promise((resolve) => {
    resolveAnswered = resolve;
  });

  const settle = () => {
    if (settled) return;
    settled = true;
    window.removeEventListener('popstate', onPopState);
    if (dialog.open) dialog.close();
    dialog.remove();
    resolveAnswered(answer);
  };
  // Étape quittée (bouton « retour », ou recul demandé par finish) : c'est fini.
  const onPopState = () => {
    if (history.state?.omniModal === token) return;
    if (isBusy() && !finishing) {
      stepRemoved = true;
      return;
    }
    settle();
  };
  const finish = (value) => {
    if (settled || finishing) return;
    finishing = true;
    answer = value;
    if (dialog.open) dialog.close();
    if (!stepRemoved && history.state?.omniModal === token) history.back();
    else settle();
  };
  const stayOpen = () => {
    if (settled) return;
    if (stepRemoved) {
      stepRemoved = false;
      history.pushState({ omniModal: token }, '');
    }
    if (!dialog.open) dialog.showModal();
  };

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (!isBusy()) finish(cancelAnswer);
  });
  // Sur certains téléphones, le bouton « retour » ferme la fenêtre directement :
  // on le traite comme « Annuler » (sauf pendant un traitement, qui décidera).
  dialog.addEventListener('close', () => {
    if (!finishing && !isBusy()) finish(cancelAnswer);
  });

  history.pushState({ omniModal: token }, '');
  window.addEventListener('popstate', onPopState);
  document.body.append(dialog);
  dialog.showModal();
  focusTarget.focus();
  return { finish, stayOpen, answered };
}

/**
 * Affiche une petite fenêtre de question et attend la réponse.
 * `buttons` associe chaque bouton à la réponse qu'il donne ;
 * Échap ou le bouton « retour » donnent `cancelAnswer`.
 */
function askInDialog(dialog, buttons, cancelAnswer, focusTarget) {
  const control = presentDialog(dialog, focusTarget, cancelAnswer);
  for (const [button, value] of buttons) button.addEventListener('click', () => control.finish(value));
  return control.answered;
}

/** Un texte, ou une liste de textes, devient un ou plusieurs paragraphes. */
function paragraphs(message) {
  return (Array.isArray(message) ? message : [message]).map((text) => el('p', {}, text));
}

/**
 * Demande une confirmation. Renvoie une promesse : vrai si
 * l'utilisateur confirme, faux s'il annule (bouton, Échap ou retour).
 * Le bouton « Annuler » est sélectionné par défaut : un appui
 * accidentel sur Entrée ne détruit rien.
 * `message` : un texte, ou une liste de textes (un par paragraphe).
 */
export function confirmAction({ title, message, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false }) {
  const titleId = `confirmation-titre-${++tokenCounter}`;
  const messageId = `${titleId}-message`;

  const cancelButton = el('button', { type: 'button', class: 'btn' }, cancelLabel);
  const confirmButton = el('button', { type: 'button', class: danger ? 'btn btn-danger' : 'btn btn-primary' }, confirmLabel);

  const dialog = el('dialog', { class: 'panel panel-small', 'aria-labelledby': titleId, 'aria-describedby': messageId },
    el('div', { class: 'panel-body' },
      el('h2', { id: titleId }, title),
      el('div', { id: messageId, class: 'dialog-message' }, paragraphs(message)),
    ),
    el('div', { class: 'panel-footer' }, cancelButton, confirmButton),
  );

  return askInDialog(dialog, new Map([[cancelButton, false], [confirmButton, true]]), false, cancelButton);
}

const CHOICE_CLASSES = { primary: 'btn btn-primary', danger: 'btn btn-danger' };

/**
 * Propose plusieurs choix. `choices` : [{ value, label, description, style }]
 * (style : 'primary', 'danger' ou rien). Chaque choix est un grand bouton
 * suivi de son explication. Renvoie une promesse : la valeur choisie, ou
 * null si l'utilisateur annule (bouton « Annuler », Échap ou retour).
 * « Annuler » est sélectionné par défaut.
 */
export function chooseAction({ title, message, choices, cancelLabel = 'Annuler' }) {
  const titleId = `choix-titre-${++tokenCounter}`;
  const messageId = `${titleId}-message`;
  const buttons = new Map();

  const options = choices.map((choice, index) => {
    const descriptionId = `${titleId}-explication-${index}`;
    const button = el('button', {
      type: 'button',
      class: CHOICE_CLASSES[choice.style] ?? 'btn',
      'aria-describedby': choice.description ? descriptionId : null,
    }, choice.label);
    buttons.set(button, choice.value);
    return el('div', { class: 'dialog-choice' },
      button,
      choice.description ? el('p', { id: descriptionId, class: 'dialog-choice-desc' }, choice.description) : null,
    );
  });

  const cancelButton = el('button', { type: 'button', class: 'btn' }, cancelLabel);
  buttons.set(cancelButton, null);

  const dialog = el('dialog', { class: 'panel panel-small', 'aria-labelledby': titleId, 'aria-describedby': messageId },
    el('div', { class: 'panel-body' },
      el('h2', { id: titleId }, title),
      el('div', { id: messageId, class: 'dialog-message' }, paragraphs(message)),
      el('div', { class: 'dialog-choices' }, options),
    ),
    el('div', { class: 'panel-footer' }, cancelButton),
  );

  return askInDialog(dialog, buttons, null, cancelButton);
}

/**
 * Fenêtre avec un petit formulaire (ex. : taper un mot de passe).
 *  - `content` : les champs, déjà construits ;
 *  - `onSubmit()` est appelée quand on valide. Elle renvoie :
 *      null → tout va bien, la fenêtre se ferme ;
 *      un texte, ou { message, input } → le formulaire reste ouvert et
 *      affiche ce message (et place le curseur dans `input`).
 * Pendant le traitement, les boutons sont désactivés.
 * Renvoie une promesse : vrai si le formulaire a été validé, faux si annulé.
 */
export function openFormDialog({ title, message, content, submitLabel, danger = false, cancelLabel = 'Annuler', onSubmit }) {
  const titleId = `formulaire-titre-${++tokenCounter}`;
  const messageId = `${titleId}-message`;

  const errorZone = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const cancelButton = el('button', { type: 'button', class: 'btn' }, cancelLabel);
  const submitButton = el('button', { type: 'submit', class: danger ? 'btn btn-danger' : 'btn btn-primary' }, submitLabel);
  const form = el('form', { class: 'panel-content', novalidate: true },
    el('div', { class: 'panel-body' },
      el('h2', { id: titleId }, title),
      message ? el('div', { id: messageId, class: 'dialog-message' }, paragraphs(message)) : null,
      content,
      errorZone,
    ),
    el('div', { class: 'panel-footer' }, cancelButton, submitButton),
  );
  const dialog = el('dialog', {
    class: 'panel panel-small',
    'aria-labelledby': titleId,
    'aria-describedby': message ? messageId : null,
  }, form);

  let busy = false;
  const setBusy = (value) => {
    busy = value;
    submitButton.disabled = value;
    cancelButton.disabled = value;
    submitButton.textContent = value ? 'Un instant…' : submitLabel;
    form.setAttribute('aria-busy', String(value));
  };

  const control = presentDialog(dialog, form.querySelector('input') ?? cancelButton, false, () => busy);
  cancelButton.addEventListener('click', () => control.finish(false));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    errorZone.hidden = true;
    for (const field of form.querySelectorAll('[aria-invalid]')) field.removeAttribute('aria-invalid');

    setBusy(true);
    let problem;
    try {
      problem = await onSubmit();
    } catch (error) {
      console.error(error);
      problem = "Une erreur est survenue : rien n'a été modifié. Réessaie.";
    }
    setBusy(false);

    if (!problem) {
      control.finish(true);
      return;
    }
    control.stayOpen();
    const { message: text, input = null } = typeof problem === 'string' ? { message: problem } : problem;
    errorZone.textContent = text;
    errorZone.hidden = false;
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      input.select?.();
    }
  });

  return control.answered;
}
