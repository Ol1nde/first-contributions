export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let unauthorizedHandler = null;

/** Se invoca cuando la sesión caduca durante el uso de la aplicación. */
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

async function request(method, path, body) {
  const options = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  if (method !== 'GET') {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body ?? {});
  }
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && unauthorizedHandler && !path.startsWith('/api/auth/')) unauthorizedHandler();
    throw new ApiError(res.status, data.error || `Error ${res.status}`, data.details);
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
};
