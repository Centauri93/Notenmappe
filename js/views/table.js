/**
 * Notenübersicht: Zeilen = Schüler:innen, Spalten = Stunden.
 * Zeitraumfilter, Durchschnittsberechnung, Einstieg in den PDF-Export.
 */

import * as store from '../store.js';
import { classHeader } from './classnav.js';
import { openReport } from './report.js';
import { openBlankListDialog } from './blanklist.js';
import {
  el, clear, openModal, toast,
  formatDate, formatDateShort, formatDateTime, toDateInputValue, initials, photoUrl,
} from '../ui.js';

export async function renderTable(root, classId) {
  const cls = await store.getClass(classId);
  if (!cls) { location.hash = '#/classes'; return; }

  const [students, sessions, allGrades] = await Promise.all([
    store.listStudents(classId),
    store.listSessions(classId),
    store.listGradesOfClass(classId),
  ]);

  clear(root);
  root.append(classHeader(cls, 'table', [
    el('button.btn', {
      type: 'button', text: '∑ Noten berechnen', onClick: () => showAverages(),
    }),
    el('button.btn', {
      type: 'button', text: '⎙ Leere Liste',
      title: 'Klassenliste mit leeren Kästchen zum Handeintragen',
      onClick: () => openBlankListDialog({ cls, students }),
    }),
    el('button.btn.btn--primary', {
      type: 'button', text: '⎙ PDF Klasse',
      onClick: () => openReport({ cls, students, scope: 'class', range: currentRange() }),
    }),
  ]));

  if (!students.length) {
    root.append(el('div.empty', {}, [
      el('p', { text: 'Noch keine Schüler:innen in dieser Klasse.' }),
      el('a.btn.btn--primary', { href: `#/class/${classId}/students`, text: 'Schüler:innen anlegen' }),
    ]));
    return;
  }

  /* ------------------------------------------------------------- Filter */

  const bounds = sessions.length
    ? { from: sessions[0].startedAt, to: sessions[sessions.length - 1].startedAt }
    : { from: Date.now(), to: Date.now() };

  const fromInput = el('input.input.input--date', { type: 'date', value: toDateInputValue(bounds.from) });
  const toInput = el('input.input.input--date', { type: 'date', value: toDateInputValue(bounds.to) });
  const tableHost = el('div.table-wrap');

  const filterBar = el('div.filter-bar', {}, [
    el('label.filter-bar__field', {}, [el('span.label', { text: 'Von' }), fromInput]),
    el('label.filter-bar__field', {}, [el('span.label', { text: 'Bis' }), toInput]),
    el('button.btn.btn--ghost', {
      type: 'button', text: 'Zeitraum zurücksetzen',
      onClick: () => {
        fromInput.value = toDateInputValue(bounds.from);
        toInput.value = toDateInputValue(bounds.to);
        draw();
      },
    }),
  ]);
  fromInput.addEventListener('change', draw);
  toInput.addEventListener('change', draw);

  root.append(filterBar, tableHost);
  draw();

  /* -------------------------------------------------------------- Logik */

  function currentRange() {
    const from = fromInput.value ? new Date(`${fromInput.value}T00:00:00`).getTime() : -Infinity;
    const to = toInput.value ? new Date(`${toInput.value}T23:59:59.999`).getTime() : Infinity;
    return { from, to };
  }

  function filteredSessions() {
    const { from, to } = currentRange();
    return sessions.filter((s) => s.startedAt >= from && s.startedAt <= to);
  }

  function gradesFor(studentId, sessionId) {
    return allGrades.filter((g) => g.studentId === studentId && g.sessionId === sessionId);
  }

  function gradesInRange(studentId) {
    const ids = new Set(filteredSessions().map((s) => s.id));
    return allGrades.filter((g) => g.studentId === studentId && ids.has(g.sessionId));
  }

  function draw() {
    clear(tableHost);
    const cols = filteredSessions();

    if (!cols.length) {
      tableHost.append(el('div.empty.empty--inline', {}, [
        el('p', {
          text: sessions.length
            ? 'Im gewählten Zeitraum gibt es keine Stunden.'
            : 'Es wurden noch keine Stunden benotet. Lege im Sitzplan los.',
        }),
      ]));
      return;
    }

    const head = el('tr', {}, [
      el('th.col-name', { scope: 'col', text: 'Schüler:in' }),
      ...cols.map((s) => el('th.col-session', { scope: 'col' }, [
        el('span.col-session__date', { text: formatDateShort(s.startedAt) }),
        el('span.col-session__year', { text: String(new Date(s.startedAt).getFullYear()) }),
        s.closedAt === null ? el('span.badge.badge--open', { text: 'offen' }) : null,
      ])),
      el('th.col-avg', { scope: 'col', text: 'Ø' }),
      el('th.col-actions', { scope: 'col', text: '' }),
    ]);

    const body = el('tbody');
    for (const s of students) {
      const stats = store.average(gradesInRange(s.id));
      const url = photoUrl(s);
      body.append(el('tr', {}, [
        el('th.col-name', { scope: 'row' }, [
          el('span.cell-person', {}, [
            url
              ? el('img.cell-avatar', { src: url, alt: '' })
              : el('span.cell-avatar.cell-avatar--fallback', { text: initials(s) }),
            el('span.cell-name', { text: store.fullName(s) || '—' }),
          ]),
        ]),
        ...cols.map((session) => {
          const grades = gradesFor(s.id, session.id);
          const cell = el('td.cell-grade');
          if (!grades.length) {
            cell.append(el('span.cell-empty', { text: '·' }));
            return cell;
          }
          for (const g of grades) {
            const weight = store.weightOf(g);
            const boosted = weight > 1;
            const kind = g.absent ? 'absent' : (g.value === null ? 'comment' : 'grade');
            const label = { absent: 'fehlt', comment: '💬', grade: String(g.value) }[kind];
            const titleParts = [formatDateTime(g.createdAt)];
            if (boosted) titleParts.push(`zählt ${weight}-fach`);
            if (g.comment) titleParts.push(g.comment);

            const chip = el('button.grade-chip.grade-chip--btn', {
              type: 'button',
              class: kind === 'grade' ? '' : `grade-chip--${kind}`,
              dataset: kind === 'grade' ? { value: String(g.value) } : {},
              text: label,
              title: titleParts.join(' – '),
              onClick: () => showGradeDetail(s, g),
            });
            if (g.comment) chip.classList.add('has-comment');
            if (boosted) {
              chip.classList.add('is-boosted');
              chip.append(el('span.chip-boost', { text: `×${weight}`, 'aria-hidden': 'true' }));
            }
            cell.append(chip);
          }
          return cell;
        }),
        el('td.col-avg', {}, [
          el('span.avg-value', { text: store.formatAverage(stats.average) }),
          el('span.avg-count', {
            text: stats.count
              ? `${stats.count} Noten${stats.hasBoost ? ' · gewichtet' : ''}`
              : 'keine Noten',
          }),
        ]),
        el('td.col-actions', {}, [
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button', text: 'PDF',
            onClick: () => openReport({ cls, students: [s], scope: 'student', range: currentRange() }),
          }),
        ]),
      ]));
    }

    tableHost.append(el('table.grade-table', {}, [el('thead', {}, [head]), body]));
    tableHost.append(el('p.hint', {
      text: 'Auf eine Note tippen zeigt Datum und Bemerkung. Mehrere Noten in einer Stunde stehen nebeneinander; nichts wird überschrieben.',
    }));
  }

  function showGradeDetail(student, grade) {
    const weight = store.weightOf(grade);
    const boosted = weight > 1;
    const title = grade.absent ? 'Fehlzeit' : (grade.value === null ? 'Bemerkung' : 'Einzelnote');

    let noteCell;
    if (grade.absent) noteCell = el('span.grade-chip.grade-chip--absent', { text: 'fehlt' });
    else if (grade.value === null) noteCell = el('span.hint', { text: 'keine Note, nur Bemerkung' });
    else noteCell = el('span.grade-chip', { text: String(grade.value), dataset: { value: String(grade.value) } });

    openModal({
      title,
      body: el('div.detail', {}, [
        el('p.detail__row', {}, [el('span.label', { text: 'Schüler:in' }), el('strong', { text: store.fullName(student) })]),
        el('p.detail__row', {}, [el('span.label', { text: 'Note' }), noteCell]),
        el('p.detail__row', {}, [
          el('span.label', { text: 'Gewichtung' }),
          el('span', { text: boosted ? `zählt ${weight}-fach (×${weight})` : 'einfach' }),
        ]),
        el('p.detail__row', {}, [el('span.label', { text: 'Zeitpunkt' }), el('span', { text: formatDateTime(grade.createdAt) })]),
        el('p.detail__row', {}, [el('span.label', { text: 'Bemerkung' }), el('span', { text: grade.comment || '—' })]),
      ]),
    });
  }

  /** Mündliche Noten für die ganze Klasse berechnen und prominent anzeigen. */
  function showAverages() {
    const range = currentRange();
    const rows = students.map((s) => ({ student: s, stats: store.average(gradesInRange(s.id)) }));
    const withGrades = rows.filter((r) => r.stats.count > 0);

    const list = el('ul.avg-list', {}, rows.map(({ student, stats }) => {
      const url = photoUrl(student);
      return el('li.avg-card', { class: stats.count ? '' : 'avg-card--empty' }, [
        url
          ? el('img.avatar', { src: url, alt: '' })
          : el('span.avatar.avatar--fallback', { text: initials(student) }),
        el('div.avg-card__name', {}, [
          el('strong', { text: store.fullName(student) || '—' }),
          el('span.hint', {
            text: `${stats.count} Einzelnote(n)${stats.hasBoost ? ' · mit mehrfach gewerteten' : ''}`,
          }),
        ]),
        el('div.avg-card__result', {}, [
          el('span.avg-card__value', { text: store.formatAverage(stats.average) }),
          el('span.avg-card__rounded', { text: stats.rounded ? `Zeugnisnote ${stats.rounded}` : '—' }),
        ]),
      ]);
    }));

    const classAvg = store.average(withGrades.flatMap((r) => gradesInRange(r.student.id)));

    openModal({
      title: 'Mündliche Noten',
      wide: true,
      body: el('div', {}, [
        el('p.hint', {
          text: `Einfacher Durchschnitt aller Einzelnoten vom ${formatDate(Math.max(range.from, bounds.from))} bis ${formatDate(Math.min(range.to, bounds.to))}. Die Einzelnoten bleiben unverändert erhalten.`,
        }),
        el('div.avg-summary', {}, [
          el('span.label', { text: 'Klassendurchschnitt' }),
          el('strong.avg-summary__value', { text: store.formatAverage(classAvg.average) }),
        ]),
        list,
      ]),
      actions: [
        el('button.btn.btn--primary', {
          type: 'button', text: '⎙ Als PDF',
          onClick: () => openReport({ cls, students, scope: 'class', range: currentRange() }),
        }),
      ],
    });
    if (!withGrades.length) toast('Im gewählten Zeitraum liegen keine Noten vor.', 'error');
  }
}
