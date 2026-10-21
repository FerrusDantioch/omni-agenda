// =============================================================
// app.js — Point de départ de l'application
// -------------------------------------------------------------
// Ce fichier assemble toutes les pièces :
//   1. il lit les réglages mémorisés ;
//   2. il applique le thème, la police et la taille du texte ;
//   3. il prépare les écrans et la fenêtre des entrées ;
//   4. il charge les rendez-vous et les tâches ;
//   5. il affiche l'agenda et démarre la navigation entre écrans.
// =============================================================

import { getSetting, setSetting } from './storage.js';
import { applyTheme, DEFAULT_THEME } from './themes.js';
import { applyFont, applyTextSize, DEFAULT_FONT, DEFAULT_TEXT_SIZE } from './fonts.js';
import { loadEntries } from './entry-store.js';
import { startRouter } from './router.js';
import { initSettings } from './ui/settings.js';
import { initAbout } from './ui/about.js';
import { initBackupSettings } from './ui/backup-settings.js';
import { initEntryPanel, openEntryDetails, openNewEntry } from './ui/entry-panel.js';
import { showToast } from './ui/toast.js';
import { DEFAULT_VIEW, getAgendaDate, initAgendaView } from './views/agenda-view.js';

/** Affiche un message dans le bandeau sous la barre du haut. */
function showBanner(message) {
  const banner = document.getElementById('bandeau');
  banner.textContent = message;
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
  initAbout();
  initEntryPanel();
  document.getElementById('bouton-nouveau-rdv').addEventListener('click', () =>
    openNewEntry('event', { defaultDate: getAgendaDate() }));
  document.getElementById('bouton-nouvelle-tache').addEventListener('click', () =>
    openNewEntry('task', { defaultDate: getAgendaDate() }));

  // 4. Rendez-vous et tâches.
  if (storageAvailable) {
    try {
      await loadEntries();
    } catch (error) {
      console.error('Lecture des entrées impossible :', error);
      showBanner("Impossible de lire ton agenda sur cet appareil. Recharge la page pour réessayer.");
    }
  }

  // 5. L'agenda est dessiné après le chargement : pas de clignotement.
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
}

start();
