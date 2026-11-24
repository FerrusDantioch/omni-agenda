// =============================================================
// notifications.js — Afficher les rappels
// -------------------------------------------------------------
// Toutes les 30 secondes (et à chaque changement de l'agenda), on
// regarde s'il y a un rappel à afficher (voir js/reminders.js).
// Le rappel est une notification du système, discrète et SANS son.
//
// Limite : sans serveur, une application web ne peut afficher un
// rappel que si elle est ouverte, ou encore active en arrière-plan.
//
// Pour ne pas afficher deux fois le même rappel (même entre plusieurs
// onglets ouverts), on garde la liste des rappels déjà affichés :
//  - hachée avec un sel propre à l'appareil (SHA-256) ;
//  - chiffrée avec la clé de l'agenda lorsqu'un mot de passe est actif.
// =============================================================

import { getEntriesSnapshot, onEntriesChange } from './entry-store.js';
import { getDueReminders, reminderText } from './reminders.js';
import { isLocked, isProtected, sealAppData, unsealAppData } from './security.js';
import { REMINDER_SALT_KEY, SHOWN_REMINDERS_KEY } from './storage.js';
import { fromBase64, randomBytes, toBase64 } from './crypto.js';

const CHECK_EVERY_MS = 30 * 1000;
const MAX_REMEMBERED = 300;
const REMINDER_SEAL_LABEL = 'rappels-affiches';
const ICON = 'assets/icons/icon-192.png';
const BADGE = 'assets/icons/badge-96.png';

const channel = 'BroadcastChannel' in window ? new BroadcastChannel('omni-agenda-rappels') : null;
let fallbackSalt = null;
let shownCache = [];
let shownMode = null;

// ---------------------------------------------------------------
// Autorisation
// ---------------------------------------------------------------

/** Vrai si ce navigateur, à cette adresse, sait afficher des rappels. */
export function areNotificationsSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator && window.isSecureContext;
}

/** 'granted' (autorisés), 'denied' (bloqués), 'default' (pas encore demandé) ou 'unsupported'. */
export function notificationPermission() {
  return areNotificationsSupported() ? Notification.permission : 'unsupported';
}

/** Demande l'autorisation d'afficher des rappels. Renvoie la nouvelle autorisation. */
export async function askNotificationPermission() {
  if (!areNotificationsSupported()) return 'unsupported';
  try {
    await Notification.requestPermission();
  } catch {
    // Ancien navigateur : la permission reste simplement inchangée.
  }
  return Notification.permission;
}

// ---------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------

/** Affiche une notification (par le service worker : obligatoire sur Android). */
async function showNotification(title, body, tag) {
  const options = { body, tag, silent: true, icon: ICON, badge: BADGE, lang: 'fr' };
  const registration = await navigator.serviceWorker.getRegistration();
  if (registration?.active) {
    await registration.showNotification(title, options);
  } else {
    // Sans service worker (cas rare, sur ordinateur) : notification simple.
    new Notification(title, options);
  }
}

/** Affiche un exemple, pour vérifier que les rappels fonctionnent. */
export function showTestNotification() {
  return showNotification('Exemple de rappel', "Les rappels d'Omni-Agenda ressembleront à ceci.", 'rappel-exemple');
}

// ---------------------------------------------------------------
// Rappels déjà affichés (sel propre + chiffrement + synchro multi-onglets)
// ---------------------------------------------------------------

/** Empreinte SHA-256 salée (16 octets hex) identifiant un rappel sans le révéler. */
export async function hashReminderKey(key, saltBytes) {
  const encodedKey = new TextEncoder().encode(key);
  const payload = new Uint8Array(saltBytes.length + 1 + encodedKey.length);
  payload.set(saltBytes, 0);
  payload[saltBytes.length] = 0x3a;
  payload.set(encodedKey, saltBytes.length + 1);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getOrCreateReminderSalt() {
  try {
    const raw = localStorage.getItem(REMINDER_SALT_KEY);
    if (typeof raw === 'string') {
      const bytes = fromBase64(raw);
      if (bytes.length === 16) {
        fallbackSalt = bytes;
        return bytes;
      }
    }
  } catch {
    // Sel absent ou illisible : on en crée un nouveau.
  }
  if (fallbackSalt?.length === 16) return fallbackSalt;
  const salt = randomBytes(16);
  fallbackSalt = salt;
  try {
    localStorage.setItem(REMINDER_SALT_KEY, toBase64(salt));
  } catch {
    // Stockage bloqué : on garde le sel en mémoire pour la session.
  }
  return salt;
}

/** Relit la liste des codes de rappels déjà affichés depuis localStorage. */
export async function getShownReminderCodes() {
  const mode = isProtected() ? 'sealed' : 'plain';
  if (mode === 'sealed' && isLocked()) {
    shownCache = [];
    shownMode = 'sealed';
    return [];
  }
  let raw = null;
  try {
    raw = localStorage.getItem(SHOWN_REMINDERS_KEY);
  } catch {
    return shownMode === mode ? [...shownCache] : [];
  }
  if (!raw) {
    shownCache = [];
    shownMode = mode;
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.v !== 2) {
      // Ancien format non salé (tableau) ou invalide : ignoré.
      shownCache = [];
      shownMode = mode;
      return [];
    }
    if (mode === 'sealed') {
      const opened = await unsealAppData(parsed, REMINDER_SEAL_LABEL);
      const items = Array.isArray(opened) ? opened.filter((item) => typeof item === 'string') : [];
      shownCache = items;
      shownMode = 'sealed';
      return [...items];
    }
    const items = Array.isArray(parsed.codes) ? parsed.codes.filter((item) => typeof item === 'string') : [];
    shownCache = items;
    shownMode = 'plain';
    return [...items];
  } catch {
    return [];
  }
}

