import { resolve } from 'node:path';
import { HttpError, parseCookies, readJson, Reply, sendJson } from './http.js';
import { Router } from './router.js';
import registerAnnouncements from './routes/announcements.js';
import registerAuth, { SESSION_COOKIE } from './routes/auth.js';
import registerDashboard from './routes/dashboard.js';
import registerDepartments from './routes/departments.js';
import registerEmployees from './routes/employees.js';
import registerLeaves from './routes/leaves.js';
import registerTime from './routes/time.js';
import registerVacationGroups from './routes/vacation-groups.js';
import { hashToken, LoginLimiter } from './security.js';
import { serveMemory, serveStatic } from './static.js';

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/**
 * Crea el manejador HTTP. Los ficheros de la interfaz se sirven desde `publicDir` o,
 * en el ejecutable autónomo, desde `staticFiles` (Map ruta → fichero en memoria).
 */
export function createApp({
  db,
  publicDir,
  staticFiles,
  secureCookies = false,
  trustProxy = false,
  sessionTtlMs = 12 * 60 * 60 * 1000,
  logger = console,
}) {
  const router = new Router();
  const deps = { db, limiter: new LoginLimiter(), sessionTtlMs, secureCookies };
  registerAuth(router, deps);
  registerDashboard(router, deps);
  registerEmployees(router, deps);
  registerDepartments(router, deps);
  registerLeaves(router, deps);
  registerTime(router, deps);
  registerAnnouncements(router, deps);
  registerVacationGroups(router, deps);

  if (!publicDir && !staticFiles) throw new Error('createApp necesita publicDir o staticFiles');
  const root = publicDir ? resolve(publicDir) : null;
  const sessionQuery = db.prepare(`
    SELECT s.expires_at, e.id, e.first_name, e.last_name, e.email, e.role, e.status, e.manager_id, e.department_id
    FROM sessions s JOIN employees e ON e.id = s.employee_id
    WHERE s.id = ?
  `);

  function clientIp(req) {
    if (trustProxy) {
      // La última dirección es la que añade el proxy de confianza; las anteriores las controla el cliente.
      const forwarded = req.headers['x-forwarded-for'];
      if (forwarded) return forwarded.split(',').at(-1).trim();
    }
    return req.socket.remoteAddress ?? '';
  }

  /** Protección CSRF adicional a la cookie SameSite=Strict: el origen debe ser el propio servidor. */
  function checkOrigin(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Origen no permitido');
    const origin = req.headers.origin;
    if (!origin) return;
    let host = null;
    try {
      host = new URL(origin).host;
    } catch { /* origen mal formado */ }
    const expected = (trustProxy && req.headers['x-forwarded-host']) || req.headers.host;
    if (!host || host !== expected) throw new HttpError(403, 'Origen no permitido');
  }

  function loadSession(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return { id: null, user: null };
    const id = hashToken(token);
    const row = sessionQuery.get(id);
    if (!row || row.expires_at < Date.now() || row.status === 'baja') return { id, user: null };
    const { expires_at: _expires, ...user } = row;
    return { id, user };
  }

  async function handleApi(req, res, url) {
    const cookies = [];
    try {
      const match = router.match(req.method, url.pathname);
      if (!match) throw new HttpError(404, 'Recurso no encontrado');
      if (match.methodNotAllowed) throw new HttpError(405, 'Método no permitido');
      const { route, params } = match;

      let body = {};
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        checkOrigin(req);
        const type = String(req.headers['content-type'] ?? '').toLowerCase();
        if (!type.startsWith('application/json')) throw new HttpError(415, 'Las peticiones deben enviarse en formato JSON');
        body = await readJson(req);
      }

      const session = loadSession(req);
      if (!route.options.public && !session.user) throw new HttpError(401, 'Tu sesión ha caducado. Vuelve a iniciar sesión.');

      const ctx = {
        db,
        params,
        query: url.searchParams,
        body,
        user: session.user,
        sessionId: session.id,
        ip: clientIp(req),
        setCookie: (cookie) => cookies.push(cookie),
      };
      const result = await route.handler(ctx);
      const headers = cookies.length ? { 'Set-Cookie': cookies } : {};
      if (result instanceof Reply) {
        res.writeHead(result.status, { 'Cache-Control': 'no-store', ...result.headers, ...headers });
        return res.end(result.body);
      }
      return sendJson(res, 200, result ?? { ok: true }, headers);
    } catch (err) {
      if (err instanceof HttpError) {
        return sendJson(res, err.status, { error: err.message, ...(err.details ? { details: err.details } : {}) });
      }
      logger.error(err);
      return sendJson(res, 500, { error: 'Error interno del servidor' });
    }
  }

  return async function handle(req, res) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400);
      return res.end();
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handleApi(req, res, url);
    try {
      if (staticFiles) return serveMemory(req, res, url.pathname, staticFiles);
      return await serveStatic(req, res, url.pathname, root);
    } catch (err) {
      logger.error(err);
      if (!res.headersSent) res.writeHead(500);
      return res.end();
    }
  };
}
