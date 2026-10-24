// =============================================================
// ui/about.js — L'écran « À propos »
// -------------------------------------------------------------
// Affiche la version et prépare le bouton du portfolio.
// Avec le lien de la licence, c'est le SEUL lien vers internet. S'il n'y a pas de
// connexion, on affiche un message au lieu d'ouvrir une page vide.
// =============================================================

import { APP_VERSION, PORTFOLIO_URL } from '../config.js';

export function initAbout() {
  for (const node of document.querySelectorAll('[data-app-version]')) {
    node.textContent = APP_VERSION;
  }

  const link = document.getElementById('lien-portfolio');
  const offlineMessage = document.getElementById('message-portfolio');

  // Sécurité : on n'accepte qu'une adresse web sécurisée (https).
  if (PORTFOLIO_URL.startsWith('https://')) {
    link.href = PORTFOLIO_URL;
  } else {
    link.hidden = true;
  }

  link.addEventListener('click', (event) => {
    if (!navigator.onLine) {
      // Pas de connexion : on n'ouvre rien, on explique.
      event.preventDefault();
      offlineMessage.hidden = false;
    } else {
      offlineMessage.hidden = true;
    }
  });

  // Dès que la connexion revient, le message disparaît.
  window.addEventListener('online', () => {
    offlineMessage.hidden = true;
  });
}
