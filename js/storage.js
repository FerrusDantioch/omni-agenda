// =============================================================
// storage.js — Enregistrement des données sur l'appareil
// -------------------------------------------------------------
// On utilise IndexedDB : une base de données intégrée au
// navigateur. Les données restent sur l'appareil, rien n'est
// envoyé sur internet.
//
// La base contient deux « rayons » (appelés object stores) :
//   - settings : les réglages (thème, taille du texte, date du dernier export,
//                protection par mot de passe…)
//   - entries  : les rendez-vous et les tâches (chiffrés si un mot de passe est actif)
// =============================================================

const DB_NAME = 'omni-agenda';
const DB_VERSION = 1;
const STORE_SETTINGS = 'settings';
const STORE_ENTRIES = 'entries';

// Clé de la petite copie des réglages d'apparence (lue par js/boot.js).
const APPEARANCE_CACHE_KEY = 'omni-agenda:apparence';

export const LAST_EXPORT_SETTING = 'lastExportAt';
export const AUTO_LOCK_MINUTES_SETTING = 'autoLockMinutes';
export const AUTO_LOCK_ON_HIDE_SETTING = 'autoLockOnHide';
export const SHOWN_REMINDERS_KEY = 'omni-agenda:rappels-affiches';
export const REMINDER_SALT_KEY = 'omni-agenda:rappels-sel';

let databasePromise = null;

/** Attache la réinitialisation de la connexion lors d'une fermeture ou d'un changement de version. */
export function bindDatabaseLifecycle(db, onClose) {
  db.onversionchange = () => {
    onClose();
    db.close();
  };
  db.onclose = () => {
    onClose();
  };
}

/**
 * Ouvre la base de données (une seule fois, puis on réutilise la connexion).
 * La première fois, le navigateur crée les « rayons » nécessaires.
 */
function openDatabase() {
  if (databasePromise) return databasePromise;

  const pending = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB indisponible'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS);
      }
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        db.createObjectStore(STORE_ENTRIES, { keyPath: 'id' });
      }
    };

    const resetIfCurrent = () => {
      if (databasePromise === pending) databasePromise = null;
    };

    request.onsuccess = () => {
      const db = request.result;
      // Si une version plus récente de l'application s'ouvre dans un autre
      // onglet, on libère la base pour ne pas la bloquer, et on oublie l'ancienne connexion.
      bindDatabaseLifecycle(db, resetIfCurrent);
      resolve(db);
    };

    request.onerror = () => reject(request.error || new Error('Ouverture IndexedDB échouée'));
    request.onblocked = () => console.warn('Base de données bloquée par un autre onglet.');
  });

  databasePromise = pending;
  // En cas d'échec, on permettra un nouvel essai plus tard.
  pending.catch(() => {
    if (databasePromise === pending) databasePromise = null;
  });
  return pending;
}

function executeTransaction(db, storeNames, mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode);
    let request;
    try {
      request = action(Array.isArray(storeNames) ? transaction : transaction.objectStore(storeNames));
    } catch (error) {
      // Une opération a échoué : on annule TOUTE la transaction,
      // pour ne jamais garder un enregistrement à moitié fait.
      transaction.abort();
      reject(error);
      return;
    }
    let result;
    if (request) {
      request.onsuccess = () => {
        result = request.result;
      };
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Opération annulée'));
  });
}

/**
 * Exécute une opération dans la base et attend qu'elle soit vraiment
 * enregistrée avant de répondre.
 *  - `storeNames` : un rayon (texte) ou plusieurs (liste) ;
 *  - `action` reçoit le rayon, ou la transaction entière s'il y en a plusieurs.
 * Une « transaction » est un groupe d'opérations fait en « tout ou rien ».
 */
async function runTransaction(storeNames, mode, action) {
  let db = await openDatabase();
  try {
    return await executeTransaction(db, storeNames, mode, action);
  } catch (error) {
    if (error?.name === 'InvalidStateError') {
      databasePromise = null;
      db = await openDatabase();
      return executeTransaction(db, storeNames, mode, action);
    }
    throw error;
  }
}

// ---------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------

/** Lit un réglage. Renvoie `defaultValue` s'il n'a jamais été enregistré. */
export async function getSetting(key, defaultValue) {
  const value = await runTransaction(STORE_SETTINGS, 'readonly', (store) => store.get(key));
  return value === undefined ? defaultValue : value;
}

/** Enregistre un réglage. */
export function setSetting(key, value) {
  return runTransaction(STORE_SETTINGS, 'readwrite', (store) => store.put(value, key));
}

// ---------------------------------------------------------------
// Entrées (rendez-vous et tâches)
// ---------------------------------------------------------------

/** Lit toutes les entrées enregistrées. */
export async function getAllEntryRecords() {
  return (await runTransaction(STORE_ENTRIES, 'readonly', (store) => store.getAll())) ?? [];
}

