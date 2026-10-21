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
import { entryToRecord, isProtected, isSealedRecord, recordToEntry } from './security.js';

let entries = new Map();
const listeners = new Set();

// Si l'application est ouverte dans deux onglets, on prévient l'autre
// onglet des changements (BroadcastChannel = canal entre onglets).
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('omni-agenda-entrees') : null;
if (channel) {
  channel.onmessage = () => {
    loadEntries().catch((error) => console.warn('Rechargement impossible :', error));
  };
}

function notifyChange() {
  for (const listener of listeners) listener();
}

function announceToOtherTabs() {
  channel?.postMessage('changement');
}

/** Lit toutes les entrées depuis l'appareil. Les entrées abîmées sont ignorées. */
export async function loadEntries() {
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
  notifyChange();

  // Cas très rare : une entrée enregistrée en clair par un autre onglet au moment
  // où le mot de passe était activé. On la chiffre maintenant.
  if (leftInClear.length > 0) {
    await putEntryRecords(await Promise.all(leftInClear.map(entryToRecord)));
  }
}

/** Toutes les entrées (copie de la liste). */
export function getEntries() {
  return [...entries.values()];
}

/** Une entrée par son identifiant, ou null. */
export function getEntry(id) {
  return entries.get(id) ?? null;
}

/** Enregistre une entrée (nouvelle ou modifiée). */
export async function saveEntry(entry) {
  await putEntryRecord(await entryToRecord(entry));
  entries.set(entry.id, entry);
  notifyChange();
  announceToOtherTabs();
}

/** Supprime une entrée. */
export async function deleteEntry(id) {
  await deleteEntryRecord(id);
  entries.delete(id);
  notifyChange();
  announceToOtherTabs();
}

/** Enregistre plusieurs entrées d'un coup (import « Fusionner »). Tout ou rien. */
export async function saveEntries(list) {
  await putEntryRecords(await Promise.all(list.map(entryToRecord)));
  for (const entry of list) entries.set(entry.id, entry);
  notifyChange();
  announceToOtherTabs();
}

/** Remplace tout l'agenda par `list` (import « Remplacer »). Tout ou rien. */
export async function replaceAllEntries(list) {
  await replaceAllEntryRecords(await Promise.all(list.map(entryToRecord)));
  entries = new Map(list.map((entry) => [entry.id, entry]));
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
