import { HttpError } from './http.js';

export const ROLES = ['admin', 'rrhh', 'responsable', 'empleado'];
export const EMPLOYEE_STATUSES = ['activo', 'excedencia', 'baja'];

export function isHR(user) {
  return user.role === 'admin' || user.role === 'rrhh';
}

export function forbidden(message = 'No tienes permiso para realizar esta acción') {
  return new HttpError(403, message);
}

export function requireHR(user) {
  if (!isHR(user)) throw forbidden();
}

export function requireAdmin(user) {
  if (user.role !== 'admin') throw forbidden();
}

/** RR. HH. gestiona a cualquier empleado salvo a los administradores. */
export function canManageEmployee(user, target) {
  if (user.role === 'admin') return true;
  return user.role === 'rrhh' && target.role !== 'admin';
}

/** Solo un administrador puede conceder los roles «admin» y «rrhh». */
export function canAssignRole(user, role) {
  if (user.role === 'admin') return true;
  return user.role === 'rrhh' && (role === 'empleado' || role === 'responsable');
}

/** Acceso a datos personales de otro empleado (ausencias, jornada): él mismo, RR. HH. o su responsable. */
export function canSupervise(user, employee) {
  return isHR(user) || employee.id === user.id || employee.manager_id === user.id;
}
