import { csvReply, HttpError } from '../http.js';
import { canSupervise, forbidden, isHR, requireHR } from '../permissions.js';
import { getEmployeeOr404 } from '../queries.js';
import { isValidDate, localDate, Validator } from '../validate.js';

const SELECT = `
  SELECT t.id, t.employee_id, t.clock_in, t.clock_out, t.note, t.edited_at,
         e.first_name || ' ' || e.last_name AS employee_name, e.email AS employee_email,
         CASE WHEN x.id IS NULL THEN NULL ELSE x.first_name || ' ' || x.last_name END AS edited_by_name
  FROM time_entries t
  JOIN employees e ON e.id = t.employee_id
  LEFT JOIN employees x ON x.id = t.edited_by
`;

const MAX_SHIFT_MS = 24 * 60 * 60 * 1000;

/** Inicio del día local (zona horaria del servidor) en ISO UTC. */
function startOfDayIso(date) {
  return new Date(`${date}T00:00:00`).toISOString();
}

function nextDay(date) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return localDate(d);
}

function minutes(entry, now = Date.now()) {
  const end = entry.clock_out ? Date.parse(entry.clock_out) : now;
  return Math.max(0, Math.round((end - Date.parse(entry.clock_in)) / 60_000));
}

function withMinutes(entry) {
  return { ...entry, minutes: minutes(entry), open: !entry.clock_out };
}

function openEntry(db, employeeId) {
  return db.prepare(`${SELECT} WHERE t.employee_id = ? AND t.clock_out IS NULL ORDER BY t.clock_in DESC LIMIT 1`).get(employeeId);
}

export function clockStatus(db, employeeId) {
  const today = localDate();
  const entries = db.prepare(`${SELECT} WHERE t.employee_id = ? AND t.clock_in >= ? ORDER BY t.clock_in`)
    .all(employeeId, startOfDayIso(today));
  const open = openEntry(db, employeeId);
  return {
    open: open ? withMinutes(open) : null,
    today_minutes: entries.reduce((sum, e) => sum + minutes(e), 0),
  };
}

function parseRange(query) {
  const today = localDate();
  const from = query.get('from') || `${today.slice(0, 8)}01`;
  const to = query.get('to') || today;
  if (!isValidDate(from) || !isValidDate(to)) throw new HttpError(400, 'Rango de fechas no válido');
  if (to < from) throw new HttpError(400, 'La fecha final no puede ser anterior a la inicial');
  return { from, to, fromIso: startOfDayIso(from), toIso: startOfDayIso(nextDay(to)) };
}

