// Вход, сессии, пароли, ограничение попыток.

import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'node:crypto';
import { nowMsk } from './time.js';

export const COOKIE = 'deka_sid';
const SESSION_MS = 7 * 24 * 3600 * 1000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 5;        // на пару «логин + IP»
const MAX_FAILS_IP = 30;    // на один IP по всем логинам

const cost = () => Number(process.env.BCRYPT_COST || 11);
export const hashPassword = (pw) => bcrypt.hash(pw, cost());
export const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const randomId = (bytes = 9) => randomBytes(bytes).toString('base64url');

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Создаёт сессию: клиент получает случайный токен, в БД лежит только его SHA-256. */
export function startSession(db, req, res, userId) {
  const token = randomBytes(32).toString('base64url');
  db.run(
    'INSERT INTO sessions (id_hash, user_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?)',
    sha256(token), userId, nowMsk().iso, Date.now() + SESSION_MS, String(req.get('User-Agent') || '').slice(0, 200),
  );
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: SESSION_MS, path: '/',
  });
}

export function endSession(db, req, res) {
  const token = readCookie(req, COOKIE);
  if (token) db.run('DELETE FROM sessions WHERE id_hash = ?', sha256(token));
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
}

/** Кладёт в req.user пользователя из сессии. Это единственный источник «кто я» для всех маршрутов. */
export function loadUser(db) {
  return (req, _res, next) => {
    req.user = null;
    const token = readCookie(req, COOKIE);
    if (token) {
      const idHash = sha256(token);
      const row = db.get(
        `SELECT u.id, u.role, u.login, u.full_name AS fullName, u.is_demo AS isDemo, u.seed_key AS seedKey
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id_hash = ? AND s.expires_at > ?`, idHash, Date.now());
      if (row) { req.user = { ...row }; req.sessionHash = idHash; }
    }
    next();
  };
}

export function requireRole(role) {
  return (req, _res, next) => {
    if (!req.user) throw new HttpError(401, 'Войдите в кабинет');
    if (role && req.user.role !== role) throw new HttpError(403, 'Этот раздел недоступен для вашей роли');
    next();
  };
}

// ——— ограничение попыток входа ———

const failsSince = (db, key) =>
  db.get('SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND at > ?', key, Date.now() - WINDOW_MS).n;

export function assertLoginAllowed(db, login, ip) {
  if (failsSince(db, `l:${login}|${ip}`) >= MAX_FAILS || failsSince(db, `ip:${ip}`) >= MAX_FAILS_IP) {
    throw new HttpError(429, 'Слишком много неудачных попыток. Подождите 10 минут и попробуйте снова.', { retryAfter: 600 });
  }
}

export function recordLoginFailure(db, login, ip) {
  const at = Date.now();
  db.run('INSERT INTO login_attempts (key, at) VALUES (?, ?)', `l:${login}|${ip}`, at);
  db.run('INSERT INTO login_attempts (key, at) VALUES (?, ?)', `ip:${ip}`, at);
}

export function clearLoginFailures(db, login, ip) {
  db.run('DELETE FROM login_attempts WHERE key = ?', `l:${login}|${ip}`);
}

export function cleanup(db) {
  db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  db.run('DELETE FROM login_attempts WHERE at < ?', Date.now() - WINDOW_MS);
}

// Хеш «никакого» пароля: сравниваем с ним, когда логина нет, чтобы время ответа
// не выдавало, существует ли такой пользователь.
let dummyHash;
export async function verifyAgainstDummy(pw) {
  dummyHash ??= await hashPassword(randomId(12));
  await verifyPassword(pw, dummyHash);
}
