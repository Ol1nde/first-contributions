import { HttpError } from '../http.js';
import { isHR, requireHR } from '../permissions.js';
import { getEmailSettings, isEmailConfigured, notifyAnnouncementByEmail } from '../settings.js';
import { Validator } from '../validate.js';

// Un anuncio está «sin leer» para un empleado si es posterior al último que vio, se publicó después
// de su alta y no lo escribió él mismo.
const UNREAD = `(
  a.id > COALESCE((SELECT last_id FROM announcement_seen WHERE employee_id = :me), 0)
  AND a.created_at >= (SELECT created_at FROM employees WHERE id = :me)
  AND COALESCE(a.author_id, 0) <> :me
)`;

const SELECT = `
  SELECT a.id, a.title, a.body, a.pinned, a.created_at, a.updated_at, a.author_id,
         CASE WHEN e.id IS NULL THEN NULL ELSE e.first_name || ' ' || e.last_name END AS author_name,
         ${UNREAD} AS unread,
         m.status AS email_status, m.recipients AS email_recipients, m.sent AS email_sent,
         m.failed AS email_failed, m.error AS email_error, m.updated_at AS email_updated_at
  FROM announcements a
  LEFT JOIN employees e ON e.id = a.author_id
  LEFT JOIN announcement_emails m ON m.announcement_id = a.id
`;
const ORDER = 'ORDER BY a.pinned DESC, a.created_at DESC, a.id DESC';

function shape(row, user) {
  const {
    email_status: status, email_recipients: recipients, email_sent: sent, email_failed: failed,
    email_error: error, email_updated_at: updatedAt, ...rest
  } = row;
  return {
    ...rest,
    pinned: Boolean(row.pinned),
    unread: Boolean(row.unread),
    // El resultado del aviso por email solo lo ve RR. HH.
    ...(isHR(user) ? { email: status ? { status, recipients, sent, failed, error, updated_at: updatedAt } : null } : {}),
  };
}

export function latestAnnouncements(db, user, limit) {
  return db.prepare(`${SELECT} ${ORDER} LIMIT :limit`).all({ me: user.id, limit }).map((r) => shape(r, user));
}

function getOr404(db, user, id) {
  const row = db.prepare(`${SELECT} WHERE a.id = :id`).get({ me: user.id, id });
  if (!row) throw new HttpError(404, 'Anuncio no encontrado');
  return shape(row, user);
}

function validate(body, partial) {
  const v = new Validator(body, { partial });
  v.string('title', 'Título', { required: true, max: 200 });
  v.string('body', 'Texto', { required: true, max: 5000 });
  v.bool('pinned');
  return v.done();
}

export default function registerAnnouncements(router, { db, logger }) {
  router.get('/api/announcements', (ctx) => {
    const limit = Math.min(Math.max(Number(ctx.query.get('limit')) || 100, 1), 500);
    return {
      announcements: latestAnnouncements(db, ctx.user, limit),
      ...(isHR(ctx.user) ? { email_configured: isEmailConfigured(getEmailSettings(db)) } : {}),
    };
  });

  // Consultado periódicamente por la interfaz para avisar de anuncios nuevos.
  router.get('/api/announcements/unread', (ctx) => {
    const items = db.prepare(`${SELECT} WHERE ${UNREAD} ORDER BY a.id DESC`).all({ me: ctx.user.id });
    return {
      count: items.length,
      items: items.slice(0, 5).map((a) => ({ id: a.id, title: a.title, author_name: a.author_name, created_at: a.created_at })),
    };
  });

  router.post('/api/announcements/seen', (ctx) => {
    const { last } = db.prepare('SELECT COALESCE(MAX(id), 0) AS last FROM announcements').get();
    db.prepare(`
      INSERT INTO announcement_seen (employee_id, last_id) VALUES (?, ?)
      ON CONFLICT(employee_id) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)
    `).run(ctx.user.id, last);
    return { ok: true };
  });

  router.post('/api/announcements', (ctx) => {
    requireHR(ctx.user);
    const data = validate(ctx.body, false);
    const { lastInsertRowid } = db.prepare('INSERT INTO announcements (title, body, pinned, author_id) VALUES (?, ?, ?, ?)')
      .run(data.title, data.body, data.pinned ? 1 : 0, ctx.user.id);
    const announcement = getOr404(db, ctx.user, Number(lastInsertRowid));
    const email = ctx.body.notify_email === true ? notifyAnnouncementByEmail(db, announcement, { logger }) : null;
    return { announcement, email_recipients: email ? email.recipients : null };
  });

  router.put('/api/announcements/:id', (ctx) => {
    requireHR(ctx.user);
    const current = getOr404(db, ctx.user, ctx.params.id);
    const data = validate(ctx.body, true);
    db.prepare("UPDATE announcements SET title = ?, body = ?, pinned = ?, updated_at = datetime('now') WHERE id = ?")
      .run(data.title ?? current.title, data.body ?? current.body, (data.pinned ?? current.pinned) ? 1 : 0, current.id);
    return { announcement: getOr404(db, ctx.user, current.id) };
  });

  router.delete('/api/announcements/:id', (ctx) => {
    requireHR(ctx.user);
    const current = getOr404(db, ctx.user, ctx.params.id);
    db.prepare('DELETE FROM announcements WHERE id = ?').run(current.id);
    return { ok: true };
  });
}
