import { HttpError } from '../http.js';
import { canSupervise, forbidden, isHR } from '../permissions.js';
import { getEmployeeOr404, vacationBalance } from '../queries.js';
import { daysBetween, localDate, Validator, workingDays } from '../validate.js';

export const LEAVE_TYPES = ['vacaciones', 'asuntos_propios', 'baja_medica', 'permiso_retribuido', 'otro'];
const LEAVE_STATUSES = ['pendiente', 'aprobada', 'rechazada', 'cancelada'];

const SELECT = `
  SELECT l.id, l.employee_id, l.type, l.start_date, l.end_date, l.days, l.reason, l.status,
         l.reviewed_by, l.reviewed_at, l.review_comment, l.created_at,
         e.first_name || ' ' || e.last_name AS employee_name, e.manager_id, d.name AS department_name,
         CASE WHEN r.id IS NULL THEN NULL ELSE r.first_name || ' ' || r.last_name END AS reviewer_name
  FROM leave_requests l
  JOIN employees e ON e.id = l.employee_id
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN employees r ON r.id = l.reviewed_by
`;

function canReview(user, leave) {
  return leave.employee_id !== user.id && (isHR(user) || leave.manager_id === user.id);
}

function canCancel(user, leave) {
  if (leave.employee_id !== user.id && !isHR(user)) return false;
  return leave.status === 'pendiente' || (leave.status === 'aprobada' && leave.start_date > localDate());
}

function shape(user, leave) {
  const { manager_id: _managerId, ...rest } = leave;
  return {
    ...rest,
    can_review: leave.status === 'pendiente' && canReview(user, leave),
    can_cancel: canCancel(user, leave),
  };
}

