// =============================================================
// tests.js — Tests automatiques (s'exécutent dans le navigateur)
// -------------------------------------------------------------
// Chaque test vérifie un comportement précis. Un test réussi
// affiche ✓, un test échoué affiche ✗ avec l'explication.
// =============================================================

import {
  MAX_DATE, MIN_DATE, addDays, addMonths, clampDate, daysBetween, daysInMonth, formatDayMonth, formatISODateLong,
  isoWeekNumber, isValidISODate, isValidTime, minutesToTime, normalizeTime, relativeDayLabel,
  startOfWeek, timeToMinutes, wallTimeExists, zonedTimeToInstant, instantToZoned,
} from '../js/dates.js';
import { htmlToText, sanitizeHtml, textToHtml } from '../js/sanitize.js';
import { buildEntry, compareEntries, createId, getEventSchedule, normalizeEntry } from '../js/entries.js';
import {
  BackupError, backupFileName, createBackup, createEncryptedBackup, decryptBackup, describeEntries, parseBackup,
  planMerge, serializeBackup,
} from '../js/backup.js';
import {
  createProtection, decryptJson, encryptJson, fromBase64, isValidProtection, openProtection, toBase64,
} from '../js/crypto.js';
import {
  checkNewPassword, entryToRecord, isLocked, isProtected, isSecurityReady, loadProtection, recordToEntry,
  suspendForBfcache,
} from '../js/security.js';
import {
  clearEntries, deleteEntry, getEntries, getEntriesRevision, getEntriesSnapshot, loadEntries,
  replaceAllEntries, saveEntries, saveEntry,
} from '../js/entry-store.js';
import { initAutoLock, isAutoLockExpired, normalizeAutoLockMinutes } from '../js/auto-lock.js';
import { bindDatabaseLifecycle, REMINDER_SALT_KEY, SHOWN_REMINDERS_KEY } from '../js/storage.js';
import {
  clearShownReminders, getShownReminderCodes, hashReminderKey, rememberShownCode,
} from '../js/notifications.js';
import { getDueReminders, reminderText } from '../js/reminders.js';
import {
  MAX_RECURRENCE_COUNT, MAX_RECURRENCE_INTERVAL, RECURRENCE_FREQS,
  formatRecurrenceLabel, getOccurrencesInRange, occurrenceIndexOnDate, recurrenceShortLabel,
} from '../js/recurrence.js';
import { normalizeSearchText, searchEntries } from '../js/search.js';
import {
  escapeIcsText, exportAgendaIcs, exportEntriesToIcs, foldIcsLine, icsFileName,
} from '../js/ics.js';
import { frenchSpacing, keepFocus } from '../js/ui/dom.js';
import { closeModal, openModal } from '../js/ui/dialogs.js';
import { createRichEditor } from '../js/ui/editor.js';
import { renderEntryDetails } from '../js/ui/entry-details.js';
import { renderEntryForm } from '../js/ui/entry-form.js';
import { passwordField } from '../js/ui/password-field.js';
import { initSearchBar } from '../js/ui/search-bar.js';
import { buildAgendaIndex } from '../js/views/agenda-data.js';
import { createBook } from '../js/views/book.js';
import { dayView } from '../js/views/day-view.js';
import { monthView } from '../js/views/month-view.js';
import { weekView } from '../js/views/week-view.js';

