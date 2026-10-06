import { api } from '../api.js';
import { button, h } from '../ui.js';

export function renderLogin({ message, onSuccess }) {
  const email = h('input', { id: 'login-email', type: 'email', name: 'email', required: true, autocomplete: 'username' });
  const password = h('input', { id: 'login-password', type: 'password', name: 'password', required: true, autocomplete: 'current-password' });
  const error = h('p', { class: 'form-error', role: 'alert' }, message ?? '');
  const submit = button('Entrar', { variant: 'primary', type: 'submit' });

  const form = h('form', { class: 'login-card' },
    h('div', { class: 'login-brand' }, h('img', { src: '/img/favicon.svg', alt: '', width: 44, height: 44 }),
      h('div', h('h1', 'Intranet'), h('p', { class: 'muted' }, 'Gestión de empleados'))),
    error,
    h('div', { class: 'field' }, h('label', { for: 'login-email' }, 'Email'), email),
    h('div', { class: 'field' }, h('label', { for: 'login-password' }, 'Contraseña'), password),
    submit,
    h('p', { class: 'muted small' }, '¿Has olvidado la contraseña? Contacta con Recursos Humanos.'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    try {
      const { user } = await api.post('/api/auth/login', { email: email.value, password: password.value });
      onSuccess(user);
    } catch (err) {
      error.textContent = err.message;
      password.value = '';
      password.focus();
    } finally {
      submit.disabled = false;
    }
  });

  queueMicrotask(() => email.focus());
  return h('div', { class: 'login-page' }, form);
}
