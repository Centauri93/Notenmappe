/** Gemeinsame Kopfzeile mit Reiter-Navigation innerhalb einer Klasse. */

import { el } from '../ui.js';

/**
 * @param {{id: string, name: string}} cls
 * @param {'seating'|'students'|'table'} active
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
      el('h1.page-title', { text: cls.name }),
      el('nav.tabs', {}, [
        tab('seating', 'Sitzplan'),
        tab('students', 'Schüler:innen'),
        tab('table', 'Noten'),
      ]),
    ]),
    el('div.page-head__actions', {}, actions.filter(Boolean)),
  ]);
}