// Les tests sont d'abord enregistrés, puis lancés un par un à la fin
// (certains, comme le chiffrement, prennent un peu de temps).
const tests = [];
const results = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function equal(actual, expected, label = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label ? `${label} : ` : ''}attendu ${e}, obtenu ${a}`);
}

function isTrue(value, label) {
  if (!value) throw new Error(label);
}

/** Instant attendu, écrit en temps universel. */
const utc = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo - 1, d, h, mi)).toISOString();

// ---------------------------------------------------------------
// Dates simples
// ---------------------------------------------------------------
test('Une vraie date est acceptée, le 30 février est refusé', () => {
  equal(isValidISODate('2026-10-21'), true);
  equal(isValidISODate('2026-02-30'), false);
  equal(isValidISODate('2028-02-29'), true, 'année bissextile');
  equal(isValidISODate('2027-02-29'), false, 'année non bissextile');
  equal(isValidISODate('21/10/2026'), false, 'mauvais format');
});

test('Les heures valides vont de 00:00 à 23:59', () => {
  equal(isValidTime('00:00'), true);
  equal(isValidTime('23:59'), true);
  equal(isValidTime('24:00'), false);
  equal(isValidTime('9:00'), false);
});

test("Ajouter des jours fonctionne, y compris autour d'un changement d'heure", () => {
  equal(addDays('2026-03-28', 1), '2026-03-29');
  equal(addDays('2026-03-29', 1), '2026-03-30');
  equal(addDays('2026-10-25', 1), '2026-10-26');
  equal(addDays('2026-12-31', 1), '2027-01-01');
  equal(addDays('2028-03-01', -1), '2028-02-29');
});

test('Conversion heures ↔ minutes (et passage de minuit)', () => {
  equal(timeToMinutes('14:30'), 870);
  equal(minutesToTime(870), '14:30');
  equal(minutesToTime(24 * 60 + 30), '00:30');
  equal(minutesToTime(-30), '23:30');
});

// ---------------------------------------------------------------
// Fuseaux horaires et changements d'heure
// ---------------------------------------------------------------
test('Paris : 14:00 en hiver = 13:00 en temps universel', () => {
  equal(zonedTimeToInstant('2026-03-28', '14:00', 'Europe/Paris').toISOString(), utc(2026, 3, 28, 13, 0));
});

test("Paris : 14:00 le jour du passage à l'heure d'été = 12:00 universel", () => {
  equal(zonedTimeToInstant('2026-03-29', '14:00', 'Europe/Paris').toISOString(), utc(2026, 3, 29, 12, 0));
});

test("Paris : 02:30 n'existe pas le 29 mars 2026 (on avance à 03:30)", () => {
  equal(wallTimeExists('2026-03-29', '02:30', 'Europe/Paris'), false);
  const instant = zonedTimeToInstant('2026-03-29', '02:30', 'Europe/Paris');
  equal(instantToZoned(instant, 'Europe/Paris'), { date: '2026-03-29', time: '03:30' });
});

test("Paris : 02:30 existe deux fois le 25 octobre 2026 (on prend la première)", () => {
  equal(wallTimeExists('2026-10-25', '02:30', 'Europe/Paris'), true);
  equal(zonedTimeToInstant('2026-10-25', '02:30', 'Europe/Paris').toISOString(), utc(2026, 10, 25, 0, 30));
});

test("Paris : 14:00 après le passage à l'heure d'hiver = 13:00 universel", () => {
  equal(zonedTimeToInstant('2026-10-25', '14:00', 'Europe/Paris').toISOString(), utc(2026, 10, 25, 13, 0));
});

test('New York : heure d’été et heure d’hiver', () => {
  equal(zonedTimeToInstant('2026-07-01', '09:00', 'America/New_York').toISOString(), utc(2026, 7, 1, 13, 0));
  equal(zonedTimeToInstant('2026-12-01', '09:00', 'America/New_York').toISOString(), utc(2026, 12, 1, 14, 0));
});

test('Inde : décalage d’une demi-heure, sans changement d’heure', () => {
  equal(zonedTimeToInstant('2026-01-15', '10:00', 'Asia/Kolkata').toISOString(), utc(2026, 1, 15, 4, 30));
});

test('Un rendez-vous à 14:00 reste à 14:00 après le changement d’heure (même fuseau)', () => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const event = normalizeEntry({
    id: 'test-1', type: 'event', title: 'Dentiste', date: '2026-11-10', startTime: '14:00', endTime: '15:00', timeZone: zone,
  });
  const schedule = getEventSchedule(event);
  equal([schedule.startTime, schedule.endTime, schedule.shifted], ['14:00', '15:00', false]);
});

test('Un rendez-vous créé à New York est converti au bon instant', () => {
  const event = normalizeEntry({
    id: 'test-2', type: 'event', title: 'Appel', date: '2026-07-01', startTime: '09:00', endTime: '10:00', timeZone: 'America/New_York',
  });
  const schedule = getEventSchedule(event);
  equal(schedule.start.toISOString(), utc(2026, 7, 1, 13, 0));
  equal(schedule.end.toISOString(), utc(2026, 7, 1, 14, 0));
});

test('Un rendez-vous 22:00 → 01:00 se termine le lendemain', () => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const event = normalizeEntry({
    id: 'test-3', type: 'event', title: 'Soirée', date: '2026-12-31', startTime: '22:00', endTime: '01:00', timeZone: zone,
  });
  const schedule = getEventSchedule(event);
  equal([schedule.startDate, schedule.endDate], ['2026-12-31', '2027-01-01']);
  equal(schedule.end - schedule.start, 3 * 3600000, 'durée de 3 heures');
});

// ---------------------------------------------------------------
// Protection contre l'injection de code
// ---------------------------------------------------------------
test('Un <script> est supprimé avec son contenu', () => {
  equal(sanitizeHtml('<script>alert(1)</script>Bonjour'), 'Bonjour');
});

test('Une image piégée (onerror) est supprimée', () => {
  equal(sanitizeHtml('<img src="x" onerror="alert(1)">Texte'), 'Texte');
});

test('Le gras est gardé, mais sans ses attributs', () => {
  equal(sanitizeHtml('<b onclick="alert(1)" style="color:red">Gras</b>'), '<strong>Gras</strong>');
});

test('Le souligné est gardé', () => {
  equal(sanitizeHtml('<u>Important</u>'), '<u>Important</u>');
});

test('Le surlignage garde uniquement une couleur autorisée', () => {
  equal(sanitizeHtml('<mark class="hl-vert autre">x</mark>'), '<mark class="hl-vert">x</mark>');
  equal(sanitizeHtml('<mark style="background:red">x</mark>'), '<mark class="hl-jaune">x</mark>');
});

test('Un lien « javascript: » perd sa balise, le texte reste', () => {
  equal(sanitizeHtml('<a href="javascript:alert(1)">lien</a>'), 'lien');
});

test('Les blocs <div> deviennent des retours à la ligne', () => {
  equal(sanitizeHtml('a<div>b</div><div><br></div><div>c</div>'), 'a<br>b<br><br>c');
});

test('SVG, style, iframe et noscript sont supprimés', () => {
  equal(sanitizeHtml('<svg><script>alert(1)</script></svg><style>*{}</style><iframe src="x"></iframe><noscript>n</noscript>ok'), 'ok');
});

test('Un texte qui ressemble à du code reste du texte', () => {
  equal(sanitizeHtml('&lt;script&gt;alert(1)&lt;/script&gt;'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  equal(textToHtml('a <b>\nc'), 'a &lt;b&gt;<br>c');
  equal(htmlToText('a<br>b &amp; c'), 'a\nb & c');
});

test('Les mises en forme imbriquées sont conservées', () => {
  equal(sanitizeHtml('<strong><u>x</u></strong>'), '<strong><u>x</u></strong>');
});

// ---------------------------------------------------------------
// Règles des rendez-vous et des tâches
// ---------------------------------------------------------------
test('Les identifiants sont uniques et au bon format', () => {
  const a = createId();
  const b = createId();
  isTrue(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a), `format incorrect : ${a}`);
  isTrue(a !== b, 'deux identifiants identiques');
});

test('Un titre vide est refusé', () => {
  const { errors } = buildEntry({ type: 'task', title: '   ' });
  equal(errors.title, 'Écris un titre.');
});

test('Une heure de fin égale au début est refusée', () => {
  const { errors } = buildEntry({ type: 'event', title: 'RDV', date: '2026-11-02', startTime: '10:00', endTime: '10:00', reminderMinutes: '' });
  isTrue(errors.endTime, "pas d'erreur sur l'heure de fin");
});

test('Un rendez-vous valide est construit correctement', () => {
  const { entry, errors } = buildEntry({
    type: 'event', title: '  Médecin  ', date: '2026-11-02', startTime: '10:00', endTime: '10:30',
    location: 'Cabinet', reminderMinutes: '15', description: '<b>Carte vitale</b><script>x</script>',
  });
  equal(errors, {});
  equal([entry.title, entry.location, entry.reminderMinutes, entry.description], ['Médecin', 'Cabinet', 15, '<strong>Carte vitale</strong>']);
  isTrue(entry.timeZone, 'fuseau manquant');
});

test('Une tâche sans échéance est acceptée', () => {
  const { entry, errors } = buildEntry({ type: 'task', title: 'Lire', dueDate: '', priority: 'high', done: false });
  equal(errors, {});
  equal([entry.dueDate, entry.priority, entry.done, entry.doneAt], [null, 'high', false, null]);
});

test('Un titre trop long est raccourci à 200 caractères', () => {
  const { entry } = buildEntry({ type: 'task', title: 'x'.repeat(500) });
  equal(entry.title.length, 200);
});

test('Une entrée abîmée ou piégée est rejetée ou nettoyée', () => {
  equal(normalizeEntry({ id: 'a', type: 'inconnu', title: 'x' }), null, 'type inconnu');
  equal(normalizeEntry({ id: 'a', type: 'toString', title: 'x' }), null, 'nom spécial');
  equal(normalizeEntry({ type: 'task', title: 'x' }), null, 'sans identifiant');
  equal(normalizeEntry({ id: 'a', type: 'event', title: 'x', date: '2026-13-01', startTime: '10:00', endTime: '11:00' }), null, 'date impossible');
  const task = normalizeEntry({ id: 'a', type: 'task', title: 'x', priority: 'toString', description: '<img src=x onerror=alert(1)>ok' });
  equal([task.priority, task.description], ['normal', 'ok']);
});

// ---------------------------------------------------------------
// Sauvegarde : export et import
// ---------------------------------------------------------------

/** Une tâche simple, modifiée le jour `updatedOn` (ex. : '2026-10-05'). */
const sampleTask = (id, updatedOn, title = 'Tâche') => normalizeEntry({
  id, type: 'task', title, dueDate: null, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: `${updatedOn}T10:00:00.000Z`,
});
const sampleEvent = (id) => normalizeEntry({
  id, type: 'event', title: 'Rendez-vous', date: '2026-10-21', startTime: '14:00', endTime: '15:00', timeZone: 'Europe/Paris',
});
const backupText = (entries, extra = {}) => JSON.stringify({ format: 'omni-agenda', version: 1, entries, ...extra });

/** Vérifie que `fn` échoue avec un message clair (BackupError) contenant `fragment`. */
function failsWith(fn, fragment) {
  try {
    fn();
  } catch (error) {
    isTrue(error instanceof BackupError, `erreur inattendue : ${error.message}`);
    isTrue(error.message.includes(fragment), `message inattendu : ${error.message}`);
    return;
  }
  throw new Error(`aucune erreur, alors que « ${fragment} » était attendu`);
}

test('Un agenda exporté puis réimporté est identique', () => {
  const entries = [sampleTask('t1', '2026-10-05'), sampleEvent('e1')];
  const text = serializeBackup(createBackup(entries, new Date('2026-10-21T08:30:00Z')));
  const result = parseBackup(text);
  const byId = (list) => [...list].sort((a, b) => a.id.localeCompare(b.id));
  equal(byId(result.entries), byId(entries));
  equal([result.skipped, result.exportedAt], [0, '2026-10-21T08:30:00.000Z']);
  equal(parseBackup(`\uFEFF${text}`).entries.length, 2, 'caractère invisible (BOM) au début');
  equal(backupFileName('2026-10-21'), 'omni-agenda-2026-10-21.json');
});

test('Un fichier vide, abîmé ou étranger est refusé avec un message clair', () => {
  failsWith(() => parseBackup(''), 'vide');
  failsWith(() => parseBackup('{"format":"omni-agenda","entr'), 'abîmé');
  failsWith(() => parseBackup('[1, 2, 3]'), "n'est pas une sauvegarde");
  failsWith(() => parseBackup('null'), "n'est pas une sauvegarde");
  failsWith(() => parseBackup('{"format":"autre-agenda","version":1,"entries":[]}'), "n'est pas une sauvegarde");
  failsWith(() => parseBackup('{"format":"omni-agenda","version":1}'), 'abîmé');
  failsWith(() => parseBackup('{"format":"omni-agenda","version":"1","entries":[]}'), 'abîmé');
  failsWith(() => parseBackup(backupText([], { version: 2 })), 'version plus récente');
  failsWith(() => parseBackup(backupText([], { encrypted: true })), 'abîmé');
});

test('À l’import, les entrées piégées sont nettoyées, les abîmées ignorées', () => {
  const result = parseBackup(backupText([
    { ...sampleTask('a', '2026-10-05'), description: '<img src=x onerror=alert(1)><b>ok</b><script>alert(2)</script>' },
    { id: 'b', type: 'event', title: 'Sans date ni heure' },
    { id: '__proto__', type: 'task', title: 'Nom spécial' },
    'du texte',
    null,
  ]));
  equal(result.entries.map((entry) => entry.id), ['a']);
  equal(result.entries[0].description, '<strong>ok</strong>');
  equal(result.skipped, 4);
});

test('Un même élément en double dans le fichier : la version la plus récente gagne', () => {
  const result = parseBackup(backupText([
    sampleTask('a', '2026-10-02', 'Ancienne'),
    sampleTask('a', '2026-10-09', 'Récente'),
    sampleTask('a', '2026-10-05', 'Moyenne'),
  ]));
  equal(result.entries.map((entry) => entry.title), ['Récente']);
  equal(result.skipped, 2);
});

test('Fusion : ajoute le nouveau, met à jour le plus récent, ne supprime rien', () => {
  const current = [sampleTask('a', '2026-10-01', 'A appareil'), sampleTask('b', '2026-10-05', 'B appareil'), sampleTask('c', '2026-10-01')];
  const incoming = [sampleTask('a', '2026-10-03', 'A fichier'), sampleTask('b', '2026-10-02', 'B fichier'), sampleTask('d', '2026-10-01')];
  const plan = planMerge(current, incoming);
  equal(plan.added.map((entry) => entry.id), ['d'], 'ajoutés');
  equal(plan.updated.map((entry) => entry.title), ['A fichier'], 'mis à jour (le fichier est plus récent)');
  equal(plan.unchanged.map((entry) => entry.id), ['b'], 'gardés (l’appareil est plus récent)');
});

test('Résumé du contenu en français (singulier et pluriel)', () => {
  equal(describeEntries([]), 'aucun rendez-vous ni aucune tâche');
  equal(describeEntries([sampleTask('a', '2026-10-01')]), '1 tâche');
  equal(describeEntries([sampleTask('a', '2026-10-01'), sampleTask('b', '2026-10-01')]), '2 tâches');
  equal(describeEntries([sampleEvent('e')]), '1 rendez-vous');
  equal(describeEntries([sampleEvent('e'), sampleEvent('f'), sampleTask('a', '2026-10-01')]), '2 rendez-vous et 1 tâche');
});

// ---------------------------------------------------------------
// Mot de passe et chiffrement
// ---------------------------------------------------------------
// Pour aller vite, ces tests utilisent 100 000 tours de calcul
// (le minimum accepté) au lieu de 600 000.
const TEST_ITERATIONS = 100000;

/** Vérifie qu'une promesse échoue. */
async function rejects(promise, label) {
  try {
    await promise;
  } catch {
    return;
  }
  throw new Error(`${label} : aucune erreur, alors qu'une erreur était attendue`);
}

test('Base64 : des octets écrits en texte puis relus à l’identique', () => {
  const all = new Uint8Array(256).map((_, index) => index);
  equal([...fromBase64(toBase64(all))], [...all]);
  const big = new Uint8Array(100000).map((_, index) => (index * 31 + 7) % 256);
  isTrue(fromBase64(toBase64(big)).every((value, index) => value === big[index]), 'gros contenu (100 000 octets)');
});

test('Le bon mot de passe ouvre la protection, un mauvais non', async () => {
  const { protection } = await createProtection('mon chat dort', TEST_ITERATIONS);
  isTrue(isValidProtection(protection), 'protection bien formée');
  isTrue(await openProtection(protection, 'mon chat dort'), 'bon mot de passe');
  equal(await openProtection(protection, 'mon chat dort '), null, 'espace en plus');
  equal(await openProtection(protection, 'Mon chat dort'), null, 'majuscule');
  equal(await openProtection(protection, ''), null, 'vide');
});

test('Le mot de passe n’est jamais enregistré, et deux protections ont des sels différents', async () => {
  const first = await createProtection('secret-très-secret', TEST_ITERATIONS);
  const second = await createProtection('secret-très-secret', TEST_ITERATIONS);
  const saved = JSON.stringify(first.protection);
  isTrue(!saved.includes('secret'), 'le mot de passe n’apparaît pas');
  isTrue(first.protection.kdf.salt !== second.protection.kdf.salt, 'sels différents');
  equal(Object.keys(first.protection), ['version', 'kdf', 'check']);
});

test('Accents : « é » tapé de deux façons différentes donne la même clé', async () => {
  const { protection } = await createProtection('café crème', TEST_ITERATIONS);
  isTrue(await openProtection(protection, 'cafe\u0301 cre\u0300me'), 'accents décomposés acceptés');
});

test('Chiffrer puis déchiffrer redonne la même valeur ; chaque chiffrement est différent', async () => {
  const { key } = await createProtection('mot de passe', TEST_ITERATIONS);
  const value = { titre: 'Dentiste', heure: '14:00', accents: 'éàçœ€' };
  const a = await encryptJson(key, value, 'entree:1');
  const b = await encryptJson(key, value, 'entree:1');
  equal(await decryptJson(key, a, 'entree:1'), value);
  isTrue(toBase64(a.data) !== toBase64(b.data), 'deux chiffrements du même contenu sont différents');
  isTrue(!new TextDecoder().decode(a.data).includes('Dentiste'), 'le texte chiffré est illisible');
});

test('Une donnée chiffrée modifiée, déplacée ou ouverte avec une autre clé est refusée', async () => {
  const { key } = await createProtection('mot de passe', TEST_ITERATIONS);
  const other = (await createProtection('autre mot de passe', TEST_ITERATIONS)).key;
  const sealed = await encryptJson(key, { titre: 'Secret' }, 'entree:a');
  const tampered = { iv: sealed.iv, data: sealed.data.slice() };
  tampered.data[0] ^= 1;
  await rejects(decryptJson(key, tampered, 'entree:a'), 'donnée modifiée');
  await rejects(decryptJson(key, sealed, 'entree:b'), 'donnée déplacée vers une autre entrée');
  await rejects(decryptJson(other, sealed, 'entree:a'), 'autre clé');
});

