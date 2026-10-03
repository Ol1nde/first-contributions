import { HttpError, serializeCookie } from '../http.js';
import { findEmployee, shapeEmployee } from '../queries.js';
import {
  getDummyHash, hashPassword, hashToken, MIN_PASSWORD_LENGTH, newSessionToken, verifyPassword,
} from '../security.js';
import { Validator } from '../validate.js';

export const SESSION_COOKIE = 'sid';

export default function registerAuth(router, { db, limiter, sessionTtlMs, secureCookies }) {
  router.post('/api/auth/login', { public: true }, async (ctx) => {
    const email = String(ctx.body.email ?? '').trim().toLowerCase();
    const password = String(ctx.body.password ?? '');
    const key = `${ctx.ip}|${email}`;
    if (limiter.isBlocked(key)) {
      throw new HttpError(429, 'Demasiados intentos fallidos. Espera unos minutos antes de volver a intentarlo.');
    }

    const emp = db.prepare('SELECT id, status, password_hash FROM employees WHERE email = ?').get(email);
    const valid = await verifyPassword(password, emp?.password_hash ?? (await getDummyHash()));
    if (!emp || !emp.password_hash || !valid || emp.status === 'baja') {
      limiter.fail(key);
      throw new HttpError(401, 'Email o contraseña incorrectos');
    }
    limiter.reset(key);

    const token = newSessionToken();
    const now = Date.now();
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    db.prepare('INSERT INTO sessions (id, employee_id, expires_at) VALUES (?, ?, ?)')
      .run(hashToken(token), emp.id, now + sessionTtlMs);
    ctx.setCookie(serializeCookie(SESSION_COOKIE, token, { maxAge: sessionTtlMs / 1000, secure: secureCookies }));

    const user = findEmployee(db, emp.id);
    return { user: shapeEmployee(user, user) };
  });

  router.post('/api/auth/logout', { public: true }, (ctx) => {
    if (ctx.sessionId) db.prepare('DELETE FROM sessions WHERE id = ?').run(ctx.sessionId);
    ctx.setCookie(serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: secureCookies }));
    return { ok: true };
  });

  router.get('/api/auth/me', (ctx) => {
    const user = findEmployee(db, ctx.user.id);
    return { user: shapeEmployee(user, user) };
  });

  router.put('/api/auth/password', async (ctx) => {
    const current = String(ctx.body.current_password ?? '');
    const next = String(ctx.body.new_password ?? '');
    const { password_hash: stored } = db.prepare('SELECT password_hash FROM employees WHERE id = ?').get(ctx.user.id);
    if (!(await verifyPassword(current, stored))) {
      throw new HttpError(400, 'Revisa los datos del formulario', { current_password: 'La contraseña actual no es correcta' });
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, 'Revisa los datos del formulario', {
        new_password: `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
      });
    }
    db.prepare("UPDATE employees SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .run(await hashPassword(next), ctx.user.id);
    // Cierra el resto de sesiones abiertas del usuario.
    db.prepare('DELETE FROM sessions WHERE employee_id = ? AND id <> ?').run(ctx.user.id, ctx.sessionId);
    return { ok: true };
  });

  router.put('/api/auth/profile', (ctx) => {
    const v = new Validator(ctx.body, { partial: true });
    v.string('phone', 'Teléfono', { max: 40 });
    const data = v.done();
    if (data.phone !== undefined) {
      db.prepare("UPDATE employees SET phone = ?, updated_at = datetime('now') WHERE id = ?").run(data.phone, ctx.user.id);
    }
    const user = findEmployee(db, ctx.user.id);
    return { user: shapeEmployee(user, user) };
  });
}
