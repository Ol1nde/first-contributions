import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

export async function serveStatic(req, res, pathname, root) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Método no permitido');

  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    return sendText(res, 400, 'Ruta no válida');
  }
  if (relative.includes('\0')) return sendText(res, 400, 'Ruta no válida');
  if (relative.endsWith('/')) relative += 'index.html';

  const file = normalize(join(root, relative));
  if (!file.startsWith(root + sep)) return sendText(res, 403, 'Acceso denegado');

  let info;
  try {
    info = await stat(file);
  } catch {
    return sendText(res, 404, 'No encontrado');
  }
  if (!info.isFile()) return sendText(res, 404, 'No encontrado');

  const lastModified = info.mtime.toUTCString();
  if (req.headers['if-modified-since'] === lastModified) {
    res.writeHead(304);
    return res.end();
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Last-Modified': lastModified,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}
