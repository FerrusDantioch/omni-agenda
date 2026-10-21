// =============================================================
// storage.js — Enregistrement des données sur l'appareil
// -------------------------------------------------------------
// On utilise IndexedDB : une base de données intégrée au
// navigateur. Les données restent sur l'appareil, rien n'est
// envoyé sur internet.
//
// La base contient deux « rayons » (appelés object stores) :
//   - settings : les réglages (thème, taille du texte…)
//   - entries  : les rendez-vous et les tâches (étape 2)
// =============================================================

const DB_NAME = 'omni-agenda';
const DB_VERSION = 1;
const STORE_SETTINGS = 'settings';
const STORE_ENTRIES = 'entries';

// Clé de la petite copie des réglages d'apparence (lue par js/boot.js).
const APPEARANCE_CACHE_KEY = 'omni-agenda:apparence';

let databasePromise = null;

/**
 * Ouvre la base de données (une seule fois, puis on réutilise la connexion).
 * La première fois, le navigateur crée les « rayons » nécessaires.
 */
function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
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

    request.onsuccess = () => {
      const db = request.result;
      // Si une version plus récente de l'application s'ouvre dans un autre
      // onglet, on libère la base pour ne pas la bloquer.
      db.onversionchange = () => db.close();
      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });

  // En cas d'échec, on permettra un nouvel essai plus tard.
  databasePromise.catch(() => {
    databasePromise = null;
  });
  return databasePromise;
}

/**
 * Exécute une opération dans un « rayon » de la base et attend
 * qu'elle soit vraiment enregistrée avant de répondre.
 */
async function runTransaction(storeName, mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
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
