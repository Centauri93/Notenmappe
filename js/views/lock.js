/** Sperrbildschirm: App-Zugang per Passwort. */

import * as security from '../security.js';
import { el, clear } from '../ui.js';

/**
 * @param {HTMLElement} root
 * @param {() => void} onUnlock  wird nach erfolgreichem Entsperren aufgerufen
 */
export function renderLock(root, onUnlock) {
  clear(root);

  const input = el('input.input.input--lock', {
    type: 'password', id: 'unlock-pw', autocomplete: 'current-password',
    placeholder: 'Passwort',
  });
  const error = el('p.lock-error', { role: 'alert' });
  const submitBtn = el('button.btn.btn--primary.btn--lg.btn--wide', { type: 'submit', text: 'Entsperren' });

  const form = el('form.lock-card', {
    onSubmit: async (ev) => {
      ev.preventDefault();
      const password = input.value;
      if (!password) return;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Prüfe …';
      const ok = await security.unlock(password);
      if (ok) {
        onUnlock();
        return;
      }
      submitBtn.disabled = false;
      submitBtn.textContent = 'Entsperren';
      error.textContent = 'Falsches Passwort.';
      input.select();
      input.focus();
    },
  }, [
    el('span.lock-card__mark', { text: '🔒', 'aria-hidden': 'true' }),
    el('h1.lock-card__title', { text: 'Notenmappe gesperrt' }),
    el('p.lock-card__hint', { text: 'Bitte Passwort eingeben, um Klassen und Noten zu sehen.' }),
    el('label.sr-only', { for: 'unlock-pw', text: 'Passwort' }),
    input,
    error,
    submitBtn,
  ]);

  root.append(el('div.lock-screen', {}, [form]));
  input.focus();
}
