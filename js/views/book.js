// =============================================================
// views/book.js — Le livre : une ou deux pages, et tourner la page
// -------------------------------------------------------------
// Ce fichier ne sait pas ce qu'il y a SUR les pages : il les
// reçoit toutes prêtes. Son rôle :
//   - les poser côte à côte (deux pages, avec la reliure au
//     milieu) ou seules (une page) ;
//   - animer le passage d'une page à l'autre ;
//   - reconnaître un balayage du doigt vers la gauche ou la droite.
//
// L'animation de page :
//   1. on fait une copie (« photo ») des pages actuelles ;
//   2. on affiche les nouvelles pages ;
//   3. par-dessus, une feuille faite des copies pivote autour de
//      la reliure, puis disparaît.
// Si l'appareil demande de réduire les animations : aucune animation.
// =============================================================

import { el } from '../ui/dom.js';

const FLIP_DURATION_MS = 650;
const FLIP_EASING = 'cubic-bezier(0.45, 0.05, 0.35, 1)';
const SWIPE_MIN_DISTANCE_PX = 60;
const SWIPE_MAX_DURATION_MS = 800;

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Copie inerte d'une page (sans identifiants en double). */
function copyOf(page) {
  const copy = page.cloneNode(true);
  for (const node of [copy, ...copy.querySelectorAll('[id]')]) node.removeAttribute('id');
  return copy;
}

/** Position d'une page dans le livre. */
function boxOf(page) {
  return { left: page.offsetLeft, top: page.offsetTop, width: page.offsetWidth, height: page.offsetHeight };
}

/** Place un élément sur une zone du livre. */
function placeAt(element, box, height = box.height) {
  element.style.left = `${box.left}px`;
  element.style.top = `${box.top}px`;
  element.style.width = `${box.width}px`;
  element.style.height = `${height}px`;
  return element;
}

/** Copie fixe posée par-dessus une page, le temps de l'animation. */
function staticCopy(snapshot) {
  return placeAt(el('div', { class: 'flip-static' }, snapshot.copy), snapshot.box);
}

/** Une face de la feuille, à la hauteur de la page qu'elle montre. */
function makeFace(className, content, height, shade) {
  const face = el('div', { class: `flip-face ${className}` }, content ?? '', shade);
  face.style.height = `${height}px`;
  return face;
}

/**
 * La feuille qui tourne : un recto (la page qui part) et un verso
 * (la page qui arrive), chacun à sa propre hauteur.
 * `hinge` : côté de la charnière ('left' ou 'right').
 */
function makeLeaf(box, front, back, hinge) {
  const frontShade = el('div', { class: 'flip-shade' });
  const backShade = el('div', { class: 'flip-shade' });
  const frontHeight = front.box.height;
  const backHeight = back ? back.box.height : frontHeight;
  const leaf = el('div', { class: `flip-leaf hinge-${hinge}` },
    makeFace('flip-front', front.copy, frontHeight, frontShade),
    makeFace('flip-back', back?.copy, backHeight, backShade),
  );
  return { leaf: placeAt(leaf, box, Math.max(frontHeight, backHeight)), frontShade, backShade };
}

/** Reconnaît un balayage horizontal du doigt (pas de la souris). */
function listenForSwipes(element, onSwipe) {
  let start = null;
  element.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    start = { x: event.clientX, y: event.clientY, time: event.timeStamp };
  });
  element.addEventListener('pointerup', (event) => {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const duration = event.timeStamp - start.time;
    start = null;
    if (Math.abs(dx) >= SWIPE_MIN_DISTANCE_PX && Math.abs(dx) > 1.5 * Math.abs(dy) && duration <= SWIPE_MAX_DURATION_MS) {
      // Doigt vers la gauche = page suivante.
      onSwipe(dx < 0 ? 1 : -1);
    }
  });
  // Le navigateur a pris la main (défilement vertical) : on oublie ce geste.
  element.addEventListener('pointercancel', () => {
    start = null;
  });
}

