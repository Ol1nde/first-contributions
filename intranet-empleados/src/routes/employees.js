import { csvReply, HttpError } from '../http.js';
import {
  canAssignRole, canManageEmployee, EMPLOYEE_STATUSES, forbidden, isHR, requireAdmin, requireHR, ROLES,
} from '../permissions.js';
import { EMPLOYEE_SELECT, escapeLike, getEmployeeOr404, shapeEmployee } from '../queries.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../security.js';
import { Validator } from '../validate.js';
import { CARD_PATTERN, normalizeCard } from './kiosks.js';

const COLUMNS = [
  'first_name', 'last_name', 'email', 'phone', 'position', 'department_id', 'manager_id',
  'hire_date', 'birth_date', 'status', 'role', 'vacation_days', 'nfc_uid',
];

function validateEmployee(body, { partial }) {
  const v = new Validator(body, { partial });
  v.string('first_name', 'Nombre', { required: true, max: 100 });
  v.string('last_name', 'Apellidos', { required: true, max: 150 });
  v.email('email', 'Email', { required: true });
  v.string('phone', 'Teléfono', { max: 40 });
  v.string('position', 'Puesto', { max: 150 });
  v.int('department_id', 'Departamento', { min: 1 });
  v.int('manager_id', 'Responsable', { min: 1 });
  v.date('hire_date', 'Fecha de alta');
  v.date('birth_date', 'Fecha de nacimiento');
  v.oneOf('status', 'Estado', EMPLOYEE_STATUSES, { defaultValue: 'activo' });
  v.oneOf('role', 'Rol', ROLES, { defaultValue: 'empleado' });
  v.int('vacation_days', 'Días de vacaciones', { min: 0, max: 60, defaultValue: 22 });
  if (!partial || Object.hasOwn(body ?? {}, 'nfc_uid')) {
    const card = normalizeCard(body?.nfc_uid);
    if (card && !CARD_PATTERN.test(card)) v.addError('nfc_uid', 'El código de la tarjeta no es válido');
    else v.out.nfc_uid = card || null;
  }
  if (!partial && body?.password) {
    const pwd = String(body.password);
    if (pwd.length < MIN_PASSWORD_LENGTH) v.addError('password', `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
  }
  return v;
}

function checkReferences(db, v, data, employeeId) {
  if (data.department_id && !db.prepare('SELECT 1 FROM departments WHERE id = ?').get(data.department_id)) {
    v.addError('department_id', 'El departamento no existe');
  }
  if (data.manager_id) {
    if (data.manager_id === employeeId) {
      v.addError('manager_id', 'Un empleado no puede ser su propio responsable');
    } else if (!db.prepare('SELECT 1 FROM employees WHERE id = ?').get(data.manager_id)) {
      v.addError('manager_id', 'El responsable no existe');
    } else if (employeeId) {
      // Evita ciclos en la jerarquía (A responsable de B y B responsable de A).
      const parent = db.prepare('SELECT manager_id FROM employees WHERE id = ?');
      let current = data.manager_id;
      for (let i = 0; current && i < 1000; i += 1) {
        if (current === employeeId) {
          v.addError('manager_id', 'Esa asignación crearía un ciclo en la jerarquía');
          break;
        }
        current = parent.get(current)?.manager_id;
      }
    }
  }
}

function isUniqueViolation(err) {
  return /UNIQUE constraint failed: employees\.email/.test(err?.message ?? '');
}

/** Traduce los conflictos de email o tarjeta duplicados a un error 409 legible. */
function conflictError(db, err, data) {
  if (isUniqueViolation(err)) return new HttpError(409, 'Ya existe un empleado con ese email', { email: 'Ya existe un empleado con ese email' });
  if (/UNIQUE constraint failed: employees\.nfc_uid/.test(err?.message ?? '')) {
    const owner = db.prepare("SELECT first_name || ' ' || last_name AS name FROM employees WHERE nfc_uid = ?").get(data.nfc_uid);
    const message = `Esa tarjeta ya está asignada a ${owner?.name ?? 'otro empleado'}`;
    return new HttpError(409, message, { nfc_uid: message });
  }
  return err;
}

export default function registerEmployees(router, { db }) {
  router.get('/api/employees', (ctx) => {
    const where = [];
    const params = [];
    const q = ctx.query.get('q')?.trim();
    if (q) {
      const like = `%${escapeLike(q)}%`;
      where.push(`(e.first_name || ' ' || e.last_name LIKE ? ESCAPE '\\' OR e.email LIKE ? ESCAPE '\\' OR e.position LIKE ? ESCAPE '\\')`);
      params.push(like, like, like);
    }
    const department = Number(ctx.query.get('department_id'));
    if (Number.isInteger(department) && department > 0) {
      where.push('e.department_id = ?');
      params.push(department);
    }
    const status = ctx.query.get('status');
    if (!isHR(ctx.user)) {
      where.push("e.status <> 'baja'");
    } else if (EMPLOYEE_STATUSES.includes(status)) {
      where.push('e.status = ?');
      params.push(status);
    }
    const sql = `${EMPLOYEE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY e.last_name COLLATE NOCASE, e.first_name COLLATE NOCASE`;
    const rows = db.prepare(sql).all(...params);
    return { employees: rows.map((r) => shapeEmployee(r, ctx.user)) };
  });

  router.get('/api/employees/export.csv', (ctx) => {
    requireHR(ctx.user);
    const rows = db.prepare(`${EMPLOYEE_SELECT} ORDER BY e.last_name COLLATE NOCASE, e.first_name COLLATE NOCASE`).all();
    return csvReply('empleados.csv', [
      { key: 'id', label: 'ID' },
      { key: 'first_name', label: 'Nombre' },
      { key: 'last_name', label: 'Apellidos' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Teléfono' },
      { key: 'position', label: 'Puesto' },
      { key: 'department_name', label: 'Departamento' },
      { key: 'manager_name', label: 'Responsable' },
      { key: 'hire_date', label: 'Fecha de alta' },
      { key: 'birth_date', label: 'Fecha de nacimiento' },
      { key: 'status', label: 'Estado' },
      { key: 'role', label: 'Rol' },
      { key: 'vacation_days', label: 'Días de vacaciones' },
      { key: 'nfc_uid', label: 'Tarjeta NFC' },
    ], rows);
  });

  router.get('/api/employees/:id', (ctx) => {
    const row = getEmployeeOr404(db, ctx.params.id);
    if (row.status === 'baja' && !isHR(ctx.user) && row.id !== ctx.user.id) {
      throw new HttpError(404, 'Empleado no encontrado');
    }
    const reports = db.prepare(`
      SELECT id, first_name, last_name, position FROM employees
      WHERE manager_id = ? AND status <> 'baja'
      ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE
    `).all(row.id);
    return { employee: shapeEmployee(row, ctx.user), reports };
  });

  router.post('/api/employees', async (ctx) => {
    requireHR(ctx.user);
    const v = validateEmployee(ctx.body, { partial: false });
    const data = v.out;
    checkReferences(db, v, data, null);
    if (data.role && !canAssignRole(ctx.user, data.role)) v.addError('role', 'No puedes asignar ese rol');
    v.done();

    const password = ctx.body.password ? await hashPassword(String(ctx.body.password)) : null;
    try {
      const { lastInsertRowid } = db.prepare(`
        INSERT INTO employees (${COLUMNS.join(', ')}, password_hash)
        VALUES (${COLUMNS.map(() => '?').join(', ')}, ?)
      `).run(...COLUMNS.map((c) => data[c]), password);
      return { employee: shapeEmployee(getEmployeeOr404(db, Number(lastInsertRowid)), ctx.user) };
    } catch (err) {
      throw conflictError(db, err, data);
    }
  });

  router.put('/api/employees/:id', (ctx) => {
    requireHR(ctx.user);
    const target = getEmployeeOr404(db, ctx.params.id);
    if (!canManageEmployee(ctx.user, target)) throw forbidden('Solo un administrador puede modificar a otro administrador');

    const v = validateEmployee(ctx.body, { partial: true });
    const data = v.out;
    checkReferences(db, v, data, target.id);
    if (data.role !== undefined && data.role !== target.role && !canAssignRole(ctx.user, data.role)) {
      v.addError('role', 'No puedes asignar ese rol');
    }
    v.done();

    const losesAdmin = target.role === 'admin' && (
      (data.role !== undefined && data.role !== 'admin') || (data.status !== undefined && data.status !== 'activo'));
    if (losesAdmin) {
      const { n } = db.prepare("SELECT COUNT(*) AS n FROM employees WHERE role = 'admin' AND status = 'activo'").get();
      if (n <= 1) throw new HttpError(409, 'Debe existir al menos un administrador activo');
    }

    const fields = COLUMNS.filter((c) => data[c] !== undefined);
    if (fields.length > 0) {
      try {
        db.prepare(`
          UPDATE employees SET ${fields.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now')
          WHERE id = ?
        `).run(...fields.map((c) => data[c]), target.id);
      } catch (err) {
        throw conflictError(db, err, data);
      }
    }
    if (data.status === 'baja') db.prepare('DELETE FROM sessions WHERE employee_id = ?').run(target.id);
    return { employee: shapeEmployee(getEmployeeOr404(db, target.id), ctx.user) };
  });

  router.put('/api/employees/:id/password', async (ctx) => {
    requireHR(ctx.user);
    const target = getEmployeeOr404(db, ctx.params.id);
    if (!canManageEmployee(ctx.user, target)) throw forbidden('Solo un administrador puede modificar a otro administrador');
    const password = String(ctx.body.password ?? '');
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, 'Revisa los datos del formulario', {
        password: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
      });
    }
    db.prepare("UPDATE employees SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .run(await hashPassword(password), target.id);
    db.prepare('DELETE FROM sessions WHERE employee_id = ?').run(target.id);
    return { ok: true };
  });

  router.delete('/api/employees/:id', (ctx) => {
    requireAdmin(ctx.user);
    const target = getEmployeeOr404(db, ctx.params.id);
    if (target.id === ctx.user.id) throw new HttpError(409, 'No puedes eliminar tu propia cuenta');
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM time_entries WHERE employee_id = ?').get(target.id);
    if (n > 0) {
      throw new HttpError(409, 'El empleado tiene registros de jornada que deben conservarse. Márcalo como «baja» en lugar de eliminarlo.');
    }
    db.prepare('DELETE FROM employees WHERE id = ?').run(target.id);
    return { ok: true };
  });
}
