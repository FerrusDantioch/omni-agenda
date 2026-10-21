// =============================================================
// security.js — Le mot de passe (facultatif) de l'agenda
// -------------------------------------------------------------
// Sans mot de passe, les entrées sont enregistrées telles quelles.
// Avec un mot de passe, chaque entrée est chiffrée avant d'être
// enregistrée, et déchiffrée à la lecture (voir js/crypto.js).
//
// Ce module garde en mémoire, tant que l'application est ouverte :
//  - la protection enregistrée (sel, nombre de tours, valeur de contrôle) ;
//  - la clé de chiffrement, obtenue à partir du mot de passe.
// Le mot de passe lui-même n'est gardé nulle part.
// =============================================================

import {
  PROTECTION_SETTING, eraseAgenda, getSetting, replaceProtectedData, updateAppearanceCache,
} from './storage.js';
import { createProtection, decryptJson, encryptJson, isValidProtection, openProtection } from './crypto.js';

/** Longueurs acceptées pour un nouveau mot de passe (en caractères). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

let protection = null; // la protection enregistrée, ou null s'il n'y a pas de mot de passe
let key = null; // la clé, connue seulement après le bon mot de passe

// Si le mot de passe change dans un autre onglet, cet onglet se recharge
// (et redemande le mot de passe si besoin).
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('omni-agenda-securite') : null;
if (channel) channel.onmessage = () => window.location.reload();

/** Après un changement : on met à jour l'indice lu par boot.js et on prévient les autres onglets. */
function announceChange() {
  updateAppearanceCache({ locked: protection !== null });
  channel?.postMessage('changement');
}

// ---------------------------------------------------------------
// État
// ---------------------------------------------------------------

/**
 * Lit la protection enregistrée. Renvoie vrai si un mot de passe est actif.
 * Lance une erreur si la protection enregistrée est abîmée.
 */
export async function loadProtection() {
  const saved = await getSetting(PROTECTION_SETTING, null);
  if (saved !== null && !isValidProtection(saved)) throw new Error('Protection par mot de passe illisible');
  protection = saved;
  // Indice pour boot.js : afficher tout de suite l'écran de verrouillage au prochain démarrage.
  updateAppearanceCache({ locked: protection !== null });
  return protection !== null;
}

/** Vrai si un mot de passe est actif. */
export function isProtected() {
  return protection !== null;
}

/** Essaie un mot de passe. Renvoie vrai s'il est bon (l'agenda est alors déverrouillé). */
export async function unlock(password) {
  if (!protection) return true;
  const found = await openProtection(protection, password);
  if (found) key = found;
  return Boolean(found);
}

/** Verrouille : on recharge l'application, ce qui efface la clé de la mémoire. */
export function lockApp() {
  window.history.replaceState(null, '', '#/');
  window.location.reload();
}

/**
 * Vérifie un nouveau mot de passe et sa confirmation.
 * Renvoie null si tout va bien, sinon { field: 'password' | 'confirmation', message }.
 */
export function checkNewPassword(password, confirmation) {
  const length = [...password.normalize('NFC')].length;
  if (length === 0) return { field: 'password', message: 'Écris un mot de passe.' };
  if (length < PASSWORD_MIN_LENGTH) {
    return { field: 'password', message: `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères.` };
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return { field: 'password', message: `Le mot de passe est trop long (${PASSWORD_MAX_LENGTH} caractères au maximum).` };
  }
  if (password !== confirmation) return { field: 'confirmation', message: 'Les deux mots de passe ne sont pas identiques.' };
  return null;
}

// ---------------------------------------------------------------
// Chiffrement des entrées (utilisé par js/entry-store.js)
// ---------------------------------------------------------------
// Une entrée chiffrée est enregistrée ainsi : { id, iv, data }.
// Seul l'identifiant (tiré au hasard, il ne révèle rien) reste lisible.

/** Le texte attaché au chiffrement d'une entrée : il la lie à son identifiant. */
const entryLabel = (id) => `entree:${id}`;

async function sealEntry(withKey, entry) {
  const { iv, data } = await encryptJson(withKey, entry, entryLabel(entry.id));
  return { id: entry.id, iv, data };
}

/** Vrai si un enregistrement est chiffré. */
export function isSealedRecord(record) {
  return record?.iv instanceof Uint8Array && record?.data instanceof Uint8Array;
}

/** Prépare une entrée pour l'enregistrement (chiffrée si un mot de passe est actif). */
export function entryToRecord(entry) {
  if (!protection) return Promise.resolve(entry);
  if (!key) return Promise.reject(new Error('Agenda verrouillé : enregistrement impossible.'));
  return sealEntry(key, entry);
}

/** Relit un enregistrement (en le déchiffrant si besoin). Lance une erreur s'il est illisible. */
export async function recordToEntry(record) {
  if (!isSealedRecord(record)) return record;
  if (!key) throw new Error('Agenda verrouillé : lecture impossible.');
  return decryptJson(key, record, entryLabel(record.id));
}

/**
 * Pour l'export : la clé et les réglages du calcul de la clé, si un mot de
 * passe est actif (le fichier exporté est alors chiffré), sinon null.
 */
export function getExportProtection() {
  return protection && key ? { key, kdf: protection.kdf } : null;
}

// ---------------------------------------------------------------
// Activer, changer, désactiver
// ---------------------------------------------------------------
// `entries` : toutes les entrées actuelles (en clair, depuis la mémoire).
// Chaque opération réécrit tout l'agenda en une seule transaction.

/** Active un mot de passe : tout l'agenda est chiffré. */
export async function enablePassword(password, entries) {
  const created = await createProtection(password);
  const records = await Promise.all(entries.map((entry) => sealEntry(created.key, entry)));
  await replaceProtectedData(created.protection, records);
  protection = created.protection;
  key = created.key;
  announceChange();
}

/**
 * Change le mot de passe : nouveau sel, nouvelle clé, tout est chiffré de nouveau.
 * Renvoie faux si le mot de passe actuel est incorrect (rien n'est alors modifié).
 */
export async function changePassword(currentPassword, newPassword, entries) {
  if (!protection || !(await openProtection(protection, currentPassword))) return false;
  const created = await createProtection(newPassword);
  const records = await Promise.all(entries.map((entry) => sealEntry(created.key, entry)));
  await replaceProtectedData(created.protection, records);
  protection = created.protection;
  key = created.key;
  announceChange();
  return true;
}

/**
 * Désactive le mot de passe : l'agenda est de nouveau enregistré en clair.
 * Renvoie faux si le mot de passe est incorrect (rien n'est alors modifié).
 */
export async function disablePassword(currentPassword, entries) {
  if (!protection || !(await openProtection(protection, currentPassword))) return false;
  await replaceProtectedData(null, entries);
  protection = null;
  key = null;
  announceChange();
  return true;
}

/** « Mot de passe oublié » : efface l'agenda et le mot de passe de cet appareil. */
export async function eraseEverything() {
  await eraseAgenda();
  protection = null;
  key = null;
  announceChange();
}