/** Fusionne `code` avec la liste fraîchement relue et l'enregistre. */
export async function rememberShownCode(code) {
  const mode = isProtected() ? 'sealed' : 'plain';
  if (mode === 'sealed' && isLocked()) return;
  const current = await getShownReminderCodes();
  if (!current.includes(code)) current.push(code);
  const trimmed = current.slice(-MAX_REMEMBERED);
  shownCache = trimmed;
  shownMode = mode;

  let payload;
  if (mode === 'sealed') {
    const sealed = await sealAppData(trimmed, REMINDER_SEAL_LABEL);
    if (!sealed) return;
    payload = { v: 2, ...sealed };
  } else {
    payload = { v: 2, codes: trimmed };
  }

  try {
    localStorage.setItem(SHOWN_REMINDERS_KEY, JSON.stringify(payload));
  } catch {
    // Stockage bloqué : le rappel pourra simplement réapparaître au prochain démarrage.
  }
  channel?.postMessage('shown');
}

/** Vide l'historique des rappels affichés (mémoire, stockage et autres onglets). */
export function clearShownReminders() {
  shownCache = [];
  shownMode = null;
  fallbackSalt = null;
  try {
    localStorage.removeItem(SHOWN_REMINDERS_KEY);
  } catch {
    // Stockage bloqué : sans gravité.
  }
  channel?.postMessage('reset');
}

window.addEventListener('storage', (event) => {
  if (event.key === SHOWN_REMINDERS_KEY) {
    getShownReminderCodes().catch(() => {});
  } else if (event.key === REMINDER_SALT_KEY && event.newValue === null) {
    fallbackSalt = null;
  }
});

if (channel) {
  channel.onmessage = (event) => {
    if (event.data === 'reset') {
      shownCache = [];
      shownMode = null;
      fallbackSalt = null;
    } else if (event.data === 'shown') {
      getShownReminderCodes().catch(() => {});
    }
  };
}

function withReminderLock(fn) {
  if (navigator.locks?.request) {
    return navigator.locks.request('omni-agenda-rappels', fn);
  }
  return fn();
}

// ---------------------------------------------------------------
// Vérification régulière
// ---------------------------------------------------------------

let checking = false;

async function checkReminders() {
  if (checking || isLocked() || notificationPermission() !== 'granted') return;
  checking = true;
  try {
    await withReminderLock(async () => {
      if (isLocked()) return;
      const now = new Date();
      const due = getDueReminders(getEntriesSnapshot(), now);
      if (due.length === 0) return;
      const salt = getOrCreateReminderSalt();
      for (const reminder of due) {
        const code = await hashReminderKey(reminder.key, salt);
        const current = await getShownReminderCodes();
        if (current.includes(code)) continue;
        const { title, body } = reminderText(reminder, now, { discreet: isProtected() });
        // Même « tag » pour une même occurrence de rendez-vous : un nouveau rappel remplace l'ancien au lieu de s'empiler.
        const tag = reminder.occurrenceDate
          ? `rappel-${reminder.entry.id}-${reminder.occurrenceDate}`
          : `rappel-${reminder.entry.id}`;
        await showNotification(title, body, tag);
        await rememberShownCode(code);
      }
    });
  } catch (error) {
    console.warn('Rappel non affiché :', error);
  } finally {
    checking = false;
  }
}

/** Démarre la surveillance des rappels (une fois l'agenda chargé). */
export function startReminders() {
  if (!areNotificationsSupported()) return;
  checkReminders();
  setInterval(checkReminders, CHECK_EVERY_MS);
  onEntriesChange(checkReminders);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkReminders();
  });
}

/** À appeler quand les rappels viennent d'être autorisés. */
export function checkRemindersNow() {
  checkReminders();
}