test('Sauvegarde chiffrée : illisible sans le mot de passe, identique avec', async () => {
  const { key, protection } = await createProtection('mot de passe du fichier', TEST_ITERATIONS);
  const entries = [sampleTask('t1', '2026-10-05', 'Payer le loyer'), sampleEvent('e1')];
  const text = serializeBackup(await createEncryptedBackup(entries, new Date('2026-10-21T08:30:00Z'), { key, kdf: protection.kdf }));
  isTrue(!text.includes('Payer le loyer') && !text.includes('2026-10-21T14'), 'aucun contenu lisible dans le fichier');
  const sealed = parseBackup(text);
  equal([sealed.encrypted, sealed.exportedAt], [true, '2026-10-21T08:30:00.000Z']);
  equal(await decryptBackup(sealed, 'mauvais mot de passe'), null, 'mauvais mot de passe');
  const opened = await decryptBackup(sealed, 'mot de passe du fichier');
  equal(opened.entries.map((entry) => entry.title).sort(), ['Payer le loyer', 'Rendez-vous']);
  equal(opened.skipped, 0);
});

test('Sauvegarde chiffrée abîmée ou piégée : refusée', async () => {
  const { key, protection } = await createProtection('mot de passe', TEST_ITERATIONS);
  const good = await createEncryptedBackup([sampleTask('t1', '2026-10-05')], new Date(), { key, kdf: protection.kdf });
  const variant = (change) => JSON.stringify(change(structuredClone(good)));
  failsWith(() => parseBackup(variant((b) => { b.kdf.iterations = 1e9; return b; })), 'abîmé');
  failsWith(() => parseBackup(variant((b) => { b.kdf.iterations = 1000; return b; })), 'abîmé');
  failsWith(() => parseBackup(variant((b) => { b.kdf.name = 'autre'; return b; })), 'abîmé');
  failsWith(() => parseBackup(variant((b) => { b.cipher.iv = 'AAAA'; return b; })), 'abîmé');
  failsWith(() => parseBackup(variant((b) => { delete b.data; return b; })), 'abîmé');
  const corrupted = parseBackup(variant((b) => { b.data = `${b.data.slice(0, -8)}AAAAAAA=`; return b; }));
  equal(await decryptBackup(corrupted, 'mot de passe'), null, 'contenu modifié : refusé');
});

test('Règles du nouveau mot de passe', () => {
  equal(checkNewPassword('', '')?.field, 'password', 'vide');
  equal(checkNewPassword('court', 'court')?.field, 'password', 'trop court');
  equal(checkNewPassword('x'.repeat(201), 'x'.repeat(201))?.field, 'password', 'trop long');
  equal(checkNewPassword('mon chat dort', 'mon chat dors')?.field, 'confirmation', 'confirmation différente');
  equal(checkNewPassword('mon chat dort', 'mon chat dort'), null, 'valide');
  equal(checkNewPassword('🐱🐱🐱🐱🐱🐱🐱🐱', '🐱🐱🐱🐱🐱🐱🐱🐱'), null, '8 émojis = 8 caractères');
});

// ---------------------------------------------------------------
// Rappels
// ---------------------------------------------------------------
// Rendez-vous le 10 mai 2030 à 14:00, dans le fuseau de l'appareil.
const reminderZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const reminderEvent = (minutes) => normalizeEntry({
  id: 'rappel-1', type: 'event', title: 'Dentiste', date: '2030-05-10', startTime: '14:00', endTime: '15:00',
  timeZone: reminderZone, location: 'Cabinet', reminderMinutes: minutes,
});
const reminderStart = () => zonedTimeToInstant('2030-05-10', '14:00', reminderZone).getTime();
/** L'instant situé `minutes` minutes avant (négatif) ou après (positif) le début du rendez-vous. */
const aroundStart = (minutes) => new Date(reminderStart() + minutes * 60000);

test('Un rappel s’affiche à partir de son heure, jusqu’au début du rendez-vous', () => {
  const event = reminderEvent(15);
  equal(getDueReminders([event], aroundStart(-16)).length, 0, '16 minutes avant : trop tôt');
  equal(getDueReminders([event], aroundStart(-15)).length, 1, '15 minutes avant : affiché');
  equal(getDueReminders([event], aroundStart(-1)).length, 1, '1 minute avant : encore affiché');
  equal(getDueReminders([event], aroundStart(0)).length, 0, 'au début du rendez-vous : plus de rappel');
  equal(getDueReminders([reminderEvent(0)], aroundStart(9)).length, 1, '« à l’heure » : encore 9 minutes après');
  equal(getDueReminders([reminderEvent(0)], aroundStart(10)).length, 0, '« à l’heure » : plus après 10 minutes');
  equal(getDueReminders([reminderEvent(null)], aroundStart(-5)).length, 0, 'sans rappel');
  equal(getDueReminders([sampleTask('t', '2026-10-01')], aroundStart(-5)).length, 0, 'une tâche n’a pas de rappel');
});

test('Un rappel est identifié par son heure : déplacer le rendez-vous en crée un nouveau', () => {
  const [before] = getDueReminders([reminderEvent(15)], aroundStart(-10));
  const moved = { ...reminderEvent(15), startTime: '14:05', endTime: '15:05' };
  const [after] = getDueReminders([moved], aroundStart(-5));
  isTrue(before && after && before.key !== after.key, 'clés différentes');
});

test('Texte du rappel : normal, et discret quand un mot de passe est actif', () => {
  const [due] = getDueReminders([reminderEvent(15)], aroundStart(-15));
  equal(reminderText(due, aroundStart(-15)), { title: 'Dentiste', body: 'Dans 15 minutes, à 14:00 · Cabinet' });
  equal(reminderText(due, aroundStart(-1)).body, 'Dans 1 minute, à 14:00 · Cabinet');
  equal(reminderText(due, aroundStart(-15), { discreet: true }),
    { title: 'Rappel de rendez-vous', body: 'Dans 15 minutes, à 14:00. Ouvre Omni-Agenda pour le voir.' });
  const [onTime] = getDueReminders([reminderEvent(0)], aroundStart(2));
  equal(reminderText(onTime, aroundStart(2)).body, 'Commence maintenant (14:00) · Cabinet');
  const [dayBefore] = getDueReminders([reminderEvent(1440)], aroundStart(-1440));
  equal(reminderText(dayBefore, aroundStart(-1440)).body, 'Demain à 14:00 · Cabinet');
  const [twoDaysBefore] = getDueReminders([reminderEvent(2880)], aroundStart(-2880));
  equal(reminderText(twoDaysBefore, aroundStart(-2880)).body, 'Vendredi 10 mai à 14:00 · Cabinet');
});

// ---------------------------------------------------------------
// Typographie française
// ---------------------------------------------------------------
test('Espaces insécables avant « : ; ! ? » et dans les guillemets', () => {
  const nbsp = '\u00A0';
  equal(frenchSpacing('Rappel : demain'), `Rappel${nbsp}: demain`);
  equal(frenchSpacing('Supprimer ce rendez-vous ?'), `Supprimer ce rendez-vous${nbsp}?`);
  equal(frenchSpacing('Le fichier « agenda.json » ; ok !'), `Le fichier «${nbsp}agenda.json${nbsp}»${nbsp}; ok${nbsp}!`);
  equal(frenchSpacing('14:00 et https://exemple.fr'), '14:00 et https://exemple.fr', 'heures et adresses intactes');
});

// ---------------------------------------------------------------
// Calendrier et vues de l'agenda
// ---------------------------------------------------------------
test('La semaine commence le lundi', () => {
  equal(startOfWeek('2026-10-21'), '2026-10-19', 'mercredi');
  equal(startOfWeek('2026-10-25'), '2026-10-19', 'dimanche');
  equal(startOfWeek('2026-10-19'), '2026-10-19', 'lundi');
});

test('Numéros de semaine (norme ISO des agendas français)', () => {
  equal(isoWeekNumber('2026-10-21'), 43);
  equal(isoWeekNumber('2026-01-01'), 1);
  equal(isoWeekNumber('2027-01-01'), 53, '2026 compte 53 semaines');
  equal(isoWeekNumber('2024-12-30'), 1, 'fin décembre 2024 = semaine 1 de 2025');
});

test('Jours dans un mois et changement de mois', () => {
  equal(daysInMonth(2028, 2), 29);
  equal(daysInMonth(2026, 2), 28);
  equal(addMonths('2026-12-15', 1), '2027-01-01');
  equal(addMonths('2026-01-31', -1), '2025-12-01');
});

test('Le premier du mois s’écrit « 1er »', () => {
  equal(formatISODateLong('2026-11-01'), 'Dimanche 1er novembre 2026');
  equal(formatISODateLong('2026-11-21'), 'Samedi 21 novembre 2026');
  equal(formatDayMonth('2026-11-01'), '1er novembre');
});

test('Titres des périodes affichées', () => {
  equal(dayView.title('2026-10-21', 'spread'), 'Mercredi 21 et jeudi 22 octobre 2026');
  equal(dayView.title('2026-10-31', 'spread'), 'Samedi 31 octobre et dimanche 1er novembre 2026');
  equal(dayView.title('2026-12-31', 'spread'), 'Jeudi 31 décembre 2026 et vendredi 1er janvier 2027');
  equal(dayView.title('2026-10-21', 'single'), 'Mercredi 21 octobre 2026');
  equal(weekView.title('2026-10-28'), 'Semaine 44 · du 26 octobre au 1er novembre 2026');
  equal(weekView.title('2026-12-30'), 'Semaine 53 · du 28 décembre 2026 au 3 janvier 2027');
});

test('Rangement des entrées : par jour, en retard, sans échéance', () => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const raw = [
    { id: 'a', type: 'event', title: 'Après-midi', date: '2026-10-21', startTime: '15:00', endTime: '16:00', timeZone: zone },
    { id: 'b', type: 'event', title: 'Matin', date: '2026-10-21', startTime: '09:00', endTime: '10:00', timeZone: zone },
    { id: 'c', type: 'task', title: 'Tâche du jour', dueDate: '2026-10-21' },
    { id: 'd', type: 'task', title: 'En retard', dueDate: '2026-10-19' },
    { id: 'e', type: 'task', title: 'Faite en retard', dueDate: '2026-10-18', done: true },
    { id: 'f', type: 'task', title: 'Un jour', dueDate: null },
  ].map(normalizeEntry);
  const index = buildAgendaIndex(raw, '2026-10-21');
  equal(index.entriesOn('2026-10-21').map((e) => e.title), ['Matin', 'Après-midi', 'Tâche du jour']);
  equal(index.overdue.map((e) => e.title), ['En retard'], 'une tâche faite n’est pas en retard');
  equal(index.undated.map((e) => e.title), ['Un jour']);
  equal(index.entriesOn('2026-10-25'), []);
});

// ---------------------------------------------------------------
// Vague 1/2 — Sécurité, chiffrement et durcissement (R4.2)
// ---------------------------------------------------------------
test('fromBase64 refuse espaces, padding manquant et non-chaînes', () => {
  equal([...fromBase64('AQID')], [1, 2, 3]);
  for (const bad of ['AAAA AAAA', 'AAAA\n', 'AA', 'AQIDBA', '@@@@', null, 123]) {
    let threw = false;
    try {
      fromBase64(bad);
    } catch {
      threw = true;
    }
    isTrue(threw, `fromBase64 aurait dû rejeter ${JSON.stringify(bad)}`);
  }
});

