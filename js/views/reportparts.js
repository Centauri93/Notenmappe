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

/** Schmale Kopfzeile für Folgeseiten derselben Schüler:in. */
export function continuationHead({ student, cls, rangeLabel }) {
  return el('header.sheet__head.sheet__head--cont', {}, [
    el('div.sheet__ident', {}, [
      el('div', {}, [
        el('h1.sheet__name.sheet__name--cont', { text: store.fullName(student) || '—' }),
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

/**
 * Leeres Notenfeld rechts in der Abschnittskopfzeile – für die
 * handschriftlich eingetragene Endnote. Der rechnerische Durchschnitt steht
 * bewusst nicht daneben, sondern unauffällig unter der Tabelle
 * (siehe gradesFoot), damit die Zahl nicht als „fertige“ Note wirkt.
 */
export function finalGradeBox() {
  return el('div.sheet__final-box', { 'aria-label': 'Feld für die Endnote' }, [
    el('span.sheet__final-label', { text: 'Note' }),
  ]);
}

/**
 * Fußnote zur Notenbildung – sehr klein, unter der Notenliste. Erklärt den
 * Lernenden, warum die Gesamtnote vom rechnerischen Durchschnitt abweichen
 * kann (pädagogische Gesamtbewertung nach § 48 SchulG NRW).
 */
export const GRADING_NOTE = 'Die Einzelnoten zeigen deine Beiträge in den einzelnen Stunden. '
  + 'Die Note für die Sonstigen Leistungen ist eine Gesamtbewertung (§ 48 SchulG NRW): '
  + 'Unter anderem berücksichtigt sie zusätzlich, wie kontinuierlich und fachlich fundiert du dich beteiligst, '
  + 'wie du dich im Verlauf entwickelst und welche Ergebnisse du in Gruppen- und Vorbereitungsaufgaben erzielst. '
  + 'Die Gesamtnote kann daher vom errechneten Durchschnitt abweichen.';

export function gradingNote() {
  return el('p.sheet__footnote', { text: GRADING_NOTE });
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

/**
 * Fußzeile unter den Einzelnoten: links Anzahl und Art der Mittelung,
 * rechts der rechnerische Durchschnitt – klein, als Information.
 */
export function gradesFoot(stats, printed) {
  const how = stats.hasBoost
    ? 'gewichteter Durchschnitt (Mehrfachwertung zählt entsprechend oft)'
    : 'einfacher Durchschnitt';
  return el('footer.sheet__foot', {}, [
    el('div.sheet__foot-left', {}, [
      el('span', { text: `${stats.count} Einzelnote(n) · ${how}` }),
      printed ? el('span', { text: `Ausdruck vom ${printed}` }) : null,
    ]),
    el('div.sheet__avg', {}, [
      el('span.sheet__avg-label', { text: 'Rechnerischer Durchschnitt' }),
      el('strong.sheet__avg-value', { text: stats.count ? store.formatAverage(stats.average) : '–' }),
    ]),
  ]);
}
