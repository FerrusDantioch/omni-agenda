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

const CACHE_PREFIX = 'omni-agenda-copie-';
// Marque déposée en dernier : une copie qui l'a est complète.
const COMPLETE_MARK = './__copie-complete__';
// Marque de la copie EN SERVICE (acceptée). Une copie complète plus récente,
// sans cette marque, est une nouvelle version qui attend « Mettre à jour ».
const IN_USE_MARK = './__copie-en-service__';

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

let copies = null; // promesse : { current, pending } (voir findCopies)

/**
 * Trouve la copie en service (`current`) et, s'il y en a une, la nouvelle
 * version qui attend « Mettre à jour » (`pending`).
 */
async function findCopies() {
  // Les noms contiennent la date de création : le tri inverse met la plus récente en premier.
  const names = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX)).sort().reverse();
  const complete = [];
  for (const name of names) {
    const cache = await caches.open(name);
    if (await cache.match(COMPLETE_MARK)) complete.push({ name, cache, inUse: Boolean(await cache.match(IN_USE_MARK)) });
  }
  let current = complete.find((copy) => copy.inUse) ?? null;
  if (!current && complete.length > 0) {
    // Copies d'avant les mises à jour « sur demande » : la plus récente était en service.
    current = complete[0];
    await current.cache.put(IN_USE_MARK, new Response('en service'));
  }
  // Une copie complète plus récente que celle en service attend l'accord de la personne.
  const pending = current && complete[0] !== current ? complete[0] : null;
  return { current, pending };
}

function getCopies() {
  if (!copies) copies = findCopies();
  return copies;
}

function getCurrentCopy() {
  return getCopies().then(({ current }) => current);
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

/** Supprime toutes les copies, sauf celles dont le nom est donné. */
async function deleteCopiesExcept(...keep) {
  for (const name of await caches.keys()) {
    if (name.startsWith(CACHE_PREFIX) && !keep.includes(name)) await caches.delete(name);
  }
}

/**
 * Enregistre une nouvelle copie complète.
 * - `inUse` vrai : elle entre en service tout de suite (toute première copie).
 * - sinon : elle est mise de côté, et attend « Mettre à jour ».
 */
async function storeNewCopy(downloaded, inUse) {
  const name = `${CACHE_PREFIX}${Date.now()}`;
  const cache = await caches.open(name);
  await Promise.all(downloaded.map(([path, response]) => cache.put(path, response)));
  if (inUse) await cache.put(IN_USE_MARK, new Response('en service'));
  // La marque « complète » est déposée en dernier : une copie interrompue n'est jamais utilisée.
  await cache.put(COMPLETE_MARK, new Response('complète'));
  const { current } = await getCopies();
  const copy = { name, cache, inUse };
  copies = Promise.resolve(inUse ? { current: copy, pending: null } : { current, pending: copy });
  // On garde la copie en service et la nouvelle ; les autres ne servent plus.
  await deleteCopiesExcept(name, ...(!inUse && current ? [current.name] : []));
}

/** « Mettre à jour » : la nouvelle copie entre en service, l'ancienne est effacée. */
async function usePendingCopy() {
  const { current, pending } = await getCopies();
  if (!pending) return Boolean(current);
  await pending.cache.put(IN_USE_MARK, new Response('en service'));
  copies = Promise.resolve({ current: { ...pending, inUse: true }, pending: null });
  await deleteCopiesExcept(pending.name);
  return true;
}

let checking = null;

/**
 * Vérifie si une nouvelle version de l'application est publiée.
 * Renvoie vrai si une nouvelle version attend « Mettre à jour ».
 * (Les fichiers inchangés ne sont pas retéléchargés : le navigateur
 * vérifie seulement auprès du site qu'ils n'ont pas bougé.)
 */
function checkForUpdate() {
  if (!checking) {
    checking = (async () => {
      const { current, pending } = await getCopies();
      const downloaded = await downloadAll();
      if (!downloaded) return Boolean(pending); // Pas d'internet : on ne sait rien de plus.
      if (!current) {
        await storeNewCopy(downloaded, true); // Une première copie n'est pas une « mise à jour ».
        return false;
      }
      if (await isSameAsCopy(current, downloaded)) {
        // Le site est revenu à la version en service : la copie mise de côté ne sert plus.
        if (pending) {
          copies = Promise.resolve({ current, pending: null });
          await deleteCopiesExcept(current.name);
        }
        return false;
      }
      if (pending && (await isSameAsCopy(pending, downloaded))) return true;
      await storeNewCopy(downloaded, false);
      return true;
    })().finally(() => {
      checking = null;
    });
  }
  return checking;
}

/** Prévient toutes les pages ouvertes d'Omni-Agenda. */
async function tellPages(message) {
  // includeUncontrolled : pendant son installation, ce service worker ne
  // contrôle encore aucune page, mais doit pouvoir les prévenir.
  for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) client.postMessage(message);
}

// ---------------------------------------------------------------
// Vie du service worker
// ---------------------------------------------------------------

// Installation (première fois, ou nouvelle version de ce fichier sw.js).
// Première fois : on prépare une copie complète AVANT de prendre le relais.
// Nouvelle version de sw.js : elle prend le relais tout de suite, mais
// continue de servir la copie en service ; les nouveaux fichiers éventuels
// sont mis de côté et attendent « Mettre à jour », comme d'habitude.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    if (await getCurrentCopy()) {
      if (await checkForUpdate()) await tellPages({ type: 'mise-a-jour-prete' });
    } else {
      const downloaded = await downloadAll();
      if (!downloaded) throw new Error('Copie hors ligne impossible pour le moment.');
      await storeNewCopy(downloaded, true);
    }
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
  // Au démarrage : une nouvelle version attend-elle déjà ? Y en a-t-il une sur le site ?
  if (event.data?.type === 'verifier-mise-a-jour') {
    event.waitUntil((async () => {
      const { pending } = await getCopies();
      if (pending) await tellPages({ type: 'mise-a-jour-prete' });
      if (event.data.online && (await checkForUpdate()) && !pending) await tellPages({ type: 'mise-a-jour-prete' });
    })());
  }
  // La personne a touché « Mettre à jour » : la nouvelle copie entre en service.
  if (event.data?.type === 'appliquer-mise-a-jour') {
    event.waitUntil(usePendingCopy().then(() => tellPages({ type: 'mise-a-jour-appliquee' })));
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
