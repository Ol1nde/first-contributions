import { api } from '../api.js';
import { button, h } from '../ui.js';

/** Primer uso: crea la cuenta de administrador cuando la intranet todavía no tiene usuarios. */
export function renderSetup({ onSuccess }) {
  const fields = [
    { name: 'first_name', label: 'Nombre', autocomplete: 'given-name', required: true },
    { name: 'last_name', label: 'Apellidos', autocomplete: 'family-name' },
    { name: 'email', label: 'Email', type: 'email', autocomplete: 'username', required: true },
    { name: 'position', label: 'Puesto', autocomplete: 'organization-title', placeholder: 'Ej.: Responsable de RR. HH.' },
    { name: 'password', label: 'Contraseña (mín. 8 caracteres)', type: 'password', autocomplete: 'new-password', required: true },
    { name: 'confirm', label: 'Repite la contraseña', type: 'password', autocomplete: 'new-password', required: true },
  ];
  const inputs = {};
  const errors = {};
  const formError = h('p', { class: 'form-error', role: 'alert' });
  const submit = button('Crear cuenta y entrar', { variant: 'primary', type: 'submit' });

  const form = h('form', { class: 'login-card setup-card' },
    h('div', { class: 'login-brand' }, h('img', { src: '/img/favicon.svg', alt: '', width: 44, height: 44 }),
      h('div', h('h1', 'Configura tu intranet'), h('p', { class: 'muted' }, 'Crea la cuenta de administrador'))),
    h('p', { class: 'muted small' }, 'Esta cuenta podrá dar de alta al resto de la plantilla, crear departamentos y asignar permisos.'),
    formError,
    fields.map((f) => {
      const id = `setup-${f.name}`;
      inputs[f.name] = h('input', { id, name: f.name, type: f.type ?? 'text', autocomplete: f.autocomplete, placeholder: f.placeholder, required: f.required });
      errors[f.name] = h('p', { class: 'field-error' });
      return h('div', { class: 'field' }, h('label', { for: id }, f.label), inputs[f.name], errors[f.name]);
    }),
    submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.textContent = '';
    for (const el of Object.values(errors)) el.textContent = '';
    const values = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
    if (values.password !== values.confirm) {
      errors.confirm.textContent = 'Las contraseñas no coinciden';
      inputs.confirm.focus();
      return;
    }
    submit.disabled = true;
    try {
      const { user } = await api.post('/api/setup', values);
      onSuccess(user);
    } catch (err) {
      formError.textContent = err.message;
      for (const [k, msg] of Object.entries(err.details ?? {})) if (errors[k]) errors[k].textContent = msg;
    } finally {
      submit.disabled = false;
    }
  });

  queueMicrotask(() => inputs.first_name.focus());
  return h('div', { class: 'login-page' }, form);
}
