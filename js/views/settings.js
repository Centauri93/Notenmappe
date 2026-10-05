/** Einstellungen: Datensicherung (Export/Import), Passwortschutz, Datenschutz. */

import * as backup from '../backup.js';
import * as security from '../security.js';
import * as store from '../store.js';
import { el, clear, toast, confirmDialog, openModal, promptDialog, formatDateTime } from '../ui.js';

export async function renderSettings(root) {
  clear(root);
  const s = await backup.stats();
  const protectionActive = await security.isConfigured();

  root.append(
    el('div.page-head', {}, [
      el('div', {}, [
        el('h1.page-title', { text: 'Einstellungen' }),
        el('p.page-sub', { text: 'Datensicherung und Geräteabgleich' }),
      ]),
    ]),

    el('section.panel.panel--accent', {}, [
      el('h2.panel__title', { text: 'Datensicherung' }),
      el('p.panel__text', {
        text: 'Die Sicherungsdatei enthält alle Klassen, Schüler:innen, Fotos, Stunden und Noten. '
          + 'Sie ist der einzige Weg, Daten zwischen Mac und iPad zu übertragen – es gibt bewusst keine Cloud.',
      }),
      el('div.panel__actions', {}, [
        el('button.btn.btn--primary.btn--lg', { type: 'button', text: '⬇ Sicherung exportieren', onClick: doExport }),
        el('button.btn.btn--lg', { type: 'button', text: '⬆ Sicherung importieren', onClick: pickImport }),
      ]),
      el('p.hint', {
        text: protectionActive
          ? 'Die Sicherung ist wie deine Daten auf dem Gerät passwortgeschützt. Tipp: Datei in einem iCloud-Drive-Ordner ablegen, dann automatisch auf allen Geräten verfügbar – zum Nutzen dort trotzdem importieren.'
          : 'Tipp: Die Datei per AirDrop, Mail, USB oder einen iCloud-Drive-Ordner auf das andere Gerät bringen und dort importieren.',
      }),
    ]),

    renderSecurityPanel(),

    el('section.panel', {}, [
      el('h2.panel__title', { text: 'Daten auf diesem Gerät' }),
      el('dl.stats', {}, [
        stat('Klassen', s.classes),
        stat('Schüler:innen', s.students),
        stat('Abgeschlossene Stunden', s.sessions),
        stat('Laufende Stunden', s.openSessions),
        stat('Einzelnoten', s.grades),
        stat('Notenbesprechungen', s.conferences),
        stat('Fotos', formatBytes(s.photoBytes)),
      ]),
    ]),

    el('section.panel', {}, [
      el('h2.panel__title', { text: 'Datenschutz' }),
      el('ul.bullets', {}, [
        el('li', { text: 'Alle Daten liegen ausschließlich im Speicher dieses Browsers (IndexedDB).' }),
        el('li', { text: 'Es gibt keinen Server, keinen Login und keine Übertragung ins Internet.' }),
        el('li', { text: 'Wird der Browser-Speicher gelöscht, sind auch die Noten weg – regelmäßig sichern!' }),
      ]),
    ]),

    el('section.panel.panel--danger', {}, [
      el('h2.panel__title', { text: 'Alle Daten löschen' }),
      el('p.panel__text', { text: 'Entfernt sämtliche Klassen, Schüler:innen, Fotos, Noten und den Passwortschutz von diesem Gerät. Nicht umkehrbar.' }),
      el('button.btn.btn--danger', { type: 'button', text: 'Alles unwiderruflich löschen', onClick: doWipe }),
    ]),
  );

  function stat(label, value) {
    return el('div.stats__item', {}, [
      el('dt', { text: label }),
      el('dd', { text: String(value) }),
    ]);
  }

  /* -------------------------------------------------------------- Passwortschutz */

  function renderSecurityPanel() {
    if (!protectionActive) {
      return el('section.panel', {}, [
        el('h2.panel__title', { text: 'Passwortschutz' }),
        el('p.panel__text', {
          text: 'Die App ist aktuell nicht gesperrt – jede Person mit Zugriff auf dieses Gerät kann Klassen, '
            + 'Fotos und Noten sehen. Mit einem Passwort werden die Daten zusätzlich verschlüsselt gespeichert.',
        }),
        el('button.btn.btn--lg', { type: 'button', text: '🔒 Passwortschutz einrichten', onClick: setupProtection }),
      ]);
    }
    return el('section.panel', {}, [
      el('h2.panel__title', { text: 'Passwortschutz' }),
      el('p.panel__text', {
        text: 'Aktiv – beim Öffnen der App ist ein Passwort nötig, Namen, Fotos, Noten und Bemerkungen sind '
          + 'verschlüsselt gespeichert.',
      }),
      el('p.hint', { text: 'Es gibt keine Passwort-Wiederherstellung. Geht das Passwort verloren, sind die Daten unwiderruflich unlesbar.' }),
      el('div.panel__actions', {}, [
        el('button.btn', { type: 'button', text: 'Passwort ändern', onClick: changeProtectionPassword }),
        el('button.btn.btn--danger-ghost', { type: 'button', text: 'Passwortschutz entfernen', onClick: disableProtection }),
      ]),
    ]);
  }

  function setupProtection() {
    const pw1 = el('input.input', { type: 'password', id: 'pw-new', autocomplete: 'new-password' });
    const pw2 = el('input.input', { type: 'password', id: 'pw-new2', autocomplete: 'new-password' });
    const errorMsg = el('p.lock-error');
    const form = el('form.form', { onSubmit: (ev) => { ev.preventDefault(); submit(); } }, [
      el('p.panel__text', {
        text: 'Dieses Passwort gilt für die App-Sperre und die Verschlüsselung. Verwende auf allen deinen Geräten '
          + '(iMac, MacBook, iPad) dasselbe Passwort, damit importierte Sicherungen entschlüsselt werden können.',
      }),
      el('div.form-field', {}, [el('label.label', { for: 'pw-new', text: 'Neues Passwort' }), pw1]),
      el('div.form-field', {}, [el('label.label', { for: 'pw-new2', text: 'Passwort wiederholen' }), pw2]),
      errorMsg,
      el('p.hint', { text: 'Mindestens 2 Zeichen. Kein Vergessen möglich – notiere es dir an einem sicheren Ort.' }),
      el('button', { type: 'submit', hidden: true }),
    ]);

    const modal = openModal({
      title: 'Passwortschutz einrichten',
      body: form,
      actions: [
        el('button.btn', { type: 'button', text: 'Abbrechen', onClick: () => modal.close() }),
        el('button.btn.btn--primary', { type: 'button', text: 'Einrichten', onClick: submit }),
      ],
    });

    async function submit() {
      errorMsg.textContent = '';
      if (pw1.value.length < 2) { errorMsg.textContent = 'Mindestens 2 Zeichen.'; return; }
      if (pw1.value !== pw2.value) { errorMsg.textContent = 'Passwörter stimmen nicht überein.'; return; }
      try {
        await security.setup(pw1.value, (key) => store.encryptAllData(key));
        modal.close();
        toast('Passwortschutz eingerichtet – Daten sind jetzt verschlüsselt', 'success');
        window.dispatchEvent(new CustomEvent('security:changed'));
        renderSettings(root);
      } catch (err) {
        errorMsg.textContent = err.message || 'Einrichtung fehlgeschlagen.';
      }
    }
    pw1.focus();
  }

  function changeProtectionPassword() {
    const pwOld = el('input.input', { type: 'password', id: 'pw-old', autocomplete: 'current-password' });
    const pw1 = el('input.input', { type: 'password', id: 'pw-change-new', autocomplete: 'new-password' });
    const pw2 = el('input.input', { type: 'password', id: 'pw-change-new2', autocomplete: 'new-password' });
    const errorMsg = el('p.lock-error');
    const form = el('form.form', { onSubmit: (ev) => { ev.preventDefault(); submit(); } }, [
      el('div.form-field', {}, [el('label.label', { for: 'pw-old', text: 'Aktuelles Passwort' }), pwOld]),
      el('div.form-field', {}, [el('label.label', { for: 'pw-change-new', text: 'Neues Passwort' }), pw1]),
      el('div.form-field', {}, [el('label.label', { for: 'pw-change-new2', text: 'Neues Passwort wiederholen' }), pw2]),
      errorMsg,
      el('p.hint', { text: 'Denk daran, das neue Passwort auch auf deinen anderen Geräten zu verwenden.' }),
      el('button', { type: 'submit', hidden: true }),
    ]);

    const modal = openModal({
      title: 'Passwort ändern',
      body: form,
      actions: [
        el('button.btn', { type: 'button', text: 'Abbrechen', onClick: () => modal.close() }),
        el('button.btn.btn--primary', { type: 'button', text: 'Ändern', onClick: submit }),
      ],
    });

    async function submit() {
      errorMsg.textContent = '';
      if (pw1.value.length < 2) { errorMsg.textContent = 'Mindestens 2 Zeichen.'; return; }
      if (pw1.value !== pw2.value) { errorMsg.textContent = 'Neue Passwörter stimmen nicht überein.'; return; }
      try {
        await security.changePassword(pwOld.value, pw1.value, (oldKey, newKey) => store.reencryptAllData(oldKey, newKey));
        modal.close();
        toast('Passwort geändert', 'success');
      } catch (err) {
        errorMsg.textContent = err.message || 'Ändern fehlgeschlagen.';
      }
    }
    pwOld.focus();
  }

  async function disableProtection() {
    const password = await promptDialog({
      title: 'Passwortschutz entfernen',
      label: 'Aktuelles Passwort zur Bestätigung',
      type: 'password',
      confirmLabel: 'Entfernen',
    });
    if (!password) return;
    try {
      await security.removeProtection(password, (key) => store.decryptAllData(key));
      toast('Passwortschutz entfernt – Daten sind jetzt unverschlüsselt', 'success');
      window.dispatchEvent(new CustomEvent('security:changed'));
      renderSettings(root);
    } catch (err) {
      toast(err.message || 'Entfernen fehlgeschlagen.', 'error');
    }
  }

  /* ---------------------------------------------------------------- Export/Import */

  async function doExport() {
    try {
      const blob = await backup.exportBackup();
      backup.downloadBlob(blob, await backup.backupFilename());
      toast('Sicherung erstellt', 'success');
    } catch (err) {
      toast(err.message || 'Export fehlgeschlagen.', 'error');
    }
  }

  function pickImport() {
    const input = el('input', { type: 'file', accept: '.zip,.notenbackup,application/zip', hidden: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      await readAndShowImport(file);
    });
    document.body.append(input);
    input.click();
  }

  /** Liest die Datei; fragt bei Bedarf nach dem Passwort und wiederholt. */
  async function readAndShowImport(file, password) {
    try {
      const data = await backup.readBackup(file, password);
      showImportDialog(data);
    } catch (err) {
      if (err.code === 'NEEDS_PASSWORD' || err.code === 'WRONG_PASSWORD') {
        const pw = await promptDialog({
          title: 'Sicherung ist passwortgeschützt',
          label: err.code === 'WRONG_PASSWORD' ? 'Falsches Passwort – erneut versuchen' : 'Passwort',
          type: 'password',
          confirmLabel: 'Entsperren',
        });
        if (pw) await readAndShowImport(file, pw);
        return;
      }
      toast(err.message || 'Datei konnte nicht gelesen werden.', 'error');
    }
  }

  function showImportDialog(data) {
    const c = data.payload.counts || {};
    const exportedAt = data.payload.exportedAt ? formatDateTime(Date.parse(data.payload.exportedAt)) : 'unbekannt';

    const modal = openModal({
      title: 'Sicherung importieren',
      body: el('div', {}, [
        el('p.panel__text', { text: `Erstellt am ${exportedAt}` }),
        el('ul.bullets', {}, [
          el('li', { text: `${c.classes ?? '?'} Klassen` }),
          el('li', { text: `${c.students ?? '?'} Schüler:innen (${data.photos.size} Fotos)` }),
          el('li', { text: `${c.sessions ?? '?'} Stunden` }),
          el('li', { text: `${c.grades ?? '?'} Einzelnoten` }),
          el('li', { text: `${c.conferences ?? 0} Notenbesprechungen` }),
        ]),
        el('p.hint', {
          text: 'Ersetzen löscht die aktuellen Daten dieses Geräts vollständig. '
            + 'Zusammenführen behält vorhandene Daten und aktualisiert gleiche Einträge aus der Sicherung.',
        }),
      ]),
      actions: [
        el('button.btn', { type: 'button', text: 'Abbrechen', onClick: () => modal.close() }),
        el('button.btn', { type: 'button', text: 'Zusammenführen', onClick: () => run('merge') }),
        el('button.btn.btn--danger', { type: 'button', text: 'Alles ersetzen', onClick: () => run('replace') }),
      ],
    });

    async function run(mode) {
      if (mode === 'replace') {
        const ok = await confirmDialog({
          title: 'Daten ersetzen?',
          message: 'Alle aktuell auf diesem Gerät gespeicherten Klassen, Schüler:innen und Noten werden gelöscht und durch die Sicherung ersetzt.',
          confirmLabel: 'Ersetzen',
        });
        if (!ok) return;
      }
      try {
        await backup.applyBackup(data, mode);
        modal.close();
        toast('Sicherung importiert', 'success');
        renderSettings(root);
      } catch (err) {
        toast(err.message || 'Import fehlgeschlagen.', 'error');
      }
    }
  }

  async function doWipe() {
    const ok = await confirmDialog({
      title: 'Wirklich alles löschen?',
      message: 'Sämtliche Klassen, Schüler:innen, Fotos, Noten und der Passwortschutz werden von diesem Gerät entfernt. Erstelle vorher eine Sicherung, falls du die Daten noch brauchst.',
      confirmLabel: 'Alles löschen',
    });
    if (!ok) return;
    await backup.wipeAll();
    toast('Alle Daten gelöscht');
    window.dispatchEvent(new CustomEvent('security:changed'));
    renderSettings(root);
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1).replace('.', ',')} MB` : `${Math.round(bytes / 1024)} KB`;
}
