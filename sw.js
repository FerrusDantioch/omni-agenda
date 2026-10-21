// =============================================================
// sw.js — Le « service worker » : Omni-Agenda sans internet
// -------------------------------------------------------------
// Un service worker est un petit programme que le navigateur garde
// en tâche de fond. Celui-ci :
//  1. enregistre une copie complète de l'application sur l'appareil
//     (la liste FILES ci-dessous) ;
//  2. sert ensuite chaque fichier depuis cette copie : l'application
//     s'ouvre instantanément, avec ou sans internet ;
//  3. vérifie, quand l'application le demande et s'il y a internet,
//     si les fichiers ont changé sur le site. Si oui, il télécharge
//     une NOUVELLE copie complète, et ne l'utilise qu'une fois
//     entière : jamais un mélange d'ancienne et de nouvelle version ;
//  4. affiche les rappels (notifications) et ouvre l'application
//     quand on touche un rappel.
//
// Il ne lit et n'envoie AUCUNE donnée de l'agenda.
//
// IMPORTANT : un nouveau fichier de l'application (js, css, police,
// icône…) doit être ajouté à la liste FILES.
// =============================================================

const CACHE_PREFIX = 'omni-agenda-copie-';
// Marque déposée en dernier : une copie qui l'a est complète.
const COMPLETE_MARK = './__copie-complete__';

const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  // Styles
  'css/themes.css',
  'css/fonts.css',
  'css/base.css',
  'css/components.css',
  'css/forms.css',
  'css/entries.css',
  'css/agenda.css',
  'css/paper.css',
  'css/security.css',
  // Programme
  'js/boot.js',
  'js/app.js',
  'js/backup.js',
  'js/config.js',
  'js/crypto.js',
  'js/dates.js',
  'js/entries.js',
  'js/entry-store.js',
  'js/fonts.js',
  'js/install.js',
  'js/notifications.js',
  'js/offline.js',
  'js/reminders.js',
  'js/router.js',
  'js/sanitize.js',
  'js/security.js',
  'js/storage.js',
  'js/themes.js',
  'js/ui/about.js',
  'js/ui/app-settings.js',
  'js/ui/backup-settings.js',
  'js/ui/dialogs.js',
  'js/ui/dom.js',
  'js/ui/editor.js',
  'js/ui/entry-details.js',
  'js/ui/entry-form.js',
  'js/ui/entry-item.js',
  'js/ui/entry-panel.js',
  'js/ui/lock-screen.js',
  'js/ui/password-field.js',
  'js/ui/password-settings.js',
  'js/ui/settings.js',
  'js/ui/toast.js',
  'js/views/agenda-data.js',
  'js/views/agenda-view.js',
  'js/views/book.js',
  'js/views/day-view.js',
  'js/views/month-view.js',
  'js/views/page-parts.js',
  'js/views/week-view.js',
  // Icônes
  'assets/icons/logo.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/badge-96.png',
  // Polices
  'assets/fonts/andika-400.woff2',
  'assets/fonts/andika-700.woff2',
  'assets/fonts/atkinson-400.woff2',
  'assets/fonts/atkinson-700.woff2',
  'assets/fonts/lexend-400.woff2',
  'assets/fonts/lexend-700.woff2',
  'assets/fonts/literata-400.woff2',
  'assets/fonts/literata-700.woff2',
  'assets/fonts/nunito-400.woff2',
  'assets/fonts/nunito-700.woff2',
  'assets/fonts/opendyslexic-400.woff2',
  'assets/fonts/opendyslexic-700.woff2',
  'assets/fonts/patrick-hand-400.woff2',
];

// ---------------------------------------------------------------
// Les copies de l'application
// ---------------------------------------------------------------

let currentCopy = null; // promesse : la copie complète la plus récente (ou null)

/** Trouve la copie complète la plus récente. */
async function findCurrentCopy() {
  // Les noms contiennent la date de création : le tri inverse met la plus récente en premier.
  const names = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX)).sort().reverse();
  for (const name of names) {
    const cache = await caches.open(name);
    if (await cache.match(COMPLETE_MARK)) return { name, cache };
  }
  return null;
}

function getCurrentCopy() {
  if (!currentCopy) currentCopy = findCurrentCopy();
  return currentCopy;
}

