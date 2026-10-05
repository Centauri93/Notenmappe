/**
 * Passwortschutz: App-Sperre + Verschlüsselung der gespeicherten Daten.
 *
 * Der Schlüssel wird aus dem Passwort abgeleitet (PBKDF2 → AES-GCM) und nur
 * im Arbeitsspeicher gehalten, nie persistiert. Ohne korrektes Passwort
 * lassen sich weder die App-Sperre öffnen noch die verschlüsselten Felder
 * in der Datenbank oder einer Sicherungsdatei lesen.
 *
 * Es gibt bewusst keine Passwort-Wiederherstellung: Es gibt keinen Server,
 * der ein vergessenes Passwort zurücksetzen könnte. Geht es verloren, sind
 * die verschlüsselten Daten unwiderruflich unlesbar.
 */

import { get, put, del } from './db.js';

const ITERATIONS = 300_000;
const META_KEY = 'security';
const VERIFIER_TEXT = 'notenmappe-ok';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** @type {CryptoKey|null} in dieser Sitzung aktiver Schlüssel */
let activeKey = null;

/** Ist auf diesem Gerät ein Passwort eingerichtet? */
export async function isConfigured() {
  return Boolean(await get('meta', META_KEY));
}

/** Ist die App in dieser Sitzung bereits entsperrt? */
export function isUnlocked() {
  return activeKey !== null;
}

/** Sperrt die App wieder – der Schlüssel wird aus dem Speicher entfernt. */
export function lock() {
  activeKey = null;
}

/** @returns {CryptoKey} */
function requireKey() {
  if (!activeKey) throw new Error('App ist gesperrt.');
  return activeKey;
}

/** Liefert den aktiven Schlüssel dieser Sitzung (wirft, falls gesperrt). */
export function getActiveKey() {
  return requireKey();
}

/* -------------------------------------------------------- Schlüssel-Herleitung */

/** @returns {Promise<CryptoKey>} */
async function deriveKey(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Erzeugt einen neuen Zufallssalt für ein neues Passwort. */
export function randomSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}

/** @returns {Promise<{iv: Uint8Array, data: Uint8Array}>} */
async function encryptWithKey(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { iv, data };
}

/** @returns {Promise<Uint8Array>} */
async function decryptWithKey(key, { iv, data }) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new Uint8Array(plain);
}

/** @returns {Promise<{iv: Uint8Array, data: Uint8Array}>} */
async function makeVerifier(key) {
  return encryptWithKey(key, enc.encode(VERIFIER_TEXT));
}

/** Prüft, ob ein Schlüssel zu einem gespeicherten Prüfwert passt. */
async function checkVerifier(key, verifier) {
  try {
    return dec.decode(await decryptWithKey(key, verifier)) === VERIFIER_TEXT;
  } catch {
    return false; // falscher Schlüssel → GCM-Authentifizierung schlägt fehl
  }
}

/* ------------------------------------------------------- Einrichten / Entsperren */

/**
 * Richtet den Passwortschutz auf diesem Gerät erstmalig ein.
 * `migrate(key)` wird mit dem neuen Schlüssel aufgerufen, bevor der Schutz
 * als aktiv gilt – dort verschlüsselt store.js die vorhandenen Daten.
 */
export async function setup(password, migrate) {
  const salt = randomSalt();
  const key = await deriveKey(password, salt);
  await migrate(key);
  const verifier = await makeVerifier(key);
  await put('meta', { key: META_KEY, salt, verifier });
  activeKey = key;
}

/**
 * Versucht, mit dem angegebenen Passwort zu entsperren.
 * @returns {Promise<boolean>} true bei Erfolg
 */
export async function unlock(password) {
  const record = await get('meta', META_KEY);
  if (!record) return false;
  const key = await deriveKey(password, record.salt);
  if (!(await checkVerifier(key, record.verifier))) return false;
  activeKey = key;
  return true;
}

/**
 * Ändert das Passwort. `reencrypt(oldKey, newKey)` entschlüsselt alle Daten
 * mit dem alten und schreibt sie sofort mit dem neuen Schlüssel zurück.
 */
export async function changePassword(oldPassword, newPassword, reencrypt) {
  const record = await get('meta', META_KEY);
  if (!record) throw new Error('Es ist noch kein Passwortschutz eingerichtet.');
  const oldKey = await deriveKey(oldPassword, record.salt);
  if (!(await checkVerifier(oldKey, record.verifier))) {
    throw new Error('Aktuelles Passwort ist falsch.');
  }
  const salt = randomSalt();
  const newKey = await deriveKey(newPassword, salt);
  await reencrypt(oldKey, newKey);
  const verifier = await makeVerifier(newKey);
  await put('meta', { key: META_KEY, salt, verifier });
  activeKey = newKey;
}

/**
 * Entfernt den Passwortschutz wieder. `decrypt(key)` schreibt alle Daten
 * unverschlüsselt zurück, bevor der Schutz deaktiviert wird.
 */
export async function removeProtection(password, decryptAll) {
  const record = await get('meta', META_KEY);
  if (!record) return;
  const key = await deriveKey(password, record.salt);
  if (!(await checkVerifier(key, record.verifier))) {
    throw new Error('Passwort ist falsch.');
  }
  await decryptAll(key);
  await del('meta', META_KEY);
  lock();
}

/* ------------------------------------------------- Ver-/Entschlüsseln (aktiver Schlüssel) */

/** Verschlüsselt ein JSON-fähiges Objekt mit dem aktiven Schlüssel. */
export function encryptJSON(value) {
  return encryptWithKey(requireKey(), enc.encode(JSON.stringify(value)));
}

/** Entschlüsselt ein zuvor mit encryptJSON verschlüsseltes Objekt. */
export async function decryptJSON(blob) {
  return JSON.parse(dec.decode(await decryptWithKey(requireKey(), blob)));
}

/** Verschlüsselt rohe Bytes (z.B. ein Foto) mit dem aktiven Schlüssel. */
export function encryptRaw(bytes) {
  return encryptWithKey(requireKey(), bytes);
}

/** Entschlüsselt zuvor mit encryptRaw verschlüsselte Bytes. */
export function decryptRaw(blob) {
  return decryptWithKey(requireKey(), blob);
}

/* --------------------------------------------------- Für Migration / Backup-Dateien */

/** JSON mit einem beliebigen (nicht notwendig aktivem) Schlüssel verschlüsseln. */
export function encryptJSONWithKey(key, value) {
  return encryptWithKey(key, enc.encode(JSON.stringify(value)));
}

/** JSON mit einem beliebigen Schlüssel entschlüsseln. */
export async function decryptJSONWithKey(key, blob) {
  return JSON.parse(dec.decode(await decryptWithKey(key, blob)));
}

export { deriveKey, encryptWithKey, decryptWithKey };
