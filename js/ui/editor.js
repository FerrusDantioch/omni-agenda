// =============================================================
// ui/editor.js — Description enrichie : gras, souligné, surlignage
// -------------------------------------------------------------
// Une zone de texte « modifiable » (contenteditable) et une
// petite barre d'outils. On sélectionne du texte, puis on touche :
//   G = gras, S = souligné, une couleur = surligner,
//   « Effacer » = retirer toute mise en forme.
// Raccourcis clavier : Ctrl+B (gras) et Ctrl+U (souligné).
//
// Pour rester propre et sûr, l'éditeur ne produit QUE les balises
// autorisées par js/sanitize.js : <strong>, <u>, <mark class="hl-…">
// et <br>. Le texte collé depuis ailleurs arrive sans mise en forme.
// =============================================================

import { el, setText } from './dom.js';
import { sanitizeToFragment } from '../sanitize.js';

/** Couleurs de surlignage (mêmes noms que dans sanitize.js et entries.css). */
export const HIGHLIGHTS = [
  { className: 'hl-jaune', label: 'jaune' },
  { className: 'hl-vert', label: 'vert' },
  { className: 'hl-bleu', label: 'bleu' },
  { className: 'hl-rose', label: 'rose' },
];

/** Description de chaque mise en forme : comment la reconnaître, comment la créer. */
const FORMATS = {
  bold: {
    matches: (element) => element.nodeName === 'STRONG' || element.nodeName === 'B',
    create: () => document.createElement('strong'),
  },
  underline: {
    matches: (element) => element.nodeName === 'U',
    create: () => document.createElement('u'),
  },
};
for (const { className } of HIGHLIGHTS) {
  FORMATS[className] = {
    isHighlight: true,
    matches: (element) => element.nodeName === 'MARK' && element.classList.contains(className),
    create: () => {
      const mark = document.createElement('mark');
      mark.className = className;
      return mark;
    },
  };
}
const isAnyFormat = (element) => ['STRONG', 'B', 'U', 'MARK'].includes(element.nodeName);
const isAnyHighlight = (element) => element.nodeName === 'MARK';

// ---------------------------------------------------------------
// Outils sur le texte sélectionné
// ---------------------------------------------------------------

/** Premier ancêtre (dans l'éditeur) qui correspond à `matches`, ou null. */
function findAncestor(node, root, matches) {
  for (let current = node.parentNode; current && current !== root; current = current.parentNode) {
    if (current.nodeType === Node.ELEMENT_NODE && matches(current)) return current;
  }
  return null;
}

/** Morceaux de texte touchés par la sélection (sans rien modifier). */
function textNodesInRange(root, range) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (end > start) nodes.push(node);
  }
  return nodes;
}

/** Coupe les morceaux de texte aux bords de la sélection, pour ne traiter que le texte choisi. */
function splitAtRangeBoundaries(range) {
  const { startContainer, startOffset, endContainer, endOffset } = range;
  // D'abord la fin, pour que la position du début reste valable.
  if (endContainer.nodeType === Node.TEXT_NODE && endOffset > 0 && endOffset < endContainer.length) {
    endContainer.splitText(endOffset);
  }
  if (startContainer.nodeType === Node.TEXT_NODE && startOffset > 0 && startOffset < startContainer.length) {
    const tail = startContainer.splitText(startOffset);
    range.setStart(tail, 0);
  }
}

/** Vrai si un fragment contient du texte ou un retour à la ligne. */
function hasContent(fragment) {
  return fragment.textContent.length > 0 || fragment.querySelector('br') !== null;
}

/**
 * Retire la mise en forme `element` autour d'un seul morceau de texte :
 * ce qui est avant et après garde sa mise en forme.
 */
function unwrapAround(node, element) {
  const before = document.createRange();
  before.setStart(element, 0);
  before.setEndBefore(node);
  const beforeContent = before.extractContents();

  const after = document.createRange();
  after.setStartAfter(node);
  after.setEnd(element, element.childNodes.length);
  const afterContent = after.extractContents();

  if (hasContent(beforeContent)) {
    const copy = element.cloneNode(false);
    copy.append(beforeContent);
    element.before(copy);
  }
  if (hasContent(afterContent)) {
    const copy = element.cloneNode(false);
    copy.append(afterContent);
    element.after(copy);
  }
  element.replaceWith(...element.childNodes);
}

