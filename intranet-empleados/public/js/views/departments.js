import { api } from '../api.js';
import { button, confirmDialog, emptyState, formDialog, h, isHR, pageHeader, toast } from '../ui.js';

function departmentForm(department, onSaved) {
  return formDialog({
    title: department ? `Editar ${department.name}` : 'Nuevo departamento',
    fields: [
      { name: 'name', label: 'Nombre', required: true, maxlength: 100, full: true },
      { name: 'description', label: 'Descripción', type: 'textarea', rows: 3, maxlength: 500, full: true },
    ],
    values: department ?? {},
    onSubmit: async (values) => {
      if (department) await api.put(`/api/departments/${department.id}`, values);
      else await api.post('/api/departments', values);
      toast(department ? 'Departamento actualizado' : 'Departamento creado');
      onSaved();
    },
  });
}

export async function renderDepartments(ctx) {
  ctx.setTitle('Departamentos');
  const hr = isHR(ctx.user);
  const { departments } = await api.get('/api/departments');

  const cards = departments.map((d) => h('section', { class: 'card department' },
    h('div', { class: 'card-body' },
      h('h2', d.name),
      h('p', { class: 'muted' }, d.description || 'Sin descripción'),
      h('a', { href: `#/empleados?departamento=${d.id}` }, `${d.employee_count} ${d.employee_count === 1 ? 'empleado' : 'empleados'} →`)),
    hr ? h('footer', { class: 'card-footer' },
      button('Editar', { size: 'sm', iconName: 'edit', onClick: () => departmentForm(d, ctx.refresh) }),
      button('Eliminar', {
        size: 'sm',
        variant: 'ghost-danger',
        iconName: 'trash',
        onClick: async () => {
          if (!(await confirmDialog(`¿Eliminar el departamento «${d.name}»?`, { title: 'Eliminar departamento', confirmLabel: 'Eliminar', danger: true }))) return;
          try {
            await api.del(`/api/departments/${d.id}`);
            toast('Departamento eliminado');
            ctx.refresh();
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      })) : null));

  return h('div', { class: 'stack' },
    pageHeader('Departamentos', `${departments.length} departamentos`,
      hr ? button('Nuevo departamento', { variant: 'primary', iconName: 'plus', onClick: () => departmentForm(null, ctx.refresh) }) : null),
    departments.length ? h('div', { class: 'grid grid-3' }, cards) : emptyState('Todavía no hay departamentos.'));
}
