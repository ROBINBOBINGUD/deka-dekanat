// Заявки студента: каталог, подача, проверка полей, отмена, переписка.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, loginAs, submitCert } from './helpers.mjs';

let app, A, B;
before(async () => {
  app = await startApp();
  A = await loginAs(app.base, 'student1');
  B = await loginAs(app.base, 'student2');
});
after(async () => { await app.close(); });

const card = async (c, pid) => (await c.get(`/api/applications/${pid}`)).body.application;

test('каталог видов заявок: 7 видов, пересдача недоступна A и доступна B с долгом s20', async () => {
  const a = (await A.get('/api/application-types')).body.types;
  const b = (await B.get('/api/application-types')).body.types;
  assert.equal(a.length, 7);
  assert.equal(b.length, 7);
  assert.ok(a.find((t) => t.code === 'retake').unavailable);
  const retakeB = b.find((t) => t.code === 'retake');
  assert.ok(!retakeB.unavailable);
  const options = retakeB.fields.find((f) => f.name === 'subject').options;
  assert.ok(options.some((o) => o.value === 's20'));
});

test('подача справки об обучении: 201, появляется в списке со статусом submitted, в карточке одно событие', async () => {
  const r = await A.post('/api/applications', { type: 'cert_study', payload: { purpose: 'В банк', copies: 2, delivery: 'electronic' } });
  assert.equal(r.status, 201);
  assert.ok(r.body.pid);
  const list = (await A.get('/api/applications')).body.applications;
  const item = list.find((x) => x.pid === r.body.pid);
  assert.ok(item);
  assert.equal(item.status, 'submitted');
  const c = await card(A, r.body.pid);
  assert.equal(c.events.length, 1);
  assert.equal(c.events[0].status, 'submitted');
});

test('проверка полей: пустая цель, copies=9, неизвестный тип — 400; лишние поля не сохраняются', async () => {
  const empty = await A.post('/api/applications', { type: 'cert_study', payload: { purpose: '   ', copies: 1, delivery: 'paper' } });
  assert.equal(empty.status, 400);
  assert.ok(empty.body.error.fields?.purpose);

  const many = await A.post('/api/applications', { type: 'cert_study', payload: { purpose: 'В банк', copies: 9 } });
  assert.equal(many.status, 400);
  assert.ok(many.body.error.fields?.copies);

  const unknown = await A.post('/api/applications', { type: 'no_such_type', payload: {} });
  assert.equal(unknown.status, 400);

  const extra = await A.post('/api/applications', {
    type: 'cert_study', payload: { purpose: 'В банк', copies: 1, delivery: 'paper', student_id: 2, evil: '<b>x</b>', status: 'issued' },
  });
  assert.equal(extra.status, 201);
  const c = await card(A, extra.body.pid);
  assert.equal(c.status, 'submitted');
  assert.deepEqual(c.details.map((d) => d.label).sort(), ['Как получить', 'Куда нужна справка', 'Сколько экземпляров'].sort());
  const row = app.db.get('SELECT payload FROM applications WHERE public_id = ?', extra.body.pid);
  assert.deepEqual(Object.keys(JSON.parse(row.payload)).sort(), ['copies', 'delivery', 'purpose']);
});

test('отмена: своя заявка в submitted отменяется (200), повторная отмена — 409', async () => {
  const pid = await submitCert(A, 'Для отмены');
  assert.equal((await A.post(`/api/applications/${pid}/cancel`)).status, 200);
  assert.equal((await card(A, pid)).status, 'cancelled');
  assert.equal((await A.post(`/api/applications/${pid}/cancel`)).status, 409);
});

test('переписка: сообщение появляется с mine=true, пустое — 400, HTML сохраняется как обычный текст', async () => {
  const pid = await submitCert(A, 'Для переписки');
  const html = '<script>alert(1)</script>';
  assert.equal((await A.post(`/api/applications/${pid}/messages`, { text: html })).status, 201);
  assert.equal((await A.post(`/api/applications/${pid}/messages`, { text: '   ' })).status, 400);
  assert.equal((await A.post(`/api/applications/${pid}/messages`, {})).status, 400);
  const c = await card(A, pid);
  assert.equal(c.messages.length, 1);
  assert.equal(c.messages[0].text, html);
  assert.equal(c.messages[0].mine, true);
  // Для другого студента заявки не существует вовсе
  assert.equal((await B.get(`/api/applications/${pid}`)).status, 404);
});
