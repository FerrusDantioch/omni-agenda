// =============================================================
// ui/password-settings.js — Le bloc « Mot de passe » des Réglages
// -------------------------------------------------------------
// Sans mot de passe : un bouton « Activer un mot de passe ».
// Avec un mot de passe : « Verrouiller maintenant », « Changer le
// mot de passe » et « Désactiver le mot de passe ».
// Le bouton « Verrouiller » de la barre du haut n'apparaît que
// lorsqu'un mot de passe est actif.
// =============================================================

import { el, showNotice } from './dom.js';
import { openFormDialog } from './dialogs.js';
import { passwordField } from './password-field.js';
import { getEntries, loadEntries } from '../entry-store.js';
import { isCryptoAvailable } from '../crypto.js';
import {
  PASSWORD_MIN_LENGTH, changePassword, checkNewPassword, disablePassword, enablePassword, isProtected, lockApp,
} from '../security.js';

const WARNING = 'Si tu perds ton mot de passe, personne ne peut récupérer les données.';
const NEW_PASSWORD_HINT = `Au moins ${PASSWORD_MIN_LENGTH} caractères. Une phrase facile à retenir fonctionne bien, `
  + 'par exemple «\u00A0mon chat dort sous la pluie\u00A0».';

/**
 * Après un changement réussi : on redessine le bloc, on y replace le
 * curseur (le bouton utilisé a disparu) et on affiche le message.
 */
function afterChange(message) {
  render();
  document.getElementById('titre-mot-de-passe').focus();
  showNotice(document.getElementById('message-mot-de-passe'), message);
}

/** Le message d'avertissement, bien visible. */
function warning() {
  return el('p', { class: 'notice notice-warning' }, WARNING);
}

/** Vérifie le nouveau mot de passe ; renvoie le problème à afficher, ou null. */
function newPasswordProblem(newField, confirmField) {
  const problem = checkNewPassword(newField.input.value, confirmField.input.value);
  if (!problem) return null;
  return { message: problem.message, input: problem.field === 'confirmation' ? confirmField.input : newField.input };
}

/**
 * Juste avant de tout réécrire, on relit l'agenda : on travaille ainsi
 * sur la version la plus récente (un autre onglet a pu le modifier).
 */
async function currentEntries() {
  await loadEntries();
  return getEntries();
}

// ---------------------------------------------------------------
// Les trois actions
// ---------------------------------------------------------------

async function enable() {
  const newField = passwordField({ label: 'Nouveau mot de passe', autocomplete: 'new-password', hint: NEW_PASSWORD_HINT });
  const confirmField = passwordField({ label: 'Écris-le une deuxième fois', autocomplete: 'new-password' });
  const understood = el('input', { type: 'checkbox' });

  const done = await openFormDialog({
    title: 'Activer un mot de passe',
    message: "Ton agenda sera chiffré sur cet appareil : sans le mot de passe, il est illisible. "
      + "Le mot de passe sera demandé à chaque ouverture d'Omni-Agenda.",
    content: [
      warning(),
      newField.element,
      confirmField.element,
      el('label', { class: 'checkbox-row checkbox-row-wrap' },
        understood,
        el('span', {}, "J'ai compris : si je perds mon mot de passe, personne ne peut récupérer mes données."),
      ),
    ],
    submitLabel: 'Activer le mot de passe',
    onSubmit: async () => {
      const problem = newPasswordProblem(newField, confirmField);
      if (problem) return problem;
      if (!understood.checked) return { message: 'Coche la case pour confirmer que tu as compris.', input: understood };
      await enablePassword(newField.input.value, await currentEntries());
      return null;
    },
  });

  if (done) afterChange('Mot de passe activé : ton agenda est maintenant chiffré sur cet appareil.');
}

