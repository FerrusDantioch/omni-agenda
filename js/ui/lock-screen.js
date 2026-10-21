// =============================================================
// ui/lock-screen.js — L'écran de verrouillage
// -------------------------------------------------------------
// Si un mot de passe est actif, cet écran s'affiche à l'ouverture
// de l'application. Le reste de l'application (barre du haut,
// agenda, réglages) reste caché tant que le bon mot de passe n'a
// pas été donné : l'attribut data-locked sur <html> s'en charge
// (voir css/security.css).
//
// « J'ai oublié mon mot de passe » : personne ne peut récupérer les
// données. La seule solution est de tout effacer sur cet appareil.
// =============================================================

import { el, setText } from './dom.js';
import { confirmAction } from './dialogs.js';
import { passwordField } from './password-field.js';
import { eraseEverything, unlock } from '../security.js';
import { isCryptoAvailable } from '../crypto.js';

const WARNING = 'Si tu perds ton mot de passe, personne ne peut récupérer les données.';

/** Affiche ou cache l'écran de verrouillage. */
export function setLocked(locked) {
  document.documentElement.toggleAttribute('data-locked', locked);
}

/** Partie « J'ai oublié mon mot de passe » : explication et effacement complet. */
function forgottenSection() {
  const eraseButton = el('button', { type: 'button', class: 'btn btn-danger' }, "Effacer l'agenda et repartir de zéro");
  eraseButton.addEventListener('click', async () => {
    const confirmed = await confirmAction({
      title: 'Tout effacer ?',
      message: [
        'Tous tes rendez-vous et toutes tes tâches seront effacés définitivement de cet appareil, ainsi que le mot de passe.',
        "Cette action ne peut pas être annulée. Tes réglages d'apparence sont gardés.",
      ],
      confirmLabel: 'Tout effacer',
      danger: true,
    });
    if (!confirmed) return;
    eraseButton.disabled = true;
    try {
      await eraseEverything();
      // On repart de l'agenda (vide), avec son message de bienvenue.
      window.history.replaceState(null, '', '#/');
      window.location.reload();
    } catch (error) {
      console.error(error);
      eraseButton.disabled = false;
    }
  });

  return el('details', { class: 'lock-forgot' },
    el('summary', {}, "J'ai oublié mon mot de passe"),
    el('p', {}, WARNING),
    el('p', {}, "La seule solution est d'effacer l'agenda de cet appareil et de repartir d'un agenda vide."),
    el('p', {}, "Si tu as exporté ton agenda dans un fichier, tu pourras ensuite l'importer (avec le mot de passe qui était actif au moment de l'export)."),
    eraseButton,
  );
}

/**
 * Affiche l'écran de verrouillage et attend le bon mot de passe.
 * Renvoie une promesse, tenue une fois l'agenda déverrouillé.
 */
export function showLockScreen() {
  setLocked(true);
  const zone = document.getElementById('verrouillage-formulaire');

  // Sans outils de chiffrement (adresse non sécurisée), impossible d'ouvrir l'agenda ici.
  if (!isCryptoAvailable()) {
    zone.replaceChildren(
      el('p', { class: 'notice notice-error' },
        "Impossible d'ouvrir ton agenda ici : le déchiffrement n'est possible que depuis une adresse sécurisée (qui commence par https://)."),
    );
    return new Promise(() => {});
  }

  return new Promise((resolve) => {
    const field = passwordField({ label: 'Mot de passe', autocomplete: 'current-password' });
    const error = el('p', { class: 'field-error', role: 'alert' });
    const submit = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Déverrouiller');
    const form = el('form', { class: 'lock-form', novalidate: true }, field.element, error, submit);

    let busy = false;
    const fail = (message) => {
      setText(error, message);
      field.input.setAttribute('aria-invalid', 'true');
      field.input.focus();
      field.input.select();
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      if (!field.input.value) {
        fail('Écris ton mot de passe.');
        return;
      }
      busy = true;
      submit.disabled = true;
      submit.textContent = 'Vérification…';
      error.textContent = '';

      let unlocked = false;
      try {
        unlocked = await unlock(field.input.value);
      } catch (problem) {
        console.error(problem);
      }

      busy = false;
      submit.disabled = false;
      submit.textContent = 'Déverrouiller';
      if (!unlocked) {
        fail('Mot de passe incorrect. Réessaie.');
        return;
      }
      // Déverrouillé : on efface le champ et on cache l'écran.
      field.input.value = '';
      zone.replaceChildren();
      setLocked(false);
      resolve();
    });

    zone.replaceChildren(form, forgottenSection());
    field.input.focus();
  });
}