function getLeaveOr404(db, id) {
  const row = db.prepare(`${SELECT} WHERE l.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Solicitud no encontrada');
  return row;
}

export default function registerLeaves(router, { db }) {
  router.get('/api/leaves', (ctx) => {
    const scope = ctx.query.get('scope') ?? 'mine';
    const where = [];
    const params = [];

    if (scope === 'review') {
      if (isHR(ctx.user)) {
        where.push('l.employee_id <> ?');
        params.push(ctx.user.id);
      } else if (ctx.user.role === 'responsable') {
        where.push('e.manager_id = ?');
        params.push(ctx.user.id);
      } else {
        throw forbidden();
      }
    } else {
      const employeeId = Number(ctx.query.get('employee_id')) || ctx.user.id;
      if (!canSupervise(ctx.user, getEmployeeOr404(db, employeeId))) throw forbidden();
      where.push('l.employee_id = ?');
      params.push(employeeId);
    }

    const status = ctx.query.get('status');
    if (LEAVE_STATUSES.includes(status)) {
      where.push('l.status = ?');
      params.push(status);
    }
    const year = ctx.query.get('year');
    if (/^\d{4}$/.test(year ?? '')) {
      where.push('substr(l.start_date, 1, 4) = ?');
      params.push(year);
    }

    const rows = db.prepare(`${SELECT} WHERE ${where.join(' AND ')}
      ORDER BY l.status = 'pendiente' DESC, l.start_date DESC, l.id DESC`).all(...params);
    return { leaves: rows.map((r) => shape(ctx.user, r)) };
  });

  router.get('/api/leaves/balance', (ctx) => {
    const employeeId = Number(ctx.query.get('employee_id')) || ctx.user.id;
    if (!canSupervise(ctx.user, getEmployeeOr404(db, employeeId))) throw forbidden();
    const year = Number(ctx.query.get('year')) || new Date().getFullYear();
    return { balance: vacationBalance(db, employeeId, year) };
  });

  router.post('/api/leaves', (ctx) => {
    const v = new Validator(ctx.body);
    v.oneOf('type', 'Tipo', LEAVE_TYPES, { required: true });
    v.date('start_date', 'Fecha de inicio', { required: true });
    v.date('end_date', 'Fecha de fin', { required: true });
    v.string('reason', 'Motivo', { max: 1000 });
    v.int('employee_id', 'Empleado', { min: 1 });
    const data = v.done();

    const employeeId = data.employee_id ?? ctx.user.id;
    if (employeeId !== ctx.user.id && !isHR(ctx.user)) throw forbidden('Solo RR. HH. puede registrar ausencias de otros empleados');
    const employee = getEmployeeOr404(db, employeeId);
    if (employee.status === 'baja') throw new HttpError(409, 'El empleado está dado de baja');

    const fail = (field, message) => {
      throw new HttpError(400, 'Revisa los datos del formulario', { [field]: message });
    };
    if (data.end_date < data.start_date) fail('end_date', 'La fecha de fin no puede ser anterior a la de inicio');
    if (daysBetween(data.start_date, data.end_date) > 365) fail('end_date', 'El periodo no puede superar un año');
    if (['vacaciones', 'asuntos_propios'].includes(data.type) && data.start_date < localDate() && !isHR(ctx.user)) {
      fail('start_date', 'No se pueden solicitar días en fechas pasadas');
    }
    const days = workingDays(data.start_date, data.end_date);
    if (days === 0) fail('end_date', 'El periodo no incluye ningún día laborable');

    if (data.type === 'vacaciones') {
      if (data.start_date.slice(0, 4) !== data.end_date.slice(0, 4)) {
        fail('end_date', 'Las vacaciones de años distintos deben solicitarse por separado');
      }
      const balance = vacationBalance(db, employeeId, Number(data.start_date.slice(0, 4)));
      if (days > balance.available) {
        fail('end_date', `Solo quedan ${balance.available} días de vacaciones disponibles (la solicitud es de ${days})`);
      }
    }

    const overlap = db.prepare(`
      SELECT 1 FROM leave_requests
      WHERE employee_id = ? AND status IN ('pendiente', 'aprobada') AND start_date <= ? AND end_date >= ?
    `).get(employeeId, data.end_date, data.start_date);
    if (overlap) throw new HttpError(409, 'Ya existe una solicitud pendiente o aprobada que se solapa con esas fechas');

    const { lastInsertRowid } = db.prepare(`
      INSERT INTO leave_requests (employee_id, type, start_date, end_date, days, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(employeeId, data.type, data.start_date, data.end_date, days, data.reason);
    return { leave: shape(ctx.user, getLeaveOr404(db, Number(lastInsertRowid))) };
  });

  router.put('/api/leaves/:id/review', (ctx) => {
    const leave = getLeaveOr404(db, ctx.params.id);
    if (!canReview(ctx.user, leave)) throw forbidden('No puedes revisar esta solicitud');
    if (leave.status !== 'pendiente') throw new HttpError(409, 'La solicitud ya fue revisada');
    const v = new Validator(ctx.body);
    v.oneOf('decision', 'Decisión', ['aprobada', 'rechazada'], { required: true });
    v.string('comment', 'Comentario', { max: 1000 });
    const data = v.done();
    db.prepare(`
      UPDATE leave_requests SET status = ?, review_comment = ?, reviewed_by = ?, reviewed_at = ?
      WHERE id = ? AND status = 'pendiente'
    `).run(data.decision, data.comment, ctx.user.id, new Date().toISOString(), leave.id);
    return { leave: shape(ctx.user, getLeaveOr404(db, leave.id)) };
  });

  router.put('/api/leaves/:id/cancel', (ctx) => {
    const leave = getLeaveOr404(db, ctx.params.id);
    if (leave.employee_id !== ctx.user.id && !isHR(ctx.user)) throw forbidden();
    if (!canCancel(ctx.user, leave)) throw new HttpError(409, 'Esta solicitud ya no se puede cancelar');
    db.prepare("UPDATE leave_requests SET status = 'cancelada' WHERE id = ?").run(leave.id);
    return { leave: shape(ctx.user, getLeaveOr404(db, leave.id)) };
  });
}
