// =============================================================
// tests.js — Tests automatiques (s'exécutent dans le navigateur)
// -------------------------------------------------------------
// Chaque test vérifie un comportement précis. Un test réussi
// affiche ✓, un test échoué affiche ✗ avec l'explication.
// =============================================================

import {
  addDays, addMonths, daysInMonth, formatDayMonth, formatISODateLong, isoWeekNumber, isValidISODate,
  isValidTime, minutesToTime, startOfWeek, timeToMinutes, wallTimeExists, zonedTimeToInstant, instantToZoned,
} from '../js/dates.js';
import { htmlToText, sanitizeHtml, textToHtml } from '../js/sanitize.js';
import { buildEntry, createId, getEventSchedule, normalizeEntry } from '../js/entries.js';
import {
  BackupError, backupFileName, createBackup, createEncryptedBackup, decryptBackup, describeEntries, parseBackup,
  planMerge, serializeBackup,
} from '../js/backup.js';
import {
  createProtection, decryptJson, encryptJson, fromBase64, isValidProtection, openProtection, toBase64,
} from '../js/crypto.js';
import { checkNewPassword } from '../js/security.js';
import { buildAgendaIndex } from '../js/views/agenda-data.js';
import { dayView } from '../js/views/day-view.js';
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
