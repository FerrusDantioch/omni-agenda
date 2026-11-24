// =============================================================
// ui/entry-form.js — Formulaire d'un rendez-vous ou d'une tâche
// -------------------------------------------------------------
// Sert à créer une entrée ou à la modifier. Les messages
// d'erreur sont écrits en français, sous le champ concerné.
// =============================================================

import { el, setText } from './dom.js';
import {
  LIMITS, PRIORITIES, REMINDER_OPTIONS, DEFAULT_PRIORITY, buildEntry, getEventSchedule,
} from '../entries.js';
import {
  formatISODateLong, isValidISODate, isValidTime, minutesToTime, normalizeTime, timeToMinutes, todayISO,
} from '../dates.js';
import {
  MAX_RECURRENCE_COUNT, MAX_RECURRENCE_INTERVAL, RECURRENCE_FREQS,
} from '../recurrence.js';
import { createRichEditor } from './editor.js';
import { notificationPermission } from '../notifications.js';

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
 * Champ « Description » : étiquette, barre d'outils et zone enrichie.
 * (Une étiquette <label> ne fonctionne pas avec une zone « contenteditable » :
 * on relie l'étiquette par aria-labelledby, et un clic dessus place le curseur.)
 */
function makeDescriptionField(initialHtml) {
  const id = `champ-description-${++idCounter}`;
  const labelId = `${id}-etiquette`;
  const errorNode = el('p', { class: 'field-error', id: `${id}-erreur`, hidden: true });
  const editor = createRichEditor({ id, labelId, describedBy: errorNode.id, initialHtml });
  const label = el('span', { class: 'field-label', id: labelId, onclick: () => editor.focus() }, 'Description');
  return {
    editor,
    field: el('div', { class: 'field', 'data-field': 'description' }, label, editor.element, errorNode),
  };
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

/**
 * Sous le choix du rappel : si les rappels ne sont pas encore autorisés,
 * on explique comment les recevoir.
 */
function reminderHint(select) {
  const hint = el('p', { class: 'field-hint' });
  const update = () => {
    const permission = notificationPermission();
    if (select.value === '' || permission === 'granted') setText(hint, '');
    else if (permission === 'unsupported') setText(hint, 'Ce navigateur ne peut pas afficher de rappels.');
    else if (permission === 'denied') setText(hint, 'Les rappels sont bloqués par le navigateur : voir Réglages → Rappels.');
    else setText(hint, 'Pour recevoir ce rappel, autorise les rappels dans Réglages → Rappels.');
    hint.hidden = hint.textContent === '';
  };
  select.addEventListener('change', update);
  update();
  return hint;
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
  const initialAllDay = Boolean(entry?.type === 'event' && entry.allDay);
  const initialDate = schedule ? schedule.startDate : defaultDate;
  const initialStart = schedule?.startTime ?? suggestStartTime(initialDate);
  const initialEnd = schedule?.endTime ?? minutesToTime(timeToMinutes(initialStart) + 60);
  let stashedStart = initialStart;
  let stashedEnd = initialEnd;

  // ----- Zones de saisie -----
  const titleInput = el('input', { type: 'text', maxlength: LIMITS.title, autocomplete: 'off', value: entry?.title ?? '' });
  const dateInput = el('input', { type: 'date', min: '1900-01-01', max: '2200-12-31', value: initialDate });
  const allDayInput = el('input', { type: 'checkbox', name: 'allDay', checked: initialAllDay });
  const endDateInput = el('input', {
    type: 'date',
    min: '1900-01-01',
    max: '2200-12-31',
    value: initialAllDay && entry?.endDate && entry.endDate !== entry.date ? entry.endDate : '',
  });
  const startInput = el('input', { type: 'time', value: initialAllDay ? '' : initialStart });
  const endInput = el('input', { type: 'time', value: initialAllDay ? '' : initialEnd });
  const locationInput = el('input', { type: 'text', maxlength: LIMITS.location, autocomplete: 'off', value: entry?.location ?? '' });

  const currentReminder = entry?.type === 'event' ? entry.reminderMinutes : null;
  const reminderSelect = el('select', {},
    REMINDER_OPTIONS.map((option) =>
      el('option', { value: option.minutes ?? '', selected: option.minutes === currentReminder }, option.label),
    ),
  );

  const initialRecurrence = entry?.type === 'event' ? entry.recurrence : null;
  const initialFreq = initialRecurrence?.freq ?? '';
  const initialEndMode = initialRecurrence?.until ? 'until' : initialRecurrence?.count ? 'count' : 'never';
  const recurrenceFreqSelect = el('select', {},
    el('option', { value: '', selected: initialFreq === '' }, 'Aucune'),
    ...Object.entries(RECURRENCE_FREQS).map(([id, label]) =>
      el('option', { value: id, selected: id === initialFreq }, label),
    ),
  );
  const recurrenceIntervalInput = el('input', {
    type: 'number',
    min: '1',
    max: String(MAX_RECURRENCE_INTERVAL),
    step: '1',
    inputmode: 'numeric',
    value: String(initialRecurrence?.interval ?? 1),
  });
  const recurrenceEndModeSelect = el('select', {},
    el('option', { value: 'never', selected: initialEndMode === 'never' }, 'Sans date de fin'),
    el('option', { value: 'until', selected: initialEndMode === 'until' }, "Jusqu'au…"),
    el('option', { value: 'count', selected: initialEndMode === 'count' }, 'Nombre de répétitions…'),
  );
  const recurrenceUntilInput = el('input', {
    type: 'date',
    min: '1900-01-01',
    max: '2200-12-31',
    value: initialRecurrence?.until ?? '',
  });
  const recurrenceCountInput = el('input', {
    type: 'number',
    min: '1',
    max: String(MAX_RECURRENCE_COUNT),
    step: '1',
    inputmode: 'numeric',
    value: initialRecurrence?.count ? String(initialRecurrence.count) : '10',
  });

  const dueInput = el('input', { type: 'date', min: '1900-01-01', max: '2200-12-31', value: entry ? (entry.type === 'task' ? entry.dueDate ?? '' : '') : defaultDueDate });
  const clearDueButton = el('button', { type: 'button', class: 'btn btn-ghost btn-small' }, "Retirer l'échéance");
  const doneInput = el('input', { type: 'checkbox', name: 'done', checked: entry?.type === 'task' && entry.done });
  const description = makeDescriptionField(entry?.description ?? '');

  const overnightHint = el('p', { class: 'field-hint', hidden: true }, 'Le rendez-vous se termine le lendemain (il passe minuit).');
  const allDayHint = el('p', { class: 'field-hint', hidden: !initialAllDay }, 'Cet événement dure toute la journée (sans horaire précis).');
  const formError = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const submitButton = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Enregistrer');

  // ----- Sections propres à chaque type -----
  const endDateField = makeField('endDate', 'Date de fin (facultative)', endDateInput, {
    hint: dateReadout(endDateInput, 'Laisse vide pour un seul jour.'),
  });
  const timeRow = el('div', { class: 'field-row' },
    makeField('startTime', 'Début', startInput, { required: true }),
    makeField('endTime', 'Fin', endInput, { required: true }),
  );
  const recurrenceIntervalField = makeField('recurrenceInterval', 'Tous les (intervalle)', recurrenceIntervalInput);
  const recurrenceEndModeField = makeField('recurrenceEndMode', 'Fin de répétition', recurrenceEndModeSelect);
  const recurrenceUntilField = makeField('recurrenceUntil', 'Répéter jusqu’au', recurrenceUntilInput, {
    hint: dateReadout(recurrenceUntilInput),
  });
  const recurrenceCountField = makeField('recurrenceCount', 'Nombre de répétitions', recurrenceCountInput);
  const recurrenceDetails = el('div', { class: 'field-row' },
    recurrenceIntervalField,
    recurrenceEndModeField,
  );

  const eventSection = el('div', { class: 'form-section' },
    makeField('date', 'Date', dateInput, { required: true, hint: dateReadout(dateInput) }),
    el('div', { class: 'field', 'data-field': 'allDay' },
      el('label', { class: 'checkbox-row' }, allDayInput, el('span', {}, 'Journée entière')),
      allDayHint,
    ),
    endDateField,
    timeRow,
    overnightHint,
    makeField('location', 'Lieu', locationInput),
    makeField('reminderMinutes', 'Rappel', reminderSelect, { hint: reminderHint(reminderSelect) }),
    makeField('recurrenceFreq', 'Répétition', recurrenceFreqSelect),
    recurrenceDetails,
    recurrenceUntilField,
    recurrenceCountField,
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
      description.field,
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

  const clearFieldError = (fieldName) => {
    const field = form.querySelector(`[data-field="${fieldName}"]`);
    if (!field) return;
    const errorNode = field.querySelector('.field-error');
    if (errorNode) {
      errorNode.hidden = true;
      errorNode.textContent = '';
    }
    for (const control of field.querySelectorAll('[aria-invalid]')) control.removeAttribute('aria-invalid');
  };

  const updateOvernightHint = () => {
    if (allDayInput.checked) {
      overnightHint.hidden = true;
      return;
    }
    const start = normalizeTime(startInput.value);
    const end = normalizeTime(endInput.value);
    overnightHint.hidden = !(isValidTime(start) && isValidTime(end) && end < start);
  };

  // Quand on change l'heure de début, la fin suit en gardant la même durée.
  let previousStart = normalizeTime(startInput.value);
  startInput.addEventListener('change', () => {
    const start = normalizeTime(startInput.value);
    const end = normalizeTime(endInput.value);
    if (isValidTime(previousStart) && isValidTime(start) && isValidTime(end)) {
      const duration = (timeToMinutes(end) - timeToMinutes(previousStart) + 1440) % 1440 || 60;
      endInput.value = minutesToTime(timeToMinutes(start) + duration);
    }
    previousStart = start;
    updateOvernightHint();
  });
  endInput.addEventListener('change', updateOvernightHint);

  const syncAllDay = ({ restore = true } = {}) => {
    const isAllDay = allDayInput.checked;
    if (isAllDay) {
      if (isValidTime(normalizeTime(startInput.value))) stashedStart = normalizeTime(startInput.value);
      if (isValidTime(normalizeTime(endInput.value))) stashedEnd = normalizeTime(endInput.value);
      startInput.disabled = true;
      endInput.disabled = true;
      startInput.value = '';
      endInput.value = '';
      timeRow.hidden = true;
      overnightHint.hidden = true;
      endDateField.hidden = false;
      endDateInput.disabled = false;
      allDayHint.hidden = false;
      clearFieldError('startTime');
      clearFieldError('endTime');
    } else {
      startInput.disabled = false;
      endInput.disabled = false;
      timeRow.hidden = false;
      endDateField.hidden = true;
      endDateInput.disabled = true;
      allDayHint.hidden = true;
      clearFieldError('endDate');
      if (restore && !startInput.value && !endInput.value) {
        const fallbackStart = stashedStart || suggestStartTime(dateInput.value || defaultDate);
        startInput.value = fallbackStart;
        endInput.value = stashedEnd || minutesToTime(timeToMinutes(fallbackStart) + 60);
      }
      previousStart = normalizeTime(startInput.value);
      updateOvernightHint();
    }
  };
  allDayInput.addEventListener('change', () => syncAllDay({ restore: true }));
  syncAllDay({ restore: false });

  const syncRecurrence = () => {
    const hasFreq = recurrenceFreqSelect.value !== '';
    recurrenceDetails.hidden = !hasFreq;
    recurrenceIntervalInput.disabled = !hasFreq;
    recurrenceEndModeSelect.disabled = !hasFreq;
    if (!hasFreq) {
      recurrenceUntilField.hidden = true;
      recurrenceUntilInput.disabled = true;
      recurrenceCountField.hidden = true;
      recurrenceCountInput.disabled = true;
      clearFieldError('recurrenceInterval');
      clearFieldError('recurrenceEndMode');
      clearFieldError('recurrenceUntil');
      clearFieldError('recurrenceCount');
      return;
    }
    if (!recurrenceIntervalInput.value) recurrenceIntervalInput.value = '1';
    const endMode = recurrenceEndModeSelect.value;
    recurrenceUntilField.hidden = endMode !== 'until';
    recurrenceUntilInput.disabled = endMode !== 'until';
    recurrenceCountField.hidden = endMode !== 'count';
    recurrenceCountInput.disabled = endMode !== 'count';
    if (endMode === 'count' && !recurrenceCountInput.value) recurrenceCountInput.value = '10';
    if (endMode !== 'until') clearFieldError('recurrenceUntil');
    if (endMode !== 'count') clearFieldError('recurrenceCount');
  };
  recurrenceFreqSelect.addEventListener('change', syncRecurrence);
  recurrenceEndModeSelect.addEventListener('change', syncRecurrence);
  syncRecurrence();

  clearDueButton.addEventListener('click', () => {
    dueInput.value = '';
    dueInput.dispatchEvent(new Event('input', { bubbles: true }));
    dueInput.focus();
  });

  // « Photo » des valeurs saisies (sans le type), pour savoir si
  // quelque chose a changé depuis l'ouverture du formulaire.
  const snapshot = () => JSON.stringify([
    titleInput.value, dateInput.value, allDayInput.checked, endDateInput.value,
    startInput.value, endInput.value, locationInput.value, reminderSelect.value,
    recurrenceFreqSelect.value, recurrenceIntervalInput.value, recurrenceEndModeSelect.value,
    recurrenceUntilInput.value, recurrenceCountInput.value,
    dueInput.value, form.querySelector('input[name="priority"]:checked')?.value,
    doneInput.checked, description.editor.getHtml(),
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
      setText(errorNode, message);
      errorNode.hidden = false;
      const control = field.querySelector('input, select, textarea, .rich-editor');
      control.setAttribute('aria-invalid', 'true');
      // On garde le premier champ fautif dans l'ordre de la page.
      if (!firstInvalid || (firstInvalid.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_PRECEDING)) {
        firstInvalid = control;
      }
    }
    setText(formError, 'Certains champs sont à corriger.');
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
      description: description.editor.getHtml(),
      date: dateInput.value,
      allDay: allDayInput.checked,
      endDate: allDayInput.checked ? endDateInput.value : null,
      startTime: allDayInput.checked ? null : startInput.value,
      endTime: allDayInput.checked ? null : endInput.value,
      location: locationInput.value,
      reminderMinutes: reminderSelect.value,
      recurrenceFreq: recurrenceFreqSelect.value,
      recurrenceInterval: recurrenceIntervalInput.value,
      recurrenceEndMode: recurrenceEndModeSelect.value,
      recurrenceUntil: recurrenceUntilInput.value,
      recurrenceCount: recurrenceCountInput.value,
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
      setText(formError, "L'enregistrement a échoué. Réessaie. Si le problème continue, vérifie l'espace libre sur l'appareil.");
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
