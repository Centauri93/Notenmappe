/** Klassenübersicht: anlegen, umbenennen, löschen. */

import * as store from '../store.js';
import { el, clear, toast, confirmDialog, promptDialog, formatDate } from '../ui.js';

/**
 * @param {HTMLElement} root
 */
export async function renderClasses(root) {
  clear(root);
  const classes = await store.listClasses();

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
      el('button.btn.btn--primary', { type: 'button', text: '+ Neue Klasse', onClick: () => addClass(root) }),
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
