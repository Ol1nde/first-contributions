import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import net from 'node:net';
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

/** Servidor SMTP simulado: guarda los mensajes recibidos. */
async function fakeSmtp({ authOk = true } = {}) {
  const messages = [];
  const logins = [];
  const server = net.createServer((sock) => {
    let buffer = '';
    let mode = 'command';
    let current = { rcpts: [], data: '' };
    const send = (line) => sock.write(`${line}\r\n`);
    send('220 fake.smtp ESMTP');
    sock.on('data', (chunk) => {
      buffer += chunk.toString();
      let i;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (mode === 'data') {
          if (line === '.') {
            messages.push(current);
            current = { rcpts: [], data: '' };
            mode = 'command';
            send('250 OK');
          } else {
            current.data += `${line}\r\n`;
          }
          continue;
        }
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO')) { send('250-fake.smtp'); send('250 AUTH PLAIN LOGIN'); }
        else if (upper.startsWith('AUTH PLAIN')) {
          logins.push(Buffer.from(line.slice(11), 'base64').toString().split('\0').slice(1));
          send(authOk ? '235 OK' : '535 5.7.8 Authentication failed');
        }
        else if (upper.startsWith('MAIL FROM')) { current.from = line.match(/<(.*)>/)[1]; send('250 OK'); }
        else if (upper.startsWith('RCPT TO')) {
          const address = line.match(/<(.*)>/)[1];
          if (address.endsWith('@rechazado.test')) send('550 No such user');
          else { current.rcpts.push(address); send('250 OK'); }
        }
        else if (upper === 'DATA') { mode = 'data'; send('354 Go ahead'); }
        else if (upper === 'RSET') send('250 OK');
        else if (upper === 'QUIT') { send('221 Bye'); sock.end(); }
        else send('502 Unknown command');
      }
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { port: server.address().port, messages, logins, close: () => new Promise((done) => server.close(done)) };
}

function decodeMail(raw) {
  const [head, body] = raw.split('\r\n\r\n');
  const subject = head.match(/^Subject: ([\s\S]*?)\r\n(?!\s)/m)[1]
    .replace(/\r\n /g, '')
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString());
  return { subject, text: Buffer.from(body.replace(/\s/g, ''), 'base64').toString() };
}

async function waitFor(check, timeout = 3000) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('Tiempo de espera agotado');
    await new Promise((done) => setTimeout(done, 50));
  }
}

