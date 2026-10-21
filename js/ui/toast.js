// =============================================================
// ui/toast.js — Petit message de confirmation, discret
// -------------------------------------------------------------
// Un court message (« Rendez-vous ajouté ») apparaît en bas de
// l'écran puis disparaît seul après quelques secondes.
// Aucun son. Les lecteurs d'écran le lisent à voix haute.
// =============================================================

const DISPLAY_DURATION_MS = 4000;
let hideTimer = null;

export function showToast(message) {
  const toast = document.getElementById('message-flottant');
  // On vide puis on remplit : les lecteurs d'écran annoncent ainsi
  // même deux messages identiques à la suite.
  toast.textContent = '';
  clearTimeout(hideTimer);
  requestAnimationFrame(() => {
    toast.textContent = message;
    hideTimer = setTimeout(() => {
      toast.textContent = '';
    }, DISPLAY_DURATION_MS);
  });
}
