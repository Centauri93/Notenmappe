/** Klassenübersicht: anlegen, umbenennen, duplizieren, archivieren, löschen. */

import * as store from '../store.js';
import { el, clear, toast, confirmDialog, promptDialog, formatDate } from '../ui.js';

/**
 * @param {HTMLElement} root
 */
export async function renderClasses(root) {
  clear(root);
  const classes = await store.listClasses({ archived: false });
  const archivedCount = (await store.listClasses({ archived: true })).length;

  root.append(
    el('div.page-head', {}, [
      el('div', {}, [
        el('h1.page-title', { text: 'Klassen' }),
        el('p.page-sub', {
          text: classes.length
            ? `${classes.length} ${classes.length === 1 ? 'Klasse' : 'Klassen'}`
            : 'Noch keine Klasse angelegt.',
        }),
      ]),
      el('div.page-head__actions', {}, [
        archivedCount
          ? el('a.btn', { href: '#/archive', text: `🗄 Archiv (${archivedCount})` })
          : null,
        el('button.btn.btn--primary', { type: 'button', text: '+ Neue Klasse', onClick: () => addClass(root) }),
      ]),
    ]),
  );

  if (!classes.length) {
    root.append(el('div.empty', {}, [
      el('p', { text: 'Lege deine erste Klasse an, um Schüler:innen und Sitzplan einzurichten.' }),
      el('button.btn.btn--primary', { type: 'button', text: '+ Neue Klasse', onClick: () => addClass(root) }),
    ]));
    return;
  }

  const grid = el('div.class-grid');
  for (const cls of classes) {
    const [students, sessions] = await Promise.all([
      store.listStudents(cls.id),
      store.listSessions(cls.id),
    ]);
    const closed = sessions.filter((s) => s.closedAt !== null);
    const open = sessions.find((s) => s.closedAt === null);

    grid.append(el('article.class-card', {}, [
      el('button.class-card__main', {
        type: 'button',
        onClick: () => { location.hash = `#/class/${cls.id}/seating`; },
      }, [
        el('h2.class-card__name', { text: cls.name }),
        el('p.class-card__meta', {
          text: `${students.length} Schüler:innen · ${closed.length} abgeschlossene Stunden`,
        }),
        open ? el('span.badge.badge--open', { text: 'Stunde läuft' }) : null,
        el('p.class-card__date', { text: `Angelegt am ${formatDate(cls.createdAt)}` }),
      ]),
      el('div.class-card__actions', {}, [
        el('a.btn.btn--ghost', { href: `#/class/${cls.id}/students`, text: 'Schüler:innen' }),
        el('a.btn.btn--ghost', { href: `#/class/${cls.id}/table`, text: 'Noten' }),
        el('button.btn.btn--ghost', {
          type: 'button', text: 'Umbenennen', onClick: () => rename(root, cls),
        }),
        el('button.btn.btn--ghost', {
          type: 'button', text: 'Duplizieren',
          title: 'Kopie mit allen Schüler:innen und Fotos – ohne Noten',
          onClick: () => duplicate(root, cls, students.length),
        }),
        el('button.btn.btn--ghost', {
          type: 'button', text: 'Archivieren',
          title: 'Aus der Übersicht nehmen – alle Daten bleiben erhalten',
          onClick: () => archive(root, cls),
        }),
        el('button.btn.btn--ghost.btn--danger-ghost', {
          type: 'button', text: 'Löschen', onClick: () => remove(root, cls, students.length),
        }),
      ]),
    ]));
  }
  root.append(grid);
}

async function addClass(root) {
  const name = await promptDialog({
    title: 'Neue Klasse',
    label: 'Name der Klasse',
    placeholder: 'z.B. 8b Deutsch',
    confirmLabel: 'Anlegen',
  });
  if (!name) return;
  await store.createClass(name);
  toast(`Klasse „${name}“ angelegt`, 'success');
  renderClasses(root);
}

async function rename(root, cls) {
  const name = await promptDialog({
    title: 'Klasse umbenennen',
    label: 'Name der Klasse',
    value: cls.name,
  });
  if (!name || name === cls.name) return;
  await store.renameClass(cls.id, name);
  toast('Klasse umbenannt', 'success');
  renderClasses(root);
}

/**
 * Kopie der Klasse für ein zweites Fach: Schüler:innen, Fotos und Sitzordnung
 * kommen mit, Noten und Besprechungen nicht.
 */
