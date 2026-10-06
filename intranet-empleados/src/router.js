export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, path, options, handler) {
    if (typeof options === 'function') {
      handler = options;
      options = {};
    }
    const keys = [];
    // Los parámetros de ruta (:id) son siempre identificadores numéricos.
    const source = path.replace(/[.]/g, '\\.').replace(/:(\w+)/g, (_, key) => {
      keys.push(key);
      return '(\\d+)';
    });
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, options, handler });
  }

  get(path, options, handler) { this.add('GET', path, options, handler); }
  post(path, options, handler) { this.add('POST', path, options, handler); }
  put(path, options, handler) { this.add('PUT', path, options, handler); }
  delete(path, options, handler) { this.add('DELETE', path, options, handler); }

  /** Devuelve la ruta que coincide, o `{ methodNotAllowed: true }` si la ruta existe con otro método. */
  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.pattern.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = {};
      route.keys.forEach((key, i) => { params[key] = Number(m[i + 1]); });
      return { route, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}
