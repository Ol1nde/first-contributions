import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword, randomPassword } from './security.js';
import { localDate, workingDays } from './validate.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS departments (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employees (
  id            INTEGER PRIMARY KEY,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone         TEXT NOT NULL DEFAULT '',
  position      TEXT NOT NULL DEFAULT '',
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  manager_id    INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  hire_date     TEXT,
  birth_date    TEXT,
  status        TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo', 'excedencia', 'baja')),
  role          TEXT NOT NULL DEFAULT 'empleado' CHECK (role IN ('admin', 'rrhh', 'responsable', 'empleado')),
  vacation_days INTEGER NOT NULL DEFAULT 22,
  password_hash TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(manager_id);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id             INTEGER PRIMARY KEY,
  employee_id    INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK (type IN ('vacaciones', 'asuntos_propios', 'baja_medica', 'permiso_retribuido', 'otro')),
  start_date     TEXT NOT NULL,
  end_date       TEXT NOT NULL,
  days           INTEGER NOT NULL,
  reason         TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'aprobada', 'rechazada', 'cancelada')),
  reviewed_by    INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  reviewed_at    TEXT,
  review_comment TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leaves_employee ON leave_requests(employee_id, start_date);

CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  pinned     INTEGER NOT NULL DEFAULT 0,
  author_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Registro de jornada. Las horas se guardan en ISO 8601 (UTC).
