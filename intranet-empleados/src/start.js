import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createApp } from './app.js';
import { DEMO_TERMINAL_TOKEN, ensureAdmin, isEmpty, openDatabase, resetPassword, seedDemo } from './db.js';
import { lanAddresses } from './network.js';

const DEMO_PASSWORD = 'demo1234';

function openUrl(url) {
  const [command, args] = process.platform === 'win32'
    ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch { /* sin navegador disponible */ }
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

/**
 * Arranca la intranet. Lo usan tanto `npm start` (src/server.js) como el ejecutable autónomo (src/sea-main.js).
 * Devuelve null cuando no queda un servidor en marcha (p. ej. tras restablecer una contraseña).
 */
export async function start({ baseDir, publicDir, staticFiles, argv = [], env = process.env, openBrowser = false }) {
  const port = Number(env.PORT) || 3000;
  const host = env.HOST || '0.0.0.0';
  const dbFile = env.DB_FILE || join(baseDir, 'data', 'intranet.db');
  const demo = argv.includes('--demo') || env.SEED_DEMO === '1';
  const db = openDatabase(dbFile);

  const resetIndex = argv.indexOf('--restablecer-clave');
  if (resetIndex >= 0) {
    const email = argv[resetIndex + 1];
    const password = email ? await resetPassword(db, email) : null;
    db.close();
    if (!password) throw new Error(email ? `No existe ningún usuario con el email ${email}` : 'Indica el email: --restablecer-clave usuario@empresa.es');
    console.log(`\nNueva contraseña de ${email}: ${password}\nCámbiala desde «Mi perfil» al iniciar sesión.\n`);
    return null;
  }

  if (env.ADMIN_PASSWORD || demo) {
    const admin = await ensureAdmin(db, { email: env.ADMIN_EMAIL || undefined, password: env.ADMIN_PASSWORD || DEMO_PASSWORD });
    if (admin) console.log(`Administrador creado: ${admin.email}${env.ADMIN_PASSWORD ? '' : ` (contraseña «${DEMO_PASSWORD}»)`}`);
  }
  if (demo && (await seedDemo(db, { password: DEMO_PASSWORD }))) {
    console.log(`Datos de demostración cargados. Usuarios de ejemplo con contraseña «${DEMO_PASSWORD}»:`);
    console.log('  javier.ruiz@empresa.local (RR. HH.), elena.sanchez@empresa.local (responsable), ana.garcia@empresa.local (empleada)');
    console.log(`  Terminal de fichaje: http://localhost:${port}/terminal.html#activar=${DEMO_TERMINAL_TOKEN}`);
    console.log('  (tarjetas de ejemplo DEMO0002 a DEMO0011: escribe el código y pulsa Intro para simular el lector)');
  }

  const server = createServer(createApp({
    db,
    publicDir,
    staticFiles,
    secureCookies: env.COOKIE_SECURE === '1',
    trustProxy: env.TRUST_PROXY === '1',
    sessionTtlMs: (Number(env.SESSION_HOURS) || 12) * 60 * 60 * 1000,
  }));
  const url = `http://localhost:${port}`;

  try {
    await listen(server, port, host);
  } catch (err) {
    db.close();
    if (err.code === 'EADDRINUSE' && openBrowser) {
      console.log(`La intranet ya estaba en marcha. Abriendo ${url} …`);
      openUrl(url);
      return null;
    }
    if (err.code === 'EADDRINUSE') throw new Error(`El puerto ${port} está ocupado. Cierra el otro programa o usa otro puerto con la variable PORT.`);
    throw err;
  }

  console.log('\n  Intranet de empleados en marcha');
  console.log(`  · En este equipo:      ${url}`);
  for (const address of lanAddresses()) console.log(`  · Desde otros equipos: http://${address}:${port}`);
  console.log(`  · Datos guardados en:  ${dbFile}`);
  if (isEmpty(db)) console.log(`\n  PRIMER USO: abre ${url} en este equipo para crear la cuenta de administrador.`);
  console.log('\n  Mantén esta ventana abierta mientras se use la intranet. Para detenerla, ciérrala o pulsa Ctrl+C.\n');
  if (openBrowser) openUrl(url);

  const shutdown = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return { server, db, url };
}
