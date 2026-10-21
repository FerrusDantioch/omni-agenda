// =============================================================
// views/list-view.js — Liste des entrées, classées par jour
// -------------------------------------------------------------
// Affichage simple, en attendant les pages de l'agenda papier
// (étape 3). Si l'agenda est vide, on affiche l'accueil.
// =============================================================

import { el, keepFocus } from '../ui/dom.js';
import { compareEntries, getEntryDay } from '../entries.js';
import { formatISODateLong, relativeDayLabel, todayISO } from '../dates.js';
import { getEntries, onEntriesChange, toggleTaskDone } from '../entry-store.js';
import { renderEntryItem } from '../ui/entry-item.js';

/** Titre d'un jour : « Aujourd'hui — Mercredi 21 octobre 2026 ». */
function dayHeading(iso) {
  if (iso === null) return 'Tâches sans échéance';
  const relative = relativeDayLabel(iso);
  return relative ? `${relative} — ${formatISODateLong(iso)}` : formatISODateLong(iso);
}

/**
 * Prépare la liste.
 *  - onOpen(id) : ouvrir la fiche d'une entrée ;
 *  - onError(error) : prévenir d'un échec d'enregistrement.
 */
export function initListView({ onOpen, onError }) {
  const container = document.getElementById('liste-entrees');
  const emptyState = document.getElementById('accueil-vide');

  const render = () => {
    const entries = getEntries();
    emptyState.hidden = entries.length > 0;

    // Regroupement par jour (null = tâches sans échéance).
    const groups = new Map();
    for (const entry of entries) {
      const day = getEntryDay(entry);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(entry);
    }
    const days = [...groups.keys()].sort((a, b) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return a < b ? -1 : 1;
    });

    const itemActions = {
      onOpen,
      onToggleDone: (id) => toggleTaskDone(id).catch(onError),
    };

    container.replaceChildren(...days.map((day) =>
      el('section', { class: 'day-group' },
        el('h2', { class: day === todayISO() ? 'day-heading is-today' : 'day-heading' }, dayHeading(day)),
        el('ul', { class: 'entry-list' },
          groups.get(day).sort(compareEntries).map((entry) => renderEntryItem(entry, itemActions)),
        ),
      ),
    ));
  };

  onEntriesChange(() => keepFocus(container, render));
  render();
}
