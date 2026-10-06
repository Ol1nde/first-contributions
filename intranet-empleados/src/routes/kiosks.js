import { HttpError } from '../http.js';
import { requireAdmin } from '../permissions.js';
import { hashToken, newSessionToken } from '../security.js';
import { Validator } from '../validate.js';
import { clockStatus, punch } from './time.js';

/** Normaliza el código de una tarjeta tal y como lo envía el lector (sin espacios ni separadores, en mayúsculas). */
export function normalizeCard(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[\s:.-]/g, '');
}

export const CARD_PATTERN = /^[0-9A-Z]{4,32}$/;

function kioskFromRequest(db, headers) {
  const match = /^Bearer\s+(\S+)$/i.exec(headers.authorization ?? '');
  if (!match) return null;
  return db.prepare('SELECT id, name FROM kiosks WHERE token_hash = ?').get(hashToken(match[1])) ?? null;
}

function requireKiosk(db, headers) {
  const kiosk = kioskFromRequest(db, headers);
  if (!kiosk) throw new HttpError(401, 'Este terminal no está activado o se ha dado de baja');
  return kiosk;
}

export default function registerKiosks(router, { db, punchDebounceMs = 60_000 }) {
  // --- Gestión de terminales (administrador) ---
  router.get('/api/kiosks', (ctx) => {
    requireAdmin(ctx.user);
    return { kiosks: db.prepare('SELECT id, name, created_at, last_used_at FROM kiosks ORDER BY name COLLATE NOCASE').all() };
  });

  router.post('/api/kiosks', (ctx) => {
    requireAdmin(ctx.user);
    const v = new Validator(ctx.body);
    v.string('name', 'Nombre', { required: true, max: 100 });
    const { name } = v.done();
    const token = newSessionToken();
    const { lastInsertRowid } = db.prepare('INSERT INTO kiosks (name, token_hash) VALUES (?, ?)').run(name, hashToken(token));
    return {
      kiosk: db.prepare('SELECT id, name, created_at, last_used_at FROM kiosks WHERE id = ?').get(Number(lastInsertRowid)),
      // El token solo se muestra ahora: en la base de datos se guarda su hash.
      token,
      activation_url: `${ctx.origin}/terminal.html#activar=${token}`,
    };
  });

  router.delete('/api/kiosks/:id', (ctx) => {
    requireAdmin(ctx.user);
    const { changes } = db.prepare('DELETE FROM kiosks WHERE id = ?').run(ctx.params.id);
    if (!changes) throw new HttpError(404, 'Terminal no encontrado');
    return { ok: true };
  });

  // --- Uso desde el terminal (autenticado con «Authorization: Bearer <token>») ---
  router.get('/api/kiosk/status', { public: true }, (ctx) => {
    const kiosk = requireKiosk(db, ctx.headers);
    return { name: kiosk.name };
  });

  router.post('/api/kiosk/punch', { public: true }, (ctx) => {
    const kiosk = requireKiosk(db, ctx.headers);
    db.prepare("UPDATE kiosks SET last_used_at = datetime('now') WHERE id = ?").run(kiosk.id);

    const card = normalizeCard(ctx.body.card);
    if (!CARD_PATTERN.test(card)) throw new HttpError(400, 'Lectura de tarjeta no válida');
    const employee = db.prepare('SELECT id, first_name, last_name, status FROM employees WHERE nfc_uid = ?').get(card);
    // Se devuelve el código leído para que RR. HH. pueda asignar la tarjeta.
    if (!employee) throw new HttpError(404, 'Tarjeta no reconocida', { card });
    if (employee.status === 'baja') throw new HttpError(409, 'Esta tarjeta pertenece a un empleado dado de baja');

    const result = punch(db, employee.id, `Tarjeta · ${kiosk.name}`, { debounceMs: punchDebounceMs });
    return {
      ...result,
      employee: { first_name: employee.first_name, last_name: employee.last_name },
      today_minutes: clockStatus(db, employee.id).today_minutes,
    };
  });
}
