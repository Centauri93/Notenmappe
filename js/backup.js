/**
 * Datensicherung: alle Daten als Datei exportieren und wieder importieren.
 * Einziger Weg, Daten auf ein anderes Gerät zu bringen.
 *
 * Aufbau der eigentlichen ZIP-Datei:
 *   daten.json          – Klassen, Schüler:innen, Stunden, Noten
 *   fotos/<id>.jpg      – ein Foto je Schüler:in
 *
 * Ist der Passwortschutz aktiv, wird diese ZIP zusätzlich in eine
 * verschlüsselte Hülle gepackt (siehe wrapEnvelope/unwrapEnvelope), damit
 * eine verlorene oder falsch abgelegte Sicherungsdatei ohne Passwort
 * ebenso unlesbar ist wie die Daten auf dem Gerät selbst.
 */

import { tx, get, getAll } from './db.js';
import { createZip, readZip } from './zip.js';
import * as store from './store.js';
import * as security from './security.js';

export const BACKUP_FORMAT = 'noten-app-backup';
/**
 * Version 4 = Notenmappe 2 mit Besprechungen. Sicherungen der ursprünglichen
 * Notenmappe (Versionen 1–3) lassen sich einlesen: Klassen, Schüler:innen,
 * Stunden und mündliche Noten werden übernommen; deren Klassenarbeiten und
 * (anders aufgebaute) Besprechungen werden übersprungen.
 */
export const BACKUP_VERSION = 4;

const STORES = ['classes', 'students', 'sessions', 'grades', 'conferences', 'conferenceEntries'];

/* -------------------------------------------------------------- Verschlüsselte Hülle */

const MAGIC = new TextEncoder().encode('NAB1'); // "Notenmappe App Backup", Version 1
const SALT_LEN = 16;
const IV_LEN = 12;

/**
 * Verpackt Zip-Bytes in eine Hülle: `MAGIC · Flag(1B) · [Salt · IV] · Daten`.
 * Flag 0 = unverschlüsselt, Flag 1 = mit AES-GCM verschlüsselt.
 */
function wrapPlain(zipBytes) {
  return new Blob([MAGIC, new Uint8Array([0]), zipBytes], { type: 'application/octet-stream' });
}

async function wrapEncrypted(zipBytes) {
  const record = await get('meta', 'security');
  if (!record) throw new Error('Passwortschutz ist nicht eingerichtet.');
  const { iv, data } = await security.encryptRaw(zipBytes); // benötigt den aktiven Schlüssel
  return new Blob([MAGIC, new Uint8Array([1]), record.salt, iv, data], { type: 'application/octet-stream' });
}

/**
 * Liest die Hülle einer Sicherungsdatei.
 * @returns {Promise<{encrypted: boolean, salt?: Uint8Array, iv?: Uint8Array, data: Uint8Array}>}
 */
async function readEnvelope(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hasMagic = bytes.length > MAGIC.length
    && MAGIC.every((b, i) => bytes[i] === b);
  if (!hasMagic) {
    // Ältere Sicherung ohne Hülle – als reines, unverschlüsseltes ZIP behandeln
    return { encrypted: false, data: bytes };
  }
  const flag = bytes[MAGIC.length];
  if (flag === 0) {
    return { encrypted: false, data: bytes.subarray(MAGIC.length + 1) };
  }
  const start = MAGIC.length + 1;
  const salt = bytes.subarray(start, start + SALT_LEN);
  const iv = bytes.subarray(start + SALT_LEN, start + SALT_LEN + IV_LEN);
  const data = bytes.subarray(start + SALT_LEN + IV_LEN);
  return { encrypted: true, salt, iv, data };
}

/* -------------------------------------------------------------------- Export */

