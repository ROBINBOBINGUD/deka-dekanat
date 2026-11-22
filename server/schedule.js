// Расписание = недельная сетка группы + наложенные изменения на конкретные даты.

import { addDays, weekday, parityOf, weekNumber } from './time.js';

const LESSON_SQL = `
  SELECT l.id, l.pair, l.kind, l.room, l.subject_id AS subjectId, l.teacher_id AS teacherId
    FROM lessons l
   WHERE l.group_code = ? AND l.weekday = ? AND l.parity IN ('all', ?)`;

export function createSchedule(db) {
  const dict = (table) => new Map(db.all(`SELECT * FROM ${table}`).map((r) => [r.id ?? r.pair, r]));
  // Справочники маленькие и меняются только при пересоздании БД — читаем один раз.
  let refs;
  const load = () => (refs ??= { bells: dict('bells'), subjects: dict('subjects'), teachers: dict('teachers') });

  const decorate = (pair, subjectId, teacherId, kind, room) => {
    const { bells, subjects, teachers } = load();
    const bell = bells.get(pair) ?? {};
    const s = subjects.get(subjectId);
    const t = teachers.get(teacherId);
    return {
      pair, start: bell.start ?? '', end: bell.end ?? '', kind, room: room ?? '',
      subject: s ? { name: s.name, short: s.short } : { name: '—', short: '—' },
      teacher: t ? { name: t.name, title: t.title } : null,
      change: null,
    };
  };
  const teacherName = (id) => load().teachers.get(id)?.name ?? null;
  const subjectName = (id) => load().subjects.get(id)?.name ?? null;

  /** Занятия группы на дату с учётом отмен, замен, переносов и дополнительных пар. */
  function day(group, date) {
    const wd = weekday(date);
    const base = wd === 7 ? [] : db.all(LESSON_SQL, group, wd, parityOf(date));
    const changes = db.all('SELECT * FROM schedule_changes WHERE group_code = ? AND date = ?', group, date);
    const movedIn = db.all("SELECT * FROM schedule_changes WHERE group_code = ? AND type = 'move' AND to_date = ?", group, date);
    const items = [];

    for (const l of base) {
      const item = decorate(l.pair, l.subjectId, l.teacherId, l.kind, l.room);
      const ch = changes.find((c) => c.pair === l.pair && c.type !== 'extra');
      if (ch) {
        if (ch.type === 'cancel') item.change = { type: 'cancel', note: ch.note };
        if (ch.type === 'room') {
          item.change = { type: 'room', note: ch.note, was: l.room };
          item.room = ch.room ?? item.room;
        }
        if (ch.type === 'replace') {
          const was = [];
          if (ch.teacher_id && ch.teacher_id !== l.teacherId) was.push(teacherName(l.teacherId));
          if (ch.subject_id && ch.subject_id !== l.subjectId) was.push(subjectName(l.subjectId));
          Object.assign(item, decorate(l.pair, ch.subject_id ?? l.subjectId, ch.teacher_id ?? l.teacherId, ch.kind ?? l.kind, ch.room ?? l.room));
          item.change = { type: 'replace', note: ch.note, was: was.filter(Boolean).join(', ') };
        }
        if (ch.type === 'move') item.change = { type: 'moved_out', note: ch.note, toDate: ch.to_date, toPair: ch.to_pair };
      }
      items.push(item);
    }

    for (const ch of movedIn) {
      const src = db.all(LESSON_SQL, group, weekday(ch.date), parityOf(ch.date)).find((l) => l.pair === ch.pair);
      if (!src) continue;
      const item = decorate(ch.to_pair, src.subjectId, src.teacherId, src.kind, ch.room ?? src.room);
      item.change = { type: 'moved_in', note: ch.note, fromDate: ch.date, fromPair: ch.pair };
      items.push(item);
    }

    for (const ch of changes.filter((c) => c.type === 'extra')) {
      const item = decorate(ch.pair, ch.subject_id, ch.teacher_id, ch.kind ?? 'practice', ch.room);
      item.change = { type: 'extra', note: ch.note };
      items.push(item);
    }

    items.sort((a, b) => a.pair - b.pair || (a.change?.type === 'moved_in' ? 1 : -1));
    return {
      date, weekday: wd, week: weekNumber(date), parity: parityOf(date), items,
      hasChanges: items.some((i) => i.change),
    };
  }

  function range(group, from, days) {
    return Array.from({ length: days }, (_, i) => day(group, addDays(from, i)));
  }

  const isActive = (item) => !['cancel', 'moved_out'].includes(item.change?.type);

  return { day, range, isActive, subjectName, teacherName, reset: () => { refs = undefined; } };
}
