import { HttpError } from './http.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Valida un objeto recibido por la API acumulando los errores por campo.
 * Con `partial: true` (ediciones) solo se validan los campos presentes.
 */
export class Validator {
  constructor(source, { partial = false } = {}) {
    this.src = source ?? {};
    this.partial = partial;
    this.errors = {};
    this.out = {};
  }

  #skip(key) {
    return this.partial && !Object.hasOwn(this.src, key);
  }

  #raw(key, label) {
    const v = this.src[key];
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string' && typeof v !== 'number') {
      this.errors[key] = `${label}: valor no válido`;
      return undefined;
    }
    return String(v).trim();
  }

  string(key, label, { required = false, max = 200, pattern, patternMessage } = {}) {
    if (this.#skip(key)) return;
    const v = this.#raw(key, label);
    if (v === undefined) return;
    if (required && !v) return void (this.errors[key] = `${label} es obligatorio`);
    if (v.length > max) return void (this.errors[key] = `${label} no puede superar ${max} caracteres`);
    if (v && pattern && !pattern.test(v)) return void (this.errors[key] = `${label} ${patternMessage}`);
    this.out[key] = v;
  }

  email(key, label, options = {}) {
    this.string(key, label, { ...options, max: 254, pattern: EMAIL_RE, patternMessage: 'no es un email válido' });
    if (this.out[key]) this.out[key] = this.out[key].toLowerCase();
  }

  date(key, label, { required = false } = {}) {
    if (this.#skip(key)) return;
    const v = this.#raw(key, label);
    if (v === undefined) return;
    if (!v) {
      if (required) this.errors[key] = `${label} es obligatoria`;
      else this.out[key] = null;
      return;
    }
    if (!isValidDate(v)) return void (this.errors[key] = `${label} no es una fecha válida (AAAA-MM-DD)`);
    this.out[key] = v;
  }

  int(key, label, { required = false, min = -Infinity, max = Infinity, defaultValue = null } = {}) {
    if (this.#skip(key)) return;
    const raw = this.src[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) this.errors[key] = `${label} es obligatorio`;
      else this.out[key] = defaultValue;
      return;
    }
    const n = Number(raw);
    if (!Number.isInteger(n)) return void (this.errors[key] = `${label} debe ser un número entero`);
    if (n < min || n > max) return void (this.errors[key] = `${label} debe estar entre ${min} y ${max}`);
    this.out[key] = n;
  }

  oneOf(key, label, values, { required = false, defaultValue } = {}) {
    if (this.#skip(key)) return;
    const v = this.src[key];
    if (v === undefined || v === null || v === '') {
      if (required) this.errors[key] = `${label} es obligatorio`;
      else if (defaultValue !== undefined) this.out[key] = defaultValue;
      return;
    }
    if (!values.includes(v)) return void (this.errors[key] = `${label} no es válido`);
    this.out[key] = v;
  }

  bool(key, { defaultValue = false } = {}) {
    if (this.#skip(key)) return;
    const v = this.src[key];
    this.out[key] = v === undefined || v === null ? defaultValue : Boolean(v);
  }

  addError(key, message) {
    this.errors[key] = message;
  }

  done() {
    if (Object.keys(this.errors).length > 0) {
      throw new HttpError(400, 'Revisa los datos del formulario', this.errors);
    }
    return this.out;
  }
}

/** Fecha local (zona horaria del servidor) en formato AAAA-MM-DD. */
export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Días laborables (lunes a viernes) entre dos fechas AAAA-MM-DD, ambas incluidas. */
export function workingDays(start, end) {
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  let n = 0;
  while (d <= last) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) n += 1;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}

export function daysBetween(start, end) {
  return Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86_400_000);
}
