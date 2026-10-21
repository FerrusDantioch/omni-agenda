// =============================================================
// app.js — Point de départ de l'application
// -------------------------------------------------------------
// Ce fichier assemble toutes les pièces :
//   1. il lit les réglages mémorisés ;
//   2. il applique le thème, la police et la taille du texte ;
//   3. il prépare les écrans, la fenêtre des entrées et le mode hors ligne ;
//   4. si un mot de passe est actif, il attend le bon mot de passe ;
//   5. il charge les rendez-vous et les tâches ;
//   6. il affiche l'agenda, démarre la navigation entre écrans et les rappels.
// =============================================================

import { getSetting, setSetting } from './storage.js';
import { applyTheme, DEFAULT_THEME } from './themes.js';
import { applyFont, applyTextSize, DEFAULT_FONT, DEFAULT_TEXT_SIZE } from './fonts.js';
import { loadEntries } from './entry-store.js';
import { startRouter } from './router.js';
import { initSettings } from './ui/settings.js';
import { initAbout } from './ui/about.js';
import { initBackupSettings } from './ui/backup-settings.js';
import { initPasswordSettings } from './ui/password-settings.js';
import { setLocked, showLockScreen } from './ui/lock-screen.js';
import { initAppSettings } from './ui/app-settings.js';
import { loadProtection } from './security.js';
import { startOffline } from './offline.js';
import { startReminders } from './notifications.js';
import { applyFrenchSpacing, el, setText } from './ui/dom.js';
import { initEntryPanel, openEntryDetails, openNewEntry } from './ui/entry-panel.js';
import { showToast } from './ui/toast.js';
import { DEFAULT_VIEW, getAgendaDate, initAgendaView } from './views/agenda-view.js';

/** Affiche un message dans le bandeau sous la barre du haut. */
function showBanner(message) {
  const banner = document.getElementById('bandeau');
  setText(banner, message);
  banner.hidden = false;
}

/** Une nouvelle version a été téléchargée : on le dit, sans obliger à recharger. */
function showUpdateBanner() {
  const banner = document.getElementById('bandeau');
  banner.replaceChildren(
    "Une nouvelle version d'Omni-Agenda est prête. ",
    el('button', { type: 'button', class: 'btn btn-small', onclick: () => window.location.reload() }, 'Recharger maintenant'),
  );
  banner.hidden = false;
}

const STORAGE_WARNING =
  "Ce navigateur n'autorise pas l'enregistrement (navigation privée ?). " +
  'Tes données ne seront pas mémorisées.';

async function start() {
  // 1. Lecture des réglages (avec des valeurs par défaut en cas de souci).
  const settings = { theme: DEFAULT_THEME, font: DEFAULT_FONT, textSize: DEFAULT_TEXT_SIZE, agendaView: DEFAULT_VIEW };
  let storageAvailable = true;
  try {
    settings.theme = await getSetting('theme', DEFAULT_THEME);
    settings.font = await getSetting('font', DEFAULT_FONT);
    settings.textSize = await getSetting('textSize', DEFAULT_TEXT_SIZE);
    settings.agendaView = await getSetting('agendaView', DEFAULT_VIEW);
  } catch (error) {
    console.warn('Stockage indisponible :', error);
    storageAvailable = false;
    showBanner(STORAGE_WARNING);
  }

  // Typographie française des textes écrits dans index.html (espaces insécables).
  applyFrenchSpacing(document.body);

  // 2. Apparence.
  settings.theme = applyTheme(settings.theme);
  settings.font = applyFont(settings.font);
  settings.textSize = applyTextSize(settings.textSize);

  // 3. Écrans.
  initSettings(settings, (error) => {
    console.warn("Échec de l'enregistrement :", error);
    showBanner(STORAGE_WARNING);
  });
  initBackupSettings();
  initAppSettings();
  initAbout();
  initEntryPanel();
  document.getElementById('bouton-nouveau-rdv').addEventListener('click', () =>
    openNewEntry('event', { defaultDate: getAgendaDate() }));
  document.getElementById('bouton-nouvelle-tache').addEventListener('click', () =>
    openNewEntry('task', { defaultDate: getAgendaDate() }));

  // Mode hors ligne : il ne touche à aucune donnée, il peut démarrer tout de suite.
  startOffline({ onUpdateReady: showUpdateBanner });

  // 4. Mot de passe : s'il est actif, l'agenda reste caché jusqu'au bon mot de passe.
  let wasLocked = false;
  if (storageAvailable) {
    try {
      wasLocked = await loadProtection();
    } catch (error) {
      console.error('Protection par mot de passe illisible :', error);
      setLocked(true);
      showBanner("Les réglages du mot de passe sont abîmés sur cet appareil : ton agenda ne peut pas être ouvert.");
      return;
    }
    if (wasLocked) await showLockScreen();
  }
  setLocked(false);
  initPasswordSettings();

  // 5. Rendez-vous et tâches.
  if (storageAvailable) {
    try {
      await loadEntries();
    } catch (error) {
      console.error('Lecture des entrées impossible :', error);
      showBanner("Impossible de lire ton agenda sur cet appareil. Recharge la page pour réessayer.");
    }
  }

  // 6. L'agenda est dessiné après le chargement : pas de clignotement.
  initAgendaView({
    initialView: settings.agendaView,
    onOpen: openEntryDetails,
    // « Ajouter » sur la page d'un jour : la date est proposée pour un
    // rendez-vous comme pour l'échéance d'une tâche.
    onAdd: (date) => openNewEntry('event', { defaultDate: date, defaultDueDate: date }),
    onError: (error) => {
      console.error(error);
      showToast("L'enregistrement a échoué. Réessaie.");
    },
    onViewChange: (view) => {
      setSetting('agendaView', view).catch((error) => console.warn('Vue non mémorisée :', error));
    },
  });

  startRouter();
  startReminders();
  // Après le déverrouillage, le curseur clavier va sur le contenu de l'application.
  if (wasLocked) document.getElementById('contenu').focus({ preventScroll: true });
}

start();
