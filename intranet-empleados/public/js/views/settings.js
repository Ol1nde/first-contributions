import { api } from '../api.js';
import { badge, buildForm, button, card, h, pageHeader, toast } from '../ui.js';

const PORTS = { starttls: 587, tls: 465, none: 25 };

export async function renderSettings(ctx) {
  ctx.setTitle('Configuración');
  if (ctx.user.role !== 'admin') return h('div', { class: 'alert alert-danger' }, 'Solo un administrador puede acceder a la configuración.');

  const { settings, configured, suggested_url: suggestedUrl } = await api.get('/api/settings/email');
  const result = h('div', { role: 'status' });
  const status = h('div', { class: 'list-badges' }, configured ? badge('Activado', 'success') : badge('Sin configurar', 'neutral'));

  const save = async (values) => {
    const res = await api.put('/api/settings/email', values);
    status.replaceChildren(res.configured ? badge('Activado', 'success') : badge('Sin configurar', 'neutral'));
    return res;
  };

  const testButton = button('Guardar y enviar prueba', {
    iconName: 'mail',
    onClick: async () => {
      testButton.disabled = true;
      result.replaceChildren(h('p', { class: 'muted small' }, 'Conectando con el servidor de correo…'));
      try {
        await save(form.values());
        const res = await api.post('/api/settings/email/test');
        result.replaceChildren(h('div', { class: 'alert alert-success' }, `Email de prueba enviado a ${res.to}. Revisa tu bandeja de entrada (y la carpeta de spam).`));
      } catch (err) {
        result.replaceChildren(h('div', { class: 'alert alert-danger' }, err.message));
      } finally {
        testButton.disabled = false;
      }
    },
  });

  const form = buildForm({
    fields: [
      { name: 'host', label: 'Servidor SMTP', placeholder: 'smtp.gmail.com', help: 'Déjalo vacío para desactivar los avisos por email.' },
      {
        name: 'security', label: 'Seguridad', type: 'select',
        options: [['starttls', 'STARTTLS (puerto 587)'], ['tls', 'SSL/TLS (puerto 465)'], ['none', 'Sin cifrar (puerto 25)']],
      },
      { name: 'port', label: 'Puerto', type: 'number', min: 1, max: 65535 },
      { name: 'user', label: 'Usuario', autocomplete: 'off', placeholder: 'avisos@miempresa.es' },
      {
        name: 'password', label: 'Contraseña', type: 'password', autocomplete: 'new-password',
        placeholder: settings.has_password ? '•••••••• (guardada)' : '',
        help: settings.has_password ? 'Escribe una nueva solo si quieres cambiarla.' : 'En Gmail, usa una «contraseña de aplicación».',
      },
      { name: 'from_email', label: 'Email remitente', type: 'email', placeholder: 'avisos@miempresa.es' },
      { name: 'from_name', label: 'Nombre del remitente', placeholder: 'Intranet' },
      {
        name: 'public_url', label: 'Dirección de la intranet', placeholder: suggestedUrl,
        help: 'La que usan los demás equipos para entrar. Se incluye en los emails como enlace.',
      },
    ],
    values: { ...settings, password: '', public_url: settings.public_url || suggestedUrl },
    submitLabel: 'Guardar',
    extraActions: testButton,
    onSubmit: async (values) => {
      await save(values);
      result.replaceChildren();
      toast('Configuración guardada');
    },
  });

  // Al cambiar el tipo de seguridad se propone su puerto habitual.
  form.inputs.security.addEventListener('change', () => {
    if (!form.inputs.port.value || Object.values(PORTS).includes(Number(form.inputs.port.value))) {
      form.inputs.port.value = PORTS[form.inputs.security.value];
    }
  });

  return h('div', { class: 'stack' },
    pageHeader('Configuración', 'Ajustes generales de la intranet'),
    card('Avisos por email', [
      h('div', { class: 'settings-intro' },
        h('p', { class: 'muted' }, 'Cuando RR. HH. publica un anuncio puede avisar por email a toda la plantilla. Indica la cuenta de correo desde la que se enviarán los avisos.'),
        h('details', { class: 'help' },
          h('summary', '¿Qué datos pongo?'),
          h('ul',
            h('li', h('strong', 'Gmail o Google Workspace: '), 'servidor smtp.gmail.com, STARTTLS, puerto 587. Usuario: la cuenta completa. Contraseña: una «contraseña de aplicación» (Cuenta de Google → Seguridad → Verificación en dos pasos → Contraseñas de aplicaciones).'),
            h('li', h('strong', 'Otros proveedores: '), 'busca «datos SMTP» en la ayuda de tu proveedor de correo o pídeselos a quien gestione vuestro dominio.')))),
      form.form,
      result,
    ], { actions: status }));
}
