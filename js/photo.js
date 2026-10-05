/**
 * Foto-Aufbereitung: skaliert und beschneidet hochgeladene Bilder auf ein
 * quadratisches Format, damit die Datenbank klein bleibt und Karten
 * einheitlich aussehen. Läuft komplett im Browser.
 */

const MAX_SIZE = 480;      // Kantenlänge des gespeicherten Quadrats
const JPEG_QUALITY = 0.82;

/**
 * @param {File|Blob} file
 * @returns {Promise<Blob>} quadratisches JPEG
 */
export async function processPhoto(file) {
  const looksLikeImage = (file.type && file.type.startsWith('image/'))
    || /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(file.name || '');
  if (!looksLikeImage) {
    throw new Error('Bitte eine Bilddatei auswählen.');
  }
  const bitmap = await loadBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const target = Math.min(side, MAX_SIZE);

  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  // Mittigen quadratischen Ausschnitt zeichnen
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
    0, 0, target, target,
  );
  if (typeof bitmap.close === 'function') bitmap.close();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht verarbeitet werden.'))),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
  return blob;
}

/**
 * createImageBitmap respektiert in Safari die EXIF-Orientierung nur mit Option;
 * als Rückfallebene wird ein <img> geladen.
 * @param {Blob} file
 * @returns {Promise<ImageBitmap|HTMLImageElement>}
 */
async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Ältere Safari-Versionen kennen die Option nicht – unten weiter
    }
    try {
      return await createImageBitmap(file);
    } catch {
      // weiter mit <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'));
      img.src = url;
    });
    if (img.decode) { try { await img.decode(); } catch { /* egal */ } }
    return img;
  } finally {
    // Erst nach dem Zeichnen freigeben – deshalb verzögert
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/** Wandelt ein Blob in einen Data-URL-String (für Druckansicht/PDF). */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
