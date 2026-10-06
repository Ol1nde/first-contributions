// Punto de entrada del ejecutable autónomo (Node.js Single Executable Application).
// La interfaz web va embebida como «assets»; los datos se guardan en la carpeta «data» junto al ejecutable.
import './quiet-warnings.js';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { getAsset } from 'node:sea';
import { start } from './start.js';
import { memoryFile } from './static.js';

function waitForEnter(message) {
  if (!process.stdin.isTTY) return Promise.resolve();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(message, () => {
    rl.close();
    resolve();
  }));
}

async function main() {
  const manifest = JSON.parse(getAsset('manifest.json', 'utf8'));
  const staticFiles = new Map(manifest.map((path) => [path, memoryFile(Buffer.from(getAsset(`public/${path}`)))]));
  const argv = process.argv.slice(2);
  const running = await start({
    baseDir: dirname(process.execPath),
    staticFiles,
    argv,
    openBrowser: !argv.includes('--sin-navegador') && !argv.includes('--restablecer-clave'),
  });
  if (!running) {
    // Deja leer el mensaje antes de que se cierre la ventana de la consola.
    await waitForEnter('Pulsa Intro para cerrar esta ventana…');
    process.exit(0);
  }
}

main().catch(async (err) => {
  console.error(`\nNo se ha podido iniciar la intranet:\n  ${err.message}\n`);
  await waitForEnter('Pulsa Intro para cerrar esta ventana…');
  process.exit(1);
});
