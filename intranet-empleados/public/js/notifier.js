// Avisos de anuncios nuevos mientras la intranet está abierta: contador en el menú, número en la pestaña,
// mensaje emergente y, si el navegador lo permite, notificación de escritorio.
import { api } from './api.js';
import { toast } from './ui.js';

const POLL_MS = 60_000;

/** Los navegadores solo permiten notificaciones de escritorio en https o en http://localhost. */
export function desktopNotificationsAvailable() {
  return window.isSecureContext && 'Notification' in window;
}

function desktopNotification(announcement) {
  if (!desktopNotificationsAvailable() || Notification.permission !== 'granted') return;
  const n = new Notification('Nuevo anuncio en la intranet', {
    body: announcement.title,
    icon: '/img/favicon.svg',
    tag: `anuncio-${announcement.id}`,
  });
  n.onclick = () => {
    window.focus();
    location.hash = '#/anuncios';
    n.close();
  };
}

export function createAnnouncementNotifier({ onCount, onNew, isViewingAnnouncements }) {
  let lastId = null;
  let timer = null;
  let checking = false;

  async function check() {
    if (checking) return;
    checking = true;
    try {
      const { count, items } = await api.get('/api/announcements/unread');
      onCount(count);
      const newest = items[0]?.id ?? 0;
      if (lastId === null) {
        // Al entrar: recordatorio de los anuncios pendientes de leer.
        if (count > 0 && !isViewingAnnouncements()) {
          toast(count === 1 ? `Tienes un anuncio nuevo: ${items[0].title}` : `Tienes ${count} anuncios nuevos`, 'info', { href: '#/anuncios', duration: 8000 });
        }
      } else {
        const fresh = items.filter((i) => i.id > lastId).reverse();
        for (const a of fresh) {
          toast(`Nuevo anuncio: ${a.title}`, 'info', { href: '#/anuncios', duration: 12000 });
          desktopNotification(a);
        }
        if (fresh.length) onNew?.();
      }
      lastId = Math.max(lastId ?? 0, newest);
    } catch {
      // Sin conexión o sesión caducada: se vuelve a intentar en la siguiente comprobación.
    } finally {
      checking = false;
    }
  }

  return {
    start() {
      clearInterval(timer);
      window.removeEventListener('focus', check);
      lastId = null;
      check();
      timer = setInterval(check, POLL_MS);
      window.addEventListener('focus', check);
    },
    stop() {
      clearInterval(timer);
      window.removeEventListener('focus', check);
      lastId = null;
      onCount(0);
    },
    check,
  };
}