CREATE TABLE IF NOT EXISTS time_entries (
  id          INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  clock_in    TEXT NOT NULL,
  clock_out   TEXT,
  note        TEXT NOT NULL DEFAULT '',
  edited_by   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  edited_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_time_employee ON time_entries(employee_id, clock_in);
`;

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  db.exec('PRAGMA user_version = 1;');
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function isEmpty(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM employees').get().n === 0;
}

/** Crea el administrador inicial si la base de datos está vacía. */
export async function ensureAdmin(db, { email = 'admin@empresa.local', password }) {
  if (!isEmpty(db)) return null;
  db.prepare(`
    INSERT INTO employees (first_name, last_name, email, position, role, password_hash)
    VALUES ('Administrador', 'Sistema', ?, 'Administrador de la intranet', 'admin', ?)
  `).run(email.toLowerCase(), await hashPassword(password));
  return { email: email.toLowerCase() };
}

/** Asigna una contraseña nueva (aleatoria si no se indica) y cierra las sesiones del usuario. */
export async function resetPassword(db, email, password = randomPassword()) {
  const emp = db.prepare('SELECT id FROM employees WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!emp) return null;
  db.prepare("UPDATE employees SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(await hashPassword(password), emp.id);
  db.prepare('DELETE FROM sessions WHERE employee_id = ?').run(emp.id);
  return password;
}

/** Datos de ejemplo para probar la intranet. Todos los usuarios de demo usan la contraseña indicada. */
export async function seedDemo(db, { password = 'demo1234' } = {}) {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM employees WHERE role <> 'admin'").get();
  if (n > 0) return false;

  const hash = await hashPassword(password);
  const today = new Date();
  const year = today.getFullYear();
  const shift = (days) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return localDate(d);
  };
  const birthdayIn = (days, birthYear) => `${birthYear}${shift(days).slice(4)}`;

  transaction(db, () => {
    const dept = db.prepare('INSERT INTO departments (name, description) VALUES (?, ?)');
    const deps = {};
    for (const [name, description] of [
      ['Dirección', 'Dirección general y estrategia'],
      ['Recursos Humanos', 'Selección, formación, nóminas y relaciones laborales'],
      ['Tecnología', 'Desarrollo, sistemas y soporte técnico'],
      ['Ventas', 'Comercial y atención a clientes'],
      ['Administración y Finanzas', 'Contabilidad, facturación y tesorería'],
    ]) deps[name] = Number(dept.run(name, description).lastInsertRowid);

    const emp = db.prepare(`
      INSERT INTO employees (first_name, last_name, email, phone, position, department_id, manager_id,
                             hire_date, birth_date, role, vacation_days, password_hash)
      VALUES (:first, :last, :email, :phone, :position, :dep, :manager, :hire, :birth, :role, 22, :hash)
    `);
    const add = (first, last, email, phone, position, dep, manager, hire, birth, role) =>
      Number(emp.run({ first, last, email, phone, position, dep: deps[dep], manager, hire, birth, role, hash }).lastInsertRowid);

    const ceo = add('Lucía', 'Martín Gómez', 'lucia.martin@empresa.local', '600 111 001', 'Directora general', 'Dirección', null, '2015-03-02', '1975-06-14', 'responsable');
    const hr = add('Javier', 'Ruiz Navarro', 'javier.ruiz@empresa.local', '600 111 002', 'Responsable de RR. HH.', 'Recursos Humanos', ceo, '2017-09-11', birthdayIn(5, 1982), 'rrhh');
    const cto = add('Elena', 'Sánchez Ortega', 'elena.sanchez@empresa.local', '600 111 003', 'Directora de Tecnología', 'Tecnología', ceo, '2018-01-15', '1984-11-02', 'responsable');
    const sales = add('Carlos', 'López Herrera', 'carlos.lopez@empresa.local', '600 111 004', 'Director comercial', 'Ventas', ceo, '2016-05-23', '1979-02-27', 'responsable');
    const dev1 = add('Ana', 'García Pérez', 'ana.garcia@empresa.local', '600 111 005', 'Desarrolladora sénior', 'Tecnología', cto, '2019-04-01', birthdayIn(12, 1990), 'empleado');
    add('Pablo', 'Fernández Díaz', 'pablo.fernandez@empresa.local', '600 111 006', 'Técnico de sistemas', 'Tecnología', cto, shift(-10), '1995-08-19', 'empleado');
    const rep = add('Marta', 'Romero Castro', 'marta.romero@empresa.local', '600 111 007', 'Comercial', 'Ventas', sales, '2021-02-08', '1992-12-05', 'empleado');
    add('Sergio', 'Moreno Gil', 'sergio.moreno@empresa.local', '600 111 008', 'Comercial', 'Ventas', sales, '2022-10-03', birthdayIn(25, 1988), 'empleado');
    add('Laura', 'Jiménez Vidal', 'laura.jimenez@empresa.local', '600 111 009', 'Técnica de nóminas', 'Recursos Humanos', hr, '2020-06-15', '1987-03-30', 'empleado');
    add('Diego', 'Álvarez Rubio', 'diego.alvarez@empresa.local', '600 111 010', 'Contable', 'Administración y Finanzas', ceo, '2018-07-02', '1983-09-09', 'empleado');

    const leave = db.prepare(`
      INSERT INTO leave_requests (employee_id, type, start_date, end_date, days, reason, status, reviewed_by, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const addLeave = (employee, type, start, end, reason, status, reviewer) =>
      leave.run(employee, type, start, end, workingDays(start, end), reason, status, reviewer ?? null, reviewer ? new Date().toISOString() : null);
    addLeave(dev1, 'vacaciones', shift(14), shift(18), 'Viaje familiar', 'pendiente');
    addLeave(rep, 'asuntos_propios', shift(-1), shift(1), 'Mudanza', 'aprobada', sales);
    addLeave(dev1, 'vacaciones', `${year}-01-02`, `${year}-01-05`, 'Navidades', 'aprobada', cto);

    const ann = db.prepare('INSERT INTO announcements (title, body, pinned, author_id) VALUES (?, ?, ?, ?)');
    ann.run('Calendario laboral', 'Ya está disponible el calendario laboral del año. Recordad planificar vuestras vacaciones con al menos 15 días de antelación.', 1, hr);
    ann.run('Registro de jornada', 'Os recordamos que es obligatorio fichar la entrada y la salida cada día desde la sección «Fichaje».', 0, hr);
    ann.run('¡Bienvenido, Pablo!', 'Pablo se incorpora al equipo de Tecnología como técnico de sistemas. ¡Dadle la bienvenida!', 0, cto);

    const time = db.prepare('INSERT INTO time_entries (employee_id, clock_in, clock_out) VALUES (?, ?, ?)');
    for (let i = 1; i <= 5; i += 1) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      for (const id of [dev1, rep]) {
        const start = new Date(d); start.setHours(8, 30 + (id % 3) * 5, 0, 0);
        const end = new Date(d); end.setHours(17, 15 + (id % 4) * 5, 0, 0);
        time.run(id, start.toISOString(), end.toISOString());
      }
    }
  });
  return true;
}
