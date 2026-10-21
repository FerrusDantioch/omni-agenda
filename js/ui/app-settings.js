// =============================================================
// ui/app-settings.js — Blocs « Rappels » et « Application »
// -------------------------------------------------------------
// Rappels : autoriser les notifications, tester un rappel.
// Application : installation, fonctionnement sans internet,
// protection des données contre l'effacement automatique.
// =============================================================

import { el, showNotice } from './dom.js';
import {
  askNotificationPermission, checkRemindersNow, notificationPermission, showTestNotification,
} from '../notifications.js';
import { canPromptInstall, isInstalled, onInstallChange, promptInstall } from '../install.js';
import { isOfflineReady, isOfflineSupported } from '../offline.js';
import { getStorageUsage, isStoragePersisted, requestPersistentStorage } from '../storage.js';

const button = (label, onClick, className = 'btn') => el('button', { type: 'button', class: className, onclick: onClick }, label);

/** Une ligne d'état avec une coche (ex. : « ✓ Les rappels sont autorisés. »). */
const okLine = (text) => el('p', { class: 'status-line' }, el('span', { class: 'status-ok', 'aria-hidden': 'true' }, '✓'), ` ${text}`);

/** « 850 Ko », « 1,4 Mo ». */
function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
}

// ---------------------------------------------------------------
// Rappels
// ---------------------------------------------------------------

function reminderMessage(text) {
  showNotice(document.getElementById('message-rappels'), text);
}

function renderReminders() {
  const zone = document.getElementById('reglages-rappels');
  const permission = notificationPermission();

  if (permission === 'unsupported') {
    zone.replaceChildren(el('p', {},
      "Ce navigateur, à cette adresse, ne peut pas afficher de rappels. Il faut une adresse sécurisée (qui commence par https://) et un navigateur récent."));
    return;
  }
  if (permission === 'granted') {
    zone.replaceChildren(
      okLine('Les rappels sont autorisés.'),
      el('div', { class: 'button-row' }, button('Tester un rappel', async () => {
        try {
          await showTestNotification();
          reminderMessage("Un exemple de rappel vient de s'afficher. Si tu ne le vois pas, vérifie les réglages de notification de ton appareil.");
        } catch (error) {
          console.warn(error);
          reminderMessage("L'exemple n'a pas pu s'afficher. Vérifie les réglages de notification de ton appareil.");
        }
      })),
    );
    return;
  }
  if (permission === 'denied') {
    zone.replaceChildren(
      el('p', {}, 'Les rappels sont bloqués pour Omni-Agenda.'),
      el('p', { class: 'muted small' },
        "Pour les autoriser : ouvre les réglages du site dans ton navigateur (souvent l'icône à gauche de l'adresse), "
        + 'puis « Notifications » → « Autoriser ». Sur une application installée : réglages du téléphone → Applications → Omni-Agenda → Notifications.'),
    );
    return;
  }
  zone.replaceChildren(el('div', { class: 'button-row' }, button('Autoriser les rappels', async () => {
    const result = await askNotificationPermission();
    renderReminders();
    if (result === 'granted') {
      reminderMessage('Les rappels sont autorisés.');
      checkRemindersNow();
    } else {
      reminderMessage("Les rappels n'ont pas été autorisés. Tu pourras changer d'avis plus tard.");
    }
  }, 'btn btn-primary')));
}

// ---------------------------------------------------------------
// Application : installation, hors ligne, stockage
// ---------------------------------------------------------------

function appMessage(text) {
  showNotice(document.getElementById('message-application'), text);
}

function installSection() {
  const title = el('h3', {}, 'Installation');
  if (isInstalled()) return [title, okLine('Omni-Agenda est installée sur cet appareil.')];
  const intro = el('p', {},
    "Installée, Omni-Agenda a son icône sur l'écran d'accueil (ou dans le menu de l'ordinateur) et s'ouvre dans sa propre fenêtre.");
  if (canPromptInstall()) {
    return [title, intro, el('div', { class: 'button-row' }, button('Installer Omni-Agenda', async () => {
      const accepted = await promptInstall();
      appMessage(accepted ? 'Installation en cours : Omni-Agenda va apparaître avec les autres applications.' : 'Installation annulée.');
      renderApplication();
    }, 'btn btn-primary'))];
  }
  return [title, intro, el('ul', { class: 'install-steps' },
    el('li', {}, 'Android (Chrome) : menu ⋮ en haut à droite, puis « Installer l\'application » ou « Ajouter à l\'écran d\'accueil ».'),
    el('li', {}, 'iPhone ou iPad (Safari) : bouton Partager, puis « Sur l\'écran d\'accueil ».'),
    el('li', {}, "Ordinateur (Chrome ou Edge) : icône d'installation à droite de la barre d'adresse."),
  )];
}

async function offlineSection() {
  const title = el('h3', {}, 'Sans internet');
  if (!isOfflineSupported()) {
    return [title, el('p', {}, "Le mode hors ligne n'est pas disponible ici : il faut ouvrir Omni-Agenda depuis une adresse sécurisée (qui commence par https://).")];
  }
  if (await isOfflineReady()) {
    return [title, okLine('Omni-Agenda fonctionne sans internet : une copie complète est enregistrée sur cet appareil.')];
  }
  return [title, el('p', {}, "Préparation du mode hors ligne… Il faut être connecté à internet la toute première fois.")];
}

async function storageSection() {
  const title = el('h3', {}, 'Stockage');
  const usage = await getStorageUsage();
  const usageLine = usage === null ? null : el('p', { class: 'muted small' }, `Espace utilisé par Omni-Agenda : ${formatSize(usage)}.`);

  if (await isStoragePersisted()) {
    return [title, okLine("Tes données sont protégées : le navigateur ne les effacera pas, même s'il manque de place."), usageLine];
  }
  return [
    title,
    el('p', {}, "Si l'appareil manque de place, le navigateur pourrait effacer les données d'Omni-Agenda. Tu peux lui demander de ne jamais le faire."),
    el('div', { class: 'button-row' }, button('Protéger mes données', async () => {
      const granted = await requestPersistentStorage();
      await renderApplication();
      appMessage(granted
        ? 'Tes données sont maintenant protégées contre l\'effacement automatique.'
        : "Le navigateur n'a pas accordé cette protection pour le moment. Installer Omni-Agenda aide souvent à l'obtenir. "
          + 'Pense aussi à exporter ton agenda de temps en temps.');
    })),
    usageLine,
  ];
}

let renderCount = 0;

async function renderApplication() {
  // Si un affichage plus récent a commencé entre-temps, celui-ci s'arrête.
  const current = ++renderCount;
  const parts = [...installSection(), ...(await offlineSection()), ...(await storageSection())];
  if (current !== renderCount) return;
  document.getElementById('reglages-application').replaceChildren(...parts.filter(Boolean));
}

// ---------------------------------------------------------------
// Mise en place
// ---------------------------------------------------------------

export function initAppSettings() {
  renderReminders();
  renderApplication();

  // On remet l'affichage à jour quand on ouvre les Réglages, quand le mode
  // hors ligne devient prêt, et quand l'installation devient possible.
  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#/reglages') {
      renderReminders();
      renderApplication();
    }
  });
  if (isOfflineSupported()) navigator.serviceWorker.addEventListener('controllerchange', renderApplication);
  onInstallChange(renderApplication);

  // Application installée : le navigateur accorde en général la protection des données sans rien demander.
  if (isInstalled()) requestPersistentStorage().then(renderApplication);
}