test('isValidProtection vérifie le Base64, les 12 octets de IV et la taille de check.data', async () => {
  const { protection } = await createProtection('mon chat dort', TEST_ITERATIONS);
  isTrue(isValidProtection(protection), 'protection valide acceptée');
  equal(isValidProtection(null), false);
  equal(isValidProtection([]), false);
  equal(isValidProtection({ ...protection, version: 2 }), false);
  equal(isValidProtection({ ...protection, kdf: [] }), false);

  const badIv11 = structuredClone(protection);
  badIv11.check.iv = toBase64(new Uint8Array(11));
  equal(isValidProtection(badIv11), false, 'IV de 11 octets refusé');

  const badIv16 = structuredClone(protection);
  badIv16.check.iv = toBase64(new Uint8Array(16));
  equal(isValidProtection(badIv16), false, 'IV de 16 octets refusé');

  const badIvChars = structuredClone(protection);
  badIvChars.check.iv = 'AAAA AAAA AAAA AAAA';
  equal(isValidProtection(badIvChars), false, 'IV avec espaces refusé');

  const shortData = structuredClone(protection);
  shortData.check.data = toBase64(new Uint8Array(15));
  equal(isValidProtection(shortData), false, 'check.data < 16 octets refusé');

  const emptyData = structuredClone(protection);
  emptyData.check.data = '';
  equal(isValidProtection(emptyData), false, 'check.data vide refusé');
});

test('Sauvegarde chiffrée avec mot de passe : sel neuf et distinct à chaque export', async () => {
  const { protection } = await createProtection('secret-export', TEST_ITERATIONS);
  const entries = [sampleTask('t1', '2026-10-05', 'Exporter proprement')];
  const first = await createEncryptedBackup(entries, new Date('2026-10-21T08:00:00Z'), {
    password: 'secret-export',
    iterations: TEST_ITERATIONS,
  });
  const second = await createEncryptedBackup(entries, new Date('2026-10-21T09:00:00Z'), {
    password: 'secret-export',
    iterations: TEST_ITERATIONS,
  });

  isTrue(first.kdf.salt !== protection.kdf.salt, 'sel distinct de la protection locale');
  isTrue(first.kdf.salt !== second.kdf.salt, 'sel distinct entre deux exports');

  const parsed = parseBackup(serializeBackup(first));
  equal(await decryptBackup(parsed, 'mauvais'), null);
  const opened = await decryptBackup(parsed, 'secret-export');
  equal(opened.entries.map((e) => e.title), ['Exporter proprement']);

  failsWith(() => parseBackup(JSON.stringify({ ...first, data: 'AAAA' })), 'abîmé');
  failsWith(() => parseBackup(JSON.stringify({ ...first, data: 'not base64!' })), 'abîmé');
});

test('Rappels salés et scellés : différent du SHA-256 brut et opaque une fois chiffré', async () => {
  const key = 'rappel-1|1904644800000';
  const rawDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  const rawHex = [...rawDigest].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');

  const saltA = new Uint8Array(16).fill(1);
  const saltB = new Uint8Array(16).fill(2);
  const hashA1 = await hashReminderKey(key, saltA);
  const hashA2 = await hashReminderKey(key, saltA);
  const hashB = await hashReminderKey(key, saltB);

  equal(hashA1, hashA2, 'déterministe avec le même sel');
  isTrue(hashA1 !== rawHex, 'différent du SHA-256 non salé');
  isTrue(hashA1 !== hashB, 'différent selon le sel');

  const { key: cryptoKey } = await createProtection('secret', TEST_ITERATIONS);
  const sealed = await encryptJson(cryptoKey, [hashA1], 'rappels-affiches');
  isTrue(!new TextDecoder().decode(sealed.data).includes(hashA1), 'empreinte cachée par AES-GCM');
  equal(await decryptJson(cryptoKey, sealed, 'rappels-affiches'), [hashA1]);
});

test('Verrouillage automatique : normalisation du délai et calcul d’expiration', () => {
  equal(normalizeAutoLockMinutes(1), 1);
  equal(normalizeAutoLockMinutes(0), 0);
  equal(normalizeAutoLockMinutes('30'), 30);
  equal(normalizeAutoLockMinutes(-1), 15);
  equal(normalizeAutoLockMinutes('abc'), 15);
  equal(normalizeAutoLockMinutes(999), 15);
  equal(normalizeAutoLockMinutes(null), 15);

  const t0 = 1_000_000;
  equal(isAutoLockExpired(t0, t0 + 10 * 60000, 0), false, '0 désactive le délai');
  equal(isAutoLockExpired(t0, t0 + 14 * 60000, 15), false, 'avant la limite');
  equal(isAutoLockExpired(t0, t0 + 15 * 60000, 15), true, 'à la limite exacte');
  equal(isAutoLockExpired(t0, t0 + 20 * 60000, 15), true, 'après la limite');
});

test('Avant loadProtection : security, entry-store et IndexedDB restent verrouillés (fail-closed)', async () => {
  equal(isSecurityReady(), false, 'sécurité pas encore initialisée');
  const prevOpen = indexedDB.open;
  let idbOpenCalls = 0;
  indexedDB.open = (...args) => {
    idbOpenCalls += 1;
    return prevOpen.apply(indexedDB, args);
  };
  try {
    const sample = sampleTask('pre-ready-test', '2026-10-01');
    const sealedSample = { id: 'sealed-1', iv: new Uint8Array(12), data: new Uint8Array(16) };
    await rejects(entryToRecord(sample), 'entryToRecord avant loadProtection');
    await rejects(recordToEntry(sample), 'recordToEntry en clair avant loadProtection');
    await rejects(recordToEntry(sealedSample), 'recordToEntry chiffré avant loadProtection');
    await loadEntries();
    equal(getEntries().length, 0, 'loadEntries ignoré avant loadProtection');
    await rejects(saveEntry(sample), 'saveEntry avant loadProtection');
    await rejects(saveEntries([sample]), 'saveEntries avant loadProtection');
    await rejects(saveEntries([]), 'saveEntries([]) avant loadProtection');
    await rejects(replaceAllEntries([sample]), 'replaceAllEntries avant loadProtection');
    await rejects(replaceAllEntries([]), 'replaceAllEntries([]) avant loadProtection');
    await rejects(deleteEntry(sample.id), 'deleteEntry avant loadProtection');
    equal(searchEntries([sample], 'pre-ready-test'), [], 'searchEntries bloqué avant loadProtection');
    let icsThrew = false;
    try {
      exportAgendaIcs([sample]);
    } catch {
      icsThrew = true;
    }
    isTrue(icsThrew, 'exportAgendaIcs refusé avant loadProtection');
    equal(idbOpenCalls, 0, 'IndexedDB jamais ouverte ni modifiée avant loadProtection');
    equal(getEntries().length, 0, 'mémoire des entrées restée vide');
  } finally {
    indexedDB.open = prevOpen;
  }
});

test('État de verrouillage : recordToEntry / entryToRecord cohérents quand non protégé', async () => {
  const prevOpen = indexedDB.open;
  const prevAppearance = localStorage.getItem('omni-agenda:apparence');
  let fakeDb = null;
  indexedDB.open = () => {
    const req = {};
    queueMicrotask(() => {
      fakeDb = {
        close: () => {},
        transaction: () => {
          const tx = {
            objectStore: () => ({
              get: () => {
                const getReq = {};
                queueMicrotask(() => {
                  getReq.result = undefined;
                  getReq.onsuccess?.();
                  tx.oncomplete?.();
                });
                return getReq;
              },
            }),
          };
          return tx;
        },
      };
      req.result = fakeDb;
      req.onsuccess?.();
    });
    return req;
  };
  try {
    await loadProtection();
    equal(isSecurityReady(), true);
    equal(isProtected(), false);
    equal(isLocked(), false);
    const sample = sampleTask('lock-test', '2026-10-01');
    const record = await entryToRecord(sample);
    equal(record.id, sample.id);
    equal((await recordToEntry(record)).title, sample.title);
  } finally {
    fakeDb?.onclose?.();
    indexedDB.open = prevOpen;
    if (prevAppearance === null) localStorage.removeItem('omni-agenda:apparence');
    else localStorage.setItem('omni-agenda:apparence', prevAppearance);
  }
});

test('auto-lock.js : un réveil précoce de setTimeout réarme pour le délai restant', () => {
  const prevNow = Date.now;
  const prevSetTimeout = globalThis.setTimeout;
  const prevClearTimeout = globalThis.clearTimeout;
  let now = 1_000_000;
  let nextId = 1;
  const scheduled = new Map();
  let lockCalls = 0;

  Date.now = () => now;
  globalThis.setTimeout = (fn, delay) => {
    const id = nextId++;
    scheduled.set(id, { fn, delay });
    return id;
  };
  globalThis.clearTimeout = (id) => {
    scheduled.delete(id);
  };

  try {
    initAutoLock({
      minutes: 1,
      onHide: false,
      isUnlocked: () => true,
      onLock: () => { lockCalls += 1; },
    });
    equal(scheduled.size, 1, 'minuterie initiale armée');
    const [firstId, firstTimer] = [...scheduled.entries()][0];
    equal(firstTimer.delay, 60000, 'délai initial de 60 000 ms');

    // Réveil 1 ms avant l'échéance : ne verrouille pas et réarme pour 1 ms.
    now += 59999;
    scheduled.delete(firstId);
    firstTimer.fn();

    equal(lockCalls, 0, 'pas de verrouillage avant échéance');
    equal(scheduled.size, 1, 'minuterie réarmée après réveil précoce');
    const [secondId, secondTimer] = [...scheduled.entries()][0];
    equal(secondTimer.delay, 1, 'délai restant exact de 1 ms');

    // À l'échéance : verrouille et ne réarme plus.
    now += 1;
    scheduled.delete(secondId);
    secondTimer.fn();

    equal(lockCalls, 1, 'verrouillage déclenché à échéance');
    equal(scheduled.size, 0, 'aucune minuterie restante après verrouillage');
  } finally {
    initAutoLock({ minutes: 0, onHide: false });
    Date.now = prevNow;
    globalThis.setTimeout = prevSetTimeout;
    globalThis.clearTimeout = prevClearTimeout;
  }
});

// ---------------------------------------------------------------
// Vague 1/2 — Correctifs bugs & comportement UI (R4.3)
// ---------------------------------------------------------------
test('Rappels multi-onglets : format v2, fusion sans écrasement et clearShownReminders', async () => {
  const prevShown = localStorage.getItem(SHOWN_REMINDERS_KEY);
  const prevSalt = localStorage.getItem(REMINDER_SALT_KEY);
  try {
    clearShownReminders();
    // Ancien format non salé (tableau simple) ignoré proprement.
    localStorage.setItem(SHOWN_REMINDERS_KEY, JSON.stringify(['legacy-unsalted']));
    equal(await getShownReminderCodes(), []);

    await rememberShownCode('code-onglet-1');
    // Simule un second onglet qui écrit un code concurrent puis déclenche `storage`.
    localStorage.setItem(SHOWN_REMINDERS_KEY, JSON.stringify({ v: 2, codes: ['code-onglet-1', 'code-onglet-2'] }));
    window.dispatchEvent(new StorageEvent('storage', { key: SHOWN_REMINDERS_KEY }));
    await rememberShownCode('code-onglet-3');

    const stored = JSON.parse(localStorage.getItem(SHOWN_REMINDERS_KEY));
    equal(stored.v, 2);
    equal(stored.codes, ['code-onglet-1', 'code-onglet-2', 'code-onglet-3']);

    clearShownReminders();
    equal(localStorage.getItem(SHOWN_REMINDERS_KEY), null);
  } finally {
    if (prevShown === null) localStorage.removeItem(SHOWN_REMINDERS_KEY);
    else localStorage.setItem(SHOWN_REMINDERS_KEY, prevShown);
    if (prevSalt === null) localStorage.removeItem(REMINDER_SALT_KEY);
    else localStorage.setItem(REMINDER_SALT_KEY, prevSalt);
  }
});

