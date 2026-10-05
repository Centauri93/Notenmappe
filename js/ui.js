/** Kleine DOM- und Dialog-Helfer. Bewusst minimal gehalten. */

/**
 * Erzeugt ein Element.
 * @param {string} tag  z.B. 'div.card.is-active' oder 'button#save'
 * @param {Record<string, any>} [props]  Attribute; `text`, `html`, `on*`, `dataset`, `style`
 * @param {(Node|string|null|false|undefined)[]} [children]
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const node = document.createElement(name || 'div');
  for (const token of rest) {
    if (token[0] === '.') node.classList.add(token.slice(1));
    else if (token[0] === '#') node.id = token.slice(1);
  }
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') node.className += (node.className ? ' ' : '') + value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** @param {HTMLElement} parent @param {...Node} nodes */
export function clear(parent) {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  return parent;
}

/** Kurze Rückmeldung am unteren Bildschirmrand. */
export function toast(message, kind = 'info') {
  let host = document.getElementById('toasts');
  if (!host) {
    host = el('div#toasts');
    document.body.append(host);
  }
  const node = el('div.toast', { class: `toast--${kind}`, text: message, role: 'status' });
  host.append(node);
  setTimeout(() => {
    node.classList.add('toast--out');
    setTimeout(() => node.remove(), 300);
  }, 2600);
}

/**
 * Öffnet ein modales Overlay.
 * @param {{title: string, body: Node, actions?: Node[], onClose?: () => void, wide?: boolean}} opts
 * @returns {{close: () => void, root: HTMLElement}}
 */
export function openModal({ title, body, actions = [], onClose, wide = false }) {
  const previouslyFocused = document.activeElement;

  const dialog = el('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    el('header.modal__head', {}, [
      el('h2.modal__title', { text: title }),
      el('button.icon-btn', { type: 'button', 'aria-label': 'Schließen', onClick: () => close(), text: '✕' }),
    ]),
    el('div.modal__body', {}, [body]),
    actions.length ? el('footer.modal__foot', {}, actions) : null,
  ]);
  if (wide) dialog.classList.add('modal--wide');

  const overlay = el('div.overlay', {
    onClick: (ev) => { if (ev.target === overlay) close(); },
  }, [dialog]);

  function onKey(ev) {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
  }

  function close() {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    if (!document.querySelector('.overlay')) document.body.classList.remove('has-modal');
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true });
    onClose?.();
  }

  document.addEventListener('keydown', onKey, true);
  document.body.classList.add('has-modal');
  overlay.__close = close;
  document.body.append(overlay);
  // Fokus auf das erste sinnvolle Bedienelement legen
  const focusable = dialog.querySelector('input, textarea, select, button:not(.icon-btn)');
  if (focusable instanceof HTMLElement) focusable.focus({ preventScroll: true });

  return { close, root: dialog };
}

/**
 * Schließt alle offenen Dialoge und die Druckvorschau – z.B. beim
 * Wechsel der Ansicht, damit nichts über der neuen Seite stehen bleibt.
 */
export function closeAllOverlays() {
  for (const overlay of document.querySelectorAll('.overlay')) {
    if (typeof overlay.__close === 'function') overlay.__close();
    else overlay.remove();
  }
  const printRoot = document.getElementById('print-root');
  if (printRoot && typeof printRoot.__close === 'function') printRoot.__close();
  document.body.classList.remove('has-modal');
}

/**
 * Ja/Nein-Rückfrage.
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message, confirmLabel = 'Löschen', danger = true }) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (value) => { answered = true; modal.close(); resolve(value); };
    const modal = openModal({
      title,
      body: el('p.modal__text', { text: message }),
      actions: [
        el('button.btn', { type: 'button', text: 'Abbrechen', onClick: () => done(false) }),
        el('button.btn', {
          type: 'button',
          class: danger ? 'btn--danger' : 'btn--primary',
          text: confirmLabel,
          onClick: () => done(true),
        }),
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

/**
 * Einfacher Texteingabe-Dialog.
 * @returns {Promise<string|null>}
 */
export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Speichern', type = 'text' }) {
  return new Promise((resolve) => {
    let answered = false;
    const input = el('input.input', {
      type, value, placeholder, id: 'prompt-input',
      autocomplete: type === 'password' ? 'off' : undefined,
    });
    const form = el('form', {
      onSubmit: (ev) => { ev.preventDefault(); submit(); },
    }, [
      el('label.label', { for: 'prompt-input', text: label }),
      input,
    ]);

    const submit = () => {
      const text = input.value.trim();
      if (!text) { input.focus(); return; }
      answered = true;
      modal.close();
      resolve(text);
    };

    const modal = openModal({
      title,
      body: form,
      actions: [
        el('button.btn', { type: 'button', text: 'Abbrechen', onClick: () => { answered = true; modal.close(); resolve(null); } }),
        el('button.btn.btn--primary', { type: 'button', text: confirmLabel, onClick: submit }),
      ],
      onClose: () => { if (!answered) resolve(null); },
    });
    input.select();
  });
}

/* ------------------------------------------------------------- Formatierung */

const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateShortFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dateWeekdayFmt = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit',
});

export const formatDate = (ts) => dateFmt.format(new Date(ts));
export const formatDateShort = (ts) => dateShortFmt.format(new Date(ts));
export const formatTime = (ts) => timeFmt.format(new Date(ts));
export const formatDateTime = (ts) => `${formatDate(ts)}, ${formatTime(ts)} Uhr`;

/** Kompakt mit Wochentag für den Ausdruck: „Mi, 22.07.26“ */
export const formatDateWeekday = (ts) =>
  dateWeekdayFmt.format(new Date(ts)).replace('.,', ',');

/** yyyy-mm-dd für <input type="date"> */
export function toDateInputValue(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Initialen als Foto-Ersatz. */
export function initials(student) {
  return ((student.firstName?.[0] || '') + (student.lastName?.[0] || '')).toUpperCase() || '?';
}

/* -------------------------------------------------------------- Bild-URLs */

const objectUrls = new Map();

/** Liefert (und cached) eine Object-URL für ein Foto-Blob. */
export function photoUrl(student) {
  if (!student.photo) return null;
  const key = student.id;
  const cached = objectUrls.get(key);
  if (cached && cached.blob === student.photo) return cached.url;
  if (cached) URL.revokeObjectURL(cached.url);
  const url = URL.createObjectURL(student.photo);
  objectUrls.set(key, { blob: student.photo, url });
  return url;
}

/** Gibt eine gecachte Object-URL wieder frei. */
export function releasePhotoUrl(studentId) {
  const cached = objectUrls.get(studentId);
  if (cached) {
    URL.revokeObjectURL(cached.url);
    objectUrls.delete(studentId);
  }
}
