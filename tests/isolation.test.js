// Изоляция данных: студент видит и меняет только своё; роли не пересекаются.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, loginAs, raw } from './helpers.mjs';

let app, A, B, D;

before(async () => {
  app = await startApp();
  A = await loginAs(app.base, 'student1');
  B = await loginAs(app.base, 'student2');
  D = await loginAs(app.base, 'dekanat');
});
after(async () => { await app.close(); });

const pids = async (c) => (await c.get('/api/applications')).body.applications.map((a) => a.pid);
const retakeOfB = async () => {
  const list = (await B.get('/api/applications')).body.applications;
  const a = list.find((x) => x.type === 'retake');
  assert.ok(a, 'в сиде у студента B должна быть заявка на пересдачу');
  return a.pid;
};

test('студент A не может открыть заявку студента B и наоборот (404)', async () => {
  const pidA = (await pids(A))[0];
  const pidB = (await pids(B))[0];
  assert.ok(pidA && pidB);
  assert.equal((await A.get(`/api/applications/${pidB}`)).status, 404);
  assert.equal((await B.get(`/api/applications/${pidA}`)).status, 404);
  assert.equal((await A.get(`/api/applications/${pidA}`)).status, 200);
  assert.equal((await B.get(`/api/applications/${pidB}`)).status, 200);
});

test('студент A не может отменить заявку B и написать в неё; у B ничего не меняется', async () => {
  const pid = await retakeOfB();
  const before = (await B.get(`/api/applications/${pid}`)).body.application;
  assert.equal(before.status, 'submitted');
  assert.equal((await A.post(`/api/applications/${pid}/cancel`)).status, 404);
  assert.equal((await A.post(`/api/applications/${pid}/messages`, { text: 'чужое сообщение' })).status, 404);
  const after = (await B.get(`/api/applications/${pid}`)).body.application;
  assert.equal(after.status, before.status);
  assert.equal(after.messages.length, before.messages.length);
  assert.equal(after.events.length, before.events.length);
});

test('списки заявок студентов A и B не пересекаются', async () => {
  const a = await pids(A);
  const b = await pids(B);
  assert.ok(a.length > 0 && b.length > 0);
  assert.deepEqual(a.filter((p) => b.includes(p)), []);
});

test('/api/me: у A и B разные данные, в ответе нет паролей и хешей', async () => {
  const a = (await A.get('/api/me')).body;
  const b = (await B.get('/api/me')).body;
  assert.notEqual(a.user.fullName, b.user.fullName);
  assert.notEqual(a.student.group, b.student.group);
  assert.notEqual(a.student.recordBook, b.student.recordBook);
  for (const body of [a, b]) {
    const s = JSON.stringify(body).toLowerCase();
    for (const bad of ['"password"', 'password_hash', '"hash"', '$2a$', '$2b$']) assert.ok(!s.includes(bad), `в ответе есть ${bad}`);
  }
});

test('/api/grades: у B есть долг, у A нет; параметры student/userId/student_id ничего не меняют', async () => {
  const a = (await A.get('/api/grades')).body;
  const b = (await B.get('/api/grades')).body;
  assert.equal(a.summary.debts.length, 0);
  assert.ok(b.summary.debts.length > 0);
  assert.notDeepEqual(a, b);
  for (const q of ['student=2', 'userId=2', 'student_id=2', 'user_id=2', 'id=2']) {
    const r = await A.get(`/api/grades?${q}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, a, `параметр ?${q} изменил ответ`);
  }
});

test('/api/schedule: у каждого своя группа; ?group=<чужая> ничего не меняет', async () => {
  const groupA = (await A.get('/api/me')).body.student.group;
  const groupB = (await B.get('/api/me')).body.student.group;
  const q = '?from=2026-11-23&days=7';
  const a = (await A.get(`/api/schedule${q}`)).body;
  const b = (await B.get(`/api/schedule${q}`)).body;
  assert.equal(a.group, groupA);
  assert.equal(b.group, groupB);
  assert.notEqual(a.group, b.group);
  const r = await A.get(`/api/schedule${q}&group=${encodeURIComponent(groupB)}`);
  assert.deepEqual(r.body, a);
});

test('уведомления: A не может прочитать уведомление B; ленты не пересекаются по id', async () => {
  const listA = (await A.get('/api/notifications')).body.notifications;
  const listB = (await B.get('/api/notifications')).body.notifications;
  const idsA = new Set(listA.map((n) => n.id));
  assert.deepEqual(listB.filter((n) => idsA.has(n.id)), []);
  const target = listB.find((n) => n.unread);
  assert.ok(target, 'у B должно быть непрочитанное уведомление');
  assert.equal((await A.post(`/api/notifications/${target.id}/read`)).status, 404);
  const again = (await B.get('/api/notifications')).body.notifications.find((n) => n.id === target.id);
  assert.equal(again.unread, true);
});

test('без входа все закрытые разделы отвечают 401', async () => {
  for (const p of ['/api/me', '/api/home', '/api/grades', '/api/schedule', '/api/applications', '/api/notifications', '/api/staff/applications']) {
    assert.equal((await raw(app.base, 'GET', p)).status, 401, p);
  }
});

test('студент не попадает в кабинет сотрудника (403), статус заявки не меняется', async () => {
  const pid = (await pids(B))[0];
  const before = (await B.get(`/api/applications/${pid}`)).body.application.status;
  for (const p of ['/api/staff/summary', '/api/staff/applications', `/api/staff/applications/${pid}`,
    '/api/staff/groups', '/api/staff/announcements', '/api/staff/schedule?group=25-ИСТ']) {
    assert.equal((await A.get(p)).status, 403, p);
  }
  assert.equal((await A.post(`/api/staff/applications/${pid}/status`, { status: 'in_progress' })).status, 403);
  assert.equal((await B.post(`/api/staff/applications/${pid}/status`, { status: 'in_progress' })).status, 403);
  assert.equal((await A.post(`/api/staff/applications/${pid}/messages`, { text: 'x' })).status, 403);
  assert.equal((await A.post('/api/staff/announcements', { title: 't', body: 'b', audience: 'all' })).status, 403);
  assert.equal((await A.post('/api/staff/schedule-changes', {})).status, 403);
  assert.equal((await B.get(`/api/applications/${pid}`)).body.application.status, before);
});

test('сотрудник не получает студенческие разделы (403)', async () => {
  for (const p of ['/api/home', '/api/grades', '/api/schedule', '/api/session', '/api/applications', '/api/application-types']) {
    assert.equal((await D.get(p)).status, 403, p);
  }
});

test('заявление на пересдачу: A без долгов не может выбрать дисциплину-долг B (s20) — 400', async () => {
  const r = await A.post('/api/applications', { type: 'retake', payload: { subject: 's20', wish: 'пожалуйста' } });
  assert.equal(r.status, 400);
  assert.ok(r.body.error.fields?.subject);
});
