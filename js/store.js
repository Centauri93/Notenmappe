/**
 * Fachliche Datenzugriffsschicht.
 *
 * Grundregel: Solange eine Stunde läuft, ist der Eintrag einer Schüler:in ein
 * Entwurf – Note, Bemerkung, „fehlt“ und Gewichtung lassen sich beliebig
 * ergänzen und korrigieren. Mit „Stunde beenden“ wird er festgeschrieben;
 * abgeschlossene Stunden werden nie mehr verändert.
 *
 * Ist der Passwortschutz aktiv, werden Namen, Fotos, Noten und Bemerkungen
 * verschlüsselt in der Datenbank abgelegt (siehe security.js). Diese Datei
 * kümmert sich um das transparente Ver-/Entschlüsseln beim Schreiben/Lesen –
 * alle Funktionen liefern nach außen weiterhin die entschlüsselten Objekte,
 * genau wie ohne Passwortschutz.
 *
 * @typedef {{id: string, name: string, seating: Record<string, {x:number,y:number}>, cardScale?: number, createdAt: number}} Klasse
 * @typedef {{id: string, classId: string, firstName: string, lastName: string, photo: Blob|null, createdAt: number}} Schueler
 * @typedef {{id: string, classId: string, startedAt: number, closedAt: number|null}} Session
 * @typedef {{id: string, sessionId: string, classId: string, studentId: string, value: number|null, comment: string, absent?: boolean, weight?: number, createdAt: number, updatedAt?: number}} Note
 */

/**
 * Wählbare Gewichtungsfaktoren für besonders zählende Leistungen
 * (z.B. Referat, Vortrag, Projekt). Alles andere zählt einfach (1).
 */
export const WEIGHT_OPTIONS = [2, 3, 5];

import { tx, reqAsPromise, getAll, getAllByIndex, get, put, del, newId } from './db.js';
import * as security from './security.js';

/* ------------------------------------------------------------------ Klassen */

