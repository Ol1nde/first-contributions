import { api } from '../api.js';
import { badge, button, confirmDialog, emptyState, fmtDate, formDialog, h, isHR, pageHeader, toast } from '../ui.js';

function announcementForm(announcement, onSaved) {
  return formDialog({
    title: announcement ? 'Editar anuncio' : 'Nuevo anuncio',
    wide: true,
    fields: [
      { name: 'title', label: 'Título', required: true, maxlength: 200, full: true },
      { name: 'body', label: 'Texto', type: 'textarea', rows: 8, required: true, maxlength: 5000, full: true },
      { name: 'pinned', label: 'Fijar en la parte superior', type: 'checkbox', full: true },
    ],
    values: announcement ?? {},
    submitLabel: announcement ? 'Guardar cambios' : 'Publicar',
    onSubmit: async (values) => {
      if (announcement) await api.put(`/api/announcements/${announcement.id}`, values);
      else await api.post('/api/announcements', values);
      toast(announcement ? 'Anuncio actualizado' : 'Anuncio publicado');
      onSaved();
    },
  });
}

export async function renderAnnouncements(ctx) {
  ctx.setTitle('Anuncios');
  const hr = isHR(ctx.user);
  const { announcements } = await api.get('/api/announcements');

  const items = announcements.map((a) => h('article', { class: `card announcement ${a.pinned ? 'is-pinned' : ''}` },
    h('div', { class: 'card-body' },
      h('header', { class: 'announcement-header' },
        h('h2', a.title),
        a.pinned ? badge('Fijado', 'info') : null),
      h('p', { class: 'muted small' }, `${a.author_name ?? 'Anónimo'} · ${fmtDate(a.created_at)}`),
      h('p', { class: 'announcement-body' }, a.body)),
    hr ? h('footer', { class: 'card-footer' },
      button('Editar', { size: 'sm', iconName: 'edit', onClick: () => announcementForm(a, ctx.refresh) }),
      button('Eliminar', {
        size: 'sm',
        variant: 'ghost-danger',
        iconName: 'trash',
        onClick: async () => {
          if (!(await confirmDialog(`¿Eliminar el anuncio «${a.title}»?`, { title: 'Eliminar anuncio', confirmLabel: 'Eliminar', danger: true }))) return;
          await api.del(`/api/announcements/${a.id}`);
          toast('Anuncio eliminado');
          ctx.refresh();
        },
      })) : null));

  return h('div', { class: 'stack' },
    pageHeader('Tablón de anuncios', 'Comunicaciones internas de la empresa',
      hr ? button('Nuevo anuncio', { variant: 'primary', iconName: 'plus', onClick: () => announcementForm(null, ctx.refresh) }) : null),
    items.length ? h('div', { class: 'stack' }, items) : emptyState('No hay anuncios publicados.'));
}
