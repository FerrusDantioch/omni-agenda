// =============================================================
// backup.js — Le fichier de sauvegarde (export et import)
// -------------------------------------------------------------
// Exporter = écrire tout l'agenda dans un fichier « .json »
// (un format texte simple, lisible par n'importe quel programme).
// Importer = relire ce fichier, sur cet appareil ou sur un autre.
//
// Forme du fichier :
//   {
//     "format": "omni-agenda",      ← pour reconnaître nos fichiers
//     "version": 1,                  ← version du format
//     "application": "Omni-Agenda",
//     "applicationVersion": "0.1.0",
//     "exportedAt": "2026-10-21T08:30:00.000Z",
//     "encrypted": false,
//     "entries": [ … les rendez-vous et les tâches … ]
//   }
//
// Si un mot de passe est actif, le fichier est chiffré : à la place
// de "entries", il contient "encrypted": true, les réglages du calcul
// de la clé ("kdf") et les données chiffrées ("cipher", "data").
// Il faut alors le mot de passe pour l'ouvrir (voir js/crypto.js).
//
// À l'import, on ne fait JAMAIS confiance au fichier : chaque
// entrée est vérifiée et nettoyée (voir normalizeEntry) ; les
// entrées inutilisables sont ignorées et comptées.
// =============================================================

import { APP_NAME, APP_VERSION } from './config.js';
import { normalizeEntry } from './entries.js';
import { decryptJson, deriveKey, encryptJson, fromBase64, isValidKdf, toBase64 } from './crypto.js';

export const BACKUP_FORMAT = 'omni-agenda';
export const BACKUP_VERSION = 1;

/** Taille maximale d'un fichier importé : 20 Mo (un agenda réel pèse bien moins). */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

/** Nombre maximal d'entrées dans un fichier importé. */
const MAX_BACKUP_ENTRIES = 100000;

/**
 * Erreur d'import dont le message, en français, peut être montré
 * tel quel à l'utilisateur.
 */
export class BackupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupError';
  }
}

const NOT_A_BACKUP = "Ce fichier n'est pas une sauvegarde d'Omni-Agenda.";
const DAMAGED = "Ce fichier est abîmé : il ne peut pas être lu. Essaie avec une autre sauvegarde.";

/** Texte attaché au chiffrement d'une sauvegarde (voir encryptJson). */
const BACKUP_LABEL = 'sauvegarde';

// ---------------------------------------------------------------
// Export
// ---------------------------------------------------------------

/** Nom du fichier exporté, avec la date du jour (ex. : omni-agenda-2026-10-21.json). */
export function backupFileName(dateISO) {
  return `omni-agenda-${dateISO}.json`;
}

/** Prépare le contenu du fichier de sauvegarde à partir des entrées. */
export function createBackup(entries, now = new Date()) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    application: APP_NAME,
    applicationVersion: APP_VERSION,
    exportedAt: now.toISOString(),
    encrypted: false,
    // Rangées par date de création : le fichier est plus facile à relire.
    entries: [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
  };
}

/**
 * Prépare une sauvegarde chiffrée. `protection` : { key, kdf } (voir
 * getExportProtection dans js/security.js). Seules les informations
 * générales (format, date de l'export) restent lisibles.
 */
export async function createEncryptedBackup(entries, now, { key, kdf }) {
  const { entries: sorted, ...header } = createBackup(entries, now);
  const { iv, data } = await encryptJson(key, { entries: sorted }, BACKUP_LABEL);
  return {
    ...header,
    encrypted: true,
    kdf: { ...kdf },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    data: toBase64(data),
  };
}

/** Transforme la sauvegarde en texte (avec des retraits, pour rester lisible). */
export function serializeBackup(backup) {
  return JSON.stringify(backup, null, 2);
}

// ---------------------------------------------------------------
// Import
// ---------------------------------------------------------------

/** Vrai si `a` a été modifiée plus récemment que `b`. */
function isNewer(a, b) {
  return Date.parse(a.updatedAt) > Date.parse(b.updatedAt);
}

/**
 * Vérifie et nettoie la liste des entrées d'une sauvegarde.
 * Renvoie { entries, skipped } (skipped = entrées abîmées ou en double, ignorées).
 */
function readEntries(list) {
  if (!Array.isArray(list)) throw new BackupError(DAMAGED);
  if (list.length > MAX_BACKUP_ENTRIES) {
    throw new BackupError(`Ce fichier contient trop d'éléments (plus de ${MAX_BACKUP_ENTRIES.toLocaleString('fr-FR')}).`);
  }

  // Si un même identifiant apparaît deux fois, on garde la version la plus récente.
  const byId = new Map();
  let skipped = 0;
  for (const raw of list) {
    const entry = normalizeEntry(raw);
    if (!entry) {
      skipped += 1;
      continue;
    }
    const previous = byId.get(entry.id);
    if (previous) skipped += 1;
    if (!previous || isNewer(entry, previous)) byId.set(entry.id, entry);
  }
  return { entries: [...byId.values()], skipped };
}

/** Vrai si un texte base64 donne exactement `length` octets. */
function isBase64OfLength(text, length) {
  try {
    return typeof text === 'string' && fromBase64(text).length === length;
  } catch {
    return false;
  }
}

