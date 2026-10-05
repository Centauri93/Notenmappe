/**
 * Klassenbuch: je Stunde ein Freitext, was im Unterricht gemacht wurde.
 *
 * Hat bewusst nichts mit Noten, Durchschnitten oder Besprechungen zu tun –
 * es ist eine reine Dokumentation der Stunden. Einträge lassen sich hier
 * auch nachträglich anlegen und ändern.
 */

import * as store from '../store.js';
import { classHeader } from './classnav.js';
import { el, clear, toast, openModal, formatDateWeekday, formatDateTime } from '../ui.js';

export async function renderClassbook(root, classId) {
  const cls = await store.getClass(classId);
  if (!cls) { location.hash = '#/classes'; return; }
  const [sessions, grades] = await Promise.all([store.listSessions(classId), store.listGradesOfClass(classId)]);
  const sorted = [...sessions].sort((a, b) => b.startedAt - a.startedAt);
  const countBySession = new Map();
  for (const g of grades) countBySession.set(g.sessionId, (countBySession.get(g.sessionId) || 0) + 1);

  clear(root);
  const filled = sorted.filter((s) => (s.log || '').trim()).length;
  root.append(classHeader(cls, 'classbook', []));
  root.append(el('div.status', {}, [
    el('span.status__text', {
      text: sorted.length
        ? `${sorted.length} Stunden · ${filled} mit Eintrag · ${sorted.length - filled} ohne`
        : 'Noch keine Stunden – der erste Eintrag im Sitzplan oder Klassenbuch startet eine.',
    }),
  ]));

  if (!sorted.length) {
    root.append(el('div.empty', {}, [
      el('p', { text: 'Das Klassenbuch füllt sich mit jeder Stunde. Einträge legst du im Sitzplan über „📓 Klassenbuch“ an – oder hier, sobald eine Stunde existiert.' }),
      el('a.btn.btn--primary', { href: `#/class/${classId}/seating`, text: 'Zum Sitzplan' }),
    ]));
    return;
  }

  const list = el('ul.logbook');
  for (const s of sorted) {
    const text = (s.log || '').trim();
    const open = s.closedAt === null;
    const n = countBySession.get(s.id) || 0;
    list.append(el('li', {}, [
      el('button.logbook__entry', {
        type: 'button',
        class: text ? '' : 'logbook__entry--empty',
        onClick: () => editLog(s),
      }, [
        el('div.logbook__head', {}, [
          el('span.logbook__date', { text: formatDateWeekday(s.startedAt) }),
          el('span.logbook__meta', { text: `${formatDateTime(s.startedAt).split(', ')[1]} · ${n} Noteneinträge${open ? ' · läuft' : ''}` }),
          open ? el('span.badge.badge--open', { text: 'offen' }) : null,
        ]),
        el('p.logbook__text', { text: text || 'Kein Eintrag – antippen zum Ergänzen' }),
      ]),
    ]));
  }
  root.append(list);

  function editLog(session) {
    const field = el('textarea.textarea.log-field', { id: 'session-log', rows: '6', placeholder: 'Was wurde in dieser Stunde gemacht?' });
    field.value = session.log || '';
    const modal = openModal({
      title: `Klassenbuch – ${formatDateWeekday(session.startedAt)}`,
      body: el('div.form', {}, [
        el('div.form-field', {}, [el('label.label', { for: 'session-log', text: 'Eintrag' }), field]),
        el('p.hint', { text: 'Reine Notiz zur Stunde – ohne Einfluss auf Noten oder Auswertungen.' }),
      ]),
      actions: [
        el('button.btn', { type: 'button', text: 'Abbrechen', onClick: () => modal.close() }),
        el('button.btn.btn--primary', {
          type: 'button', text: 'Speichern',
          onClick: async () => {
            try {
              await store.saveSessionLog(session.id, field.value);
              modal.close();
              toast('Klassenbucheintrag gespeichert', 'success');
              renderClassbook(root, classId);
            } catch (err) {
              toast(err.message || 'Konnte nicht gespeichert werden.', 'error');
            }
          },
        }),
      ],
    });
    field.focus();
  }
}
