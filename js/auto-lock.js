// =============================================================
// auto-lock.js — Verrouillage automatique (inactivité, masquage, bfcache)
// =============================================================

import { isProtected, isUnlocked, lockApp, suspendForBfcache } from './security.js';

export const AUTO_LOCK_OPTIONS = [1, 5, 15, 30, 60, 0];
export const DEFAULT_AUTO_LOCK_MINUTES = 15;
export const DEFAULT_AUTO_LOCK_ON_HIDE = false;

/** Normalise la durée en minutes ; retombe sur 15 minutes si la valeur est invalide. */
export function normalizeAutoLockMinutes(value) {
  const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return AUTO_LOCK_OPTIONS.includes(num) ? num : DEFAULT_AUTO_LOCK_MINUTES;
}

/** Vrai si le délai d'inactivité est écoulé (0 = désactivé). */
export function isAutoLockExpired(lastActivityAt, now, minutes) {
  return minutes > 0 && now - lastActivityAt >= minutes * 60000;
}

let minutes = DEFAULT_AUTO_LOCK_MINUTES;
let onHide = DEFAULT_AUTO_LOCK_ON_HIDE;
let lastActivityAt = Date.now();
let timer = null;
let started = false;
let checkUnlocked = isUnlocked;
let triggerLock = lockApp;

function scheduleTimer() {
  clearTimeout(timer);
  timer = null;
  if (!started || minutes <= 0 || !checkUnlocked()) return;
  const remaining = Math.max(0, minutes * 60000 - (Date.now() - lastActivityAt));
  timer = setTimeout(() => {
    timer = null;
    if (!started || minutes <= 0 || !checkUnlocked()) return;
    if (isAutoLockExpired(lastActivityAt, Date.now(), minutes)) {
      triggerLock();
    } else {
      scheduleTimer();
    }
  }, remaining);
}

function recordActivity() {
  if (!started || !checkUnlocked()) return;
  const now = Date.now();
  if (now - lastActivityAt < 1000) return;
  lastActivityAt = now;
  scheduleTimer();
}

function checkExpiredNow() {
  if (checkUnlocked() && isAutoLockExpired(lastActivityAt, Date.now(), minutes)) {
    triggerLock();
  }
}

function attachListeners() {
  for (const eventName of ['pointerdown', 'keydown', 'touchstart', 'input', 'scroll']) {
    document.addEventListener(eventName, recordActivity, { capture: true, passive: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (onHide && checkUnlocked()) triggerLock();
    } else if (document.visibilityState === 'visible') {
      checkExpiredNow();
    }
  });

  window.addEventListener('focus', checkExpiredNow);

  window.addEventListener('pagehide', (event) => {
    if (event.persisted && isProtected()) suspendForBfcache();
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted && isProtected()) triggerLock({ broadcast: false });
  });
}

/** Démarre la surveillance du verrouillage automatique. */
export function initAutoLock({
  minutes: initialMinutes = DEFAULT_AUTO_LOCK_MINUTES,
  onHide: initialOnHide = DEFAULT_AUTO_LOCK_ON_HIDE,
  isUnlocked: isUnlockedFn = isUnlocked,
  onLock = lockApp,
} = {}) {
  checkUnlocked = isUnlockedFn;
  triggerLock = onLock;
  minutes = normalizeAutoLockMinutes(initialMinutes);
  onHide = Boolean(initialOnHide);
  lastActivityAt = Date.now();
  if (!started) {
    started = true;
    attachListeners();
  }
  scheduleTimer();
}

/** Met à jour la configuration du verrouillage automatique en cours de session. */
export function configureAutoLock({ minutes: nextMinutes, onHide: nextOnHide } = {}) {
  if (nextMinutes !== undefined) minutes = normalizeAutoLockMinutes(nextMinutes);
  if (nextOnHide !== undefined) onHide = Boolean(nextOnHide);
  lastActivityAt = Date.now();
  scheduleTimer();
}

/** Réarme la minuterie après activation/désactivation du mot de passe. */
export function refreshAutoLock() {
  lastActivityAt = Date.now();
  scheduleTimer();
}
