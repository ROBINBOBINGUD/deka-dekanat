// Вход, сессии, пароли, защита запросов и заголовки безопасности.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, raw, login, loginAs, PASSWORDS } from './helpers.mjs';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app.close(); });

const H = { 'X-Requested-With': 'deka' };
const tryLogin = (name, password) => raw(app.base, 'POST', '/api/auth/login', { headers: H, body: { login: name, password } });

test('верный пароль: 200 и cookie deka_sid с HttpOnly и SameSite=Lax; ошибки входа неотличимы', async () => {
  const ok = await tryLogin('student1', PASSWORDS.student1);
  assert.equal(ok.status, 200);
  const cookie = ok.headers.getSetCookie().find((c) => c.startsWith('deka_sid='));
  assert.ok(cookie, 'нет cookie deka_sid');
  assert.match(cookie, /;\s*HttpOnly/i);
  assert.match(cookie, /;\s*SameSite=Lax/i);

  const wrong = await tryLogin('student1', 'не-тот-пароль');
  const nobody = await tryLogin('net-takogo', 'не-тот-пароль');
  assert.equal(wrong.status, 401);
  assert.equal(nobody.status, 401);
  assert.equal(wrong.body.error.message, nobody.body.error.message);
});

test('пароли в БД — scrypt-хеши, сессии хранятся без токена в открытом виде', async () => {
  const c = await login(app.base, 'student1', PASSWORDS.student1);
  const token = decodeURIComponent(c.cookie.split('=')[1]);
  const users = app.db.all('SELECT login, password_hash FROM users');
  assert.ok(users.length >= 3);
  const plain = Object.values(PASSWORDS);
  for (const u of users) {
    assert.ok(!plain.includes(u.password_hash), `пароль ${u.login} лежит открытым текстом`);
    assert.ok(u.password_hash.startsWith('scrypt$'), `хеш ${u.login} не scrypt`);
  }
  const sessions = app.db.all('SELECT id_hash FROM sessions');
  assert.ok(sessions.length > 0);
  for (const s of sessions) {
    assert.notEqual(s.id_hash, token);
    assert.ok(!s.id_hash.includes(token));
  }
});

test('после 5 неверных входов подряд 6-я попытка даёт 429 даже с верным паролем', async () => {
  try {
    for (let i = 0; i < 5; i++) assert.equal((await tryLogin('student2', 'неверный-пароль')).status, 401, `попытка ${i + 1}`);
    const blocked = await tryLogin('student2', PASSWORDS.student2);
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
  } finally {
    app.db.run('DELETE FROM login_attempts');
  }
  assert.equal((await tryLogin('student2', PASSWORDS.student2)).status, 200);
});

test('POST без X-Requested-With и с чужим Origin отклоняется (403)', async () => {
  const noHeader = await raw(app.base, 'POST', '/api/auth/login', { body: { login: 'student1', password: PASSWORDS.student1 } });
  assert.equal(noHeader.status, 403);
  const evil = await raw(app.base, 'POST', '/api/auth/login', {
    headers: { ...H, Origin: 'https://evil.example' }, body: { login: 'student1', password: PASSWORDS.student1 },
  });
  assert.equal(evil.status, 403);
  const own = await raw(app.base, 'POST', '/api/auth/login', {
    headers: { ...H, Origin: app.base }, body: { login: 'student1', password: PASSWORDS.student1 },
  });
  assert.equal(own.status, 200);
});

test('выход: прежняя cookie больше не работает', async () => {
  const c = await loginAs(app.base, 'dekanat');
  assert.equal((await c.get('/api/me')).status, 200);
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/me')).status, 401);
});

test('смена пароля в демо-аккаунте запрещена (403)', async () => {
  const c = await loginAs(app.base, 'student2');
  const r = await c.post('/api/auth/password', { current: PASSWORDS.student2, next: 'новый-пароль-123' });
  assert.equal(r.status, 403);
  assert.equal((await tryLogin('student2', PASSWORDS.student2)).status, 200);
});

test('смена пароля у обычного аккаунта: ошибки 400, успех 200, старый пароль не подходит', async () => {
  app.db.run('UPDATE users SET is_demo = 0 WHERE login = ?', 'student1');
  const c = await loginAs(app.base, 'student1');
  const next = 'совсем-новый-пароль-77';
  assert.equal((await c.post('/api/auth/password', { current: 'неверный-текущий', next })).status, 400);
  assert.equal((await c.post('/api/auth/password', { current: PASSWORDS.student1, next: 'short' })).status, 400);
  assert.equal((await c.post('/api/auth/password', { current: PASSWORDS.student1, next })).status, 200);
  assert.equal((await tryLogin('student1', PASSWORDS.student1)).status, 401);
  assert.equal((await tryLogin('student1', next)).status, 200);
  assert.equal((await c.get('/api/me')).status, 200, 'текущая сессия должна пережить смену пароля');
});

test('заголовки безопасности на главной странице', async () => {
  const r = await raw(app.base, 'GET', '/');
  // Статус не проверяем: клиент (public/) может быть ещё не собран; заголовки ставятся на любой ответ.
  assert.match(r.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
});
