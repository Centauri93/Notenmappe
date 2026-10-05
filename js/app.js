/** Hash-Router und App-Start. */

import { openDB } from './db.js';
import { el, clear, toast, closeAllOverlays } from './ui.js';
import * as security from './security.js';
import * as store from './store.js';
import { renderLock } from './views/lock.js';
import { renderClasses } from './views/classes.js';
import { renderStudents } from './views/students.js';
import { renderSeating } from './views/seating.js';
import { renderTable } from './views/table.js';
import { renderConferences, renderConference } from './views/conferences.js';
import { renderConferenceStudent } from './views/conferencestudent.js';
import { renderSettings } from './views/settings.js';

const app = document.getElementById('app');
const lockBtn = document.getElementById('lock-btn');

/** @type {{pattern: RegExp, run: (root: HTMLElement, ...args: string[]) => Promise<void>}[]} */
const routes = [
  { pattern: /^#\/classes$/, run: (root) => renderClasses(root) },
  { pattern: /^#\/class\/([^/]+)\/students$/, run: (root, id) => renderStudents(root, id) },
  { pattern: /^#\/class\/([^/]+)\/seating$/, run: (root, id) => renderSeating(root, id) },
  { pattern: /^#\/class\/([^/]+)\/table$/, run: (root, id) => renderTable(root, id) },
  { pattern: /^#\/class\/([^/]+)\/conferences$/, run: (root, id) => renderConferences(root, id) },
  {
    pattern: /^#\/class\/([^/]+)\/conference\/([^/]+)$/,
    run: (root, id, confId) => renderConference(root, id, confId),
  },
  {
    pattern: /^#\/class\/([^/]+)\/conference\/([^/]+)\/([^/]+)$/,
    run: (root, id, confId, studentId) => renderConferenceStudent(root, id, confId, studentId),
  },
  { pattern: /^#\/settings$/, run: (root) => renderSettings(root) },
];

async function route() {
  const hash = location.hash || '#/classes';
  const match = routes
    .map((r) => ({ r, m: hash.match(r.pattern) }))
    .find(({ m }) => m);

  // Laufende Ansicht darf aufräumen (z.B. ResizeObserver im Sitzplan)
  app.dispatchEvent(new CustomEvent('view:teardown'));
  closeAllOverlays();

  if (!match) { location.hash = '#/classes'; return; }

  updateNav(hash);
  try {
    await match.r.run(app, ...match.m.slice(1));
  } catch (err) {
    console.error(err);
    clear(app).append(el('div.empty', {}, [
      el('p', { text: 'Diese Ansicht konnte nicht geladen werden.' }),
      el('p.hint', { text: String(err?.message || err) }),
      el('a.btn.btn--primary', { href: '#/classes', text: 'Zur Klassenübersicht' }),
    ]));
  }
  window.scrollTo(0, 0);
}

function updateNav(hash) {
  for (const link of document.querySelectorAll('.topnav__link')) {
    const target = link.getAttribute('href');
    const active = target === '#/settings' ? hash.startsWith('#/settings') : !hash.startsWith('#/settings');
    link.classList.toggle('topnav__link--active', active);
  }
}

/** Zeigt den „Sperren“-Knopf nur, wenn auf diesem Gerät ein Passwort eingerichtet ist. */
async function updateLockButton() {
  lockBtn.hidden = !(await security.isConfigured());
}

/**
 * Routet nur, wenn kein Passwortschutz aktiv ist oder er bereits entsperrt
 * wurde – sonst wird stattdessen der Sperrbildschirm gezeigt.
 */
async function guardedRoute() {
  await updateLockButton();
  if ((await security.isConfigured()) && !security.isUnlocked()) {
    app.dispatchEvent(new CustomEvent('view:teardown'));
    closeAllOverlays();
    renderLock(app, () => { updateLockButton(); route(); });
    return;
  }
  await route();
}

lockBtn.addEventListener('click', () => {
  security.lock();
  guardedRoute();
});

// Wird ausgelöst, wenn in den Einstellungen der Passwortschutz ein-/ausgeschaltet wird
window.addEventListener('security:changed', updateLockButton);

async function start() {
  try {
    await openDB();
    await store.alignGradeTimes();
    await store.migratePhotoBlobs();
  } catch (err) {
    clear(app).append(el('div.empty', {}, [
      el('p', { text: 'Der lokale Speicher (IndexedDB) ist nicht verfügbar.' }),
      el('p.hint', { text: 'Im privaten Modus mancher Browser ist er gesperrt. Bitte ein normales Fenster verwenden.' }),
    ]));
    return;
  }

  window.addEventListener('hashchange', guardedRoute);
  await guardedRoute();

  // Dauerhafte Speicherung anfragen, damit der Browser die Daten nicht verwirft
  if (navigator.storage?.persist) {
    navigator.storage.persisted().then((already) => { if (!already) navigator.storage.persist(); });
  }

  // Mit ?nosw in der Adresse bleibt der Offline-Cache aus (praktisch beim Entwickeln)
  if ('serviceWorker' in navigator && !location.search.includes('nosw')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Offline-Betrieb ist dann eingeschränkt, die App funktioniert trotzdem
    });
  }
}

window.addEventListener('unhandledrejection', (ev) => {
  console.error(ev.reason);
  toast(ev.reason?.message || 'Unerwarteter Fehler', 'error');
});

start();
