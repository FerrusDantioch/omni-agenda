// =============================================================
// fonts.js — Police d'écriture et taille du texte
// -------------------------------------------------------------
// Les polices elles-mêmes sont déclarées dans css/fonts.css et
// rangées dans assets/fonts/ (aucun téléchargement).
//
// Toute l'interface est mesurée en « rem » (une unité relative
// à la taille du texte) : agrandir le texte agrandit aussi les
// boutons et les espaces, sans rien casser.
// =============================================================

import { setSetting, updateAppearanceCache } from './storage.js';

// ---------------------------------------------------------------
// Police d'écriture
// ---------------------------------------------------------------

/** Polices proposées. `id` correspond à l'attribut data-font de css/fonts.css. */
export const FONTS = [
  { id: 'systeme', label: "Police de l'appareil", description: 'La police habituelle de ton téléphone ou ordinateur' },
  { id: 'atkinson', label: 'Atkinson Hyperlegible', description: 'Lettres très distinctes, pour les personnes malvoyantes' },
  { id: 'lexend', label: 'Lexend', description: 'Espacée, pour faciliter la lecture' },
  { id: 'opendyslexic', label: 'OpenDyslexic', description: 'Pensée pour les personnes dyslexiques' },
  { id: 'andika', label: 'Andika', description: "Lettres simples, comme apprises à l'école" },
  { id: 'literata', label: 'Literata', description: 'Style livre, avec empattements' },
  { id: 'nunito', label: 'Nunito', description: 'Arrondie et douce' },
  { id: 'patrick-hand', label: 'Patrick Hand', description: 'Écriture manuscrite' },
];

export const DEFAULT_FONT = 'systeme';

function findFont(id) {
  return FONTS.find((font) => font.id === id) || FONTS.find((font) => font.id === DEFAULT_FONT);
}

/** Applique une police à toute la page. Renvoie l'identifiant appliqué. */
export function applyFont(id) {
  const font = findFont(id);
  document.documentElement.dataset.font = font.id;
  return font.id;
}

/** Mémorise la police choisie. */
export async function saveFont(id) {
  const font = findFont(id);
  updateAppearanceCache({ font: font.id });
  await setSetting('font', font.id);
}

// ---------------------------------------------------------------
// Taille du texte
// ---------------------------------------------------------------

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