describe('avisos de anuncios', () => {
  let app;
  let smtp;
  const admin = client();
  const as = {};

  before(async () => {
    app = await startApp();
    smtp = await fakeSmtp();
    await ensureAdmin(app.db, ADMIN);
    Object.assign(admin, client(app.url));
    await admin.login(ADMIN.email, ADMIN.password);
    const people = [['rh', 'rrhh'], ['luis', 'empleado'], ['sara', 'empleado'], ['baja', 'empleado'], ['malo', 'empleado']];
    for (const [name, role] of people) {
      const email = name === 'malo' ? 'malo@rechazado.test' : `${name}@a.test`;
      const res = await admin.post('/api/employees', { first_name: name, last_name: 'Aviso', email, role, password: 'password123' });
      as[name] = client(app.url);
      await as[name].login(email, 'password123');
      if (name === 'baja') await admin.put(`/api/employees/${res.data.employee.id}`, { status: 'baja' });
    }
  });

  after(async () => {
    await app.close();
    await smtp.close();
  });

  test('los anuncios nuevos aparecen como no leídos hasta que se ven', async () => {
    await as.rh.post('/api/announcements', { title: 'Cierre por inventario', body: 'El viernes cerramos a las 15:00.' });
    const unread = await as.luis.get('/api/announcements/unread');
    assert.equal(unread.data.count, 1);
    assert.equal(unread.data.items[0].title, 'Cierre por inventario');
    assert.equal((await as.rh.get('/api/announcements/unread')).data.count, 0, 'el autor no recibe su propio aviso');
    assert.equal((await as.luis.get('/api/announcements')).data.announcements[0].unread, true);

    await as.luis.post('/api/announcements/seen');
    assert.equal((await as.luis.get('/api/announcements/unread')).data.count, 0);
    assert.equal((await as.sara.get('/api/announcements/unread')).data.count, 1);
  });

  test('solo el administrador configura el correo y nunca se devuelve la contraseña', async () => {
    assert.equal((await as.rh.get('/api/settings/email')).status, 403);
    const saved = await admin.put('/api/settings/email', {
      host: '127.0.0.1', port: smtp.port, security: 'none', user: 'avisos@a.test', password: 'secreta',
      from_email: 'avisos@a.test', from_name: 'Intranet Ñandú', public_url: 'http://192.168.1.20:3000/',
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const read = await admin.get('/api/settings/email');
    assert.equal(read.data.settings.has_password, true);
    assert.equal(read.data.settings.password, undefined);
    assert.equal(read.data.settings.public_url, 'http://192.168.1.20:3000');
    // Guardar sin escribir contraseña conserva la anterior.
    await admin.put('/api/settings/email', { ...read.data.settings, password: '' });
    assert.equal((await admin.get('/api/settings/email')).data.settings.has_password, true);
  });

  test('el email de prueba llega al administrador', async () => {
    const res = await admin.post('/api/settings/email/test');
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const mail = smtp.messages.at(-1);
    assert.deepEqual(mail.rcpts, [ADMIN.email]);
    assert.deepEqual(smtp.logins.at(-1), ['avisos@a.test', 'secreta']);
    assert.equal(decodeMail(mail.data).subject, 'Prueba de correo de la intranet');
  });

  test('al publicar con aviso por email se envía a la plantilla activa', async () => {
    const before = smtp.messages.length;
    const res = await as.rh.post('/api/announcements', {
      title: 'Reunión general de café ☕ con toda la plantilla para hablar de los nuevos horarios de verano',
      body: 'Nos vemos el lunes.', notify_email: true,
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.email_recipients, 4); // admin, luis, sara y malo (no el autor ni el de baja)

    const done = await waitFor(async () => {
      const list = await as.rh.get('/api/announcements');
      const item = list.data.announcements.find((a) => a.id === res.data.announcement.id);
      return item.email?.status !== 'enviando' && item.email;
    });
    assert.equal(done.status, 'enviado');
    assert.equal(done.sent, 3);
    assert.equal(done.failed, 1);
    assert.match(done.error, /malo@rechazado\.test/);

    const mail = smtp.messages[before];
    assert.deepEqual(mail.rcpts.sort(), [ADMIN.email, 'luis@a.test', 'sara@a.test'].sort());
    const { subject, text } = decodeMail(mail.data);
    assert.equal(subject, 'Nuevo anuncio: Reunión general de café ☕ con toda la plantilla para hablar de los nuevos horarios de verano');
    assert.match(text, /rh Aviso ha publicado/);
    assert.match(text, /http:\/\/192\.168\.1\.20:3000\/#\/anuncios/);
    assert.match(mail.data, /From: =\?UTF-8\?B\?/);
    assert.equal((await as.luis.get('/api/announcements')).data.announcements[0].email, undefined, 'solo RR. HH. ve el estado del envío');
  });

  test('sin marcar el aviso por email no se envía nada', async () => {
    const before = smtp.messages.length;
    await as.rh.post('/api/announcements', { title: 'Sin email', body: 'Solo en la intranet' });
    await new Promise((done) => setTimeout(done, 200));
    assert.equal(smtp.messages.length, before);
  });

  test('un error de autenticación se explica al administrador', async () => {
    const bad = await fakeSmtp({ authOk: false });
    try {
      const settings = (await admin.get('/api/settings/email')).data.settings;
      await admin.put('/api/settings/email', { ...settings, port: bad.port });
      const res = await admin.post('/api/settings/email/test');
      assert.equal(res.status, 400);
      assert.match(res.data.error, /Usuario o contraseña del correo incorrectos/);
    } finally {
      await bad.close();
    }
  });

  test('un servidor inexistente da un error claro', async () => {
    const settings = (await admin.get('/api/settings/email')).data.settings;
    await admin.put('/api/settings/email', { ...settings, port: 1 });
    const res = await admin.post('/api/settings/email/test');
    assert.equal(res.status, 400);
    assert.match(res.data.error, /rechazó la conexión/);
  });
});

describe('fichaje con tarjeta NFC', () => {
  let app;
  const admin = client();
  const ids = {};
  let token;

  const punch = (card, auth = token) => fetch(`${app.url}/api/kiosk/punch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify({ card }),
  }).then(async (res) => ({ status: res.status, data: await res.json() }));

  before(async () => {
    app = await startApp({ punchDebounceMs: 0 });
    await ensureAdmin(app.db, ADMIN);
    Object.assign(admin, client(app.url));
    await admin.login(ADMIN.email, ADMIN.password);
    const create = async (name, card, extra = {}) => {
      const res = await admin.post('/api/employees', { first_name: name, last_name: 'Tarjeta', email: `${name}@nfc.test`, nfc_uid: card, password: 'password123', ...extra });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      return res.data.employee;
    };
    const nuria = await create('nuria', 'a1:b2:c3:d4');
    assert.equal(nuria.nfc_uid, 'A1B2C3D4', 'el código se normaliza');
    ids.nuria = nuria.id;
    ids.olga = (await create('olga', '0012345678')).id;
    ids.pepe = (await create('pepe', null)).id;
  });

  after(() => app.close());

  test('no se puede asignar la misma tarjeta a dos empleados', async () => {
    const res = await admin.put(`/api/employees/${ids.pepe}`, { nfc_uid: 'A1 B2 C3 D4' });
    assert.equal(res.status, 409);
    assert.match(res.data.details.nfc_uid, /nuria Tarjeta/);
    assert.equal((await admin.put(`/api/employees/${ids.pepe}`, { nfc_uid: '¿?' })).status, 400);
  });

  test('solo el administrador crea terminales y el token solo se muestra al crearlo', async () => {
    const worker = client(app.url);
    await worker.login('pepe@nfc.test', 'password123');
    assert.equal((await worker.post('/api/kiosks', { name: 'X' })).status, 403);
    const res = await admin.post('/api/kiosks', { name: 'Puerta principal' });
    assert.equal(res.status, 200);
    token = res.data.token;
    assert.match(res.data.activation_url, /\/terminal\.html#activar=/);
    const list = await admin.get('/api/kiosks');
    assert.equal(list.data.kiosks[0].name, 'Puerta principal');
    assert.equal(list.data.kiosks[0].token, undefined);
  });

  test('sin token de terminal no se puede fichar', async () => {
    assert.equal((await punch('A1B2C3D4', null)).status, 401);
    assert.equal((await punch('A1B2C3D4', 'token-falso')).status, 401);
  });

  test('una tarjeta desconocida devuelve su código para poder asignarla', async () => {
    const res = await punch('ffee0011');
    assert.equal(res.status, 404);
    assert.equal(res.data.details.card, 'FFEE0011');
  });

  test('la tarjeta alterna entrada y salida y queda registrado el origen', async () => {
    const first = await punch('A1B2C3D4');
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.action, 'entrada');
    assert.equal(first.data.employee.first_name, 'nuria');
    const second = await punch('a1-b2-c3-d4');
    assert.equal(second.data.action, 'salida');

    const nuria = client(app.url);
    await nuria.login('nuria@nfc.test', 'password123');
    const { entries } = (await nuria.get('/api/time')).data;
    assert.equal(entries[0].in_source, 'Tarjeta · Puerta principal');
    assert.equal(entries[0].out_source, 'Tarjeta · Puerta principal');

    // Desde el PC también se puede fichar.
    await nuria.post('/api/time/clock-in');
    assert.equal((await nuria.get('/api/time')).data.entries[0].in_source, 'PC');
    assert.equal((await punch('A1B2C3D4')).data.action, 'salida');
  });

  test('una doble lectura seguida no registra la salida', async () => {
    const debounced = await startApp({ punchDebounceMs: 60_000 });
    try {
      await ensureAdmin(debounced.db, ADMIN);
      const a = client(debounced.url);
      await a.login(ADMIN.email, ADMIN.password);
      await a.post('/api/employees', { first_name: 'Quique', last_name: 'Doble', email: 'q@nfc.test', nfc_uid: 'CAFE0001' });
      const kiosk = (await a.post('/api/kiosks', { name: 'Puerta' })).data.token;
      const send = () => fetch(`${debounced.url}/api/kiosk/punch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kiosk}` }, body: JSON.stringify({ card: 'CAFE0001' }),
      }).then((r) => r.json());
      assert.equal((await send()).action, 'entrada');
      const again = await send();
      assert.equal(again.action, 'repetido');
      assert.equal(again.last, 'entrada');
    } finally {
      await debounced.close();
    }
  });

  test('una salida olvidada se cierra para revisar y se ficha la nueva entrada', async () => {
    const yesterday = new Date(Date.now() - 20 * 3600_000).toISOString();
    app.db.prepare('INSERT INTO time_entries (employee_id, clock_in) VALUES (?, ?)').run(ids.olga, yesterday);
    const res = await punch('0012345678');
    assert.equal(res.data.action, 'entrada');
    assert.equal(res.data.closed_stale, true);

    const list = await admin.get(`/api/time?employee_id=${ids.olga}&from=${localDate(new Date(Date.now() - 2 * 86_400_000))}`);
    const stale = list.data.entries.find((e) => e.clock_in === yesterday);
    assert.equal(stale.needs_review, true);
    assert.equal(stale.minutes, 0);
    assert.match(stale.note, /Salida no fichada/);

    // Al corregirla, RR. HH. la deja revisada y con origen «Corrección».
    const fixed = await admin.put(`/api/time/${stale.id}`, { clock_out: new Date(Date.parse(yesterday) + 8 * 3600_000).toISOString() });
    assert.equal(fixed.data.entry.needs_review, false);
    assert.equal(fixed.data.entry.out_source, 'Corrección');
  });

  test('un empleado de baja no puede fichar y un terminal dado de baja deja de funcionar', async () => {
    await admin.put(`/api/employees/${ids.olga}`, { status: 'baja' });
    assert.equal((await punch('0012345678')).status, 409);
    const { kiosks } = (await admin.get('/api/kiosks')).data;
    assert.equal((await admin.del(`/api/kiosks/${kiosks[0].id}`)).status, 200);
    assert.equal((await punch('A1B2C3D4')).status, 401);
  });

  test('la tarjeta solo la ven RR. HH. y el propio empleado', async () => {
    const pepe = client(app.url);
    await pepe.login('pepe@nfc.test', 'password123');
    const other = (await pepe.get(`/api/employees/${ids.nuria}`)).data.employee;
    assert.equal(other.nfc_uid, undefined);
  });
});
