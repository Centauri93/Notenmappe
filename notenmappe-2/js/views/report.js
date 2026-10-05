/**
 * Druck-/PDF-Ansicht für den schnellen Notenbericht.
 *
 * Statt einer PDF-Bibliothek wird die Druckfunktion des Browsers genutzt:
 * Safari/Chrome bieten im Druckdialog „Als PDF sichern“. Das erzeugt
 * scharfe, auswählbare Schrift und braucht keinerlei Abhängigkeiten.
 *
 * Der Seitenumbruch bleibt dem Browser überlassen – ein Blatt ist so lang
 * wie sein Inhalt.
 */

import * as store from '../store.js';
import { el } from '../ui.js';
import { openPrintPreview } from './printpreview.js';
import {
  loadReportData, identityHead, sectionHead, resultBlock,
  gradesTable, gradesFoot,
} from './reportparts.js';

/**
 * @param {{
 *   cls: import('../store.js').Klasse,
 *   students: import('../store.js').Schueler[],
 *   scope: 'class'|'student',
 *   range: {from: number, to: number},
 * }} opts
 */
export async function openReport({ cls, students, scope, range }) {
  const { rangeLabel, gradesOf, printed } = await loadReportData({ cls, range });

  const sheets = students.map((student) => {
    const grades = gradesOf(student.id);
    const stats = store.average(grades);

    return el('section.sheet', {}, [
      identityHead({ student, cls, rangeLabel }),

      // Abschnitt: Sonstige Leistungen (mündliche Mitarbeit)
      el('section.sheet__section', {}, [
        sectionHead('Sonstige Leistungen', resultBlock({
          label: 'Mündliche Note',
          value: store.formatAverage(stats.average),
          note: stats.rounded ? `gerundet: ${stats.rounded}` : 'noch keine Noten',
        })),
        gradesTable(grades),
        gradesFoot(stats, printed),
      ]),
    ]);
  });

  openPrintPreview({
    title: scope === 'class'
      ? `Notenübersicht – ${cls.name}`
      : `Notenübersicht – ${store.fullName(students[0])}`,
    pages: sheets,
  });
}
