/** Schüler:innen einer Klasse verwalten – inkl. Foto (Datei oder Kamera). */

import * as store from '../store.js';
import { processPhoto } from '../photo.js';
import { parseNameFromFilename } from '../names.js';
import { classHeader } from './classnav.js';
import {
  el, clear, toast, openModal, confirmDialog,
  photoUrl, releasePhotoUrl, initials,
} from '../ui.js';

export async function renderStudents(root, classId) {
  const cls = await store.getClass(classId);
  if (!cls) { location.hash = '#/classes'; return; }

  clear(root);
  const students = await store.listStudents(classId);

  root.append(classHeader(cls, 'students', [
    el('button.btn', {
      type: 'button', text: '📁 Fotos importieren', onClick: () => pickPhotos(root, classId),
    }),
    el('button.btn.btn--primary', {
      type: 'button', text: '+ Schüler:in', onClick: () => openStudentForm(root, classId, null),
    }),
  ]));

  if (!students.length) {
    root.append(el('div.empty', {}, [
      el('p', { text: 'Noch keine Schüler:innen in dieser Klasse.' }),
      el('div.empty__actions', {}, [
        el('button.btn.btn--primary', {
          type: 'button', text: '+ Erste:n Schüler:in anlegen',
          onClick: () => openStudentForm(root, classId, null),
        }),
        el('button.btn', {
          type: 'button', text: '📁 Fotos importieren', onClick: () => pickPhotos(root, classId),
        }),
      ]),
      el('p.hint', {
        text: 'Beim Import wird aus jedem Dateinamen (NACHNAME_VORNAME.jpg) automatisch '
          + 'ein:e Schüler:in mit Foto angelegt.',
      }),
    ]));
    return;
  }

  const list = el('ul.student-list');
  for (const s of students) {
    const url = photoUrl(s);
    list.append(el('li.student-row', {}, [
      url
        ? el('img.avatar', { src: url, alt: '', loading: 'lazy' })
        : el('span.avatar.avatar--fallback', { text: initials(s), 'aria-hidden': 'true' }),
      el('div.student-row__name', {}, [
        el('strong', { text: s.lastName || '—' }),
        el('span', { text: s.firstName }),
      ]),
      el('div.student-row__actions', {}, [
        el('button.btn.btn--ghost', {
          type: 'button', text: 'Bearbeiten', onClick: () => openStudentForm(root, classId, s),
        }),
        el('button.btn.btn--ghost.btn--danger-ghost', {
          type: 'button', text: 'Löschen', onClick: () => removeStudent(root, classId, s),
        }),
      ]),
    ]));
  }
  root.append(list);
}

/**
 * Formular zum Anlegen/Bearbeiten.
 * @param {import('../store.js').Schueler|null} student
 */
