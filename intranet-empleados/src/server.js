import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from './start.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

try {
  await start({
    baseDir: projectRoot,
    publicDir: resolve(projectRoot, 'public'),
    argv,
    openBrowser: argv.includes('--abrir'),
  });
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
