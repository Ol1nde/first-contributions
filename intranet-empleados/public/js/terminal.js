// Terminal de fichaje para la puerta: un equipo con un lector NFC USB que «teclea» el código de la tarjeta
// seguido de Intro. La página captura esas pulsaciones, ficha y saluda al empleado.

// La misma clave usa la página de Configuración al activar este equipo como terminal.
const TERMINAL_KEY = 'intranet.terminal';
const RESULT_MS = 5000;
const IDLE_SUBMIT_MS = 300; // lectores que no envían Intro al final del código
const RETRY_MS = 10_000;

const root = document.getElementById('terminal');
const pad = (n) => String(n).padStart(2, '0');

function readToken() {
  try {
    return localStorage.getItem(TERMINAL_KEY);
  } catch {
    return null;
  }
}

function writeToken(value) {
  try {
    if (value) localStorage.setItem(TERMINAL_KEY, value);
    else localStorage.removeItem(TERMINAL_KEY);
  } catch { /* almacenamiento no disponible */ }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function svgIcon(paths, className) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

const ICONS = {
  card: ['M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z', 'M14 10a2.5 2.5 0 0 1 0 4', 'M16.5 8.5a5 5 0 0 1 0 7', 'M6 15h4'],
  in: ['M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4', 'M10 17l5-5-5-5', 'M15 12H3'],
  out: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  check: ['M20 6 9 17l-5-5'],
  alert: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4', 'M12 17h.01'],
};

function fmtTime(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtMinutes(m) {
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 14) return 'Buenos días';
  if (hour < 21) return 'Buenas tardes';
  return 'Buenas noches';
}

// --- Sonido de confirmación (Web Audio; se activa con la primera pulsación del lector) ---
let audio;
function beep(kind) {
  try {
    audio ??= new AudioContext();
    const notes = kind === 'error' ? [[220, 0], [180, 0.18]] : kind === 'warn' ? [[660, 0]] : [[880, 0], [1320, 0.12]];
    for (const [freq, at] of notes) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, audio.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + at + 0.15);
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + at);
      osc.stop(audio.currentTime + at + 0.16);
    }
  } catch { /* sin audio */ }
}

// --- Estructura de la pantalla ---
const clockTime = el('div', 'terminal-time');
const clockDate = el('div', 'terminal-date');
const panel = el('section', 'terminal-panel');
const terminalName = el('span', 'terminal-name');
const fullscreenButton = el('button', 'terminal-fullscreen', 'Pantalla completa');
fullscreenButton.type = 'button';
fullscreenButton.addEventListener('click', () => document.documentElement.requestFullscreen?.().catch(() => {}));
document.addEventListener('fullscreenchange', () => { fullscreenButton.hidden = Boolean(document.fullscreenElement); });

const clock = el('div', 'terminal-clock');
clock.append(clockTime, clockDate);
const footer = el('footer', 'terminal-footer');
footer.append(terminalName, fullscreenButton);
root.append(clock, panel, footer);

function tick() {
  const now = new Date();
  clockTime.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const date = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  clockDate.textContent = date.charAt(0).toUpperCase() + date.slice(1);
}
tick();
setInterval(tick, 1000);

let resetTimer;
function show(state, icon, title, detail) {
  clearTimeout(resetTimer);
  panel.className = `terminal-panel terminal-${state}`;
  panel.replaceChildren(svgIcon(ICONS[icon], 'terminal-icon'), el('h1', 'terminal-title', title), detail ? el('p', 'terminal-detail', detail) : '');
}

function showIdle() {
  show('idle', 'card', 'Acerca tu tarjeta al lector', 'para fichar la entrada o la salida');
}

function showResult(state, icon, title, detail) {
  show(state, icon, title, detail);
  resetTimer = setTimeout(showIdle, RESULT_MS);
}

function showUnconfigured() {
  terminalName.textContent = '';
  clearTimeout(resetTimer);
  panel.className = 'terminal-panel terminal-setup';
  const link = el('a', 'terminal-link', 'Ir a la intranet');
  link.href = '/';
  panel.replaceChildren(
    svgIcon(ICONS.alert, 'terminal-icon'),
    el('h1', 'terminal-title', 'Este equipo no está activado como terminal de fichaje'),
    el('p', 'terminal-detail', 'Un administrador debe activarlo desde la intranet: Configuración → Terminales de fichaje → «Usar este equipo».'),
    link,
  );
}

// --- Comunicación con la intranet ---
let token = readToken();
const activation = /(?:^|[#&])activar=([\w-]+)/.exec(location.hash);
if (activation) {
  token = activation[1];
  writeToken(token);
  history.replaceState(null, '', location.pathname);
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ok: res.ok, data: await res.json().catch(() => ({})) };
}

async function connect() {
  if (!token) return showUnconfigured();
  try {
    const res = await request('GET', '/api/kiosk/status');
    if (res.status === 401) {
      writeToken(null);
      token = null;
      return showUnconfigured();
    }
    terminalName.textContent = res.data.name ?? '';
    showIdle();
  } catch {
    show('error', 'alert', 'Sin conexión con la intranet', 'Reintentando…');
    setTimeout(connect, RETRY_MS);
  }
}

let busy = false;
async function punch(card) {
  busy = true;
  show('busy', 'card', 'Leyendo tarjeta…');
  try {
    const res = await request('POST', '/api/kiosk/punch', { card });
    if (res.status === 401) {
      writeToken(null);
      token = null;
      return showUnconfigured();
    }
    if (!res.ok) {
      beep('error');
      const detail = res.status === 404
        ? `Código: ${res.data.details?.card ?? card}. Pide a RR. HH. que te la asigne.`
        : 'Avisa a Recursos Humanos.';
      return showResult('error', 'alert', res.data.error ?? 'No se ha podido fichar', detail);
    }
    const { action, employee, time, today_minutes: today, last, closed_stale: closedStale } = res.data;
    if (action === 'entrada') {
      beep('ok');
      showResult('in', 'in', `¡${greeting()}, ${employee.first_name}!`,
        `Entrada registrada a las ${fmtTime(time)}${closedStale ? '. Tu última salida no se fichó: RR. HH. la revisará.' : ''}`);
    } else if (action === 'salida') {
      beep('ok');
      showResult('out', 'out', `¡Hasta luego, ${employee.first_name}!`, `Salida registrada a las ${fmtTime(time)} · Hoy: ${fmtMinutes(today)}`);
    } else {
      beep('warn');
      showResult('warn', 'check', `${employee.first_name}, ya has fichado`,
        `${last === 'entrada' ? 'Entrada' : 'Salida'} registrada a las ${fmtTime(time)}. No hace falta volver a pasar la tarjeta.`);
    }
  } catch {
    beep('error');
    showResult('error', 'alert', 'Sin conexión con la intranet', 'No se ha registrado el fichaje. Vuelve a intentarlo en unos segundos.');
  } finally {
    busy = false;
  }
}

// --- Captura del lector (se comporta como un teclado) ---
let buffer = '';
let idleTimer;
function submit() {
  clearTimeout(idleTimer);
  const card = buffer.trim();
  buffer = '';
  if (card.length >= 4 && token && !busy) punch(card);
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    submit();
  } else if (e.key.length === 1) {
    e.preventDefault();
    buffer += e.key;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(submit, IDLE_SUBMIT_MS);
  }
});

// Mantiene la pantalla encendida si el navegador lo permite.
async function keepAwake() {
  try {
    await navigator.wakeLock?.request('screen');
  } catch { /* no disponible */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
keepAwake();

connect();
