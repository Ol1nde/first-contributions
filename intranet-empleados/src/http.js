export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Respuesta no JSON (p. ej. un CSV) que un manejador puede devolver. */
export class Reply {
  constructor(status, body, headers = {}) {
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

export function csvReply(filename, columns, rows) {
  const escape = (value) => {
    let s = value === null || value === undefined ? '' : String(value);
    // Evita la inyección de fórmulas al abrir el CSV en una hoja de cálculo.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => escape(c.label)).join(';')];
  for (const row of rows) lines.push(columns.map((c) => escape(row[c.key])).join(';'));
  // BOM para que Excel detecte UTF-8; separador «;» como en la configuración regional española.
  return new Reply(200, '﻿' + lines.join('\r\n') + '\r\n', {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
}

export function readJson(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'La petición es demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size === 0) return resolve({});
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (data === null || typeof data !== 'object' || Array.isArray(data)) {
          return reject(new HttpError(400, 'El cuerpo de la petición debe ser un objeto JSON'));
        }
        resolve(data);
      } catch {
        reject(new HttpError(400, 'JSON no válido'));
      }
    });
    req.on('error', reject);
  });
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[key] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, secure, httpOnly = true, sameSite = 'Strict', path = '/' } = {}) {
  let s = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (httpOnly) s += '; HttpOnly';
  if (secure) s += '; Secure';
  if (maxAge !== undefined) s += `; Max-Age=${Math.floor(maxAge)}`;
  return s;
}

export function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}
