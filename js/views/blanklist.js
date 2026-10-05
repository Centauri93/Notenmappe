/**
 * Leere Klassenliste zum Handeintragen – ein frei beschriftbares Raster.
 *
 * Links Foto und Name jeder Schüler:in, rechts leere Kästchen ohne jede
 * Beschriftung – auch die Kopfzeile bleibt frei. Gedacht als
 * Papier-Ergänzung: Was die App nicht erfasst, trägt die Lehrkraft hier von
 * Hand ein.
 *
 * Die Seiten sind dieselben festen A4-Kästen wie beim Notenbericht
 * (report.js); passen nicht alle Zeilen auf eine Seite, wird mit
 * wiederholter Kopfzeile fortgesetzt.
 */

import * as store from '../store.js';
import { el, formatDate, initials, photoUrl } from '../ui.js';
import { openPrintPreview } from './printpreview.js';

/** Feste Zahl leerer Spalten – bei 15-mm-Fotos bleiben je Kästchen rund 17 mm. */
const COLUMN_COUNT = 8;

/**
 * Öffnet die Liste direkt – ohne Dialog, nichts vorbelegt, alles frei.
 * @param {{cls: import('../store.js').Klasse, students: import('../store.js').Schueler[]}} opts
 */
export function openBlankListDialog({ cls, students }) {
  openBlankList({ cls, students, columns: Array.from({ length: COLUMN_COUNT }, () => '') });
}

/* ------------------------------------------------------------ Ausdruck */

/**
 * Übersicht zu einer Besprechung: dieselbe Liste, aber die erste Spalte
 * heißt „SoLei“ und enthält die vergebene Endnote; der Rest bleibt frei.
 */
export async function openConferenceOverview({ cls, students, conference }) {
  const entries = await store.listConferenceEntries(conference.id);
  const values = new Map(entries.map((e) => [e.studentId, store.finalGradeLabel(e) || '']));
  openBlankList({
    cls, students,
    columns: ['SoLei', ...Array.from({ length: COLUMN_COUNT - 1 }, () => '')],
    prefill: { column: 0, values },
    subtitle: conference.title,
  });
}

/**
 * @param {{
 *   cls: import('../store.js').Klasse,
 *   students: import('../store.js').Schueler[],
 *   columns: string[],
 *   prefill?: {column: number, values: Map<string, string>},
 *   subtitle?: string,
 * }} opts
 */
export function openBlankList({ cls, students, columns, prefill = null, subtitle = '' }) {
  const sorted = [...students].sort(store.byName);
  const preview = openPrintPreview({
    title: subtitle ? `Übersicht – ${cls.name} · ${subtitle}` : `Klassenliste – ${cls.name}`,
    pages: [],
    hint: 'Liste zum Handeintragen. Im Druckdialog „PDF“ → „Als PDF sichern“.',
  });
  const host = preview.pagesElement;
  const printed = formatDate(Date.now());

  const pages = [];
  let { page, tbody } = newPage({ host, cls, columns, printed, first: true, subtitle });
  pages.push(page);

  for (const student of sorted) {
    const row = studentRow(student, columns.length, prefill);
    tbody.append(row);
    if (overflows(page)) {
      row.remove();
      ({ page, tbody } = newPage({ host, cls, columns, printed, first: false, subtitle }));
      pages.push(page);
      tbody.append(row);
    }
  }

  pages.forEach((p, i) => p.append(el('footer.sheet__pagefoot', {
    text: `${cls.name}${subtitle ? ` · ${subtitle}` : ''} · Seite ${i + 1} von ${pages.length}`,
  })));
}

function newPage({ host, cls, columns, printed, first, subtitle = '' }) {
  const tbody = el('tbody');
  const page = el('section.sheet.sheet--list', {}, [
    el('header.sheet__head', {}, [
      el('div.sheet__ident', {}, [
        el('div', {}, [
          el('h1.sheet__name', { text: `Klasse ${cls.name}${first ? '' : ' (Fortsetzung)'}` }),
          el('p.sheet__meta', { text: subtitle ? `${subtitle} · Stand ${printed}` : `Stand ${printed}` }),
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

function studentRow(student, columnCount, prefill = null) {
  const url = photoUrl(student);
  const cell = (i) => {
    const value = prefill && prefill.column === i ? prefill.values.get(student.id) || '' : '';
    return el('td.blank-table__cell', { class: value ? 'blank-table__cell--filled' : '', text: value });
  };
  return el('tr', {}, [
    el('td.blank-table__who', {}, [
      el('div.blank-table__ident', {}, [
        url
          ? el('img.blank-table__photo', { src: url, alt: '' })
          : el('span.blank-table__photo.blank-table__photo--fallback', { text: initials(student) }),
        el('span.blank-table__name', { text: store.fullName(student) || '—' }),
      ]),
    ]),
    ...Array.from({ length: columnCount }, (_, i) => cell(i)),
  ]);
}

function overflows(page) {
  return page.scrollHeight > page.clientHeight + 1;
}
