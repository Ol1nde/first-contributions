import { HttpError } from '../http.js';
import { requireHR } from '../permissions.js';
import { Validator } from '../validate.js';

const SELECT = `
  SELECT d.id, d.name, d.description,
         (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.status <> 'baja') AS employee_count
  FROM departments d
`;

function getDepartmentOr404(db, id) {
  const row = db.prepare(`${SELECT} WHERE d.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Departamento no encontrado');
  return row;
}

function validate(body, partial) {
  const v = new Validator(body, { partial });
  v.string('name', 'Nombre', { required: true, max: 100 });
  v.string('description', 'Descripción', { max: 500 });
  return v.done();
}

function duplicate(err) {
  if (/UNIQUE constraint failed: departments\.name/.test(err?.message ?? '')) {
    return new HttpError(409, 'Ya existe un departamento con ese nombre', { name: 'Ya existe un departamento con ese nombre' });
  }
  return err;
}

export default function registerDepartments(router, { db }) {
  router.get('/api/departments', () => ({
    departments: db.prepare(`${SELECT} ORDER BY d.name COLLATE NOCASE`).all(),
  }));

  router.post('/api/departments', (ctx) => {
    requireHR(ctx.user);
    const data = validate(ctx.body, false);
    try {
      const { lastInsertRowid } = db.prepare('INSERT INTO departments (name, description) VALUES (?, ?)')
        .run(data.name, data.description);
      return { department: getDepartmentOr404(db, Number(lastInsertRowid)) };
    } catch (err) {
      throw duplicate(err);
    }
  });

  router.put('/api/departments/:id', (ctx) => {
    requireHR(ctx.user);
    const current = getDepartmentOr404(db, ctx.params.id);
    const data = validate(ctx.body, true);
    try {
      db.prepare('UPDATE departments SET name = ?, description = ? WHERE id = ?')
        .run(data.name ?? current.name, data.description ?? current.description, current.id);
    } catch (err) {
      throw duplicate(err);
    }
    return { department: getDepartmentOr404(db, current.id) };
  });

  router.delete('/api/departments/:id', (ctx) => {
    requireHR(ctx.user);
    const current = getDepartmentOr404(db, ctx.params.id);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM employees WHERE department_id = ?').get(current.id);
    if (n > 0) throw new HttpError(409, 'No se puede eliminar un departamento con empleados asignados');
    db.prepare('DELETE FROM departments WHERE id = ?').run(current.id);
    return { ok: true };
  });
}
