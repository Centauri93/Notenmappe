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
 * @typedef {{id: string, name: string, seating: Record<string, {x:number,y:number}>, cardScale?: number, archivedAt?: number|null, createdAt: number}} Klasse
 * @typedef {{id: string, classId: string, firstName: string, lastName: string, photo: Blob|null, createdAt: number}} Schueler
 * @typedef {{id: string, classId: string, startedAt: number, closedAt: number|null, log?: string}} Session
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
/**
 * @param {{archived?: boolean}} [opts] – ohne Angabe alle Klassen; `archived: false`
 *   nur aktive, `archived: true` nur archivierte.
 * @returns {Promise<Klasse[]>}
 */
export async function listClasses(opts = {}) {
  let rows = await getAll('classes');
  if (opts.archived === true) rows = rows.filter((c) => c.archivedAt);
  if (opts.archived === false) rows = rows.filter((c) => !c.archivedAt);
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * Archivieren nimmt die Klasse nur aus der Übersicht – alle Daten bleiben
 * und lassen sich jederzeit wieder hervorholen.
 */
export async function setClassArchived(id, archived) {
  const cls = await getClass(id);
  if (!cls) throw new Error('Klasse nicht gefunden');
  cls.archivedAt = archived ? Date.now() : null;
  return put('classes', cls);
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

/** Löscht Klasse inkl. Schüler:innen, Stunden, Noten und Besprechungen. */
export async function deleteClass(id) {
  const stores = ['classes', 'students', 'sessions', 'grades', 'conferences', 'conferenceEntries'];
  return tx(stores, 'readwrite', async (t) => {
    await reqAsPromise(t.objectStore('classes').delete(id));
    for (const store of stores.slice(1)) {
      const keys = await reqAsPromise(
        t.objectStore(store).index('byClass').getAllKeys(IDBKeyRange.only(id)));
      for (const key of keys) await reqAsPromise(t.objectStore(store).delete(key));
    }
  });
}

/**
 * Dupliziert eine Klasse unter neuem Namen: alle Schüler:innen mit Fotos und
 * die Sitzordnung werden übernommen – keine Stunden, Noten oder
 * Besprechungen. Gedacht für dieselbe Klasse in einem zweiten Fach.
 * @returns {Promise<Klasse>} die neue Klasse
 */
export async function duplicateClass(sourceId, newName) {
  const source = await getClass(sourceId);
  if (!source) throw new Error('Klasse nicht gefunden');
  const students = await listStudents(sourceId);

  const copy = {
    id: newId(),
    name: (newName || '').trim() || `${source.name} (Kopie)`,
    seating: {},
    cardScale: source.cardScale,
    createdAt: Date.now(),
  };

  // Neue Kennungen je Schüler:in, Sitzplatz über die alte Kennung zuordnen
  const rows = [];
  for (const s of students) {
    const id = newId();
    if (source.seating?.[s.id]) copy.seating[id] = { ...source.seating[s.id] };
    rows.push(await toStudentRow({
      id, classId: copy.id, firstName: s.firstName, lastName: s.lastName,
      photo: s.photo, createdAt: Date.now(),
    }));
  }

  await tx(['classes', 'students'], 'readwrite', (t) => {
    t.objectStore('classes').put(copy);
    for (const row of rows) t.objectStore('students').put(row);
    return Promise.resolve();
  });
  return copy;
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
  const { id, classId, createdAt, firstName, lastName } = plain;
  const encName = await security.encryptJSONWithKey(key, { firstName, lastName });
  const bytes = await photoBytesOf(plain);
  const encPhoto = bytes ? await security.encryptWithKey(key, new Uint8Array(bytes)) : null;
  return { id, classId, createdAt, encName, encPhoto };
}

/*
 * Fotos liegen in der Datenbank als reine Bytes (ArrayBuffer), nicht als
 * Blob: Safari auf iOS verliert in IndexedDB gespeicherte Blobs nach einem
 * Neustart der App gelegentlich (bekannter WebKit-Fehler) – die Bytes sind
 * davon nicht betroffen. Nach außen bleibt `photo` ein Blob.
 */

/** Liefert die Foto-Bytes eines Datensatzes, egal in welcher Form sie vorliegen. */
async function photoBytesOf(obj) {
  if (obj.photoBytes) return obj.photoBytes;
  if (obj.photo instanceof Blob) return obj.photo.arrayBuffer();
  return null;
}

/** Unverschlüsselter Datensatz: Blob → Bytes. */
async function plainToRow(plain) {
  const { photo, photoBytes, ...rest } = plain;
  const bytes = await photoBytesOf({ photo, photoBytes });
  return { ...rest, photo: null, photoBytes: bytes };
}

/** Unverschlüsselter Datensatz: Bytes → Blob (auch alte Blob-Datensätze kommen unverändert durch). */
function rowToPlain(row) {
  if (!row) return row;
  const { photoBytes, ...rest } = row;
  if (photoBytes) return { ...rest, photo: new Blob([photoBytes], { type: 'image/jpeg' }) };
  return rest;
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

/**
 * Baut den zu speichernden Datensatz – verschlüsselt, falls Schutz aktiv,
 * sonst mit dem Foto als Bytes. `key` kann übergeben werden (Import).
 */
export async function toStudentRow(plain, key = null) {
  if (key) return encryptStudentWithKey(key, plain);
  if (!(await security.isConfigured())) return plainToRow(plain);
  return encryptStudentWithKey(security.getActiveKey(), plain);
}

/** Wandelt einen gespeicherten Datensatz in das entschlüsselte Objekt. */
function fromStudentRow(row) {
  if (!row) return row;
  if (row.encName) return decryptStudentWithKey(security.getActiveKey(), row);
  return rowToPlain(row);
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
  await tx(['students', 'grades', 'conferenceEntries'], 'readwrite', async (t) => {
    await reqAsPromise(t.objectStore('students').delete(id));
    for (const store of ['grades', 'conferenceEntries']) {
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
  // Eine Stunde nur mit Klassenbucheintrag (ohne Noten) bleibt erhalten
  if (grades.length === 0 && !(open.log || '').trim()) {
    await del('sessions', open.id);
    return { closed: false, discarded: true, count: 0 };
  }
  open.closedAt = Date.now();
  await put('sessions', open);
  return { closed: true, discarded: false, count: grades.length };
}

/**
 * Klassenbucheintrag der Stunde – Freitext, was im Unterricht gemacht wurde.
 * Hat nichts mit Noten oder Auswertungen zu tun und wird nirgends verrechnet.
 */
export async function saveSessionLog(sessionId, text) {
  const session = await get('sessions', sessionId);
  if (!session) throw new Error('Stunde nicht gefunden');
  session.log = (text || '').trim();
  await put('sessions', session);
  return session;
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
  /*
   * Zeitpunkt der Note = Beginn der Stunde (erster Eintrag in der Klasse),
   * nicht der Moment des Antippens. So tragen alle Noten einer Stunde
   * dieselbe Zeit – auch wenn die Stunde erst am nächsten Tag beendet
   * oder eine Note nachgetragen wird.
   */
  const session = existing ? null : await get('sessions', sessionId);
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
    createdAt: session?.startedAt ?? Date.now(),
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

/* ------------------------------------------------------ Besprechungen */

/**
 * @typedef {{id: string, classId: string, title: string, from: number, to: number, createdAt: number}} Besprechung
 * @typedef {{id: string, conferenceId: string, classId: string, studentId: string,
 *            grade: number|null, tendency: ''|'+'|'-', notes: string,
 *            done: boolean, doneAt: number|null, updatedAt: number}} BesprechungsEintrag
 */

/** @returns {Promise<Besprechung[]>} */
export async function listConferences(classId) {
  const rows = await getAllByIndex('conferences', 'byClass', IDBKeyRange.only(classId));
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

/** @returns {Promise<Besprechung|undefined>} */
export function getConference(id) {
  return get('conferences', id);
}

export function createConference({ classId, title, from, to }) {
  return put('conferences', {
    id: newId(),
    classId,
    title: (title || '').trim() || 'Notenbesprechung',
    from, to,
    createdAt: Date.now(),
  });
}

export async function updateConference(id, patch) {
  const c = await get('conferences', id);
  if (!c) throw new Error('Besprechung nicht gefunden');
  if (patch.title !== undefined) c.title = (patch.title || '').trim() || c.title;
  if (patch.from !== undefined) c.from = patch.from;
  if (patch.to !== undefined) c.to = patch.to;
  await put('conferences', c);
  return c;
}

/** Löscht die Besprechung samt Einträgen – die Einzelnoten bleiben unberührt. */
export async function deleteConference(id) {
  await tx(['conferences', 'conferenceEntries'], 'readwrite', async (t) => {
    await reqAsPromise(t.objectStore('conferences').delete(id));
    const keys = await reqAsPromise(
      t.objectStore('conferenceEntries').index('byConference').getAllKeys(IDBKeyRange.only(id)));
    for (const key of keys) await reqAsPromise(t.objectStore('conferenceEntries').delete(key));
  });
}

/*
 * Verschlüsselung: Endnote und Notizen sind personenbezogen und werden bei
 * aktivem Schutz wie die Noten verschlüsselt abgelegt.
 */
export async function encryptConferenceEntryWithKey(key, plain) {
  const { id, conferenceId, classId, studentId, updatedAt, done, doneAt, grade, tendency, notes } = plain;
  const enc = await security.encryptJSONWithKey(key, { grade, tendency, notes });
  return { id, conferenceId, classId, studentId, updatedAt, done, doneAt, enc };
}

async function decryptConferenceEntryWithKey(key, row) {
  if (!row || !row.enc) return row;
  const { grade, tendency, notes } = await security.decryptJSONWithKey(key, row.enc);
  return {
    id: row.id, conferenceId: row.conferenceId, classId: row.classId, studentId: row.studentId,
    updatedAt: row.updatedAt, done: row.done, doneAt: row.doneAt, grade, tendency, notes,
  };
}

export async function toConferenceEntryRow(plain, key = null) {
  if (key) return encryptConferenceEntryWithKey(key, plain);
  if (!(await security.isConfigured())) return plain;
  return encryptConferenceEntryWithKey(security.getActiveKey(), plain);
}

function fromConferenceEntryRow(row) {
  if (!row || !row.enc) return row;
  return decryptConferenceEntryWithKey(security.getActiveKey(), row);
}

/** Feste Kennung je Besprechung und Schüler:in – schnelle Klicks können so keine Dubletten erzeugen. */
export function conferenceEntryId(conferenceId, studentId) {
  return `${conferenceId}~${studentId}`;
}

/** @returns {Promise<BesprechungsEintrag[]>} */
export async function listConferenceEntries(conferenceId) {
  const rows = await getAllByIndex('conferenceEntries', 'byConference', IDBKeyRange.only(conferenceId));
  return Promise.all(rows.map(fromConferenceEntryRow));
}

export async function listAllConferenceEntries() {
  const rows = await getAll('conferenceEntries');
  return Promise.all(rows.map(fromConferenceEntryRow));
}

/** @returns {Promise<BesprechungsEintrag|null>} */
export async function getConferenceEntry(conferenceId, studentId) {
  const row = await get('conferenceEntries', conferenceEntryId(conferenceId, studentId));
  return row ? fromConferenceEntryRow(row) : null;
}

/**
 * Speichert einen Teil-Patch des Besprechungsergebnisses.
 * `grade` 1–6 oder null, `tendency` '', '+' oder '-', `notes` Text, `done` Haken.
 */
export async function saveConferenceEntry({ conferenceId, classId, studentId, ...patch }) {
  const existing = await getConferenceEntry(conferenceId, studentId);
  /** @type {BesprechungsEintrag} */
  const entry = existing || {
    id: conferenceEntryId(conferenceId, studentId),
    conferenceId, classId, studentId,
    grade: null, tendency: '', notes: '', done: false, doneAt: null, updatedAt: 0,
  };
  if ('grade' in patch) {
    const g = patch.grade === null || patch.grade === undefined ? null : Number(patch.grade);
    if (g !== null && (!Number.isInteger(g) || g < 1 || g > 6)) throw new Error('Note muss zwischen 1 und 6 liegen');
    entry.grade = g;
    if (g === null) entry.tendency = '';
  }
  if ('tendency' in patch) entry.tendency = ['+', '-'].includes(patch.tendency) ? patch.tendency : '';
  if ('notes' in patch) entry.notes = (patch.notes || '').trim();
  if ('done' in patch) {
    const next = Boolean(patch.done);
    // Der Zeitpunkt hält fest, wann das Gespräch abgeschlossen wurde – nicht die letzte Änderung
    if (next && !entry.done) entry.doneAt = Date.now();
    if (!next) entry.doneAt = null;
    entry.done = next;
  }
  // Tendenz nur mit Note; bei 1 kein „+“, bei 6 kein „−“
  if (entry.grade === null) entry.tendency = '';
  if (entry.grade === 1 && entry.tendency === '+') entry.tendency = '';
  if (entry.grade === 6 && entry.tendency === '-') entry.tendency = '';

  entry.updatedAt = Date.now();
  await put('conferenceEntries', await toConferenceEntryRow(entry));
  return entry;
}

/** „2+“, „3“, „4−“ – oder null ohne Note. */
export function finalGradeLabel(entry) {
  if (!entry || entry.grade === null || entry.grade === undefined) return null;
  const t = entry.tendency === '-' ? '−' : (entry.tendency || '');
  return `${entry.grade}${t}`;
}

/* ------------------------------------------------------- Datenpflege */

/**
 * Gleicht ältere Noten an: Vor dieser Version trug jede Note die Uhrzeit
 * ihres Antippens; jetzt gilt der Stundenbeginn. Läuft einmal beim Start
 * und braucht keinen Schlüssel – der Zeitstempel liegt unverschlüsselt.
 */
export async function alignGradeTimes() {
  const FLAG = 'gradeTimesAligned';
  if (await get('meta', FLAG)) return;
  const sessions = new Map((await getAll('sessions')).map((s) => [s.id, s]));
  const rows = await getAll('grades');
  const changed = rows.filter((g) => {
    const s = sessions.get(g.sessionId);
    return s && g.createdAt !== s.startedAt;
  });
  for (const g of changed) g.createdAt = sessions.get(g.sessionId).startedAt;
  if (changed.length) await writeRows({ grades: changed });
  await put('meta', { key: FLAG, value: true, at: Date.now() });
}

/**
 * Wandelt Fotos, die noch als Blob gespeichert sind, in Bytes um (einmalig).
 * Ein Blob, den Safari bereits verloren hat, lässt sich nicht mehr lesen –
 * das Foto fehlt dann und muss neu hinzugefügt werden; der Datensatz
 * selbst bleibt erhalten.
 */
export async function migratePhotoBlobs() {
  const FLAG = 'photoBytesMigrated';
  if (await get('meta', FLAG)) return;
  const rows = await getAll('students');
  const changed = [];
  let lost = 0;
  for (const row of rows) {
    if (row.encName || !(row.photo instanceof Blob)) continue;
    let bytes = null;
    try {
      bytes = await row.photo.arrayBuffer();
      if (!bytes.byteLength) bytes = null;
    } catch { bytes = null; }
    if (!bytes) lost += 1;
    changed.push({ ...row, photo: null, photoBytes: bytes });
  }
  if (changed.length) await writeRows({ students: changed });
  await put('meta', { key: FLAG, value: true, at: Date.now(), lost });
  return { converted: changed.length, lost };
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
  {
    name: 'students',
    encrypt: (key, row) => encryptStudentWithKey(key, rowToPlain(row)),
    decrypt: async (key, row) => plainToRow(await decryptStudentWithKey(key, row)),
  },
  { name: 'grades', encrypt: encryptGradeWithKey, decrypt: decryptGradeWithKey },
  { name: 'conferenceEntries', encrypt: encryptConferenceEntryWithKey, decrypt: decryptConferenceEntryWithKey },
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
