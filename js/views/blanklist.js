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

const STORAGE_KEY = 'blanklist-columns';
const DEFAULT_COLUMNS = ['', '', '', '', '', ''];

/**
 * Fragt die Spalten ab und öffnet dann die Druckvorschau.
 * @param {{cls: import('../store.js').Klasse, students: import('../store.js').Schueler[]}} opts
 */
export function openBlankListDialog({ cls, students }) {
  const remembered = loadColumns();
  const titleInput = el('input.input', {
    id: 'bl-title', type: 'text', value: '', placeholder: 'z.B. Halbjahr 1 – Übersicht (optional)',
  });
  const columnsInput = el('textarea.textarea', {
    id: 'bl-columns', rows: '6',
    placeholder: 'Eine Spaltenüberschrift pro Zeile, z.B.\nKA 1\nKA 2\nSoLei\nReferat',
  });
  columnsInput.value = remembered.join('\n');
  const countHint = el('p.hint');

  const update = () => {
    const n = parseColumns(columnsInput.value).length;
    countHint.textContent = n
      ? `${n} Spalte(n) · Leerzeilen ergeben Spalten ohne Überschrift`
      : 'Ohne Eingabe entstehen 6 leere Spalten.';
  };
  columnsInput.addEventListener('input', update);
  update();

  const body = el('div.form', {}, [
    el('div.form-field', {}, [el('label.label', { for: 'bl-title', text: 'Titel' }), titleInput]),
    el('div.form-field', {}, [el('label.label', { for: 'bl-columns', text: 'Spaltenüberschriften' }), columnsInput]),
    countHint,
  ]);

  const modal = openModal({
    title: 'Leere Klassenliste',
    body,
    actions: [
      el('button.btn', { type: 'button', text: 'Abbrechen', onClick: () => modal.close() }),
      el('button.btn.btn--primary', {
        type: 'button', text: '⎙ Vorschau',
        onClick: () => {
          const columns = parseColumns(columnsInput.value);
          const cols = columns.length ? columns : DEFAULT_COLUMNS;
          saveColumns(columns);
          modal.close();
          openBlankList({ cls, students, columns: cols, title: titleInput.value.trim() });
        },
      }),
    ],
  });
}

/** Zeilen → Spaltenliste; Leerzeilen bleiben als leere Überschrift erhalten, Rand-Leerzeilen fallen weg. */
function parseColumns(text) {
  const lines = text.split('\n').map((l) => l.trim());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.slice(0, 12);
}

function loadColumns() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveColumns(columns) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(columns)); } catch { /* egal */ }
}

/* ------------------------------------------------------------ Ausdruck */

/**
 * @param {{cls: import('../store.js').Klasse, students: import('../store.js').Schueler[], columns: string[], title: string}} opts
 */
export function openBlankList({ cls, students, columns, title }) {
  const sorted = [...students].sort(store.byName);
  const preview = openPrintPreview({
    title: `Klassenliste – ${cls.name}`,
    pages: [],
    hint: 'Leere Liste zum Handeintragen. Im Druckdialog „PDF“ → „Als PDF sichern“.',
  });
  const host = preview.pagesElement;
  const printed = formatDate(Date.now());

  const pages = [];
  let { page, tbody } = newPage({ host, cls, title, columns, printed, first: true });
  pages.push(page);

  for (const student of sorted) {
    const row = studentRow(student, columns.length);
    tbody.append(row);
    if (overflows(page)) {
      row.remove();
      ({ page, tbody } = newPage({ host, cls, title, columns, printed, first: false }));
      pages.push(page);
      tbody.append(row);
    }
  }

  pages.forEach((p, i) => p.append(el('footer.sheet__pagefoot', {
    text: `${cls.name}${title ? ` · ${title}` : ''} · Seite ${i + 1} von ${pages.length}`,
  })));
}

function newPage({ host, cls, title, columns, printed, first }) {
  const tbody = el('tbody');
  const page = el('section.sheet.sheet--list', {}, [
    el('header.sheet__head', {}, [
      el('div.sheet__ident', {}, [
        el('div', {}, [
          el('h1.sheet__name', { text: `Klasse ${cls.name}${first ? '' : ' (Fortsetzung)'}` }),
          el('p.sheet__meta', { text: title ? `${title} · Stand ${printed}` : `Stand ${printed}` }),
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