/** @returns {Promise<Blob>} */
export async function exportBackup() {
  const [classes, sessions, conferences] = await Promise.all(
    [getAll('classes'), getAll('sessions'), getAll('conferences')]);
  const students = await store.listAllStudents();
  const grades = await store.listAllGrades();
  const conferenceEntries = await store.listAllConferenceEntries();

  /** @type {{name: string, data: Uint8Array}[]} */
  const files = [];
  const plainStudents = [];

  for (const s of students) {
    const { photo, ...rest } = s;
    let photoFile = null;
    if (photo instanceof Blob) {
      photoFile = `fotos/${s.id}.jpg`;
      files.push({ name: photoFile, data: new Uint8Array(await photo.arrayBuffer()) });
    }
    plainStudents.push({ ...rest, photoFile });
  }

  const payload = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      classes: classes.length,
      students: students.length,
      sessions: sessions.length,
      grades: grades.length,
      conferences: conferences.length,
    },
    classes,
    students: plainStudents,
    sessions,
    grades,
    conferences,
    conferenceEntries,
  };

  files.unshift({
    name: 'daten.json',
    data: new TextEncoder().encode(JSON.stringify(payload, null, 2)),
  });

  const zipBlob = createZip(files);
  const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());

  return (await security.isConfigured()) ? wrapEncrypted(zipBytes) : wrapPlain(zipBytes);
}

/* -------------------------------------------------------------------- Import */

/**
 * Liest eine Sicherungsdatei ein, ohne etwas zu verändern.
 *
 * Ist die Datei passwortgeschützt und wird kein (oder ein falsches)
 * Passwort übergeben, wird ein Error mit `.code` geworfen:
 * `'NEEDS_PASSWORD'` bzw. `'WRONG_PASSWORD'`.
 *
 * @param {File|Blob} file
 * @param {string} [password]
 * @returns {Promise<{payload: any, photos: Map<string, Blob>}>}
 */
export async function readBackup(file, password) {
  const envelope = await readEnvelope(file);
  let zipBytes = envelope.data;

  if (envelope.encrypted) {
    if (!password) {
      const err = new Error('Diese Sicherung ist passwortgeschützt.');
      err.code = 'NEEDS_PASSWORD';
      throw err;
    }
    try {
      const key = await security.deriveKey(password, envelope.salt);
      zipBytes = await security.decryptWithKey(key, { iv: envelope.iv, data: envelope.data });
    } catch {
      const err = new Error('Falsches Passwort.');
      err.code = 'WRONG_PASSWORD';
      throw err;
    }
  }

  const entries = await readZip(new Blob([zipBytes]));
  const jsonEntry = entries.get('daten.json') || entries.get('data.json');
  if (!jsonEntry) throw new Error('In der Datei fehlt „daten.json“ – das ist keine Sicherung dieser App.');

  const payload = JSON.parse(new TextDecoder().decode(jsonEntry));
  if (payload.format !== BACKUP_FORMAT) throw new Error('Unbekanntes Sicherungsformat.');
  if (payload.version > BACKUP_VERSION) {
    throw new Error('Die Sicherung stammt aus einer neueren App-Version.');
  }

  /** @type {Map<string, Blob>} */
  const photos = new Map();
  for (const [name, data] of entries) {
    if (name.startsWith('fotos/')) {
      photos.set(name, new Blob([data], { type: 'image/jpeg' }));
    }
  }
  return { payload, photos };
}

/**
 * Schreibt eine gelesene Sicherung in die Datenbank. Ist auf diesem Gerät
 * Passwortschutz aktiv, werden die (bereits entschlüsselten) Schüler- und
 * Notendaten beim Schreiben wieder verschlüsselt – die Verschlüsselung
 * läuft dabei komplett vor der eigentlichen Transaktion.
 * @param {{payload: any, photos: Map<string, Blob>}} backup
 * @param {'replace'|'merge'} mode
 */
