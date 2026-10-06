import { api } from '../api.js';
import { avatar, button, card, fmtDate, fullName, h, linkButton, pageHeader, ROLE_LABELS, toast } from '../ui.js';

function inlineForm(fields, submitLabel, onSubmit) {
  const inputs = {};
  const errors = {};
  const formError = h('p', { class: 'form-error', role: 'alert' });
  const submit = button(submitLabel, { variant: 'primary', type: 'submit' });
  const form = h('form', { class: 'form' }, formError,
    h('div', { class: 'form-grid' }, fields.map((f) => {
      inputs[f.name] = h('input', { id: `p-${f.name}`, name: f.name, type: f.type ?? 'text', value: f.value ?? '', autocomplete: f.autocomplete, maxlength: f.maxlength, required: f.required });
      errors[f.name] = h('p', { class: 'field-error' });
      return h('div', { class: 'field' }, h('label', { for: `p-${f.name}` }, f.label), inputs[f.name], errors[f.name]);
    })),
    h('div', { class: 'form-actions' }, submit));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.textContent = '';
    for (const el of Object.values(errors)) el.textContent = '';
    submit.disabled = true;
    try {
      await onSubmit(Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])), inputs);
    } catch (err) {
      formError.textContent = err.message;
      for (const [k, msg] of Object.entries(err.details ?? {})) if (errors[k]) errors[k].textContent = msg;
    } finally {
      submit.disabled = false;
    }
  });
  return form;
}

export async function renderProfile(ctx) {
  ctx.setTitle('Mi perfil');
  const { user } = await api.get('/api/auth/me');

  const summary = h('section', { class: 'card profile-header' },
    avatar(fullName(user), 'avatar-lg'),
    h('div', { class: 'profile-main' },
      h('h1', fullName(user)),
      h('p', { class: 'muted' }, [user.position, user.department_name].filter(Boolean).join(' · ') || 'Sin puesto asignado'),
      h('p', { class: 'muted small' }, `${user.email} · ${ROLE_LABELS[user.role]} · Alta: ${fmtDate(user.hire_date)}`)),
    h('div', { class: 'page-actions' }, linkButton('Ver mi ficha', `#/empleados/${user.id}`)));

  const contact = inlineForm(
    [{ name: 'phone', label: 'Teléfono', type: 'tel', value: user.phone, maxlength: 40, autocomplete: 'tel' }],
    'Guardar',
    async (values) => {
      const res = await api.put('/api/auth/profile', values);
      ctx.setUser({ ...ctx.user, ...res.user });
      toast('Datos actualizados');
    });

  const password = inlineForm([
    { name: 'current_password', label: 'Contraseña actual', type: 'password', autocomplete: 'current-password', required: true },
    { name: 'new_password', label: 'Nueva contraseña (mín. 8 caracteres)', type: 'password', autocomplete: 'new-password', required: true },
    { name: 'confirm', label: 'Repite la nueva contraseña', type: 'password', autocomplete: 'new-password', required: true },
  ], 'Cambiar contraseña', async (values, inputs) => {
    if (values.new_password !== values.confirm) {
      throw Object.assign(new Error('Revisa los datos del formulario'), { details: { confirm: 'Las contraseñas no coinciden' } });
    }
    await api.put('/api/auth/password', { current_password: values.current_password, new_password: values.new_password });
    for (const el of Object.values(inputs)) el.value = '';
    toast('Contraseña cambiada. Se han cerrado tus otras sesiones.');
  });

  return h('div', { class: 'stack' },
    pageHeader('Mi perfil', 'Consulta tus datos y gestiona tu acceso'),
    summary,
    h('div', { class: 'grid grid-2' },
      card('Datos de contacto', [h('p', { class: 'muted small' }, 'Para cambiar otros datos personales contacta con RR. HH.'), contact]),
      card('Seguridad', password)));
}