function openStudentForm(root, classId, student) {
  const isNew = !student;
  /** @type {Blob|null|undefined} undefined = unverändert */
  let pendingPhoto = undefined;
  let previewUrl = null;

  const firstName = el('input.input', {
    type: 'text', id: 'f-first', value: student?.firstName || '',
    autocomplete: 'off', autocapitalize: 'words',
  });
  const lastName = el('input.input', {
    type: 'text', id: 'f-last', value: student?.lastName || '',
    autocomplete: 'off', autocapitalize: 'words',
  });

  const preview = el('div.photo-preview');
  const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
  const cameraInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });

  function renderPreview() {
    clear(preview);
    const blob = pendingPhoto !== undefined ? pendingPhoto : student?.photo || null;
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    if (blob) {
      previewUrl = URL.createObjectURL(blob);
      preview.append(el('img.photo-preview__img', { src: previewUrl, alt: 'Foto' }));
    } else {
      preview.append(el('span.photo-preview__empty', { text: 'Kein Foto' }));
    }
  }
  renderPreview();

  async function handleFile(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      pendingPhoto = await processPhoto(file);
      renderPreview();
    } catch (err) {
      toast(err.message || 'Foto konnte nicht verarbeitet werden.', 'error');
    }
  }
  fileInput.addEventListener('change', () => handleFile(fileInput));
  cameraInput.addEventListener('change', () => handleFile(cameraInput));

  const form = el('form.form', { onSubmit: (ev) => { ev.preventDefault(); save(); } }, [
    el('div.form-row', {}, [
      el('div.form-field', {}, [el('label.label', { for: 'f-first', text: 'Vorname' }), firstName]),
      el('div.form-field', {}, [el('label.label', { for: 'f-last', text: 'Nachname' }), lastName]),
    ]),
    el('div.form-field', {}, [
      el('span.label', { text: 'Foto' }),
      el('div.photo-editor', {}, [
        preview,
        el('div.photo-editor__buttons', {}, [
          el('button.btn', { type: 'button', text: '📁 Datei wählen', onClick: () => fileInput.click() }),
          el('button.btn', { type: 'button', text: '📷 Foto aufnehmen', onClick: () => cameraInput.click() }),
          el('button.btn.btn--ghost', {
            type: 'button', text: 'Foto entfernen',
            onClick: () => { pendingPhoto = null; renderPreview(); },
          }),
        ]),
      ]),
      fileInput, cameraInput,
      el('p.hint', { text: 'Fotos werden nur auf diesem Gerät gespeichert und automatisch auf ein Quadrat zugeschnitten.' }),
    ]),
    el('button', { type: 'submit', hidden: true }),
  ]);

  async function save() {
    const fn = firstName.value.trim();
    const ln = lastName.value.trim();
    if (!fn && !ln) { toast('Bitte mindestens einen Namen eingeben.', 'error'); firstName.focus(); return; }
    if (isNew) {
      await store.createStudent({
        classId, firstName: fn, lastName: ln,
        photo: pendingPhoto === undefined ? null : pendingPhoto,
      });
      toast('Schüler:in angelegt', 'success');
    } else {
      const patch = { firstName: fn, lastName: ln };
      if (pendingPhoto !== undefined) patch.photo = pendingPhoto;
      await store.updateStudent(student.id, patch);
      releasePhotoUrl(student.id);
      toast('Änderungen gespeichert', 'success');
    }
    modal.close();
    renderStudents(root, classId);
  }

  const modal = openModal({
    title: isNew ? 'Neue:r Schüler:in' : 'Schüler:in bearbeiten',
    body: form,
    actions: [
      el('button.btn', { type: 'button', text: 'Abbrechen', onClick: () => modal.close() }),
      el('button.btn.btn--primary', { type: 'button', text: 'Speichern', onClick: save }),
    ],
    onClose: () => { if (previewUrl) URL.revokeObjectURL(previewUrl); },
  });
  firstName.focus();
}

/* ------------------------------------------------------------ Foto-Import */

/** Öffnet die Dateiauswahl für mehrere Fotos auf einmal. */
function pickPhotos(root, classId) {
  const input = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  input.addEventListener('change', async () => {
    const files = [...(input.files || [])];
    input.remove();
    if (files.length) await importPhotos(root, classId, files);
  });
  document.body.append(input);
  input.click();
}

/**
 * Legt aus den gewählten Bildern direkt Schüler:innen an – der Name kommt
 * aus dem Dateinamen. Bereits vorhandene Namen werden übersprungen, damit ein
 * versehentlich doppelter Import die Klasse nicht verdoppelt.
 */
