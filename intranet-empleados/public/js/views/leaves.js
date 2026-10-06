import { api } from '../api.js';
import {
  avatar, button, card, clear, confirmDialog, emptyState, fmtDate, fmtRange, formDialog, fullName, h, icon, isHR,
  isReviewer, LEAVE_STATUS_LABELS, LEAVE_TYPE_LABELS, pageHeader, statusBadge, table, toast, todayLocal,
} from '../ui.js';

async function newLeave(ctx) {
  const hr = isHR(ctx.user);
  const employees = hr ? (await api.get('/api/employees?status=activo')).employees : [];
  const fields = [
    ...(hr ? [{
      name: 'employee_id', label: 'Empleado', type: 'select', numeric: true, full: true,
      options: [[ctx.user.id, `${fullName(ctx.user)} (yo)`], ...employees.filter((e) => e.id !== ctx.user.id).map((e) => [e.id, fullName(e)])],
    }] : []),
    { name: 'type', label: 'Tipo', type: 'select', required: true, full: true, options: Object.entries(LEAVE_TYPE_LABELS) },
    { name: 'start_date', label: 'Desde', type: 'date', required: true },
    { name: 'end_date', label: 'Hasta (incluido)', type: 'date', required: true },
    { name: 'reason', label: 'Motivo / comentarios', type: 'textarea', rows: 3, maxlength: 1000, full: true },
  ];
  const next = new Date();
  do next.setDate(next.getDate() + 1); while (next.getDay() === 0 || next.getDay() === 6);
  const nextWorkday = todayLocal(next);
  return formDialog({
    title: 'Nueva solicitud de ausencia',
    intro: 'Se contabilizan los días laborables (lunes a viernes) del periodo.',
    fields,
    values: { employee_id: ctx.user.id, type: 'vacaciones', start_date: nextWorkday, end_date: nextWorkday },
    submitLabel: 'Enviar solicitud',
    onSubmit: async (values) => {
      const { leave } = await api.post('/api/leaves', values);
      toast(`Solicitud enviada (${leave.days} ${leave.days === 1 ? 'día laborable' : 'días laborables'})`);
      return leave;
    },
  });
}

function review(leave, decision, onDone) {
  const approve = decision === 'aprobada';
  return formDialog({
    title: approve ? 'Aprobar solicitud' : 'Rechazar solicitud',
    intro: `${leave.employee_name} · ${LEAVE_TYPE_LABELS[leave.type]} · ${fmtRange(leave.start_date, leave.end_date)} (${leave.days} días)`,
    fields: [{ name: 'comment', label: approve ? 'Comentario (opcional)' : 'Motivo del rechazo', type: 'textarea', rows: 3, maxlength: 1000, full: true, required: !approve }],
    submitLabel: approve ? 'Aprobar' : 'Rechazar',
    submitVariant: approve ? 'primary' : 'danger',
    onSubmit: async ({ comment }) => {
      await api.put(`/api/leaves/${leave.id}/review`, { decision, comment });
      toast(approve ? 'Solicitud aprobada' : 'Solicitud rechazada');
      onDone();
    },
  });
}

