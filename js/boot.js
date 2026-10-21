// =============================================================
// boot.js — Tout premier script exécuté
// -------------------------------------------------------------
// Il s'exécute AVANT l'affichage de la page, pour appliquer tout
// de suite le thème et la taille de texte mémorisés. Sans lui, la
// page apparaîtrait une fraction de seconde avec le mauvais thème
// (un « flash » de lumière désagréable).
//
// Il lit une petite copie des réglages d'apparence gardée dans
// « localStorage » (un mini-stockage du navigateur, rapide à lire).
// Les vrais réglages sont dans IndexedDB (voir js/storage.js).
// =============================================================
(function () {
  'use strict';
  try {
    var saved = JSON.parse(window.localStorage.getItem('omni-agenda:apparence') || 'null');
    if (!saved || typeof saved !== 'object') return;

    if (['omni', 'dark', 'light'].indexOf(saved.theme) !== -1) {
      document.documentElement.setAttribute('data-theme', saved.theme);
    }
    if (typeof saved.textScale === 'number' && saved.textScale >= 80 && saved.textScale <= 200) {
      document.documentElement.style.fontSize = saved.textScale + '%';
    }
  } catch (erreur) {
    // Rien de grave : on garde simplement le thème par défaut.
  }
})();
