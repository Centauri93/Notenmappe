/**
 * Bausteine des Notenausdrucks (report.js): Kopfzeile, Ergebnisblock,
 * Notentabelle und Fußzeile.
 */

import * as store from '../store.js';
import { el, formatDate, formatDateTime, formatDateWeekday, initials, photoUrl } from '../ui.js';

/* ------------------------------------------------------------ Daten laden */

/**
 * Sammelt alles, was ein Blatt braucht: Stunden und Noten im Zeitraum.
 *
 * @param {{cls: {id: string, name: string}, range: {from: number, to: number}}} opts
 */
export async function loadReportData({ cls, range }) {
  const [sessions, allGrades, allStudents] = await Promise.all([
    store.listSessions(cls.id),
    store.listGradesOfClass(cls.id),
    store.listStudents(cls.id),
  ]);

  const inRange = sessions.filter((s) => s.startedAt >= range.from && s.startedAt <= range.to);
  const sessionIds = new Set(inRange.map((s) => s.id));

  // Zeitraum-Beschriftung: erste bis letzte Stunde mit Einträgen
  const dates = inRange.map((s) => s.startedAt).sort((a, b) => a - b);
  const rangeLabel = dates.length
    ? `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}`
    : 'kein Zeitraum mit Einträgen';

  /** Einzelnoten einer Schüler:in im Zeitraum, chronologisch. */
  const gradesOf = (studentId) => allGrades
    .filter((g) => g.studentId === studentId && sessionIds.has(g.sessionId))
    .sort((a, b) => a.createdAt - b.createdAt);

  return { allStudents, rangeLabel, gradesOf, printed: formatDate(Date.now()) };
}

/* ------------------------------------------------------------- Kopfzeile */

/**
 * Kopfzeile eines Blattes: Foto, Name, Klasse und Zeitraum.
 * Gilt für das ganze Blatt, deshalb steht sonst nichts darin.
 */
export function identityHead({ student, cls, rangeLabel }) {
  const url = photoUrl(student);
  return el('header.sheet__head', {}, [
    el('div.sheet__ident', {}, [
      url
        ? el('img.sheet__photo', { src: url, alt: '' })
        : el('span.sheet__photo.sheet__photo--fallback', { text: initials(student) }),
      el('div', {}, [
        el('h1.sheet__name', { text: store.fullName(student) || '—' }),
        el('p.sheet__meta', { text: `Klasse ${cls.name} · Zeitraum ${rangeLabel}` }),
      ]),
    ]),
  ]);
}

/** Abschnittsüberschrift, rechts optional die große Note. */
export function sectionHead(title, right = null) {
  return el('div.sheet__section-head', {}, [
    el('h2.sheet__section-title', { text: title }),
    right,
  ]);
}

/**
 * Die große Note rechts oben in einem Abschnitt.
 *
 * Ohne `label` und `note` bleibt nur die Zahl übrig – so sieht die Note der
 * sonstigen Leistungen genauso aus wie die einer Klassenarbeit und wirkt
 * damit gleichwertig.
 *
 * @param {{label?: string, value: string, note?: string}} opts
 */
export function resultBlock({ label, value, note }) {
  return el('div.sheet__result', {}, [
    label ? el('span.sheet__result-label', { text: label }) : null,
    el('strong.sheet__result-value', { text: value }),
    note ? el('span.sheet__result-rounded', { text: note }) : null,
  ]);
}

/* --------------------------------------------------- Sonstige Leistungen */

/** Kopfzeile der Einzelnoten-Tabelle. */
export function gradesTableHead() {
  return el('thead', {}, [
    el('tr', {}, [
      el('th', { scope: 'col', text: 'Datum' }),
      el('th', { scope: 'col', text: 'Uhrzeit' }),
      el('th', { scope: 'col', text: 'Note' }),
      el('th', { scope: 'col', text: 'Wertung' }),
      el('th', { scope: 'col', text: 'Bemerkung' }),
    ]),
  ]);
}

/** Eine Zeile der Einzelnoten-Tabelle. */
export function gradeRow(g) {
  const weight = store.weightOf(g);
  const noteText = g.absent ? 'fehlt' : (g.value !== null ? String(g.value) : '–');
  return el('tr', { class: g.absent ? 'sheet__row--absent' : '' }, [
    el('td.sheet__date', { text: formatDateWeekday(g.createdAt) }),
    el('td.sheet__time', { text: formatDateTime(g.createdAt).split(', ')[1] }),
    el('td.sheet__grade', { class: g.absent ? 'sheet__grade--absent' : '', text: noteText }),
    el('td.sheet__weight', { text: weight > 1 ? `×${weight}` : '' }),
    el('td.sheet__comment', { text: g.comment || '' }),
  ]);
}

/** Platzhalterzeile, wenn im Zeitraum nichts eingetragen wurde. */
export function emptyGradesRow() {
  return el('tr', {}, [el('td', { colspan: '5', text: 'Keine Einträge im gewählten Zeitraum.' })]);
}

/** Vollständige Einzelnoten-Tabelle (für Ausgaben ohne eigene Seitenaufteilung). */
export function gradesTable(grades) {
  return el('table.sheet__table', {}, [
    gradesTableHead(),
    el('tbody', {}, grades.length ? grades.map(gradeRow) : [emptyGradesRow()]),
  ]);
}

/** Fußzeile unter den Einzelnoten: Anzahl und Art der Mittelung. */
export function gradesFoot(stats, printed) {
  return el('footer.sheet__foot', {}, [
    el('span', {
      text: stats.hasBoost
        ? `${stats.count} Einzelnote(n) · gewichteter Durchschnitt (Mehrfachwertung zählt entsprechend oft)`
        : `${stats.count} Einzelnote(n) · einfacher Durchschnitt`,
    }),
    printed ? el('span', { text: `Ausdruck vom ${printed}` }) : null,
  ]);
}