/** @returns {Promise<Klasse[]>} */
export async function listClasses() {
  const rows = await getAll('classes');
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** @returns {Promise<Klasse|undefined>} */
export function getClass(id) {
  return get('classes', id);
}

/** @returns {Promise<Klasse>} */
export function createClass(name) {
  return put('classes', {
    id: newId(),
    name: name.trim(),
    seating: {},
    createdAt: Date.now(),
  });
}

/** @returns {Promise<Klasse>} */
export async function renameClass(id, name) {
  const cls = await getClass(id);
  if (!cls) throw new Error('Klasse nicht gefunden');
  cls.name = name.trim();
  return put('classes', cls);
}

/** Löscht Klasse inkl. Schüler:innen, Stunden und Noten. */
export async function deleteClass(id) {
  const stores = ['classes', 'students', 'sessions', 'grades'];
  return tx(stores, 'readwrite', async (t) => {
    await reqAsPromise(t.objectStore('classes').delete(id));
    for (const store of stores.slice(1)) {
      const keys = await reqAsPromise(
        t.objectStore(store).index('byClass').getAllKeys(IDBKeyRange.only(id)));
      for (const key of keys) await reqAsPromise(t.objectStore(store).delete(key));
    }
  });
}

/** Speichert die Sitzordnung (Position pro Schüler:in) einer Klasse. */
export async function saveSeating(classId, seating) {
  const cls = await getClass(classId);
  if (!cls) return;
  cls.seating = seating;
  await put('classes', cls);
}

/** Speichert die Kartengröße des Sitzplans in Prozent (60–150). */
export async function saveCardScale(classId, scale) {
  const cls = await getClass(classId);
  if (!cls) return;
  cls.cardScale = Math.min(150, Math.max(60, Math.round(scale)));
  await put('classes', cls);
}

/* ------------------------------------------------ Ver-/Entschlüsseln: Schüler:innen */

/**
 * @param {CryptoKey} key
 * @param {{id, classId, createdAt, firstName, lastName, photo}} plain
 */
export async function encryptStudentWithKey(key, plain) {
  const { id, classId, createdAt, firstName, lastName, photo } = plain;
  const encName = await security.encryptJSONWithKey(key, { firstName, lastName });
  const encPhoto = photo
    ? await security.encryptWithKey(key, new Uint8Array(await photo.arrayBuffer()))
    : null;
  return { id, classId, createdAt, encName, encPhoto };
}

/** @param {CryptoKey} key */
async function decryptStudentWithKey(key, row) {
  if (!row || !row.encName) return row; // schon unverschlüsselt gespeichert
  const { firstName, lastName } = await security.decryptJSONWithKey(key, row.encName);
  const photo = row.encPhoto
    ? new Blob([await security.decryptWithKey(key, row.encPhoto)], { type: 'image/jpeg' })
    : null;
  return { id: row.id, classId: row.classId, createdAt: row.createdAt, firstName, lastName, photo };
}

/** Baut den zu speichernden Datensatz – verschlüsselt, falls Schutz aktiv. */
async function toStudentRow(plain) {
  if (!(await security.isConfigured())) return plain;
  return encryptStudentWithKey(security.getActiveKey(), plain);
}

/** Wandelt einen gespeicherten Datensatz in das entschlüsselte Objekt. */
function fromStudentRow(row) {
  if (!row || !row.encName) return row;
  return decryptStudentWithKey(security.getActiveKey(), row);
}

/* ----------------------------------------------------------- Schüler:innen */

/** @returns {Promise<Schueler[]>} */
export async function listStudents(classId) {
  const rows = await getAllByIndex('students', 'byClass', IDBKeyRange.only(classId));
  const plain = await Promise.all(rows.map(fromStudentRow));
  return plain.sort(byName);
}

/** @param {Schueler} a @param {Schueler} b */
export function byName(a, b) {
  return (a.lastName || '').localeCompare(b.lastName || '', 'de')
    || (a.firstName || '').localeCompare(b.firstName || '', 'de');
}

/** @param {Schueler} s */
export function fullName(s) {
  return [s.firstName, s.lastName].filter(Boolean).join(' ');
}

/** @returns {Promise<Schueler|undefined>} */
export async function getStudent(id) {
  return fromStudentRow(await get('students', id));
}

/** Alle Schüler:innen aller Klassen – für den Backup-Export. */
export async function listAllStudents() {
  const rows = await getAll('students');
  return Promise.all(rows.map(fromStudentRow));
}

/** @returns {Promise<Schueler>} */
export async function createStudent({ classId, firstName, lastName, photo = null }) {
  const plain = {
    id: newId(),
    classId,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    photo,
    createdAt: Date.now(),
  };
  await put('students', await toStudentRow(plain));
  return plain;
}

/**
 * Aktualisiert Stammdaten. `photo` wird nur ersetzt, wenn der Schlüssel
 * im Patch vorhanden ist (so bleibt ein bestehendes Foto unangetastet).
 * @returns {Promise<Schueler>}
 */
export async function updateStudent(id, patch) {
  const s = await getStudent(id);
  if (!s) throw new Error('Schüler:in nicht gefunden');
  if (patch.firstName !== undefined) s.firstName = patch.firstName.trim();
  if (patch.lastName !== undefined) s.lastName = patch.lastName.trim();
  if ('photo' in patch) s.photo = patch.photo;
  await put('students', await toStudentRow(s));
  return s;
}

/**
 * Löscht Schüler:in inkl. aller Noten und entfernt sie aus der Sitzordnung.
 */
export async function deleteStudent(id) {
  const student = await getStudent(id);
  await tx(['students', 'grades'], 'readwrite', async (t) => {
    await reqAsPromise(t.objectStore('students').delete(id));
    for (const store of ['grades']) {
      const keys = await reqAsPromise(
        t.objectStore(store).index('byStudent').getAllKeys(IDBKeyRange.only(id)));
      for (const key of keys) await reqAsPromise(t.objectStore(store).delete(key));
    }
  });
  if (student) {
    const cls = await getClass(student.classId);
    if (cls && cls.seating[id]) {
      delete cls.seating[id];
      await put('classes', cls);
    }
  }
}

/* ---------------------------------------------------------------- Stunden */

/** @returns {Promise<Session[]>} */
export async function listSessions(classId) {
  const rows = await getAllByIndex('sessions', 'byClass', IDBKeyRange.only(classId));
  return rows.sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Liefert die offene Stunde der Klasse – oder legt sie an.
 * @returns {Promise<Session>}
 */
export async function getOrCreateOpenSession(classId) {
  const open = await findOpenSession(classId);
  if (open) return open;
  return put('sessions', {
    id: newId(),
    classId,
    startedAt: Date.now(),
    closedAt: null,
  });
}

/** @returns {Promise<Session|null>} */
export async function findOpenSession(classId) {
  const rows = await getAllByIndex('sessions', 'byClass', IDBKeyRange.only(classId));
  const open = rows.filter((s) => s.closedAt === null).sort((a, b) => b.startedAt - a.startedAt);
  return open[0] || null;
}

/**
 * Schließt die offene Stunde ab. Eine Stunde ohne Noten wird verworfen,
 * damit die Historie keine leeren Spalten bekommt.
 * @returns {Promise<{closed: boolean, discarded: boolean, count: number}>}
 */
export async function closeSession(classId) {
  const open = await findOpenSession(classId);
  if (!open) return { closed: false, discarded: false, count: 0 };
  const grades = await listGradesOfSession(open.id);
  if (grades.length === 0) {
    await del('sessions', open.id);
    return { closed: false, discarded: true, count: 0 };
  }
  open.closedAt = Date.now();
  await put('sessions', open);
  return { closed: true, discarded: false, count: grades.length };
}

/* -------------------------------------------------------- Ver-/Entschlüsseln: Noten */

/** @param {CryptoKey} key */
export async function encryptGradeWithKey(key, plain) {
  const { id, sessionId, classId, studentId, createdAt, updatedAt, value, comment, absent, weight } = plain;
  const enc = await security.encryptJSONWithKey(key, { value, comment, absent, weight });
  return { id, sessionId, classId, studentId, createdAt, updatedAt, enc };
}

/** @param {CryptoKey} key */
async function decryptGradeWithKey(key, row) {
  if (!row || !row.enc) return row; // schon unverschlüsselt gespeichert
  const { value, comment, absent, weight } = await security.decryptJSONWithKey(key, row.enc);
  return {
    id: row.id, sessionId: row.sessionId, classId: row.classId, studentId: row.studentId,
    createdAt: row.createdAt, updatedAt: row.updatedAt, value, comment, absent, weight,
  };
}

/** Baut den zu speichernden Datensatz – verschlüsselt, falls Schutz aktiv. */
async function toGradeRow(plain) {
  if (!(await security.isConfigured())) return plain;
  return encryptGradeWithKey(security.getActiveKey(), plain);
}

/** Wandelt einen gespeicherten Datensatz in das entschlüsselte Objekt. */
function fromGradeRow(row) {
  if (!row || !row.enc) return row;
  return decryptGradeWithKey(security.getActiveKey(), row);
}

/* ----------------------------------------------------------------- Noten */

/** @returns {Promise<Note[]>} */
export async function listGradesOfSession(sessionId) {
  const rows = await getAllByIndex('grades', 'bySession', IDBKeyRange.only(sessionId));
  const plain = await Promise.all(rows.map(fromGradeRow));
  return plain.sort((a, b) => a.createdAt - b.createdAt);
}

/** @returns {Promise<Note[]>} */
export async function listGradesOfClass(classId) {
  const rows = await getAllByIndex('grades', 'byClass', IDBKeyRange.only(classId));
  const plain = await Promise.all(rows.map(fromGradeRow));
  return plain.sort((a, b) => a.createdAt - b.createdAt);
}

/** @returns {Promise<Note[]>} */
export async function listGradesOfStudent(studentId) {
  const rows = await getAllByIndex('grades', 'byStudent', IDBKeyRange.only(studentId));
  const plain = await Promise.all(rows.map(fromGradeRow));
  return plain.sort((a, b) => a.createdAt - b.createdAt);
}

/** Alle Noten aller Klassen – für den Backup-Export. */
export async function listAllGrades() {
  const rows = await getAll('grades');
  return Promise.all(rows.map(fromGradeRow));
}

/**
 * Liefert den Eintrag einer Schüler:in in einer Stunde (oder undefined).
 * @returns {Promise<Note|undefined>}
 */
export async function findEntry(sessionId, studentId) {
  const rows = await listGradesOfSession(sessionId);
  return rows.find((g) => g.studentId === studentId);
}

/**
 * Legt den Eintrag einer Schüler:in in der laufenden Stunde an oder
 * aktualisiert ihn. Nur übergebene Felder werden geändert, alles andere
 * bleibt stehen – so überlebt eine Bemerkung das spätere Nachtragen einer Note.
 *
 * Ein Eintrag ohne Note, ohne Bemerkung, ohne „fehlt“ und ohne
 * Mehrfachwertung wird wieder entfernt. Die Mehrfachwertung zählt dabei
 * bewusst als eigener Grund zum Behalten: So lässt sie sich schon vor der
 * eigentlichen Note setzen („für dieses Referat gleich ×3 einstellen“),
 * ohne dass der Eintrag zwischendurch verschwindet.
 *
 * @param {{sessionId: string, classId: string, studentId: string,
 *          value?: number|null, comment?: string, absent?: boolean, weight?: number}} patch
 * @returns {Promise<Note|null>} der gespeicherte Eintrag, oder null wenn leer
 */
export async function saveEntry({ sessionId, classId, studentId, ...patch }) {
  const existing = await findEntry(sessionId, studentId);
  /** @type {Note} */
  const entry = existing || {
    id: newId(),
    sessionId,
    classId,
    studentId,
    value: null,
    comment: '',
    absent: false,
    weight: 1,
    createdAt: Date.now(),
  };

  if ('value' in patch) {
    if (patch.value === null || patch.value === undefined || patch.value === '') {
      entry.value = null;
    } else {
      const v = Number(patch.value);
      if (!Number.isInteger(v) || v < 1 || v > 6) throw new Error('Note muss zwischen 1 und 6 liegen');
      entry.value = v;
    }
  }
  if ('comment' in patch) entry.comment = (patch.comment || '').trim();
  if ('absent' in patch) entry.absent = Boolean(patch.absent);
  if ('weight' in patch) entry.weight = WEIGHT_OPTIONS.includes(patch.weight) ? patch.weight : 1;

  // Wer fehlt, bekommt keine Note und keine Gewichtung
  if (entry.absent) {
    entry.value = null;
    entry.weight = 1;
  }

  const isEmpty = entry.value === null && !entry.comment && !entry.absent && weightOf(entry) === 1;
  if (isEmpty) {
    if (existing) await del('grades', existing.id);
    return null;
  }

  entry.updatedAt = Date.now();
  await put('grades', await toGradeRow(entry));
  return entry;
}

/**
 * Nimmt eine Note zurück. Bewusst nur für die noch offene Stunde erlaubt –
 * abgeschlossene Stunden sind unveränderlich.
 */
export async function removeGradeFromOpenSession(gradeId) {
  const grade = await get('grades', gradeId);
  if (!grade) return;
  const session = await get('sessions', grade.sessionId);
  if (!session || session.closedAt !== null) {
    throw new Error('Noten abgeschlossener Stunden können nicht gelöscht werden.');
  }
  await del('grades', gradeId);
}

/* ------------------------------------------------------------ Auswertung */

/** Zählt ein Eintrag als Note für den Durchschnitt? */
export function countsForAverage(grade) {
  return !grade.absent && grade.value !== null && grade.value !== undefined;
}

/** Gewicht eines Eintrags (1 = normal, sonst einer der `WEIGHT_OPTIONS`). */
export function weightOf(grade) {
  return WEIGHT_OPTIONS.includes(grade.weight) ? grade.weight : 1;
}

/**
 * Gewichteter Durchschnitt aller Einzelnoten. Reine Bemerkungen und
 * „fehlt“-Einträge zählen nicht mit; mehrfach gewichtete Noten zählen
 * entsprechend oft (z.B. ×3 dreifach).
 * @param {Note[]} grades
 * @returns {{count: number, weightSum: number, average: number|null, rounded: number|null, hasBoost: boolean}}
 */
export function average(grades) {
  const graded = grades.filter(countsForAverage);
  if (!graded.length) {
    return { count: 0, weightSum: 0, average: null, rounded: null, hasBoost: false };
  }
  let sum = 0;
  let weightSum = 0;
  for (const g of graded) {
    const w = weightOf(g);
    sum += g.value * w;
    weightSum += w;
  }
  const avg = sum / weightSum;
  return {
    count: graded.length,
    weightSum,
    average: Math.round(avg * 100) / 100,
    rounded: Math.round(avg),
    hasBoost: graded.some((g) => weightOf(g) > 1),
  };
}

/** Formatiert einen Durchschnitt auf eine Nachkommastelle (deutsches Komma). */
export function formatAverage(avg) {
  if (avg === null || avg === undefined) return '–';
  return avg.toFixed(1).replace('.', ',');
}

/* ------------------------------------------------- Passwortschutz: Migration */

/**
 * Schreibt eine Liste bereits verschlüsselter Zeilen in einem Rutsch in die
 * Datenbank. Die Verschlüsselung passiert vorher außerhalb der Transaktion,
 * damit die Transaktion nur synchrone IndexedDB-Aufrufe enthält (asynchrone
 * Web-Crypto-Aufrufe innerhalb einer offenen Transaktion sind nicht auf
 * allen Browsern zuverlässig).
 */
async function writeRows(rowsByStore) {
  const names = Object.keys(rowsByStore);
  await tx(names, 'readwrite', (t) => {
    for (const name of names) {
      const objStore = t.objectStore(name);
      for (const row of rowsByStore[name]) objStore.put(row);
    }
    return Promise.resolve();
  });
}

/** Alle Ablagen mit personenbezogenen Inhalten, jeweils mit ihren Umwandlern. */
const SECRET_STORES = [
  { name: 'students', encrypt: encryptStudentWithKey, decrypt: decryptStudentWithKey },
  { name: 'grades', encrypt: encryptGradeWithKey, decrypt: decryptGradeWithKey },
];

/**
 * Liest alle geschützten Ablagen, wandelt jede Zeile um und schreibt sie zurück.
 * @param {(row: any, s: typeof SECRET_STORES[number]) => Promise<any>} convert
 */
async function convertAllData(convert) {
  const rowsByStore = {};
  for (const s of SECRET_STORES) {
    const rows = await getAll(s.name);
    rowsByStore[s.name] = await Promise.all(rows.map((row) => convert(row, s)));
  }
  await writeRows(rowsByStore);
}

/** Verschlüsselt alle vorhandenen Daten mit dem gegebenen Schlüssel (Ersteinrichtung). */
export function encryptAllData(key) {
  return convertAllData((row, s) => s.encrypt(key, row));
}

/** Entschlüsselt alle Daten mit dem gegebenen Schlüssel und speichert sie offen. */
export function decryptAllData(key) {
  return convertAllData((row, s) => s.decrypt(key, row));
}

/** Entschlüsselt mit dem alten und verschlüsselt sofort wieder mit dem neuen Schlüssel. */
export function reencryptAllData(oldKey, newKey) {
  return convertAllData(async (row, s) => s.encrypt(newKey, await s.decrypt(oldKey, row)));
}
