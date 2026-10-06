import { api } from '../api.js';
import {
  badge, buildForm, button, card, confirmDialog, fmtDateTime, formDialog, h, openDialog, pageHeader, table, toast,
} from '../ui.js';

const PORTS = { starttls: 587, tls: 465, none: 25 };
const TERMINAL_KEY = 'intranet.terminal'; // la misma clave que usa /terminal.html

const sqliteDate = (value) => (value ? fmtDateTime(`${value.replace(' ', 'T')}Z`) : '—');

function storedTerminal() {
  try {
    return localStorage.getItem(TERMINAL_KEY);
  } catch {
    return null;
  }
}

async function copy(text, input) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    input.select();
    document.execCommand('copy');
  }
  toast('Copiado');
}

/** Tras crear un terminal: activarlo en este navegador o llevar el enlace al equipo de la puerta. */
function showActivation(kiosk, token, baseUrl) {
  const url = `${baseUrl}/terminal.html#activar=${token}`;
  const linkInput = h('input', { value: url, readonly: true, 'aria-label': 'Enlace de activación' });
  const { close } = openDialog({
    title: `Terminal «${kiosk.name}» creado`,
    wide: true,
    body: h('div', { class: 'stack' },
      h('div', { class: 'alert alert-warning small' }, 'Guarda este enlace ahora: por seguridad no se volverá a mostrar. Si lo pierdes, da de baja el terminal y crea otro.'),
      h('div',
        h('h3', 'Opción 1 · Estás en el equipo de la puerta'),
        h('p', { class: 'muted small' }, 'Este navegador quedará como terminal de fichaje y se cerrará tu sesión de administrador.'),
        button('Usar este equipo como terminal', {
          variant: 'primary',
          iconName: 'check',
          onClick: async () => {
            try {
              localStorage.setItem(TERMINAL_KEY, token);
            } catch {
              toast('Este navegador no permite guardar datos: usa el enlace de la opción 2', 'error');
              return;
            }
            await api.post('/api/auth/logout').catch(() => {});
            location.href = '/terminal.html';
          },
        })),
      h('div',
        h('h3', 'Opción 2 · Activar otro equipo'),
        h('p', { class: 'muted small' }, 'Abre este enlace una vez en el navegador del equipo de la puerta (puedes enviártelo por email):'),
        h('div', { class: 'code-box' }, linkInput, button('Copiar', { onClick: () => copy(url, linkInput) }))),
      h('details', { class: 'help' },
        h('summary', 'Lectores con conexión de red propia'),
        h('p', { class: 'small' }, 'Los lectores que envían el fichaje directamente por la red deben hacer esta petición con el código de la tarjeta:'),
        h('pre', { class: 'code' }, `POST ${baseUrl}/api/kiosk/punch
Authorization: Bearer ${token}
Content-Type: application/json

{"card": "CÓDIGO_DE_LA_TARJETA"}`))),
    footer: button('Cerrar', { onClick: () => close() }),
  });
}

async function terminalsCard(ctx, baseUrl) {
  const { kiosks } = await api.get('/api/kiosks');
  const thisBrowser = storedTerminal();
  const create = () => formDialog({
    title: 'Nuevo terminal de fichaje',
    intro: 'Ponle el nombre del lugar donde estará, para saber dónde ficha cada empleado.',
    fields: [{ name: 'name', label: 'Nombre', required: true, maxlength: 100, placeholder: 'Ej.: Puerta principal' }],
    submitLabel: 'Crear terminal',
    onSubmit: async (values) => api.post('/api/kiosks', values),
  }).then((res) => {
    if (!res) return;
    ctx.refresh();
    showActivation(res.kiosk, res.token, baseUrl);
  });

  return card('Terminales de fichaje con tarjeta', [
    h('p', { class: 'muted' }, 'Para fichar con tarjeta en la puerta: un equipo (PC, portátil o tablet) con un lector NFC USB de tipo teclado y el navegador abierto en la página del terminal. Asigna a cada empleado su tarjeta desde su ficha (Editar → Tarjeta NFC).'),
    h('details', { class: 'help' },
      h('summary', '¿Qué necesito y cómo lo monto?'),
      h('ul',
        h('li', h('strong', 'Lector: '), 'un lector NFC/RFID USB de 13,56 MHz «HID / emulación de teclado» (funciona sin instalar nada: al acercar la tarjeta escribe su código). Si las tarjetas son de 125 kHz, el lector debe ser de 125 kHz.'),
        h('li', h('strong', 'Equipo: '), 'cualquiera con navegador, conectado a la misma red que la intranet.'),
        h('li', h('strong', 'Activación: '), 'pulsa «Nuevo terminal» y elige «Usar este equipo» (si estás en él) o abre el enlace de activación en el equipo de la puerta.'),
        h('li', h('strong', 'Modo quiosco: '), 'para que solo se vea el terminal, abre Chrome o Edge con la opción --kiosk, por ejemplo: msedge --kiosk "http://IP:3000/terminal.html" --edge-kiosk-type=fullscreen'))),
    thisBrowser ? h('div', { class: 'alert alert-info small' }, 'Este navegador está activado como terminal. ', h('a', { href: '/terminal.html' }, 'Abrir el terminal')) : null,
    table([
      { label: 'Nombre', render: (k) => h('strong', k.name) },
      { label: 'Creado', render: (k) => sqliteDate(k.created_at) },
      { label: 'Último fichaje', render: (k) => sqliteDate(k.last_used_at) },
      {
        label: '',
        className: 'actions',
        render: (k) => button('Dar de baja', {
          size: 'sm',
          variant: 'ghost-danger',
          iconName: 'trash',
          onClick: async () => {
            if (!(await confirmDialog(`¿Dar de baja el terminal «${k.name}»? Dejará de poder registrar fichajes.`, { title: 'Dar de baja terminal', confirmLabel: 'Dar de baja', danger: true }))) return;
            await api.del(`/api/kiosks/${k.id}`);
            toast('Terminal dado de baja');
            ctx.refresh();
          },
        }),
      },
    ], kiosks, { empty: 'Todavía no hay terminales.' }),
  ], { actions: button('Nuevo terminal', { variant: 'primary', iconName: 'plus', onClick: create }) });
}

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

  const terminals = await terminalsCard(ctx, settings.public_url || suggestedUrl || location.origin);

  return h('div', { class: 'stack' },
    pageHeader('Configuración', 'Ajustes generales de la intranet'),
    terminals,
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