/** Télécharge tous les fichiers. Renvoie la liste [fichier, réponse], ou null si un seul échoue. */
async function downloadAll() {
  try {
    return await Promise.all(FILES.map(async (path) => {
      // « no-cache » : on demande au site la version actuelle du fichier.
      const response = await fetch(new Request(path, { cache: 'no-cache' }));
      if (!response.ok) throw new Error(`${path} : ${response.status}`);
      // On lit le contenu tout de suite : une réponse non lue garde sa connexion
      // occupée, et les téléchargements suivants resteraient bloqués.
      return [path, new Response(await response.blob(), { headers: response.headers })];
    }));
  } catch {
    return null; // Pas d'internet, ou site injoignable : on garde la copie actuelle.
  }
}

/** Vrai si deux réponses ont exactement le même contenu. */
async function sameContent(a, b) {
  const [first, second] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  if (first.byteLength !== second.byteLength) return false;
  const x = new Uint8Array(first);
  const y = new Uint8Array(second);
  for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return false;
  return true;
}

/** Vrai si les fichiers téléchargés sont identiques à ceux de la copie. */
async function isSameAsCopy(copy, downloaded) {
  for (const [path, response] of downloaded) {
    const cached = await copy.cache.match(path);
    if (!cached || !(await sameContent(cached, response.clone()))) return false;
  }
  return true;
}

/** Enregistre une nouvelle copie complète, puis efface les anciennes. */
async function storeNewCopy(downloaded) {
  const name = `${CACHE_PREFIX}${Date.now()}`;
  const cache = await caches.open(name);
  await Promise.all(downloaded.map(([path, response]) => cache.put(path, response)));
  // La marque est déposée en dernier : une copie interrompue n'est jamais utilisée.
  await cache.put(COMPLETE_MARK, new Response('complète'));
  currentCopy = Promise.resolve({ name, cache });
  for (const other of await caches.keys()) {
    if (other.startsWith(CACHE_PREFIX) && other !== name) await caches.delete(other);
  }
}

let checking = null;

/**
 * Vérifie si une nouvelle version de l'application est publiée.
 * (Les fichiers inchangés ne sont pas retéléchargés : le navigateur
 * vérifie seulement auprès du site qu'ils n'ont pas bougé.)
 * Renvoie vrai si une nouvelle copie a été enregistrée.
 */
function checkForUpdate() {
  if (!checking) {
    checking = (async () => {
      const copy = await getCurrentCopy();
      const downloaded = await downloadAll();
      if (!downloaded) return false;
      if (copy && (await isSameAsCopy(copy, downloaded))) return false;
      await storeNewCopy(downloaded);
      return Boolean(copy); // Une première copie n'est pas une « mise à jour ».
    })().finally(() => {
      checking = null;
    });
  }
  return checking;
}

// ---------------------------------------------------------------
// Vie du service worker
// ---------------------------------------------------------------

// Installation (première fois, ou nouvelle version de ce fichier sw.js) :
// on prépare une copie complète AVANT de prendre le relais.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const downloaded = await downloadAll();
    if (!downloaded) throw new Error('Copie hors ligne impossible pour le moment.');
    await storeNewCopy(downloaded);
    await self.skipWaiting();
  })());
});

// Activation : le service worker prend en charge les pages déjà ouvertes.
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Chaque fichier demandé par l'application est servi depuis la copie.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const copy = await getCurrentCopy();
    const cached = copy ? await copy.cache.match(request, { ignoreSearch: true }) : null;
    if (cached) return cached;
    // Fichier absent de la copie (ex. : la page de tests) : on le demande au site.
    try {
      return await fetch(request);
    } catch (error) {
      // Sans internet, une adresse inconnue du site ouvre la page principale.
      const page = request.mode === 'navigate' && copy ? await copy.cache.match('index.html') : null;
      if (page) return page;
      throw error;
    }
  })());
});

// Messages envoyés par l'application (voir js/offline.js).
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'verifier-mise-a-jour') return;
  event.waitUntil(checkForUpdate().then(async (updated) => {
    if (!updated) return;
    for (const client of await self.clients.matchAll({ type: 'window' })) {
      client.postMessage({ type: 'mise-a-jour-prete' });
    }
  }));
});

// ---------------------------------------------------------------
// Rappels
// ---------------------------------------------------------------

// On touche un rappel : on revient sur Omni-Agenda (ou on l'ouvre).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.length > 0) return windows[0].focus();
    return self.clients.openWindow('./#/');
  })());
});
