import { api } from '../api.js';
import {
  badge, button, card, clear, fmtDate, fmtMinutes, fmtTime, formDialog, fullName, h, isHR, linkButton,
  pageHeader, table, toast, todayLocal, toLocalInput,
} from '../ui.js';

/** Tarjeta de fichaje con el estado de la jornada y un contador que se actualiza solo. */
export function clockWidget(ctx, initialStatus, { onChange } = {}) {
  let status = initialStatus;
  let loadedAt = Date.now();
  const root = h('div', { class: 'clock' });

  const draw = () => {
    const elapsed = status.open ? Math.floor((Date.now() - loadedAt) / 60_000) : 0;
    const total = status.today_minutes + elapsed;
    const action = status.open
      ? button('Fichar salida', { variant: 'danger', iconName: 'clock', onClick: () => clock('clock-out') })
      : button('Fichar entrada', { variant: 'primary', iconName: 'clock', onClick: () => clock('clock-in') });
    clear(root).append(
      h('div', { class: 'clock-state' },
        h('span', { class: `dot ${status.open ? 'dot-on' : ''}` }),
        h('div',
          h('strong', status.open ? `Trabajando desde las ${fmtTime(status.open.clock_in)}` : 'Fuera de jornada'),
          h('p', { class: 'muted' }, `Hoy: ${fmtMinutes(total)}`))),
      action);
  };

  async function clock(kind) {
    try {
      status = await api.post(`/api/time/${kind}`);
      loadedAt = Date.now();
      toast(kind === 'clock-in' ? 'Entrada registrada' : 'Salida registrada');
      draw();
      onChange?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  draw();
  const timer = setInterval(draw, 30_000);
  ctx.onCleanup(() => clearInterval(timer));
  return root;
}

function editEntry(entry, onSaved) {
  return formDialog({
    title: 'Corregir fichaje',
    intro: `${entry.employee_name} · ${fmtDate(entry.clock_in)}. La corrección quedará registrada con tu nombre.`,
    fields: [
      { name: 'clock_in', label: 'Entrada', type: 'datetime-local', required: true },
      { name: 'clock_out', label: 'Salida', type: 'datetime-local', help: 'Déjala vacía si la jornada sigue abierta.' },
      { name: 'note', label: 'Nota', type: 'textarea', rows: 2, maxlength: 500, full: true },
    ],
    values: { clock_in: toLocalInput(entry.clock_in), clock_out: toLocalInput(entry.clock_out), note: entry.note },
    onSubmit: async (v) => {
      await api.put(`/api/time/${entry.id}`, {
        clock_in: new Date(v.clock_in).toISOString(),
        clock_out: v.clock_out ? new Date(v.clock_out).toISOString() : null,
        note: v.note,
      });
      toast('Fichaje corregido');
      onSaved();
    },
  });
}

export async function renderTime(ctx) {
  ctx.setTitle('Registro de jornada');
  const { user, query } = ctx;
  const hr = isHR(user);
  const supervisor = hr || user.role === 'responsable';

  const today = todayLocal();
  const [{ employees }, status] = await Promise.all([
    supervisor ? api.get('/api/employees') : Promise.resolve({ employees: [] }),
    api.get('/api/time/status'),
  ]);
  const visible = hr ? employees : employees.filter((e) => e.manager_id === user.id);
  const options = [[user.id, `${fullName(user)} (yo)`], ...visible.filter((e) => e.id !== user.id).map((e) => [e.id, fullName(e)])];

  const employeeSelect = h('select', { 'aria-label': 'Empleado' }, options.map(([id, name]) =>
    h('option', { value: String(id), selected: String(id) === (query.get('empleado') ?? String(user.id)) }, name)));
  const from = h('input', { type: 'date', value: query.get('desde') ?? `${today.slice(0, 8)}01`, 'aria-label': 'Desde' });
  const to = h('input', { type: 'date', value: query.get('hasta') ?? today, 'aria-label': 'Hasta' });
  const exportLinks = h('div', { class: 'toolbar-group' });
  const results = h('div');

  async function load() {
    const params = new URLSearchParams({ employee_id: employeeSelect.value, from: from.value, to: to.value });
    clear(exportLinks).append(
      linkButton('Exportar CSV', `/api/time/export.csv?${params}`, { iconName: 'download' }),
      hr ? linkButton('Exportar todos', `/api/time/export.csv?${new URLSearchParams({ from: from.value, to: to.value })}`, { iconName: 'download' }) : null);
    try {
      const data = await api.get(`/api/time?${params}`);
      if (!ctx.isCurrent()) return;
      const days = new Set(data.entries.map((e) => todayLocal(new Date(e.clock_in)))).size;
      clear(results).append(
        h('div', { class: 'summary' },
          h('div', h('span', { class: 'muted' }, 'Total del periodo'), h('strong', fmtMinutes(data.total_minutes))),
          h('div', h('span', { class: 'muted' }, 'Días con fichajes'), h('strong', String(days))),
          h('div', h('span', { class: 'muted' }, 'Media por día'), h('strong', days ? fmtMinutes(data.total_minutes / days) : '—'))),
        table([
          { label: 'Fecha', render: (e) => fmtDate(e.clock_in) },
          { label: 'Entrada', render: (e) => fmtTime(e.clock_in) },
          { label: 'Salida', render: (e) => (e.open ? badge('En curso', 'success') : fmtTime(e.clock_out)) },
          { label: 'Duración', render: (e) => fmtMinutes(e.minutes) },
          { label: 'Nota', render: (e) => e.note || '—' },
          { label: 'Corrección', render: (e) => (e.edited_at ? h('span', { class: 'muted small' }, `${e.edited_by_name ?? ''} · ${fmtDate(e.edited_at)}`) : '—') },
          ...(hr ? [{ label: '', className: 'actions', render: (e) => button('', { size: 'sm', iconName: 'edit', title: 'Corregir', onClick: () => editEntry(e, load) }) }] : []),
        ], data.entries, { empty: 'No hay fichajes en este periodo.' }));
    } catch (err) {
      clear(results).append(h('div', { class: 'alert alert-danger' }, err.message));
    }
  }

  for (const el of [employeeSelect, from, to]) el.addEventListener('change', load);
  await load();

  return h('div', { class: 'stack' },
    pageHeader('Registro de jornada', 'Fichaje diario de entrada y salida (art. 34.9 del Estatuto de los Trabajadores).'),
    card('Mi jornada de hoy', clockWidget(ctx, status, { onChange: () => { if (Number(employeeSelect.value) === user.id) load(); } })),
    card('Historial', [
      h('div', { class: 'toolbar' },
        supervisor ? h('label', { class: 'toolbar-field' }, h('span', 'Empleado'), employeeSelect) : null,
        h('label', { class: 'toolbar-field' }, h('span', 'Desde'), from),
        h('label', { class: 'toolbar-field' }, h('span', 'Hasta'), to),
        exportLinks),
      results,
    ]));
}