function formatLocal(iso) {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return { date: localDate(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

function parseDateTime(v, field, label) {
  const value = typeof v === 'string' ? v.trim() : '';
  const ms = Date.parse(value);
  if (!value || Number.isNaN(ms)) {
    throw new HttpError(400, 'Revisa los datos del formulario', { [field]: `${label} no es una fecha y hora válida` });
  }
  return new Date(ms).toISOString();
}

export default function registerTime(router, { db }) {
  router.get('/api/time/status', (ctx) => clockStatus(db, ctx.user.id));

  router.post('/api/time/clock-in', (ctx) => {
    if (openEntry(db, ctx.user.id)) throw new HttpError(409, 'Ya tienes una jornada abierta. Ficha la salida primero.');
    const v = new Validator(ctx.body);
    v.string('note', 'Nota', { max: 500 });
    const { note } = v.done();
    db.prepare('INSERT INTO time_entries (employee_id, clock_in, note) VALUES (?, ?, ?)')
      .run(ctx.user.id, new Date().toISOString(), note);
    return clockStatus(db, ctx.user.id);
  });

  router.post('/api/time/clock-out', (ctx) => {
    const open = openEntry(db, ctx.user.id);
    if (!open) throw new HttpError(409, 'No tienes ninguna jornada abierta');
    const v = new Validator(ctx.body, { partial: true });
    v.string('note', 'Nota', { max: 500 });
    const { note } = v.done();
    db.prepare('UPDATE time_entries SET clock_out = ?, note = ? WHERE id = ?')
      .run(new Date().toISOString(), note ?? open.note, open.id);
    return clockStatus(db, ctx.user.id);
  });

  router.get('/api/time', (ctx) => {
    const employeeId = Number(ctx.query.get('employee_id')) || ctx.user.id;
    if (!canSupervise(ctx.user, getEmployeeOr404(db, employeeId))) throw forbidden();
    const range = parseRange(ctx.query);
    const entries = db.prepare(`${SELECT} WHERE t.employee_id = ? AND t.clock_in >= ? AND t.clock_in < ? ORDER BY t.clock_in DESC`)
      .all(employeeId, range.fromIso, range.toIso)
      .map(withMinutes);
    return {
      from: range.from,
      to: range.to,
      entries,
      total_minutes: entries.reduce((sum, e) => sum + e.minutes, 0),
    };
  });

  router.get('/api/time/export.csv', (ctx) => {
    const range = parseRange(ctx.query);
    const requested = Number(ctx.query.get('employee_id'));
    let rows;
    if (!requested && isHR(ctx.user)) {
      rows = db.prepare(`${SELECT} WHERE t.clock_in >= ? AND t.clock_in < ? ORDER BY e.last_name, e.first_name, t.clock_in`)
        .all(range.fromIso, range.toIso);
    } else {
      const employeeId = requested || ctx.user.id;
      if (!canSupervise(ctx.user, getEmployeeOr404(db, employeeId))) throw forbidden();
      rows = db.prepare(`${SELECT} WHERE t.employee_id = ? AND t.clock_in >= ? AND t.clock_in < ? ORDER BY t.clock_in`)
        .all(employeeId, range.fromIso, range.toIso);
    }
    const data = rows.map((r) => {
      const start = formatLocal(r.clock_in);
      const end = formatLocal(r.clock_out);
      const mins = r.clock_out ? minutes(r) : '';
      return {
        employee: r.employee_name,
        email: r.employee_email,
        date: start.date,
        clock_in: start.time,
        clock_out: r.clock_out ? (end.date === start.date ? end.time : `${end.date} ${end.time}`) : '',
        hours: mins === '' ? '' : (mins / 60).toFixed(2).replace('.', ','),
        note: r.note,
        edited: r.edited_at ? `${r.edited_by_name ?? ''} (${formatLocal(r.edited_at).date})` : '',
      };
    });
    return csvReply(`registro-jornada_${range.from}_${range.to}.csv`, [
      { key: 'employee', label: 'Empleado' },
      { key: 'email', label: 'Email' },
      { key: 'date', label: 'Fecha' },
      { key: 'clock_in', label: 'Entrada' },
      { key: 'clock_out', label: 'Salida' },
      { key: 'hours', label: 'Horas' },
      { key: 'note', label: 'Nota' },
      { key: 'edited', label: 'Corregido por' },
    ], data);
  });

  // Corrección de un fichaje por RR. HH.: queda registrado quién y cuándo lo modificó.
  router.put('/api/time/:id', (ctx) => {
    requireHR(ctx.user);
    const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(ctx.params.id);
    if (!entry) throw new HttpError(404, 'Registro no encontrado');

    const clockIn = ctx.body.clock_in !== undefined ? parseDateTime(ctx.body.clock_in, 'clock_in', 'La entrada') : entry.clock_in;
    let clockOut = entry.clock_out;
    if (ctx.body.clock_out !== undefined) {
      clockOut = ctx.body.clock_out === null || ctx.body.clock_out === ''
        ? null
        : parseDateTime(ctx.body.clock_out, 'clock_out', 'La salida');
    }
    const v = new Validator(ctx.body, { partial: true });
    v.string('note', 'Nota', { max: 500 });
    const { note } = v.done();

    const fail = (field, message) => {
      throw new HttpError(400, 'Revisa los datos del formulario', { [field]: message });
    };
    if (Date.parse(clockIn) > Date.now()) fail('clock_in', 'La entrada no puede estar en el futuro');
    if (clockOut) {
      if (Date.parse(clockOut) <= Date.parse(clockIn)) fail('clock_out', 'La salida debe ser posterior a la entrada');
      if (Date.parse(clockOut) - Date.parse(clockIn) > MAX_SHIFT_MS) fail('clock_out', 'Una jornada no puede superar 24 horas');
      if (Date.parse(clockOut) > Date.now()) fail('clock_out', 'La salida no puede estar en el futuro');
    } else {
      const other = db.prepare('SELECT 1 FROM time_entries WHERE employee_id = ? AND clock_out IS NULL AND id <> ?')
        .get(entry.employee_id, entry.id);
      if (other) fail('clock_out', 'El empleado ya tiene otra jornada abierta');
    }

    db.prepare(`
      UPDATE time_entries SET clock_in = ?, clock_out = ?, note = ?, edited_by = ?, edited_at = ? WHERE id = ?
    `).run(clockIn, clockOut, note ?? entry.note, ctx.user.id, new Date().toISOString(), entry.id);
    return { entry: withMinutes(db.prepare(`${SELECT} WHERE t.id = ?`).get(entry.id)) };
  });
}
