import { api } from '../api.js';
import {
  button, card, clear, confirmDialog, fmtDate, fmtRange, formDialog, fullName, h, isHR, isReviewer,
  LEAVE_STATUS_LABELS, LEAVE_TYPE_LABELS, pageHeader, statusBadge, table, toast, todayLocal,
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

const reviewInfo = (l) => (l.reviewer_name
  ? h('div', { class: 'stacked' }, h('span', { class: 'small' }, `${l.reviewer_name} · ${fmtDate(l.reviewed_at)}`), l.review_comment ? h('p', { class: 'muted small' }, l.review_comment) : null)
  : '—');

async function myLeaves(ctx) {
  const year = new Date().getFullYear();
  const [{ balance }, { leaves }] = await Promise.all([api.get(`/api/leaves/balance?year=${year}`), api.get('/api/leaves')]);
  return [
    h('div', { class: 'stats' }, [
      ['Días anuales', balance.allowance], ['Disfrutados', balance.used], ['Pendientes de aprobar', balance.pending], ['Disponibles', balance.available],
    ].map(([label, value]) => h('div', { class: 'stat' }, h('span', { class: 'stat-text' }, h('strong', String(value)), h('span', label))))),
    card(`Mis solicitudes`, table([
      { label: 'Tipo', render: (l) => LEAVE_TYPE_LABELS[l.type] },
      { label: 'Fechas', render: (l) => fmtRange(l.start_date, l.end_date) },
      { label: 'Días', render: (l) => String(l.days) },
      { label: 'Motivo', render: (l) => l.reason || '—' },
      { label: 'Estado', render: (l) => statusBadge(l.status, LEAVE_STATUS_LABELS) },
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
        { label: 'Estado', render: (l) => statusBadge(l.status, LEAVE_STATUS_LABELS) },
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

export async function renderLeaves(ctx) {
  ctx.setTitle('Ausencias');
  const reviewer = isReviewer(ctx.user);
  const tab = reviewer && ctx.query.get('tab') === 'revisar' ? 'revisar' : 'mias';

  if (ctx.query.get('nueva')) {
    history.replaceState(null, '', '#/ausencias');
    queueMicrotask(async () => { if (await newLeave(ctx)) ctx.refresh(); });
  }

  const content = tab === 'mias' ? await myLeaves(ctx) : await reviewQueue(ctx);
  return h('div', { class: 'stack' },
    pageHeader('Vacaciones y ausencias', null,
      button('Nueva solicitud', { variant: 'primary', iconName: 'plus', onClick: async () => { if (await newLeave(ctx)) ctx.refresh(); } })),
    reviewer ? h('nav', { class: 'tabs' },
      h('a', { href: '#/ausencias', class: tab === 'mias' ? 'active' : '' }, 'Mis solicitudes'),
      h('a', { href: '#/ausencias?tab=revisar', class: tab === 'revisar' ? 'active' : '' }, 'Por revisar')) : null,
    content);
}
