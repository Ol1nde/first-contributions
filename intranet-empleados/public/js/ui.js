// Utilidades de interfaz: creación segura de nodos (sin innerHTML), formatos, etiquetas y diálogos.

export function h(tag, props, ...children) {
  if (props === null || props === undefined || typeof props !== 'object' || Array.isArray(props) || props instanceof Node) {
    if (props !== undefined) children.unshift(props);
    props = {};
  }
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'value') el.value = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of [children].flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

const ICONS = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9v11h14V9', 'M10 20v-6h4v6'],
  users: ['M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 20v-1a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  building: ['M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16', 'M16 9h2a2 2 0 0 1 2 2v10', 'M2 21h20', 'M8 7h4', 'M8 11h4', 'M8 15h4'],
  calendar: ['M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M16 2v4', 'M8 2v4', 'M3 10h18'],
  clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
  megaphone: ['M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z', 'M16 8.5a5 5 0 0 1 0 7', 'M19 5.5a9 9 0 0 1 0 13'],
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  menu: ['M3 6h18', 'M3 12h18', 'M3 18h18'],
  plus: ['M12 5v14', 'M5 12h14'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.35-4.35'],
  edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'],
  key: ['M15 7a4 4 0 1 1-3.87 5H9v2H7v2H4v-3l6.13-6.13A4 4 0 0 1 15 7z'],
  check: ['M20 6 9 17l-5-5'],
  settings: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.73 21a2 2 0 0 1-3.46 0'],
  mail: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M22 6l-10 7L2 6'],
  alert: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4', 'M12 17h.01'],
  x: ['M18 6 6 18', 'M6 6l12 12'],
  pin: ['M12 17v5', 'M9 3h6l-1 6 3 3v2H7v-2l3-3z'],
  cake: ['M4 21h16v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z', 'M4 16c2 1 4 1 6 0s4-1 6 0 3 1 4 0', 'M12 11V8', 'M12 5.5c.8-.8.8-1.7 0-2.5-.8.8-.8 1.7 0 2.5z'],
  sparkle: ['M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4', 'M6 6l2 2', 'M16 16l2 2', 'M6 18l2-2', 'M16 8l2-2'],
};

export function icon(name, className = 'icon') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name] ?? []) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

// ---------- Etiquetas y permisos ----------

