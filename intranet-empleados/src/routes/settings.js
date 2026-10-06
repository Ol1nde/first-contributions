import { HttpError } from '../http.js';
import { MailError, SECURITY_MODES, sendMail } from '../mailer.js';
import { lanAddresses } from '../network.js';
import { requireAdmin } from '../permissions.js';
import { getEmailSettings, isEmailConfigured, saveSettings } from '../settings.js';
import { Validator } from '../validate.js';

const DEFAULT_PORTS = { starttls: 587, tls: 465, none: 25 };

/** Dirección con la que los demás equipos pueden abrir la intranet (para los enlaces de los emails). */
function suggestedUrl(origin) {
  try {
    const url = new URL(origin);
    if (/^(localhost|127\.|\[::1\])/.test(url.hostname) && lanAddresses().length) url.hostname = lanAddresses()[0];
    return url.origin;
  } catch {
    return '';
  }
}

export default function registerSettings(router, { db }) {
  router.get('/api/settings/email', (ctx) => {
    requireAdmin(ctx.user);
    const s = getEmailSettings(db);
    return {
      settings: {
        host: s.host,
        port: s.port,
        security: s.security,
        user: s.user,
        has_password: Boolean(s.password),
        from_email: s.fromEmail,
        from_name: s.fromName,
        public_url: s.publicUrl,
      },
      configured: isEmailConfigured(s),
      suggested_url: suggestedUrl(ctx.origin),
    };
  });

  router.put('/api/settings/email', (ctx) => {
    requireAdmin(ctx.user);
    const v = new Validator(ctx.body);
    v.string('host', 'Servidor SMTP', { max: 200, pattern: /^[A-Za-z0-9.-]+$/, patternMessage: 'no es válido (ej.: smtp.gmail.com)' });
    v.oneOf('security', 'Seguridad', SECURITY_MODES, { defaultValue: 'starttls' });
    v.int('port', 'Puerto', { min: 1, max: 65535 });
    v.string('user', 'Usuario', { max: 200 });
    v.email('from_email', 'Email remitente');
    v.string('from_name', 'Nombre del remitente', { max: 100 });
    v.string('public_url', 'Dirección de la intranet', { max: 200, pattern: /^https?:\/\/\S+$/, patternMessage: 'debe empezar por http:// o https://' });
    const password = ctx.body.password;
    if (password !== undefined && password !== null && (typeof password !== 'string' || password.length > 500)) {
      v.addError('password', 'Contraseña no válida');
    }
    const data = v.out;
    if (data.host && !data.from_email) v.addError('from_email', 'Indica el email desde el que se enviarán los avisos');
    v.done();

    const entries = {
      smtp_host: data.host,
      smtp_security: data.security,
      smtp_port: data.port ?? DEFAULT_PORTS[data.security],
      smtp_user: data.user,
      smtp_from_email: data.from_email ?? '',
      smtp_from_name: data.from_name || 'Intranet',
      public_url: (data.public_url ?? '').replace(/\/+$/, ''),
    };
    // La contraseña solo cambia si se escribe una nueva (el formulario nunca la muestra).
    if (typeof password === 'string' && password !== '') entries.smtp_password = password;
    if (ctx.body.clear_password === true || !data.user) entries.smtp_password = '';
    saveSettings(db, entries);
    return { ok: true, configured: isEmailConfigured(getEmailSettings(db)) };
  });

  router.post('/api/settings/email/test', async (ctx) => {
    requireAdmin(ctx.user);
    const config = getEmailSettings(db);
    if (!isEmailConfigured(config)) throw new HttpError(400, 'Guarda primero el servidor SMTP y el email remitente');
    try {
      const { accepted, rejected } = await sendMail(config, {
        recipients: [ctx.user.email],
        subject: 'Prueba de correo de la intranet',
        text: 'Si estás leyendo esto, los avisos por email de la intranet funcionan correctamente.',
      });
      if (!accepted.length) {
        throw new HttpError(400, `El servidor rechazó el destinatario ${ctx.user.email}: ${rejected[0]?.error ?? 'motivo desconocido'}`);
      }
      return { ok: true, to: ctx.user.email };
    } catch (err) {
      if (err instanceof MailError) throw new HttpError(400, err.message);
      throw err;
    }
  });
}
