// =============================================================
// boot.js — Tout premier script exécuté
// -------------------------------------------------------------
// Il s'exécute AVANT l'affichage de la page, pour appliquer tout
// de suite le thème, la police, la taille de texte mémorisés et,
// si besoin, l'écran de verrouillage. Sans lui, la
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
    // Police : un identifiant simple (lettres et tirets), voir css/fonts.css.
    if (typeof saved.font === 'string' && /^[a-z-]{1,30}$/.test(saved.font)) {
      document.documentElement.setAttribute('data-font', saved.font);
    }
    if (typeof saved.textScale === 'number' && saved.textScale >= 80 && saved.textScale <= 200) {
      document.documentElement.style.fontSize = saved.textScale + '%';
    }
    // Mot de passe actif : l'écran de verrouillage s'affiche tout de suite,
    // l'agenda reste caché. (Ce n'est qu'un indice d'affichage : la vraie
    // vérification se fait dans js/app.js.)
    if (saved.locked === true) {
      document.documentElement.setAttribute('data-locked', '');
    }
  } catch {
    // Rien de grave : on garde simplement le thème par défaut.
  }
})();
