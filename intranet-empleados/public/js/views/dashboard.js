import { api } from '../api.js';
import {
  avatar, badge, card, emptyState, fmtDate, fmtDayMonth, fmtLongDate, fmtRange, h, icon, isReviewer,
  LEAVE_TYPE_LABELS, linkButton,
} from '../ui.js';
import { clockWidget } from './time.js';

function stat(label, value, iconName, href, highlight = false) {
  return h('a', { class: `stat ${highlight ? 'stat-highlight' : ''}`, href },
    h('span', { class: 'stat-icon' }, icon(iconName)),
    h('span', { class: 'stat-text' }, h('strong', String(value)), h('span', label)));
}

function vacationCard(balance) {
  const pct = balance.allowance ? Math.min(100, ((balance.used + balance.pending) / balance.allowance) * 100) : 0;
  const bar = h('div', { class: 'progress-bar' });
  bar.style.width = `${pct}%`;
  return card(`Mis vacaciones ${balance.year}`, [
    h('div', { class: 'big-number' }, h('strong', String(balance.available)), h('span', { class: 'muted' }, ` de ${balance.allowance} días disponibles`)),
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct) }, bar),
    h('p', { class: 'muted small' }, `${balance.used} disfrutados · ${balance.pending} pendientes de aprobar`),
  ], { actions: linkButton('Solicitar', '#/ausencias?nueva=1', { variant: 'primary', iconName: 'plus' }) });
}

function list(items, empty, renderItem) {
  if (items.length === 0) return emptyState(empty);
  return h('ul', { class: 'list' }, items.map((item) => h('li', renderItem(item))));
}

export async function renderDashboard(ctx) {
  ctx.setTitle('Inicio');
  const data = await api.get('/api/dashboard');
  const { user } = ctx;

  const stats = h('div', { class: 'stats' },
    stat('Empleados activos', data.stats.active_employees, 'users', '#/empleados'),
    stat('Departamentos', data.stats.departments, 'building', '#/departamentos'),
    isReviewer(user)
      ? stat('Solicitudes por revisar', data.stats.pending_reviews, 'calendar', '#/ausencias?tab=revisar', data.stats.pending_reviews > 0)
      : null,
    stat('Ausentes hoy', data.stats.absent_today, 'calendar', '#/ausencias'));

  const announcements = card('Anuncios', list(data.announcements, 'No hay anuncios publicados.', (a) => [
    h('div', { class: 'list-title' }, a.unread ? badge('Nuevo', 'success') : null, a.pinned ? badge('Fijado', 'info') : null, h('strong', a.title)),
    h('p', { class: 'clamp' }, a.body),
    h('span', { class: 'muted small' }, `${a.author_name ?? 'Anónimo'} · ${fmtDate(a.created_at)}`),
  ]), { actions: linkButton('Ver todos', '#/anuncios') });

  const absences = card('Ausencias (próximos 14 días)', list(data.absences, 'Nadie tiene ausencias previstas.', (a) => [
    h('div', { class: 'person' }, avatar(a.employee_name, 'avatar-sm'),
      h('div', h('a', { href: `#/empleados/${a.employee_id}` }, a.employee_name),
        h('span', { class: 'muted small' }, `${a.department_name ?? 'Sin departamento'} · ${fmtRange(a.start_date, a.end_date)}`))),
    h('div', { class: 'list-badges' }, a.today ? badge('Hoy', 'warning') : null, a.type ? badge(LEAVE_TYPE_LABELS[a.type], 'neutral') : null),
  ]));

  const birthdays = card('Próximos cumpleaños', list(data.birthdays, 'No hay cumpleaños en los próximos 30 días.', (b) => [
    h('div', { class: 'person' }, avatar(b.name, 'avatar-sm'), h('a', { href: `#/empleados/${b.id}` }, b.name)),
    b.date === data.today ? badge('¡Hoy!', 'success') : h('span', { class: 'muted small' }, fmtDayMonth(b.date)),
  ]));

  const newHires = card('Nuevas incorporaciones', list(data.new_hires, 'No hay incorporaciones en los últimos 30 días.', (e) => [
    h('div', { class: 'person' }, avatar(e.name, 'avatar-sm'),
      h('div', h('a', { href: `#/empleados/${e.id}` }, e.name),
        h('span', { class: 'muted small' }, [e.position, e.department_name].filter(Boolean).join(' · ')))),
    h('span', { class: 'muted small' }, fmtDate(e.hire_date)),
  ]));

  return h('div', { class: 'stack' },
    h('div', { class: 'page-header' }, h('div', h('h1', `Hola, ${user.first_name}`), h('p', { class: 'muted' }, fmtLongDate(data.today)))),
    stats,
    h('div', { class: 'grid grid-2' },
      card('Mi jornada', clockWidget(ctx, data.clock), { actions: linkButton('Historial', '#/fichaje') }),
      vacationCard(data.balance)),
    h('div', { class: 'grid grid-2' }, announcements, absences),
    h('div', { class: 'grid grid-2' }, birthdays, newHires));
}
