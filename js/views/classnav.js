/** Gemeinsame Kopfzeile mit Reiter-Navigation innerhalb einer Klasse. */

import { el } from '../ui.js';

/**
 * @param {{id: string, name: string}} cls
 * @param {'seating'|'students'|'table'|'conferences'|'classbook'} active
 * @param {(Node|null)[]} [actions]  zusätzliche Bedienelemente rechts
 */
export function classHeader(cls, active, actions = []) {
  const tab = (key, label) => el('a.tab', {
    href: `#/class/${cls.id}/${key}`,
    text: label,
    class: key === active ? 'tab--active' : '',
    'aria-current': key === active ? 'page' : null,
  });

  return el('div.page-head.page-head--class', {}, [
    el('div.page-head__left', {}, [
      el('a.back-link', { href: '#/classes', text: '‹ Klassen' }),
      el('h1.page-title', {}, [
        cls.name,
        cls.archivedAt ? el('span.badge.badge--archived', { text: 'archiviert' }) : null,
      ]),
      el('nav.tabs', {}, [
        tab('seating', 'Sitzplan'),
        tab('students', 'Schüler:innen'),
        tab('table', 'Noten'),
        tab('conferences', 'Besprechung'),
        tab('classbook', 'Klassenbuch'),
      ]),
    ]),
    el('div.page-head__actions', {}, actions.filter(Boolean)),
  ]);
}

/**
 * Name auf einer Sitzplan-Karte: Vorname groß in der ersten Zeile (so
 * spricht man die Schüler:innen an), Nachname kleiner darunter.
 */
export function cardName(student) {
  const first = (student.firstName || '').trim();
  const last = (student.lastName || '').trim();
  return el('span.seat-card__name', {}, [
    el('span.seat-card__first', { text: first || last || '—' }),
    first && last ? el('span.seat-card__last', { text: last }) : null,
  ]);
}
