// Кабинет сотрудника: жизненный цикл заявки, объявления, изменения расписания, проверка справки.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, loginAs, raw, submitCert } from './helpers.mjs';

let app, A, B, D, groupA;
before(async () => {
  app = await startApp();
  A = await loginAs(app.base, 'student1');
  B = await loginAs(app.base, 'student2');
  D = await loginAs(app.base, 'dekanat');
  groupA = (await A.get('/api/me')).body.student.group;
});
after(async () => { await app.close(); });

const notes = async (c) => (await c.get('/api/notifications')).body.notifications;
const card = async (c, pid) => (await c.get(`/api/applications/${pid}`)).body.application;

test('полный путь электронной справки: подача, очередь, in_progress, ready, код проверки, публичная проверка без лишних данных', async () => {
  const pid = await submitCert(A, 'В военкомат');
  const queue = (await D.get('/api/staff/applications')).body.applications;
  assert.ok(queue.some((x) => x.pid === pid), 'сотрудник не видит заявку в очереди');

  const notesBefore = (await notes(A)).length;
  assert.equal((await D.post(`/api/staff/applications/${pid}/status`, { status: 'in_progress' })).status, 200);
  assert.equal((await D.post(`/api/staff/applications/${pid}/status`, { status: 'ready' })).status, 200);

  const c = await card(A, pid);
  assert.equal(c.status, 'ready');
  assert.ok(c.verify?.code, 'нет кода проверки');

  const after = await notes(A);
  assert.equal(after.length, notesBefore + 2);
  const linked = after.filter((n) => n.link === `/requests/${pid}`);
  assert.ok(linked.length >= 2, 'уведомления со ссылкой на заявку не появились');

  const v = await raw(app.base, 'GET', `/api/verify/${c.verify.code}`);
  assert.equal(v.status, 200);
  assert.equal(v.body.valid, true);
  const me = (await A.get('/api/me')).body;
  const text = JSON.stringify(v.body);
  assert.ok(!text.includes(me.user.fullName), 'в ответе проверки полное ФИО');
  assert.ok(!text.includes(me.user.fullName.split(' ')[0]), 'в ответе проверки фамилия');
  assert.ok(!text.includes(me.student.recordBook), 'в ответе проверки номер зачётки');
  assert.ok(!text.includes(me.student.group), 'в ответе проверки группа');
});

test('недопустимый переход — 409; отказ без комментария — 400; отказ с комментарием — 200 и виден студенту', async () => {
  const pid = await submitCert(A, 'Для отказа');
  assert.equal((await D.post(`/api/staff/applications/${pid}/status`, { status: 'issued' })).status, 409);
  assert.equal((await card(A, pid)).status, 'submitted');

  const noComment = await D.post(`/api/staff/applications/${pid}/status`, { status: 'rejected', comment: '  ' });
  assert.equal(noComment.status, 400);
  assert.equal((await card(A, pid)).status, 'submitted');

  const reason = 'Нужен другой документ, зайдите в деканат';
  assert.equal((await D.post(`/api/staff/applications/${pid}/status`, { status: 'rejected', comment: reason })).status, 200);
  const c = await card(A, pid);
  assert.equal(c.status, 'rejected');
  assert.ok(c.events.some((e) => e.status === 'rejected' && e.comment === reason));
});

test('объявление для группы A: уведомление у A есть, у B нет; несуществующая группа — 400', async () => {
  const title = 'Тестовое объявление для группы';
  const countB = (await notes(B)).filter((n) => n.title === title).length;
  const r = await D.post('/api/staff/announcements', { title, body: 'Важный текст', audience: `group:${groupA}`, important: true });
  assert.equal(r.status, 201);
  assert.equal((await notes(A)).filter((n) => n.title === title).length, 1);
  assert.equal((await notes(B)).filter((n) => n.title === title).length, countB);

  const bad = await D.post('/api/staff/announcements', { title: 'X', body: 'Y', audience: 'group:НЕТ-ТАКОЙ' });
  assert.equal(bad.status, 400);
});

test('отмена пары: у студента change.type=cancel и уведомление schedule; повторная отмена — 400', async () => {
  const date = '2026-12-07';
  const day = (await D.get(`/api/staff/schedule?group=${encodeURIComponent(groupA)}&date=${date}`)).body.day;
  const lesson = day.items.find((i) => !i.change);
  assert.ok(lesson, `у группы ${groupA} нет занятий без изменений на ${date}`);
  const body = { group: groupA, date, pair: lesson.pair, type: 'cancel', note: 'Тест' };

  const scheduleNotes = (await notes(A)).filter((n) => n.kind === 'schedule').length;
  assert.equal((await D.post('/api/staff/schedule-changes', body)).status, 201);

  const sch = (await A.get(`/api/schedule?from=${date}&days=1`)).body;
  const item = sch.days[0].items.find((i) => i.pair === lesson.pair);
  assert.equal(item.change?.type, 'cancel');
  assert.equal((await notes(A)).filter((n) => n.kind === 'schedule').length, scheduleNotes + 1);

  assert.equal((await D.post('/api/staff/schedule-changes', body)).status, 400);
});

test('проверка несуществующего кода справки: 404 и valid=false', async () => {
  const r = await raw(app.base, 'GET', '/api/verify/XXXXX-XXXXX');
  assert.equal(r.status, 404);
  assert.equal(r.body.valid, false);
});
