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
export async function openReport({ cls, students, scope, range, conference = null }) {
  const { rangeLabel, gradesOf, printed } = await loadReportData({ cls, range });

  /*
   * Mit Besprechung: Die dort festgelegte Endnote steht im Notenkasten, der
   * rechnerische Durchschnitt entfällt, die digitalen Notizen stehen unter
   * „Notizen“ – der Rest wird wie gewohnt mit Linien aufgefüllt.
   */
  const entries = conference ? await store.listConferenceEntries(conference.id) : [];
  const entryOf = (studentId) => entries.find((e) => e.studentId === studentId) || null;

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
    const entry = conference ? entryOf(student.id) : null;
    const pages = layoutStudent({
      host, student, cls, rangeLabel, grades, stats, printed,
      finalLabel: conference ? store.finalGradeLabel(entry) : null,
      notesText: conference ? (entry?.notes || '') : '',
      showAverage: !conference,
    });
    pages.forEach((page, i) => page.append(pageFoot(student, i + 1, pages.length)));
  }
}

/* ------------------------------------------------------------ Seitenbau */

/**
 * Baut die Seiten einer Schüler:in direkt in `host` auf und misst dabei,
 * was auf eine Seite passt.
 * @returns {HTMLElement[]} die erzeugten Seiten
 */
function layoutStudent({ host, student, cls, rangeLabel, grades, stats, printed, finalLabel = null, notesText = '', showAverage = true }) {
  const pages = [];
  const rows = grades.length ? grades.map(gradeRow) : [emptyGradesRow()];

  // Vorderseite: Kopf, Abschnittstitel mit Notenfeld, Tabelle
  let { page, tbody, section } = newContentPage({ host, student, cls, rangeLabel, first: true, finalLabel });
  pages.push(page);

  for (const row of rows) {
    tbody.append(row);
    if (overflows(page)) {
      row.remove();
      ({ page, tbody, section } = newContentPage({ host, student, cls, rangeLabel, first: false, finalLabel }));
      pages.push(page);
      tbody.append(row);
    }
  }

  // Fuß und Fußnote unter die letzte Tabellenzeile – notfalls auf die nächste Seite
  const tail = el('div.sheet__tail', {}, [gradesFoot(stats, printed, { showAverage }), gradingNote()]);
  section.append(tail);
  if (overflows(page)) {
    tail.remove();
    // Letzte Zeile mitnehmen, damit Fuß und Tabelle zusammenbleiben
    const lastRow = tbody.lastElementChild;
    ({ page, tbody, section } = newContentPage({ host, student, cls, rangeLabel, first: false, finalLabel }));
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

  // Jede Seite bis zum Ende mit Notizlinien auffüllen; digitale Notizen auf die erste Seite mit Platz
  let pending = notesText;
  for (const p of pages) {
    const placed = fillNotes(p, pending);
    if (placed) pending = '';
  }
  // Passen die Notizen auf keine Seite mehr: eigene Seiten anhängen (gerade Zahl bleibt)
  if (pending) {
    const extra = el('section.sheet', {}, [continuationHead({ student, cls, rangeLabel })]);
    host.append(extra); pages.push(extra);
    if (!fillNotes(extra, pending)) {
      // Länger als eine ganze Seite: notgedrungen abschneiden, statt endlos Seiten zu erzeugen
      extra.append(el('section.sheet__notes', {}, [
        el('h2.sheet__section-title', { text: 'Notizen' }),
        el('p.sheet__notes-text', { text: pending }),
      ]));
    }
    const pad = el('section.sheet', {}, [continuationHead({ student, cls, rangeLabel })]);
    host.append(pad); pages.push(pad);
    fillNotes(pad, '');
  }
  return pages;
}

/** Neue Seite mit Kopf und (leerer) Notentabelle. */
function newContentPage({ host, student, cls, rangeLabel, first, finalLabel = null }) {
  const tbody = el('tbody');
  const section = el('section.sheet__section', {}, [
    first
      ? sectionHead('Sonstige Leistungen', finalGradeBox(finalLabel))
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

/**
 * Füllt den Rest der Seite mit Notizlinien, ohne dass die Seite überläuft.
 * Mit `text` werden zuerst die digitalen Notizen gesetzt; passen sie nicht,
 * kommen sie nicht auf diese Seite (Rückgabe false).
 * @returns {boolean} ob der Text untergebracht wurde (ohne Text: true)
 */
function fillNotes(page, text = '') {
  const lines = el('div.sheet__lines', { 'aria-hidden': 'true' });
  const textEl = text ? el('p.sheet__notes-text', { text }) : null;
  const notes = el('section.sheet__notes.sheet__notes--fill', {}, [
    el('h2.sheet__section-title', { text: 'Notizen' }),
    textEl,
    lines,
  ]);
  page.append(notes);
  if (textEl && overflows(page)) {
    // Text passt hier nicht – Seite nur mit Linien füllen, Text auf die nächste
    textEl.remove();
    fillLines(page, notes, lines);
    return false;
  }
  fillLines(page, notes, lines);
  return true;
}

function fillLines(page, notes, lines) {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const lineHeight = LINE_HEIGHT_REM * rem;
  const count = Math.max(0, Math.floor(lines.getBoundingClientRect().height / lineHeight));
  for (let i = 0; i < count; i++) lines.append(el('div.sheet__line'));

  // Sicherheitsnetz gegen Rundungsfehler: lieber eine Linie weniger
  while (overflows(page) && lines.lastElementChild) lines.lastElementChild.remove();

  // Eine randvolle Seite bekommt kein Notizfeld mit nur ein, zwei Linien
  const hasText = Boolean(notes.querySelector('.sheet__notes-text'));
  if (overflows(page) || (lines.childElementCount < 2 && !hasText)) notes.remove();
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
