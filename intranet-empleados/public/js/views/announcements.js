import { api } from '../api.js';
import { desktopNotificationsAvailable } from '../notifier.js';
import { badge, button, confirmDialog, emptyState, fmtDate, fmtDateTime, formDialog, h, icon, isHR, pageHeader, toast } from '../ui.js';

function announcementForm(ctx, announcement, emailConfigured) {
  const isAdmin = ctx.user.role === 'admin';
  const emailHelp = emailConfigured
    ? 'Se enviará un email a todos los empleados activos.'
    : isAdmin
      ? 'Para avisar por email, configura el correo en «Configuración».'
      : 'Para avisar por email, un administrador debe configurar el correo en «Configuración».';
  return formDialog({
    title: announcement ? 'Editar anuncio' : 'Nuevo anuncio',
    intro: announcement ? null : 'Al publicarlo, toda la plantilla verá el aviso en la intranet.',
    wide: true,
    fields: [
      { name: 'title', label: 'Título', required: true, maxlength: 200, full: true },
      { name: 'body', label: 'Texto', type: 'textarea', rows: 8, required: true, maxlength: 5000, full: true },
      { name: 'pinned', label: 'Fijar en la parte superior', type: 'checkbox', full: true },
      ...(announcement ? [] : [{
        name: 'notify_email', label: 'Avisar también por email a toda la plantilla', type: 'checkbox', full: true,
        disabled: !emailConfigured, help: emailHelp,
      }]),
    ],
    values: announcement ?? { notify_email: emailConfigured },
    submitLabel: announcement ? 'Guardar cambios' : 'Publicar',
    onSubmit: async (values) => {
      if (announcement) {
        await api.put(`/api/announcements/${announcement.id}`, values);
        toast('Anuncio actualizado');
      } else {
        const res = await api.post('/api/announcements', values);
        const n = res.email_recipients;
        toast(!n ? 'Anuncio publicado' : `Anuncio publicado. Avisando por email a ${n} ${n === 1 ? 'persona' : 'personas'}…`);
      }
      ctx.refresh();
    },
  });
}

/** Resultado del aviso por email (solo lo ve RR. HH.). */
function emailStatus(email) {
  if (!email) return null;
  if (email.status === 'enviado' && email.recipients === 0) {
    return h('p', { class: 'email-status' }, icon('mail'), 'No había más empleados activos a los que avisar por email.');
  }
  if (email.status === 'enviando') {
    return h('p', { class: 'email-status' }, icon('mail'), `Enviando el aviso por email a ${email.recipients} personas…`);
  }
  if (email.status === 'error') {
    return h('p', { class: 'email-status email-status-error' }, icon('alert'), `No se pudo enviar el aviso por email: ${email.error}`);
  }
  return h('p', { class: 'email-status', title: email.error || undefined }, icon('mail'),
    `Aviso enviado por email a ${email.sent} ${email.sent === 1 ? 'persona' : 'personas'} · ${fmtDateTime(email.updated_at.replace(' ', 'T') + 'Z')}`,
    email.failed ? h('span', { class: 'email-status-error' }, ` · ${email.failed} sin entregar`) : null);
}

function desktopButton(ctx) {
  if (!desktopNotificationsAvailable()) return null;
  if (Notification.permission === 'granted') return h('span', { class: 'muted small desktop-on' }, icon('bell'), 'Avisos de escritorio activados');
  if (Notification.permission === 'denied') return null;
  return button('Activar avisos en el escritorio', {
    iconName: 'bell',
    onClick: async () => {
      const result = await Notification.requestPermission();
      toast(result === 'granted' ? 'Recibirás un aviso en el escritorio con cada anuncio nuevo' : 'No se han activado los avisos de escritorio', result === 'granted' ? 'success' : 'info');
      ctx.refresh();
    },
  });
}

export async function renderAnnouncements(ctx) {
  ctx.setTitle('Anuncios');
  const hr = isHR(ctx.user);
  const { announcements, email_configured: emailConfigured } = await api.get('/api/announcements');

  const items = announcements.map((a) => h('article', { class: `card announcement ${a.pinned ? 'is-pinned' : ''} ${a.unread ? 'is-unread' : ''}` },
    h('div', { class: 'card-body' },
      h('header', { class: 'announcement-header' },
        h('h2', a.title),
        h('div', { class: 'list-badges' }, a.unread ? badge('Nuevo', 'success') : null, a.pinned ? badge('Fijado', 'info') : null)),
      h('p', { class: 'muted small' }, `${a.author_name ?? 'Anónimo'} · ${fmtDate(a.created_at)}`),
      h('p', { class: 'announcement-body' }, a.body),
      hr ? emailStatus(a.email) : null),
    hr ? h('footer', { class: 'card-footer' },
      button('Editar', { size: 'sm', iconName: 'edit', onClick: () => announcementForm(ctx, a, emailConfigured) }),
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

  // Al abrir la página los anuncios quedan leídos (la etiqueta «Nuevo» se mantiene hasta la próxima visita).
  if (announcements.some((a) => a.unread)) {
    api.post('/api/announcements/seen').then(() => ctx.refreshUnread()).catch(() => {});
  }
  // Mientras se envía un aviso por email, se refresca para mostrar el resultado.
  if (announcements.some((a) => a.email?.status === 'enviando')) {
    const timer = setTimeout(() => { if (ctx.isCurrent()) ctx.refresh(); }, 3000);
    ctx.onCleanup(() => clearTimeout(timer));
  }

  return h('div', { class: 'stack' },
    pageHeader('Tablón de anuncios', 'Comunicaciones internas de la empresa', [
      desktopButton(ctx),
      hr ? button('Nuevo anuncio', { variant: 'primary', iconName: 'plus', onClick: () => announcementForm(ctx, null, emailConfigured) }) : null,
    ]),
    items.length ? h('div', { class: 'stack' }, items) : emptyState('No hay anuncios publicados.'));
}
