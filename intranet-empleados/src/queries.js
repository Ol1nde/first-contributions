import { HttpError } from './http.js';
import { isHR } from './permissions.js';

export const EMPLOYEE_SELECT = `
  SELECT e.id, e.first_name, e.last_name, e.email, e.phone, e.position, e.status, e.role,
         e.hire_date, e.birth_date, e.vacation_days, e.created_at, e.updated_at, e.nfc_uid,
         e.department_id, d.name AS department_name,
         e.manager_id, CASE WHEN m.id IS NULL THEN NULL ELSE m.first_name || ' ' || m.last_name END AS manager_name,
         e.password_hash IS NOT NULL AS has_password
  FROM employees e
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN employees m ON m.id = e.manager_id
`;

const PUBLIC_FIELDS = [
  'id', 'first_name', 'last_name', 'email', 'phone', 'position', 'status',
  'department_id', 'department_name', 'manager_id', 'manager_name',
];

/** Elimina los datos personales cuando quien consulta no es RR. HH. ni el propio empleado. */
export function shapeEmployee(row, viewer) {
  const full = { ...row, has_password: Boolean(row.has_password) };
  if (isHR(viewer) || viewer.id === row.id) return full;
  return Object.fromEntries(PUBLIC_FIELDS.map((k) => [k, full[k]]));
}

export function findEmployee(db, id) {
  return db.prepare(`${EMPLOYEE_SELECT} WHERE e.id = ?`).get(id);
}

export function getEmployeeOr404(db, id) {
  const row = findEmployee(db, id);
  if (!row) throw new HttpError(404, 'Empleado no encontrado');
  return row;
}

/** Saldo de vacaciones de un año: los días aprobados y pendientes cuentan como consumidos. */
export function vacationBalance(db, employeeId, year) {
  const emp = db.prepare('SELECT vacation_days FROM employees WHERE id = ?').get(employeeId);
  const sums = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN status = 'aprobada' THEN days END), 0) AS used,
           COALESCE(SUM(CASE WHEN status = 'pendiente' THEN days END), 0) AS pending
    FROM leave_requests
    WHERE employee_id = ? AND type = 'vacaciones' AND substr(start_date, 1, 4) = ?
  `).get(employeeId, String(year));
  const allowance = emp?.vacation_days ?? 0;
  return { year, allowance, used: sums.used, pending: sums.pending, available: allowance - sums.used - sums.pending };
}

export function escapeLike(value) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