export async function applyBackup({ payload, photos }, mode) {
  const protectedDevice = await security.isConfigured();
  const key = protectedDevice ? security.getActiveKey() : null;

  const studentRows = [];
  for (const s of payload.students || []) {
    const { photoFile, ...rest } = s;
    const photo = photoFile ? photos.get(photoFile) || null : null;
    const plain = {
      id: rest.id, classId: rest.classId, createdAt: rest.createdAt,
      firstName: rest.firstName || '', lastName: rest.lastName || '', photo,
    };
    studentRows.push(await store.toStudentRow(plain, key));
  }

  // Zeitpunkt einer Note ist der Stundenbeginn (siehe store.saveEntry)
  const sessionStart = new Map((payload.sessions || []).map((s) => [s.id, s.startedAt]));
  const gradeRows = [];
  for (const g of payload.grades || []) {
    const plain = {
      id: g.id, sessionId: g.sessionId, classId: g.classId, studentId: g.studentId,
      createdAt: sessionStart.get(g.sessionId) ?? g.createdAt, updatedAt: g.updatedAt ?? g.createdAt,
      value: g.value ?? null, comment: g.comment || '',
      absent: Boolean(g.absent), weight: store.WEIGHT_OPTIONS.includes(g.weight) ? g.weight : 1,
    };
    gradeRows.push(protectedDevice ? await store.encryptGradeWithKey(key, plain) : plain);
  }

  // Besprechungen gibt es erst ab Version 4; ältere (anders aufgebaute) werden übersprungen
  const isV4 = Number(payload.version) >= 4;
  const conferences = isV4 ? (payload.conferences || []) : [];
  const entryRows = [];
  if (isV4) {
    for (const e of payload.conferenceEntries || []) {
      const plain = {
        id: e.id, conferenceId: e.conferenceId, classId: e.classId, studentId: e.studentId,
        updatedAt: e.updatedAt || 0, done: Boolean(e.done), doneAt: e.doneAt ?? null,
        grade: e.grade ?? null, tendency: ['+', '-'].includes(e.tendency) ? e.tendency : '',
        notes: e.notes || '',
      };
      entryRows.push(await store.toConferenceEntryRow(plain, key));
    }
  }

  await tx(STORES, 'readwrite', (t) => {
    if (mode === 'replace') {
      for (const s of STORES) t.objectStore(s).clear();
    }
    for (const cls of payload.classes || []) t.objectStore('classes').put({ seating: {}, ...cls });
    for (const row of studentRows) t.objectStore('students').put(row);
    for (const session of payload.sessions || []) t.objectStore('sessions').put(session);
    for (const row of gradeRows) t.objectStore('grades').put(row);
    for (const c of conferences) t.objectStore('conferences').put(c);
    for (const row of entryRows) t.objectStore('conferenceEntries').put(row);
    return Promise.resolve();
  });
}

/** Löscht sämtliche Daten dieses Geräts (inkl. Passwortschutz-Einrichtung). */
export async function wipeAll() {
  await tx([...STORES, 'meta'], 'readwrite', (t) => {
    for (const s of STORES) t.objectStore(s).clear();
    t.objectStore('meta').delete('security');
    return Promise.resolve();
  });
  security.lock();
}

/** Zahlen für die Übersicht in den Einstellungen. */
export async function stats() {
  const [classes, sessions, conferences] = await Promise.all(
    [getAll('classes'), getAll('sessions'), getAll('conferences')]);
  const students = await store.listAllStudents();
  const grades = await store.listAllGrades();
  const photoBytes = students.reduce((sum, s) => sum + (s.photo?.size || 0), 0);
  return {
    classes: classes.length,
    students: students.length,
    sessions: sessions.filter((s) => s.closedAt !== null).length,
    openSessions: sessions.filter((s) => s.closedAt === null).length,
    grades: grades.length,
    conferences: conferences.length,
    photoBytes,
  };
}

/** Startet den Datei-Download im Browser. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Dateiname mit Datum. Verschlüsselte Sicherungen bekommen eine eigene
 * Endung, damit klar ist, dass es kein normales ZIP zum Doppelklicken ist.
 */
export async function backupFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const ext = (await security.isConfigured()) ? 'notenbackup' : 'zip';
  return `noten-sicherung-${stamp}.${ext}`;
}