/**
 * Lit le texte d'un fichier de sauvegarde et le vérifie.
 * Renvoie :
 *  - pour un fichier ordinaire : { encrypted: false, entries, skipped, exportedAt }
 *      entries : les entrées valides et nettoyées ;
 *      skipped : le nombre d'entrées abîmées, ignorées ;
 *      exportedAt : la date de l'export (ou null si inconnue) ;
 *  - pour un fichier chiffré : { encrypted: true, exportedAt, sealed }
 *      (il faut ensuite l'ouvrir avec decryptBackup et le mot de passe).
 * En cas de problème, lance une BackupError avec un message clair.
 */
export function parseBackup(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new BackupError('Ce fichier est vide.');
  if (text.length > MAX_BACKUP_BYTES) throw new BackupError(NOT_A_BACKUP);

  let data;
  try {
    // Certains éditeurs de texte ajoutent un caractère invisible au début (« BOM ») : on le retire.
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new BackupError(DAMAGED);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data) || data.format !== BACKUP_FORMAT) {
    throw new BackupError(NOT_A_BACKUP);
  }
  if (!Number.isInteger(data.version) || data.version < 1) throw new BackupError(DAMAGED);
  if (data.version > BACKUP_VERSION) {
    throw new BackupError("Ce fichier vient d'une version plus récente d'Omni-Agenda. Mets l'application à jour, puis réessaie.");
  }

  const exportedAt = typeof data.exportedAt === 'string' && !Number.isNaN(Date.parse(data.exportedAt))
    ? data.exportedAt
    : null;

  if (data.encrypted === true) {
    const valid = isValidKdf(data.kdf) && data.cipher?.name === 'AES-GCM'
      && isBase64OfLength(data.cipher.iv, 12) && typeof data.data === 'string';
    if (!valid) throw new BackupError(DAMAGED);
    return { encrypted: true, exportedAt, sealed: { kdf: data.kdf, iv: data.cipher.iv, data: data.data } };
  }

  return { encrypted: false, exportedAt, ...readEntries(data.entries) };
}

/**
 * Ouvre une sauvegarde chiffrée (renvoyée par parseBackup) avec un mot de passe.
 * Renvoie la sauvegarde lisible { encrypted: false, entries, skipped, exportedAt },
 * ou null si le mot de passe est incorrect.
 * Lance une BackupError si le fichier est abîmé.
 */
export async function decryptBackup(backup, password) {
  const { kdf, iv, data } = backup.sealed;
  let sealedData;
  try {
    sealedData = fromBase64(data);
  } catch {
    throw new BackupError(DAMAGED);
  }

  const key = await deriveKey(password, fromBase64(kdf.salt), kdf.iterations);
  let content;
  try {
    content = await decryptJson(key, { iv: fromBase64(iv), data: sealedData }, BACKUP_LABEL);
  } catch {
    return null; // Mauvais mot de passe (ou fichier modifié depuis l'export).
  }

  if (!content || typeof content !== 'object') throw new BackupError(DAMAGED);
  return { encrypted: false, exportedAt: backup.exportedAt, ...readEntries(content.entries) };
}

/**
 * Prévoit le résultat d'une fusion, sans rien modifier.
 * Pour chaque entrée du fichier :
 *  - absente de l'agenda → elle sera ajoutée ;
 *  - présente, mais le fichier a une version plus récente → elle sera mise à jour ;
 *  - présente et à jour (ou plus récente sur l'appareil) → on n'y touche pas.
 * Rien n'est jamais supprimé par une fusion.
 * Renvoie { added, updated, unchanged } (listes d'entrées).
 */
export function planMerge(currentEntries, incomingEntries) {
  const current = new Map(currentEntries.map((entry) => [entry.id, entry]));
  const plan = { added: [], updated: [], unchanged: [] };
  for (const entry of incomingEntries) {
    const existing = current.get(entry.id);
    if (!existing) plan.added.push(entry);
    else if (isNewer(entry, existing)) plan.updated.push(entry);
    else plan.unchanged.push(entry);
  }
  return plan;
}

// ---------------------------------------------------------------
// Textes
// ---------------------------------------------------------------

/** Compte les rendez-vous et les tâches. */
export function countEntries(entries) {
  let events = 0;
  let tasks = 0;
  for (const entry of entries) {
    if (entry.type === 'event') events += 1;
    else tasks += 1;
  }
  return { events, tasks };
}

/** Ex. : « 3 rendez-vous et 1 tâche », « 2 tâches », « aucun rendez-vous ni aucune tâche ». */
export function describeEntries(entries) {
  const { events, tasks } = countEntries(entries);
  const parts = [];
  if (events > 0) parts.push(`${events} rendez-vous`);
  if (tasks > 0) parts.push(`${tasks} ${tasks > 1 ? 'tâches' : 'tâche'}`);
  return parts.length > 0 ? parts.join(' et ') : 'aucun rendez-vous ni aucune tâche';
}

/** Ex. : « 1 élément », « 12 éléments ». */
export function describeCount(count) {
  return `${count} ${count > 1 ? 'éléments' : 'élément'}`;
}
