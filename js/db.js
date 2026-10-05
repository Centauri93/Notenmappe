/**
 * IndexedDB-Wrapper.
 * Kein externer Code, keine Netzwerkzugriffe – alle Daten bleiben im Browser.
 */

// Eigene Datenbank für Notenmappe 2 – unabhängig von der alten „noten-app“.
const DB_NAME = 'notenmappe-2';
const DB_VERSION = 2;

/** @type {IDBDatabase|null} */
let _db = null;

/**
 * Öffnet (und migriert bei Bedarf) die Datenbank.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const oldVersion = ev.oldVersion;

      if (oldVersion < 1) {
        // Klassen: { id, name, seating: { [studentId]: {x, y} }, createdAt }
        db.createObjectStore('classes', { keyPath: 'id' });

        // Schüler:innen: { id, classId, firstName, lastName, photo: Blob|null, createdAt }
        const students = db.createObjectStore('students', { keyPath: 'id' });
        students.createIndex('byClass', 'classId');

        // Stunden: { id, classId, startedAt, closedAt|null }
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('byClass', 'classId');

        // Einzelnoten: { id, sessionId, classId, studentId, value, comment, createdAt }
        const grades = db.createObjectStore('grades', { keyPath: 'id' });
        grades.createIndex('bySession', 'sessionId');
        grades.createIndex('byStudent', 'studentId');
        grades.createIndex('byClass', 'classId');

        // Freie Schlüssel/Wert-Ablage für Einstellungen
        db.createObjectStore('meta', { keyPath: 'key' });
      }

      if (oldVersion < 2) {
        // Notenbesprechungen – rein ergänzend, Version-1-Daten bleiben unverändert.
        // Besprechung: { id, classId, title, from, to, createdAt }
        const conferences = db.createObjectStore('conferences', { keyPath: 'id' });
        conferences.createIndex('byClass', 'classId');

        // Ergebnis je Schüler:in: { id: <conferenceId>~<studentId>, conferenceId, classId,
        //   studentId, grade, tendency, notes, done, doneAt, updatedAt }
        const entries = db.createObjectStore('conferenceEntries', { keyPath: 'id' });
        entries.createIndex('byConference', 'conferenceId');
        entries.createIndex('byStudent', 'studentId');
        entries.createIndex('byClass', 'classId');
      }
    };

    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => {
        _db?.close();
        _db = null;
      };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Führt eine Transaktion aus und liefert das Ergebnis der Callback-Funktion.
 * Der Callback bekommt die Transaktion und darf mehrere Requests absetzen.
 * @template T
 * @param {string|string[]} stores
 * @param {IDBTransactionMode} mode
 * @param {(tx: IDBTransaction) => Promise<T>|T} fn
 * @returns {Promise<T>}
 */
export async function tx(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    let failed = false;

    t.oncomplete = () => { if (!failed) resolve(result); };
    t.onerror = () => { failed = true; reject(t.error); };
    t.onabort = () => { failed = true; reject(t.error || new Error('Transaktion abgebrochen')); };

    Promise.resolve(fn(t))
      .then((r) => { result = r; })
      .catch((err) => {
        failed = true;
        try { t.abort(); } catch { /* bereits beendet */ }
        reject(err);
      });
  });
}

/**
 * Wandelt einen IDBRequest in ein Promise.
 * @template T
 * @param {IDBRequest<T>} req
 * @returns {Promise<T>}
 */
export function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** @returns {Promise<any[]>} */
export function getAll(store, query) {
  return tx(store, 'readonly', (t) => reqAsPromise(t.objectStore(store).getAll(query)));
}

/** @returns {Promise<any[]>} */
export function getAllByIndex(store, index, query) {
  return tx(store, 'readonly', (t) =>
    reqAsPromise(t.objectStore(store).index(index).getAll(query)));
}

/** @returns {Promise<any|undefined>} */
export function get(store, key) {
  return tx(store, 'readonly', (t) => reqAsPromise(t.objectStore(store).get(key)));
}

/** @returns {Promise<any>} */
export function put(store, value) {
  return tx(store, 'readwrite', (t) => reqAsPromise(t.objectStore(store).put(value)).then(() => value));
}

/** @returns {Promise<void>} */
export function del(store, key) {
  return tx(store, 'readwrite', (t) => reqAsPromise(t.objectStore(store).delete(key)).then(() => undefined));
}

/** Erzeugt eine kollisionsfreie ID. @returns {string} */
export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}
