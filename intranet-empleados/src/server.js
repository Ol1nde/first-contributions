import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { ensureAdmin, openDatabase, seedDemo } from './db.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

const port = Number(env.PORT) || 3000;
const host = env.HOST || '0.0.0.0';
const dbFile = env.DB_FILE || resolve(projectRoot, 'data/intranet.db');
const demo = process.argv.includes('--demo') || env.SEED_DEMO === '1';

const db = openDatabase(dbFile);

const admin = await ensureAdmin(db, { email: env.ADMIN_EMAIL || undefined, password: env.ADMIN_PASSWORD || undefined });
if (admin) {
  console.log('\nSe ha creado el usuario administrador inicial:');
  console.log(`  Email:      ${admin.email}`);
  if (admin.password) {
    console.log(`  Contraseña: ${admin.password}`);
    console.log('  (Guárdala y cámbiala desde «Mi perfil». No se volverá a mostrar.)');
  }
  console.log('');
}
if (demo && (await seedDemo(db))) {
  console.log('Datos de demostración cargados. Usuarios de ejemplo con contraseña «demo1234»:');
  console.log('  javier.ruiz@empresa.local (RR. HH.), elena.sanchez@empresa.local (responsable), ana.garcia@empresa.local (empleada)\n');
}

const app = createApp({
  db,
  secureCookies: env.COOKIE_SECURE === '1',
  trustProxy: env.TRUST_PROXY === '1',
  sessionTtlMs: (Number(env.SESSION_HOURS) || 12) * 60 * 60 * 1000,
});

const server = createServer(app);
server.listen(port, host, () => {
  console.log(`Intranet disponible en http://localhost:${port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
