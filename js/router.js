// =============================================================
// router.js — Passage d'un écran à l'autre
// -------------------------------------------------------------
// L'application n'a qu'une seule page HTML, qui contient tous les
// écrans (agenda, réglages, à propos). Un seul est visible à la
// fois. L'écran affiché dépend de la fin de l'adresse :
//   #/          → agenda
//   #/reglages  → réglages
//   #/a-propos  → à propos
// Avantage : le bouton « retour » du téléphone fonctionne.
// =============================================================

const ROUTES = {
  '/': 'agenda',
  '/reglages': 'reglages',
  '/a-propos': 'a-propos',
};

/**
 * Démarre la navigation entre écrans.
 * `onChange(nomEcran)` est appelé à chaque changement d'écran.
 */
export function startRouter(onChange) {
  let isFirstDisplay = true;

  const showCurrentScreen = () => {
    const path = window.location.hash.replace(/^#/, '') || '/';
    const screenName = ROUTES[path] || 'agenda';

    let current = null;
    for (const screen of document.querySelectorAll('[data-screen]')) {
      const visible = screen.dataset.screen === screenName;
      screen.hidden = !visible;
      if (visible) current = screen;
    }

    if (current) {
      document.title = current.dataset.title || 'Omni-Agenda';
      // Après un changement d'écran, on remonte en haut et on place le
      // « focus » sur le titre : les lecteurs d'écran annoncent le nouvel écran.
      if (!isFirstDisplay) {
        window.scrollTo(0, 0);
        const heading = current.querySelector('h1');
        if (heading) {
          heading.setAttribute('tabindex', '-1');
          heading.focus({ preventScroll: true });
        }
      }
    }

    isFirstDisplay = false;
    if (onChange) onChange(screenName);
  };

  window.addEventListener('hashchange', showCurrentScreen);
  showCurrentScreen();
}
