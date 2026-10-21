// =============================================================
// ui/entry-panel.js — La fenêtre d'une entrée
// -------------------------------------------------------------
// Une seule fenêtre sert à tout : consulter la fiche, modifier,
// créer. Elle passe d'un « mode » à l'autre sans se fermer.
// =============================================================

import { el, icon, keepFocus } from './dom.js';
import { closeModal, confirmAction, openModal } from './dialogs.js';
import { renderEntryDetails } from './entry-details.js';
import { renderEntryForm } from './entry-form.js';
import { showToast } from './toast.js';
import { deleteEntry, getEntry, onEntriesChange, saveEntry, toggleTaskDone } from '../entry-store.js';

const NEW_TITLES = { event: 'Nouveau rendez-vous', task: 'Nouvelle tâche' };
const EDIT_TITLES = { event: 'Modifier le rendez-vous', task: 'Modifier la tâche' };
const SAVE_ERROR = { text: "L'enregistrement a échoué. Réessaie.", isError: true };

// Ce qui est affiché en ce moment : { mode: 'details' | 'form', entryId, form, version }
let view = null;

function getDialog() {
  return document.getElementById('fenetre-entree');
}

/** Remplit la fenêtre : un en-tête (titre + bouton Fermer) puis le contenu. */
function renderShell(title, content) {
  const heading = el('h2', { id: 'fenetre-entree-titre', tabindex: '-1' }, title);
  const closeButton = el('button', { type: 'button', class: 'btn btn-ghost btn-icon', 'aria-label': 'Fermer', onclick: () => requestClose() }, icon('close'));
  getDialog().replaceChildren(el('div', { class: 'panel-header' }, heading, closeButton), content);
  return heading;
}

/** Demande à fermer : si une saisie est en cours, on demande d'abord confirmation. */
async function confirmDiscardIfNeeded() {
  if (view?.mode !== 'form' || !view.form.isDirty()) return true;
  return confirmAction({
    title: 'Abandonner la saisie ?',
    message: 'Ce que tu as saisi ne sera pas enregistré.',
    confirmLabel: 'Abandonner',
    cancelLabel: 'Continuer la saisie',
    danger: true,
  });
}

async function requestClose() {
  if (await confirmDiscardIfNeeded()) closeModal(getDialog());
}

// ---------------------------------------------------------------
// Mode « fiche de détails »
// ---------------------------------------------------------------

function showDetails(entryId, notice = null) {
  const entry = getEntry(entryId);
  if (!entry) {
    closeModal(getDialog());
    return;
  }
  view = { mode: 'details', entryId, version: entry.updatedAt };
  const content = renderEntryDetails(entry, {
    notice,
    onEdit: () => showForm({ entry }),
    onDelete: () => removeEntry(entry),
    onToggleDone: () => toggleTaskDone(entry.id).catch((error) => {
      console.error(error);
      showDetails(entry.id, SAVE_ERROR);
    }),
  });
  return renderShell(entry.title, content);
}

async function removeEntry(entry) {
  const isEvent = entry.type === 'event';
  const confirmed = await confirmAction({
    title: isEvent ? 'Supprimer ce rendez-vous ?' : 'Supprimer cette tâche ?',
    message: isEvent
      ? `Le rendez-vous « ${entry.title} » sera supprimé définitivement.`
      : `La tâche « ${entry.title} » sera supprimée définitivement.`,
    confirmLabel: 'Supprimer',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await deleteEntry(entry.id);
    closeModal(getDialog());
    showToast(entry.type === 'event' ? 'Rendez-vous supprimé.' : 'Tâche supprimée.');
  } catch (error) {
    console.error(error);
    showDetails(entry.id, { text: 'La suppression a échoué. Réessaie.', isError: true });
  }
}

// ---------------------------------------------------------------
// Mode « formulaire »
// ---------------------------------------------------------------

function showForm({ entry = null, type = 'event', defaultDate }) {
  let heading = null;
  const form = renderEntryForm({
    entry,
    type,
    defaultDate,
    onTypeChange: (newType) => {
      heading.textContent = NEW_TITLES[newType];
    },
    onCancel: async () => {
      if (!(await confirmDiscardIfNeeded())) return;
      if (entry) showDetails(entry.id)?.focus();
      else closeModal(getDialog());
    },
    onSubmit: async (built) => {
      await saveEntry(built);
      if (entry) {
        showDetails(built.id, { text: 'Modifications enregistrées.', isError: false })?.focus();
      } else {
        view = null;
        closeModal(getDialog());
        showToast(built.type === 'event' ? 'Rendez-vous ajouté.' : 'Tâche ajoutée.');
      }
    },
  });
  view = { mode: 'form', entryId: entry?.id ?? null, form };
  heading = renderShell(entry ? EDIT_TITLES[entry.type] : NEW_TITLES[type], form.element);
  form.focusFirstField();
}

// ---------------------------------------------------------------
// Fonctions utilisées par le reste de l'application
// ---------------------------------------------------------------

export function initEntryPanel() {
  const dialog = getDialog();

  // Touche Échap : même comportement que le bouton Fermer.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    requestClose();
  });

  dialog.addEventListener('close', () => {
    view = null;
    dialog.replaceChildren();
  });

  // Si l'entrée affichée change (case cochée, autre onglet…), on rafraîchit la fiche.
  onEntriesChange(() => {
    if (view?.mode !== 'details') return;
    const entry = getEntry(view.entryId);
    if (!entry) closeModal(dialog);
    else if (entry.updatedAt !== view.version) keepFocus(dialog, () => showDetails(entry.id));
  });
}

/** Ouvre le formulaire de création. `type` : 'event' ou 'task'. */
export function openNewEntry(type, { defaultDate } = {}) {
  showForm({ type, defaultDate });
  openModal(getDialog());
  view.form.focusFirstField();
}

/** Ouvre la fiche de détails d'une entrée. */
export function openEntryDetails(entryId) {
  const heading = showDetails(entryId);
  if (!heading) return;
  openModal(getDialog());
  heading.focus();
}
