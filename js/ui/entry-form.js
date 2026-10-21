// =============================================================
// ui/entry-form.js — Formulaire d'un rendez-vous ou d'une tâche
// -------------------------------------------------------------
// Sert à créer une entrée ou à la modifier. Les messages
// d'erreur sont écrits en français, sous le champ concerné.
// =============================================================

import { el } from './dom.js';
import {
  LIMITS, PRIORITIES, REMINDER_OPTIONS, DEFAULT_PRIORITY, buildEntry, getEventSchedule,
} from '../entries.js';
import {
  formatISODateLong, isValidISODate, isValidTime, minutesToTime, timeToMinutes, todayISO,
} from '../dates.js';
import { htmlToText, textToHtml } from '../sanitize.js';

let idCounter = 0;

/** Un champ complet : étiquette, aide éventuelle, zone de saisie, message d'erreur. */
function makeField(name, labelText, control, { hint = null, required = false } = {}) {
  const id = `champ-${name}-${++idCounter}`;
  control.id = id;
  control.name = name;
  if (required) control.setAttribute('aria-required', 'true');

  // L'aide peut être un texte fixe ou un élément qui se met à jour.
  const hintNode = hint instanceof Node ? hint : hint ? el('p', { class: 'field-hint' }, hint) : null;
  if (hintNode) hintNode.id = `${id}-aide`;
  const errorNode = el('p', { class: 'field-error', id: `${id}-erreur`, hidden: true });
  control.setAttribute('aria-describedby', [hintNode?.id, errorNode.id].filter(Boolean).join(' '));

  return el('div', { class: 'field', 'data-field': name },
    el('label', { for: id }, labelText, required ? el('span', { class: 'field-required' }, ' (obligatoire)') : null),
    control,
    hintNode,
    errorNode,
  );
}

/**
 * Sous un champ de date : la date écrite en toutes lettres
 * (« Mercredi 21 octobre 2026 »), quel que soit le format de l'appareil.
 * `emptyText` s'affiche quand le champ est vide.
 */
function dateReadout(input, emptyText = '') {
  const readout = el('p', { class: 'field-hint date-readout' });
  const update = () => {
    readout.textContent = isValidISODate(input.value) ? formatISODateLong(input.value) : emptyText;
  };
  input.addEventListener('input', update);
  input.addEventListener('change', update);
  update();
  return readout;
}

/** Groupe de boutons ronds présentés en cartes (type, priorité). */
function makeChoiceGroup(name, legend, options, selectedId) {
  return el('fieldset', { class: 'field' },
    el('legend', {}, legend),
    el('div', { class: 'choices choices-compact' },
      options.map((option) =>
        el('label', { class: 'choice-card' },
          el('input', { type: 'radio', name, value: option.id, checked: option.id === selectedId }),
          el('span', { class: 'choice-title' }, option.label),
        ),
      ),
    ),
  );
}

/** Heure de début proposée : l'heure pile suivante aujourd'hui, sinon 9 h. */
function suggestStartTime(dateISO) {
  const nextHour = new Date().getHours() + 1;
  return dateISO === todayISO() && nextHour <= 23 ? minutesToTime(nextHour * 60) : '09:00';
}

/**
 * Fabrique le formulaire.
 *  - entry : l'entrée à modifier (null pour une nouvelle) ;
 *  - type : 'event' ou 'task' (pour une nouvelle entrée) ;
 *  - defaultDate : date proposée pour un nouveau rendez-vous ;
 *  - defaultDueDate : échéance proposée pour une nouvelle tâche ('' = aucune) ;
 *  - onTypeChange(type), onSubmit(entry) (asynchrone), onCancel().
 * Renvoie { element, isDirty(), focusFirstField() }.
 */