/** Retire toutes les mises en forme qui correspondent à `matches` autour d'un morceau de texte. */
function removeAround(node, root, matches) {
  for (let ancestor = findAncestor(node, root, matches); ancestor; ancestor = findAncestor(node, root, matches)) {
    unwrapAround(node, ancestor);
  }
}

/** Range un peu : fusionne les mises en forme identiques côte à côte, retire les vides. */
function tidy(root) {
  for (const element of [...root.querySelectorAll('strong, b, u, mark')]) {
    if (!element.isConnected) continue;
    if (!hasContent(element)) {
      element.remove();
      continue;
    }
    let next = element.nextSibling;
    while (next && next.nodeType === Node.ELEMENT_NODE && next.nodeName === element.nodeName
      && next.className === element.className) {
      element.append(...next.childNodes);
      next.remove();
      next = element.nextSibling;
    }
  }
}

// ---------------------------------------------------------------
// L'éditeur
// ---------------------------------------------------------------

/**
 * Fabrique l'éditeur.
 *  - id, labelId : identifiants pour relier l'étiquette ;
 *  - describedBy : identifiants des textes d'aide / d'erreur ;
 *  - initialHtml : description existante (déjà nettoyée).
 * Renvoie { element, editor, getHtml(), focus() }.
 */
export function createRichEditor({ id, labelId, describedBy = '', initialHtml = '' }) {
  const editor = el('div', {
    id,
    class: 'rich-editor',
    contenteditable: 'true',
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-labelledby': labelId,
    'aria-describedby': describedBy || false,
    spellcheck: 'true',
  });
  editor.append(sanitizeToFragment(initialHtml));

  const hint = el('p', { class: 'editor-hint', role: 'status' });
  let hintTimer = null;
  const showHint = (text) => {
    setText(hint, text);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hint.textContent = '';
    }, 4000);
  };

  // On retient la dernière sélection faite dans l'éditeur : quand on
  // passe sur un bouton au clavier, elle reste utilisable.
  let savedRange = null;
  const currentRange = () => {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) return range;
    }
    return savedRange;
  };

  // ----- Boutons -----
  const toolButton = (format, content, label, extraClass = '') => el('button', {
    type: 'button',
    class: `tool-btn ${extraClass}`.trim(),
    'aria-pressed': 'false',
    'data-format': format,
    title: label,
  }, content);

  const buttons = [
    toolButton('bold', [el('strong', { 'aria-hidden': 'true' }, 'G'), el('span', { class: 'tool-label' }, 'Gras')], 'Gras (Ctrl+B)'),
    toolButton('underline', [el('u', { 'aria-hidden': 'true' }, 'S'), el('span', { class: 'tool-label' }, 'Souligné')], 'Souligné (Ctrl+U)'),
    ...HIGHLIGHTS.map(({ className, label }) =>
      toolButton(className, [
        el('span', { class: `swatch ${className}`, 'aria-hidden': 'true' }),
        el('span', { class: 'visually-hidden' }, `Surligner en ${label}`),
      ], `Surligner en ${label}`, 'tool-swatch')),
  ];
  const clearButton = el('button', { type: 'button', class: 'tool-btn', 'data-format': 'clear', title: 'Retirer toute mise en forme' }, 'Effacer');

  const toolbar = el('div', { class: 'rich-toolbar', role: 'group', 'aria-label': 'Mise en forme de la description' },
    buttons.slice(0, 2),
    el('span', { class: 'toolbar-label', 'aria-hidden': 'true' }, 'Surligner :'),
    buttons.slice(2),
    clearButton,
  );

  // ----- État des boutons (enfoncés si le texte choisi a déjà ce format) -----
  const updateButtons = () => {
    const range = currentRange();
    for (const button of buttons) {
      const format = FORMATS[button.dataset.format];
      let active = false;
      if (range && range.collapsed) {
        // Curseur sans sélection : format de l'endroit où se trouve le curseur.
        const { startContainer, startOffset } = range;
        const node = startContainer.nodeType === Node.TEXT_NODE
          ? startContainer
          : startContainer.childNodes[startOffset - 1] ?? startContainer;
        active = (node !== editor && node.nodeType === Node.ELEMENT_NODE && format.matches(node))
          || Boolean(findAncestor(node, editor, format.matches));
      } else if (range) {
        const nodes = textNodesInRange(editor, range);
        active = nodes.length > 0 && nodes.every((node) => findAncestor(node, editor, format.matches));
      }
      button.setAttribute('aria-pressed', String(active));
    }
  };

  const onSelectionChange = () => {
    // Le formulaire a été fermé : on arrête d'écouter.
    if (!editor.isConnected) {
      document.removeEventListener('selectionchange', onSelectionChange);
      return;
    }
    const selection = window.getSelection();
    if (selection.rangeCount > 0 && editor.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      savedRange = selection.getRangeAt(0).cloneRange();
      updateButtons();
    }
  };
  document.addEventListener('selectionchange', onSelectionChange);

  // ----- Appliquer / retirer une mise en forme -----
  const notifyChange = () => editor.dispatchEvent(new Event('input', { bubbles: true }));

  const applyFormat = (formatName) => {
    const range = currentRange()?.cloneRange();
    if (!range || range.collapsed || textNodesInRange(editor, range).length === 0) {
      showHint("Sélectionne d'abord le texte à mettre en forme.");
      return;
    }
    splitAtRangeBoundaries(range);
    const nodes = textNodesInRange(editor, range);

    if (formatName === 'clear') {
      for (const node of nodes) removeAround(node, editor, isAnyFormat);
    } else {
      const format = FORMATS[formatName];
      const alreadyAll = nodes.every((node) => findAncestor(node, editor, format.matches));
      for (const node of nodes) {
        if (alreadyAll) {
          // Tout le texte a déjà ce format : on le retire (bouton « bascule »).
          removeAround(node, editor, format.matches);
        } else if (!findAncestor(node, editor, format.matches)) {
          // Un seul surlignage à la fois : on retire d'abord les autres couleurs.
          if (format.isHighlight) removeAround(node, editor, isAnyHighlight);
          const wrapper = format.create();
          node.before(wrapper);
          wrapper.append(node);
        }
      }
    }

    tidy(editor);
    // On garde le même texte sélectionné.
    const selection = window.getSelection();
    const newRange = document.createRange();
    newRange.setStart(nodes[0], 0);
    newRange.setEnd(nodes[nodes.length - 1], nodes[nodes.length - 1].length);
    selection.removeAllRanges();
    selection.addRange(newRange);
    savedRange = newRange.cloneRange();
    editor.normalize();
    updateButtons();
    notifyChange();
  };

  // Garder la sélection quand on clique sur un bouton avec la souris ou le doigt.
  toolbar.addEventListener('mousedown', (event) => {
    if (event.target.closest('button')) event.preventDefault();
  });
  toolbar.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (button) applyFormat(button.dataset.format);
  });

  // ----- Clavier, collage, glisser-déposer -----
  editor.addEventListener('beforeinput', (event) => {
    if (event.inputType === 'formatBold' || event.inputType === 'formatUnderline') {
      event.preventDefault();
      applyFormat(event.inputType === 'formatBold' ? 'bold' : 'underline');
    } else if (event.inputType.startsWith('format') || event.inputType === 'insertFromDrop') {
      // Italique, couleurs de texte, dépôt d'un contenu extérieur : non autorisés.
      event.preventDefault();
    }
  });

  // Coller : on n'insère que le texte brut (aucune mise en forme venue d'ailleurs).
  editor.addEventListener('paste', (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const range = currentRange();
    if (!range) return;
    range.deleteContents();
    const fragment = document.createDocumentFragment();
    let last = null;
    text.replace(/\r\n?/g, '\n').split('\n').forEach((line, index) => {
      if (index > 0) fragment.append(document.createElement('br'));
      last = document.createTextNode(line);
      fragment.append(last);
    });
    range.insertNode(fragment);
    range.setStartAfter(last);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    notifyChange();
  });

  editor.addEventListener('drop', (event) => event.preventDefault());

  return {
    element: el('div', { class: 'rich-field' }, toolbar, editor, hint),
    editor,
    getHtml: () => editor.innerHTML,
    focus: () => editor.focus(),
  };
}
