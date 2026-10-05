/**
 * Minimaler ZIP-Reader/-Writer (Methode „stored“, ohne Kompression).
 * Reicht für das Backup: JSON + bereits komprimierte JPEG-Fotos.
 * Beim Lesen werden zusätzlich deflate-komprimierte Einträge unterstützt,
 * falls die Datei von einem anderen Programm stammt.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ---------------------------------------------------------------- CRC32 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

/** @param {Uint8Array} bytes */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ---------------------------------------------------------------- Datum */

/** @param {Date} date @returns {{time: number, date: number}} DOS-Zeitstempel */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/* -------------------------------------------------------------- Schreiben */

/**
 * @param {{name: string, data: Uint8Array}[]} files
 * @returns {Blob}
 */
export function createZip(files) {
  const stamp = dosDateTime(new Date());
  /** @type {(Uint8Array)[]} */
  const chunks = [];
  /** @type {{name: Uint8Array, crc: number, size: number, offset: number}[]} */
  const entries = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = file.data;
    const crc = crc32(data);

    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);   // Signatur
    view.setUint16(4, 20, true);           // benötigte Version
    view.setUint16(6, 0x0800, true);       // Flag: UTF-8-Dateinamen
    view.setUint16(8, 0, true);            // Methode: stored
    view.setUint16(10, stamp.time, true);
    view.setUint16(12, stamp.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);

    chunks.push(header, data);
    entries.push({ name: nameBytes, crc, size: data.length, offset });
    offset += header.length + data.length;
  }

  const cdStart = offset;
  for (const entry of entries) {
    const record = new Uint8Array(46 + entry.name.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);           // erstellt von
    view.setUint16(6, 20, true);           // benötigte Version
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, stamp.time, true);
    view.setUint16(14, stamp.date, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.size, true);
    view.setUint32(24, entry.size, true);
    view.setUint16(28, entry.name.length, true);
    view.setUint32(42, entry.offset, true);
    record.set(entry.name, 46);
    chunks.push(record);
    offset += record.length;
  }

  const eocd = new Uint8Array(22);
  const view = new DataView(eocd.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, offset - cdStart, true);
  view.setUint32(16, cdStart, true);
  chunks.push(eocd);

  return new Blob(chunks, { type: 'application/zip' });
}

/* ----------------------------------------------------------------- Lesen */

/**
 * @param {Blob} blob
 * @returns {Promise<Map<string, Uint8Array>>} Dateiname → Inhalt
 */
export async function readZip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);

  // End-of-Central-Directory von hinten suchen
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 22 - 65536; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Keine gültige ZIP-Datei.');

  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);

  /** @type {Map<string, Uint8Array>} */
  const files = new Map();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) throw new Error('ZIP-Verzeichnis beschädigt.');
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));

    // Lokalen Header überspringen (dessen Längenfelder können abweichen)
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    if (!name.endsWith('/')) {
      files.set(name, method === 0 ? raw : await inflateRaw(raw));
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** @param {Uint8Array} data */
async function inflateRaw(data) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Komprimierte ZIP-Einträge werden von diesem Browser nicht unterstützt.');
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
