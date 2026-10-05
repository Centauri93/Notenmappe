/**
 * Anordnung der Karten auf der Sitzfläche.
 *
 * Positionen sind Bruchteile (0–1) der Fläche, damit dieselbe Anordnung auf
 * Mac und iPad trotz unterschiedlicher Bildschirme gleich aussieht.
 *
 * Diese Datei enthält nur Rechnung, kein DOM: Der Sitzplan (seating.js) und
 * die Kachelübersicht der Notenbesprechung teilen sie sich, damit beide
 * Ansichten dieselbe Anordnung ergeben.
 */

/** Grundmaß einer Karte bei 100 % – bewusst kompakt für große Klassen. */
export function baseCardSize() {
  return window.matchMedia('(max-width: 700px)').matches
    ? { w: 74, h: 88 }
    : { w: 92, h: 110 };
}

/** Spalten/Zeilen des Rasters für eine Klassengröße. */
export function gridSize(total) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(total * 1.6)));
  return { cols, rows: Math.max(1, Math.ceil(total / cols)) };
}

/**
 * Gleichmäßiger Rasterplatz. Die Karten sitzen jeweils in der Mitte ihrer
 * Rasterzelle, damit sie nicht an den Rändern der Fläche kleben.
 * @returns {{x: number, y: number}} Bruchteile 0–1
 */
export function gridSlot(index, total) {
  const { cols, rows } = gridSize(total);
  return {
    x: ((index % cols) + 0.5) / cols,
    y: (Math.floor(index / cols) + 0.5) / rows,
  };
}

/**
 * Liest die Kartenmaße aus den CSS-Variablen der Fläche.
 * @param {HTMLElement} canvas
 */
export function cardSizeOf(canvas) {
  const cs = getComputedStyle(canvas);
  return {
    w: parseFloat(cs.getPropertyValue('--card-w')) || 92,
    h: parseFloat(cs.getPropertyValue('--card-h')) || 110,
  };
}

/**
 * Setzt die Kartengröße als CSS-Variablen auf die Fläche.
 * @param {HTMLElement} canvas
 * @param {number} scale Prozent (60–150)
 */
export function applyCardScale(canvas, scale) {
  const base = baseCardSize();
  canvas.style.setProperty('--card-w', String(Math.round(base.w * scale / 100)));
  canvas.style.setProperty('--card-h', String(Math.round(base.h * scale / 100)));
}

/**
 * Rechnet die gespeicherten Bruchteile in Pixel um und setzt die Karten.
 *
 * Die Karten verteilen sich über „Fläche minus Kartenmaß“ – die Position ist
 * die linke obere Ecke, sonst würden die Karten am rechten und unteren Rand
 * herausragen.
 *
 * @param {HTMLElement} canvas
 * @param {Record<string, {x:number,y:number}>} seating
 * @param {Map<string, HTMLElement>} cards
 */
export function layoutCards(canvas, seating, cards) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const { w, h } = cardSizeOf(canvas);
  for (const [id, card] of cards) {
    const pos = seating[id] || { x: 0.5, y: 0.5 };
    card.style.left = `${pos.x * Math.max(0, rect.width - w)}px`;
    card.style.top = `${pos.y * Math.max(0, rect.height - h)}px`;
  }
}
