import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { ensureAdmin, openDatabase } from '../src/db.js';
import { memoryFile } from '../src/static.js';
import { localDate, workingDays } from '../src/validate.js';

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

/** Levanta una instancia independiente de la aplicación con base de datos en memoria. */
async function startApp(options = {}) {
  const db = openDatabase(':memory:');
  const srv = createServer(createApp({ db, publicDir: PUBLIC_DIR, logger: { error() {} }, ...options }));
  await new Promise((done) => srv.listen(0, '127.0.0.1', done));
  return { db, url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((done) => srv.close(done)) };
}

const ADMIN = { email: 'admin@test.local', password: 'admin-password' };
let server;
let baseUrl;

before(async () => {
  const db = openDatabase(':memory:');
  await ensureAdmin(db, ADMIN);
  server = createServer(createApp({ db, publicDir: PUBLIC_DIR, logger: { error() {} } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

/** Cliente HTTP mínimo que conserva la cookie de sesión. */
function client(url) {
  let cookie = '';
  const request = async (method, path, body, extraHeaders = {}) => {
    const headers = { ...extraHeaders };
    if (cookie) headers.Cookie = cookie;
    if (method !== 'GET') headers['Content-Type'] = 'application/json';
    const res = await fetch((url ?? baseUrl) + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.getSetCookie()[0];
    if (setCookie) cookie = setCookie.split(';')[0];
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  };
  return {
    get: (p) => request('GET', p),
    post: (p, b = {}) => request('POST', p, b),
    put: (p, b = {}) => request('PUT', p, b),
    del: (p) => request('DELETE', p, {}),
    login: (email, password) => request('POST', '/api/auth/login', { email, password }),
    request,
  };
}

function shiftDate(date, days) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

/** Semana laboral futura (lunes a viernes) dentro de un mismo año. */
function futureWorkWeek(weeksAhead = 1) {
  const today = localDate();
  const d = new Date(`${today}T12:00:00`);
  let start = shiftDate(today, ((8 - d.getDay()) % 7 || 7) + 7 * (weeksAhead - 1));
  while (start.slice(0, 4) !== shiftDate(start, 4).slice(0, 4)) start = shiftDate(start, 7);
  return { start, end: shiftDate(start, 4) };
}

describe('autenticación', () => {
  test('rechaza peticiones sin sesión', async () => {
    const res = await client().get('/api/employees');
    assert.equal(res.status, 401);
  });

  test('rechaza credenciales incorrectas', async () => {
    const res = await client().login(ADMIN.email, 'incorrecta');
    assert.equal(res.status, 401);
  });

  test('inicia sesión y devuelve el usuario', async () => {
    const c = client();
    const res = await c.login(ADMIN.email.toUpperCase(), ADMIN.password);
    assert.equal(res.status, 200);
    assert.equal(res.data.user.role, 'admin');
    assert.match(res.headers.get('set-cookie'), /HttpOnly; SameSite=Strict|SameSite=Strict; HttpOnly/);
    const me = await c.get('/api/auth/me');
    assert.equal(me.data.user.email, ADMIN.email);
    await c.post('/api/auth/logout');
    assert.equal((await c.get('/api/auth/me')).status, 401);
  });

  test('bloquea tras varios intentos fallidos', async () => {
    const c = client();
    for (let i = 0; i < 5; i += 1) assert.equal((await c.login('nadie@test.local', 'x')).status, 401);
    assert.equal((await c.login('nadie@test.local', 'x')).status, 429);
  });

  test('exige JSON y mismo origen en peticiones que modifican datos', async () => {
    const form = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'email=a&password=b',
    });
    assert.equal(form.status, 415);
    const crossOrigin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://malicioso.example' },
      body: '{}',
    });
    assert.equal(crossOrigin.status, 403);
  });
});

describe('gestión de empleados y permisos', () => {
  const admin = client();
  const hr = client();
  const manager = client();
  const worker = client();
  const ids = {};

  before(async () => {
    await admin.login(ADMIN.email, ADMIN.password);
    const dep = await admin.post('/api/departments', { name: 'Tecnología', description: 'Equipo técnico' });
    assert.equal(dep.status, 200);
    ids.dep = dep.data.department.id;

    const create = async (body) => {
      const res = await admin.post('/api/employees', { password: 'password123', department_id: ids.dep, ...body });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      return res.data.employee.id;
    };
    ids.hr = await create({ first_name: 'Rita', last_name: 'Recursos', email: 'rita@test.local', role: 'rrhh' });
    ids.manager = await create({ first_name: 'Mario', last_name: 'Jefe', email: 'mario@test.local', role: 'responsable' });
    ids.worker = await create({
      first_name: 'Eva', last_name: 'Empleada', email: 'eva@test.local', manager_id: ids.manager,
      birth_date: '1990-05-17', vacation_days: 10,
    });
    await hr.login('rita@test.local', 'password123');
    await manager.login('mario@test.local', 'password123');
    await worker.login('eva@test.local', 'password123');
  });

  test('no permite emails duplicados', async () => {
    const res = await admin.post('/api/employees', { first_name: 'Otra', last_name: 'Eva', email: 'EVA@test.local' });
    assert.equal(res.status, 409);
    assert.ok(res.data.details.email);
  });

  test('valida los campos obligatorios', async () => {
    const res = await admin.post('/api/employees', { first_name: '', email: 'no-es-email' });
    assert.equal(res.status, 400);
    assert.ok(res.data.details.first_name);
    assert.ok(res.data.details.last_name);
    assert.ok(res.data.details.email);
  });

  test('un empleado no puede crear empleados', async () => {
    const res = await worker.post('/api/employees', { first_name: 'X', last_name: 'Y', email: 'x@test.local' });
    assert.equal(res.status, 403);
  });

  test('RR. HH. no puede crear administradores ni modificar al admin', async () => {
    const res = await hr.post('/api/employees', { first_name: 'X', last_name: 'Y', email: 'x@test.local', role: 'admin' });
    assert.equal(res.status, 400);
    assert.ok(res.data.details.role);
    const me = await admin.get('/api/auth/me');
    assert.equal((await hr.put(`/api/employees/${me.data.user.id}`, { position: 'Hackeado' })).status, 403);
  });

  test('el directorio oculta datos personales de otros empleados', async () => {
    const res = await manager.get('/api/employees');
    const eva = res.data.employees.find((e) => e.id === ids.worker);
    assert.equal(eva.email, 'eva@test.local');
    assert.equal(eva.birth_date, undefined);
    assert.equal(eva.role, undefined);
    const own = await worker.get(`/api/employees/${ids.worker}`);
    assert.equal(own.data.employee.birth_date, '1990-05-17');
  });

  test('la búsqueda filtra por nombre', async () => {
    const res = await worker.get('/api/employees?q=mario');
    assert.deepEqual(res.data.employees.map((e) => e.id), [ids.manager]);
  });

  test('impide ciclos en la jerarquía', async () => {
    const res = await admin.put(`/api/employees/${ids.manager}`, { manager_id: ids.worker });
    assert.equal(res.status, 400);
    assert.ok(res.data.details.manager_id);
  });

  test('no se puede eliminar un departamento con empleados', async () => {
    assert.equal((await admin.del(`/api/departments/${ids.dep}`)).status, 409);
  });

  test('flujo de vacaciones: solicitud, solapamiento, saldo y aprobación', async () => {
    const { start, end } = futureWorkWeek();
    const created = await worker.post('/api/leaves', { type: 'vacaciones', start_date: start, end_date: end, reason: 'Descanso' });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.equal(created.data.leave.days, workingDays(start, end));
    assert.equal(created.data.leave.days, 5);

    const overlap = await worker.post('/api/leaves', { type: 'asuntos_propios', start_date: end, end_date: end });
    assert.equal(overlap.status, 409);

    const later = futureWorkWeek(3);
    const tooMany = await worker.post('/api/leaves', { type: 'vacaciones', start_date: later.start, end_date: shiftDate(later.end, 7) });
    assert.equal(tooMany.status, 400);
    assert.match(tooMany.data.details.end_date, /Solo quedan 5 días/);

    const balance = await worker.get(`/api/leaves/balance?year=${start.slice(0, 4)}`);
    assert.equal(balance.data.balance.pending, 5);
    assert.equal(balance.data.balance.available, 5);

    const id = created.data.leave.id;
    assert.equal((await worker.put(`/api/leaves/${id}/review`, { decision: 'aprobada' })).status, 403);

    const queue = await manager.get('/api/leaves?scope=review&status=pendiente');
    assert.ok(queue.data.leaves.some((l) => l.id === id && l.can_review));

    const reviewed = await manager.put(`/api/leaves/${id}/review`, { decision: 'aprobada', comment: 'Disfruta' });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.data.leave.status, 'aprobada');
    assert.equal((await manager.put(`/api/leaves/${id}/review`, { decision: 'rechazada' })).status, 409);

    const cancelled = await worker.put(`/api/leaves/${id}/cancel`);
    assert.equal(cancelled.data.leave.status, 'cancelada');
  });

  test('registro de jornada: entrada, doble entrada y salida', async () => {
    const inRes = await worker.post('/api/time/clock-in', { note: 'Oficina' });
    assert.equal(inRes.status, 200);
    assert.ok(inRes.data.open);
    assert.equal((await worker.post('/api/time/clock-in')).status, 409);
    const outRes = await worker.post('/api/time/clock-out');
    assert.equal(outRes.data.open, null);
    assert.equal((await worker.post('/api/time/clock-out')).status, 409);

    const list = await worker.get('/api/time');
    assert.equal(list.data.entries.length, 1);
    assert.equal((await manager.get(`/api/time?employee_id=${ids.worker}`)).status, 200);
    assert.equal((await worker.get(`/api/time?employee_id=${ids.manager}`)).status, 403);

    const csv = await hr.get('/api/time/export.csv');
    assert.equal(csv.status, 200);
    assert.match(csv.data, /Empleada;eva@test\.local/);
  });

  test('RR. HH. puede corregir un fichaje y queda registrado', async () => {
    const list = await worker.get('/api/time');
    const entry = list.data.entries[0];
    const clockIn = new Date(Date.now() - 3 * 3600_000).toISOString();
    const res = await hr.put(`/api/time/${entry.id}`, { clock_in: clockIn });
    assert.equal(res.status, 200);
    assert.equal(res.data.entry.edited_by_name, 'Rita Recursos');
    assert.equal((await worker.put(`/api/time/${entry.id}`, { clock_in: clockIn })).status, 403);
  });

  test('no se elimina un empleado con registros de jornada', async () => {
    assert.equal((await admin.del(`/api/employees/${ids.worker}`)).status, 409);
  });

  test('un empleado dado de baja no puede iniciar sesión', async () => {
    const res = await hr.put(`/api/employees/${ids.worker}`, { status: 'baja' });
    assert.equal(res.status, 200);
    assert.equal((await worker.get('/api/auth/me')).status, 401);
    assert.equal((await client().login('eva@test.local', 'password123')).status, 401);
    const directory = await manager.get('/api/employees');
    assert.ok(!directory.data.employees.some((e) => e.id === ids.worker));
  });

  test('anuncios: solo RR. HH. publica', async () => {
    assert.equal((await manager.post('/api/announcements', { title: 'Hola', body: 'Texto' })).status, 403);
    const res = await hr.post('/api/announcements', { title: 'Hola', body: 'Texto', pinned: true });
    assert.equal(res.status, 200);
    assert.equal(res.data.announcement.pinned, true);
  });

  test('el panel de inicio devuelve los indicadores', async () => {
    const res = await manager.get('/api/dashboard');
    assert.equal(res.status, 200);
    assert.ok(res.data.stats.active_employees >= 3);
    assert.equal(typeof res.data.balance.available, 'number');
    assert.ok(Array.isArray(res.data.announcements));
  });

  test('cambio de contraseña', async () => {
    const bad = await manager.put('/api/auth/password', { current_password: 'mal', new_password: 'nueva-clave' });
    assert.equal(bad.status, 400);
    const ok = await manager.put('/api/auth/password', { current_password: 'password123', new_password: 'nueva-clave' });
    assert.equal(ok.status, 200);
    assert.equal((await client().login('mario@test.local', 'nueva-clave')).status, 200);
  });
});

describe('ficheros estáticos', () => {
  test('sirve la aplicación con cabeceras de seguridad', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(await res.text(), /<div id="app">/);
  });

  test('impide salir del directorio público', async () => {
    const res = await fetch(`${baseUrl}/..%2fpackage.json`);
    assert.notEqual(res.status, 200);
  });
});

