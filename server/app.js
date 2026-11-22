// HTTP-приложение «Деки»: все маршруты API и раздача клиента.
// Главное правило безопасности: «кто я» берётся только из req.user (серверная сессия),
// и каждый запрос к данным студента отфильтрован по req.user.id.

import express from 'express';
import helmet from 'helmet';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  HttpError, hashPassword, verifyPassword, verifyAgainstDummy, startSession, endSession,
  loadUser, requireRole, assertLoginAllowed, recordLoginFailure, clearLoginFailures, randomId,
} from './auth.js';
import { TYPES, STATUS_LABEL, TRANSITIONS, ACTIVE, validatePayload, describePayload } from './applicationTypes.js';
import { createSchedule } from './schedule.js';
import { buildGrades } from './grades.js';
import { nowMsk, addDays, isDate, mondayOf, daysBetween, weekday } from './time.js';

const PUBLIC_DIR = join(import.meta.dirname, '..', 'public');
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const multiline = (v) => String(v ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const humanDate = (d) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
};

export function createApp(db) {
  const app = express();
  const schedule = createSchedule(db);
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'], fontSrc: ["'self'"], connectSrc: ["'self'"], manifestSrc: ["'self'"],
        objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  app.get('/healthz', (_req, res) => res.json({ ok: true, time: nowMsk().iso }));

  // ————————————————————————— API —————————————————————————
  const api = express.Router();
  api.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  // Грубый предохранитель от перебора и шторма запросов: 240 запросов в минуту с одного адреса.
  const hits = new Map();
  api.use((req, _res, next) => {
    const minute = Math.floor(Date.now() / 60000);
    const rec = hits.get(req.ip);
    if (!rec || rec.minute !== minute) hits.set(req.ip, { minute, n: 1 });
    else if (++rec.n > 240) throw new HttpError(429, 'Слишком много запросов. Подождите минуту.', { retryAfter: 60 });
    if (hits.size > 5000) hits.clear();
    next();
  });

  // Защита от CSRF: изменяющие запросы — только со своим заголовком и со своего origin.
  api.use((req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('X-Requested-With') !== 'deka') throw new HttpError(403, 'Запрос отклонён');
    const origin = req.get('Origin');
    if (origin) {
      let host = null;
      try { host = new URL(origin).host; } catch { /* оставляем null */ }
      const own = [req.get('Host'), req.get('X-Forwarded-Host'), ...(process.env.ALLOWED_HOSTS || '').split(',')]
        .filter(Boolean).map((h) => h.trim());
      if (!own.includes(host)) throw new HttpError(403, 'Запрос отклонён');
    }
    next();
  });
  api.use(express.json({ limit: '32kb' }));
  api.use(loadUser(db));

  // ——— справочная информация для экрана входа ———
  const meta = (key) => { const r = db.get('SELECT value FROM meta WHERE key = ?', key); return r ? JSON.parse(r.value) : null; };
  api.get('/public', (_req, res) => {
    res.json({ university: meta('university'), concept: true });
  });

  // ——— вход и выход ———
  api.post('/auth/login', async (req, res) => {
    const login = clean(req.body?.login).toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!login || !password) throw new HttpError(400, 'Введите логин и пароль');
    if (login.length > 64 || password.length > 200) throw new HttpError(400, 'Слишком длинное значение');
    assertLoginAllowed(db, login, req.ip);
    const user = db.get('SELECT id, password_hash FROM users WHERE login = ?', login);
    let ok = false;
    if (user) ok = await verifyPassword(password, user.password_hash);
    else await verifyAgainstDummy(password);
    if (!ok) {
      recordLoginFailure(db, login, req.ip);
      throw new HttpError(401, 'Неверный логин или пароль');
    }
    clearLoginFailures(db, login, req.ip);
    startSession(db, req, res, user.id);
    res.json({ ok: true });
  });

  api.post('/auth/logout', (req, res) => {
    endSession(db, req, res);
    res.json({ ok: true });
  });

  api.post('/auth/password', requireRole(), async (req, res) => {
    if (req.user.isDemo) {
      throw new HttpError(403, 'В тестовых аккаунтах жюри смена пароля отключена, чтобы вход не потерялся.');
    }
    const current = String(req.body?.current ?? '');
    const next = String(req.body?.next ?? '');
    if (next.length < 8 || next.length > 200) throw new HttpError(400, 'Новый пароль — от 8 символов', { fields: { next: 'От 8 символов' } });
    const row = db.get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
    if (!(await verifyPassword(current, row.password_hash))) {
      throw new HttpError(400, 'Текущий пароль не подходит', { fields: { current: 'Не подходит' } });
    }
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(next), req.user.id);
    db.run('DELETE FROM sessions WHERE user_id = ? AND id_hash <> ?', req.user.id, req.sessionHash);
    res.json({ ok: true });
  });

  // ——— контекст студента: всегда по id из сессии ———
  function studentCtx(req) {
    const row = db.get(
      `SELECT s.group_code AS groupCode, s.record_book AS recordBook, s.study_form AS studyForm, s.funding,
              s.admission_year AS admissionYear, g.faculty, g.faculty_short AS facultyShort,
              g.program_code AS programCode, g.program_name AS programName, g.course, g.curator_id AS curatorId
         FROM students s JOIN groups g ON g.code = s.group_code WHERE s.user_id = ?`, req.user.id);
    if (!row) throw new HttpError(403, 'Раздел доступен только студентам');
    row.audiences = ['all', `group:${row.groupCode}`, `faculty:${row.facultyShort}`, `student:${req.user.seedKey ?? '—'}`];
    return row;
  }
  const unreadCount = (userId) =>
    db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', userId).n;
  const notify = (userId, kind, title, body, link) =>
    db.run('INSERT INTO notifications (user_id, kind, title, body, link, created_at) VALUES (?,?,?,?,?,?)',
      userId, kind, title, body ?? '', link ?? null, nowMsk().iso);

  function myDeadlines(ctx, fromIso) {
    return db.all(
      `SELECT id, title, due, kind, link FROM deadlines
        WHERE audience IN (?,?,?,?) AND due >= ? ORDER BY due`, ...ctx.audiences, fromIso);
  }

  /** Напоминания о сроках: за 3 дня до срока в ленте появляется уведомление (один раз). */
  function ensureReminders(req, ctx) {
    const now = nowMsk();
    for (const d of myDeadlines(ctx, now.iso)) {
      const left = daysBetween(now.date, d.due);
      if (left > 3) continue;
      const fresh = db.run('INSERT OR IGNORE INTO deadline_reminders (user_id, deadline_id) VALUES (?, ?)', req.user.id, d.id);
      if (!fresh.changes) continue;
      const when = left === 0 ? 'сегодня' : left === 1 ? 'завтра' : `через ${left} ${plural(left, 'день', 'дня', 'дней')}`;
      notify(req.user.id, 'deadline', `Срок ${when}: ${d.title}`,
        `До ${humanDate(d.due)}, ${d.due.slice(11, 16) || '23:59'}.`, d.link || '/');
    }
  }

  api.get('/me', requireRole(), (req, res) => {
    const u = req.user;
    const email = db.get('SELECT email FROM users WHERE id = ?', u.id)?.email ?? null;
    const out = {
      user: { fullName: u.fullName, login: u.login, role: u.role, isDemo: Boolean(u.isDemo), email },
      university: meta('university'),
      unread: unreadCount(u.id),
    };
    if (u.role === 'student') {
      const ctx = studentCtx(req);
      ensureReminders(req, ctx);
      const curator = ctx.curatorId ? db.get('SELECT name, title FROM teachers WHERE id = ?', ctx.curatorId) : null;
      out.unread = unreadCount(u.id);
      out.student = {
        group: ctx.groupCode, faculty: ctx.faculty, facultyShort: ctx.facultyShort,
        programCode: ctx.programCode, programName: ctx.programName, course: ctx.course,
        recordBook: ctx.recordBook, studyForm: ctx.studyForm, funding: ctx.funding,
        admissionYear: ctx.admissionYear, curator: curator ? { ...curator } : null,
      };
    } else {
      const st = db.get('SELECT position, faculty FROM staff WHERE user_id = ?', u.id);
      out.staff = st ? { ...st } : null;
    }
    res.json(out);
  });

  // ——— расписание ———
  api.get('/schedule', requireRole('student'), (req, res) => {
    const ctx = studentCtx(req);
    const now = nowMsk();
    const from = isDate(req.query.from) ? req.query.from : mondayOf(now.date);
    const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 7, 1), 14);
    res.json({ today: now.date, now: now.time, from, group: ctx.groupCode, days: schedule.range(ctx.groupCode, from, days) });
  });

  // ——— успеваемость и сессия ———
  api.get('/grades', requireRole('student'), (req, res) => {
    studentCtx(req);
    res.json(buildGrades(db, req.user.id, nowMsk().date));
  });

  function sessionEvents(ctx) {
    return db.all(
      `SELECT e.kind, e.date, e.time, e.room, s.name AS subject, t.name AS teacher
         FROM session_events e JOIN subjects s ON s.id = e.subject_id LEFT JOIN teachers t ON t.id = e.teacher_id
        WHERE e.group_code = ? ORDER BY e.date, e.time`, ctx.groupCode);
  }
  api.get('/session', requireRole('student'), (req, res) => {
    const ctx = studentCtx(req);
    res.json({ today: nowMsk().date, events: sessionEvents(ctx) });
  });

  // ——— заявки студента ———
  const debtsOf = (userId) => db.all(
    `SELECT e.subject_id AS id, s.name, e.semester FROM enrollments e JOIN subjects s ON s.id = e.subject_id
      WHERE e.student_id = ? AND e.final IN ('2', 'не зачтено') ORDER BY e.semester`, userId);

  function serializeApp(row, viewerId, full = false) {
    const type = TYPES[row.type];
    const payload = JSON.parse(row.payload);
    const details = describePayload(row.type, payload, schedule.subjectName);
    const out = {
      pid: row.public_id, type: row.type, title: type?.title ?? row.type, icon: type?.icon ?? 'file',
      status: row.status, statusLabel: STATUS_LABEL[row.status], createdAt: row.created_at, updatedAt: row.updated_at,
      summary: details[0]?.value ?? '', delivery: payload.delivery ?? null,
    };
    if (!full) return out;
    out.eta = type?.eta ?? '';
    out.details = details;
    out.events = db.all(
      `SELECT e.at, e.status, e.comment, u.role FROM application_events e LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.application_id = ? ORDER BY e.at, e.id`, row.id)
      .map((e) => ({ at: e.at, status: e.status, statusLabel: STATUS_LABEL[e.status], comment: e.comment || '', by: e.role === 'staff' ? 'staff' : 'student' }));
    out.messages = db.all(
      `SELECT m.at, m.text, m.author_id AS authorId, u.role FROM application_messages m JOIN users u ON u.id = m.author_id
        WHERE m.application_id = ? ORDER BY m.at, m.id`, row.id)
      .map((m) => ({ at: m.at, text: m.text, mine: m.authorId === viewerId, by: m.role }));
    out.verify = row.verify_code && ['ready', 'issued'].includes(row.status) ? { code: row.verify_code } : null;
    out.canCancel = row.status === 'submitted';
    out.canWrite = !['cancelled'].includes(row.status);
    return out;
  }

  // Заявка студента ищется по паре «public_id + владелец». Чужая — 404, как будто её нет.
  function ownApp(req) {
    const row = db.get('SELECT * FROM applications WHERE public_id = ? AND student_id = ?', String(req.params.pid), req.user.id);
    if (!row) throw new HttpError(404, 'Заявка не найдена');
    return row;
  }

  api.get('/application-types', requireRole('student'), (req, res) => {
    studentCtx(req);
    const debts = debtsOf(req.user.id);
    const types = Object.entries(TYPES).map(([code, t]) => ({
      code, title: t.title, icon: t.icon, eta: t.eta, about: t.about,
      fields: t.fields.map((f) => f.type === 'debt'
        ? { ...f, options: debts.map((d) => ({ value: d.id, label: `${d.name}, ${d.semester} семестр` })) }
        : f),
      unavailable: code === 'retake' && debts.length === 0 ? 'Задолженностей нет — пересдавать нечего.' : null,
    }));
    res.json({ types, today: nowMsk().date });
  });

  api.get('/applications', requireRole('student'), (req, res) => {
    studentCtx(req);
    const rows = db.all('SELECT * FROM applications WHERE student_id = ? ORDER BY updated_at DESC, id DESC', req.user.id);
    res.json({ applications: rows.map((r) => serializeApp(r, req.user.id)) });
  });

  api.post('/applications', requireRole('student'), (req, res) => {
    studentCtx(req);
    const type = String(req.body?.type ?? '');
    const now = nowMsk();
    const recent = db.get('SELECT COUNT(*) AS n FROM applications WHERE student_id = ? AND created_at > ?',
      req.user.id, `${now.date}T00:00`).n;
    if (recent >= 20) throw new HttpError(429, 'Сегодня уже подано много заявок. Попробуйте завтра или напишите в деканат.');
    const payload = validatePayload(type, req.body?.payload, { today: now.date, debts: debtsOf(req.user.id).map((d) => d.id) });
    const pid = randomId(9);
    db.tx(() => {
      const r = db.run(
        'INSERT INTO applications (public_id, student_id, type, payload, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
        pid, req.user.id, type, JSON.stringify(payload), 'submitted', now.iso, now.iso);
      db.run('INSERT INTO application_events (application_id, at, actor_id, status, comment) VALUES (?,?,?,?,?)',
        r.lastInsertRowid, now.iso, req.user.id, 'submitted', '');
    });
    res.status(201).json({ pid });
  });

  api.get('/applications/:pid', requireRole('student'), (req, res) => {
    res.json({ application: serializeApp(ownApp(req), req.user.id, true), today: nowMsk().date });
  });

  api.post('/applications/:pid/cancel', requireRole('student'), (req, res) => {
    const row = ownApp(req);
    if (row.status !== 'submitted') throw new HttpError(409, 'Заявку уже взяли в работу — отменить можно через сообщение деканату.');
    const now = nowMsk().iso;
    db.tx(() => {
      db.run("UPDATE applications SET status = 'cancelled', updated_at = ? WHERE id = ?", now, row.id);
      db.run('INSERT INTO application_events (application_id, at, actor_id, status, comment) VALUES (?,?,?,?,?)',
        row.id, now, req.user.id, 'cancelled', 'Отменена студентом');
    });
    res.json({ ok: true });
  });

  function addMessage(row, req) {
    const text = multiline(req.body?.text);
    if (!text) throw new HttpError(400, 'Напишите сообщение');
    if (text.length > 1000) throw new HttpError(400, 'Сообщение не длиннее 1000 символов');
    const now = nowMsk().iso;
    db.run('INSERT INTO application_messages (application_id, author_id, text, at) VALUES (?,?,?,?)', row.id, req.user.id, text, now);
    db.run('UPDATE applications SET updated_at = ? WHERE id = ?', now, row.id);
    return text;
  }

  api.post('/applications/:pid/messages', requireRole('student'), (req, res) => {
    const row = ownApp(req);
    if (row.status === 'cancelled') throw new HttpError(409, 'Заявка отменена');
    addMessage(row, req);
    res.status(201).json({ ok: true });
  });

  // ——— уведомления ———
  api.get('/notifications', requireRole(), (req, res) => {
    if (req.user.role === 'student') ensureReminders(req, studentCtx(req));
    const rows = db.all(
      `SELECT id, kind, title, body, link, created_at AS at, read_at AS readAt
         FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`, req.user.id);
    res.json({ notifications: rows.map((r) => ({ ...r, unread: !r.readAt })), unread: unreadCount(req.user.id), today: nowMsk().date });
  });

  api.post('/notifications/read-all', requireRole(), (req, res) => {
    db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowMsk().iso, req.user.id);
    res.json({ ok: true, unread: 0 });
  });

  api.post('/notifications/:id/read', requireRole(), (req, res) => {
    const r = db.run('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?',
      nowMsk().iso, Number(req.params.id) || 0, req.user.id);
    if (!r.changes) throw new HttpError(404, 'Уведомление не найдено');
    res.json({ ok: true, unread: unreadCount(req.user.id) });
  });

  // ——— экран «Сегодня» ———
  api.get('/home', requireRole('student'), (req, res) => {
    const ctx = studentCtx(req);
    ensureReminders(req, ctx);
    const now = nowMsk();
    const today = schedule.day(ctx.groupCode, now.date);
    const left = today.items.filter((i) => schedule.isActive(i) && i.end > now.time);

    // Ближайшая пара: сегодня или в первый следующий учебный день.
    let next = null;
    let upcomingDay = null;
    if (left.length) {
      const item = left[0];
      next = { date: now.date, isToday: true, going: item.start <= now.time, item };
    } else {
      for (let i = 1; i <= 10 && !upcomingDay; i++) {
        const d = schedule.day(ctx.groupCode, addDays(now.date, i));
        if (d.items.some(schedule.isActive)) upcomingDay = d;
      }
      if (upcomingDay) {
        next = { date: upcomingDay.date, isToday: false, going: false, item: upcomingDay.items.find(schedule.isActive) };
      }
    }

    const week = schedule.range(ctx.groupCode, now.date, 7);
    // Перенос показываем один раз — там, откуда пара ушла (а не ещё и там, куда пришла).
    const changes = week.flatMap((d) => d.items.filter((i) => i.change && i.change.type !== 'moved_in').map((i) => ({
      date: d.date, pair: i.pair, start: i.start, subject: i.subject.name, change: i.change, room: i.room,
    }))).slice(0, 5);

    const deadlines = myDeadlines(ctx, now.iso).slice(0, 4).map((d) => ({ ...d, daysLeft: daysBetween(now.date, d.due) }));
    const grades = buildGrades(db, req.user.id, now.date);
    const apps = db.all(
      `SELECT * FROM applications WHERE student_id = ? AND (status IN ('submitted','in_progress','ready') OR updated_at >= ?)
        ORDER BY updated_at DESC LIMIT 3`, req.user.id, `${addDays(now.date, -3)}T00:00`)
      .map((r) => serializeApp(r, req.user.id));
    const news = db.all(
      `SELECT id, title, body, important, created_at AS at FROM announcements
        WHERE audience IN (?,?,?,?) ORDER BY important DESC, created_at DESC LIMIT 3`, ...ctx.audiences);

    res.json({
      now: now.iso, firstName: req.user.fullName.split(' ')[1] ?? req.user.fullName,
      today, next, upcomingDay, changes, deadlines, applications: apps, news,
      study: grades.summary, unread: unreadCount(req.user.id),
    });
  });

  // ————————————————————— кабинет сотрудника деканата —————————————————————
  const staffOnly = requireRole('staff');

  const staffAppRow = (pid) => {
    const row = db.get('SELECT * FROM applications WHERE public_id = ?', String(pid));
    if (!row) throw new HttpError(404, 'Заявка не найдена');
    return row;
  };
  const studentBrief = (id) => db.get(
    `SELECT u.full_name AS fullName, s.group_code AS "group", s.record_book AS recordBook, g.program_name AS program, g.course
       FROM users u JOIN students s ON s.user_id = u.id JOIN groups g ON g.code = s.group_code WHERE u.id = ?`, id);

  api.get('/staff/summary', staffOnly, (_req, res) => {
    const counts = Object.fromEntries(Object.keys(STATUS_LABEL).map((s) => [s, 0]));
    for (const r of db.all('SELECT status, COUNT(*) AS n FROM applications GROUP BY status')) counts[r.status] = r.n;
    const waiting = db.get(
      `SELECT COUNT(*) AS n FROM applications a WHERE a.status IN ('submitted','in_progress','ready') AND
         (SELECT u.role FROM application_messages m JOIN users u ON u.id = m.author_id
           WHERE m.application_id = a.id ORDER BY m.at DESC, m.id DESC LIMIT 1) = 'student'`).n;
    res.json({ counts, waitingReply: waiting, students: db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'student'").n });
  });

  api.get('/staff/applications', staffOnly, (req, res) => {
    const filter = String(req.query.status ?? 'active');
    const where = filter === 'all' ? '' : filter === 'active'
      ? `WHERE a.status IN (${ACTIVE.map((s) => `'${s}'`).join(',')})`
      : 'WHERE a.status = ?';
    const args = filter === 'all' || filter === 'active' ? [] : [filter in STATUS_LABEL ? filter : '—'];
    const rows = db.all(`SELECT a.* FROM applications a ${where} ORDER BY
      CASE a.status WHEN 'submitted' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'ready' THEN 2 ELSE 3 END, a.updated_at DESC LIMIT 200`, ...args);
    res.json({
      applications: rows.map((r) => {
        const last = db.get(
          `SELECT u.role FROM application_messages m JOIN users u ON u.id = m.author_id
            WHERE m.application_id = ? ORDER BY m.at DESC, m.id DESC LIMIT 1`, r.id);
        return { ...serializeApp(r, 0), student: { ...studentBrief(r.student_id) }, waitingReply: last?.role === 'student' };
      }),
    });
  });

  api.get('/staff/applications/:pid', staffOnly, (req, res) => {
    const row = staffAppRow(req.params.pid);
    res.json({
      application: serializeApp(row, req.user.id, true),
      student: { ...studentBrief(row.student_id) },
      transitions: TRANSITIONS[row.status].map((s) => ({ status: s, label: STATUS_LABEL[s] })),
    });
  });

  api.post('/staff/applications/:pid/status', staffOnly, (req, res) => {
    const row = staffAppRow(req.params.pid);
    const status = String(req.body?.status ?? '');
    const comment = multiline(req.body?.comment).slice(0, 600);
    if (!TRANSITIONS[row.status].includes(status)) throw new HttpError(409, 'Такой переход статуса недоступен');
    if (status === 'rejected' && !comment) throw new HttpError(400, 'Объясните студенту причину отказа', { fields: { comment: 'Обязательно при отказе' } });
    const now = nowMsk().iso;
    const payload = JSON.parse(row.payload);
    const type = TYPES[row.type];
    db.tx(() => {
      let code = row.verify_code;
      if (status === 'ready' && payload.delivery === 'electronic' && !code) code = verifyCode();
      db.run('UPDATE applications SET status = ?, updated_at = ?, verify_code = ? WHERE id = ?', status, now, code ?? null, row.id);
      db.run('INSERT INTO application_events (application_id, at, actor_id, status, comment) VALUES (?,?,?,?,?)',
        row.id, now, req.user.id, status, comment);
      const title = `${type?.title ?? 'Заявка'}: ${STATUS_LABEL[status].toLowerCase()}`;
      const body = comment || {
        in_progress: 'Деканат взял заявку в работу.',
        ready: payload.delivery === 'electronic' ? 'Электронная справка с кодом проверки ждёт в карточке заявки.' : 'Можно забирать в деканате в часы работы.',
        issued: 'Документ выдан. Заявка закрыта.',
      }[status] || '';
      notify(row.student_id, 'application', title, body, `/requests/${row.public_id}`);
    });
    res.json({ ok: true });
  });

  api.post('/staff/applications/:pid/messages', staffOnly, (req, res) => {
    const row = staffAppRow(req.params.pid);
    const text = addMessage(row, req);
    notify(row.student_id, 'application', `Деканат ответил по заявке «${TYPES[row.type]?.title ?? 'Заявка'}»`,
      text.slice(0, 140), `/requests/${row.public_id}`);
    res.status(201).json({ ok: true });
  });

  api.get('/staff/groups', staffOnly, (_req, res) => {
    res.json({
      groups: db.all(`SELECT g.code, g.faculty_short AS facultyShort, g.program_name AS program, g.course,
        (SELECT COUNT(*) FROM students s WHERE s.group_code = g.code) AS students FROM groups g ORDER BY g.code`),
      faculties: db.all('SELECT DISTINCT faculty_short AS short, faculty AS name FROM groups ORDER BY faculty_short'),
    });
  });

  /** Кому адресовано: all | group:<код> | faculty:<краткое> */
  function recipients(audience) {
    if (audience === 'all') return db.all("SELECT id FROM users WHERE role = 'student'");
    const [kind, value] = [audience.slice(0, audience.indexOf(':')), audience.slice(audience.indexOf(':') + 1)];
    if (kind === 'group' && db.get('SELECT 1 AS x FROM groups WHERE code = ?', value)) {
      return db.all('SELECT user_id AS id FROM students WHERE group_code = ?', value);
    }
    if (kind === 'faculty' && db.get('SELECT 1 AS x FROM groups WHERE faculty_short = ?', value)) {
      return db.all('SELECT s.user_id AS id FROM students s JOIN groups g ON g.code = s.group_code WHERE g.faculty_short = ?', value);
    }
    throw new HttpError(400, 'Выберите, кому адресовано объявление', { fields: { audience: 'Неизвестная аудитория' } });
  }

  api.get('/staff/announcements', staffOnly, (_req, res) => {
    res.json({ announcements: db.all(
      'SELECT id, title, body, audience, important, created_at AS at FROM announcements ORDER BY created_at DESC, id DESC LIMIT 50') });
  });

  api.post('/staff/announcements', staffOnly, (req, res) => {
    const title = clean(req.body?.title);
    const body = multiline(req.body?.body);
    const audience = String(req.body?.audience ?? '');
    const important = req.body?.important ? 1 : 0;
    const fields = {};
    if (!title) fields.title = 'Нужен заголовок'; else if (title.length > 120) fields.title = 'Не длиннее 120 символов';
    if (!body) fields.body = 'Нужен текст'; else if (body.length > 1500) fields.body = 'Не длиннее 1500 символов';
    if (Object.keys(fields).length) throw new HttpError(400, 'Проверьте поля', { fields });
    const to = recipients(audience);
    const now = nowMsk().iso;
    db.tx(() => {
      db.run('INSERT INTO announcements (author_id, title, body, audience, important, created_at) VALUES (?,?,?,?,?,?)',
        req.user.id, title, body, audience, important, now);
      for (const r of to) notify(r.id, 'announcement', title, body, '/inbox');
    });
    res.status(201).json({ ok: true, recipients: to.length });
  });

  api.get('/staff/schedule', staffOnly, (req, res) => {
    const group = String(req.query.group ?? '');
    if (!db.get('SELECT 1 AS x FROM groups WHERE code = ?', group)) throw new HttpError(400, 'Выберите группу');
    const date = isDate(req.query.date) ? req.query.date : nowMsk().date;
    res.json({ day: schedule.day(group, date) });
  });

  api.post('/staff/schedule-changes', staffOnly, (req, res) => {
    const b = req.body ?? {};
    const group = String(b.group ?? '');
    const date = String(b.date ?? '');
    const pair = Number(b.pair);
    const type = String(b.type ?? '');
    const note = clean(b.note).slice(0, 200);
    const today = nowMsk().date;
    if (!db.get('SELECT 1 AS x FROM groups WHERE code = ?', group)) throw new HttpError(400, 'Выберите группу');
    if (!isDate(date) || date < today) throw new HttpError(400, 'Дата должна быть сегодня или позже', { fields: { date: 'Проверьте дату' } });
    if (!['cancel', 'room', 'move'].includes(type)) throw new HttpError(400, 'Выберите, что меняется');
    const lesson = schedule.day(group, date).items.find((i) => i.pair === pair && !i.change);
    if (!lesson) throw new HttpError(400, 'В этот день на этой паре нет занятия без изменений', { fields: { pair: 'Нет такого занятия' } });
    const room = clean(b.room).slice(0, 40);
    const toDate = String(b.toDate ?? '');
    const toPair = Number(b.toPair);
    if (type === 'room' && !room) throw new HttpError(400, 'Укажите новую аудиторию', { fields: { room: 'Обязательно' } });
    if (type === 'move') {
      if (!isDate(toDate) || toDate < today || weekday(toDate) === 7) throw new HttpError(400, 'Проверьте дату переноса', { fields: { toDate: 'Будний день или суббота, не в прошлом' } });
      if (!db.get('SELECT 1 AS x FROM bells WHERE pair = ?', toPair)) throw new HttpError(400, 'Проверьте номер пары', { fields: { toPair: 'Нет такой пары' } });
      if (schedule.day(group, toDate).items.some((i) => i.pair === toPair && schedule.isActive(i))) {
        throw new HttpError(409, 'В это время у группы уже есть занятие', { fields: { toPair: 'Занято' } });
      }
    }
    const text = {
      cancel: 'пара отменена',
      room: `аудитория ${room} вместо ${lesson.room}`,
      move: `перенос на ${humanDate(toDate)}, ${toPair}-я пара`,
    }[type];
    const to = db.all('SELECT user_id AS id FROM students WHERE group_code = ?', group);
    db.tx(() => {
      db.run(
        `INSERT INTO schedule_changes (group_code, date, pair, type, room, to_date, to_pair, note, created_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        group, date, pair, type, type === 'cancel' ? null : (room || null), type === 'move' ? toDate : null,
        type === 'move' ? toPair : null, note, nowMsk().iso, req.user.id);
      for (const r of to) {
        notify(r.id, 'schedule', `Расписание: ${lesson.subject.name}`,
          `${humanDate(date)}, ${WEEKDAYS[weekday(date)]}, ${pair}-я пара — ${text}.${note ? ` ${note}.` : ''}`, `/schedule?date=${date}`);
      }
    });
    res.status(201).json({ ok: true, recipients: to.length });
  });

  // ——— публичная проверка электронной справки ———
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  function verifyCode() {
    const bytes = randomBytes(10);
    const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  }
  api.get('/verify/:code', (req, res) => {
    const code = String(req.params.code).toUpperCase().slice(0, 16);
    const row = db.get(
      `SELECT a.type, a.status, a.updated_at AS at, u.full_name AS fullName, g.program_code AS programCode,
              g.program_name AS programName, g.course, s.study_form AS studyForm
         FROM applications a JOIN users u ON u.id = a.student_id JOIN students s ON s.user_id = u.id
         JOIN groups g ON g.code = s.group_code WHERE a.verify_code = ?`, code);
    if (!row || !['ready', 'issued'].includes(row.status)) {
      return res.status(404).json({ valid: false, message: 'Справка с таким кодом не найдена или отозвана.' });
    }
    // Показываем минимум: имя и первые буквы, без номера зачётки и группы.
    const [last = '', first = '', middle = ''] = row.fullName.split(' ');
    res.json({
      valid: true, document: TYPES[row.type]?.title ?? 'Справка', issuedAt: row.at.slice(0, 10),
      holder: `${first} ${middle ? `${middle[0]}. ` : ''}${last[0] ?? ''}.`,
      program: `${row.programCode} ${row.programName}`, course: row.course, studyForm: row.studyForm,
      university: meta('university'),
    });
  });

  api.use((_req, _res) => { throw new HttpError(404, 'Такого адреса в API нет'); });
  app.use('/api', api);

  // ————————————————————— клиент —————————————————————
  app.use(express.static(PUBLIC_DIR, {
    index: false,
    setHeaders(res, path) {
      res.setHeader('Cache-Control', path.endsWith('.woff2') ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || /\.[a-z0-9]+$/i.test(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(PUBLIC_DIR, 'index.html'));
  });
  app.use((_req, res) => res.status(404).type('text/plain').send('Не найдено'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error(`[${nowMsk().iso}] ${req.method} ${req.path}`, err);
    if (err.extra?.retryAfter) res.setHeader('Retry-After', String(err.extra.retryAfter));
    if (res.headersSent) return;
    if (!req.originalUrl.startsWith('/api')) return res.status(status).type('text/plain').send('Ошибка');
    res.status(status).json({
      error: {
        message: status >= 500 ? 'Что-то сломалось на сервере. Попробуйте ещё раз.' : (err.status ? err.message : 'Некорректный запрос'),
        fields: err.extra?.fields,
      },
    });
  });

  return app;
}
