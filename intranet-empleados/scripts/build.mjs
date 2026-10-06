// Genera ejecutables autónomos: un único archivo con Node.js, la aplicación y la interfaz web dentro
// (Node.js Single Executable Applications). Uso: npm run build [-- win linux mac]
//   win   → dist/Intranet-Empleados.exe   (se puede generar desde cualquier sistema)
//   linux → dist/intranet-empleados-linux (solo desde Linux)
//   mac   → dist/intranet-empleados-mac   (solo desde macOS, porque hay que firmarlo)
import { execFileSync } from 'node:child_process';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inject } from 'postject';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'build');
const cacheDir = join(buildDir, 'cache');
const distDir = join(root, 'dist');
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const TARGETS = {
  win: { platform: 'win32', file: 'Intranet-Empleados.exe' },
  linux: { platform: 'linux', file: 'intranet-empleados-linux' },
  mac: { platform: 'darwin', file: 'intranet-empleados-mac' },
};
const HOST = Object.keys(TARGETS).find((k) => TARGETS[k].platform === process.platform);

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

/** Binario de Node.js del sistema destino, de la misma versión con la que se genera el blob. */
async function nodeBinary(target) {
  if (TARGETS[target].platform === process.platform) return process.execPath;
  if (target !== 'win') throw new Error(`El ejecutable «${target}» solo puede generarse desde ese mismo sistema operativo.`);
  const cached = join(cacheDir, `node-${process.version}-win-x64.exe`);
  if (!existsSync(cached)) {
    const url = `https://nodejs.org/dist/${process.version}/win-x64/node.exe`;
    console.log(`Descargando ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No se pudo descargar node.exe (${res.status})`);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
  }
  return cached;
}

/**
 * Quita la firma Authenticode de node.exe: al inyectar la aplicación la firma deja de ser válida
 * y Windows trata peor un ejecutable con firma rota que uno sin firmar.
 */
function stripPeSignature(file) {
  const buf = readFileSync(file);
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error(`${file} no es un ejecutable de Windows válido`);
  const optionalHeader = pe + 24;
  const dataDirectories = optionalHeader + (buf.readUInt16LE(optionalHeader) === 0x20b ? 112 : 96);
  const security = dataDirectories + 4 * 8;
  const offset = buf.readUInt32LE(security);
  const size = buf.readUInt32LE(security + 4);
  if (!offset || !size) return;
  buf.writeUInt32LE(0, security);
  buf.writeUInt32LE(0, security + 4);
  const atEnd = offset + size <= buf.length && buf.length - (offset + size) < 8;
  writeFileSync(file, atEnd ? buf.subarray(0, offset) : buf);
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : [...new Set(['win', HOST])];
for (const t of targets) if (!TARGETS[t]) throw new Error(`Destino desconocido: ${t}. Usa win, linux o mac.`);

mkdirSync(buildDir, { recursive: true });
mkdirSync(distDir, { recursive: true });
for (const entry of readdirSync(buildDir)) if (entry !== 'cache') rmSync(join(buildDir, entry), { recursive: true, force: true });

// 1. Un único script CommonJS con toda la aplicación.
const bundle = join(buildDir, 'intranet.cjs');
await build({
  entryPoints: [join(root, 'src/sea-main.js')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: `node${process.versions.node.split('.')[0]}`,
  legalComments: 'none',
  logLevel: 'warning',
});

// 2. La interfaz web se embebe como «assets».
const publicDir = join(root, 'public');
const publicFiles = listFiles(publicDir).map((f) => relative(publicDir, f).split(sep).join('/'));
writeFileSync(join(buildDir, 'manifest.json'), JSON.stringify(publicFiles));
const seaConfig = join(buildDir, 'sea-config.json');
const blob = join(buildDir, 'intranet.blob');
writeFileSync(seaConfig, JSON.stringify({
  main: bundle,
  output: blob,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets: {
    'manifest.json': join(buildDir, 'manifest.json'),
    ...Object.fromEntries(publicFiles.map((f) => [`public/${f}`, join(publicDir, f)])),
  },
}, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });
const blobData = readFileSync(blob);

// 3. Se inyecta en una copia del binario de Node.js de cada sistema.
for (const target of targets) {
  const { platform, file } = TARGETS[target];
  const out = join(distDir, file);
  rmSync(out, { force: true });
  copyFileSync(await nodeBinary(target), out);
  chmodSync(out, 0o755);
  if (platform === 'win32') stripPeSignature(out);
  if (platform === 'darwin') execFileSync('codesign', ['--remove-signature', out]);
  await inject(out, 'NODE_SEA_BLOB', blobData, {
    sentinelFuse: SEA_FUSE,
    ...(platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
  });
  if (platform === 'darwin') execFileSync('codesign', ['--sign', '-', out]);
  const mb = (statSync(out).size / 1024 / 1024).toFixed(0);
  console.log(`✔ ${relative(root, out)} (${mb} MB)`);
}
