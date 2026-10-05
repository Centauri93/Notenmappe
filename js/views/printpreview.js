/**
 * Rahmen der Druckvorschau: Werkzeugleiste, Vollbild-Überlagerung und der
 * Aufruf des Browser-Druckdialogs. `pagesElement` ist der Behälter, in den
 * der Aufrufer seine Seiten baut (für das Ausmessen muss er im DOM hängen).
 */

import { el, clear } from '../ui.js';

/**
 * @param {{title: string, pages: Node[], hint?: string}} opts
 * @returns {{close: () => void, pagesElement: HTMLElement}}
 */
export function openPrintPreview({ title, pages, hint }) {
  let host = document.getElementById('print-root');
  if (!host) {
    host = el('div#print-root');
    document.body.append(host);
  }
  clear(host);

  const toolbar = el('div.print-toolbar', {}, [
    el('div', {}, [
      el('strong', { text: title }),
      el('span.hint', { text: hint || 'Im Druckdialog „PDF“ → „Als PDF sichern“ wählen.' }),
    ]),
    el('div.print-toolbar__actions', {}, [
      el('button.btn', { type: 'button', text: 'Schließen', onClick: () => closePreview() }),
      el('button.btn.btn--primary', {
        type: 'button', text: '⎙ Drucken / Als PDF sichern', onClick: () => window.print(),
      }),
    ]),
  ]);

  const pagesElement = el('div.print-pages', {}, pages);
  host.append(toolbar, pagesElement);
  document.body.classList.add('is-printing-preview');

  function onKey(ev) { if (ev.key === 'Escape') closePreview(); }
  function closePreview() {
    document.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('is-printing-preview');
    clear(host);
  }
  document.addEventListener('keydown', onKey, true);
  host.__close = closePreview;

  return { close: closePreview, pagesElement };
}