describe('configuración inicial', () => {
  const owner = { first_name: 'Olga', last_name: 'Dueña', email: 'olga@test.local', password: 'clave-segura' };

  test('crea el administrador desde el navegador una sola vez', async () => {
    const app = await startApp();
    try {
      const c = client(app.url);
      assert.equal((await c.get('/api/setup')).data.needed, true);
      const invalid = await c.post('/api/setup', { ...owner, password: 'corta' });
      assert.equal(invalid.status, 400);
      assert.ok(invalid.data.details.password);

      const created = await c.post('/api/setup', owner);
      assert.equal(created.status, 200);
      assert.equal(created.data.user.role, 'admin');
      assert.equal((await c.get('/api/auth/me')).data.user.email, owner.email);

      assert.equal((await c.get('/api/setup')).data.needed, false);
      assert.equal((await client(app.url).post('/api/setup', { ...owner, email: 'otro@test.local' })).status, 409);
    } finally {
      await app.close();
    }
  });

  test('no se puede configurar desde otro equipo de la red', async () => {
    const app = await startApp({ trustProxy: true });
    try {
      const remote = await client(app.url).request('POST', '/api/setup', owner, { 'X-Forwarded-For': '127.0.0.1, 203.0.113.9' });
      assert.equal(remote.status, 403);
      assert.equal((await client(app.url).get('/api/setup')).data.needed, true);
    } finally {
      await app.close();
    }
  });
});

