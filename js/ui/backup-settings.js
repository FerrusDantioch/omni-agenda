// =============================================================
// ui/backup-settings.js — Exporter et importer l'agenda
// -------------------------------------------------------------
// Le bloc « Sauvegarde » de l'écran Réglages :
//  - « Exporter mon agenda » enregistre un fichier .json sur
//    l'appareil (en général dans le dossier Téléchargements).
//    Si un mot de passe est actif, ce fichier est chiffré ;
//  - « Importer un agenda » relit un tel fichier (en demandant son
//    mot de passe s'il est chiffré). Avant de toucher à quoi que ce
//    soit, on montre ce que contient le fichier et on demande :
//    « Fusionner » ou « Remplacer ». « Remplacer » demande en plus
//    une confirmation, car il efface l'agenda actuel.
// =============================================================

import { el, showNotice } from './dom.js';
import { chooseAction, confirmAction, openFormDialog } from './dialogs.js';
import { passwordField } from './password-field.js';
import { getSetting, setSetting } from '../storage.js';
import { getEntries, replaceAllEntries, saveEntries } from '../entry-store.js';
import { getExportProtection } from '../security.js';
import { formatMoment, toISODate } from '../dates.js';
import {
  BackupError, MAX_BACKUP_BYTES, backupFileName, createBackup, createEncryptedBackup, decryptBackup,
  describeCount, describeEntries, parseBackup, planMerge, serializeBackup,
} from '../backup.js';

const LAST_EXPORT_SETTING = 'lastExportAt';
const CANCELLED = "Import annulé : ton agenda n'a pas changé.";

// Vrai pendant un import : on évite d'en lancer un deuxième en même temps.
let busy = false;

// ---------------------------------------------------------------
// Messages affichés sous les boutons
// ---------------------------------------------------------------

/** Affiche un message (un texte ou une liste de textes) sous les boutons. */
function showMessage(lines) {
  showNotice(document.getElementById('message-sauvegarde'), lines);
}

function showError(lines) {
  showNotice(document.getElementById('message-sauvegarde'), lines, { isError: true });
}

function setBusy(value) {
  busy = value;
  document.getElementById('bouton-exporter').disabled = value;
  document.getElementById('bouton-importer').disabled = value;
}

/** « 1 élément abîmé ou en double a été ignoré. » (ou null s'il n'y en a pas). */
function skippedText(count) {
  if (count === 0) return null;
  return count > 1
    ? `${describeCount(count)} abîmés ou en double ont été ignorés.`
    : `${describeCount(count)} abîmé ou en double a été ignoré.`;
}

// ---------------------------------------------------------------
// Export
// ---------------------------------------------------------------

/** Indique la date du dernier export. */
async function showLastExport() {
  const line = document.getElementById('derniere-sauvegarde');
  let lastExport = null;
  try {
    lastExport = await getSetting(LAST_EXPORT_SETTING, null);
  } catch {
    // Stockage indisponible : on affiche simplement le texte par défaut.
  }
  line.textContent = typeof lastExport === 'string' && !Number.isNaN(Date.parse(lastExport))
    ? `Dernier export : le ${formatMoment(new Date(lastExport))}.`
    : "Tu n'as encore jamais exporté ton agenda.";
}

