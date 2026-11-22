// Защиты после ревью безопасности: лимит входа, длина пароля, сеансы, переписка, дата справки, CSRF.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, raw, login, loginAs, PASSWORDS } from './helpers.mjs';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app.close(); });

const H = { 'X-Requested-With': 'deka' };
const tryLogin = (name, password, extra = {}) =>
  raw(app.base, 'POST', '/api/auth/login', { headers: { ...H, ...extra }, body: { login: name, password } });

/** Временно снимает демо-флаг и после теста возвращает прежний хеш пароля, чтобы не мешать другим тестам. */
async function withRealAccount(name, fn) {
  const before = app.db.get('SELECT password_hash, is_demo FROM users WHERE login = ?', name);
  app.db.run('UPDATE users SET is_demo = 0 WHERE login = ?', name);
  try { await fn(); } finally {
    app.db.run('UPDATE users SET password_hash = ?, is_demo = ? WHERE login = ?', before.password_hash, before.is_demo, name);
    app.db.run('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE login = ?)', name);
  }
}

test('подмена X-Forwarded-For не обходит лимит входа при прямом запуске', async () => {
  app.db.run('DELETE FROM login_attempts');
  try {
    for (let i = 1; i <= 5; i++) {
      const r = await tryLogin('student2', 'неверный-пароль', { 'X-Forwarded-For': `${i}.${i}.${i}.${i}` });
      assert.equal(r.status, 401, `попытка ${i}`);
    }
    const blocked = await tryLogin('student2', PASSWORDS.student2, { 'X-Forwarded-For': '9.9.9.9' });
    assert.equal(blocked.status, 429);
  } finally {
    app.db.run('DELETE FROM login_attempts');
  }
});

test('12 параллельных неверных попыток не проходят лимит скопом', async () => {
  app.db.run('DELETE FROM login_attempts');
  try {
    const rs = await Promise.all(Array.from({ length: 12 }, () => tryLogin('student2', 'неверный-пароль')));
    const codes = rs.map((r) => r.status);
    const n401 = codes.filter((s) => s === 401).length;
    assert.ok(n401 <= 5, `ответов 401: ${n401} (${codes.join(',')})`);
    assert.ok(codes.every((s) => [401, 429, 503].includes(s)), `неожиданные коды: ${codes.join(',')}`);
    assert.ok(codes.filter((s) => s === 429 || s === 503).length >= 7);
    assert.equal((await tryLogin('student2', PASSWORDS.student2)).status, 429);
  } finally {
    app.db.run('DELETE FROM login_attempts');
  }
});

test('слишком длинный пароль при входе отклоняется (400), а не обрезается', async () => {
  assert.equal((await tryLogin('student1', 'a'.repeat(80))).status, 400);
  assert.equal((await tryLogin('student1', 'ж'.repeat(40))).status, 400);
});

test('смена пароля: 73 байта — 400 с error.fields.next, 72 — 200 и вход работает', async () => {
  await withRealAccount('student1', async () => {
    const c = await loginAs(app.base, 'student1');
    const tooLong = await c.post('/api/auth/password', { current: PASSWORDS.student1, next: 'b'.repeat(73) });
    assert.equal(tooLong.status, 400);
    assert.ok(tooLong.body.error.fields.next, 'нет error.fields.next');
    const okPw = 'c'.repeat(72);
    assert.equal((await c.post('/api/auth/password', { current: PASSWORDS.student1, next: okPw })).status, 200);
    app.db.run('DELETE FROM login_attempts');
    assert.equal((await tryLogin('student1', okPw)).status, 200);
  });
});

test('смена пароля закрывает остальные сеансы, текущий остаётся', async () => {
  await withRealAccount('student2', async () => {
    const first = await loginAs(app.base, 'student2');
    const second = await loginAs(app.base, 'student2');
    assert.equal((await second.get('/api/me')).status, 200);
    const r = await first.post('/api/auth/password', { current: PASSWORDS.student2, next: 'новый-пароль-4567' });
    assert.equal(r.status, 200);
    assert.equal((await second.get('/api/me')).status, 401);
    assert.equal((await first.get('/api/me')).status, 200);
  });
});

test('переписку нельзя залить: 30 сообщений в час, 31-е получает 429', async () => {
  const c = await loginAs(app.base, 'student1');
  const created = await c.post('/api/applications', { type: 'free_form', payload: { topic: 'Тест', text: 'Тест' } });
  assert.equal(created.status, 201);
  const pid = created.body.pid;
  for (let i = 1; i <= 30; i++) {
    const r = await c.post(`/api/applications/${pid}/messages`, { text: `Сообщение ${i}` });
    assert.equal(r.status, 201, `сообщение ${i}`);
  }
  assert.equal((await c.post(`/api/applications/${pid}/messages`, { text: 'лишнее' })).status, 429);
  const card = await c.get(`/api/applications/${pid}`);
  assert.equal(card.status, 200);
  const msgs = card.body.application?.messages ?? card.body.messages;
  assert.equal(msgs.length, 30);
});

test('дата выдачи справки не меняется от последующей переписки', async () => {
  const student = await loginAs(app.base, 'student2');
  const staff = await loginAs(app.base, 'dekanat');
  const created = await student.post('/api/applications', { type: 'cert_study', payload: { purpose: 'В банк', copies: 1, delivery: 'electronic' } });
  assert.equal(created.status, 201);
  const pid = created.body.pid;
  assert.equal((await staff.post(`/api/staff/applications/${pid}/status`, { status: 'in_progress' })).status, 200);
  assert.equal((await staff.post(`/api/staff/applications/${pid}/status`, { status: 'ready' })).status, 200);
  const card = await student.get(`/api/applications/${pid}`);
  const code = (card.body.application ?? card.body).verify?.code;
  assert.ok(code, 'нет кода проверки');
  const before = await raw(app.base, 'GET', `/api/verify/${code}`);
  assert.equal(before.status, 200);
  app.db.run("UPDATE applications SET updated_at = '2026-12-31T10:00:00' WHERE public_id = ?", pid);
  const after = await raw(app.base, 'GET', `/api/verify/${code}`);
  assert.equal(after.body.issuedAt, before.body.issuedAt);
});

test('изменяющий запрос с чужого Origin отклоняется, даже с X-Forwarded-Host', async () => {
  const r = await raw(app.base, 'POST', '/api/auth/logout', {
    headers: { ...H, Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example' }, body: {},
  });
  assert.equal(r.status, 403);
});