async function change() {
  const currentField = passwordField({ label: 'Mot de passe actuel', autocomplete: 'current-password' });
  const newField = passwordField({ label: 'Nouveau mot de passe', autocomplete: 'new-password', hint: NEW_PASSWORD_HINT });
  const confirmField = passwordField({ label: 'Écris-le une deuxième fois', autocomplete: 'new-password' });

  const done = await openFormDialog({
    title: 'Changer le mot de passe',
    content: [warning(), currentField.element, newField.element, confirmField.element],
    submitLabel: 'Changer le mot de passe',
    onSubmit: async () => {
      if (!currentField.input.value) return { message: 'Écris ton mot de passe actuel.', input: currentField.input };
      const problem = newPasswordProblem(newField, confirmField);
      if (problem) return problem;
      if (newField.input.value === currentField.input.value) {
        return { message: "Le nouveau mot de passe doit être différent de l'actuel.", input: newField.input };
      }
      const changed = await changePassword(currentField.input.value, newField.input.value, await currentEntries());
      return changed ? null : { message: 'Mot de passe actuel incorrect.', input: currentField.input };
    },
  });

  if (done) {
    afterChange([
      'Mot de passe changé.',
      "Les fichiers déjà exportés s'ouvrent toujours avec l'ancien mot de passe. "
        + 'Pense à exporter de nouveau ton agenda pour avoir une sauvegarde avec le nouveau.',
    ]);
  }
}

async function disable() {
  const currentField = passwordField({ label: 'Mot de passe actuel', autocomplete: 'current-password' });

  const done = await openFormDialog({
    title: 'Désactiver le mot de passe ?',
    message: [
      "Ton agenda ne sera plus chiffré : toute personne qui a accès à cet appareil pourra le lire.",
      'Pour confirmer, écris ton mot de passe actuel.',
    ],
    content: [currentField.element],
    submitLabel: 'Désactiver le mot de passe',
    danger: true,
    onSubmit: async () => {
      if (!currentField.input.value) return { message: 'Écris ton mot de passe actuel.', input: currentField.input };
      const disabled = await disablePassword(currentField.input.value, await currentEntries());
      return disabled ? null : { message: 'Mot de passe incorrect.', input: currentField.input };
    },
  });

  if (done) afterChange("Mot de passe désactivé : ton agenda n'est plus chiffré.");
}

// ---------------------------------------------------------------
// Affichage du bloc
// ---------------------------------------------------------------

function render() {
  const zone = document.getElementById('reglages-mot-de-passe');
  document.getElementById('bouton-verrouiller').hidden = !isProtected();

  // Le chiffrement n'est possible que depuis une adresse sécurisée.
  if (!isCryptoAvailable()) {
    zone.replaceChildren(
      el('p', {}, "Le mot de passe n'est pas disponible ici : il faut ouvrir Omni-Agenda depuis une adresse sécurisée (qui commence par https://)."),
    );
    return;
  }

  const button = (label, onClick, className = 'btn') => el('button', { type: 'button', class: className, onclick: onClick }, label);

  if (isProtected()) {
    zone.replaceChildren(
      el('p', {}, el('strong', {}, 'Mot de passe activé. '),
        'Ton agenda est chiffré sur cet appareil : sans le mot de passe, il est illisible.'),
      warning(),
      el('div', { class: 'button-row' },
        button('Verrouiller maintenant', lockApp, 'btn btn-primary'),
        button('Changer le mot de passe', change),
        button('Désactiver le mot de passe', disable, 'btn btn-danger'),
      ),
    );
  } else {
    zone.replaceChildren(
      el('p', {}, "Tu peux protéger ton agenda par un mot de passe. Il sera alors chiffré sur cet appareil "
        + "(illisible sans le mot de passe), et le mot de passe sera demandé à chaque ouverture d'Omni-Agenda."),
      warning(),
      el('div', { class: 'button-row' }, button('Activer un mot de passe', enable, 'btn btn-primary')),
    );
  }
}

export function initPasswordSettings() {
  document.getElementById('bouton-verrouiller').addEventListener('click', lockApp);
  render();
}