async function cancel(leave, onDone) {
  if (!(await confirmDialog('¿Cancelar esta solicitud de ausencia?', { title: 'Cancelar solicitud', confirmLabel: 'Cancelar solicitud', danger: true }))) return;
  try {
    await api.put(`/api/leaves/${leave.id}/cancel`);
    toast('Solicitud cancelada');
    onDone();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/** Estado de la solicitud y, si choca con un compañero de su grupo de vacaciones, el aviso. */
const statusInfo = (l) => [
  statusBadge(l.status, LEAVE_STATUS_LABELS),
  l.conflict ? h('div', { class: 'conflict' }, icon('alert'),
    h('span', `Coincide con ${l.conflict.employee_name} (${fmtRange(l.conflict.start_date, l.conflict.end_date)}) · grupo «${l.conflict.group_name}»`)) : null,
];

const reviewInfo = (l) => (l.reviewer_name
  ? h('div', { class: 'stacked' }, h('span', { class: 'small' }, `${l.reviewer_name} · ${fmtDate(l.reviewed_at)}`), l.review_comment ? h('p', { class: 'muted small' }, l.review_comment) : null)
  : '—');

async function myLeaves(ctx) {
  const year = new Date().getFullYear();
  const [{ balance }, { leaves }, { groups }] = await Promise.all([
    api.get(`/api/leaves/balance?year=${year}`), api.get('/api/leaves'), api.get('/api/vacation-groups'),
  ]);
  const myGroups = groups.map((g) => ({ name: g.name, others: g.members.filter((m) => m.id !== ctx.user.id && m.status !== 'baja') }));
  return [
    myGroups.length ? h('div', { class: 'alert alert-info' },
      h('strong', 'No puedes coincidir de vacaciones con:'),
      h('ul', myGroups.map((g) => h('li', `${g.others.map(fullName).join(', ')} (grupo «${g.name}»)`)))) : null,
    h('div', { class: 'stats' }, [
      ['Días anuales', balance.allowance], ['Disfrutados', balance.used], ['Pendientes de aprobar', balance.pending], ['Disponibles', balance.available],
    ].map(([label, value]) => h('div', { class: 'stat' }, h('span', { class: 'stat-text' }, h('strong', String(value)), h('span', label))))),
    card(`Mis solicitudes`, table([
      { label: 'Tipo', render: (l) => LEAVE_TYPE_LABELS[l.type] },
      { label: 'Fechas', render: (l) => fmtRange(l.start_date, l.end_date) },
      { label: 'Días', render: (l) => String(l.days) },
      { label: 'Motivo', render: (l) => l.reason || '—' },
      { label: 'Estado', render: statusInfo },
      { label: 'Revisión', render: reviewInfo },
      { label: '', className: 'actions', render: (l) => (l.can_cancel ? button('Cancelar', { size: 'sm', variant: 'ghost-danger', onClick: () => cancel(l, ctx.refresh) }) : null) },
    ], leaves, { empty: 'Todavía no has solicitado ninguna ausencia.' })),
  ];
}

async function reviewQueue(ctx) {
  const filter = h('select', { 'aria-label': 'Estado' },
    h('option', { value: 'pendiente' }, 'Pendientes'),
    h('option', { value: '' }, 'Todas'));
  const results = h('div');
  async function load() {
    try {
      const { leaves } = await api.get(`/api/leaves?scope=review${filter.value ? `&status=${filter.value}` : ''}`);
      if (!ctx.isCurrent()) return;
      clear(results).append(table([
        { label: 'Empleado', render: (l) => h('div', { class: 'stacked' }, h('a', { href: `#/empleados/${l.employee_id}` }, l.employee_name), h('span', { class: 'muted small' }, l.department_name ?? '')) },
        { label: 'Tipo', render: (l) => LEAVE_TYPE_LABELS[l.type] },
        { label: 'Fechas', render: (l) => fmtRange(l.start_date, l.end_date) },
        { label: 'Días', render: (l) => String(l.days) },
        { label: 'Motivo', render: (l) => l.reason || '—' },
        { label: 'Estado', render: statusInfo },
        { label: 'Revisión', render: reviewInfo },
        {
          label: '',
          className: 'actions',
          render: (l) => [
            l.can_review ? button('Aprobar', { size: 'sm', variant: 'primary', iconName: 'check', onClick: () => review(l, 'aprobada', load) }) : null,
            l.can_review ? button('Rechazar', { size: 'sm', variant: 'ghost-danger', iconName: 'x', onClick: () => review(l, 'rechazada', load) }) : null,
            !l.can_review && l.can_cancel ? button('Cancelar', { size: 'sm', variant: 'ghost-danger', onClick: () => cancel(l, load) }) : null,
          ],
        },
      ], leaves, { empty: filter.value ? 'No hay solicitudes pendientes de revisar.' : 'No hay solicitudes.' }));
    } catch (err) {
      clear(results).append(h('div', { class: 'alert alert-danger' }, err.message));
    }
  }
  filter.addEventListener('change', load);
  await load();
  return card('Solicitudes de mi equipo', [h('div', { class: 'toolbar' }, filter), results]);
}

async function groupForm(group, onSaved) {
  const { employees } = await api.get('/api/employees?status=activo');
  return formDialog({
    title: group ? `Editar grupo «${group.name}»` : 'Nuevo grupo sin coincidencia',
    intro: 'Los empleados de un mismo grupo no podrán tener vacaciones en fechas que se solapen.',
    wide: true,
    fields: [
      { name: 'name', label: 'Nombre del grupo', required: true, maxlength: 100, placeholder: 'Ej.: Recepción, Turno de tarde…' },
      { name: 'description', label: 'Descripción', maxlength: 500 },
      { name: 'member_ids', label: 'Empleados del grupo', type: 'checklist', numeric: true, full: true, options: employees.map((e) => [e.id, fullName(e)]) },
    ],
    values: group ? { ...group, member_ids: group.members.map((m) => m.id) } : {},
    submitLabel: group ? 'Guardar cambios' : 'Crear grupo',
    onSubmit: async (values) => {
      if (group) await api.put(`/api/vacation-groups/${group.id}`, values);
      else await api.post('/api/vacation-groups', values);
      toast(group ? 'Grupo actualizado' : 'Grupo creado');
      onSaved();
    },
  });
}

async function groupsTab(ctx) {
  const { groups } = await api.get('/api/vacation-groups');
  const cards = groups.map((g) => h('section', { class: 'card' },
    h('div', { class: 'card-body' },
      h('h2', g.name),
      g.description ? h('p', { class: 'muted' }, g.description) : null,
      h('div', { class: 'chips' }, g.members.map((m) => h('a', { class: 'chip', href: `#/empleados/${m.id}` }, avatar(fullName(m)), fullName(m)))),
      g.overlaps.length ? h('div', { class: 'alert alert-warning small' },
        h('strong', 'Vacaciones que ya coinciden (anteriores al grupo):'),
        h('ul', g.overlaps.map((o) => h('li', `${o.employee_a} (${fmtRange(o.start_a, o.end_a)}) y ${o.employee_b} (${fmtRange(o.start_b, o.end_b)})`)))) : null),
    h('footer', { class: 'card-footer' },
      button('Editar', { size: 'sm', iconName: 'edit', onClick: () => groupForm(g, ctx.refresh) }),
      button('Eliminar', {
        size: 'sm',
        variant: 'ghost-danger',
        iconName: 'trash',
        onClick: async () => {
          if (!(await confirmDialog(`¿Eliminar el grupo «${g.name}»? Sus miembros podrán volver a coincidir de vacaciones.`, { title: 'Eliminar grupo', confirmLabel: 'Eliminar', danger: true }))) return;
          await api.del(`/api/vacation-groups/${g.id}`);
          toast('Grupo eliminado');
          ctx.refresh();
        },
      }))));

  return [
    h('div', { class: 'page-header' },
      h('p', { class: 'muted' }, 'Elige qué empleados no pueden estar de vacaciones a la vez. Si uno ya tiene vacaciones pedidas o aprobadas, el resto del grupo no podrá solicitar esas fechas, y no se podrá aprobar ninguna solicitud que coincida.'),
      button('Nuevo grupo', { variant: 'primary', iconName: 'plus', onClick: () => groupForm(null, ctx.refresh) })),
    cards.length ? h('div', { class: 'grid grid-2' }, cards) : emptyState('Todavía no hay grupos. Crea uno para impedir que ciertos empleados coincidan de vacaciones.'),
  ];
}

export async function renderLeaves(ctx) {
  ctx.setTitle('Ausencias');
  const reviewer = isReviewer(ctx.user);
  const hr = isHR(ctx.user);
  const requested = ctx.query.get('tab');
  const tab = (requested === 'revisar' && reviewer) || (requested === 'grupos' && hr) ? requested : 'mias';

  if (ctx.query.get('nueva')) {
    history.replaceState(null, '', '#/ausencias');
    queueMicrotask(async () => { if (await newLeave(ctx)) ctx.refresh(); });
  }

  const views = { mias: myLeaves, revisar: reviewQueue, grupos: groupsTab };
  const content = await views[tab](ctx);
  return h('div', { class: 'stack' },
    pageHeader('Vacaciones y ausencias', null,
      button('Nueva solicitud', { variant: 'primary', iconName: 'plus', onClick: async () => { if (await newLeave(ctx)) ctx.refresh(); } })),
    reviewer ? h('nav', { class: 'tabs' },
      h('a', { href: '#/ausencias', class: tab === 'mias' ? 'active' : '' }, 'Mis solicitudes'),
      h('a', { href: '#/ausencias?tab=revisar', class: tab === 'revisar' ? 'active' : '' }, 'Por revisar'),
      hr ? h('a', { href: '#/ausencias?tab=grupos', class: tab === 'grupos' ? 'active' : '' }, 'Grupos sin coincidencia') : null) : null,
    content);
}
