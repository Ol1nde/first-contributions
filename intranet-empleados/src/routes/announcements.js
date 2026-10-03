import { HttpError } from '../http.js';
import { requireHR } from '../permissions.js';
import { Validator } from '../validate.js';

const SELECT = `
  SELECT a.id, a.title, a.body, a.pinned, a.created_at, a.updated_at, a.author_id,
         CASE WHEN e.id IS NULL THEN NULL ELSE e.first_name || ' ' || e.last_name END AS author_name
  FROM announcements a
  LEFT JOIN employees e ON e.id = a.author_id
`;
const ORDER = 'ORDER BY a.pinned DESC, a.created_at DESC, a.id DESC';

const shape = (row) => ({ ...row, pinned: Boolean(row.pinned) });

export function latestAnnouncements(db, limit) {
  return db.prepare(`${SELECT} ${ORDER} LIMIT ?`).all(limit).map(shape);
}

function getOr404(db, id) {
  const row = db.prepare(`${SELECT} WHERE a.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Anuncio no encontrado');
  return shape(row);
}

function validate(body, partial) {
  const v = new Validator(body, { partial });
  v.string('title', 'Título', { required: true, max: 200 });
  v.string('body', 'Texto', { required: true, max: 5000 });
  v.bool('pinned');
  return v.done();
}

export default function registerAnnouncements(router, { db }) {
  router.get('/api/announcements', (ctx) => {
    const limit = Math.min(Math.max(Number(ctx.query.get('limit')) || 100, 1), 500);
    return { announcements: latestAnnouncements(db, limit) };
  });

  router.post('/api/announcements', (ctx) => {
    requireHR(ctx.user);
    const data = validate(ctx.body, false);
    const { lastInsertRowid } = db.prepare('INSERT INTO announcements (title, body, pinned, author_id) VALUES (?, ?, ?, ?)')
      .run(data.title, data.body, data.pinned ? 1 : 0, ctx.user.id);
    return { announcement: getOr404(db, Number(lastInsertRowid)) };
  });

  router.put('/api/announcements/:id', (ctx) => {
    requireHR(ctx.user);
    const current = getOr404(db, ctx.params.id);
    const data = validate(ctx.body, true);
    db.prepare("UPDATE announcements SET title = ?, body = ?, pinned = ?, updated_at = datetime('now') WHERE id = ?")
      .run(data.title ?? current.title, data.body ?? current.body, (data.pinned ?? current.pinned) ? 1 : 0, current.id);
    return { announcement: getOr404(db, current.id) };
  });

  router.delete('/api/announcements/:id', (ctx) => {
    requireHR(ctx.user);
    const current = getOr404(db, ctx.params.id);
    db.prepare('DELETE FROM announcements WHERE id = ?').run(current.id);
    return { ok: true };
  });
}
