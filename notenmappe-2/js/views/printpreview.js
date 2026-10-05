/**
 * Rahmen der Druckvorschau: Werkzeugleiste, Vollbild-Überlagerung und der
 * Aufruf des Browser-Druckdialogs. Beide Ausdrucke teilen sich diesen Rahmen.
 */

import { el, clear } from '../ui.js';

/**
 * @param {{title: string, pages: Node[], hint?: string}} opts
 * @returns {{close: () => void}}
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

  host.append(toolbar, el('div.print-pages', {}, pages));
  document.body.classList.add('is-printing-preview');

  function onKey(ev) { if (ev.key === 'Escape') closePreview(); }
  function closePreview() {
    document.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('is-printing-preview');
    clear(host);
  }
  document.addEventListener('keydown', onKey, true);
  host.__close = closePreview;

  return { close: closePreview };
}
