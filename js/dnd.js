/**
 * Drag & Drop auf Basis von Pointer-Events – funktioniert identisch mit
 * Maus (Mac), Finger und Stift (iPad). Voraussetzung im CSS:
 * `touch-action: none` auf dem ziehbaren Element, damit iOS nicht scrollt.
 */

const TAP_TOLERANCE = 8;   // px Bewegung, die noch als Tippen gilt
const TAP_DURATION = 700;  // ms, danach gilt es nicht mehr als Tippen

/**
 * @param {HTMLElement} handle  Element, das gezogen wird
 * @param {{
 *   onStart?: (ev: PointerEvent) => void,
 *   onMove: (dx: number, dy: number, ev: PointerEvent) => void,
 *   onEnd?: (moved: boolean) => void,
 *   onTap?: () => void,
 * }} handlers
 * @returns {() => void} Aufräumfunktion
 */
export function makeDraggable(handle, { onStart, onMove, onEnd, onTap }) {
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startedAt = 0;
  let moved = false;

  function down(ev) {
    // Nur primäre Taste / erster Finger; Bedienelemente in der Karte ausnehmen
    if (pointerId !== null || ev.button > 0) return;
    if (ev.target.closest('[data-no-drag]')) return;

    pointerId = ev.pointerId;
    startX = ev.clientX;
    startY = ev.clientY;
    startedAt = performance.now();
    moved = false;
    handle.setPointerCapture(pointerId);
    onStart?.(ev);
  }

  function move(ev) {
    if (ev.pointerId !== pointerId) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!moved && Math.hypot(dx, dy) > TAP_TOLERANCE) moved = true;
    if (moved) {
      ev.preventDefault();
      onMove(dx, dy, ev);
    }
  }

  function up(ev) {
    if (ev.pointerId !== pointerId) return;
    const wasTap = !moved && performance.now() - startedAt < TAP_DURATION;
    try { handle.releasePointerCapture(pointerId); } catch { /* schon freigegeben */ }
    pointerId = null;
    onEnd?.(moved);
    if (wasTap) onTap?.();
  }

  function cancel(ev) {
    if (ev.pointerId !== pointerId) return;
    pointerId = null;
    onEnd?.(moved);
  }

  handle.addEventListener('pointerdown', down);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', cancel);
  // Kontextmenü beim langen Drücken auf iOS unterdrücken
  handle.addEventListener('contextmenu', (ev) => ev.preventDefault());

  return () => {
    handle.removeEventListener('pointerdown', down);
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', cancel);
  };
}
