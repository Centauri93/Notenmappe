/**
 * Sitzplan: Karten frei verschieben (Touch + Maus), antippen zum Benoten,
 * Stunde abschließen.
 *
 * Positionen werden als Bruchteile (0–1) der Fläche gespeichert, damit die
 * Anordnung auf Mac und iPad trotz unterschiedlicher Bildschirmgrößen gleich
 * aussieht.
 */

import * as store from '../store.js';
import { makeDraggable } from '../dnd.js';
import { baseCardSize, gridSize, gridSlot, cardSizeOf, applyCardScale, layoutCards } from '../seatlayout.js';
import { classHeader } from './classnav.js';
import {
  el, clear, toast, openModal, confirmDialog,
  photoUrl, initials, formatDateTime,
} from '../ui.js';

const GRADE_VALUES = [1, 2, 3, 4, 5, 6];

export async function renderSeating(root, classId) {
  const cls = await store.getClass(classId);
  if (!cls) { location.hash = '#/classes'; return; }

  const students = await store.listStudents(classId);
  let openSession = await store.findOpenSession(classId);
  /** @type {import('../store.js').Note[]} */
  let sessionGrades = openSession ? await store.listGradesOfSession(openSession.id) : [];

  /*
   * Für die Durchschnittsanzeige auf jeder Karte: alle Noten der Klasse,
   * gefiltert auf die letzten sechs Monate. Wird beim Speichern mitgeführt,
   * damit der Schnitt sofort stimmt – auch für die gerade benotete Stunde.
   */
  let allGrades = await store.listGradesOfClass(classId);
  const avgSince = (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.getTime(); })();
  /** Gewichteter 6-Monats-Schnitt einer Schüler:in – oder null ohne Noten. */
  function averageFor(studentId) {
    const grades = allGrades.filter((g) => g.studentId === studentId && g.createdAt >= avgSince);
    return store.average(grades).average;
  }

  clear(root);

  const statusText = el('span.status__text');
  const closeBtn = el('button.btn.btn--primary', {
    type: 'button', text: '✓ Stunde beenden', onClick: () => finishLesson(),
  });

  const arrangeBtn = el('button.btn', { type: 'button', text: '⌗ Anordnen', onClick: () => autoArrange() });
  const fullscreenBtn = el('button.btn', {
    type: 'button', text: '⛶ Vollbild', title: 'Sitzplan bildschirmfüllend anzeigen',
    onClick: () => setFullscreen(!isFullscreen),
  });

  const header = classHeader(cls, 'seating', [arrangeBtn, fullscreenBtn, closeBtn]);
  const headerActions = header.querySelector('.page-head__actions');
  root.append(header);

  const canvas = el('div.seating-canvas', { id: 'seating-canvas' });

  /* Kartengröße: pro Klasse gespeichert, damit große Klassen auf den
     Bildschirm passen. */
  let cardScale = cls.cardScale || 100;
  const scaleValue = el('span.zoom__value', { text: `${cardScale}%` });
  const scaleInput = el('input.zoom__slider', {
    type: 'range', min: '60', max: '200', step: '5', value: String(cardScale),
    'aria-label': 'Kartengröße im Sitzplan',
  });
  scaleInput.addEventListener('input', () => {
    cardScale = Number(scaleInput.value);
    scaleValue.textContent = `${cardScale}%`;
    applyScale();
    layoutAll();
  });
  scaleInput.addEventListener('change', () => store.saveCardScale(classId, cardScale));

  // Im Vollbild wandern die Knöpfe aus der Kopfzeile hier hinein
  const statusActions = el('div.status__actions');
  const status = el('div.status', {}, [
    statusText,
    el('label.zoom', {}, [
      el('span.zoom__label', { text: 'Karten' }),
      scaleInput,
      scaleValue,
    ]),
    statusActions,
  ]);
  root.append(status, canvas);
  applyScale();

  /* ---------------------------------------------------------- Vollbild */

  /*
   * Vollbild: Kopfzeile und Reiter verschwinden, die Sitzfläche füllt den
   * ganzen Bildschirm – gedacht fürs iPad im Unterricht. Auf Geräten, die
   * es erlauben, wird zusätzlich der Browser-Rahmen ausgeblendet.
   */
  let isFullscreen = false;

  function setFullscreen(on) {
    if (on === isFullscreen) return;
    isFullscreen = on;
    document.body.classList.toggle('seating-fullscreen', on);
    fullscreenBtn.textContent = on ? '✕ Vollbild beenden' : '⛶ Vollbild';
    if (on) {
      statusActions.append(arrangeBtn, fullscreenBtn, closeBtn);
      canvas.style.maxHeight = '';
      requestBrowserFullscreen();
    } else {
      headerActions.append(arrangeBtn, fullscreenBtn, closeBtn);
      exitBrowserFullscreen();
      fitCanvas();
    }
    placeBelowBar();
    layoutAll();
  }

  /** Im Vollbild beginnt die Fläche genau unter der (umbrechenden) Statusleiste. */
  function placeBelowBar() {
    canvas.style.top = isFullscreen ? `${status.offsetHeight}px` : '';
  }
  const barObserver = new ResizeObserver(() => placeBelowBar());
  barObserver.observe(status);
  root.addEventListener('view:teardown', () => barObserver.disconnect(), { once: true });

  function requestBrowserFullscreen() {
    const d = document.documentElement;
    const req = d.requestFullscreen || d.webkitRequestFullscreen;
    if (!req) return;
    try { const r = req.call(d); if (r?.catch) r.catch(() => {}); } catch { /* nicht erlaubt – egal */ }
  }

  function exitBrowserFullscreen() {
    const active = document.fullscreenElement || document.webkitFullscreenElement;
    if (!active) return;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    try { const r = exit?.call(document); if (r?.catch) r.catch(() => {}); } catch { /* egal */ }
  }

  // Verlässt der Nutzer das Browser-Vollbild selbst (Geste, Escape), folgt die Ansicht
  const onFullscreenChange = () => {
    const active = document.fullscreenElement || document.webkitFullscreenElement;
    if (!active && isFullscreen) setFullscreen(false);
  };
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  const onKey = (ev) => { if (ev.key === 'Escape' && isFullscreen) setFullscreen(false); };
  document.addEventListener('keydown', onKey);
  root.addEventListener('view:teardown', () => {
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('seating-fullscreen');
    exitBrowserFullscreen();
  }, { once: true });

  if (!students.length) {
    canvas.append(el('div.empty.empty--inline', {}, [
      el('p', { text: 'Diese Klasse hat noch keine Schüler:innen.' }),
      el('a.btn.btn--primary', { href: `#/class/${classId}/students`, text: 'Schüler:innen anlegen' }),
    ]));
    updateStatus();
    return;
  }

  /** @type {Record<string, {x:number,y:number}>} */
  const seating = { ...(cls.seating || {}) };
  /** @type {Map<string, HTMLElement>} */
  const cards = new Map();

  ensurePositions();
  for (const s of students) canvas.append(buildCard(s));
  fitCanvas();
  layoutAll();
  updateStatus();

  /*
   * Größe einpassen: beim ersten Öffnen einer Klasse, und immer dann, wenn
   * die gespeicherte Größe zu groß geworden ist – etwa weil die Klasse durch
   * einen Foto-Import gewachsen ist. Kleiner eingestellte Werte bleiben.
   *
   * Das passiert erst, wenn die Fläche ihre endgültigen Maße hat – vorher
   * käme eine zu kleine Schätzung heraus.
   */
  let autoFitted = false;
  function applyAutoFit() {
    if (autoFitted || canvas.getBoundingClientRect().width < 100) return;
    autoFitted = true;
    fitCanvas();
    const fitting = autoFitScale();
    if (!cls.cardScale || cardScale > fitting) {
      cardScale = fitting;
      scaleInput.value = String(cardScale);
      scaleValue.textContent = `${cardScale}%`;
      applyScale();
      store.saveCardScale(classId, cardScale);
    }
  }

  const ro = new ResizeObserver(() => { applyAutoFit(); layoutAll(); });
  ro.observe(canvas);
  const onResize = () => { fitCanvas(); layoutAll(); };
  window.addEventListener('resize', onResize);
  // Beobachter beim Verlassen der Ansicht wieder abbauen
  root.addEventListener('view:teardown', () => {
    ro.disconnect();
    window.removeEventListener('resize', onResize);
  }, { once: true });

  /* ------------------------------------------------------------- Layout */

  /** Überträgt die eingestellte Größe auf die CSS-Variablen der Fläche. */
  function applyScale() {
    applyCardScale(canvas, cardScale);
  }

  /**
   * Passt die Sitzfläche in den sichtbaren Bereich ein, damit man beim
   * Benoten nicht scrollen muss. Wird bei Größenänderungen neu berechnet.
   */
  function fitCanvas() {
    if (isFullscreen) { canvas.style.maxHeight = ''; return; }
    const top = canvas.getBoundingClientRect().top + window.scrollY;
    const gap = parseFloat(getComputedStyle(root).paddingBottom) || 24;
    const available = window.innerHeight - top - gap - 4;
    canvas.style.maxHeight = `${Math.max(320, Math.round(available))}px`;
  }

  /**
   * Startgröße für Klassen, bei denen noch nichts eingestellt wurde:
   * so groß, dass alle Karten nebeneinander auf die Fläche passen.
   * @returns {number} Prozentwert
   */
  function autoFitScale() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !students.length) return 100;
    const { cols, rows } = gridSize(students.length);
    const base = baseCardSize();

    /*
     * Die Karten verteilen sich nicht über die volle Fläche, sondern über
     * „Fläche minus Kartenmaß“ (die Position ist die linke obere Ecke).
     * Damit sich benachbarte Karten nicht berühren, muss also gelten:
     *   Kartenbreite ≤ Flächenbreite / (Spalten + 1)
     * Der Faktor 0.95 lässt zusätzlich etwas Luft für Rahmen und die
     * Markierungen unter der Karte.
     */
    const factor = Math.min(
      (rect.width / (cols + 1)) * 0.95 / base.w,
      (rect.height / (rows + 1)) * 0.95 / base.h,
    );
    // Abrunden, damit die Karten sicher passen
    return Math.min(200, Math.max(60, Math.floor(factor * 20) * 5));
  }

  function cardSize() {
    return cardSizeOf(canvas);
  }

  /**
   * Weist Schüler:innen ohne gespeicherte Position einen Rasterplatz zu –
   * und zwar einen, auf dem noch niemand sitzt. Sonst würden neu angelegte
   * Karten (z.B. nach einem Foto-Import) bestehende überdecken.
   */
  function ensurePositions() {
    const missing = students.filter((s) => !seating[s.id]);
    if (!missing.length) return;

    const total = students.length;
    const { cols, rows } = gridSize(total);

    // Schon vergebene Plätze – auch frei verschobene, die nicht im Raster liegen
    const occupied = students.map((s) => seating[s.id]).filter(Boolean);
    const minDx = 0.9 / cols;
    const minDy = 0.9 / rows;
    const isFree = (pos) => !occupied.some(
      (o) => Math.abs(o.x - pos.x) < minDx && Math.abs(o.y - pos.y) < minDy,
    );

    let slot = 0;
    const lastSlot = cols * rows - 1;
    for (const s of missing) {
      let pos = gridSlot(slot, total);
      // Freien Platz suchen; ist alles belegt, der Reihe nach auffüllen
      while (slot < lastSlot && !isFree(pos)) {
        slot += 1;
        pos = gridSlot(slot, total);
      }
      seating[s.id] = pos;
      occupied.push(pos);
      slot += 1;
    }
    store.saveSeating(classId, seating);
  }

  function layoutAll() {
    layoutCards(canvas, seating, cards);
  }

  let saveTimer = null;
  function persistSeating() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.saveSeating(classId, seating), 250);
  }

  /* -------------------------------------------------------------- Karten */

  function buildCard(student) {
    const url = photoUrl(student);
    const badge = el('span.card__grade');
    const card = el('article.seat-card', {
      dataset: { id: student.id },
      tabindex: '0',
      role: 'button',
      'aria-label': `${store.fullName(student)} benoten`,
      onKeydown: (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openGradeDialog(student); }
      },
    }, [
      url
        ? el('img.seat-card__photo', { src: url, alt: '', draggable: 'false' })
        : el('span.seat-card__photo.seat-card__photo--fallback', { text: initials(student) }),
      el('span.seat-card__name', { text: store.fullName(student) || '—' }),
      badge,
      // 6-Monats-Schnitt, immer sichtbar – unabhängig von der aktuellen Stunde
      el('span.card__avg', { title: 'Durchschnitt der letzten 6 Monate' }),
      el('span.card__flags'),
    ]);
    cards.set(student.id, card);

    let start = { x: 0, y: 0 };
    makeDraggable(card, {
      onStart: () => {
        const rect = canvas.getBoundingClientRect();
        const { w, h } = cardSize();
        start = {
          x: (seating[student.id]?.x || 0) * Math.max(0, rect.width - w),
          y: (seating[student.id]?.y || 0) * Math.max(0, rect.height - h),
        };
        card.classList.add('is-dragging');
        canvas.append(card); // nach vorn holen
      },
      onMove: (dx, dy) => {
        const rect = canvas.getBoundingClientRect();
        const { w, h } = cardSize();
        const maxX = Math.max(0, rect.width - w);
        const maxY = Math.max(0, rect.height - h);
        const px = Math.min(maxX, Math.max(0, start.x + dx));
        const py = Math.min(maxY, Math.max(0, start.y + dy));
        card.style.left = `${px}px`;
        card.style.top = `${py}px`;
        seating[student.id] = { x: maxX ? px / maxX : 0, y: maxY ? py / maxY : 0 };
      },
      onEnd: (moved) => {
        card.classList.remove('is-dragging');
        if (moved) persistSeating();
      },
      onTap: () => openGradeDialog(student),
    });

    refreshCard(student.id);
    return card;
  }

  /** Aktualisiert Rahmen, Notenanzeige und Markierungen einer Karte. */
  function refreshCard(studentId) {
    const card = cards.get(studentId);
    if (!card) return;
    const entry = sessionGrades.find((g) => g.studentId === studentId) || null;
    const badge = card.querySelector('.card__grade');
    const flags = card.querySelector('.card__flags');

    card.classList.toggle('is-graded', Boolean(entry && entry.value !== null));
    card.classList.toggle('is-absent', Boolean(entry?.absent));
    card.classList.toggle('has-comment', Boolean(entry?.comment));

    clear(badge);
    if (entry && entry.value !== null) {
      badge.dataset.value = String(entry.value);
      badge.append(String(entry.value));
    } else {
      delete badge.dataset.value;
    }

    const avg = averageFor(studentId);
    card.querySelector('.card__avg').textContent = avg === null ? '–' : store.formatAverage(avg);

    clear(flags);
    if (entry?.absent) flags.append(el('span.flag.flag--absent', { text: 'fehlt' }));
    if (entry && store.weightOf(entry) > 1) {
      flags.append(el('span.flag.flag--boost', { text: `×${store.weightOf(entry)}` }));
    }
  }

  function updateStatus() {
    const graded = sessionGrades.filter((g) => g.value !== null).length;
    const absent = sessionGrades.filter((g) => g.absent).length;
    const started = openSession ? formatDateTime(openSession.startedAt) : null;
    const parts = [
      `Laufende Stunde seit ${started}`,
      `${graded} von ${students.length} benotet`,
    ];
    if (absent) parts.push(`${absent} fehlt/fehlen`);
    statusText.textContent = openSession
      ? parts.join(' · ')
      : `Keine laufende Stunde – der erste Eintrag startet automatisch eine neue Stunde. ${students.length} Schüler:innen.`;
    closeBtn.disabled = !openSession || sessionGrades.length === 0;
  }

  /* -------------------------------------------------------- Noteneingabe */

  /**
   * Eingabe für eine Schüler:in. Alles wird sofort gespeichert; die Bemerkung
   * spätestens beim Schließen des Dialogs. Solange die Stunde läuft, lässt
   * sich der Eintrag beliebig ergänzen (erst Bemerkung, später Note).
   */
  function openGradeDialog(student) {
    /** @type {import('../store.js').Note|null} */
    let entry = sessionGrades.find((g) => g.studentId === student.id) || null;

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
      el('p.hint', { text: 'Alles wird automatisch gespeichert und bleibt bis zum Stundenende änderbar.' }),
    ]);

    const modal = openModal({
      title: 'Eintrag für diese Stunde',
      body,
      // Bemerkung sichern, falls der Dialog ohne Notenklick verlassen wird
      onClose: () => { void flushComment(); },
    });
    refreshDialog();

    /* --------------------------------------------------------- Speichern */

    /** Schreibt einen Teil-Patch und hält Karte und Statuszeile aktuell. */
    async function persist(patch) {
      try {
        if (!openSession) openSession = await store.getOrCreateOpenSession(classId);
        entry = await store.saveEntry({
          sessionId: openSession.id,
          classId,
          studentId: student.id,
          ...patch,
        });
        sessionGrades = sessionGrades.filter((g) => g.studentId !== student.id);
        if (entry) sessionGrades.push(entry);
        // Denselben Eintrag im 6-Monats-Bestand ersetzen, damit der Schnitt stimmt
        allGrades = allGrades.filter((g) => !(g.sessionId === openSession.id && g.studentId === student.id));
        if (entry) allGrades.push(entry);
        refreshCard(student.id);
        updateStatus();
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
      } else {
        modal.close();
        toast(`Note ${value} für ${store.fullName(student)} gespeichert`, 'success');
      }
    }

    async function toggleAbsent() {
      const next = !entry?.absent;
      const ok = await persist({ absent: next, comment: commentField.value });
      if (!ok) return;
      if (next) {
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

    /* ----------------------------------------------------------- Anzeige */

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
  }

  /* ------------------------------------------------------ Stundenabschluss */

  async function finishLesson() {
    if (!openSession) return;
    const graded = sessionGrades.filter((g) => g.value !== null).length;
    const absent = sessionGrades.filter((g) => g.absent).length;
    // Wer fehlt, kann nicht benotet werden und fehlt hier nicht „unbeabsichtigt“
    const missing = students.length - graded - absent;
    const details = [`${sessionGrades.length} Eintrag/Einträge werden fest in der Historie gespeichert.`];
    if (missing > 0) details.push(`${missing} anwesende Schüler:in(nen) wurden nicht benotet.`);
    const ok = await confirmDialog({
      title: 'Stunde beenden?',
      message: `${details.join(' ')} Danach ist die Stunde nicht mehr änderbar.`,
      confirmLabel: 'Stunde abschließen',
      danger: false,
    });
    if (!ok) return;
    const result = await store.closeSession(classId);
    openSession = null;
    sessionGrades = [];
    for (const s of students) refreshCard(s.id);
    updateStatus();
    toast(result.closed ? `Stunde mit ${result.count} Eintrag/Einträgen abgeschlossen` : 'Leere Stunde verworfen', 'success');
  }

  /* ------------------------------------------------------- Automatisches Raster */

  async function autoArrange() {
    const ok = await confirmDialog({
      title: 'Karten neu anordnen?',
      message: 'Alle Karten werden gleichmäßig im Raster verteilt. Die bisherige Sitzordnung geht dabei verloren.',
      confirmLabel: 'Anordnen',
      danger: false,
    });
    if (!ok) return;
    students.forEach((s, i) => { seating[s.id] = gridSlot(i, students.length); });
    layoutAll();
    await store.saveSeating(classId, seating);
    toast('Sitzplan neu angeordnet');
  }
}
