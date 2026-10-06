import { sendMail } from './mailer.js';

/** Configuración del correo saliente (tabla «settings»). */
export function getEmailSettings(db) {
  const map = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  return {
    host: map.smtp_host ?? '',
    port: Number(map.smtp_port) || 587,
    security: map.smtp_security || 'starttls',
    user: map.smtp_user ?? '',
    password: map.smtp_password ?? '',
    fromEmail: map.smtp_from_email ?? '',
    fromName: map.smtp_from_name || 'Intranet',
    publicUrl: map.public_url ?? '',
  };
}

export function isEmailConfigured(settings) {
  return Boolean(settings.host && settings.fromEmail);
}

export function saveSettings(db, entries) {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [key, value] of Object.entries(entries)) upsert.run(key, String(value ?? ''));
}

function announcementText({ title, body, author }, publicUrl) {
  return [
    `${author || 'Recursos Humanos'} ha publicado un nuevo anuncio en la intranet:`,
    '',
    title,
    '='.repeat(Math.min(Math.max(title.length, 3), 60)),
    '',
    body,
    '',
    ...(publicUrl ? [`Léelo en la intranet: ${publicUrl}/#/anuncios`, ''] : []),
    '—',
    'Aviso automático de la intranet. No respondas a este correo.',
  ].join('\n');
}

/**
 * Avisa por email a la plantilla activa (salvo al autor) de un anuncio nuevo.
 * El envío se hace en segundo plano y su resultado queda en «announcement_emails».
 * Devuelve null si el correo no está configurado.
 */
export function notifyAnnouncementByEmail(db, announcement, { logger = console } = {}) {
  const config = getEmailSettings(db);
  if (!isEmailConfigured(config)) return null;
  const recipients = db.prepare("SELECT email FROM employees WHERE status = 'activo' AND id <> ? AND email <> ''")
    .all(announcement.author_id ?? 0)
    .map((r) => r.email);

  const record = (status, { sent = 0, failed = 0, error = '' } = {}) => {
    try {
      db.prepare(`
        INSERT INTO announcement_emails (announcement_id, status, recipients, sent, failed, error, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(announcement_id) DO UPDATE SET status = excluded.status, recipients = excluded.recipients,
          sent = excluded.sent, failed = excluded.failed, error = excluded.error, updated_at = excluded.updated_at
      `).run(announcement.id, status, recipients.length, sent, failed, error);
    } catch (err) {
      logger.error(err); // p. ej. la base de datos ya se cerró al apagar
    }
  };

  if (!recipients.length) {
    record('enviado');
    return { recipients: 0, done: Promise.resolve() };
  }
  record('enviando');
  const done = sendMail(config, {
    recipients,
    subject: `Nuevo anuncio: ${announcement.title}`,
    text: announcementText({ title: announcement.title, body: announcement.body, author: announcement.author_name }, config.publicUrl),
  }).then(({ accepted, rejected }) => {
    const error = rejected.slice(0, 3).map((r) => `${r.address}: ${r.error}`).join(' · ');
    record(accepted.length ? 'enviado' : 'error', { sent: accepted.length, failed: rejected.length, error });
  }).catch((err) => {
    logger.error(`No se pudo enviar el aviso por email del anuncio ${announcement.id}: ${err.message}`);
    record('error', { failed: recipients.length, error: err.message });
  });
  return { recipients: recipients.length, done };
}
