// =============================================================
// sanitize.js — Nettoyage des descriptions (anti-injection)
// -------------------------------------------------------------
// Une description peut contenir un peu de mise en forme. Pour
// éviter qu'un texte piégé (par exemple dans un fichier importé)
// exécute du code, on applique une « liste blanche » : on garde
// UNIQUEMENT ce qui est autorisé, tout le reste est supprimé.
//
// Autorisé :
//   - <strong>  gras
//   - <u>       souligné
//   - <mark class="hl-…">  surlignage (couleurs de la liste ci-dessous)
//   - <br>      retour à la ligne
// Aucun attribut n'est conservé, sauf la couleur du surlignage.
// =============================================================

/** Couleurs de surlignage autorisées (noms des classes CSS). */
export const HIGHLIGHT_CLASSES = ['hl-jaune', 'hl-vert', 'hl-bleu', 'hl-rose'];
const DEFAULT_HIGHLIGHT = 'hl-jaune';

/** Taille maximale acceptée avant nettoyage (protection contre les fichiers énormes). */
const MAX_INPUT_LENGTH = 200000;

/** Éléments supprimés AVEC leur contenu (code, styles, objets…). */
const DROP_WITH_CONTENT = new Set([
  'SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH',
  'NOSCRIPT', 'TITLE', 'HEAD', 'LINK', 'META', 'TEXTAREA', 'SELECT', 'BUTTON', 'INPUT',
]);

/** Éléments « bloc » : ils deviennent un simple retour à la ligne. */
const BLOCK_ELEMENTS = new Set([
  'DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TR', 'TABLE',
]);

// Le « DOMParser » lit du HTML dans un document à part, inerte :
// rien ne s'y exécute et aucune image ne s'y charge.
const parser = new DOMParser();
const inertDocument = document.implementation.createHTMLDocument('');

function endsWithLineBreak(parent) {
  return parent.lastChild?.nodeName === 'BR';
}

/**
 * Recopie le contenu de `source` dans `target` en ne gardant que
 * ce qui est autorisé. `doc` est le document qui fabrique les éléments.
 */
function copyAllowed(source, target, doc) {
  for (const node of source.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      target.append(doc.createTextNode(node.data));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue; // commentaires, etc.

    const tag = node.nodeName.toUpperCase();
    if (DROP_WITH_CONTENT.has(tag)) continue;

    if (tag === 'BR') {
      target.append(doc.createElement('br'));
      continue;
    }

    const allowedTag = { B: 'strong', STRONG: 'strong', U: 'u', MARK: 'mark' }[tag];
    if (allowedTag) {
      const clean = doc.createElement(allowedTag);
      if (allowedTag === 'mark') {
        clean.className = [...node.classList].find((name) => HIGHLIGHT_CLASSES.includes(name)) || DEFAULT_HIGHLIGHT;
      }
      copyAllowed(node, clean, doc);
      if (clean.hasChildNodes()) target.append(clean);
      continue;
    }

    // Tout autre élément est « déballé » : on garde son texte, pas la balise.
    const isBlock = BLOCK_ELEMENTS.has(tag);
    if (isBlock && target.hasChildNodes() && !endsWithLineBreak(target)) {
      target.append(doc.createElement('br'));
    }
    copyAllowed(node, target, doc);
  }
}

/** Retire les retours à la ligne en trop à la fin. */
function trimTrailingBreaks(container) {
  while (container.lastChild && (container.lastChild.nodeName === 'BR'
    || (container.lastChild.nodeType === Node.TEXT_NODE && container.lastChild.data.trim() === ''))) {
    container.lastChild.remove();
  }
}

/** Lit un HTML douteux et renvoie un conteneur nettoyé, fabriqué par `doc`. */
function buildClean(dirtyHtml, doc) {
  const source = parser.parseFromString(String(dirtyHtml ?? '').slice(0, MAX_INPUT_LENGTH), 'text/html');
  const container = doc.createElement('div');
  copyAllowed(source.body, container, doc);
  trimTrailingBreaks(container);
  return container;
}

/** Nettoie un HTML et renvoie le résultat sous forme de texte HTML sûr. */
export function sanitizeHtml(dirtyHtml) {
  return buildClean(dirtyHtml, inertDocument).innerHTML;
}

/** Nettoie un HTML et renvoie des éléments prêts à être affichés dans la page. */
export function sanitizeToFragment(dirtyHtml) {
  const fragment = document.createDocumentFragment();
  fragment.append(...buildClean(dirtyHtml, document).childNodes);
  return fragment;
}

/** Texte simple → HTML sûr (les retours à la ligne deviennent des <br>). */
export function textToHtml(text) {
  const container = inertDocument.createElement('div');
  String(text ?? '').replace(/\r\n?/g, '\n').split('\n').forEach((line, index) => {
    if (index > 0) container.append(inertDocument.createElement('br'));
    container.append(inertDocument.createTextNode(line));
  });
  trimTrailingBreaks(container);
  return container.innerHTML;
}

/** HTML → texte simple (les <br> deviennent des retours à la ligne). */
export function htmlToText(html) {
  const container = buildClean(html, inertDocument);
  for (const br of container.querySelectorAll('br')) br.replaceWith('\n');
  return container.textContent;
}