/**
 * Prépare le livre dans l'élément donné.
 * `onSwipe(direction)` est appelé après un balayage (1 = suivant, -1 = précédent).
 */
export function createBook(element, { onSwipe }) {
  let currentFlip = null;

  listenForSwipes(element, onSwipe);

  function stopFlip() {
    if (!currentFlip) return;
    for (const animation of currentFlip.animations) animation.cancel();
    currentFlip.layer.remove();
    currentFlip = null;
  }

  function currentPages() {
    return [...element.querySelectorAll(':scope > .page')];
  }

  function snapshot(pages) {
    return pages.map((page) => ({ copy: copyOf(page), box: boxOf(page) }));
  }

  function playFlip(before, direction, mode) {
    const after = snapshot(currentPages());
    const layer = el('div', { class: 'flip-layer', 'aria-hidden': 'true', inert: true });
    let parts;
    let turn;
    // Copie de l'ancienne page laissée en place, qui s'efface à la fin.
    let cover = null;

    if (mode === 'spread') {
      const [oldLeft, oldRight] = before;
      const [newLeft, newRight] = after;
      if (direction > 0) {
        // Page suivante : la page de droite se soulève et se pose à gauche.
        cover = staticCopy(oldLeft);
        parts = makeLeaf(oldRight.box, oldRight, newLeft, 'left');
        turn = [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-180deg)' }];
      } else {
        // Page précédente : la page de gauche revient vers la droite.
        cover = staticCopy(oldRight);
        parts = makeLeaf(oldLeft.box, oldLeft, newRight, 'right');
        turn = [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }];
      }
    } else {
      const [oldPage] = before;
      const [newPage] = after;
      if (direction > 0) {
        // Page suivante : l'ancienne page s'écarte vers la gauche et découvre la nouvelle.
        parts = makeLeaf(oldPage.box, oldPage, null, 'left');
        turn = [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-95deg)' }];
      } else {
        // Page précédente : la nouvelle page revient se poser par-dessus l'ancienne.
        cover = staticCopy(oldPage);
        parts = makeLeaf(newPage.box, newPage, null, 'left');
        turn = [{ transform: 'rotateY(-95deg)' }, { transform: 'rotateY(0deg)' }];
      }
    }

    if (cover) layer.append(cover);
    layer.append(parts.leaf);
    element.append(layer);

    const timing = { duration: FLIP_DURATION_MS, easing: FLIP_EASING, fill: 'both' };
    const animations = [
      parts.leaf.animate(turn, timing),
      // Légère ombre sur la feuille pendant qu'elle tourne (relief).
      parts.frontShade.animate([{ opacity: 0 }, { opacity: 0.25, offset: 0.5 }, { opacity: 0.25 }], timing),
      parts.backShade.animate([{ opacity: 0.25 }, { opacity: 0.25, offset: 0.5 }, { opacity: 0 }], timing),
    ];
    if (cover) {
      animations.push(cover.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], timing));
    }
    currentFlip = { layer, animations };
    animations[0].finished.then(stopFlip).catch(() => {});
  }

  return {
    /**
     * Affiche des pages.
     *  - pages : tableau d'une ou deux pages ;
     *  - mode : 'spread' (deux pages) ou 'single' (une page) ;
     *  - direction : 1 = page suivante, -1 = précédente, 0 = sans animation.
     */
    show(pages, { mode, direction = 0 }) {
      stopFlip();
      const animate = direction !== 0
        && !prefersReducedMotion()
        && element.dataset.mode === mode
        && currentPages().length === pages.length;
      const before = animate ? snapshot(currentPages()) : null;

      element.dataset.mode = mode;
      if (mode === 'spread') {
        pages[0].classList.add('page-left');
        pages[1].classList.add('page-right');
        element.replaceChildren(pages[0], el('div', { class: 'book-binding', 'aria-hidden': 'true' }), pages[1]);
      } else {
        element.replaceChildren(pages[0]);
      }

      if (before) playFlip(before, direction, mode);
    },
  };
}
