/**
 * Namen aus Dateinamen ableiten – für den Foto-Import ganzer Klassen.
 *
 * Erwartet vorrangig `NACHNAME_VORNAME.jpg`, kommt aber auch mit gängigen
 * Abweichungen zurecht, wie sie beim Export aus Schulverwaltungen oder beim
 * Abfotografieren entstehen.
 */

/**
 * Kamera- und Scanner-Präfixe. Dateien, von denen nach dem Aussortieren der
 * Zahlenblöcke nur so etwas übrig bleibt, enthalten keinen Namen.
 */
const CAMERA_PREFIXES = new Set([
  'img', 'image', 'dsc', 'dscn', 'dscf', 'pxl', 'mvimg', 'pano',
  'foto', 'photo', 'bild', 'scan', 'scanned', 'whatsapp', 'screenshot',
]);

/**
 * @param {string} filename z.B. "MUELLER_Anna.jpg", "03_Meyer-Schmidt_Anna Maria.png"
 * @returns {{firstName: string, lastName: string}} leere Strings, wenn nichts erkennbar ist
 */
export function parseNameFromFilename(filename) {
  // Dateiendung abschneiden
  let base = String(filename).replace(/\.[a-z0-9]{1,5}$/i, '').trim();

  // Führende Nummerierung entfernen: "01_", "3 - ", "12." …
  base = base.replace(/^\d+\s*[._)\-]+\s*/, '').trim();

  if (!base) return { firstName: '', lastName: '' };

  /*
   * Trenner nach Eindeutigkeit wählen. Der Bindestrich kommt zuletzt, weil er
   * sonst Doppelnamen zerlegen würde: In „Meyer-Schmidt_Anna“ trennt der
   * Unterstrich, der Bindestrich gehört zum Nachnamen.
   */
  const separator = base.includes(',') ? ','
    : base.includes('_') ? '_'
      // Ein einzelner Bindestrich trennt („Zimmermann-Erik“); mehrere deuten
      // eher auf ein Datum hin und werden nicht als Trenner benutzt
      : (base.match(/-/g) || []).length === 1 ? '-'
        : ' ';

  const parts = base.split(separator)
    .map((p) => p.trim())
    // Zahlen- und Datumsblöcke sind keine Namen (Aufnahmedatum, laufende Nummer …)
    .filter((p) => p && !/^[\d\-.:]+$/.test(p));

  if (!parts.length) return { firstName: '', lastName: '' };

  // „IMG_1234“, „DSC00123“, „WhatsApp Image …“ – hier steckt kein Name drin
  if (CAMERA_PREFIXES.has(parts[0].toLowerCase().replace(/\d+$/, ''))) {
    return { firstName: '', lastName: '' };
  }

  // Erstes Segment ist der Nachname, alles Weitere sind Vornamen
  return {
    lastName: tidy(parts[0]),
    firstName: parts.slice(1).map(tidy).join(' '),
  };
}

/**
 * Vereinheitlicht die Schreibweise: MUELLER → Mueller, müller → Müller.
 * Bewusst gemischt geschriebene Namen (McKay, DiCaprio) bleiben unangetastet.
 * @param {string} text
 */
function tidy(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const isAllUpper = cleaned === cleaned.toUpperCase();
  const isAllLower = cleaned === cleaned.toLowerCase();
  if (!isAllUpper && !isAllLower) return cleaned;

  // Jeden Wortanfang groß – auch nach Bindestrich und Apostroph
  return cleaned.toLowerCase()
    .replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}