describe('interfaz embebida (ejecutable)', () => {
  test('sirve los ficheros desde memoria con ETag', async () => {
    const files = new Map([['index.html', memoryFile(Buffer.from('<div id="app"></div>'))]]);
    const app = await startApp({ publicDir: undefined, staticFiles: files });
    try {
      const res = await fetch(`${app.url}/`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/html/);
      assert.equal(await res.text(), '<div id="app"></div>');
      const cached = await fetch(`${app.url}/`, { headers: { 'If-None-Match': res.headers.get('etag') } });
      assert.equal(cached.status, 304);
      assert.equal((await fetch(`${app.url}/no-existe.js`)).status, 404);
    } finally {
      await app.close();
    }
  });
});

describe('grupos de vacaciones sin coincidencia', () => {
  let app;
  const admin = client();
  const people = {};
  const as = {};

  before(async () => {
    app = await startApp();
    await ensureAdmin(app.db, ADMIN);
    Object.assign(admin, client(app.url));
    await admin.login(ADMIN.email, ADMIN.password);
    for (const name of ['ana', 'bea', 'carlos', 'dani', 'eva']) {
      const res = await admin.post('/api/employees', { first_name: name, last_name: 'Prueba', email: `${name}@g.test`, password: 'password123' });
      people[name] = res.data.employee.id;
      as[name] = client(app.url);
      await as[name].login(`${name}@g.test`, 'password123');
    }
  });

  after(() => app.close());

  test('solo RR. HH. gestiona grupos y exige al menos dos miembros', async () => {
    assert.equal((await as.ana.post('/api/vacation-groups', { name: 'X', member_ids: [people.ana, people.bea] })).status, 403);
    const tooFew = await admin.post('/api/vacation-groups', { name: 'Recepción', member_ids: [people.ana] });
    assert.equal(tooFew.status, 400);
    assert.ok(tooFew.data.details.member_ids);
    const created = await admin.post('/api/vacation-groups', { name: 'Recepción', member_ids: [people.ana, people.bea] });
    assert.equal(created.status, 200);
    assert.deepEqual(created.data.group.members.map((m) => m.id).sort(), [people.ana, people.bea].sort());
  });

  test('un miembro no puede pedir vacaciones que coincidan con otro del grupo', async () => {
    const week = futureWorkWeek(2);
    assert.equal((await as.ana.post('/api/leaves', { type: 'vacaciones', start_date: week.start, end_date: week.end })).status, 200);

    const clash = await as.bea.post('/api/leaves', { type: 'vacaciones', start_date: shiftDate(week.start, 2), end_date: shiftDate(week.end, 3) });
    assert.equal(clash.status, 409);
    assert.match(clash.data.error, /ana Prueba/);
    assert.match(clash.data.error, /Recepción/);

    // Otro tipo de ausencia, otras fechas u otra persona fuera del grupo: permitido.
    assert.equal((await as.bea.post('/api/leaves', { type: 'asuntos_propios', start_date: week.start, end_date: week.start })).status, 200);
    const other = futureWorkWeek(4);
    assert.equal((await as.bea.post('/api/leaves', { type: 'vacaciones', start_date: other.start, end_date: other.end })).status, 200);
    assert.equal((await as.carlos.post('/api/leaves', { type: 'vacaciones', start_date: week.start, end_date: week.end })).status, 200);
  });

  test('los empleados ven sus grupos y RR. HH. todos', async () => {
    const mine = await as.bea.get('/api/vacation-groups');
    assert.deepEqual(mine.data.groups.map((g) => g.name), ['Recepción']);
    assert.equal(mine.data.groups[0].overlaps, undefined);
    assert.equal((await as.carlos.get('/api/vacation-groups')).data.groups.length, 0);
  });

  test('al aprobar se bloquean solapes previos a la creación del grupo', async () => {
    const week = futureWorkWeek(6);
    const d1 = await as.dani.post('/api/leaves', { type: 'vacaciones', start_date: week.start, end_date: week.end });
    const e1 = await as.eva.post('/api/leaves', { type: 'vacaciones', start_date: week.start, end_date: week.end });
    assert.equal(d1.status, 200);
    assert.equal(e1.status, 200);

    const group = await admin.post('/api/vacation-groups', { name: 'Almacén', member_ids: [people.dani, people.eva] });
    assert.equal(group.data.group.overlaps.length, 1);

    const queue = await admin.get('/api/leaves?scope=review&status=pendiente');
    const pendingEva = queue.data.leaves.find((l) => l.id === e1.data.leave.id);
    assert.equal(pendingEva.conflict.employee_name, 'dani Prueba');

    assert.equal((await admin.put(`/api/leaves/${d1.data.leave.id}/review`, { decision: 'aprobada' })).status, 200);
    const blocked = await admin.put(`/api/leaves/${e1.data.leave.id}/review`, { decision: 'aprobada' });
    assert.equal(blocked.status, 409);
    assert.match(blocked.data.error, /No se puede aprobar/);
    assert.equal((await admin.put(`/api/leaves/${e1.data.leave.id}/review`, { decision: 'rechazada', comment: 'Coincide' })).status, 200);
  });

  test('al eliminar el grupo desaparece la restricción', async () => {
    const { groups } = (await admin.get('/api/vacation-groups')).data;
    const reception = groups.find((g) => g.name === 'Recepción');
    assert.equal((await admin.del(`/api/vacation-groups/${reception.id}`)).status, 200);
    const week = futureWorkWeek(2);
    const res = await as.bea.post('/api/leaves', { type: 'vacaciones', start_date: shiftDate(week.start, 1), end_date: shiftDate(week.start, 1) });
    assert.equal(res.status, 200);
  });
});
