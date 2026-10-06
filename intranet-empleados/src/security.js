import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [algo, saltHex, hashHex] = String(stored ?? '').split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

let dummyHash;
/** Hash de relleno para que el login tarde lo mismo exista o no el usuario. */
export async function getDummyHash() {
  dummyHash ??= await hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

export function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function randomPassword() {
  return randomBytes(12).toString('base64url');
}

/** Bloquea temporalmente una clave (IP + email) tras varios intentos de login fallidos. */
export class LoginLimiter {
  constructor({ maxAttempts = 5, windowMs = 15 * 60 * 1000 } = {}) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.attempts = new Map();
  }

  isBlocked(key) {
    const entry = this.attempts.get(key);
    if (!entry) return false;
    if (Date.now() - entry.first > this.windowMs) {
      this.attempts.delete(key);
      return false;
    }
    return entry.count >= this.maxAttempts;
  }

  fail(key) {
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (!entry || now - entry.first > this.windowMs) this.attempts.set(key, { first: now, count: 1 });
    else entry.count += 1;
    if (this.attempts.size > 10_000) {
      for (const [k, v] of this.attempts) if (now - v.first > this.windowMs) this.attempts.delete(k);
    }
  }

  reset(key) {
    this.attempts.delete(key);
  }
}
