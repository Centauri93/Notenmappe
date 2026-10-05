/**
 * Der Eintrags-Dialog: Note 1–6, „fehlt“, Mehrfachwertung, Bemerkung.
 *
 * Wird vom Sitzplan (laufende Stunde) und von der Notentabelle (jede
 * Stunde, auch abgeschlossene) gemeinsam genutzt. Der Dialog weiß nichts
 * über Stunden oder Datenbank – er bekommt den aktuellen Eintrag und eine
 * `save(patch)`-Funktion, die den neuen Eintrag (oder null, wenn er leer
 * geworden ist) zurückliefert.
 */

import * as store from '../store.js';
import { el, openModal, toast, initials, photoUrl } from '../ui.js';

const GRADE_VALUES = [1, 2, 3, 4, 5, 6];

/**
 * @param {{
 *   student: import('../store.js').Schueler,
 *   entry: import('../store.js').Note|null,
 *   save: (patch: object) => Promise<import('../store.js').Note|null>,
 *   title?: string,
 *   hint?: string,
 *   closeOnGrade?: boolean,
 * }} opts
 */
export function openGradeDialog({ student, entry, save, title, hint, closeOnGrade = true }) {
  const commentField = el('textarea.textarea', {
    id: 'grade-comment', rows: '2',
    placeholder: 'Besondere Bemerkung zu dieser Stunde …',
  });
  // textarea kennt kein value-Attribut – Inhalt über die Property setzen
  commentField.value = entry?.comment || '';

  const gradeButtons = GRADE_VALUES.map((value) =>
    el('button.grade-btn', {
      type: 'button',
      dataset: { value: String(value) },
      text: String(value),
      'aria-label': `Note ${value}`,
      onClick: () => setGrade(value),
    }));

  const absentBtn = el('button.btn.state-btn.state-btn--absent', {
    type: 'button', text: '🚫 Fehlt',
    onClick: () => toggleAbsent(),
  });
  // Ein Knopf je Gewichtungsstufe – antippen der aktiven Stufe nimmt sie zurück
  const weightButtons = store.WEIGHT_OPTIONS.map((factor) =>
    el('button.btn.state-btn.state-btn--weight', {
      type: 'button',
      dataset: { weight: String(factor) },
      text: `×${factor}`,
      title: `Diese Note zählt in dieser Stunde ${factor}-fach – z.B. für ein Referat`,
      onClick: () => setWeight(factor),
    }));

  const statusLine = el('p.hint.dialog-state');

  const url = photoUrl(student);
  const body = el('div.grade-dialog', {}, [
    el('div.grade-dialog__head', {}, [
      url
        ? el('img.avatar.avatar--lg', { src: url, alt: '' })
        : el('span.avatar.avatar--lg.avatar--fallback', { text: initials(student) }),
      el('div', {}, [
        el('strong.grade-dialog__name', { text: store.fullName(student) }),
        statusLine,
      ]),
    ]),
    el('div.grade-grid', {}, gradeButtons),
    el('div.state-row', {}, [
      absentBtn,
      el('div.weight-group', {}, weightButtons),
    ]),
    el('div.comment-box', {}, [
      el('label.label', { for: 'grade-comment', text: 'Bemerkung' }),
      commentField,
    ]),
    el('p.hint', { text: hint || 'Alles wird automatisch gespeichert.' }),
  ]);

  const modal = openModal({
    title: title || 'Eintrag für diese Stunde',
    body,
    // Bemerkung sichern, falls der Dialog ohne Notenklick verlassen wird
    onClose: () => { void flushComment(); },
  });
  refreshDialog();

  /* ----------------------------------------------------------- Speichern */

  async function persist(patch) {
    try {
      entry = await save(patch);
      return true;
    } catch (err) {
      toast(err.message || 'Konnte nicht gespeichert werden.', 'error');
      return false;
    }
  }

  /** Speichert die Bemerkung, sofern sie sich geändert hat. */
  async function flushComment() {
    const text = commentField.value.trim();
    if (text === (entry?.comment || '')) return;
    await persist({ comment: text });
  }

  async function setGrade(value) {
    // Dieselbe Note nochmal antippen nimmt sie wieder zurück
    const isSame = entry && entry.value === value;
    const ok = await persist({
      value: isSame ? null : value,
      comment: commentField.value,
      ...(isSame ? {} : { absent: false }),
    });
    if (!ok) return;
    if (isSame) {
      refreshDialog();
      toast('Note zurückgenommen');
    } else if (closeOnGrade) {
      modal.close();
      toast(`Note ${value} für ${store.fullName(student)} gespeichert`, 'success');
    } else {
      refreshDialog();
      toast(`Note ${value} gespeichert`, 'success');
    }
  }

  async function toggleAbsent() {
    const next = !entry?.absent;
    const ok = await persist({ absent: next, comment: commentField.value });
    if (!ok) return;
    if (next && closeOnGrade) {
      modal.close();
      toast(`${store.fullName(student)} als fehlend vermerkt`);
    } else {
      refreshDialog();
    }
  }

  /** Antippen der bereits aktiven Stufe nimmt die Mehrfachwertung zurück. */
  async function setWeight(factor) {
    const next = store.weightOf(entry || {}) === factor ? 1 : factor;
    const ok = await persist({ weight: next, comment: commentField.value });
    if (!ok) return;
    refreshDialog();
    toast(next > 1 ? `Zählt in dieser Stunde ${next}-fach` : 'Normale Gewichtung');
  }

  /* ------------------------------------------------------------- Anzeige */

  function refreshDialog() {
    const absent = Boolean(entry?.absent);
    const weight = store.weightOf(entry || {});
    const boosted = weight > 1;

    for (const btn of gradeButtons) {
      btn.classList.toggle('is-active', entry?.value === Number(btn.dataset.value));
      btn.disabled = absent;
    }
    absentBtn.classList.toggle('is-active', absent);
    absentBtn.setAttribute('aria-pressed', String(absent));
    for (const btn of weightButtons) {
      const active = weight === Number(btn.dataset.weight);
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
      btn.disabled = absent;
    }

    const parts = [];
    if (absent) parts.push('fehlt');
    else if (entry?.value !== null && entry?.value !== undefined) parts.push(`Note ${entry.value}`);
    else parts.push('noch keine Note');
    if (boosted) parts.push(`zählt ${weight}-fach`);
    statusLine.textContent = parts.join(' · ');
  }

  return modal;
}