export function renderEntryForm({
  entry = null, type = 'event', defaultDate = todayISO(), defaultDueDate = '', onTypeChange, onSubmit, onCancel,
}) {
  const isNew = !entry;
  let currentType = entry ? entry.type : type;

  // ----- Valeurs de départ -----
  const schedule = entry?.type === 'event' ? getEventSchedule(entry) : null;
  const initialStart = schedule ? schedule.startTime : suggestStartTime(defaultDate);

  // ----- Zones de saisie -----
  const titleInput = el('input', { type: 'text', maxlength: LIMITS.title, autocomplete: 'off', value: entry?.title ?? '' });
  const dateInput = el('input', { type: 'date', min: '1900-01-01', max: '2200-12-31', value: schedule ? schedule.startDate : defaultDate });
  const startInput = el('input', { type: 'time', value: initialStart });
  const endInput = el('input', { type: 'time', value: schedule ? schedule.endTime : minutesToTime(timeToMinutes(initialStart) + 60) });
  const locationInput = el('input', { type: 'text', maxlength: LIMITS.location, autocomplete: 'off', value: entry?.location ?? '' });

  const currentReminder = entry?.type === 'event' ? entry.reminderMinutes : null;
  const reminderSelect = el('select', {},
    REMINDER_OPTIONS.map((option) =>
      el('option', { value: option.minutes ?? '', selected: option.minutes === currentReminder }, option.label),
    ),
  );

  const dueInput = el('input', { type: 'date', min: '1900-01-01', max: '2200-12-31', value: entry ? (entry.type === 'task' ? entry.dueDate ?? '' : '') : defaultDueDate });
  const clearDueButton = el('button', { type: 'button', class: 'btn btn-ghost btn-small' }, "Retirer l'échéance");
  const doneInput = el('input', { type: 'checkbox', name: 'done', checked: entry?.type === 'task' && entry.done });
  const descriptionInput = el('textarea', { rows: 5, maxlength: LIMITS.description }, entry ? htmlToText(entry.description) : '');

  const overnightHint = el('p', { class: 'field-hint', hidden: true }, 'Le rendez-vous se termine le lendemain (il passe minuit).');
  const formError = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const submitButton = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Enregistrer');

  // ----- Sections propres à chaque type -----
  const eventSection = el('div', { class: 'form-section' },
    makeField('date', 'Date', dateInput, { required: true, hint: dateReadout(dateInput) }),
    el('div', { class: 'field-row' },
      makeField('startTime', 'Début', startInput, { required: true }),
      makeField('endTime', 'Fin', endInput, { required: true }),
    ),
    overnightHint,
    makeField('location', 'Lieu', locationInput),
    makeField('reminderMinutes', 'Rappel', reminderSelect),
  );

  const taskSection = el('div', { class: 'form-section' },
    makeField('dueDate', 'Échéance', dueInput, { hint: dateReadout(dueInput, "Laisse vide s'il n'y a pas de date limite.") }),
    clearDueButton,
    makeChoiceGroup('priority', 'Priorité', PRIORITIES, entry?.type === 'task' ? entry.priority : DEFAULT_PRIORITY),
    el('label', { class: 'checkbox-row' }, doneInput, el('span', {}, 'Tâche terminée')),
  );

  const typeSwitch = isNew
    ? makeChoiceGroup('type', "Type d'entrée", [{ id: 'event', label: 'Rendez-vous' }, { id: 'task', label: 'Tâche' }], currentType)
    : null;

  const form = el('form', { class: 'panel-content', novalidate: true },
    el('div', { class: 'panel-body' },
      typeSwitch,
      makeField('title', 'Titre', titleInput, { required: true }),
      eventSection,
      taskSection,
      makeField('description', 'Description', descriptionInput),
      formError,
    ),
    el('div', { class: 'panel-footer' },
      el('button', { type: 'button', class: 'btn', onclick: () => onCancel() }, 'Annuler'),
      submitButton,
    ),
  );

  // ----- Comportements -----
  const showSectionsFor = (selectedType) => {
    currentType = selectedType;
    eventSection.hidden = selectedType !== 'event';
    taskSection.hidden = selectedType !== 'task';
  };
  showSectionsFor(currentType);

  typeSwitch?.addEventListener('change', (event) => {
    showSectionsFor(event.target.value);
    onTypeChange?.(event.target.value);
  });

  const updateOvernightHint = () => {
    overnightHint.hidden = !(isValidTime(startInput.value) && isValidTime(endInput.value) && endInput.value < startInput.value);
  };
  updateOvernightHint();

  // Quand on change l'heure de début, la fin suit en gardant la même durée.
  let previousStart = startInput.value;
  startInput.addEventListener('change', () => {
    if (isValidTime(previousStart) && isValidTime(startInput.value) && isValidTime(endInput.value)) {
      const duration = (timeToMinutes(endInput.value) - timeToMinutes(previousStart) + 1440) % 1440 || 60;
      endInput.value = minutesToTime(timeToMinutes(startInput.value) + duration);
    }
    previousStart = startInput.value;
    updateOvernightHint();
  });
  endInput.addEventListener('change', updateOvernightHint);

  clearDueButton.addEventListener('click', () => {
    dueInput.value = '';
    dueInput.dispatchEvent(new Event('input', { bubbles: true }));
    dueInput.focus();
  });

  // « Photo » des valeurs saisies (sans le type), pour savoir si
  // quelque chose a changé depuis l'ouverture du formulaire.
  const snapshot = () => JSON.stringify([
    titleInput.value, dateInput.value, startInput.value, endInput.value, locationInput.value,
    reminderSelect.value, dueInput.value, form.querySelector('input[name="priority"]:checked')?.value,
    doneInput.checked, descriptionInput.value,
  ]);
  let savedSnapshot = snapshot();

  // ----- Erreurs -----
  const clearErrors = () => {
    formError.hidden = true;
    for (const error of form.querySelectorAll('.field-error')) {
      error.hidden = true;
      error.textContent = '';
    }
    for (const control of form.querySelectorAll('[aria-invalid]')) control.removeAttribute('aria-invalid');
  };

  const showErrors = (errors) => {
    let firstInvalid = null;
    for (const [name, message] of Object.entries(errors)) {
      const field = form.querySelector(`[data-field="${name}"]`);
      if (!field) continue;
      const errorNode = field.querySelector('.field-error');
      errorNode.textContent = message;
      errorNode.hidden = false;
      const control = field.querySelector('input, select, textarea');
      control.setAttribute('aria-invalid', 'true');
      // On garde le premier champ fautif dans l'ordre de la page.
      if (!firstInvalid || (firstInvalid.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_PRECEDING)) {
        firstInvalid = control;
      }
    }
    formError.textContent = 'Certains champs sont à corriger.';
    formError.hidden = false;
    firstInvalid?.focus();
  };

  // ----- Enregistrement -----
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();

    const input = {
      type: currentType,
      title: titleInput.value,
      description: textToHtml(descriptionInput.value),
      date: dateInput.value,
      startTime: startInput.value,
      endTime: endInput.value,
      location: locationInput.value,
      reminderMinutes: reminderSelect.value,
      dueDate: dueInput.value,
      priority: form.querySelector('input[name="priority"]:checked')?.value,
      done: doneInput.checked,
    };

    const { entry: built, errors } = buildEntry(input, entry);
    if (Object.keys(errors).length > 0) {
      showErrors(errors);
      return;
    }

    submitButton.disabled = true;
    try {
      await onSubmit(built);
      savedSnapshot = snapshot();
    } catch (error) {
      console.error("Échec de l'enregistrement :", error);
      formError.textContent = "L'enregistrement a échoué. Réessaie. Si le problème continue, vérifie l'espace libre sur l'appareil.";
      formError.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
  });

  return {
    element: form,
    isDirty: () => snapshot() !== savedSnapshot,
    focusFirstField: () => titleInput.focus(),
  };
}
