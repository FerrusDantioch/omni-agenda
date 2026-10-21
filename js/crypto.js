// =============================================================
// crypto.js — Le chiffrement (rendre les données illisibles)
// -------------------------------------------------------------
// On utilise uniquement les outils de chiffrement intégrés au
// navigateur (« Web Crypto ») : aucune bibliothèque extérieure.
//
//  - PBKDF2 transforme le mot de passe en « clé » de chiffrement.
//    Ce calcul est volontairement lent (600 000 tours) : celui qui
//    voudrait essayer des millions de mots de passe serait freiné.
//  - AES-GCM chiffre les données avec cette clé. Il détecte aussi
//    toute modification : un mauvais mot de passe ou des données
//    trafiquées sont reconnus à coup sûr.
//
// Le mot de passe n'est JAMAIS enregistré. On enregistre seulement :
//  - le « sel » : un nombre tiré au hasard, mélangé au mot de passe
//    (deux personnes qui ont le même mot de passe n'ont donc pas la
//    même clé) ;
//  - une « valeur de contrôle » chiffrée : si on arrive à la
//    déchiffrer, c'est que le mot de passe est le bon.
// =============================================================

/** Nombre de tours du calcul PBKDF2 (recommandation actuelle pour SHA-256). */
export const PBKDF2_ITERATIONS = 600000;

// Bornes acceptées pour un fichier ou un réglage lu : en dessous, ce ne serait
// pas assez sûr ; au-dessus, un fichier piégé pourrait bloquer l'appareil.
const MIN_ITERATIONS = 100000;
const MAX_ITERATIONS = 5000000;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const CHECK_VALUE = 'omni-agenda';
const CHECK_LABEL = 'controle';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Vrai si le navigateur sait chiffrer. Ce n'est le cas que sur une adresse
 * sécurisée (qui commence par https://) ou sur l'ordinateur lui-même (localhost).
 */
export function isCryptoAvailable() {
  return Boolean(globalThis.isSecureContext && globalThis.crypto?.subtle);
}

/** Des octets tirés au hasard (un octet = un nombre de 0 à 255). */
export function randomBytes(count) {
  return crypto.getRandomValues(new Uint8Array(count));
}

// ---------------------------------------------------------------
// Base64 : écrire des octets avec des lettres et des chiffres
// (pour pouvoir les mettre dans un fichier texte)
// ---------------------------------------------------------------

export function toBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  // Par paquets : beaucoup plus rapide pour un gros agenda.
  for (let start = 0; start < view.length; start += 0x8000) {
    binary += String.fromCharCode(...view.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

/** Lance une erreur si le texte n'est pas du base64 valide. */
export function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------
// Clé, chiffrement, déchiffrement
// ---------------------------------------------------------------

/**
 * Transforme le mot de passe en clé de chiffrement.
 * Les accents sont d'abord écrits de la même façon sur tous les appareils
 * (« normalisation NFC ») : « é » tapé sur un téléphone ou un ordinateur
 * donne bien la même clé.
 * La clé obtenue ne peut pas être extraite : elle reste dans le navigateur.
 */
export async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey(
    'raw', encoder.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Chiffre une valeur (d'abord écrite en texte JSON).
 * `label` est un texte attaché au chiffrement : pour déchiffrer, il faut
 * donner le même. On empêche ainsi d'échanger deux contenus chiffrés.
 * Renvoie { iv, data } : iv est un nombre aléatoire, différent à chaque fois.
 */
export async function encryptJson(key, value, label) {
  const iv = randomBytes(IV_BYTES);
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(label) },
    key,
    encoder.encode(JSON.stringify(value)),
  );
  return { iv, data: new Uint8Array(data) };
}

/** Déchiffre. Lance une erreur si la clé est mauvaise ou si les données ont été modifiées. */
export async function decryptJson(key, { iv, data }, label) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(label) },
    key,
    data,
  );
  return JSON.parse(decoder.decode(plain));
}

// ---------------------------------------------------------------
// « Protection » : ce qui est enregistré pour un mot de passe
// ---------------------------------------------------------------
//   {
//     version: 1,
//     kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: '…' },
//     check: { iv: '…', data: '…' }     ← la valeur de contrôle chiffrée
//   }

/** Vrai si les réglages du calcul de la clé sont acceptables. */
export function isValidKdf(kdf) {
  if (!kdf || typeof kdf !== 'object') return false;
  if (kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256') return false;
  if (!Number.isInteger(kdf.iterations) || kdf.iterations < MIN_ITERATIONS || kdf.iterations > MAX_ITERATIONS) return false;
  try {
    return typeof kdf.salt === 'string' && fromBase64(kdf.salt).length >= SALT_BYTES && kdf.salt.length <= 200;
  } catch {
    return false;
  }
}

/** Vrai si une protection lue sur l'appareil a la forme attendue. */
export function isValidProtection(protection) {
  return Boolean(protection) && protection.version === 1 && isValidKdf(protection.kdf)
    && typeof protection.check?.iv === 'string' && typeof protection.check?.data === 'string';
}

/**
 * Prépare la protection d'un nouveau mot de passe.
 * Renvoie { protection, key } : `protection` est à enregistrer,
 * `key` sert à chiffrer (elle n'est jamais enregistrée).
 */
export async function createProtection(password, iterations = PBKDF2_ITERATIONS) {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, iterations);
  const check = await encryptJson(key, CHECK_VALUE, CHECK_LABEL);
  return {
    key,
    protection: {
      version: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
      check: { iv: toBase64(check.iv), data: toBase64(check.data) },
    },
  };
}

/** Vérifie un mot de passe. Renvoie la clé s'il est bon, null sinon. */
export async function openProtection(protection, password) {
  const key = await deriveKey(password, fromBase64(protection.kdf.salt), protection.kdf.iterations);
  try {
    const check = { iv: fromBase64(protection.check.iv), data: fromBase64(protection.check.data) };
    return (await decryptJson(key, check, CHECK_LABEL)) === CHECK_VALUE ? key : null;
  } catch {
    return null;
  }
}