test('dialogs.js : onBeforeClose empêche la perte sur Retour et restaure l’état historique', async () => {
  const dialog = document.createElement('dialog');
  document.body.append(dialog);
  let allowClose = false;
  try {
    openModal(dialog, { onBeforeClose: () => Promise.resolve(allowClose) });
    isTrue(dialog.open, 'fenêtre ouverte');
    const modalToken = history.state?.omniModal;
    isTrue(Boolean(modalToken), 'jeton historique posé');

    // Simule l’appui sur Retour (popstate avec état sans jeton).
    history.replaceState(null, '');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    isTrue(dialog.open, 'fenêtre toujours ouverte après refus');
    equal(history.state?.omniModal, modalToken, 'jeton historique restauré');

    allowClose = true;
    history.replaceState(null, '');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    equal(dialog.open, false, 'fenêtre fermée après confirmation');
  } finally {
    if (history.state?.omniModal) history.replaceState(null, '');
    if (dialog.open) closeModal(dialog);
    dialog.remove();
  }
});

test('editor.js : normalize() avant cloneRange préserve la sélection entre deux clics', () => {
  const host = document.createElement('div');
  document.body.append(host);
  try {
    const rich = createRichEditor({ id: 'test-ed', labelId: 'test-ed-label', initialHtml: '<strong>bon</strong>jour' });
    host.append(rich.element);

    const range = document.createRange();
    range.setStart(rich.editor.firstChild.firstChild, 0);
    range.setEnd(rich.editor.lastChild, rich.editor.lastChild.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    const boldButton = rich.element.querySelector('[data-format="bold"]');
    boldButton.click();
    equal(rich.getHtml(), '<strong>bonjour</strong>');
    equal(rich.editor.firstChild.childNodes.length, 1, 'nœuds texte fusionnés par normalize()');

    // Un second clic doit retirer le gras grâce au savedRange normalisé.
    boldButton.click();
    equal(rich.getHtml(), 'bonjour');
  } finally {
    window.getSelection()?.removeAllRanges();
    host.remove();
  }
});

test('storage.js : bindDatabaseLifecycle réinitialise la promesse sur onversionchange et onclose', async () => {
  let resets = 0;
  let closed = false;
  const fakeDb = { close: () => { closed = true; } };
  bindDatabaseLifecycle(fakeDb, () => { resets += 1; });
  fakeDb.onversionchange();
  equal([resets, closed], [1, true], 'onversionchange réinitialise et ferme');
  fakeDb.onclose();
  equal(resets, 2, 'onclose réinitialise');

  const testDbName = `omni-agenda-test-${Math.random().toString(36).slice(2)}`;
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(testDbName, 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    let realResets = 0;
    bindDatabaseLifecycle(db, () => { realResets += 1; });
    db.onversionchange();
    equal(realResets, 1);
  } finally {
    indexedDB.deleteDatabase(testDbName);
  }
});

test('dates.js : relativeDayLabel utilise `now` et normalizeTime retire les secondes', () => {
  equal(relativeDayLabel('2030-05-10', '2030-05-10'), "Aujourd'hui");
  equal(relativeDayLabel('2030-05-10', '2030-05-09'), 'Demain');
  equal(relativeDayLabel('2030-05-10', '2030-05-11'), 'Hier');
  equal(relativeDayLabel('2030-05-10', '2030-05-08'), null);

  equal(normalizeTime('14:30:00'), '14:30');
  equal(normalizeTime('09:05:42.123'), '09:05');
  equal(normalizeTime('14:30xx'), '14:30xx');
  equal(normalizeTime(null), '');
});

test('entry-form.js : gère les valeurs HH:MM:SS sans bloquer la mention lendemain ni le décalage', () => {
  const host = document.createElement('div');
  document.body.append(host);
  try {
    const form = renderEntryForm({ type: 'event', defaultDate: '2026-10-21', onSubmit: async () => {}, onCancel: () => {} });
    host.append(form.element);
    const [startInput, endInput] = form.element.querySelectorAll('input[type="time"]');
    startInput.step = '1';
    endInput.step = '1';
    startInput.value = '22:00:00';
    startInput.dispatchEvent(new Event('change'));
    endInput.value = '01:00:00';
    endInput.dispatchEvent(new Event('change'));
    const overnight = [...form.element.querySelectorAll('.field-hint')].find((p) => p.textContent.includes('lendemain'));
    isTrue(overnight && !overnight.hidden, 'mention lendemain affichée malgré les secondes');
  } finally {
    host.remove();
  }
});

test('data-focus-key uniques même avec une tâche en retard dans la semaine affichée', () => {
  const host = document.createElement('div');
  document.body.append(host);
  try {
    const task = normalizeEntry({ id: 'retard-1', type: 'task', title: 'Urgente', dueDate: '2026-10-19' });
    const today = '2026-10-21';
    let index = buildAgendaIndex([task], today);
    const noopCtx = () => ({
      index,
      today,
      actions: { onOpen: () => {}, onToggleDone: () => {}, onAdd: () => {}, onShowDay: () => {}, onSelectDay: () => {} },
    });
    const renderWeek = () => {
      host.replaceChildren(...weekView.pages(today, 'spread', noopCtx()));
    };
    renderWeek();

    const keys = [...host.querySelectorAll('[data-focus-key]')].map((el) => el.dataset.focusKey);
    equal(keys.length, new Set(keys).size, 'aucun data-focus-key en double');

    const overdueCheckbox = host.querySelector('[data-focus-key="overdue-faite-retard-1"]');
    isTrue(Boolean(overdueCheckbox), 'clé spécifique à la section en retard');
    overdueCheckbox.focus();
    keepFocus(host, () => {
      index = buildAgendaIndex([{ ...task, done: false }], today);
      renderWeek();
    });
    equal(document.activeElement?.dataset?.focusKey, 'overdue-faite-retard-1', 'focus restauré sur la bonne case');
  } finally {
    host.remove();
  }
});

test('Bornes 1900–2200 : dayView, weekView, monthView et clampDate ne dépassent jamais', () => {
  equal(clampDate('1899-12-31'), MIN_DATE);
  equal(clampDate('2201-01-01'), MAX_DATE);
  equal(dayView.step('1900-01-01', -1, 'single'), MIN_DATE);
  equal(dayView.step('2200-12-31', 1, 'single'), MAX_DATE);
  equal(dayView.step('2200-12-30', 1, 'spread'), '2200-12-30');
  equal(dayView.title('2200-12-31', 'spread'), 'Mardi 30 et mercredi 31 décembre 2200');
  equal(weekView.step('1900-01-01', -1), MIN_DATE);
  equal(weekView.step('2200-12-29', 1), MAX_DATE);
  equal(monthView.step('1900-01-15', -1), MIN_DATE);
  equal(monthView.step('2200-12-15', 1), '2200-12-01');

  const emptyCtx = {
    index: buildAgendaIndex([], '2026-10-21'),
    today: '2026-10-21',
    actions: { onOpen: () => {}, onToggleDone: () => {}, onAdd: () => {}, onShowDay: () => {}, onSelectDay: () => {} },
  };
  const spreadPages = dayView.pages('2200-12-31', 'spread', emptyCtx);
  equal(spreadPages.length, 2);
  isTrue(!spreadPages[1].textContent.includes('2201'), 'jamais 2201 sur la page de droite');

  const selected = [];
  const monthCtx = {
    ...emptyCtx,
    actions: { ...emptyCtx.actions, onSelectDay: (iso) => selected.push(iso) },
  };
  const [monthPage] = monthView.pages('2200-12-31', 'single', monthCtx);
  const outBtn = monthPage.querySelector('.month-day[data-date="2201-01-01"]');
  isTrue(outBtn?.disabled, 'case 2201-01-01 désactivée');
  const lastDayBtn = monthPage.querySelector('.month-day[data-date="2200-12-31"]');
  lastDayBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  lastDayBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  lastDayBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
  equal(selected, [], 'navigation clavier bloquée après 2200-12-31');
});

test('book.js : filtre les événements tactiles par pointerId', () => {
  const host = document.createElement('div');
  document.body.append(host);
  try {
    const swipes = [];
    createBook(host, { onSwipe: (dir) => swipes.push(dir) });
    if (typeof PointerEvent === 'function') {
      host.dispatchEvent(new PointerEvent('pointerdown', {
        pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 200, clientY: 100,
      }));
      // Autre doigt : ignoré.
      host.dispatchEvent(new PointerEvent('pointerup', {
        pointerId: 2, pointerType: 'touch', isPrimary: false, clientX: 50, clientY: 100,
      }));
      equal(swipes, [], 'pointerId différent ignoré');
      // Même doigt : déclenche le balayage.
      host.dispatchEvent(new PointerEvent('pointerup', {
        pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 50, clientY: 100,
      }));
      equal(swipes, [1], 'même pointerId déclenche onSwipe');
    }
  } finally {
    host.remove();
  }
});

// ---------------------------------------------------------------
// Vague 3 — Performance, Accessibilité, Recherche, Récurrences,
// Journée entière, Export .ics et Complétude SW (R4.5)
// ---------------------------------------------------------------

test('Performance : révision/snapshot entry-store et cache buildAgendaIndex()', () => {
  const rev0 = getEntriesRevision();
  const snap0 = getEntriesSnapshot();
  isTrue(Object.isFrozen(snap0), 'getEntriesSnapshot() est figé');
  equal(getEntriesSnapshot(), snap0, 'snapshot identique sans mutation');

  clearEntries();
  isTrue(getEntriesRevision() > rev0, 'clearEntries incrémente la révision');

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const frozenList = Object.freeze([
    normalizeEntry({
      id: 'perf-1', type: 'event', title: 'Réunion', date: '2026-10-21', startTime: '10:00', endTime: '11:00', timeZone: zone,
    }),
  ]);
  const idx1 = buildAgendaIndex(frozenList, '2026-10-21');
  const idx2 = buildAgendaIndex(frozenList, '2026-10-21');
  isTrue(idx1 === idx2, 'buildAgendaIndex réutilise le cache pour un snapshot figé identique');

  const idx3 = buildAgendaIndex(frozenList, '2026-10-22');
  isTrue(idx3 !== idx1, 'changement de date today invalide le cache');

  const otherFrozen = Object.freeze([...frozenList]);
  const idx4 = buildAgendaIndex(otherFrozen, '2026-10-21');
  isTrue(idx4 !== idx1, 'nouvelle référence de liste invalide le cache');

  // Un tableau mutable non figé n'est jamais mis en cache de manière obsolète.
  const mutable = [...frozenList];
  const m1 = buildAgendaIndex(mutable, '2026-10-21');
  mutable.push(sampleTask('perf-t2', '2026-10-21', 'Nouvelle tâche'));
  const m2 = buildAgendaIndex(mutable, '2026-10-21');
  isTrue(m1 !== m2 && m2.undated.length === 1, 'tableau mutable non figé recalculé');

  // Day cache hits on repeated entriesOn calls
  const dayA = idx1.entriesOn('2026-10-21');
  const dayB = idx1.entriesOn('2026-10-21');
  isTrue(dayA === dayB, 'entriesOn réutilise dayCache');
});

test('Performance : getEventSchedule() mémoïsé par WeakMap sans muter les objets figés', () => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const ev = Object.freeze(normalizeEntry({
    id: 'sched-1', type: 'event', title: 'Cours', date: '2026-10-21', startTime: '09:00', endTime: '10:00', timeZone: zone,
  }));
  const s1 = getEventSchedule(ev);
  const s2 = getEventSchedule(ev);
  isTrue(s1 === s2, 'même objet schedule retourné pour un événement inchangé');
  isTrue(Object.isFrozen(s1), 'schedule retourné est figé');

  const modified = { ...ev, startTime: '15:00', endTime: '16:00' };
  const s3 = getEventSchedule(modified);
  isTrue(s3 !== s1 && s3.startTime === '15:00', 'clone modifié recalcule le schedule');
});

