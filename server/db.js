// Слой данных. Весь SQL живёт на сервере; чтобы переехать на PostgreSQL,
// достаточно заменить этот файл (тот же интерфейс get / all / run / tx).

import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('student','staff')),
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  seed_key TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS students (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  group_code TEXT NOT NULL,
  record_book TEXT,
  study_form TEXT,
  funding TEXT,
  admission_year INTEGER
);
CREATE TABLE IF NOT EXISTS staff (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  position TEXT,
  faculty TEXT
);
CREATE TABLE IF NOT EXISTS groups (
  code TEXT PRIMARY KEY, faculty TEXT, faculty_short TEXT,
  program_code TEXT, program_name TEXT, course INTEGER, curator_id TEXT
);
CREATE TABLE IF NOT EXISTS teachers (id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT);
CREATE TABLE IF NOT EXISTS subjects (id TEXT PRIMARY KEY, name TEXT NOT NULL, short TEXT);
CREATE TABLE IF NOT EXISTS bells (pair INTEGER PRIMARY KEY, start TEXT NOT NULL, end TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY, group_code TEXT NOT NULL, weekday INTEGER NOT NULL, pair INTEGER NOT NULL,
  parity TEXT NOT NULL, subject_id TEXT NOT NULL, kind TEXT NOT NULL, teacher_id TEXT, room TEXT
);
CREATE INDEX IF NOT EXISTS lessons_group ON lessons(group_code, weekday);
CREATE TABLE IF NOT EXISTS schedule_changes (
  id INTEGER PRIMARY KEY, group_code TEXT NOT NULL, date TEXT NOT NULL, pair INTEGER NOT NULL,
  type TEXT NOT NULL, room TEXT, teacher_id TEXT, subject_id TEXT, kind TEXT,
  to_date TEXT, to_pair INTEGER, note TEXT, created_at TEXT, created_by INTEGER
);
CREATE INDEX IF NOT EXISTS changes_group ON schedule_changes(group_code, date);
CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  semester INTEGER NOT NULL, subject_id TEXT NOT NULL, control TEXT NOT NULL, teacher_id TEXT,
  final TEXT, final_date TEXT, absences INTEGER DEFAULT 0, classes_held INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS enrollments_student ON enrollments(student_id, semester);
CREATE TABLE IF NOT EXISTS checkpoints (
  id INTEGER PRIMARY KEY, enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  title TEXT NOT NULL, max INTEGER NOT NULL, score INTEGER, date TEXT
);
CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY, group_code TEXT NOT NULL, subject_id TEXT NOT NULL, kind TEXT NOT NULL,
  date TEXT NOT NULL, time TEXT, room TEXT, teacher_id TEXT
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY, author_id INTEGER, title TEXT NOT NULL, body TEXT NOT NULL,
  audience TEXT NOT NULL, important INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deadlines (
  id INTEGER PRIMARY KEY, audience TEXT NOT NULL, title TEXT NOT NULL, due TEXT NOT NULL, kind TEXT, link TEXT
);
CREATE TABLE IF NOT EXISTS deadline_reminders (
  user_id INTEGER NOT NULL, deadline_id INTEGER NOT NULL, PRIMARY KEY (user_id, deadline_id)
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY, public_id TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, verify_code TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS applications_student ON applications(student_id);
CREATE TABLE IF NOT EXISTS application_events (
  id INTEGER PRIMARY KEY, application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  at TEXT NOT NULL, actor_id INTEGER, status TEXT NOT NULL, comment TEXT
);
CREATE TABLE IF NOT EXISTS application_messages (
  id INTEGER PRIMARY KEY, application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT,
  created_at TEXT NOT NULL, read_at TEXT
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, user_agent TEXT
);
CREATE TABLE IF NOT EXISTS login_attempts (key TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS login_attempts_key ON login_attempts(key, at);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`;

export function openDb(file) {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  raw.exec(SCHEMA);
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  return {
    raw,
    get: (sql, ...p) => stmt(sql).get(...p),
    all: (sql, ...p) => stmt(sql).all(...p),
    run: (sql, ...p) => stmt(sql).run(...p),
    /** Синхронная транзакция: либо всё, либо ничего. */
    tx(fn) {
      raw.exec('BEGIN');
      try { const r = fn(); raw.exec('COMMIT'); return r; }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
    close: () => raw.close(),
  };
}