export const ROLE_LABELS = { admin: 'Administrador', rrhh: 'RR. HH.', responsable: 'Responsable', empleado: 'Empleado' };
export const STATUS_LABELS = { activo: 'Activo', excedencia: 'Excedencia', baja: 'Baja' };
export const LEAVE_TYPE_LABELS = {
  vacaciones: 'Vacaciones',
  asuntos_propios: 'Asuntos propios',
  baja_medica: 'Baja médica',
  permiso_retribuido: 'Permiso retribuido',
  otro: 'Otro',
};
export const LEAVE_STATUS_LABELS = { pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada', cancelada: 'Cancelada' };
const TONES = {
  activo: 'success', excedencia: 'warning', baja: 'muted',
  pendiente: 'warning', aprobada: 'success', rechazada: 'danger', cancelada: 'muted',
};

export const isHR = (user) => user.role === 'admin' || user.role === 'rrhh';
export const isReviewer = (user) => isHR(user) || user.role === 'responsable';

export function badge(text, tone = 'neutral') {
  return h('span', { class: `badge badge-${tone}` }, text);
}

export function statusBadge(status, labels) {
  return badge(labels[status] ?? status, TONES[status] ?? 'neutral');
}

export const fullName = (e) => `${e.first_name} ${e.last_name}`.trim();

export function avatar(name, size = '') {
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  const el = h('span', { class: `avatar ${size}`, 'aria-hidden': 'true' }, letters || '?');
  el.style.setProperty('--avatar-hue', String(hash));
  return el;
}

// ---------- Formatos ----------

const pad = (n) => String(n).padStart(2, '0');

export function todayLocal(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toDate(value) {
  if (value.length === 10) return new Date(`${value}T12:00:00`);
  // Las fechas de SQLite («AAAA-MM-DD HH:MM:SS») están en UTC.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return new Date(`${value.replace(' ', 'T')}Z`);
  return new Date(value);
}

export function fmtDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(toDate(value));
}

export function fmtLongDate(value) {
  const s = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(toDate(value));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fmtDayMonth(value) {
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(toDate(value));
}

export function fmtTime(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

export function fmtMinutes(minutes) {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}

export function fmtRange(start, end) {
  return start === end ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
}

/** ISO (UTC) → valor para <input type="datetime-local"> en hora local. */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${todayLocal(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function seniority(hireDate) {
  if (!hireDate) return '';
  const start = toDate(hireDate);
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) return 'Incorporación prevista';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years) parts.push(`${years} ${years === 1 ? 'año' : 'años'}`);
  if (rest || !years) parts.push(`${rest} ${rest === 1 ? 'mes' : 'meses'}`);
  return parts.join(' y ');
}

export function debounce(fn, ms = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ---------- Componentes ----------

export function button(label, { variant = 'secondary', size = '', iconName, onClick, type = 'button', title, disabled } = {}) {
  return h('button', { type, class: `btn btn-${variant} ${size ? `btn-${size}` : ''}`.trim(), onclick: onClick, title, disabled },
    iconName ? icon(iconName) : null, label ? h('span', label) : null);
}

export function linkButton(label, href, { variant = 'secondary', iconName, download } = {}) {
  return h('a', { class: `btn btn-${variant}`, href, download }, iconName ? icon(iconName) : null, h('span', label));
}

export function card(title, content, { actions, className = '' } = {}) {
  return h('section', { class: `card ${className}`.trim() },
    title || actions ? h('header', { class: 'card-header' }, title ? h('h2', title) : null, actions ? h('div', { class: 'card-actions' }, actions) : null) : null,
    h('div', { class: 'card-body' }, content));
}

export function pageHeader(title, subtitle, actions) {
  return h('div', { class: 'page-header' },
    h('div', h('h1', title), subtitle ? h('p', { class: 'muted' }, subtitle) : null),
    actions ? h('div', { class: 'page-actions' }, actions) : null);
}

export function emptyState(text) {
  return h('p', { class: 'empty' }, text);
}

export function table(columns, rows, { empty = 'No hay datos que mostrar.' } = {}) {
  if (rows.length === 0) return emptyState(empty);
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'table' },
      h('thead', h('tr', columns.map((c) => h('th', { class: c.className }, c.label)))),
      h('tbody', rows.map((row) => h('tr', columns.map((c) => h('td', { class: c.className, 'data-label': c.label }, c.render(row))))))));
}

let toastHost;
/** Mensaje temporal. Con `href` el aviso es un enlace (p. ej. a un anuncio nuevo). */
export function toast(message, type = 'success', { href, duration = 4000 } = {}) {
  toastHost ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const el = href
    ? h('a', { class: `toast toast-${type} toast-link`, href, onclick: () => el.remove() }, message)
    : h('div', { class: `toast toast-${type}` }, message);
  toastHost.append(el);
  setTimeout(() => el.classList.add('toast-hide'), duration - 400);
  setTimeout(() => el.remove(), duration);
}

export function openDialog({ title, body, footer, wide = false, onClose }) {
  const dialog = h('dialog', { class: `dialog ${wide ? 'dialog-wide' : ''}`.trim(), 'aria-label': title });
  const close = () => dialog.close();
  append(dialog, [
    h('header', { class: 'dialog-header' }, h('h2', title), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cerrar', onclick: close }, icon('x'))),
    h('div', { class: 'dialog-body' }, body),
    footer ? h('footer', { class: 'dialog-footer' }, footer) : null,
  ]);
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.();
  });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, close };
}

export function confirmDialog(message, { title = 'Confirmar', confirmLabel = 'Aceptar', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const { close } = openDialog({
      title,
      body: h('p', message),
      footer: [
        button('Cancelar', { onClick: () => close() }),
        button(confirmLabel, { variant: danger ? 'danger' : 'primary', onClick: () => { result = true; close(); } }),
      ],
      onClose: () => resolve(result),
    });
  });
}

let fieldSeq = 0;