async function duplicate(root, cls, studentCount) {
  const name = await promptDialog({
    title: 'Klasse duplizieren',
    label: `Name der Kopie – übernommen werden ${studentCount} Schüler:in(nen) mit Fotos und Sitzordnung, keine Noten.`,
    value: `${cls.name} `,
    placeholder: 'z.B. CT 24 Chemie',
    confirmLabel: 'Duplizieren',
  });
  if (!name) return;
  try {
    const copy = await store.duplicateClass(cls.id, name);
    toast(`Klasse „${copy.name}“ angelegt`, 'success');
    renderClasses(root);
  } catch (err) {
    toast(err.message || 'Duplizieren fehlgeschlagen', 'error');
  }
}

async function archive(root, cls) {
  await store.setClassArchived(cls.id, true);
  toast(`„${cls.name}“ archiviert – unter „Archiv“ jederzeit wieder erreichbar`);
  renderClasses(root);
}

async function remove(root, cls, studentCount) {
  const ok = await confirmDialog({
    title: 'Klasse löschen?',
    message: `„${cls.name}“ wird mit ${studentCount} Schüler:in(nen), allen Fotos, Stunden und Noten unwiderruflich gelöscht.`,
    confirmLabel: 'Endgültig löschen',
  });
  if (!ok) return;
  await store.deleteClass(cls.id);
  toast('Klasse gelöscht');
  renderClasses(root);
}

/* ------------------------------------------------------------------ Archiv */

/**
 * Archivierte Klassen als Tabelle: alles bleibt erhalten und lässt sich
 * öffnen, wiederherstellen oder endgültig löschen.
 */
export async function renderArchive(root) {
  clear(root);
  const classes = (await store.listClasses({ archived: true }))
    .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));

  root.append(el('div.page-head', {}, [
    el('div', {}, [
      el('a.back-link', { href: '#/classes', text: '‹ Klassen' }),
      el('h1.page-title', { text: 'Archiv' }),
      el('p.page-sub', {
        text: classes.length
          ? `${classes.length} archivierte ${classes.length === 1 ? 'Klasse' : 'Klassen'} – alle Daten sind erhalten.`
          : 'Keine archivierten Klassen.',
      }),
    ]),
  ]));

  if (!classes.length) {
    root.append(el('div.empty', {}, [
      el('p', { text: 'Archivierte Klassen erscheinen hier. Archivieren nimmt eine Klasse nur aus der Übersicht – Noten, Fotos und Besprechungen bleiben.' }),
      el('a.btn.btn--primary', { href: '#/classes', text: 'Zur Klassenübersicht' }),
    ]));
    return;
  }

  const rows = [];
  for (const cls of classes) {
    const [students, sessions] = await Promise.all([store.listStudents(cls.id), store.listSessions(cls.id)]);
    rows.push(el('tr', {}, [
      el('td.archive__name', {}, [el('a.archive__link', { href: `#/class/${cls.id}/table`, text: cls.name })]),
      el('td', { text: String(students.length) }),
      el('td', { text: String(sessions.filter((s) => s.closedAt !== null).length) }),
      el('td', { text: cls.archivedAt ? formatDate(cls.archivedAt) : '–' }),
      el('td.archive__actions', {}, [
        el('a.btn.btn--sm', { href: `#/class/${cls.id}/table`, text: 'Öffnen' }),
        el('button.btn.btn--sm.btn--primary', {
          type: 'button', text: 'Wiederherstellen',
          onClick: async () => {
            await store.setClassArchived(cls.id, false);
            toast(`„${cls.name}“ ist wieder in der Übersicht`, 'success');
            renderArchive(root);
          },
        }),
        el('button.btn.btn--sm.btn--ghost.btn--danger-ghost', {
          type: 'button', text: 'Löschen',
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Klasse endgültig löschen?',
              message: `„${cls.name}“ wird mit ${students.length} Schüler:in(nen), allen Fotos, Stunden, Noten und Besprechungen unwiderruflich gelöscht.`,
              confirmLabel: 'Endgültig löschen',
            });
            if (!ok) return;
            await store.deleteClass(cls.id);
            toast('Klasse gelöscht');
            renderArchive(root);
          },
        }),
      ]),
    ]));
  }

  root.append(el('div.table-wrap', {}, [
    el('table.archive', {}, [
      el('thead', {}, [el('tr', {}, [
        el('th', { scope: 'col', text: 'Klasse' }),
        el('th', { scope: 'col', text: 'Schüler:innen' }),
        el('th', { scope: 'col', text: 'Stunden' }),
        el('th', { scope: 'col', text: 'Archiviert am' }),
        el('th', { scope: 'col', text: '' }),
      ])]),
      el('tbody', {}, rows),
    ]),
  ]));
}
