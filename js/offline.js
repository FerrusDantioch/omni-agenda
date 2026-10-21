// =============================================================
// offline.js — Fonctionnement sans internet
// -------------------------------------------------------------
// Inscrit le service worker (voir sw.js à la racine du site), qui
// garde une copie complète de l'application sur l'appareil.
// Au démarrage, s'il y a internet, on lui demande de vérifier si
// une nouvelle version a été publiée.
// =============================================================

// Mêmes noms que dans sw.js.
const CACHE_PREFIX = 'omni-agenda-copie-';
const COMPLETE_MARK = './__copie-complete__';

/** Vrai si ce navigateur, à cette adresse, peut fonctionner hors ligne. */
export function isOfflineSupported() {
  return 'serviceWorker' in navigator && window.isSecureContext;
}

/**
 * Inscrit le service worker. `onUpdateReady()` est appelée quand une
 * nouvelle version a été téléchargée (elle s'appliquera au prochain
 * démarrage, ou tout de suite si l'utilisateur recharge).
 */
export async function startOffline({ onUpdateReady }) {
  if (!isOfflineSupported()) return;

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'mise-a-jour-prete') onUpdateReady();
  });

  try {
    // « updateViaCache: none » : le navigateur vérifie toujours la dernière version de sw.js.
    await navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' });
    const registration = await navigator.serviceWorker.ready;
    if (navigator.onLine) registration.active?.postMessage({ type: 'verifier-mise-a-jour' });
  } catch (error) {
    // Sans service worker, l'application fonctionne quand même (mais pas hors ligne).
    console.warn('Mode hors ligne indisponible :', error);
  }
}

/** Vrai si une copie complète de l'application est enregistrée sur l'appareil. */
export async function isOfflineReady() {
  if (!isOfflineSupported() || !('caches' in window)) return false;
  for (const name of await caches.keys()) {
    if (name.startsWith(CACHE_PREFIX) && (await (await caches.open(name)).match(COMPLETE_MARK))) return true;
  }
  return false;
}
