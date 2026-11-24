// =============================================================
// entry-store.js — La liste des entrées, en mémoire
// -------------------------------------------------------------
// Au démarrage, on lit toutes les entrées une fois et on les garde
// en mémoire : l'affichage est ainsi instantané. Chaque ajout,
// modification ou suppression est d'abord enregistré sur
// l'appareil, puis appliqué en mémoire.
//
// Si un mot de passe est actif, les entrées sont chiffrées avant
// d'être enregistrées et déchiffrées à la lecture (js/security.js).
//
// Les écrans peuvent « s'abonner » : ils sont prévenus à chaque
// changement pour se mettre à jour.
// =============================================================

import {
  deleteEntryRecord, getAllEntryRecords, putEntryRecord, putEntryRecords, replaceAllEntryRecords,
} from './storage.js';
import { normalizeEntry } from './entries.js';
import {
  entryToRecord, isLocked, isProtected, isSealedRecord, isSecurityReady, onAppLock, recordToEntry,
} from './security.js';

let entries = new Map();
let revision = 0;
let cachedSnapshot = null;
const listeners = new Set();

function markMutated() {
  revision += 1;
  cachedSnapshot = null;
}

// Si l'application est ouverte dans deux onglets, on prévient l'autre
// onglet des changements (BroadcastChannel = canal entre onglets).
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('omni-agenda-entrees') : null;
if (channel) {
  channel.onmessage = () => {
    if (!isSecurityReady() || isLocked()) return;
    loadEntries().catch((error) => console.warn('Rechargement impossible :', error));
  };
}

function notifyChange() {
  for (const listener of listeners) listener();
}

/** Vide les entrées en mémoire (lors du verrouillage). */
export function clearEntries() {
  entries = new Map();
  markMutated();
  notifyChange();
}
onAppLock(clearEntries);

function announceToOtherTabs() {
  channel?.postMessage('changement');
}

function assertEntryWriteAllowed() {
  if (!isSecurityReady()) throw new Error('Sécurité non initialisée : écriture impossible.');
  if (isLocked()) throw new Error('Agenda verrouillé : écriture impossible.');
}

/** Lit toutes les entrées depuis l'appareil. Les entrées abîmées sont ignorées. */
export async function loadEntries() {
  if (!isSecurityReady() || isLocked()) return;
  const records = await getAllEntryRecords();
  const loaded = new Map();
  const leftInClear = [];
  for (const record of records) {
    let entry = null;
    try {
      entry = normalizeEntry(await recordToEntry(record));
    } catch {
      // Déchiffrement impossible : l'entrée reste enregistrée, mais n'est pas affichée.
    }
    if (!entry) {
      console.warn('Entrée illisible ignorée :', record?.id);
      continue;
    }
    loaded.set(entry.id, entry);
    if (isProtected() && !isSealedRecord(record)) leftInClear.push(entry);
  }
  entries = loaded;
  markMutated();
  notifyChange();

  // Cas très rare : une entrée enregistrée en clair par un autre onglet au moment
  // où le mot de passe était activé. On la chiffre maintenant.
  if (leftInClear.length > 0) {
    await putEntryRecords(await Promise.all(leftInClear.map(entryToRecord)));
  }
}

/** Numéro de version en mémoire (incrémenté à chaque changement). */
export function getEntriesRevision() {
  return revision;
}

/** Liste figée et partagée de toutes les entrées (lecture seule). */
export function getEntriesSnapshot() {
  if (!cachedSnapshot) cachedSnapshot = Object.freeze([...entries.values()]);
  return cachedSnapshot;
}

/** Toutes les entrées (copie de la liste). */
export function getEntries() {
  return [...getEntriesSnapshot()];
}

/** Une entrée par son identifiant, ou null. */
export function getEntry(id) {
  return entries.get(id) ?? null;
}

/** Enregistre une entrée (nouvelle ou modifiée). */
export async function saveEntry(entry) {
  assertEntryWriteAllowed();
  await putEntryRecord(await entryToRecord(entry));
  entries.set(entry.id, entry);
  markMutated();
  notifyChange();
  announceToOtherTabs();
}

/** Supprime une entrée. */
export async function deleteEntry(id) {
  if (!isSecurityReady()) throw new Error('Sécurité non initialisée : suppression impossible.');
  if (isLocked()) throw new Error('Agenda verrouillé : suppression impossible.');
  await deleteEntryRecord(id);
  entries.delete(id);
  markMutated();
  notifyChange();
  announceToOtherTabs();
}

/** Enregistre plusieurs entrées d'un coup (import « Fusionner »). Tout ou rien. */
export async function saveEntries(list) {
  assertEntryWriteAllowed();
  await putEntryRecords(await Promise.all(list.map(entryToRecord)));
  for (const entry of list) entries.set(entry.id, entry);
  markMutated();
  notifyChange();
  announceToOtherTabs();
}

/** Remplace tout l'agenda par `list` (import « Remplacer »). Tout ou rien. */
export async function replaceAllEntries(list) {
  assertEntryWriteAllowed();
  await replaceAllEntryRecords(await Promise.all(list.map(entryToRecord)));
  entries = new Map(list.map((entry) => [entry.id, entry]));
  markMutated();
  notifyChange();
  announceToOtherTabs();
}

/** Coche ou décoche une tâche. */
export async function toggleTaskDone(id) {
  const task = getEntry(id);
  if (!task || task.type !== 'task') return;
  const now = new Date().toISOString();
  await saveEntry({ ...task, done: !task.done, doneAt: task.done ? null : now, updatedAt: now });
}

/**
 * S'abonner aux changements. `listener` est appelé à chaque changement.
 * Renvoie une fonction pour se désabonner.
 */
export function onEntriesChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