/** Enregistre une entrée (la crée ou la remplace si elle existe déjà). */
export function putEntryRecord(record) {
  return runTransaction(STORE_ENTRIES, 'readwrite', (store) => store.put(record));
}

/** Supprime une entrée par son identifiant. */
export function deleteEntryRecord(id) {
  return runTransaction(STORE_ENTRIES, 'readwrite', (store) => store.delete(id));
}

/**
 * Enregistre plusieurs entrées d'un seul coup (import « Fusionner »).
 * C'est « tout ou rien » : si une seule échoue, aucune n'est enregistrée.
 */
export function putEntryRecords(records) {
  return runTransaction(STORE_ENTRIES, 'readwrite', (store) => {
    for (const record of records) store.put(record);
  });
}

/**
 * Remplace TOUTES les entrées par `records` (import « Remplacer »).
 * L'effacement et l'ajout se font dans la même transaction : en cas
 * de problème, rien n'est effacé.
 */
export function replaceAllEntryRecords(records) {
  return runTransaction(STORE_ENTRIES, 'readwrite', (store) => {
    store.clear();
    for (const record of records) store.put(record);
  });
}

// ---------------------------------------------------------------
// Mot de passe (voir js/security.js)
// ---------------------------------------------------------------

/** Nom du réglage qui contient la protection par mot de passe (jamais le mot de passe lui-même). */
export const PROTECTION_SETTING = 'protection';

/**
 * Remplace toutes les entrées ET la protection, en une seule transaction.
 * Sert à activer, changer ou désactiver le mot de passe : en cas de
 * problème, rien ne change (on ne garde jamais un agenda à moitié chiffré).
 * `protection` : la nouvelle protection, ou null pour la retirer.
 */
export function replaceProtectedData(protection, records) {
  return runTransaction([STORE_SETTINGS, STORE_ENTRIES], 'readwrite', (transaction) => {
    const entries = transaction.objectStore(STORE_ENTRIES);
    entries.clear();
    for (const record of records) entries.put(record);
    const settings = transaction.objectStore(STORE_SETTINGS);
    if (protection) settings.put(protection, PROTECTION_SETTING);
    else settings.delete(PROTECTION_SETTING);
  });
}

/** Supprime uniquement la liste des rappels déjà affichés (lors d'un changement de protection). */
export function clearShownRemindersStorage() {
  try {
    localStorage.removeItem(SHOWN_REMINDERS_KEY);
  } catch {
    // Stockage bloqué : sans gravité.
  }
}

/** Supprime la liste des rappels affichés ainsi que le sel associé. */
export function clearReminderStorage() {
  try {
    localStorage.removeItem(SHOWN_REMINDERS_KEY);
    localStorage.removeItem(REMINDER_SALT_KEY);
  } catch {
    // Stockage bloqué : sans gravité.
  }
}

/** Efface tout l'agenda, le mot de passe et les traces locales associées. Les réglages d'apparence restent. */
export async function eraseAgenda() {
  await runTransaction([STORE_SETTINGS, STORE_ENTRIES], 'readwrite', (transaction) => {
    transaction.objectStore(STORE_ENTRIES).clear();
    const settings = transaction.objectStore(STORE_SETTINGS);
    settings.delete(PROTECTION_SETTING);
    settings.delete(LAST_EXPORT_SETTING);
    settings.delete(AUTO_LOCK_MINUTES_SETTING);
    settings.delete(AUTO_LOCK_ON_HIDE_SETTING);
  });
  clearReminderStorage();
}

// ---------------------------------------------------------------
// Protection contre l'effacement automatique
// ---------------------------------------------------------------
// Quand l'appareil manque de place, le navigateur peut effacer les
// données des sites. On peut lui demander de ne JAMAIS effacer
// celles d'Omni-Agenda (« stockage persistant »).

/** Vrai si les données sont protégées contre l'effacement automatique. */
export async function isStoragePersisted() {
  try {
    return Boolean(await navigator.storage?.persisted?.());
  } catch {
    return false;
  }
}

/** Demande la protection. Renvoie vrai si le navigateur l'accorde. */
export async function requestPersistentStorage() {
  try {
    return Boolean(await navigator.storage?.persist?.());
  } catch {
    return false;
  }
}

/** Espace utilisé par Omni-Agenda sur l'appareil (en octets), ou null si inconnu. */
export async function getStorageUsage() {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return typeof estimate?.usage === 'number' ? estimate.usage : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------
// Copie rapide des réglages d'apparence (pour js/boot.js)
// ---------------------------------------------------------------

/** Met à jour la copie rapide (ex. : { theme: 'light' }). */
export function updateAppearanceCache(changes) {
  try {
    const current = JSON.parse(localStorage.getItem(APPEARANCE_CACHE_KEY) || '{}');
    localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify({ ...current, ...changes }));
  } catch {
    // Stockage bloqué (navigation privée stricte) : sans gravité.
  }
}
