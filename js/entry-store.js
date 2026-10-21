// =============================================================
// entry-store.js — La liste des entrées, en mémoire
// -------------------------------------------------------------
// Au démarrage, on lit toutes les entrées une fois et on les garde
// en mémoire : l'affichage est ainsi instantané. Chaque ajout,
// modification ou suppression est d'abord enregistré sur
// l'appareil, puis appliqué en mémoire.
//
// Les écrans peuvent « s'abonner » : ils sont prévenus à chaque
// changement pour se mettre à jour.
// =============================================================

import {
  deleteEntryRecord, getAllEntryRecords, putEntryRecord, putEntryRecords, replaceAllEntryRecords,
} from './storage.js';
import { normalizeEntry } from './entries.js';

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
  for (const record of records) {
    const entry = normalizeEntry(record);
    if (entry) loaded.set(entry.id, entry);
    else console.warn('Entrée illisible ignorée :', record?.id);
  }
  entries = loaded;
  notifyChange();
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
  await putEntryRecord(entry);
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
  await putEntryRecords(list);
  for (const entry of list) entries.set(entry.id, entry);
  notifyChange();
  announceToOtherTabs();
}

/** Remplace tout l'agenda par `list` (import « Remplacer »). Tout ou rien. */
export async function replaceAllEntries(list) {
  await replaceAllEntryRecords(list);
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
