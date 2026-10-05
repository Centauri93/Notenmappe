/**
 * Notenbesprechung – Übersicht und Sitzplan-Ansicht.
 *
 *   #/class/:id/conferences            Liste der Besprechungen, neue anlegen
 *   #/class/:id/conference/:confId     Sitzplan mit Fortschritt; Karte antippen → Schüler:in
 *
 * Die Schülerseite selbst liegt in conferencestudent.js, der Ausdruck in
 * report.js (gleiches Blatt wie der Notenbericht, aber mit Endnote und
 * digitalen Notizen).
 */

import * as store from '../store.js';
import { classHeader } from './classnav.js';
import { openReport } from './report.js';
import { applyCardScale, layoutCards, gridSlot } from '../seatlayout.js';
import {
  el, clear, toast, openModal, confirmDialog,
  formatDate, toDateInputValue, initials, photoUrl,
} from '../ui.js';

/* ------------------------------------------------------------- Übersicht */

export async function renderConferences(root, classId) {
  const cls = await store.getClass(classId);
  if (!cls) { location.hash = '#/classes'; return; }
  const [students, sessions, conferences] = await Promise.all([
    store.listStudents(classId),
    store.listSessions(classId),
    store.listConferences(classId),
  ]);

  clear(root);
  root.append(classHeader(cls, 'conferences', [
    el('button.btn.btn--primary', {
      type: 'button', text: '+ Neue Besprechung',
      onClick: () => createDialog({ root, cls, sessions }),
    }),
  ]));

  if (!conferences.length) {
    root.append(el('div.empty', {}, [
      el('p', { text: 'Noch keine Notenbesprechung angelegt.' }),
      el('p.hint', {
        text: 'Eine Besprechung fasst die Noten eines Zeitraums zusammen. Du gehst die Klasse über den Sitzplan durch, '
          + 'legst je Schüler:in die Endnote fest und hältst Notizen fest – daraus entsteht der Ausdruck.',
      }),
      el('button.btn.btn--primary', {
        type: 'button', text: '+ Erste Besprechung anlegen',
        onClick: () => createDialog({ root, cls, sessions }),
      }),
    ]));
    return;
  }

  const list = el('div.conf-list');
  for (const conf of conferences) {
    const entries = await store.listConferenceEntries(conf.id);
    const done = entries.filter((e) => e.done).length;
    const graded = entries.filter((e) => e.grade !== null).length;
    const total = students.length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    list.append(el('article.conf-card', {}, [
      el('button.conf-card__main', {
        type: 'button',
        onClick: () => { location.hash = `#/class/${classId}/conference/${conf.id}`; },
      }, [
        el('div.conf-card__text', {}, [
          el('h2.conf-card__title', { text: conf.title }),
          el('p.conf-card__meta', { text: `Zeitraum ${formatDate(conf.from)} – ${formatDate(conf.to)}` }),
          el('p.conf-card__meta', { text: `${done} von ${total} besprochen · ${graded} Endnoten` }),
        ]),
        ring(pct),
      ]),
      el('div.conf-card__actions', {}, [
        el('button.btn.btn--ghost', {
          type: 'button', text: 'Bearbeiten', onClick: () => editDialog({ root, cls, sessions, conf }),
        }),
        el('button.btn.btn--ghost', {
          type: 'button', text: '⎙ PDF Klasse',
          onClick: () => openReport({ cls, students, scope: 'class', range: { from: conf.from, to: conf.to }, conference: conf }),
        }),
        el('button.btn.btn--ghost.btn--danger-ghost', {
          type: 'button', text: 'Löschen', onClick: () => removeDialog({ root, classId, conf }),
        }),
      ]),
    ]));
  }
  root.append(list);
}

/** Fortschrittsring: Anteil der besprochenen Schüler:innen. */
function ring(pct) {
  const node = el('div.conf-card__ring', {}, [el('span.conf-card__ring-value', { text: `${pct}%` })]);
  node.style.setProperty('--pct', String(pct));
  return node;
}

/* --------------------------------------------------------------- Dialoge */

function rangeForm({ conf, sessions }) {
  const closed = sessions.filter((s) => s.closedAt !== null);
  const all = closed.length ? closed : sessions;
  const bounds = all.length
    ? { from: all[0].startedAt, to: all[all.length - 1].startedAt }
    : { from: Date.now(), to: Date.now() };

  const title = el('input.input', {
    id: 'conf-title', type: 'text', value: conf?.title || '',
    placeholder: 'z.B. Notenbesprechung 1. Halbjahr',
  });
  const from = el('input.input.input--date', { id: 'conf-from', type: 'date', value: toDateInputValue(conf?.from ?? bounds.from) });
  const to = el('input.input.input--date', { id: 'conf-to', type: 'date', value: toDateInputValue(conf?.to ?? bounds.to) });

  const form = el('div.form', {}, [
    el('div.form-field', {}, [el('label.label', { for: 'conf-title', text: 'Bezeichnung' }), title]),
    el('div.form-row', {}, [
      el('div.form-field', {}, [el('label.label', { for: 'conf-from', text: 'Von' }), from]),
      el('div.form-field', {}, [el('label.label', { for: 'conf-to', text: 'Bis' }), to]),
    ]),
    el('p.hint', { text: 'Berücksichtigt werden alle Einzelnoten der Stunden in diesem Zeitraum. Vorbelegt ist der Zeitraum aller Stunden.' }),
  ]);

  const read = () => {
    const f = from.value ? new Date(`${from.value}T00:00:00`).getTime() : bounds.from;
    const t = to.value ? new Date(`${to.value}T23:59:59.999`).getTime() : bounds.to;
    if (t < f) { toast('„Bis“ liegt vor „Von“.', 'error'); return null; }
    return { title: title.value, from: f, to: t };
  };
  return { form, read, focus: () => title.focus() };
}

