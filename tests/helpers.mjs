// Общие помощники для тестов: временная БД, сид с тестовыми паролями, запуск приложения, HTTP-клиент.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.join(import.meta.dirname, '..');
const src = (p) => pathToFileURL(path.join(ROOT, p)).href;

export const PASSWORDS = {
  student1: 'test-pass-A1',
  student2: 'test-pass-B2',
  dekanat: 'test-pass-D3',
};
export const NOW = '2026-11-24T10:05';

export async function startApp() {
  process.env.SCRYPT_N = '1024';   // в тестах хеш дешёвый, чтобы набор шёл секунды
  process.env.DEKA_NOW = NOW;
  const { openDb } = await import(src('server/db.js'));
  const { createApp } = await import(src('server/app.js'));
  const { seedDatabase } = await import(src('seed/seed.js'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deka-test-'));
  const db = openDb(path.join(dir, 'test.db'));
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'seed', 'data.json'), 'utf8'));
  const accounts = Object.fromEntries(Object.entries(PASSWORDS).map(([k, v]) => [k, { password: v }]));
  await seedDatabase(db, data, accounts);

  const server = createApp(db).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base, db, data,
    async close() {
      await new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); });
      try { db.close(); } catch { /* уже закрыта */ }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function parse(res) {
  const text = await res.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* не JSON */ }
  return { status: res.status, body, headers: res.headers, text };
}

/** Запрос «как есть»: cookie и заголовки передаются явно. */
export async function raw(base, method, urlPath, { body, headers = {}, cookie } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  let payload;
  if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    h['Content-Type'] ??= 'application/json';
  }
  return parse(await fetch(base + urlPath, { method, headers: h, body: payload, redirect: 'manual' }));
}

/** Клиент с cookie сессии и защитными заголовками. */
export function client(base, cookie) {
  const hdr = { 'X-Requested-With': 'deka' };
  return {
    cookie,
    get: (p) => raw(base, 'GET', p, { cookie, headers: hdr }),
    post: (p, body = {}) => raw(base, 'POST', p, { cookie, headers: hdr, body }),
  };
}

export async function login(base, loginName, password) {
  const res = await raw(base, 'POST', '/api/auth/login', {
    headers: { 'X-Requested-With': 'deka' }, body: { login: loginName, password },
  });
  if (res.status !== 200) throw new Error(`Вход ${loginName} не удался: ${res.status}`);
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('deka_sid='));
  const cookie = setCookie.split(';')[0];
  return client(base, cookie);
}

export const loginAs = (base, name) => login(base, name, PASSWORDS[name]);

/** Подаёт электронную справку об обучении, возвращает pid. */
export async function submitCert(c, purpose = 'В банк') {
  const r = await c.post('/api/applications', { type: 'cert_study', payload: { purpose, copies: 1, delivery: 'electronic' } });
  if (r.status !== 201) throw new Error(`Не удалось подать заявку: ${r.status}`);
  return r.body.pid;
}
