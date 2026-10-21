// =============================================================
// install.js — Installer Omni-Agenda comme une application
// -------------------------------------------------------------
// Installée, Omni-Agenda a son icône sur l'écran d'accueil (ou dans
// le menu de l'ordinateur) et s'ouvre dans sa propre fenêtre.
//
// Chrome et Edge proposent l'installation par un événement
// (« beforeinstallprompt ») : on le garde pour l'utiliser quand
// l'utilisateur touche « Installer Omni-Agenda ». Les autres
// navigateurs (Safari, Firefox) ont leur propre menu : on explique
// alors la marche à suivre.
// =============================================================

let installPrompt = null;
const listeners = new Set();

function notify() {
  for (const listener of listeners) listener();
}

window.addEventListener('beforeinstallprompt', (event) => {
  // On garde la proposition pour notre propre bouton.
  event.preventDefault();
  installPrompt = event;
  notify();
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  notify();
});

/** Vrai si l'application est ouverte en tant qu'application installée. */
export function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

/** Vrai si le navigateur permet d'installer avec notre bouton. */
export function canPromptInstall() {
  return installPrompt !== null;
}

/** Affiche la proposition d'installation du navigateur. Renvoie vrai si l'utilisateur accepte. */
export async function promptInstall() {
  if (!installPrompt) return false;
  const prompt = installPrompt;
  installPrompt = null;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  notify();
  return outcome === 'accepted';
}

/** S'abonner aux changements (installation possible, installée…). */
export function onInstallChange(listener) {
  listeners.add(listener);
}
