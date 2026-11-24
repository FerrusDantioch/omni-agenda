// =============================================================
// ui/search-bar.js — Barre et résultats de recherche
// -------------------------------------------------------------
// Initialisée uniquement après déverrouillage. Efface aussitôt
// saisie et DOM sur verrouillage / bfcache (onAppLock).
// =============================================================

import { el, keepFocus, setText } from './dom.js';
import { renderEntryItem } from './entry-item.js';
import { formatISODateLong } from '../dates.js';
import { getEntryDay } from '../entries.js';
import { getEntriesSnapshot, onEntriesChange } from '../entry-store.js';
import { searchEntries } from '../search.js';
import { isLocked, isSecurityReady, onAppLock } from '../security.js';

const DEBOUNCE_MS = 120;

export function initSearchBar({ onOpen, onToggleDone, onShowDay }) {
  const input = document.getElementById('champ-recherche');
  const clearButton = document.getElementById('bouton-effacer-recherche');
  const resultsSection = document.getElementById('recherche-resultats');
  const statusNode = document.getElementById('recherche-statut');
  const listNode = document.getElementById('recherche-liste');
  const bookWrap = document.getElementById('livre-conteneur');
  const navBar = document.querySelector('.agenda-nav');
  const emptyWelcome = document.getElementById('accueil-vide');

  if (!input || !clearButton || !resultsSection || !statusNode || !listNode) {
    return { clearSearch: () => {} };
  }

  let debounceTimer = null;

  const isActive = () => input.value.trim() !== '';

  function restoreAgendaVisibility() {
    resultsSection.hidden = true;
    if (bookWrap) bookWrap.hidden = false;
    if (navBar) navBar.hidden = false;
    if (emptyWelcome) emptyWelcome.hidden = getEntriesSnapshot().length > 0;
  }

  function clearSearch({ silent = false, restoreFocus = false } = {}) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    input.value = '';
    clearButton.hidden = true;
    listNode.replaceChildren();
    setText(statusNode, '');
    restoreAgendaVisibility();
    if (!silent && restoreFocus) input.focus();
  }

  function renderResults() {
    if (!isSecurityReady() || isLocked()) {
      clearSearch({ silent: true });
      return;
    }

    const query = input.value.trim();
    clearButton.hidden = query === '';
    if (!query) {
      listNode.replaceChildren();
      setText(statusNode, '');
      restoreAgendaVisibility();
      return;
    }

    const matches = searchEntries(getEntriesSnapshot(), query);
    resultsSection.hidden = false;
    if (bookWrap) bookWrap.hidden = true;
    if (navBar) navBar.hidden = true;
    if (emptyWelcome) emptyWelcome.hidden = true;

    if (matches.length === 0) {
      setText(statusNode, `Aucun résultat pour « ${query} ».`);
      listNode.replaceChildren();
      return;
    }

    setText(statusNode, matches.length > 1
      ? `${matches.length} résultats pour « ${query} ».`
      : `1 résultat pour « ${query} ».`);

    const items = matches.map((entry) => {
      const li = renderEntryItem(entry, {
        showDueDate: true,
        showDate: true,
        focusScope: 'recherche',
        onOpen,
        onToggleDone,
      });
      const day = getEntryDay(entry);
      if (day) {
        li.append(el('button', {
          type: 'button',
          class: 'btn btn-ghost btn-small search-jump-day',
          'aria-label': `Voir le ${formatISODateLong(day)} dans l'agenda`,
          'data-focus-key': `recherche-jour-${entry.id}`,
          onclick: () => {
            clearSearch({ silent: true });
            onShowDay(day);
          },
        }, 'Voir le jour'));
      }
      return li;
    });

    listNode.replaceChildren(...items);
  }

  input.addEventListener('input', () => {
    clearButton.hidden = input.value.trim() === '';
    if (debounceTimer) clearTimeout(debounceTimer);
    if (input.value.trim() === '') {
      renderResults();
      return;
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      renderResults();
    }, DEBOUNCE_MS);
  });

  input.addEventListener('search', () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    renderResults();
  });

  clearButton.addEventListener('click', () => clearSearch({ restoreFocus: true }));

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (input.value !== '' || !resultsSection.hidden)) {
      event.preventDefault();
      clearSearch({ restoreFocus: true });
    } else if (event.key === 'ArrowDown' && !resultsSection.hidden) {
      const firstRow = listNode.querySelector('.entry-main, .search-jump-day');
      if (firstRow) {
        event.preventDefault();
        firstRow.focus();
      }
    }
  });

  listNode.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = [...listNode.querySelectorAll('.entry-main')];
    const current = event.target.closest('.entry')?.querySelector('.entry-main');
    const idx = rows.indexOf(current);
    if (idx === -1) return;
    if (event.key === 'ArrowDown' && idx + 1 < rows.length) {
      event.preventDefault();
      rows[idx + 1].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (idx > 0) rows[idx - 1].focus();
      else input.focus();
    }
  });

  onEntriesChange(() => {
    if (isActive() && !isLocked() && isSecurityReady()) {
      keepFocus(resultsSection, renderResults);
    }
  });

  onAppLock(() => clearSearch({ silent: true }));

  return { clearSearch };
}
