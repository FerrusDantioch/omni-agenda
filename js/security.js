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
  PROTECTION_SETTING, clearShownRemindersStorage, eraseAgenda, getSetting, replaceProtectedData,
  updateAppearanceCache,
} from './storage.js';
import {
  IV_BYTES, PBKDF2_ITERATIONS, createProtection, decryptJson, encryptJson, fromBase64,
  isValidProtection, openProtection, toBase64,
} from './crypto.js';

/** Longueurs acceptées pour un nouveau mot de passe (en caractères). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

let protection = null; // la protection enregistrée, ou null s'il n'y a pas de mot de passe
let key = null; // la clé, connue seulement après le bon mot de passe
let securityReady = false;

const lockListeners = new Set();
const autoLockListeners = new Set();

// Si le mot de passe change ou si l'agenda se verrouille dans un autre onglet, on réagit.
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('omni-agenda-securite') : null;
if (channel) {
  channel.onmessage = (event) => {
    const message = event.data;
    if (message === 'changement' || message?.type === 'change') {
      key = null;
      for (const listener of lockListeners) listener();
      window.location.reload();
      return;
    }
    if (message?.type === 'lock') {
      if (isProtected() && isLocked()) return;
      lockApp({ broadcast: false });
      return;
    }
    if (message?.type === 'auto-lock-settings') {
      for (const listener of autoLockListeners) {
        listener({ minutes: message.minutes, onHide: message.onHide });
      }
    }
  };
}

/** Après un changement : on met à jour l'indice lu par boot.js et on prévient les autres onglets. */
function announceChange() {
  updateAppearanceCache({ locked: protection !== null });
  channel?.postMessage('changement');
}

/** Abonne un nettoyage lors du verrouillage (ex. : vider la mémoire des entrées). */
export function onAppLock(listener) {
  lockListeners.add(listener);
  return () => lockListeners.delete(listener);
}

/** Abonne aux changements de réglages du verrouillage automatique venant d'un autre onglet. */
export function onAutoLockSettingsChange(listener) {
  autoLockListeners.add(listener);
  return () => autoLockListeners.delete(listener);
}

/** Prévient les autres onglets qu'un réglage de verrouillage automatique a changé. */
export function announceAutoLockSettings({ minutes, onHide }) {
  channel?.postMessage({ type: 'auto-lock-settings', minutes, onHide });
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
  securityReady = true;
  // Indice pour boot.js : afficher tout de suite l'écran de verrouillage au prochain démarrage.
  updateAppearanceCache({ locked: protection !== null });
  return protection !== null;
}

/** Vrai une fois l'état de protection initial chargé. */
export function isSecurityReady() {
  return securityReady;
}

/** Vrai si un mot de passe est actif. */
export function isProtected() {
  return protection !== null;
}

/** Vrai si un mot de passe est actif et que la clé n'est pas en mémoire. */
export function isLocked() {
  return protection !== null && key === null;
}

/** Vrai si un mot de passe est actif et que l'agenda est déverrouillé. */
export function isUnlocked() {
  return protection !== null && key !== null;
}

/** Essaie un mot de passe. Renvoie vrai s'il est bon (l'agenda est alors déverrouillé). */
export async function unlock(password) {
  if (!protection) return true;
  const found = await openProtection(protection, password);
  if (found) key = found;
  return Boolean(found);
}

/** Vérifie le mot de passe actuel sans modifier l'état de verrouillage. */
export async function verifyPassword(password) {
  if (!protection || typeof password !== 'string') return false;
  return Boolean(await openProtection(protection, password));
}

/** Cache immédiatement les données en mémoire et à l'écran (ex. : bfcache / verrouillage). */
export function suspendForBfcache() {
  if (!protection) return;
  key = null;
  for (const listener of lockListeners) listener();
  document.documentElement.setAttribute('data-locked', '');
  updateAppearanceCache({ locked: true });
  // Avant de fermer d'éventuels <dialog>, on neutralise l'étape d'historique modale
  // pour ne pas déclencher history.back() pendant un verrouillage.
  window.history.replaceState(null, '', '#/');
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  const toast = document.getElementById('message-flottant');
  if (toast) toast.textContent = '';
}

/** Verrouille : vide la mémoire, prévient les autres onglets et recharge l'application. */
export function lockApp({ broadcast = true } = {}) {
  if (!protection) return;
  suspendForBfcache();
  if (broadcast) channel?.postMessage({ type: 'lock' });
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
  if (!securityReady) return Promise.reject(new Error('Sécurité non initialisée : écriture impossible.'));
  if (!protection) return Promise.resolve(entry);
  if (!key) return Promise.reject(new Error('Agenda verrouillé : enregistrement impossible.'));
  return sealEntry(key, entry);
}

/** Relit un enregistrement (en le déchiffrant si besoin). Lance une erreur s'il est illisible. */
export async function recordToEntry(record) {
  if (!securityReady) throw new Error('Sécurité non initialisée : lecture impossible.');
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

/** Nombre d'itérations PBKDF2 à utiliser pour l'export chiffré. */
export function getExportIterations() {
  return protection?.kdf?.iterations ?? PBKDF2_ITERATIONS;
}

/** Chiffre une donnée locale de l'application avec la clé active (renvoie { iv, data } base64 ou null). */
export async function sealAppData(value, label) {
  if (!protection || !key) return null;
  const { iv, data } = await encryptJson(key, value, label);
  return { iv: toBase64(iv), data: toBase64(data) };
}

/** Déchiffre une donnée locale scellée avec `sealAppData`. Renvoie null si invalide ou verrouillé. */
export async function unsealAppData(sealed, label) {
  if (!protection || !key) return null;
  if (!sealed || typeof sealed !== 'object' || Array.isArray(sealed)) return null;
  try {
    const iv = fromBase64(sealed.iv);
    const data = fromBase64(sealed.data);
    if (iv.length !== IV_BYTES || data.length < 16) return null;
    return await decryptJson(key, { iv, data }, label);
  } catch {
    return null;
  }
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
  clearShownRemindersStorage();
  protection = created.protection;
  key = created.key;
  securityReady = true;
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
  clearShownRemindersStorage();
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
  clearShownRemindersStorage();
  protection = null;
  key = null;
  securityReady = true;
  announceChange();
  return true;
}

/** « Mot de passe oublié » : efface l'agenda et le mot de passe de cet appareil. */
export async function eraseEverything() {
  await eraseAgenda();
  protection = null;
  key = null;
  securityReady = true;
  announceChange();
}