/** Fait « télécharger » un fichier fabriqué ici même (rien ne passe par internet). */
function downloadFile(fileName, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = el('a', { href: url, download: fileName, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  // On libère la mémoire un peu plus tard, une fois le téléchargement lancé.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function exportAgenda() {
  if (busy) return;
  const entries = getEntries();
  if (entries.length === 0) {
    showMessage("Ton agenda est vide : il n'y a encore rien à exporter.");
    return;
  }

  const now = new Date();
  const fileName = backupFileName(toISODate(now));
  // Mot de passe actif : le fichier est chiffré avec la même clé que l'agenda.
  const protection = getExportProtection();
  setBusy(true);
  try {
    const backup = protection ? await createEncryptedBackup(entries, now, protection) : createBackup(entries, now);
    downloadFile(fileName, serializeBackup(backup));
  } catch (error) {
    console.error(error);
    showError("L'export a échoué. Réessaie.");
    return;
  } finally {
    setBusy(false);
  }
  showMessage([
    `C'est fait : ton agenda (${describeEntries(entries)}) a été exporté dans le fichier « ${fileName} ».`,
    'Tu le trouveras en général dans le dossier « Téléchargements » de ton appareil.',
    protection
      ? "Ce fichier est chiffré : pour l'importer, il faudra ton mot de passe actuel."
      : "Ce fichier n'est pas chiffré : toute personne qui l'a peut le lire. Garde-le en lieu sûr.",
  ]);

  setSetting(LAST_EXPORT_SETTING, now.toISOString())
    .then(showLastExport)
    .catch((error) => console.warn("Date d'export non mémorisée :", error));
}

// ---------------------------------------------------------------
// Import
// ---------------------------------------------------------------

/** Explication du choix « Fusionner », selon ce qui changerait. */
function mergeDescription(plan) {
  const added = plan.added.length;
  const updated = plan.updated.length;
  if (added === 0 && updated === 0) return 'Ton agenda contient déjà tout ce fichier : rien ne changera.';
  const newer = 'avec la version plus récente du fichier';
  let sentence;
  if (updated === 0) sentence = `Ajoute ${describeCount(added)}.`;
  else if (added === 0) sentence = `Met à jour ${describeCount(updated)} ${newer}.`;
  else sentence = `Ajoute ${describeCount(added)} et en met ${updated} à jour ${newer}.`;
  return `${sentence} Rien n'est supprimé.`;
}

/** Explication du choix « Remplacer ». */
function replaceDescription(currentEntries) {
  if (currentEntries.length === 0) return 'Ton agenda actuel est vide : il recevra simplement le contenu du fichier.';
  return `Efface ton agenda actuel (${describeCount(currentEntries.length)}) et le remplace par le contenu du fichier.`;
}

/** Résultat d'une fusion, ex. : « Import terminé : 3 éléments ajoutés et 1 mis à jour. » */
function mergeResultText(plan) {
  const added = plan.added.length;
  const updated = plan.updated.length;
  if (added === 0 && updated === 0) return "Import terminé : rien n'a changé, ton agenda contenait déjà tout ce fichier.";
  const parts = [];
  if (added > 0) parts.push(`${describeCount(added)} ${added > 1 ? 'ajoutés' : 'ajouté'}`);
  if (updated > 0) parts.push(added > 0 ? `${updated} mis à jour` : `${describeCount(updated)} mis à jour`);
  return `Import terminé : ${parts.join(' et ')}.`;
}

/**
 * Fichier chiffré : demande son mot de passe, puis l'ouvre.
 * Renvoie la sauvegarde lisible, ou null si l'utilisateur annule.
 * Lance une BackupError si le fichier est abîmé.
 */
async function openSealedBackup(backup, fileName) {
  const field = passwordField({ label: 'Mot de passe du fichier', autocomplete: 'current-password' });
  let opened = null;
  let damaged = null;
  const confirmed = await openFormDialog({
    title: 'Fichier protégé',
    message: [
      `Le fichier « ${fileName} » est chiffré.`,
      'Écris le mot de passe qui était actif quand ce fichier a été exporté.',
    ],
    content: [field.element],
    submitLabel: 'Ouvrir le fichier',
    onSubmit: async () => {
      if (!field.input.value) return { message: 'Écris le mot de passe.', input: field.input };
      try {
        opened = await decryptBackup(backup, field.input.value);
      } catch (error) {
        if (!(error instanceof BackupError)) throw error;
        damaged = error;
        return null;
      }
      return opened ? null : { message: 'Mot de passe incorrect. Réessaie.', input: field.input };
    },
  });
  if (damaged) throw damaged;
  return confirmed ? opened : null;
}

/** Lit le fichier choisi, demande quoi faire, puis importe. */
async function importFile(file) {
  if (busy) return;
  document.getElementById('message-sauvegarde').replaceChildren();

  if (file.size > MAX_BACKUP_BYTES) {
    showError("Ce fichier est trop gros pour être une sauvegarde d'Omni-Agenda.");
    return;
  }

  let backup;
  try {
    backup = parseBackup(await file.text());
    if (backup.encrypted) {
      backup = await openSealedBackup(backup, file.name);
      if (!backup) {
        showMessage(CANCELLED);
        return;
      }
    }
  } catch (error) {
    if (error instanceof BackupError) {
      showError(error.message);
    } else {
      console.error(error);
      showError('Impossible de lire ce fichier. Réessaie.');
    }
    return;
  }

  const skipped = skippedText(backup.skipped);
  if (backup.entries.length === 0) {
    showError(["Ce fichier ne contient aucun rendez-vous ni aucune tâche : il n'y a rien à importer.", skipped]);
    return;
  }

  // 1. On montre ce que contient le fichier, et on demande quoi faire.
  const current = getEntries();
  const exportedAt = backup.exportedAt ? `, exporté le ${formatMoment(new Date(backup.exportedAt))}` : '';
  const choice = await chooseAction({
    title: 'Importer ce fichier ?',
    message: [
      `Fichier « ${file.name} »${exportedAt}.`,
      `Il contient ${describeEntries(backup.entries)}.`,
      skipped,
      current.length > 0 ? `Ton agenda actuel contient ${describeEntries(current)}.` : 'Ton agenda actuel est vide.',
    ].filter(Boolean),
    choices: [
      { value: 'merge', label: 'Fusionner', style: 'primary', description: mergeDescription(planMerge(current, backup.entries)) },
      { value: 'replace', label: 'Remplacer', style: 'danger', description: replaceDescription(current) },
    ],
  });
  if (!choice) {
    showMessage(CANCELLED);
    return;
  }

  // 2. « Remplacer » efface l'agenda actuel : on redemande, en disant ce qui sera perdu.
  if (choice === 'replace' && getEntries().length > 0) {
    const confirmed = await confirmAction({
      title: 'Remplacer ton agenda ?',
      message: [
        `Ton agenda actuel (${describeEntries(getEntries())}) sera effacé définitivement, ` +
          `puis remplacé par le contenu du fichier (${describeEntries(backup.entries)}).`,
        "Si tu as un doute, annule et exporte d'abord ton agenda actuel.",
      ],
      confirmLabel: 'Effacer et remplacer',
      danger: true,
    });
    if (!confirmed) {
      showMessage(CANCELLED);
      return;
    }
  }

  // 3. On importe. L'enregistrement est « tout ou rien » : en cas d'échec, rien ne change.
  setBusy(true);
  try {
    if (choice === 'replace') {
      await replaceAllEntries(backup.entries);
      showMessage([`Import terminé : ton agenda contient maintenant ${describeEntries(backup.entries)}.`, skipped]);
    } else {
      // On recalcule au dernier moment : l'agenda a pu changer entre-temps (autre onglet).
      const plan = planMerge(getEntries(), backup.entries);
      const changes = [...plan.added, ...plan.updated];
      if (changes.length > 0) await saveEntries(changes);
      showMessage([mergeResultText(plan), skipped]);
    }
  } catch (error) {
    console.error(error);
    showError("L'import a échoué : ton agenda n'a pas été modifié. Réessaie.");
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------
// Mise en place
// ---------------------------------------------------------------

export function initBackupSettings() {
  const fileInput = document.getElementById('fichier-a-importer');

  document.getElementById('bouton-exporter').addEventListener('click', () => {
    exportAgenda();
  });
  document.getElementById('bouton-importer').addEventListener('click', () => {
    if (!busy) fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    // On vide le champ : choisir de nouveau le même fichier relancera l'import.
    fileInput.value = '';
    if (file) importFile(file);
  });

  showLastExport();
}
