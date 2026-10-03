import { api, onUnauthorized } from './api.js';
import { avatar, clear, emptyState, fullName, h, icon, ROLE_LABELS } from './ui.js';
import { renderAnnouncements } from './views/announcements.js';
import { renderDashboard } from './views/dashboard.js';
import { renderDepartments } from './views/departments.js';
import { renderEmployee } from './views/employee.js';
import { renderEmployees } from './views/employees.js';
import { renderLeaves } from './views/leaves.js';
import { renderLogin } from './views/login.js';
import { renderProfile } from './views/profile.js';
import { renderTime } from './views/time.js';

const NAV = [
  { path: '', label: 'Inicio', icon: 'home' },
  { path: 'empleados', label: 'Empleados', icon: 'users' },
  { path: 'departamentos', label: 'Departamentos', icon: 'building' },
  { path: 'ausencias', label: 'Ausencias', icon: 'calendar' },
  { path: 'fichaje', label: 'Fichaje', icon: 'clock' },
  { path: 'anuncios', label: 'Anuncios', icon: 'megaphone' },
  { path: 'perfil', label: 'Mi perfil', icon: 'user' },
];

const ROUTES = [
  { pattern: /^$/, nav: '', view: renderDashboard },
  { pattern: /^empleados$/, nav: 'empleados', view: renderEmployees },
  { pattern: /^empleados\/(\d+)$/, nav: 'empleados', view: renderEmployee, params: ['id'] },
  { pattern: /^departamentos$/, nav: 'departamentos', view: renderDepartments },
  { pattern: /^ausencias$/, nav: 'ausencias', view: renderLeaves },
  { pattern: /^fichaje$/, nav: 'fichaje', view: renderTime },
  { pattern: /^anuncios$/, nav: 'anuncios', view: renderAnnouncements },
  { pattern: /^perfil$/, nav: 'perfil', view: renderProfile },
];

const app = document.getElementById('app');
const state = { user: null, cleanup: null, renderId: 0, shell: null };

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  return { path: path.replace(/\/+$/, ''), query: new URLSearchParams(qs) };
}

function showLogin(message) {
  state.cleanup?.();
  state.cleanup = null;
  state.user = null;
  state.shell = null;
  document.title = 'Iniciar sesión · Intranet';
  clear(app).append(renderLogin({
    message,
    onSuccess: (user) => {
      state.user = user;
      renderShell();
      render();
    },
  }));
}

async function logout() {
  try {
    await api.post('/api/auth/logout');
  } finally {
    location.hash = '#/';
    showLogin();
  }
}

function userChip() {
  const u = state.user;
  return h('a', { class: 'user-chip', href: '#/perfil', title: 'Mi perfil' },
    avatar(fullName(u), 'avatar-sm'),
    h('span', { class: 'user-chip-text' }, h('strong', fullName(u)), h('small', ROLE_LABELS[u.role])));
}

function renderShell() {
  const title = h('h1', { class: 'topbar-title' });
  const userSlot = h('div', { class: 'user-slot' }, userChip());
  const layout = h('div', { class: 'layout' });
  const toggleMenu = (open) => layout.classList.toggle('menu-open', open);

  const nav = h('nav', { class: 'nav', 'aria-label': 'Secciones' }, NAV.map((item) =>
    h('a', { class: 'nav-link', href: `#/${item.path}`, dataset: { nav: item.path } }, icon(item.icon), h('span', item.label))));

  layout.append(
    h('aside', { class: 'sidebar' },
      h('a', { class: 'brand', href: '#/' }, h('img', { src: '/img/favicon.svg', alt: '', width: 28, height: 28 }), h('span', 'Intranet')),
      nav,
      h('button', { type: 'button', class: 'nav-link nav-logout', onclick: logout }, icon('logout'), h('span', 'Cerrar sesión'))),
    h('div', { class: 'backdrop', onclick: () => toggleMenu(false) }),
    h('div', { class: 'main' },
      h('header', { class: 'topbar' },
        h('button', { type: 'button', class: 'icon-btn menu-btn', 'aria-label': 'Abrir menú', onclick: () => toggleMenu(true) }, icon('menu')),
        title,
        userSlot),
      h('main', { class: 'content', id: 'view', tabindex: '-1' })));

  clear(app).append(layout);
  state.shell = { layout, title, nav, userSlot, view: layout.querySelector('#view'), toggleMenu };
}

async function render() {
  if (!state.user || !state.shell) return;
  const { path, query } = parseHash();
  const route = ROUTES.find((r) => r.pattern.test(path));
  const shell = state.shell;

  state.cleanup?.();
  state.cleanup = null;
  shell.toggleMenu(false);
  for (const link of shell.nav.querySelectorAll('.nav-link')) {
    link.classList.toggle('active', route !== undefined && link.dataset.nav === route.nav);
  }

  const id = ++state.renderId;
  const setTitle = (text) => {
    shell.title.textContent = text;
    document.title = `${text} · Intranet`;
  };

  if (!route) {
    setTitle('Página no encontrada');
    clear(shell.view).append(emptyState('La página que buscas no existe.'));
    return;
  }

  const match = path.match(route.pattern);
  const params = Object.fromEntries((route.params ?? []).map((name, i) => [name, match[i + 1]]));
  const ctx = {
    user: state.user,
    params,
    query,
    setTitle,
    isCurrent: () => id === state.renderId,
    onCleanup: (fn) => { state.cleanup = fn; },
    refresh: () => render(),
    setUser: (user) => {
      state.user = user;
      clear(shell.userSlot).append(userChip());
    },
  };

  shell.view.setAttribute('aria-busy', 'true');
  try {
    const content = await route.view(ctx);
    if (id !== state.renderId) return;
    clear(shell.view).append(content);
  } catch (err) {
    if (id !== state.renderId || err.status === 401) return;
    clear(shell.view).append(h('div', { class: 'alert alert-danger' }, err.message || 'Se ha producido un error.'));
  } finally {
    shell.view.removeAttribute('aria-busy');
  }
}

onUnauthorized(() => {
  if (state.user) showLogin('Tu sesión ha caducado. Vuelve a iniciar sesión.');
});

window.addEventListener('hashchange', render);

try {
  const { user } = await api.get('/api/auth/me');
  state.user = user;
  renderShell();
  render();
} catch (err) {
  if (err.status === 401) showLogin();
  else clear(app).append(h('div', { class: 'alert alert-danger boot' }, err.message));
}
