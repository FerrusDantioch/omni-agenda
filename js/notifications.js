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
// Pour ne pas afficher deux fois le même rappel, on garde la liste
// des rappels déjà affichés. Elle est « hachée » (transformée en
// codes illisibles) : elle ne révèle ni les heures ni les rendez-vous.
// =============================================================

import { getEntries, onEntriesChange } from './entry-store.js';
import { getDueReminders, reminderText } from './reminders.js';
import { isProtected } from './security.js';

const CHECK_EVERY_MS = 30 * 1000;
const SHOWN_KEY = 'omni-agenda:rappels-affiches';
const MAX_REMEMBERED = 300;
const ICON = 'assets/icons/icon-192.png';
const BADGE = 'assets/icons/badge-96.png';

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
// Rappels déjà affichés
// ---------------------------------------------------------------

function loadShown() {
  try {
    const saved = JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

const shown = loadShown();

function remember(code) {
  shown.push(code);
  shown.splice(0, Math.max(0, shown.length - MAX_REMEMBERED));
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify(shown));
  } catch {
    // Stockage bloqué : le rappel pourra simplement réapparaître au prochain démarrage.
  }
}

/** Code illisible (empreinte SHA-256) qui identifie un rappel sans le révéler. */
async function codeOf(key) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------
// Vérification régulière
// ---------------------------------------------------------------

let checking = false;

async function checkReminders() {
  if (checking || notificationPermission() !== 'granted') return;
  checking = true;
  try {
    const now = new Date();
    for (const reminder of getDueReminders(getEntries(), now)) {
      const code = await codeOf(reminder.key);
      if (shown.includes(code)) continue;
      const { title, body } = reminderText(reminder, now, { discreet: isProtected() });
      // Même « tag » pour un même rendez-vous : un nouveau rappel remplace l'ancien au lieu de s'empiler.
      await showNotification(title, body, `rappel-${reminder.entry.id}`);
      remember(code);
    }
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
