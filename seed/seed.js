// Заполняет БД вымышленными данными из seed/data.json и тестовыми аккаунтами из seed/demo-accounts.json.
// Запуск вручную: `npm run seed` (стирает прежние данные). Сервер сам вызывает сид, если БД пустая.

import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openDb } from '../server/db.js';
import { hashPassword, randomId } from '../server/auth.js';

const HERE = import.meta.dirname;
const TABLES = [
  'notifications', 'application_messages', 'application_events', 'applications', 'deadline_reminders', 'deadlines',
  'announcements', 'session_events', 'checkpoints', 'enrollments', 'schedule_changes', 'lessons', 'bells',
  'sessions', 'login_attempts', 'staff', 'students', 'users', 'groups', 'teachers', 'subjects', 'meta',
];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const human = (d) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const STATUS = { submitted: 'подана', in_progress: 'в работе', ready: 'готова', issued: 'выдана', rejected: 'отказано', cancelled: 'отменена' };
const TITLE = {
  cert_study: 'Справка об обучении', cert_income: 'Справка о стипендии', retake: 'Заявление на пересдачу',
  session_extend: 'Продление сессии', aid: 'Материальная помощь', duplicate: 'Дубликат документа', free_form: 'Вопрос в деканат',
};
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const verifyCode = () => {
  const s = [...randomBytes(10)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `${s.slice(0, 5)}-${s.slice(5)}`;
};

/**
 * Пароли тестовых аккаунтов. В открытом репозитории лежит demo-accounts.json — он годится только
 * для локального запуска. На стенде для жюри используется demo-accounts.prod.json: его нет в
 * открытом репозитории, он попадает на сервер только с веткой деплоя.
 */
export function accountsFile() {
  const prod = process.env.DEKA_ACCOUNTS || join(HERE, 'demo-accounts.prod.json');
  return existsSync(prod) ? prod : join(HERE, 'demo-accounts.json');
}

export const loadSeedFiles = () => ({
  data: JSON.parse(readFileSync(join(HERE, 'data.json'), 'utf8')),
  accounts: JSON.parse(readFileSync(accountsFile(), 'utf8')),
});

/**
 * @param db       открытая БД (server/db.js)
 * @param data     содержимое seed/data.json
 * @param accounts { login: { password } } — пароли тестовых аккаунтов
 */
export async function seedDatabase(db, data, accounts) {
  // Пароли хешируем заранее: внутри транзакции только синхронные вставки.
  const people = [
    ...data.students.map((s) => ({ ...s, role: 'student' })),
    ...data.staff.map((s) => ({ ...s, role: 'staff' })),
  ];
  for (const p of people) {
    const password = accounts[p.login]?.password;
    if (!password) throw new Error(`Нет пароля для тестового аккаунта «${p.login}» в demo-accounts.json`);
    p.hash = await hashPassword(password);
  }

  db.tx(() => {
    for (const t of TABLES) db.run(`DELETE FROM ${t}`);
    const createdAt = '2026-09-01T09:00';
    const ids = {};

    db.run('INSERT INTO meta (key, value) VALUES (?, ?)', 'university', JSON.stringify(data.university));
    for (const b of data.bells) db.run('INSERT INTO bells (pair, start, end) VALUES (?,?,?)', b.pair, b.start, b.end);
    for (const t of data.teachers) db.run('INSERT INTO teachers (id, name, title) VALUES (?,?,?)', t.id, t.name, t.title ?? null);
    for (const s of data.subjects) db.run('INSERT INTO subjects (id, name, short) VALUES (?,?,?)', s.id, s.name, s.short ?? s.name);
    for (const g of data.groups) {
      db.run('INSERT INTO groups (code, faculty, faculty_short, program_code, program_name, course, curator_id) VALUES (?,?,?,?,?,?,?)',
        g.code, g.faculty, g.facultyShort, g.programCode, g.programName, g.course, g.curator ?? null);
    }

    for (const p of people) {
      const r = db.run(
        'INSERT INTO users (role, login, password_hash, full_name, email, is_demo, seed_key, created_at) VALUES (?,?,?,?,?,1,?,?)',
        p.role, p.login.toLowerCase(), p.hash, p.fullName, p.email ?? null, p.key, createdAt);
      ids[p.key] = Number(r.lastInsertRowid);
      if (p.role === 'student') {
        db.run('INSERT INTO students (user_id, group_code, record_book, study_form, funding, admission_year) VALUES (?,?,?,?,?,?)',
          ids[p.key], p.group, p.recordBook ?? null, p.studyForm ?? 'очная', p.funding ?? 'бюджет', p.admissionYear ?? null);
      } else {
        db.run('INSERT INTO staff (user_id, position, faculty) VALUES (?,?,?)', ids[p.key], p.position ?? null, p.faculty ?? null);
      }
    }
    const studentsOf = (audience) => {
      const all = data.students;
      if (audience === 'all') return all;
      const value = audience.slice(audience.indexOf(':') + 1);
      if (audience.startsWith('group:')) return all.filter((s) => s.group === value);
      if (audience.startsWith('student:')) return all.filter((s) => s.key === value);
      if (audience.startsWith('faculty:')) {
        const codes = data.groups.filter((g) => g.facultyShort === value).map((g) => g.code);
        return all.filter((s) => codes.includes(s.group));
      }
      return [];
    };
    const subjectName = (id) => data.subjects.find((s) => s.id === id)?.name ?? '';
    const notify = (userId, kind, title, body, link, at, read) =>
      db.run('INSERT INTO notifications (user_id, kind, title, body, link, created_at, read_at) VALUES (?,?,?,?,?,?,?)',
        userId, kind, title, body ?? '', link ?? null, at, read ? at : null);

    for (const l of data.lessons) {
      db.run('INSERT INTO lessons (group_code, weekday, pair, parity, subject_id, kind, teacher_id, room) VALUES (?,?,?,?,?,?,?,?)',
        l.group, l.weekday, l.pair, l.parity ?? 'all', l.subject, l.kind, l.teacher ?? null, l.room ?? null);
    }

    const author = ids[data.staff[0].key];
    for (const c of data.changes) {
      db.run(
        `INSERT INTO schedule_changes (group_code, date, pair, type, room, teacher_id, subject_id, kind, to_date, to_pair, note, created_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        c.group, c.date, c.pair, c.type, c.room ?? null, c.teacher ?? null, c.subject ?? null, c.kind ?? null,
        c.toDate ?? null, c.toPair ?? null, c.note ?? '', '2026-11-21T15:00', author);
      const lesson = data.lessons.find((l) => l.group === c.group && l.pair === c.pair
        && l.weekday === ((new Date(`${c.date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1);
      const what = {
        cancel: 'пара отменена', room: `аудитория ${c.room}`, replace: 'замена преподавателя',
        move: `перенос на ${c.toDate ? human(c.toDate) : ''}, ${c.toPair}-я пара`, extra: 'дополнительное занятие',
      }[c.type];
      const subj = subjectName(c.subject ?? lesson?.subject) || 'Занятие';
      for (const s of studentsOf(`group:${c.group}`)) {
        notify(ids[s.key], 'schedule', `Расписание: ${subj}`,
          `${human(c.date)}, ${c.pair}-я пара — ${what}.${c.note ? ` ${c.note}.` : ''}`.replace('..', '.'),
          `/schedule?date=${c.date}`, '2026-11-21T15:00', false);
      }
    }

    for (const e of data.enrollments) {
      const r = db.run(
        `INSERT INTO enrollments (student_id, semester, subject_id, control, teacher_id, final, final_date, absences, classes_held)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        ids[e.student], e.semester, e.subject, e.control, e.teacher ?? null, e.final ?? null, e.finalDate ?? null,
        e.absences ?? 0, e.classesHeld ?? 0);
      for (const c of e.checkpoints ?? []) {
        db.run('INSERT INTO checkpoints (enrollment_id, title, max, score, date) VALUES (?,?,?,?,?)',
          r.lastInsertRowid, c.title, c.max, c.score ?? null, c.date ?? null);
      }
    }

    for (const e of data.sessionEvents) {
      db.run('INSERT INTO session_events (group_code, subject_id, kind, date, time, room, teacher_id) VALUES (?,?,?,?,?,?,?)',
        e.group, e.subject, e.kind, e.date, e.time ?? null, e.room ?? null, e.teacher ?? null);
    }

    for (const a of data.announcements) {
      db.run('INSERT INTO announcements (author_id, title, body, audience, important, created_at) VALUES (?,?,?,?,?,?)',
        ids[a.author] ?? author, a.title, a.body, a.audience, a.important ? 1 : 0, a.date);
      // Старые объявления считаем прочитанными, свежие (с 20.11) — нет: лента выглядит живой.
      for (const s of studentsOf(a.audience)) notify(ids[s.key], 'announcement', a.title, a.body, '/inbox', a.date, a.date < '2026-11-20');
    }

    for (const d of data.deadlines) {
      db.run('INSERT INTO deadlines (audience, title, due, kind, link) VALUES (?,?,?,?,?)', d.audience, d.title, d.due, d.kind ?? 'study', d.link ?? null);
    }

    for (const a of data.applications) {
      const electronic = a.payload?.delivery === 'electronic' && ['ready', 'issued'].includes(a.status);
      const pid = randomId(9);
      const last = a.events.at(-1);
      const issuedAt = a.events.find((e) => e.status === 'ready')?.at ?? null;
      const r = db.run(
        'INSERT INTO applications (public_id, student_id, type, payload, status, created_at, updated_at, verify_code, issued_at) VALUES (?,?,?,?,?,?,?,?,?)',
        pid, ids[a.student], a.type, JSON.stringify(a.payload ?? {}), a.status, a.createdAt, last?.at ?? a.createdAt,
        electronic ? verifyCode() : null, issuedAt);
      for (const e of a.events) {
        db.run('INSERT INTO application_events (application_id, at, actor_id, status, comment) VALUES (?,?,?,?,?)',
          r.lastInsertRowid, e.at, ids[e.by] ?? null, e.status, e.comment ?? '');
        if (e.status !== 'submitted') {
          notify(ids[a.student], 'application', `${TITLE[a.type] ?? 'Заявка'}: ${STATUS[e.status]}`, e.comment ?? '',
            `/requests/${pid}`, e.at, e !== last);
        }
      }
      for (const m of a.messages ?? []) {
        db.run('INSERT INTO application_messages (application_id, author_id, text, at) VALUES (?,?,?,?)',
          r.lastInsertRowid, ids[m.by], m.text, m.at);
      }
    }
  });
}

// ——— запуск из командной строки ———
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.env.DATA_DIR || (process.env.AMVERA ? '/data' : join(HERE, '..', 'data'));
  mkdirSync(dir, { recursive: true });
  const db = openDb(join(dir, 'deka.db'));
  const has = db.get('SELECT COUNT(*) AS n FROM users').n;
  if (has && !process.argv.includes('--force')) {
    console.log('В БД уже есть данные. Чтобы пересоздать: npm run seed');
  } else {
    const { data, accounts } = loadSeedFiles();
    await seedDatabase(db, data, accounts);
    console.log(`Готово: ${db.get('SELECT COUNT(*) AS n FROM users').n} аккаунта, ${db.get('SELECT COUNT(*) AS n FROM lessons').n} занятий в сетке.`);
  }
  db.close();
}