test('Recherche : mots-clés, casse, accents, balises HTML et verrouillage', async () => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const entries = [
    normalizeEntry({
      id: 's1', type: 'event', title: 'Médecin généraliste', date: '2026-10-21',
      startTime: '10:00', endTime: '10:30', timeZone: zone, location: 'Café de la Place',
      description: '<strong>Réunion</strong><mark class="hl-jaune">ok</mark> œuvre à côté',
    }),
    normalizeEntry({
      id: 's2', type: 'task', title: 'Acheter du pain', dueDate: '2026-10-22', priority: 'high', done: false,
    }),
    normalizeEntry({
      id: 's3', type: 'event', title: 'Congé annuel', date: '2026-11-02', allDay: true,
    }),
  ];

  equal(normalizeSearchText('Œuvre Café Côté'), 'oeuvre cafe cote');
  equal(searchEntries(entries, 'medecin', { locked: false, ready: true }).map((e) => e.id), ['s1']);
  equal(searchEntries(entries, 'CAFE oeuvre cote', { locked: false, ready: true }).map((e) => e.id), ['s1']);
  equal(searchEntries(entries, 'strong', { locked: false, ready: true }), [], 'balises HTML ignorées');
  equal(searchEntries(entries, 'hl-jaune', { locked: false, ready: true }), [], 'classes CSS ignorées');
  equal(searchEntries(entries, '   ', { locked: false, ready: true }), [], 'requête vide');
  equal(searchEntries(entries, 'journee entiere', { locked: false, ready: true }).map((e) => e.id), ['s3']);
  equal(searchEntries(entries, 'medecin', { locked: true, ready: true }), [], 'bloqué si verrouillé');
  equal(searchEntries(entries, 'medecin', { locked: false, ready: false }), [], 'bloqué si sécurité non prête');

  // Test d'intégration UI SearchBar + vidage immédiat sur suspendForBfcache()
  const prevOpen = indexedDB.open;
  const prevAppearance = localStorage.getItem('omni-agenda:apparence');
  const prevLockedAttr = document.documentElement.hasAttribute('data-locked');
  const { protection } = await createProtection('mot-de-passe-recherche', TEST_ITERATIONS);
  let fakeDb = null;
  indexedDB.open = () => {
    const req = {};
    queueMicrotask(() => {
      fakeDb = {
        close: () => {},
        transaction: () => {
          const tx = {
            objectStore: () => ({
              get: () => {
                const getReq = {};
                queueMicrotask(() => {
                  getReq.result = protection;
                  getReq.onsuccess?.();
                  tx.oncomplete?.();
                });
                return getReq;
              },
            }),
          };
          return tx;
        },
      };
      req.result = fakeDb;
      req.onsuccess?.();
    });
    return req;
  };

  const host = document.createElement('div');
  host.innerHTML = `
    <div class="agenda-search">
      <input type="search" id="champ-recherche">
      <button type="button" id="bouton-effacer-recherche" hidden>Effacer</button>
    </div>
    <section id="recherche-resultats" hidden>
      <p id="recherche-statut"></p>
      <ul id="recherche-liste"></ul>
    </section>
    <div class="agenda-nav"></div>
    <div id="accueil-vide"></div>
    <div id="livre-conteneur"></div>
  `;
  // Note: tests.html has no conflicting IDs; append temporarily inside host.
  document.body.append(host);
  try {
    const searchCtrl = initSearchBar({ onOpen: () => {}, onToggleDone: () => {}, onShowDay: () => {} });
    const input = document.getElementById('champ-recherche');
    const results = document.getElementById('recherche-resultats');
    const listNode = document.getElementById('recherche-liste');
    input.value = 'dentiste';
    listNode.innerHTML = '<li>Résultat fictif</li>';
    results.hidden = false;

    await loadProtection();
    isTrue(isLocked(), 'verrouillé avec protection mockée');
    suspendForBfcache();

    equal(input.value, '', 'champ recherche vidé au verrouillage');
    equal(listNode.children.length, 0, 'liste résultats vidée au verrouillage');
    equal(results.hidden, true, 'panneau résultats masqué au verrouillage');
    searchCtrl.clearSearch({ silent: true });
  } finally {
    fakeDb?.onclose?.();
    indexedDB.open = prevOpen;
    host.remove();
    if (!prevLockedAttr) document.documentElement.removeAttribute('data-locked');
    if (prevAppearance === null) localStorage.removeItem('omni-agenda:apparence');
    else localStorage.setItem('omni-agenda:apparence', prevAppearance);
    // Restaure un état non protégé propre pour la suite des tests unitaires.
    let cleanDb = null;
    indexedDB.open = () => {
      const req = {};
      queueMicrotask(() => {
        cleanDb = {
          close: () => {},
          transaction: () => {
            const tx = {
              objectStore: () => ({
                get: () => {
                  const getReq = {};
                  queueMicrotask(() => {
                    getReq.result = undefined;
                    getReq.onsuccess?.();
                    tx.oncomplete?.();
                  });
                  return getReq;
                },
              }),
            };
            return tx;
          },
        };
        req.result = cleanDb;
        req.onsuccess?.();
      });
      return req;
    };
    await loadProtection();
    cleanDb?.onclose?.();
    indexedDB.open = prevOpen;
    if (prevAppearance === null) localStorage.removeItem('omni-agenda:apparence');
    else localStorage.setItem('omni-agenda:apparence', prevAppearance);
    if (!prevLockedAttr) document.documentElement.removeAttribute('data-locked');
  }
});

test('Récurrences : O(1), fins de mois, bissextiles, bornes 1900–2200, rappels et sauvegarde', async () => {
  equal(daysBetween('2026-03-28', '2026-03-30'), 2);
  equal(RECURRENCE_FREQS.daily, 'Tous les jours');
  equal([MAX_RECURRENCE_INTERVAL, MAX_RECURRENCE_COUNT], [999, 999]);

  // Mensuelle le 31 -> 28/29 février -> 31 mars
  const monthly31 = normalizeEntry({
    id: 'rec-m31', type: 'event', title: 'Loyer', date: '2026-01-31', startTime: '09:00', endTime: '10:00',
    timeZone: 'Europe/Paris', recurrence: { freq: 'monthly', interval: 1, until: null, count: 4 },
  });
  equal(
    getOccurrencesInRange(monthly31, '2026-01-01', '2026-06-30'),
    ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'],
  );
  const monthlyLeap = normalizeEntry({
    id: 'rec-m29', type: 'event', title: 'Bissextile', date: '2028-01-31', startTime: '09:00', endTime: '10:00',
    timeZone: 'Europe/Paris', recurrence: { freq: 'monthly', interval: 1, until: null, count: 3 },
  });
  equal(
    getOccurrencesInRange(monthlyLeap, '2028-01-01', '2028-04-30'),
    ['2028-01-31', '2028-02-29', '2028-03-31'],
  );

  // Annuelle 29 février
  const yearlyLeap = normalizeEntry({
    id: 'rec-y29', type: 'event', title: 'Anniversaire', date: '2024-02-29', allDay: true,
    recurrence: { freq: 'yearly', interval: 1, until: '2029-01-01', count: null },
  });
  equal(
    getOccurrencesInRange(yearlyLeap, '2024-01-01', '2029-12-31'),
    ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'],
  );

  // Quotidienne + intervalle 2 + borne 2200-12-31 sans boucle infinie
  const dailyOld = normalizeEntry({
    id: 'rec-old', type: 'event', title: 'Quotidien', date: '1900-01-01', allDay: true,
    recurrence: { freq: 'daily', interval: 2, until: null, count: null },
  });
  equal(occurrenceIndexOnDate('1900-01-01', dailyOld.recurrence, '1900-01-03'), 1);
  equal(occurrenceIndexOnDate('1900-01-01', dailyOld.recurrence, '1900-01-04'), null);
  const tail = getOccurrencesInRange(dailyOld, '2200-12-25', '2205-01-05', { maxOccurrences: 100 });
  isTrue(tail.length > 0 && tail[tail.length - 1] <= MAX_DATE, 'expansion bornée à 2200-12-31');

  // Validation buildEntry : count / until hors bornes rejetés
  const badUntil = buildEntry({
    type: 'event', title: 'Test', date: '2026-10-21', allDay: true,
    recurrenceFreq: 'weekly', recurrenceInterval: '1', recurrenceEndMode: 'until', recurrenceUntil: '2201-01-01',
  });
  isTrue(Boolean(badUntil.errors.recurrenceUntil), 'until > 2200 rejeté');

  const badCount = buildEntry({
    type: 'event', title: 'Test', date: '2026-10-21', allDay: true,
    recurrenceFreq: 'weekly', recurrenceInterval: '1', recurrenceEndMode: 'count', recurrenceCount: '1000',
  });
  isTrue(Boolean(badCount.errors.recurrenceCount), 'count > 999 rejeté');

  // Libellés
  equal(recurrenceShortLabel({ freq: 'weekly', interval: 2 }), 'Toutes les 2 semaines');
  isTrue(formatRecurrenceLabel({ freq: 'daily', interval: 1, until: null, count: 3 }).includes('3 fois'));

  // data-focus-key uniques dans weekView pour plusieurs occurrences dans la même semaine
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const weeklyItem = normalizeEntry({
    id: 'rec-week', type: 'event', title: 'Standup', date: '2026-10-19', startTime: '09:30', endTime: '09:45',
    timeZone: zone, recurrence: { freq: 'daily', interval: 2, until: '2026-10-25', count: null },
  });
  const weekIdx = buildAgendaIndex([weeklyItem], '2026-10-21');
  const host = document.createElement('div');
  document.body.append(host);
  try {
    const pages = weekView.pages('2026-10-21', 'spread', {
      index: weekIdx,
      today: '2026-10-21',
      actions: { onOpen: () => {}, onToggleDone: () => {}, onAdd: () => {}, onShowDay: () => {}, onSelectDay: () => {} },
    });
    host.append(...pages);
    const keys = [...host.querySelectorAll('[data-focus-key]')].map((n) => n.dataset.focusKey);
    equal(keys.length, new Set(keys).size, 'data-focus-key uniques entre occurrences');

    const detailsNode = renderEntryDetails(weeklyItem, {
      occurrenceDate: '2026-10-21', onEdit: () => {}, onDelete: () => {}, onToggleDone: () => {},
    });
    isTrue(detailsNode.textContent.includes('Occurrence'), 'fiche indique l’occurrence cliquée');
  } finally {
    host.remove();
  }

  // Rappels par occurrence : clés distinctes
  const recRem = normalizeEntry({
    id: 'rec-rem', type: 'event', title: 'Pilule', date: '2030-05-10', startTime: '14:00', endTime: '14:15',
    timeZone: zone, reminderMinutes: 15, recurrence: { freq: 'daily', interval: 1, until: null, count: 5 },
  });
  const [due1] = getDueReminders([recRem], new Date(zonedTimeToInstant('2030-05-10', '14:00', zone).getTime() - 10 * 60000));
  const [due2] = getDueReminders([recRem], new Date(zonedTimeToInstant('2030-05-11', '14:00', zone).getTime() - 10 * 60000));
  isTrue(Boolean(due1 && due2 && due1.key !== due2.key), 'clés de rappel distinctes par occurrence');

  // Sauvegarde JSON (claire + chiffrée) et nettoyage normalizeEntry
  const badNorm = normalizeEntry({
    id: 'bad-rec', type: 'event', title: 'Ok', date: '2026-10-21', allDay: true, recurrence: { freq: 'invalid' },
  });
  equal(badNorm.recurrence, null, 'récurrence invalide nettoyée en null');

  const roundTrip = parseBackup(serializeBackup(createBackup([weeklyItem], new Date('2026-10-21T08:00:00Z'))));
  equal(roundTrip.entries[0].recurrence, weeklyItem.recurrence);

  const { key, protection } = await createProtection('rec-secret', TEST_ITERATIONS);
  const enc = await createEncryptedBackup([weeklyItem], new Date('2026-10-21T08:00:00Z'), { key, kdf: protection.kdf });
  const dec = await decryptBackup(parseBackup(serializeBackup(enc)), 'rec-secret');
  equal(dec.entries[0].recurrence, weeklyItem.recurrence);
});

