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
//     une NOUVELLE copie complète et la met DE CÔTÉ : elle n'entre en
//     service que lorsque la personne touche « Mettre à jour ». Rien ne
//     change par surprise, même après avoir fermé l'application. Et
//     jamais un mélange d'ancienne et de nouvelle version ;
//  4. affiche les rappels (notifications) et ouvre l'application
//     quand on touche un rappel.
//
// Il ne lit et n'envoie AUCUNE donnée de l'agenda.
//
// IMPORTANT : un nouveau fichier de l'application (js, css, police,
// icône…) doit être ajouté à la liste FILES.
// =============================================================

const CACHE_PREFIX = 'omni-agenda-v';
const LEGACY_CACHE_PREFIX = 'omni-agenda-copie-';
const CACHE_VERSION = '1.1.0';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
// Marque déposée en dernier : un cache qui l'a est complet.
const COMPLETE_MARK = './__copie-complete__';
const INSTALL_CONCURRENCY = 6;

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
  'js/auto-lock.js',
  'js/backup.js',
  'js/config.js',
  'js/crypto.js',
  'js/dates.js',
  'js/entries.js',
  'js/entry-store.js',
  'js/fonts.js',
  'js/ics.js',
  'js/install.js',
  'js/notifications.js',
  'js/offline.js',
  'js/recurrence.js',
  'js/reminders.js',
  'js/router.js',
  'js/sanitize.js',
  'js/search.js',
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
  'js/ui/search-bar.js',
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
// Cache de cette version (nom immuable : aucune course entre instances)
// ---------------------------------------------------------------

let cachePromise = null;

function getCache() {
  if (!cachePromise) cachePromise = caches.open(CACHE_NAME);
  return cachePromise;
}

/** Télécharge tous les fichiers avec une concurrence bornée et pose COMPLETE_MARK en dernier. */
async function cacheAllFiles() {
  const cache = await getCache();
  if (await cache.match(COMPLETE_MARK)) return;

  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < FILES.length) {
      const path = FILES[nextIndex];
      nextIndex += 1;
      // « no-cache » : on demande au site la version actuelle du fichier.
      const response = await fetch(new Request(path, { cache: 'no-cache' }));
      if (!response.ok) throw new Error(`${path} : ${response.status}`);
      // On lit le contenu tout de suite : une réponse non lue garde sa connexion
      // occupée, et les téléchargements suivants resteraient bloqués.
      const body = await response.blob();
      await cache.put(path, new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }));
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(INSTALL_CONCURRENCY, FILES.length) }, worker),
  );
  // La marque « complète » est déposée en dernier : un cache interrompu n'est jamais marqué complet.
  await cache.put(COMPLETE_MARK, new Response('complète'));
}

// ---------------------------------------------------------------
// Vie du service worker
// ---------------------------------------------------------------

// Installation : prépare le cache versionné. Ne prend PAS le relais tout
// seul si un ancien service worker est actif (il attend « Mettre à jour »).
self.addEventListener('install', (event) => {
  event.waitUntil(cacheAllFiles());
});

// Activation : supprime les anciens caches et prend en charge les pages ouvertes.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) || name.startsWith(LEGACY_CACHE_PREFIX))
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

// Chaque fichier demandé par l'application est servi depuis le cache de cette version.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await getCache();
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // Fichier absent de la copie (ex. : la page de tests) : on le demande au site.
    try {
      return await fetch(request);
    } catch (error) {
      // Sans internet, une adresse inconnue du site ouvre la page principale.
      const page = request.mode === 'navigate' ? await cache.match('index.html') : null;
      if (page) return page;
      throw error;
    }
  })());
});

// Messages envoyés par l'application (voir js/offline.js).
self.addEventListener('message', (event) => {
  // La personne a touché « Mettre à jour » : ce service worker en attente prend le relais.
  if (event.data?.type === 'appliquer-mise-a-jour') {
    event.waitUntil(self.skipWaiting());
  }
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
