// =============================================================
// dates.js — Affichage et calcul des dates
// -------------------------------------------------------------
// Toutes les dates sont affichées en français, dans le fuseau
// horaire de l'appareil. Les calculs (fuseaux, changements
// d'heure) seront ajoutés à l'étape 2.
// =============================================================

const longDateFormat = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Met une majuscule à la première lettre : « mercredi » → « Mercredi ». */
export function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Exemple : « Mercredi 21 octobre 2026 ». */
export function formatLongDate(date) {
  return capitalize(longDateFormat.format(date));
}