test('Récurrences : multi-jours >= 8 occurrences, décalages >= 24h et fiche multi-fuseau', () => {
  // Bug 1 : événement récurrent journée entière multi-jours (spanDays = 10) sans troncature à 8
  const multiDaily = normalizeEntry({
    id: 'rec-span10', type: 'event', title: 'Salon', date: '2026-05-01', endDate: '2026-05-11',
    allDay: true, recurrence: { freq: 'daily', interval: 1, until: null, count: null },
  });
  const spanHits = buildAgendaIndex([multiDaily], '2026-05-20').entriesOn('2026-05-20');
  equal(spanHits.length, 11, '11 occurrences actives (spanDays = 10) sans troncature à 8');
  isTrue(spanHits.some((e) => e.occurrenceDate === '2026-05-20'), 'occurrence du jour lui-même présente');
  equal(spanHits[0].occurrenceDate, '2026-05-10');
  equal(spanHits[spanHits.length - 1].occurrenceDate, '2026-05-20');

  // Exclusion mutuelle until / count dans normalizeRecurrence
  const bothBounds = normalizeEntry({
    id: 'rec-both', type: 'event', title: 'Bornes', date: '2026-05-01', allDay: true,
    recurrence: { freq: 'weekly', interval: 1, until: '2026-06-01', count: 5 },
  });
  equal(bothBounds.recurrence, { freq: 'weekly', interval: 1, until: '2026-06-01', count: null }, 'until exclut count à la normalisation');
  const staleUntil = normalizeEntry({
    id: 'rec-stale-until', type: 'event', title: 'Bornes 2', date: '2026-05-01', allDay: true,
    recurrence: { freq: 'weekly', interval: 1, until: '2026-04-01', count: 5 },
  });
  equal(staleUntil.recurrence, { freq: 'weekly', interval: 1, until: null, count: 5 }, 'until antérieur à date laisse count');

  const OrigDateTimeFormat = Intl.DateTimeFormat;
  function withDeviceTimeZone(tz, fn) {
    Intl.DateTimeFormat = function DateTimeFormat(...args) {
      if (args.length === 0 || !args[1] || !args[1].timeZone) {
        const dtf = new OrigDateTimeFormat(...args);
        const origResolved = dtf.resolvedOptions.bind(dtf);
        dtf.resolvedOptions = () => ({ ...origResolved(), timeZone: tz });
        return dtf;
      }
      return new OrigDateTimeFormat(...args);
    };
    Intl.DateTimeFormat.supportedLocalesOf = OrigDateTimeFormat.supportedLocalesOf;
    try {
      return fn();
    } finally {
      Intl.DateTimeFormat = OrigDateTimeFormat;
    }
  }

  // Bug 2 : décalage >= 24h entre Pacific/Midway (UTC-11) et Pacific/Kiritimati (UTC+14)
  const midwayDaily = normalizeEntry({
    id: 'rec-midway', type: 'event', title: 'Midway 23h', date: '2026-05-01',
    startTime: '23:00', endTime: '23:30', timeZone: 'Pacific/Midway',
    recurrence: { freq: 'daily', interval: 1, until: null, count: null },
  });
  withDeviceTimeZone('Pacific/Kiritimati', () => {
    const idxK = buildAgendaIndex([midwayDaily], '2026-05-03');
    const hitsK = idxK.entriesOn('2026-05-03');
    equal(hitsK.length, 1, 'Midway 23:00 (2026-05-01) indexé sur Kiritimati 2026-05-03 (+2 jours)');
    equal(hitsK[0].occurrenceDate, '2026-05-01');
  });

  const kiritimatiDaily = normalizeEntry({
    id: 'rec-kiritimati', type: 'event', title: 'Kiritimati 00h30', date: '2026-05-03',
    startTime: '00:30', endTime: '01:00', timeZone: 'Pacific/Kiritimati',
    recurrence: { freq: 'daily', interval: 1, until: null, count: null },
  });
  withDeviceTimeZone('Pacific/Midway', () => {
    const idxM = buildAgendaIndex([kiritimatiDaily], '2026-05-01');
    const hitsM = idxM.entriesOn('2026-05-01');
    equal(hitsM.length, 1, 'Kiritimati 00:30 (2026-05-03) indexé sur Midway 2026-05-01 (-2 jours)');
    equal(hitsM[0].occurrenceDate, '2026-05-03');
  });

  // Bug 3 : renderEntryDetails affiche Occurrence, Première date et Horaire dans le fuseau de l'appareil
  const nyWeekly = normalizeEntry({
    id: 'rec-ny-details', type: 'event', title: 'NY 22:00 Weekly', date: '2026-05-01',
    startTime: '22:00', endTime: '23:00', timeZone: 'America/New_York',
    recurrence: { freq: 'weekly', interval: 1, until: null, count: null },
  });
  withDeviceTimeZone('Europe/Paris', () => {
    const baseSched = getEventSchedule(nyWeekly);
    const occSched = getEventSchedule({ ...nyWeekly, date: '2026-05-08' });
    equal(baseSched.startDate, '2026-05-02');
    equal(occSched.startDate, '2026-05-09');
    const details = renderEntryDetails(nyWeekly, {
      occurrenceDate: '2026-05-08', onEdit: () => {}, onDelete: () => {}, onToggleDone: () => {},
    });
    const rows = Object.fromEntries(
      [...details.querySelectorAll('.details-row')].map((r) => [
        r.querySelector('dt').textContent,
        r.querySelector('dd').textContent,
      ]),
    );
    isTrue(rows['Occurrence'].includes(formatISODateLong(occSched.startDate)), 'Occurrence dans le fuseau appareil');
    isTrue(rows['Première date'].includes(formatISODateLong(baseSched.startDate)), 'Première date cohérente');
    equal(rows['Horaire'], `${occSched.startTime} – ${occSched.endTime}`, 'Horaire local affiché');
    isTrue(Boolean(rows['Fuseau horaire']), 'Note de fuseau horaire affichée');
  });

  // Bug 3 (multi-jours journée entière récurrent) : Horaire reflète les dates de l'occurrence cliquée
  const multiRec = normalizeEntry({
    id: 'rec-allday-details', type: 'event', title: 'Stage', date: '2026-05-01', endDate: '2026-05-03',
    allDay: true, recurrence: { freq: 'weekly', interval: 1, until: null, count: null },
  });
  const multiDetails = renderEntryDetails(multiRec, {
    occurrenceDate: '2026-05-08', onEdit: () => {}, onDelete: () => {}, onToggleDone: () => {},
  });
  const multiRows = Object.fromEntries(
    [...multiDetails.querySelectorAll('.details-row')].map((r) => [
      r.querySelector('dt').textContent,
      r.querySelector('dd').textContent,
    ]),
  );
  isTrue(multiRows['Occurrence'].includes(formatISODateLong('2026-05-08')), 'Occurrence all-day correcte');
  isTrue(multiRows['Première date'].includes(formatISODateLong('2026-05-01')), 'Première date all-day correcte');
  isTrue(multiRows['Horaire'].includes('8 mai') && multiRows['Horaire'].includes('10 mai'), 'Horaire multi-jours sur l’occurrence');
});

test('Journée entière : modèle, tri, multi-jours bornés, formulaire, rappels et sauvegarde', () => {
  const { entry: single, errors } = buildEntry({
    type: 'event', title: 'Congé', date: '2026-10-21', allDay: true, reminderMinutes: '60',
  });
  equal(errors, {});
  equal([single.allDay, single.endDate, single.startTime, single.endTime], [true, '2026-10-21', null, null]);

  const { errors: badEnd } = buildEntry({
    type: 'event', title: 'Invalide', date: '2026-10-21', allDay: true, endDate: '2026-10-20', reminderMinutes: '',
  });
  isTrue(Boolean(badEnd.endDate), 'endDate < date refusé');

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timedZero = normalizeEntry({
    id: 't0', type: 'event', title: 'Minuit', date: '2026-10-21', startTime: '00:00', endTime: '01:00', timeZone: zone,
  });
  const taskDay = normalizeEntry({ id: 'tk', type: 'task', title: 'Tâche', dueDate: '2026-10-21' });
  const sorted = [taskDay, timedZero, single].sort(compareEntries);
  equal(sorted.map((e) => e.id), [single.id, timedZero.id, taskDay.id], 'journée entière triée avant 00:00 et tâches');

  // Multi-jour 1900–2200 sans explosion mémoire
  const giantSpan = normalizeEntry({
    id: 'giant', type: 'event', title: 'Long', date: MIN_DATE, endDate: MAX_DATE, allDay: true,
  });
  const giantIndex = buildAgendaIndex([giantSpan], '2026-10-21');
  equal(giantIndex.entriesOn('2026-10-21').map((e) => e.id), ['giant']);

  // Rappel journée entière : pas de undefined/null
  const sched = getEventSchedule(single);
  const remWhen = reminderText({ entry: single, schedule: sched }, new Date(sched.start.getTime() - 30 * 60000));
  isTrue(remWhen.body.includes('journée entière'), 'mention journée entière dans le rappel');
  isTrue(!remWhen.body.includes('undefined') && !remWhen.body.includes('null'), 'aucun undefined/null dans le rappel');

  // Formulaire : ouverture sur un allDay existant sans planter et bascule isDirty()
  const host = document.createElement('div');
  document.body.append(host);
  try {
    const form = renderEntryForm({ entry: single, onSubmit: async () => {}, onCancel: () => {} });
    host.append(form.element);
    equal(form.element.querySelectorAll('input[type="time"]').length, 2, 'champs time conservés dans le DOM');
    equal(form.isDirty(), false, 'formulaire propre à l’ouverture');
    const cb = form.element.querySelector('input[name="allDay"]');
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    isTrue(form.isDirty(), 'décocher Journée entière rend le formulaire modifié');
  } finally {
    host.remove();
  }

  // Sauvegarde JSON
  const rt = parseBackup(serializeBackup(createBackup([single], new Date('2026-10-21T08:00:00Z'))));
  equal(rt.entries[0].allDay, true);
  equal(rt.entries[0].endDate, '2026-10-21');
});

