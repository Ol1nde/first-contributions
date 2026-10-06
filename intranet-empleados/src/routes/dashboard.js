import { canSupervise, isHR } from '../permissions.js';
import { vacationBalance } from '../queries.js';
import { daysBetween, localDate } from '../validate.js';
import { latestAnnouncements } from './announcements.js';
import { clockStatus } from './time.js';

const UPCOMING_DAYS = 14;
const BIRTHDAY_DAYS = 30;

function addDays(date, days) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

/** Próximo cumpleaños (AAAA-MM-DD) a partir de hoy; el 29 de febrero se celebra el 28 en años no bisiestos. */
function nextBirthday(birthDate, today) {
  const [, month, day] = birthDate.split('-').map(Number);
  for (const year of [Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1]) {
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCMonth() !== month - 1) d.setUTCDate(0);
    const iso = d.toISOString().slice(0, 10);
    if (iso >= today) return iso;
  }
  return null;
}

export default function registerDashboard(router, { db }) {
  router.get('/api/dashboard', (ctx) => {
    const user = ctx.user;
    const today = localDate();
    const until = addDays(today, UPCOMING_DAYS);

    const activeEmployees = db.prepare("SELECT COUNT(*) AS n FROM employees WHERE status = 'activo'").get().n;
    const departments = db.prepare('SELECT COUNT(*) AS n FROM departments').get().n;

    let pendingReviews = 0;
    if (isHR(user)) {
      pendingReviews = db.prepare("SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pendiente' AND employee_id <> ?").get(user.id).n;
    } else if (user.role === 'responsable') {
      pendingReviews = db.prepare(`
        SELECT COUNT(*) AS n FROM leave_requests l JOIN employees e ON e.id = l.employee_id
        WHERE l.status = 'pendiente' AND e.manager_id = ?
      `).get(user.id).n;
    }

    // El motivo de la ausencia solo lo ven RR. HH., el propio empleado y su responsable.
    const absences = db.prepare(`
      SELECT l.employee_id, l.type, l.start_date, l.end_date,
             e.first_name || ' ' || e.last_name AS employee_name, e.manager_id, d.name AS department_name
      FROM leave_requests l
      JOIN employees e ON e.id = l.employee_id
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE l.status = 'aprobada' AND l.start_date <= ? AND l.end_date >= ? AND e.status <> 'baja'
      ORDER BY l.start_date, employee_name
    `).all(until, today).map((a) => ({
      employee_id: a.employee_id,
      employee_name: a.employee_name,
      department_name: a.department_name,
      start_date: a.start_date,
      end_date: a.end_date,
      type: canSupervise(user, { id: a.employee_id, manager_id: a.manager_id }) ? a.type : null,
      today: a.start_date <= today,
    }));

    const birthdays = db.prepare(`
      SELECT id, first_name, last_name, birth_date FROM employees
      WHERE status = 'activo' AND birth_date IS NOT NULL
    `).all()
      .map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}`, date: nextBirthday(e.birth_date, today) }))
      .filter((b) => b.date && daysBetween(today, b.date) <= BIRTHDAY_DAYS)
      .sort((a, b) => a.date.localeCompare(b.date));

    const newHires = db.prepare(`
      SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.position, e.hire_date, d.name AS department_name
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.status = 'activo' AND e.hire_date BETWEEN ? AND ?
      ORDER BY e.hire_date DESC
    `).all(addDays(today, -30), today);

    return {
      today,
      stats: {
        active_employees: activeEmployees,
        departments,
        pending_reviews: pendingReviews,
        absent_today: absences.filter((a) => a.today).length,
      },
      balance: vacationBalance(db, user.id, Number(today.slice(0, 4))),
      clock: clockStatus(db, user.id),
      absences,
      birthdays,
      new_hires: newHires,
      announcements: latestAnnouncements(db, user, 3),
    };
  });
}