function createDialog({ root, cls, sessions }) {
  const { form, read, focus } = rangeForm({ sessions });
  const modal = openModal({
    title: 'Neue Notenbesprechung',
    body: form,
    actions: [
      el('button.btn', { type: 'button', text: 'Abbrechen', onClick: () => modal.close() }),
      el('button.btn.btn--primary', {
        type: 'button', text: 'Anlegen',
        onClick: async () => {
          const data = read();
          if (!data) return;
          const conf = await store.createConference({ classId: cls.id, ...data });
          modal.close();
          toast('Besprechung angelegt', 'success');
          location.hash = `#/class/${cls.id}/conference/${conf.id}`;
        },
      }),
    ],
  });
  focus();
}

function editDialog({ root, cls, sessions, conf }) {
  const { form, read } = rangeForm({ conf, sessions });
  const modal = openModal({
    title: 'Besprechung bearbeiten',
    body: form,
    actions: [
      el('button.btn', { type: 'button', text: 'Abbrechen', onClick: () => modal.close() }),
      el('button.btn.btn--primary', {
        type: 'button', text: 'Speichern',
        onClick: async () => {
          const data = read();
          if (!data) return;
          await store.updateConference(conf.id, data);
          modal.close();
          renderConferences(root, cls.id);
        },
      }),
    ],
  });
}

async function removeDialog({ root, classId, conf }) {
  const ok = await confirmDialog({
    title: 'Besprechung löschen?',
    message: `„${conf.title}“ wird mit allen Endnoten und Notizen gelöscht. Die Einzelnoten der Stunden bleiben erhalten.`,
    confirmLabel: 'Endgültig löschen',
  });
  if (!ok) return;
  await store.deleteConference(conf.id);
  toast('Besprechung gelöscht');
  renderConferences(root, classId);
}

/* ------------------------------------------------------ Sitzplan-Ansicht */

export async function renderConference(root, classId, confId) {
  const cls = await store.getClass(classId);
  const conf = await store.getConference(confId);
  if (!cls || !conf) { location.hash = `#/class/${classId}/conferences`; return; }

  const [students, sessions, allGrades, entries] = await Promise.all([
    store.listStudents(classId),
    store.listSessions(classId),
    store.listGradesOfClass(classId),
    store.listConferenceEntries(confId),
  ]);
  const inRange = new Set(sessions.filter((s) => s.startedAt >= conf.from && s.startedAt <= conf.to).map((s) => s.id));
  const entryOf = new Map(entries.map((e) => [e.studentId, e]));
  const done = entries.filter((e) => e.done).length;

  clear(root);
  root.append(classHeader(cls, 'conferences', [
    el('a.btn', { href: `#/class/${classId}/conferences`, text: '‹ Alle Besprechungen' }),
    el('button.btn.btn--primary', {
      type: 'button', text: '⎙ PDF Klasse',
      onClick: () => openReport({ cls, students, scope: 'class', range: { from: conf.from, to: conf.to }, conference: conf }),
    }),
  ]));

  root.append(el('div.status.status--conf', {}, [
    el('span.status__text', {
      text: `${conf.title} · ${formatDate(conf.from)} – ${formatDate(conf.to)} · ${done} von ${students.length} besprochen`,
    }),
    el('span.hint', { text: 'Karte antippen, um die Schüler:in zu besprechen. Grün = abgeschlossen.' }),
  ]));

  if (!students.length) {
    root.append(el('div.empty', {}, [el('p', { text: 'Diese Klasse hat noch keine Schüler:innen.' })]));
    return;
  }

  const canvas = el('div.seating-canvas.seating-canvas--conf');
  root.append(canvas);
  applyCardScale(canvas, cls.cardScale || 100);

  const seating = { ...(cls.seating || {}) };
  students.forEach((s, i) => { if (!seating[s.id]) seating[s.id] = gridSlot(i, students.length); });

  const cards = new Map();
  for (const s of students) {
    const grades = allGrades.filter((g) => g.studentId === s.id && inRange.has(g.sessionId));
    const avg = store.average(grades).average;
    const entry = entryOf.get(s.id);
    const url = photoUrl(s);
    const final = store.finalGradeLabel(entry);

    const card = el('button.seat-card.conf-seat', {
      type: 'button',
      class: entry?.done ? 'is-done' : '',
      onClick: () => { location.hash = `#/class/${classId}/conference/${confId}/${s.id}`; },
    }, [
      url
        ? el('img.seat-card__photo', { src: url, alt: '', draggable: 'false' })
        : el('span.seat-card__photo.seat-card__photo--fallback', { text: initials(s) }),
      el('span.seat-card__name', { text: store.fullName(s) || '—' }),
      final ? el('span.card__grade.card__grade--final', { dataset: { value: String(entry.grade) }, text: final }) : null,
      el('span.card__avg', { text: avg === null ? '–' : store.formatAverage(avg) }),
      entry?.done ? el('span.conf-seat__check', { text: '✓', 'aria-label': 'besprochen' }) : null,
    ]);
    cards.set(s.id, card);
    canvas.append(card);
  }

  const fit = () => {
    const top = canvas.getBoundingClientRect().top + window.scrollY;
    const available = window.innerHeight - top - 28;
    canvas.style.maxHeight = `${Math.max(320, Math.round(available))}px`;
    layoutCards(canvas, seating, cards);
  };
  const ro = new ResizeObserver(() => layoutCards(canvas, seating, cards));
  ro.observe(canvas);
  window.addEventListener('resize', fit);
  root.addEventListener('view:teardown', () => {
    ro.disconnect();
    window.removeEventListener('resize', fit);
  }, { once: true });
  fit();
}
