// =============================================================
// app.js — Point de départ de l'application
// -------------------------------------------------------------
// Ce fichier assemble toutes les pièces :
//   1. il lit les réglages mémorisés ;
//   2. il applique le thème et la taille du texte ;
//   3. il prépare les écrans (accueil, réglages, à propos) ;
//   4. il démarre la navigation entre écrans.
// =============================================================

import { getSetting } from './storage.js';
import { applyTheme, DEFAULT_THEME } from './themes.js';
import { applyTextSize, DEFAULT_TEXT_SIZE } from './fonts.js';
import { formatLongDate } from './dates.js';
import { startRouter } from './router.js';
import { initSettings } from './ui/settings.js';
import { initAbout } from './ui/about.js';

/** Affiche un message dans le bandeau sous la barre du haut. */
function showBanner(message) {
  const banner = document.getElementById('bandeau');
  banner.textContent = message;
  banner.hidden = false;
}

const STORAGE_WARNING =
  "Ce navigateur n'autorise pas l'enregistrement (navigation privée ?). " +
  'Tes réglages ne seront pas mémorisés.';

async function start() {
  // 1. Lecture des réglages (avec des valeurs par défaut en cas de souci).
  const settings = { theme: DEFAULT_THEME, textSize: DEFAULT_TEXT_SIZE };
  try {
    settings.theme = await getSetting('theme', DEFAULT_THEME);
    settings.textSize = await getSetting('textSize', DEFAULT_TEXT_SIZE);
  } catch (error) {
    console.warn('Stockage indisponible :', error);
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

  // 4. Navigation.
  startRouter();
}

start();
