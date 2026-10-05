/**
 * Leere Klassenliste zum Handeintragen – ein frei beschriftbares Raster.
 *
 * Links Foto und Name jeder Schüler:in, rechts leere Kästchen mit selbst
 * gewählten Spaltenüberschriften (z.B. „KA 1“, „SoLei“, „Referat“). Gedacht
 * als Papier-Ergänzung: Was die App nicht erfasst, trägt die Lehrkraft hier
 * von Hand ein.
 *
 * Die Seiten sind dieselben festen A4-Kästen wie beim Notenbericht
 * (report.js); passen nicht alle Zeilen auf eine Seite, wird mit
 * wiederholter Kopfzeile fortgesetzt.
 */

import * as store from '../store.js';
import { el, openModal, formatDate, initials, photoUrl } from '../ui.js';
import { openPrintPreview } from './printpreview.js';

const MAX_COLUMNS = 12;

/**
 * Fragt Spaltenzahl und (optionale) Überschriften ab und öffnet die Vorschau.
 * Es ist bewusst nichts vorbelegt – die Liste bleibt völlig frei.
 * @param {{cls: import('../store.js').Klasse, students: import('../store.js').Schueler[]}} opts
 */
export function openBlankListDialog({ cls, students }) {
  const countInput = el('input.input', {
    id: 'bl-count', type: 'number', min: '1', max: String(MAX_COLUMNS), step: '1', value: '6',
    inputmode: 'numeric',
  });
  const columnsInput = el('textarea.textarea', {
    id: 'bl-columns', rows: '5',
    placeholder: 'Optional – eine Überschrift pro Zeile, von links nach rechts. Leer lassen für Kästchen ohne Beschriftung.',
  });

  const body = el('div.form', {}, [
    el('div.form-field', {}, [el('label.label', { for: 'bl-count', text: 'Anzahl Spalten' }), countInput]),
    el('div.form-field', {}, [el('label.label', { for: 'bl-columns', text: 'Spaltenüberschriften (optional)' }), columnsInput]),
    el('p.hint', { text: `Höchstens ${MAX_COLUMNS} Spalten. Stehen mehr Überschriften als Spalten da, zählt die Zahl der Überschriften.` }),
  ]);

  const modal = openModal({
    title: 'Leere Klassenliste',
    body,
    actions: [
      el('button.btn', { type: 'button', text: 'Abbrechen', onClick: () => modal.close() }),
      el('button.btn.btn--primary', {
        type: 'button', text: '⎙ Vorschau',
        onClick: () => {
          const labels = parseColumns(columnsInput.value);
          const wanted = Math.min(MAX_COLUMNS, Math.max(1, Math.round(Number(countInput.value)) || 6));
          const count = Math.max(wanted, labels.length);
          const columns = Array.from({ length: count }, (_, i) => labels[i] || '');
          modal.close();
          openBlankList({ cls, students, columns });
        },
      }),
    ],
  });
}

/** Zeilen → Überschriften; Leerzeilen in der Mitte bleiben als leere Überschrift erhalten. */
function parseColumns(text) {
  const lines = text.split('\n').map((l) => l.trim());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.slice(0, MAX_COLUMNS);
}

/* ------------------------------------------------------------ Ausdruck */

/**
 * @param {{cls: import('../store.js').Klasse, students: import('../store.js').Schueler[], columns: string[]}} opts
 */
export function openBlankList({ cls, students, columns }) {
  const sorted = [...students].sort(store.byName);
  const preview = openPrintPreview({
    title: `Klassenliste – ${cls.name}`,
    pages: [],
    hint: 'Leere Liste zum Handeintragen. Im Druckdialog „PDF“ → „Als PDF sichern“.',
  });
  const host = preview.pagesElement;
  const printed = formatDate(Date.now());

  const pages = [];
  let { page, tbody } = newPage({ host, cls, columns, printed, first: true });
  pages.push(page);

  for (const student of sorted) {
    const row = studentRow(student, columns.length);
    tbody.append(row);
    if (overflows(page)) {
      row.remove();
      ({ page, tbody } = newPage({ host, cls, columns, printed, first: false }));
      pages.push(page);
      tbody.append(row);
    }
  }

  pages.forEach((p, i) => p.append(el('footer.sheet__pagefoot', {
    text: `${cls.name} · Seite ${i + 1} von ${pages.length}`,
  })));
}

function newPage({ host, cls, columns, printed, first }) {
  const tbody = el('tbody');
  const page = el('section.sheet.sheet--list', {}, [
    el('header.sheet__head', {}, [
      el('div.sheet__ident', {}, [
        el('div', {}, [
          el('h1.sheet__name', { text: `Klasse ${cls.name}${first ? '' : ' (Fortsetzung)'}` }),
          el('p.sheet__meta', { text: `Stand ${printed}` }),
        ]),
      ]),
    ]),
    el('table.blank-table', {}, [
      el('thead', {}, [
        el('tr', {}, [
          el('th.blank-table__who', { scope: 'col', text: 'Schüler:in' }),
          ...columns.map((label) => el('th.blank-table__col', { scope: 'col', text: label })),
        ]),
      ]),
      tbody,
    ]),
  ]);
  host.append(page);
  return { page, tbody };
}

function studentRow(student, columnCount) {
  const url = photoUrl(student);
  return el('tr', {}, [
    el('td.blank-table__who', {}, [
      el('div.blank-table__ident', {}, [
        url
          ? el('img.blank-table__photo', { src: url, alt: '' })
          : el('span.blank-table__photo.blank-table__photo--fallback', { text: initials(student) }),
        el('span.blank-table__name', { text: store.fullName(student) || '—' }),
      ]),
    ]),
    ...Array.from({ length: columnCount }, () => el('td.blank-table__cell')),
  ]);
}

function overflows(page) {
  return page.scrollHeight > page.clientHeight + 1;
}