async function importPhotos(root, classId, files) {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!images.length) {
    toast('Keine Bilddateien ausgewählt.', 'error');
    return;
  }

  // Bestehende Namen merken, um Doppelte zu erkennen
  const existing = await store.listStudents(classId);
  const known = new Set(existing.map((s) => nameKey(s.firstName, s.lastName)));

  const label = el('p.progress__label', { text: `0 von ${images.length}` });
  const bar = el('div.progress__bar', { style: { width: '0%' } });
  const modal = openModal({
    title: 'Fotos importieren',
    body: el('div', {}, [
      el('p.panel__text', { text: 'Die Fotos werden zugeschnitten und den Namen aus den Dateinamen zugeordnet.' }),
      el('div.progress', {}, [bar]),
      label,
    ]),
  });

  let created = 0;
  /** @type {string[]} */
  const skipped = [];
  /** @type {string[]} */
  const unnamed = [];
  /** @type {string[]} */
  const failed = [];

  for (const [index, file] of images.entries()) {
    label.textContent = `${index + 1} von ${images.length} · ${file.name}`;
    bar.style.width = `${Math.round((index / images.length) * 100)}%`;
    /*
     * Kurz an den Browser abgeben, damit der Fortschritt sichtbar wird.
     * Bewusst setTimeout statt requestAnimationFrame: Letzteres pausiert in
     * Hintergrund-Tabs, der Import bliebe beim Wegklicken stehen.
     */
    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      const { firstName, lastName } = parseNameFromFilename(file.name);
      if (!firstName && !lastName) { unnamed.push(file.name); continue; }

      const key = nameKey(firstName, lastName);
      if (known.has(key)) { skipped.push([firstName, lastName].filter(Boolean).join(' ')); continue; }

      const photo = await processPhoto(file);
      await store.createStudent({ classId, firstName, lastName, photo });
      known.add(key);
      created += 1;
    } catch {
      failed.push(file.name);
    }
  }

  modal.close();
  await renderStudents(root, classId);

  if (!skipped.length && !unnamed.length && !failed.length) {
    toast(`${created} Schüler:innen angelegt`, 'success');
    return;
  }
  showImportReport({ created, skipped, unnamed, failed });
}

/** Vergleichsschlüssel für Namen – unabhängig von Groß-/Kleinschreibung. */
function nameKey(firstName, lastName) {
  return `${(lastName || '').toLowerCase()}|${(firstName || '').toLowerCase()}`;
}

/** Zeigt nach dem Import, was nicht glatt lief. */
function showImportReport({ created, skipped, unnamed, failed }) {
  const section = (title, items, hint) => (items.length
    ? el('div.report-block', {}, [
      el('p.label', { text: `${title} (${items.length})` }),
      el('ul.bullets', {}, items.slice(0, 12).map((t) => el('li', { text: t }))),
      items.length > 12 ? el('p.hint', { text: `… und ${items.length - 12} weitere` }) : null,
      hint ? el('p.hint', { text: hint }) : null,
    ])
    : null);

  const modal = openModal({
    title: 'Import abgeschlossen',
    body: el('div.report', {}, [
      el('p.panel__text', {
        text: created
          ? `${created} Schüler:in(nen) neu angelegt.`
          : 'Es wurde niemand neu angelegt.',
      }),
      section('Übersprungen – Name gibt es schon', skipped,
        'Diese Fotos wurden nicht importiert. Bestehende Einträge bleiben unverändert.'),
      section('Kein Name erkennbar', unnamed,
        'Dateien am besten als NACHNAME_VORNAME.jpg benennen und erneut importieren.'),
      section('Fehlgeschlagen', failed,
        'Diese Dateien konnten nicht gelesen werden.'),
    ]),
    actions: [
      el('button.btn.btn--primary', { type: 'button', text: 'Verstanden', onClick: () => modal.close() }),
    ],
  });
}

async function removeStudent(root, classId, student) {
  const grades = await store.listGradesOfStudent(student.id);
  const ok = await confirmDialog({
    title: 'Schüler:in löschen?',
    message: `${store.fullName(student)} wird mit Foto und ${grades.length} Einzelnote(n) unwiderruflich gelöscht.`,
    confirmLabel: 'Endgültig löschen',
  });
  if (!ok) return;
  await store.deleteStudent(student.id);
  releasePhotoUrl(student.id);
  toast('Schüler:in gelöscht');
  renderStudents(root, classId);
}
