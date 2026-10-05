/**
 * Druck-/PDF-Ansicht für den Notenbericht.
 *
 * Statt einer PDF-Bibliothek wird die Druckfunktion des Browsers genutzt:
 * Safari/Chrome bieten im Druckdialog „Als PDF sichern“. Das erzeugt
 * scharfe, auswählbare Schrift und braucht keinerlei Abhängigkeiten.
 *
 * Die Seiten teilt die App selbst ein, nicht der Browser – damit beim
 * doppelseitigen Druck jede Schüler:in genau ein Blatt (Vorder- und
 * Rückseite) bekommt:
 *
 *   • Jede Seite ist ein fester A4-Kasten. Die Notenliste wird Zeile für
 *     Zeile eingefüllt; passt eine Zeile nicht mehr, geht es auf der
 *     nächsten Seite weiter (mit wiederholter Kopfzeile).
 *   • Den Rest jeder Seite füllt ein liniertes Notizfeld bis zum Seitenende.
 *   • Jede Schüler:in bekommt eine gerade Seitenzahl: eine Rückseite nur
 *     mit Notizlinien wird bei Bedarf angehängt.
 *
 * Gemessen wird in der Vorschau am echten DOM: Die Seitenkästen haben auf
 * dem Bildschirm dieselben Millimeter-Maße wie im Druck.
 */

import * as store from '../store.js';
import { el } from '../ui.js';
import { openPrintPreview } from './printpreview.js';
import {
  loadReportData, identityHead, continuationHead, sectionHead, finalGradeBox,
  gradingNote, gradesTableHead, gradeRow, emptyGradesRow, gradesFoot,
} from './reportparts.js';

/** Höhe einer Notizlinie – muss zu .sheet__line in app.css passen. */
const LINE_HEIGHT_REM = 2;

/**
 * @param {{
 *   cls: import('../store.js').Klasse,
 *   students: import('../store.js').Schueler[],
 *   scope: 'class'|'student',
 *   range: {from: number, to: number},
 * }} opts
 */
export async function openReport({ cls, students, scope, range }) {
  const { rangeLabel, gradesOf, printed } = await loadReportData({ cls, range });

  const preview = openPrintPreview({
    title: scope === 'class'
      ? `Notenübersicht – ${cls.name}`
      : `Notenübersicht – ${store.fullName(students[0])}`,
    pages: [],
    hint: 'Doppelseitig drucken: je Schüler:in genau ein Blatt. Im Druckdialog „PDF“ → „Als PDF sichern“.',
  });

  const host = preview.pagesElement;
  for (const student of students) {
    const grades = gradesOf(student.id);
    const stats = store.average(grades);
    const pages = layoutStudent({ host, student, cls, rangeLabel, grades, stats, printed });
    pages.forEach((page, i) => page.append(pageFoot(student, i + 1, pages.length)));
  }
}

/* ------------------------------------------------------------ Seitenbau */

/**
 * Baut die Seiten einer Schüler:in direkt in `host` auf und misst dabei,
 * was auf eine Seite passt.
 * @returns {HTMLElement[]} die erzeugten Seiten
 */
function layoutStudent({ host, student, cls, rangeLabel, grades, stats, printed }) {
  const pages = [];
  const rows = grades.length ? grades.map(gradeRow) : [emptyGradesRow()];

  // Vorderseite: Kopf, Abschnittstitel mit Notenfeld, Tabelle
  let { page, tbody, section } = newContentPage({ host, student, cls, rangeLabel, first: true });
  pages.push(page);

  for (const row of rows) {
    tbody.append(row);
    if (overflows(page)) {
      row.remove();
      ({ page, tbody, section } = newContentPage({ host, student, cls, rangeLabel, first: false }));
      pages.push(page);
      tbody.append(row);
    }
  }

  // Fuß und Fußnote unter die letzte Tabellenzeile – notfalls auf die nächste Seite
  const tail = el('div.sheet__tail', {}, [gradesFoot(stats, printed), gradingNote()]);
  section.append(tail);
  if (overflows(page)) {
    tail.remove();
    // Letzte Zeile mitnehmen, damit Fuß und Tabelle zusammenbleiben
    const lastRow = tbody.lastElementChild;
    ({ page, tbody, section } = newContentPage({ host, student, cls, rangeLabel, first: false }));
    pages.push(page);
    if (lastRow && rows.length > 1) tbody.append(lastRow);
    section.append(tail);
  }

  // Gerade Seitenzahl: ggf. eine Rückseite nur mit Notizen anhängen
  if (pages.length % 2 === 1) {
    const extra = el('section.sheet', {}, [continuationHead({ student, cls, rangeLabel })]);
    host.append(extra);
    pages.push(extra);
  }

  // Jede Seite bis zum Ende mit Notizlinien auffüllen
  for (const p of pages) fillNotes(p);
  return pages;
}

/** Neue Seite mit Kopf und (leerer) Notentabelle. */
function newContentPage({ host, student, cls, rangeLabel, first }) {
  const tbody = el('tbody');
  const section = el('section.sheet__section', {}, [
    first
      ? sectionHead('Sonstige Leistungen', finalGradeBox())
      : sectionHead('Sonstige Leistungen (Fortsetzung)'),
    el('table.sheet__table', {}, [gradesTableHead(), tbody]),
  ]);
  const page = el('section.sheet', {}, [
    first ? identityHead({ student, cls, rangeLabel }) : continuationHead({ student, cls, rangeLabel }),
    section,
  ]);
  host.append(page);
  return { page, tbody, section };
}

/** Füllt den Rest der Seite mit Notizlinien, ohne dass die Seite überläuft. */
function fillNotes(page) {
  const lines = el('div.sheet__lines', { 'aria-hidden': 'true' });
  const notes = el('section.sheet__notes.sheet__notes--fill', {}, [
    el('h2.sheet__section-title', { text: 'Notizen' }),
    lines,
  ]);
  page.append(notes);

  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const lineHeight = LINE_HEIGHT_REM * rem;
  const count = Math.max(0, Math.floor(lines.getBoundingClientRect().height / lineHeight));
  for (let i = 0; i < count; i++) lines.append(el('div.sheet__line'));

  // Sicherheitsnetz gegen Rundungsfehler: lieber eine Linie weniger
  while (overflows(page) && lines.lastElementChild) lines.lastElementChild.remove();

  // Eine randvolle Seite bekommt kein Notizfeld mit nur ein, zwei Linien
  if (overflows(page) || lines.childElementCount < 2) notes.remove();
}

/** Seitenzahl unten – hilft beim Sortieren nach dem Druck. */
function pageFoot(student, n, total) {
  return el('footer.sheet__pagefoot', {
    text: `${store.fullName(student)} · Seite ${n} von ${total}`,
  });
}

/** Ragt der Inhalt über den festen Seitenkasten hinaus? */
function overflows(page) {
  return page.scrollHeight > page.clientHeight + 1;
}
