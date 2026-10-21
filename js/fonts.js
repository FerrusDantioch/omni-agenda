// =============================================================
// fonts.js — Police d'écriture et taille du texte
// -------------------------------------------------------------
// Pour l'instant : la taille du texte. Le choix de la police
// sera ajouté à l'étape 4.
//
// Toute l'interface est mesurée en « rem » (une unité relative
// à la taille du texte) : agrandir le texte agrandit aussi les
// boutons et les espaces, sans rien casser.
// =============================================================

import { setSetting, updateAppearanceCache } from './storage.js';

/** Tailles de texte proposées (en pourcentage de la taille normale). */
export const TEXT_SIZES = [
  { id: 'normal', label: 'Normal', scale: 100 },
  { id: 'grand', label: 'Grand', scale: 115 },
  { id: 'tres-grand', label: 'Très grand', scale: 130 },
  { id: 'maximum', label: 'Maximum', scale: 150 },
];

export const DEFAULT_TEXT_SIZE = 'normal';

function findTextSize(id) {
  return TEXT_SIZES.find((size) => size.id === id) || TEXT_SIZES.find((size) => size.id === DEFAULT_TEXT_SIZE);
}

/** Applique une taille de texte à toute la page. Renvoie l'identifiant appliqué. */
export function applyTextSize(id) {
  const size = findTextSize(id);
  document.documentElement.style.fontSize = `${size.scale}%`;
  return size.id;
}

/** Mémorise la taille de texte choisie. */
export async function saveTextSize(id) {
  const size = findTextSize(id);
  updateAppearanceCache({ textScale: size.scale });
  await setSetting('textSize', size.id);
}
