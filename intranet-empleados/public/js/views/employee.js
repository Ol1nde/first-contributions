import { api } from '../api.js';
import {
  avatar, badge, button, card, confirmDialog, emptyState, fmtDate, fmtRange, formDialog, fullName, h, isHR,
  LEAVE_STATUS_LABELS, LEAVE_TYPE_LABELS, linkButton, ROLE_LABELS, seniority, STATUS_LABELS, statusBadge, table, toast,
} from '../ui.js';
import { openEmployeeForm } from './employees.js';

function info(label, value) {
  return [h('dt', label), h('dd', value === null || value === undefined || value === '' ? '—' : value)];
}

export async function renderEmployee(ctx) {
  const { user } = ctx;
  const { employee: e, reports } = await api.get(`/api/employees/${ctx.params.id}`);
  ctx.setTitle(fullName(e));

  const self = e.id === user.id;
  const supervisor = isHR(user) || self || e.manager_id === user.id;
  const canManage = user.role === 'admin' || (user.role === 'rrhh' && e.role !== 'admin');
  const year = new Date().getFullYear();
  const [balanceRes, leavesRes] = supervisor
    ? await Promise.all([api.get(`/api/leaves/balance?employee_id=${e.id}&year=${year}`), api.get(`/api/leaves?employee_id=${e.id}`)])
    : [null, null];

  const actions = [];
  if (canManage) {
    actions.push(button('Editar', {
      iconName: 'edit',
      onClick: async () => { if (await openEmployeeForm(user, e)) ctx.refresh(); },
    }));
    actions.push(button('Contraseña', {
      iconName: 'key',
      onClick: () => formDialog({
        title: `Nueva contraseña para ${fullName(e)}`,
        intro: 'Se cerrarán las sesiones abiertas del empleado. Comunícale la nueva contraseña por un canal seguro.',
        fields: [{ name: 'password', label: 'Nueva contraseña', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }],
        submitLabel: 'Establecer contraseña',
        onSubmit: async (v) => {
          await api.put(`/api/employees/${e.id}/password`, v);
          toast('Contraseña actualizada');
        },
      }),
    }));
  }
  if (user.role === 'admin' && !self) {
    actions.push(button('Eliminar', {
      variant: 'danger',
      iconName: 'trash',
      onClick: async () => {
        const ok = await confirmDialog(
          `¿Eliminar definitivamente a ${fullName(e)}? Si el empleado deja la empresa es preferible cambiar su estado a «Baja» para conservar su histórico.`,
          { title: 'Eliminar empleado', confirmLabel: 'Eliminar', danger: true });
        if (!ok) return;
        try {
          await api.del(`/api/employees/${e.id}`);
          toast('Empleado eliminado');
          location.hash = '#/empleados';
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    }));
  }

  const header = h('section', { class: 'card profile-header' },
    avatar(fullName(e), 'avatar-lg'),
    h('div', { class: 'profile-main' },
      h('h1', fullName(e)),
      h('p', { class: 'muted' }, [e.position, e.department_name].filter(Boolean).join(' · ') || 'Sin puesto asignado'),
      h('div', { class: 'list-badges' },
        statusBadge(e.status, STATUS_LABELS),
        e.role ? badge(ROLE_LABELS[e.role], 'info') : null,
        self ? badge('Tú', 'neutral') : null)),
    actions.length ? h('div', { class: 'page-actions' }, actions) : null);

  const contact = card('Contacto', h('dl', { class: 'info' },
    info('Email', h('a', { href: `mailto:${e.email}` }, e.email)),
    info('Teléfono', e.phone ? h('a', { href: `tel:${e.phone.replace(/\s/g, '')}` }, e.phone) : null),
    info('Departamento', e.department_name),
    info('Responsable', e.manager_id ? h('a', { href: `#/empleados/${e.manager_id}` }, e.manager_name) : null)));

  const sections = [contact];
  if (e.role !== undefined) {
    sections.push(card('Datos laborales', h('dl', { class: 'info' },
      info('Fecha de alta', e.hire_date ? `${fmtDate(e.hire_date)} (${seniority(e.hire_date)})` : null),
      info('Fecha de nacimiento', fmtDate(e.birth_date)),
      info('Rol en la intranet', ROLE_LABELS[e.role]),
      info('Vacaciones anuales', `${e.vacation_days} días`),
      info('Acceso', e.has_password ? 'Con contraseña' : 'Sin acceso (falta contraseña)'))));
  }

  const extra = [];
  if (balanceRes) {
    const b = balanceRes.balance;
    extra.push(card(`Ausencias ${year}`, [
      h('div', { class: 'summary' },
        h('div', h('span', { class: 'muted' }, 'Disponibles'), h('strong', String(b.available))),
        h('div', h('span', { class: 'muted' }, 'Disfrutadas'), h('strong', String(b.used))),
        h('div', h('span', { class: 'muted' }, 'Pendientes'), h('strong', String(b.pending)))),
      table([
        { label: 'Tipo', render: (l) => LEAVE_TYPE_LABELS[l.type] },
        { label: 'Fechas', render: (l) => fmtRange(l.start_date, l.end_date) },
        { label: 'Días', render: (l) => String(l.days) },
        { label: 'Estado', render: (l) => statusBadge(l.status, LEAVE_STATUS_LABELS) },
      ], leavesRes.leaves.slice(0, 8), { empty: 'Sin solicitudes de ausencia.' }),
    ], { actions: linkButton('Registro de jornada', `#/fichaje?empleado=${e.id}`, { iconName: 'clock' }) }));
  }
  extra.push(card('Equipo a cargo', reports.length
    ? h('ul', { class: 'list' }, reports.map((r) => h('li',
      h('div', { class: 'person' }, avatar(fullName(r), 'avatar-sm'),
        h('div', h('a', { href: `#/empleados/${r.id}` }, fullName(r)), h('span', { class: 'muted small' }, r.position || ''))))))
    : emptyState('No tiene personas a su cargo.')));

  return h('div', { class: 'stack' },
    h('a', { class: 'back-link', href: '#/empleados' }, '← Volver al directorio'),
    header,
    h('div', { class: 'grid grid-2' }, sections),
    h('div', { class: 'grid grid-2' }, extra));
}
