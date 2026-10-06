import { transaction } from '../db.js';
import { HttpError } from '../http.js';
import { isHR, requireHR } from '../permissions.js';
import { localDate, Validator } from '../validate.js';

const fmt = (date) => date.split('-').reverse().join('/');
const fmtRange = (start, end) => (start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`);

/**
 * Primera solicitud de vacaciones de otro miembro de alguno de los grupos del empleado que se solapa
 * con el periodo indicado. `statuses` decide qué solicitudes bloquean (pendientes y/o aprobadas).
 */
export function findVacationConflict(db, employeeId, start, end, { statuses = ['pendiente', 'aprobada'], excludeLeaveId = 0 } = {}) {
  return db.prepare(`
    SELECT l.id, l.employee_id, l.start_date, l.end_date, l.status,
           e.first_name || ' ' || e.last_name AS employee_name, g.name AS group_name
    FROM vacation_group_members me
    JOIN vacation_group_members other ON other.group_id = me.group_id AND other.employee_id <> me.employee_id
    JOIN vacation_groups g ON g.id = me.group_id
    JOIN leave_requests l ON l.employee_id = other.employee_id
    JOIN employees e ON e.id = l.employee_id
    WHERE me.employee_id = ? AND l.type = 'vacaciones' AND l.id <> ? AND e.status <> 'baja'
      AND l.status IN (${statuses.map(() => '?').join(', ')})
      AND l.start_date <= ? AND l.end_date >= ?
    ORDER BY l.start_date
    LIMIT 1
  `).get(employeeId, excludeLeaveId, ...statuses, end, start) ?? null;
}

export function conflictMessage(conflict, prefix) {
  const state = conflict.status === 'aprobada' ? 'aprobadas' : 'pendientes de aprobar';
  return `${prefix}: coincide con las vacaciones ${state} de ${conflict.employee_name} (${fmtRange(conflict.start_date, conflict.end_date)}). `
    + `Los miembros del grupo «${conflict.group_name}» no pueden coincidir de vacaciones.`;
}

const SELECT_GROUPS = 'SELECT id, name, description FROM vacation_groups';

function membersOf(db, groupId) {
  return db.prepare(`
    SELECT e.id, e.first_name, e.last_name, e.position, e.status
    FROM vacation_group_members m JOIN employees e ON e.id = m.employee_id
    WHERE m.group_id = ?
    ORDER BY e.last_name COLLATE NOCASE, e.first_name COLLATE NOCASE
  `).all(groupId);
}

/** Vacaciones futuras de miembros del grupo que ya se solapan (p. ej. pedidas antes de crear el grupo). */
function overlapsInGroup(db, groupId) {
  return db.prepare(`
    SELECT ea.first_name || ' ' || ea.last_name AS employee_a, a.start_date AS start_a, a.end_date AS end_a,
           eb.first_name || ' ' || eb.last_name AS employee_b, b.start_date AS start_b, b.end_date AS end_b
    FROM leave_requests a
    JOIN leave_requests b ON a.id < b.id AND a.employee_id <> b.employee_id
      AND a.start_date <= b.end_date AND a.end_date >= b.start_date
    JOIN vacation_group_members ma ON ma.employee_id = a.employee_id AND ma.group_id = ?
    JOIN vacation_group_members mb ON mb.employee_id = b.employee_id AND mb.group_id = ?
    JOIN employees ea ON ea.id = a.employee_id
    JOIN employees eb ON eb.id = b.employee_id
    WHERE a.type = 'vacaciones' AND b.type = 'vacaciones'
      AND a.status IN ('pendiente', 'aprobada') AND b.status IN ('pendiente', 'aprobada')
      AND a.end_date >= ? AND b.end_date >= ?
    ORDER BY a.start_date
  `).all(groupId, groupId, localDate(), localDate());
}

function getGroupOr404(db, id) {
  const group = db.prepare(`${SELECT_GROUPS} WHERE id = ?`).get(id);
  if (!group) throw new HttpError(404, 'Grupo no encontrado');
  return group;
}

function validate(db, body, partial) {
  const v = new Validator(body, { partial });
  v.string('name', 'Nombre', { required: true, max: 100 });
  v.string('description', 'Descripción', { max: 500 });
  const data = v.out;
  if (!partial || Object.hasOwn(body, 'member_ids')) {
    const raw = body.member_ids;
    const ids = Array.isArray(raw) ? [...new Set(raw.map(Number))] : [];
    if (!Array.isArray(raw) || ids.some((id) => !Number.isInteger(id) || id < 1)) {
      v.addError('member_ids', 'Selecciona los empleados del grupo');
    } else if (ids.length < 2) {
      v.addError('member_ids', 'Selecciona al menos dos empleados');
    } else {
      const found = db.prepare(`SELECT COUNT(*) AS n FROM employees WHERE id IN (${ids.map(() => '?').join(', ')})`).get(...ids).n;
      if (found !== ids.length) v.addError('member_ids', 'Alguno de los empleados no existe');
      else data.member_ids = ids;
    }
  }
  v.done();
  return data;
}

function duplicate(err) {
  if (/UNIQUE constraint failed: vacation_groups\.name/.test(err?.message ?? '')) {
    return new HttpError(409, 'Ya existe un grupo con ese nombre', { name: 'Ya existe un grupo con ese nombre' });
  }
  return err;
}

function saveMembers(db, groupId, memberIds) {
  db.prepare('DELETE FROM vacation_group_members WHERE group_id = ?').run(groupId);
  const insert = db.prepare('INSERT INTO vacation_group_members (group_id, employee_id) VALUES (?, ?)');
  for (const id of memberIds) insert.run(groupId, id);
}

function shape(db, group, withOverlaps) {
  return {
    ...group,
    members: membersOf(db, group.id),
    ...(withOverlaps ? { overlaps: overlapsInGroup(db, group.id) } : {}),
  };
}

export default function registerVacationGroups(router, { db }) {
  // RR. HH. ve todos los grupos; el resto, solo los grupos a los que pertenece.
  router.get('/api/vacation-groups', (ctx) => {
    const hr = isHR(ctx.user);
    const groups = hr
      ? db.prepare(`${SELECT_GROUPS} ORDER BY name COLLATE NOCASE`).all()
      : db.prepare(`${SELECT_GROUPS} WHERE id IN (SELECT group_id FROM vacation_group_members WHERE employee_id = ?) ORDER BY name COLLATE NOCASE`).all(ctx.user.id);
    return { groups: groups.map((g) => shape(db, g, hr)) };
  });

  router.post('/api/vacation-groups', (ctx) => {
    requireHR(ctx.user);
    const data = validate(db, ctx.body, false);
    try {
      const id = transaction(db, () => {
        const { lastInsertRowid } = db.prepare('INSERT INTO vacation_groups (name, description) VALUES (?, ?)').run(data.name, data.description);
        saveMembers(db, Number(lastInsertRowid), data.member_ids);
        return Number(lastInsertRowid);
      });
      return { group: shape(db, getGroupOr404(db, id), true) };
    } catch (err) {
      throw duplicate(err);
    }
  });

  router.put('/api/vacation-groups/:id', (ctx) => {
    requireHR(ctx.user);
    const current = getGroupOr404(db, ctx.params.id);
    const data = validate(db, ctx.body, true);
    try {
      transaction(db, () => {
        db.prepare('UPDATE vacation_groups SET name = ?, description = ? WHERE id = ?')
          .run(data.name ?? current.name, data.description ?? current.description, current.id);
        if (data.member_ids) saveMembers(db, current.id, data.member_ids);
      });
    } catch (err) {
      throw duplicate(err);
    }
    return { group: shape(db, getGroupOr404(db, current.id), true) };
  });

  router.delete('/api/vacation-groups/:id', (ctx) => {
    requireHR(ctx.user);
    const current = getGroupOr404(db, ctx.params.id);
    db.prepare('DELETE FROM vacation_groups WHERE id = ?').run(current.id);
    return { ok: true };
  });
}
