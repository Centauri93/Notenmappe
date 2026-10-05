/**
 * Notenbesprechung – die Seite einer einzelnen Schüler:in.
 *
 * Links alles, was die App weiß: jede Einzelnote des Zeitraums mit Datum,
 * Gewichtung und Bemerkung (antippen → bearbeiten, wirkt auf die ganze
 * Datenbank), darunter der rechnerische Durchschnitt.
 * Rechts das Ergebnis des Gesprächs: Endnote SoLei (1–6, optional + / −)
 * und Notizen. Alles speichert sich selbst.
 */

import * as store from '../store.js';
import { openGradeDialog } from './gradedialog.js';
import { openReport } from './report.js';
import {
  el, clear, toast, formatDate, formatDateWeekday, formatDateTime, initials, photoUrl,
} from '../ui.js';

export async function renderConferenceStudent(root, classId, confId, studentId) {
  const [cls, conf, student] = await Promise.all([
    store.getClass(classId), store.getConference(confId), store.getStudent(studentId),
  ]);
  if (!cls || !conf || !student) { location.hash = `#/class/${classId}/conferences`; return; }

  const [students, sessions] = await Promise.all([store.listStudents(classId), store.listSessions(classId)]);
  let allGrades = await store.listGradesOfStudent(studentId);
  let entry = await store.getConferenceEntry(confId, studentId);

  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const inRange = sessions.filter((s) => s.startedAt >= conf.from && s.startedAt <= conf.to);
  const rangeIds = new Set(inRange.map((s) => s.id));
  const gradesInRange = () => allGrades
    .filter((g) => rangeIds.has(g.sessionId))
    .sort((a, b) => a.createdAt - b.createdAt);

  // Navigation: Reihenfolge wie im Sitzplan-Raster (alphabetisch)
  const index = students.findIndex((s) => s.id === studentId);
  const prev = students[index - 1] || null;
  const next = students[index + 1] || null;
  const link = (s) => `#/class/${classId}/conference/${confId}/${s.id}`;

  clear(root);

  /* ------------------------------------------------------------ Kopf */

  const url = photoUrl(student);
  root.append(el('div.page-head.page-head--class', {}, [
    el('div.page-head__left', {}, [
      el('a.back-link', { href: `#/class/${classId}/conference/${confId}`, text: `‹ ${conf.title}` }),
      el('div.conf-student__ident', {}, [
        url
          ? el('img.avatar.avatar--lg', { src: url, alt: '' })
          : el('span.avatar.avatar--lg.avatar--fallback', { text: initials(student) }),
        el('div', {}, [
          el('h1.page-title', { text: store.fullName(student) }),
          el('p.page-sub', { text: `${cls.name} · ${formatDate(conf.from)} – ${formatDate(conf.to)} · ${index + 1} von ${students.length}` }),
        ]),
      ]),
    ]),
    el('div.page-head__actions', {}, [
      prev ? el('a.btn', { href: link(prev), text: '‹ Vorige' }) : el('span.btn', { 'aria-disabled': 'true', text: '‹ Vorige' }),
      next ? el('a.btn', { href: link(next), text: 'Nächste ›' }) : el('span.btn', { 'aria-disabled': 'true', text: 'Nächste ›' }),
    ]),
  ]));

  /* ------------------------------------------------------- Zwei Spalten */

  const gradesPanel = el('section.panel.conf-col');
  const resultPanel = el('section.panel.panel--accent.conf-col');
  root.append(el('div.conf-grid', {}, [gradesPanel, resultPanel]));

  /** Speichert die aktuell sichtbaren Notizen – gesetzt von drawResult(). */
  let flushNotes = async () => {};
  // Nur einmal registrieren: Jede Neuzeichnung ersetzt das Textfeld, der Handler folgt über flushNotes
  root.addEventListener('view:teardown', () => { void flushNotes(); }, { once: true });

  drawGrades();
  drawResult();

  /* --------------------------------------------------- Linke Spalte */

  function drawGrades() {
    clear(gradesPanel);
    const grades = gradesInRange();
    const stats = store.average(grades);

    gradesPanel.append(el('h2.panel__title', { text: 'Einzelnoten im Zeitraum' }));

    if (!grades.length) {
      gradesPanel.append(el('p.hint', { text: 'Keine Einträge in diesem Zeitraum.' }));
    } else {
      const list = el('ul.conf-grades');
      for (const g of grades) {
        const session = sessionById.get(g.sessionId);
        const weight = store.weightOf(g);
        const chip = g.absent
          ? el('span.grade-chip.grade-chip--absent', { text: 'fehlt' })
          : g.value === null
            ? el('span.grade-chip.grade-chip--comment', { text: '💬' })
            : el('span.grade-chip', { text: String(g.value), dataset: { value: String(g.value) } });
        list.append(el('li', {}, [
          el('button.conf-grade', {
            type: 'button',
            title: 'Antippen zum Bearbeiten',
            onClick: () => editGrade(session, g),
          }, [
            el('span.conf-grade__date', { text: formatDateWeekday(g.createdAt) }),
            chip,
            el('span.conf-grade__weight', { text: weight > 1 ? `×${weight}` : '' }),
            el('span.conf-grade__comment', { text: g.comment || '' }),
            el('span.conf-grade__edit', { text: '✎', 'aria-hidden': 'true' }),
          ]),
        ]));
      }
      gradesPanel.append(list);
    }

    gradesPanel.append(el('div.conf-avg', {}, [
      el('span.conf-avg__label', {
        text: stats.count
          ? `${stats.count} Einzelnote(n)${stats.hasBoost ? ' · gewichtet' : ''} · rechnerischer Durchschnitt`
          : 'rechnerischer Durchschnitt',
      }),
      el('strong.conf-avg__value', { text: stats.count ? store.formatAverage(stats.average) : '–' }),
    ]));
    gradesPanel.append(el('p.hint', { text: 'Antippen bearbeitet die Note – die Änderung gilt überall in der App.' }));
  }

  function editGrade(session, grade) {
    openGradeDialog({
      student,
      entry: grade,
      title: `Eintrag vom ${formatDateWeekday(session.startedAt)}`,
      hint: 'Änderungen gelten für die ganze Notenmappe, nicht nur für diese Besprechung.',
      closeOnGrade: false,
      save: async (patch) => {
        const saved = await store.saveEntry({ sessionId: session.id, classId, studentId, ...patch });
        allGrades = allGrades.filter((g) => g.sessionId !== session.id);
        if (saved) allGrades.push(saved);
        drawGrades();
        return saved;
      },
    });
  }

  /* -------------------------------------------------- Rechte Spalte */

  function drawResult() {
    clear(resultPanel);

    // Endnote: sechs große Knöpfe, darunter Tendenz
    const gradeButtons = [1, 2, 3, 4, 5, 6].map((v) => el('button.grade-btn', {
      type: 'button', text: String(v), dataset: { value: String(v) },
      'aria-label': `Endnote ${v}`,
      onClick: () => setFinal({ grade: entry?.grade === v ? null : v }),
    }));
    const tendencyButtons = [['+', '+ (besser)'], ['-', '− (schwächer)']].map(([t, label]) => el('button.btn.state-btn', {
      type: 'button', text: label, dataset: { tendency: t },
      onClick: () => setFinal({ tendency: entry?.tendency === t ? '' : t }),
    }));

    const finalLabel = store.finalGradeLabel(entry);
    const notes = el('textarea.textarea.conf-notes', {
      id: 'conf-notes', rows: '7',
      placeholder: 'Notizen zum Gespräch – erscheinen auf dem Ausdruck unter „Notizen“ …',
    });
    notes.value = entry?.notes || '';
    let notesTimer = null;
    const saveNotes = async () => {
      const text = notes.value.trim();
      if (text === (entry?.notes || '')) return;
      entry = await store.saveConferenceEntry({ conferenceId: confId, classId, studentId, notes: text });
      savedHint.textContent = `Gespeichert ${formatDateTime(entry.updatedAt)}`;
    };
    notes.addEventListener('input', () => { clearTimeout(notesTimer); notesTimer = setTimeout(saveNotes, 500); });
    notes.addEventListener('blur', () => { clearTimeout(notesTimer); saveNotes(); });
    flushNotes = () => { clearTimeout(notesTimer); return saveNotes(); };

    const savedHint = el('p.hint', { text: entry?.updatedAt ? `Gespeichert ${formatDateTime(entry.updatedAt)}` : 'Noch nichts eingetragen.' });

    const doneBtn = el('button.btn.btn--lg', {
      type: 'button',
      class: entry?.done ? 'btn--ghost' : 'btn--primary',
      text: entry?.done ? '✓ Besprochen – wieder öffnen' : '✓ Besprechung abschließen',
      onClick: async () => {
        await saveNotes();
        entry = await store.saveConferenceEntry({ conferenceId: confId, classId, studentId, done: !entry?.done });
        if (entry.done) {
          toast(`${store.fullName(student)} abgeschlossen`, 'success');
          location.hash = next ? link(next) : `#/class/${classId}/conference/${confId}`;
        } else {
          drawResult();
        }
      },
    });

    resultPanel.append(
      el('div.conf-result__head', {}, [
        el('h2.panel__title', { text: 'Endnote Sonstige Leistungen' }),
        el('span.conf-result__final', {
          class: finalLabel ? '' : 'is-empty',
          dataset: finalLabel ? { value: String(entry.grade) } : {},
          text: finalLabel || '–',
        }),
      ]),
      el('div.grade-grid', {}, gradeButtons),
      el('div.conf-tendency', {}, tendencyButtons),
      el('div.comment-box', {}, [
        el('label.label', { for: 'conf-notes', text: 'Notizen zum Gespräch' }),
        notes,
      ]),
      savedHint,
      el('div.conf-result__actions', {}, [
        doneBtn,
        el('button.btn', {
          type: 'button', text: '⎙ PDF',
          onClick: async () => {
            await saveNotes();
            openReport({ cls, students: [student], scope: 'student', range: { from: conf.from, to: conf.to }, conference: conf });
          },
        }),
      ]),
    );

    for (const b of gradeButtons) b.classList.toggle('is-active', entry?.grade === Number(b.dataset.value));
    for (const b of tendencyButtons) {
      b.classList.toggle('is-active', Boolean(entry?.grade) && entry?.tendency === b.dataset.tendency);
      b.disabled = !entry?.grade
        || (entry.grade === 1 && b.dataset.tendency === '+')
        || (entry.grade === 6 && b.dataset.tendency === '-');
    }
    if (entry?.done) resultPanel.append(el('p.hint', { text: `Abgeschlossen am ${formatDateTime(entry.doneAt)}` }));

    async function setFinal(patch) {
      try {
        entry = await store.saveConferenceEntry({ conferenceId: confId, classId, studentId, notes: notes.value, ...patch });
        drawResult();
      } catch (err) {
        toast(err.message || 'Konnte nicht gespeichert werden.', 'error');
      }
    }
  }
}
