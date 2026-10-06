// Cliente SMTP mínimo (sin dependencias) para enviar los avisos por email.
// Admite SSL/TLS directo (465), STARTTLS (587) y conexión sin cifrar (25), con AUTH PLAIN o LOGIN.
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { hostname } from 'node:os';
import tls from 'node:tls';

export const SECURITY_MODES = ['starttls', 'tls', 'none'];
const TIMEOUT_MS = 20_000;
const RECIPIENTS_PER_MESSAGE = 50;
const SAFE_ADDRESS = /^[^\s<>()@,;:"\\]+@[^\s<>()@,;:"\\]+\.[^\s<>()@,;:"\\]+$/;

export class MailError extends Error {}

const b64 = (value) => Buffer.from(value, 'utf8').toString('base64');

/** Codifica una cabecera con caracteres no ASCII (RFC 2047), en trozos para no superar la longitud de línea. */
function encodeHeader(value) {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const words = [];
  let chunk = '';
  for (const ch of value) {
    if (Buffer.byteLength(chunk + ch) > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${b64(w)}?=`).join('\r\n ');
}

function buildMessage({ fromName, fromEmail, subject, text }) {
  const domain = fromEmail.split('@')[1] || 'intranet.local';
  const body = b64(text.replace(/\r?\n/g, '\r\n')).replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${encodeHeader(fromName)} <${fromEmail}>`,
    `To: ${encodeHeader(fromName)} <${fromEmail}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    'Auto-Submitted: auto-generated',
    '',
    body,
  ].join('\r\n');
}

/** Lee las respuestas del servidor (pueden ocupar varias líneas: «250-…» hasta «250 …»). */
class SmtpSession {
  constructor() {
    this.buffer = '';
    this.lines = [];
    this.responses = [];
    this.waiters = [];
    this.error = null;
  }

  attach(socket) {
    this.socket = socket;
    this.onData = (chunk) => this.receive(chunk.toString('utf8'));
    this.onError = (err) => this.fail(err);
    this.onClose = () => this.fail(new MailError('El servidor de correo cerró la conexión'));
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
    socket.setTimeout(TIMEOUT_MS, () => {
      this.fail(new MailError('El servidor de correo no responde. Revisa que el tipo de seguridad corresponda al puerto: «STARTTLS» con el 587 o «SSL/TLS» con el 465.'));
      socket.destroy();
    });
  }

  detach() {
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
    this.socket.setTimeout(0);
  }

  receive(text) {
    this.buffer += text;
    let i;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i).replace(/\r$/, '');
      this.buffer = this.buffer.slice(i + 1);
      this.lines.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        const response = { code: Number(line.slice(0, 3)), lines: this.lines.map((l) => l.slice(4)), text: this.lines.join(' ') };
        this.lines = [];
        const waiter = this.waiters.shift();
        if (waiter) waiter.resolve(response);
        else this.responses.push(response);
      }
    }
  }

  fail(err) {
    if (this.error) return;
    this.error = err;
    for (const waiter of this.waiters.splice(0)) waiter.reject(err);
  }

  read() {
    if (this.responses.length) return Promise.resolve(this.responses.shift());
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  async send(line, expected, describe = line.split(' ')[0]) {
    this.socket.write(`${line}\r\n`);
    const res = await this.read();
    if (expected && !expected.includes(res.code)) throw new MailError(`${describe}: ${res.text}`);
    return res;
  }
}

function openSocket({ host, port, security }) {
  return new Promise((resolve, reject) => {
    const options = { host, port, servername: net.isIP(host) ? undefined : host };
    const socket = security === 'tls' ? tls.connect(options) : net.connect(options);
    const ready = security === 'tls' ? 'secureConnect' : 'connect';
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new MailError('No se pudo conectar con el servidor de correo (tiempo de espera agotado)')));
    socket.once('error', reject);
    socket.once(ready, () => {
      socket.off('error', reject);
      socket.setTimeout(0);
      resolve(socket);
    });
  });
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: net.isIP(host) ? undefined : host });
    secure.once('error', reject);
    secure.once('secureConnect', () => {
      secure.off('error', reject);
      resolve(secure);
    });
  });
}

async function ehlo(session) {
  const res = await session.send(`EHLO ${hostname().replace(/[^\w.-]/g, '') || 'intranet'}`, [250]);
  return res.lines.slice(1).map((l) => l.toUpperCase());
}

function friendly(err, { host, port }) {
  if (err instanceof MailError) {
    if (err.message.startsWith('AUTH:')) return new MailError(`Usuario o contraseña del correo incorrectos (${err.message.slice(6)})`);
    return err;
  }
  const messages = {
    ENOTFOUND: `No se encuentra el servidor de correo «${host}»`,
    ECONNREFUSED: `El servidor «${host}» rechazó la conexión en el puerto ${port}`,
    ETIMEDOUT: `No se pudo conectar con «${host}» (tiempo de espera agotado)`,
    ECONNRESET: 'El servidor de correo cortó la conexión. Revisa el tipo de seguridad y el puerto.',
  };
  if (messages[err.code]) return new MailError(messages[err.code]);
  if (err.code?.startsWith?.('ERR_SSL') || /SSL|TLS|certificate/i.test(err.message)) {
    return new MailError(`Error de conexión segura: ${err.message}. Revisa el tipo de seguridad y el puerto.`);
  }
  return new MailError(err.message);
}

/**
 * Envía un email de texto a varios destinatarios en copia oculta.
 * Devuelve los destinatarios aceptados y los rechazados por el servidor.
 */
export async function sendMail(config, { recipients, subject, text }) {
  const valid = [...new Set(recipients.map((r) => String(r).trim().toLowerCase()))].filter((r) => SAFE_ADDRESS.test(r));
  const rejected = recipients.filter((r) => !SAFE_ADDRESS.test(String(r).trim())).map((address) => ({ address, error: 'Dirección no válida' }));
  const accepted = [];
  if (!valid.length) return { accepted, rejected };

  const session = new SmtpSession();
  try {
    session.attach(await openSocket(config));
    const greeting = await session.read();
    if (greeting.code !== 220) throw new MailError(`El servidor no acepta conexiones: ${greeting.text}`);
    let capabilities = await ehlo(session);

    if (config.security === 'starttls') {
      if (!capabilities.some((c) => c.startsWith('STARTTLS'))) {
        throw new MailError('El servidor no admite STARTTLS. Prueba con «SSL/TLS» (puerto 465).');
      }
      await session.send('STARTTLS', [220]);
      session.detach();
      const plain = session.socket;
      plain.on('error', () => {}); // los errores llegan a través del socket TLS
      session.attach(await upgradeToTls(plain, config.host));
      capabilities = await ehlo(session);
    }

    if (config.user) {
      const auth = capabilities.find((c) => c.startsWith('AUTH')) ?? '';
      if (/\bPLAIN\b/.test(auth)) {
        await session.send(`AUTH PLAIN ${b64(`\0${config.user}\0${config.password ?? ''}`)}`, [235], 'AUTH');
      } else if (/\bLOGIN\b/.test(auth)) {
        await session.send('AUTH LOGIN', [334], 'AUTH');
        await session.send(b64(config.user), [334], 'AUTH');
        await session.send(b64(config.password ?? ''), [235], 'AUTH');
      } else {
        throw new MailError('El servidor no permite iniciar sesión con usuario y contraseña en esta conexión. Revisa el tipo de seguridad.');
      }
    }

    const message = buildMessage({ fromName: config.fromName || 'Intranet', fromEmail: config.fromEmail, subject, text });
    for (let i = 0; i < valid.length; i += RECIPIENTS_PER_MESSAGE) {
      await session.send(`MAIL FROM:<${config.fromEmail}>`, [250], 'Remitente');
      const ok = [];
      for (const address of valid.slice(i, i + RECIPIENTS_PER_MESSAGE)) {
        const res = await session.send(`RCPT TO:<${address}>`);
        if (res.code === 250 || res.code === 251) ok.push(address);
        else rejected.push({ address, error: res.text });
      }
      if (!ok.length) {
        await session.send('RSET', [250]);
        continue;
      }
      await session.send('DATA', [354]);
      session.socket.write(message.endsWith('\r\n') ? message : `${message}\r\n`);
      await session.send('.', [250], 'Envío');
      accepted.push(...ok);
    }
    await session.send('QUIT').catch(() => {});
    return { accepted, rejected };
  } catch (err) {
    throw friendly(err, config);
  } finally {
    session.socket?.destroy();
  }
}