function buildField(field, value) {
  const id = `f-${field.name}-${++fieldSeq}`;
  const error = h('p', { class: 'field-error', id: `${id}-error` });
  const help = field.help ? h('p', { class: 'field-help' }, field.help) : null;
  const common = { id, name: field.name, required: field.required, disabled: field.disabled, 'aria-describedby': `${id}-error` };
  let input;
  if (field.type === 'select') {
    input = h('select', common, field.options.map(([v, label]) =>
      h('option', { value: String(v ?? ''), selected: String(v ?? '') === String(value ?? '') }, label)));
  } else if (field.type === 'textarea') {
    input = h('textarea', { ...common, rows: field.rows ?? 4, maxlength: field.maxlength, value: value ?? '' });
  } else if (field.type === 'checklist') {
    // Selección múltiple con casillas y buscador. Devuelve un array con los valores marcados.
    const selected = new Set((value ?? []).map(String));
    const filter = h('input', { id, type: 'search', placeholder: 'Buscar…', autocomplete: 'off' });
    const count = h('span', { class: 'muted small' });
    const items = field.options.map(([v, label]) => ({
      label: label.toLowerCase(),
      row: h('label', { class: 'checklist-item' }, h('input', { type: 'checkbox', value: String(v), checked: selected.has(String(v)) }), h('span', label)),
    }));
    const list = h('div', { class: 'checklist', role: 'group', 'aria-label': field.label }, items.map((i) => i.row));
    const updateCount = () => { count.textContent = `${list.querySelectorAll('input:checked').length} seleccionados`; };
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      for (const i of items) i.row.hidden = Boolean(q) && !i.label.includes(q);
    });
    list.addEventListener('change', updateCount);
    updateCount();
    input = h('div', { class: 'checklist-wrap', tabindex: '-1' }, h('div', { class: 'checklist-tools' }, filter, count), list);
  } else if (field.type === 'checkbox') {
    input = h('input', { ...common, type: 'checkbox', checked: Boolean(value) });
    return {
      input, error,
      node: h('div', { class: `field field-checkbox ${field.full ? 'field-full' : ''}` }, h('label', { for: id }, input, h('span', field.label)), help, error),
    };
  } else {
    input = h('input', {
      ...common,
      type: field.type ?? 'text',
      value: value ?? '',
      min: field.min,
      max: field.max,
      step: field.step,
      maxlength: field.maxlength,
      minlength: field.minlength,
      placeholder: field.placeholder,
      autocomplete: field.autocomplete ?? 'off',
    });
  }
  const label = h('label', { for: id }, field.label, field.required ? h('span', { class: 'required', 'aria-hidden': 'true' }, ' *') : null);
  return { input, error, node: h('div', { class: `field ${field.full ? 'field-full' : ''}` }, label, input, help, error) };
}

function readField(field, input) {
  if (field.type === 'checkbox') return input.checked;
  if (field.type === 'checklist') {
    return [...input.querySelectorAll('.checklist input:checked')].map((cb) => (field.numeric ? Number(cb.value) : cb.value));
  }
  if (field.type === 'number') return input.value === '' ? null : Number(input.value);
  if (field.type === 'select' && field.numeric) return input.value === '' ? null : Number(input.value);
  return input.value;
}

/**
 * Formulario a partir de una lista de campos. `onSubmit(values)` puede lanzar un ApiError: sus `details`
 * se muestran junto a cada campo. Devuelve el formulario y sus controles (por nombre).
 */
export function buildForm({
  fields, values = {}, submitLabel = 'Guardar', submitVariant = 'primary', intro, onSubmit, onSuccess, onCancel, extraActions,
}) {
  const built = fields.map((f) => ({ field: f, ...buildField(f, values[f.name]) }));
  const formError = h('p', { class: 'form-error', role: 'alert' });
  const submit = button(submitLabel, { variant: submitVariant, type: 'submit' });
  const form = h('form', { class: 'form', novalidate: true },
    intro ? h('p', { class: 'muted' }, intro) : null,
    formError,
    h('div', { class: 'form-grid' }, built.map((b) => b.node)),
    h('div', { class: 'form-actions' }, extraActions, onCancel ? button('Cancelar', { onClick: onCancel }) : null, submit));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.textContent = '';
    for (const b of built) {
      b.error.textContent = '';
      b.input.removeAttribute('aria-invalid');
    }
    const missing = built.find((b) => b.field.required && !['checkbox', 'checklist'].includes(b.field.type) && !String(b.input.value).trim());
    if (missing) {
      missing.error.textContent = `${missing.field.label} es obligatorio`;
      missing.input.setAttribute('aria-invalid', 'true');
      missing.input.focus();
      return;
    }
    const data = Object.fromEntries(built.map((b) => [b.field.name, readField(b.field, b.input)]));
    submit.disabled = true;
    try {
      const result = (await onSubmit(data)) ?? true;
      onSuccess?.(result);
    } catch (err) {
      formError.textContent = err.message;
      for (const [name, message] of Object.entries(err.details ?? {})) {
        const b = built.find((x) => x.field.name === name);
        if (b) {
          b.error.textContent = message;
          b.input.setAttribute('aria-invalid', 'true');
        }
      }
      built.find((b) => b.input.hasAttribute('aria-invalid'))?.input.focus();
    } finally {
      submit.disabled = false;
    }
  });

  return {
    form,
    inputs: Object.fromEntries(built.map((b) => [b.field.name, b.input])),
    values: () => Object.fromEntries(built.map((b) => [b.field.name, readField(b.field, b.input)])),
    focus: () => built[0]?.input.focus(),
  };
}

/** Formulario en diálogo modal. Devuelve el resultado de `onSubmit` o null si se cancela. */
export function formDialog({ title, wide, ...options }) {
  return new Promise((resolve) => {
    let result = null;
    let close = () => {};
    const { form, focus } = buildForm({
      ...options,
      onSuccess: (value) => {
        result = value;
        close();
      },
      onCancel: () => close(),
    });
    ({ close } = openDialog({ title, body: form, wide, onClose: () => resolve(result) }));
    focus();
  });
}