test('Export .ics (RFC 5545) : CRLF, échappement, pliage 75 octets UTF-8, VEVENT/VTODO et garde', async () => {
  equal(escapeIcsText('a\\b;c,d\ne\u0007f'), 'a\\\\b\\;c\\,d\\nef');

  const longAccent = `SUMMARY:${'é€😀'.repeat(20)}`;
  const folded = foldIcsLine(longAccent);
  const chunks = folded.split('\r\n');
  isTrue(chunks.length > 1, 'ligne longue pliée');
  for (const chunk of chunks) {
    isTrue(new TextEncoder().encode(chunk).length <= 75, 'chaque ligne <= 75 octets UTF-8');
  }
  equal(folded.replace(/\r\n /g, ''), longAccent, 'aucun caractère multi-octet cassé au pliage');

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const allDay = normalizeEntry({
    id: 'ics-all', type: 'event', title: 'Fête; avec, virgule\\slash', date: '2026-10-21', allDay: true,
    description: 'Ligne 1<br>Ligne 2', location: 'Paris, France', reminderMinutes: 30,
  });
  const overnight = normalizeEntry({
    id: 'ics-night', type: 'event', title: 'Nuit', date: '2026-12-31', startTime: '22:00', endTime: '01:00', timeZone: zone,
  });
  const recurring = normalizeEntry({
    id: 'ics-rec', type: 'event', title: 'Hebdo', date: '2026-10-21', startTime: '09:00', endTime: '10:00',
    timeZone: zone, recurrence: { freq: 'weekly', interval: 2, until: null, count: 5 },
  });
  const taskUndated = normalizeEntry({
    id: 'ics-t1', type: 'task', title: 'Lire', dueDate: null, priority: 'high', done: false,
  });
  const taskDone = normalizeEntry({
    id: 'ics-t2', type: 'task', title: 'Fait', dueDate: '2026-10-20', priority: 'low', done: true,
  });

  const ics = exportEntriesToIcs([allDay, overnight, recurring, taskUndated, taskDone], {
    now: new Date('2026-10-21T08:00:00Z'),
  });
  isTrue(ics.startsWith('BEGIN:VCALENDAR\r\n'), 'commence par BEGIN:VCALENDAR');
  isTrue(ics.endsWith('END:VCALENDAR\r\n'), 'finit par END:VCALENDAR\\r\\n');
  isTrue(!/(?<!\r)\n/.test(ics), 'aucun LF nu sans CR');
  isTrue(ics.includes('SUMMARY:Fête\\; avec\\, virgule\\\\slash\r\n'), 'échappement RFC 5545');
  isTrue(ics.includes('DTSTART;VALUE=DATE:20261021\r\n'), 'all-day DTSTART');
  isTrue(ics.includes('DTEND;VALUE=DATE:20261022\r\n'), 'all-day DTEND exclusif');
  isTrue(ics.includes('RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=5\r\n'), 'RRULE générée');
  isTrue(ics.includes('TRIGGER:-PT30M\r\n'), 'VALARM générée');
  isTrue(ics.includes('BEGIN:VTODO\r\n') && !ics.includes('DUE;VALUE=DATE:null'), 'VTODO sans DUE null');
  isTrue(ics.includes('STATUS:COMPLETED\r\n'), 'VTODO terminée');
  equal(icsFileName('2026-10-21'), 'omni-agenda-2026-10-21.ics');

  // Garde verrouillée : après loadProtection() + suspendForBfcache(), exportAgendaIcs refuse quand isLocked() === true.
  const prevOpen = indexedDB.open;
  const prevAppearance = localStorage.getItem('omni-agenda:apparence');
  const prevLockedAttr = document.documentElement.hasAttribute('data-locked');
  const { protection } = await createProtection('mot-de-passe-ics', TEST_ITERATIONS);
  let fakeDb = null;
  indexedDB.open = () => {
    const req = {};
    queueMicrotask(() => {
      fakeDb = {
        close: () => {},
        transaction: () => {
          const tx = {
            objectStore: () => ({
              get: () => {
                const getReq = {};
                queueMicrotask(() => {
                  getReq.result = protection;
                  getReq.onsuccess?.();
                  tx.oncomplete?.();
                });
                return getReq;
              },
            }),
          };
          return tx;
        },
      };
      req.result = fakeDb;
      req.onsuccess?.();
    });
    return req;
  };
  try {
    await loadProtection();
    isTrue(isSecurityReady() && isLocked(), 'verrouillé après loadProtection()');
    suspendForBfcache();
    let threwLocked = false;
    try {
      exportAgendaIcs([allDay]);
    } catch {
      threwLocked = true;
    }
    isTrue(threwLocked, 'exportAgendaIcs refuse quand isLocked() === true');
  } finally {
    fakeDb?.onclose?.();
    indexedDB.open = prevOpen;
    if (!prevLockedAttr) document.documentElement.removeAttribute('data-locked');
    if (prevAppearance === null) localStorage.removeItem('omni-agenda:apparence');
    else localStorage.setItem('omni-agenda:apparence', prevAppearance);
    let cleanDb = null;
    indexedDB.open = () => {
      const req = {};
      queueMicrotask(() => {
        cleanDb = {
          close: () => {},
          transaction: () => {
            const tx = {
              objectStore: () => ({
                get: () => {
                  const getReq = {};
                  queueMicrotask(() => {
                    getReq.result = undefined;
                    getReq.onsuccess?.();
                    tx.oncomplete?.();
                  });
                  return getReq;
                },
              }),
            };
            return tx;
          },
        };
        req.result = cleanDb;
        req.onsuccess?.();
      });
      return req;
    };
    await loadProtection();
    cleanDb?.onclose?.();
    indexedDB.open = prevOpen;
    if (prevAppearance === null) localStorage.removeItem('omni-agenda:apparence');
    else localStorage.setItem('omni-agenda:apparence', prevAppearance);
    if (!prevLockedAttr) document.documentElement.removeAttribute('data-locked');
  }
});

test('Accessibilité : aria-pressed sur passwordField et role="grid" sur monthView', () => {
  const host = document.createElement('div');
  document.body.append(host);
  try {
    const pf = passwordField({ label: 'Mot de passe' });
    host.append(pf.element);
    const toggle = pf.element.querySelector('.password-toggle');
    equal(toggle.getAttribute('aria-pressed'), 'false');
    equal(pf.input.type, 'password');
    toggle.click();
    equal(toggle.getAttribute('aria-pressed'), 'true');
    equal(pf.input.type, 'text');
    equal(toggle.textContent, 'Masquer');
    toggle.click();
    equal(toggle.getAttribute('aria-pressed'), 'false');
    equal(pf.input.type, 'password');
    equal(toggle.textContent, 'Afficher');

    const emptyCtx = {
      index: buildAgendaIndex([], '2026-10-21'),
      today: '2026-10-21',
      actions: { onOpen: () => {}, onToggleDone: () => {}, onAdd: () => {}, onShowDay: () => {}, onSelectDay: () => {} },
    };
    const [page] = monthView.pages('2026-10-21', 'single', emptyCtx);
    host.append(page);
    const grid = page.querySelector('.month-grid');
    equal(grid?.getAttribute('role'), 'grid');
    isTrue(Boolean(grid?.querySelector('caption')), 'caption présente');
    isTrue(grid?.querySelectorAll('tr[role="row"]').length >= 5, 'lignes role="row" présentes');
    isTrue(grid?.querySelectorAll('th[role="columnheader"]').length === 7, 'entêtes role="columnheader" présents');
    isTrue(grid?.querySelectorAll('td[role="gridcell"][aria-selected]').length >= 28, 'cellules role="gridcell" présentes');
    equal(page.querySelector('.month-day[aria-pressed="true"]')?.dataset?.date, '2026-10-21');
  } finally {
    host.remove();
  }
});

test('sw.js : complétude réciproque de FILES avec index.html, manifest et CSS', async () => {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

  const swText = await (await fetch('../sw.js', { cache: 'no-store' })).text();
  const match = /const FILES\s*=\s*\[([\s\S]*?)\];/.exec(swText);
  isTrue(Boolean(match), 'liste FILES trouvée dans sw.js');
  const files = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const fileSet = new Set(files);

  const html = await (await fetch('../index.html', { cache: 'no-store' })).text();
  const refs = new Set();
  for (const attr of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const val = attr[1];
    if (!/^(?:https?:|mailto:|data:|#)/.test(val)) refs.add(val);
  }
  const manifest = await (await fetch('../manifest.webmanifest', { cache: 'no-store' })).json();
  for (const icon of manifest.icons ?? []) {
    if (icon.src) refs.add(icon.src);
  }
  for (const ref of [...refs]) {
    if (ref.endsWith('.css')) {
      const css = await (await fetch(`../${ref}`, { cache: 'no-store' })).text();
      for (const u of css.matchAll(/url\((?:"|')?([^"')]+)(?:"|')?\)/g)) {
        const resolved = u[1].replace(/^\.\.\//, '');
        if (!/^(?:data:|https?:|#|%23)/i.test(resolved)) refs.add(resolved);
      }
    }
  }

  for (const ref of refs) {
    isTrue(fileSet.has(ref), `${ref} manquant dans sw.js FILES`);
  }
  for (const file of files) {
    if (file === './') continue;
    const res = await fetch(`../${file}`, { cache: 'no-store' });
    isTrue(res.ok, `${file} dans sw.js introuvable (${res.status})`);
  }
});

// ---------------------------------------------------------------
// Lancement des tests, un par un, puis affichage des résultats
// ---------------------------------------------------------------
for (const { name, fn } of tests) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, message: error.message });
  }
}

const list = document.getElementById('resultats');
for (const result of results) {
  const item = document.createElement('li');
  item.className = result.ok ? 'test-ok' : 'test-failed';
  item.textContent = result.ok ? `✓ ${result.name}` : `✗ ${result.name} — ${result.message}`;
  list.append(item);
}
const failed = results.filter((result) => !result.ok).length;
const summary = document.getElementById('resume');
summary.textContent = failed === 0
  ? `✓ Les ${results.length} tests sont réussis.`
  : `✗ ${failed} test(s) échoué(s) sur ${results.length}.`;
summary.classList.add(failed === 0 ? 'is-ok' : 'is-failed');

// Pour les tests automatiques lancés depuis un autre programme.
window.testResults = results;
