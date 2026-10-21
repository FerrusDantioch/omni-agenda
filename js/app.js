// =============================================================
// app.js — Point de départ de l'application
// -------------------------------------------------------------
// Ce fichier assemble toutes les pièces :
//   1. il lit les réglages mémorisés ;
//   2. il applique le thème et la taille du texte ;
//   3. il prépare les écrans et la fenêtre des entrées ;
//   4. il charge les rendez-vous et les tâches ;
//   5. il démarre la navigation entre écrans.
// =============================================================

import { getSetting } from './storage.js';
import { applyTheme, DEFAULT_THEME } from './themes.js';
import { applyTextSize, DEFAULT_TEXT_SIZE } from './fonts.js';
import { formatLongDate } from './dates.js';
import { loadEntries } from './entry-store.js';
import { startRouter } from './router.js';
import { initSettings } from './ui/settings.js';
import { initAbout } from './ui/about.js';
import { initEntryPanel, openEntryDetails, openNewEntry } from './ui/entry-panel.js';
import { showToast } from './ui/toast.js';
import { initListView } from './views/list-view.js';

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
  const settings = { theme: DEFAULT_THEME, textSize: DEFAULT_TEXT_SIZE };
  let storageAvailable = true;
  try {
    settings.theme = await getSetting('theme', DEFAULT_THEME);
    settings.textSize = await getSetting('textSize', DEFAULT_TEXT_SIZE);
  } catch (error) {
    console.warn('Stockage indisponible :', error);
    storageAvailable = false;
    showBanner(STORAGE_WARNING);
  }

  // 2. Apparence.
  settings.theme = applyTheme(settings.theme);
  settings.textSize = applyTextSize(settings.textSize);

  // 3. Écrans.
  document.getElementById('date-du-jour').textContent = formatLongDate(new Date());
  initSettings(settings, (error) => {
    console.warn("Échec de l'enregistrement :", error);
    showBanner(STORAGE_WARNING);
  });
  initAbout();
  initEntryPanel();
  document.getElementById('bouton-nouveau-rdv').addEventListener('click', () => openNewEntry('event'));
  document.getElementById('bouton-nouvelle-tache').addEventListener('click', () => openNewEntry('task'));

  // 4. Rendez-vous et tâches.
  if (storageAvailable) {
    try {
      await loadEntries();
    } catch (error) {
      console.error('Lecture des entrées impossible :', error);
      showBanner("Impossible de lire ton agenda sur cet appareil. Recharge la page pour réessayer.");
    }
  }

  // La liste est préparée après le chargement : pas de clignotement de l'accueil.
  initListView({
    onOpen: openEntryDetails,
    onError: (error) => {
      console.error(error);
      showToast("L'enregistrement a échoué. Réessaie.");
    },
  });

  // 5. Navigation.
  startRouter();
}

start();
