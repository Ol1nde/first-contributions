import { api } from '../api.js';
import {
  avatar, button, card, clear, debounce, formDialog, fullName, h, isHR, linkButton, pageHeader, ROLE_LABELS,
  STATUS_LABELS, statusBadge, table, toast, todayLocal,
} from '../ui.js';

/** Alta o edición de un empleado. Devuelve el empleado guardado o null si se cancela. */
export async function openEmployeeForm(user, employee = null) {
  const [{ departments }, { employees }] = await Promise.all([api.get('/api/departments'), api.get('/api/employees')]);
  const allowedRoles = user.role === 'admin' ? Object.keys(ROLE_LABELS) : ['empleado', 'responsable'];
  if (employee && !allowedRoles.includes(employee.role)) allowedRoles.push(employee.role);

  const fields = [
    { name: 'first_name', label: 'Nombre', required: true, maxlength: 100 },
    { name: 'last_name', label: 'Apellidos', required: true, maxlength: 150 },
    { name: 'email', label: 'Email', type: 'email', required: true, maxlength: 254 },
    { name: 'phone', label: 'Teléfono', type: 'tel', maxlength: 40 },
    { name: 'position', label: 'Puesto', maxlength: 150 },
    {
      name: 'department_id', label: 'Departamento', type: 'select', numeric: true,
      options: [['', 'Sin departamento'], ...departments.map((d) => [d.id, d.name])],
    },
    {
      name: 'manager_id', label: 'Responsable', type: 'select', numeric: true,
      options: [['', 'Sin responsable'], ...employees.filter((e) => e.status !== 'baja' && e.id !== employee?.id).map((e) => [e.id, fullName(e)])],
    },
    { name: 'hire_date', label: 'Fecha de alta', type: 'date' },
    { name: 'birth_date', label: 'Fecha de nacimiento', type: 'date' },
    { name: 'status', label: 'Estado', type: 'select', options: Object.entries(STATUS_LABELS) },
    { name: 'role', label: 'Rol', type: 'select', options: allowedRoles.map((r) => [r, ROLE_LABELS[r]]) },
    { name: 'vacation_days', label: 'Días de vacaciones al año', type: 'number', min: 0, max: 60, help: 'Días laborables. Por defecto 22.' },
  ];
  if (!employee) {
    fields.push({
      name: 'password', label: 'Contraseña inicial', type: 'password', minlength: 8, autocomplete: 'new-password', full: true,
      help: 'Mínimo 8 caracteres. Si la dejas vacía, el empleado no podrá acceder hasta que se le asigne una.',
    });
  }

  return formDialog({
    title: employee ? `Editar a ${fullName(employee)}` : 'Nuevo empleado',
    wide: true,
    fields,
    values: employee ?? { status: 'activo', role: 'empleado', vacation_days: 22, hire_date: todayLocal() },
    submitLabel: employee ? 'Guardar cambios' : 'Crear empleado',
    onSubmit: async (values) => {
      if (!values.password) delete values.password;
      const res = employee
        ? await api.put(`/api/employees/${employee.id}`, values)
        : await api.post('/api/employees', values);
      toast(employee ? 'Cambios guardados' : 'Empleado creado');
      return res.employee;
    },
  });
}

export async function renderEmployees(ctx) {
  ctx.setTitle('Empleados');
  const { user, query } = ctx;
  const hr = isHR(user);
  const { departments } = await api.get('/api/departments');

  const search = h('input', { type: 'search', placeholder: 'Buscar por nombre, email o puesto…', 'aria-label': 'Buscar', value: query.get('q') ?? '' });
  const department = h('select', { 'aria-label': 'Departamento' },
    h('option', { value: '' }, 'Todos los departamentos'),
    departments.map((d) => h('option', { value: String(d.id), selected: String(d.id) === query.get('departamento') }, d.name)));
  const status = hr
    ? h('select', { 'aria-label': 'Estado' },
      h('option', { value: '' }, 'Todos los estados'),
      Object.entries(STATUS_LABELS).map(([v, label]) => h('option', { value: v, selected: v === 'activo' }, label)))
    : null;
  const count = h('span', { class: 'muted' });
  const results = h('div');

  async function load() {
    const params = new URLSearchParams();
    if (search.value.trim()) params.set('q', search.value.trim());
    if (department.value) params.set('department_id', department.value);
    if (status?.value) params.set('status', status.value);
    try {
      const { employees } = await api.get(`/api/employees?${params}`);
      if (!ctx.isCurrent()) return;
      count.textContent = `${employees.length} ${employees.length === 1 ? 'empleado' : 'empleados'}`;
      clear(results).append(table([
        {
          label: 'Nombre',
          render: (e) => h('div', { class: 'person' }, avatar(fullName(e), 'avatar-sm'),
            h('div', h('a', { href: `#/empleados/${e.id}` }, fullName(e)), h('span', { class: 'muted small' }, e.email))),
        },
        { label: 'Puesto', render: (e) => e.position || '—' },
        { label: 'Departamento', render: (e) => e.department_name ?? '—' },
        { label: 'Teléfono', render: (e) => (e.phone ? h('a', { class: 'nowrap', href: `tel:${e.phone.replace(/\s/g, '')}` }, e.phone) : '—') },
        ...(hr ? [
          { label: 'Rol', render: (e) => ROLE_LABELS[e.role] },
          { label: 'Estado', render: (e) => statusBadge(e.status, STATUS_LABELS) },
        ] : []),
      ], employees, { empty: 'No se han encontrado empleados.' }));
    } catch (err) {
      clear(results).append(h('div', { class: 'alert alert-danger' }, err.message));
    }
  }

  search.addEventListener('input', debounce(load));
  department.addEventListener('change', load);
  status?.addEventListener('change', load);
  await load();

  const actions = hr ? [
    linkButton('Exportar CSV', '/api/employees/export.csv', { iconName: 'download' }),
    button('Nuevo empleado', {
      variant: 'primary',
      iconName: 'plus',
      onClick: async () => {
        const created = await openEmployeeForm(user);
        if (created) location.hash = `#/empleados/${created.id}`;
      },
    }),
  ] : null;

  return h('div', { class: 'stack' },
    pageHeader('Directorio de empleados', null, actions),
    card(null, [
      h('div', { class: 'toolbar' }, h('div', { class: 'search' }, search), department, status, count),
      results,
    ]));
}
