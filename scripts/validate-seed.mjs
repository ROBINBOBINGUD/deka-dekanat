import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(here, '..', 'seed', 'data.json');
const errors = [];
const err = (m) => errors.push(m);

let d;
try {
  d = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error('JSON не читается: ' + e.message);
  process.exit(1);
}

const sections = ['university', 'bells', 'teachers', 'subjects', 'groups', 'students', 'staff', 'lessons', 'changes', 'enrollments', 'sessionEvents', 'announcements', 'deadlines', 'applications'];
for (const s of sections) if (d[s] == null) err(`нет раздела ${s}`);
if (errors.length) { report(); }

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const validDate = (s) => DATE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const validDT = (s) => DT.test(s) && validDate(s.slice(0, 10));
const inEnum = (v, list, where) => { if (!list.includes(v)) err(`${where}: недопустимое значение ${JSON.stringify(v)}`); };

const ids = (arr, key) => new Set(arr.map((x) => x[key]));
const teacherIds = ids(d.teachers, 'id');
const subjectIds = ids(d.subjects, 'id');
const groupCodes = ids(d.groups, 'code');
const studentKeys = ids(d.students, 'key');
const staffKeys = ids(d.staff, 'key');
const people = new Set([...studentKeys, ...staffKeys]);
const facultyShorts = new Set(d.groups.map((g) => g.facultyShort));
for (const [arr, key, name] of [[d.teachers, 'id', 'teachers'], [d.subjects, 'id', 'subjects'], [d.groups, 'code', 'groups'], [d.students, 'key', 'students'], [d.staff, 'key', 'staff']]) {
  if (ids(arr, key).size !== arr.length) err(`${name}: дубли ${key}`);
}
const needT = (id, where) => { if (!teacherIds.has(id)) err(`${where}: нет преподавателя ${id}`); };
const needS = (id, where) => { if (!subjectIds.has(id)) err(`${where}: нет дисциплины ${id}`); };
const needG = (id, where) => { if (!groupCodes.has(id)) err(`${where}: нет группы ${id}`); };

// даты и недели
const dayMs = 86400000;
const utc = (s) => Date.parse(s.slice(0, 10) + 'T00:00:00Z');
const weekday = (s) => { const w = new Date(utc(s)).getUTCDay(); return w === 0 ? 7 : w; };
const SEM_START = utc('2026-08-31');
const parityOf = (s) => (Math.floor((utc(s) - SEM_START) / (7 * dayMs)) % 2 === 0 ? 'odd' : 'even');
const overlap = (a, b) => a === 'all' || b === 'all' || a === b;

// университет, звонки
if (d.university.short !== 'ДПИ НГТУ' || d.university.city !== 'Дзержинск' || !d.university.full) err('university: неверные поля');
if (d.bells.length !== 6) err('bells: нужно 6 пар');
d.bells.forEach((b, i) => {
  if (b.pair !== i + 1 || !TIME.test(b.start) || !TIME.test(b.end)) err(`bells[${i}]: неверный формат`);
});

// люди
const TITLES = ['профессор', 'доцент', 'старший преподаватель', 'ассистент'];
d.teachers.forEach((t) => { inEnum(t.title, TITLES, `teacher ${t.id}.title`); if (!t.name || t.name.split(' ').length !== 3) err(`teacher ${t.id}: ФИО из трёх слов`); });
for (const g of d.groups) {
  needT(g.curator, `group ${g.code}.curator`);
  if (!g.faculty || !g.facultyShort || !g.programCode || !g.programName || !Number.isInteger(g.course)) err(`group ${g.code}: не все поля`);
}
const stuByKey = Object.fromEntries(d.students.map((s) => [s.key, s]));
for (const s of d.students) {
  needG(s.group, `student ${s.key}.group`);
  if (!s.email.endsWith('@example.edu')) err(`student ${s.key}: почта не на example.edu`);
  inEnum(s.studyForm, ['очная', 'очно-заочная', 'заочная'], `student ${s.key}.studyForm`);
  inEnum(s.funding, ['бюджет', 'контракт'], `student ${s.key}.funding`);
  if (!s.login) err(`student ${s.key}: нет login`);
}
for (const s of d.staff) if (!s.login || !s.fullName || !s.position) err(`staff ${s.key}: не все поля`);

// занятия
const lessonKey = (l) => `${l.group} день ${l.weekday} пара ${l.pair}`;
d.lessons.forEach((l, i) => {
  const w = `lesson[${i}] ${lessonKey(l)}`;
  needG(l.group, w); needS(l.subject, w); needT(l.teacher, w);
  inEnum(l.parity, ['all', 'odd', 'even'], w + '.parity');
  inEnum(l.kind, ['lecture', 'practice', 'lab'], w + '.kind');
  if (!(l.weekday >= 1 && l.weekday <= 6)) err(w + ': weekday вне 1..6');
  if (!(l.pair >= 1 && l.pair <= 6)) err(w + ': pair вне 1..6');
  if (!l.room) err(w + ': нет аудитории');
});
for (let i = 0; i < d.lessons.length; i++) {
  for (let j = i + 1; j < d.lessons.length; j++) {
    const a = d.lessons[i], b = d.lessons[j];
    if (a.group === b.group && a.weekday === b.weekday && a.pair === b.pair && overlap(a.parity, b.parity)) err(`конфликт занятий: ${lessonKey(a)} (${a.parity}/${b.parity})`);
    if (a.teacher === b.teacher && a.weekday === b.weekday && a.pair === b.pair && overlap(a.parity, b.parity)) err(`преподаватель ${a.teacher} занят дважды: день ${a.weekday} пара ${a.pair}`);
  }
}
for (const g of d.groups) {
  for (let wd = 1; wd <= 6; wd++) for (const p of ['odd', 'even']) {
    const n = d.lessons.filter((l) => l.group === g.code && l.weekday === wd && overlap(l.parity, p) ).length;
    if (wd <= 5 && (n < 2 || n > 4)) err(`${g.code}: день ${wd} (${p}) — ${n} пар, нужно 2–4`);
    if (wd === 6 && n > 2) err(`${g.code}: суббота (${p}) — ${n} пар, максимум 2`);
  }
}
const findLessons = (group, date, pair) => {
  const wd = weekday(date), par = parityOf(date);
  return d.lessons.filter((l) => l.group === group && l.weekday === wd && l.pair === pair && (l.parity === 'all' || l.parity === par));
};

// изменения
d.changes.forEach((c, i) => {
  const w = `change[${i}] ${c.group} ${c.date} пара ${c.pair}`;
  needG(c.group, w);
  if (!validDate(c.date)) err(w + ': неверная дата');
  inEnum(c.type, ['cancel', 'room', 'replace', 'move', 'extra'], w + '.type');
  if (!c.note) err(w + ': нет note');
  if (!(c.pair >= 1 && c.pair <= 6)) err(w + ': pair вне 1..6');
  if (c.type !== 'extra' && findLessons(c.group, c.date, c.pair).length !== 1) err(`${w}: нет занятия в сетке (день ${weekday(c.date)}, ${parityOf(c.date)})`);
  if (c.type === 'room' && !c.room) err(w + ': нет room');
  if (c.type === 'replace') { if (!c.teacher && !c.subject) err(w + ': replace без teacher/subject'); if (c.teacher) needT(c.teacher, w); if (c.subject) needS(c.subject, w); }
  if (c.type === 'move') {
    if (!validDate(c.toDate) || !(c.toPair >= 1 && c.toPair <= 6)) err(w + ': неверные toDate/toPair');
    else if (findLessons(c.group, c.toDate, c.toPair).length) err(w + ': целевая пара занята');
  }
  if (c.type === 'extra') {
    needS(c.subject, w); needT(c.teacher, w); inEnum(c.kind, ['lecture', 'practice', 'lab'], w + '.kind');
    if (!c.room) err(w + ': нет room');
    if (findLessons(c.group, c.date, c.pair).length) err(w + ': extra на занятую пару');
  }
});

// зачётки
const enrKey = new Set();
const curSem = {};
const curSubj = {};
d.enrollments.forEach((e, i) => {
  const w = `enrollment[${i}] ${e.student} сем.${e.semester} ${e.subject}`;
  if (!studentKeys.has(e.student)) err(w + ': нет студента');
  needS(e.subject, w); needT(e.teacher, w);
  inEnum(e.control, ['exam', 'credit', 'diff', 'course'], w + '.control');
  inEnum(e.final, ['5', '4', '3', '2', 'зачтено', 'не зачтено', null], w + '.final');
  const k = `${e.student}|${e.semester}|${e.subject}`;
  if (enrKey.has(k)) err(w + ': дубль'); enrKey.add(k);
  if (e.final === null) { if (e.finalDate !== null) err(w + ': final null, но finalDate задан'); (curSubj[e.student] ??= new Map()).set(e.subject, e); curSem[e.student] = Math.max(curSem[e.student] ?? 0, e.semester); }
  else if (!validDate(e.finalDate)) err(w + ': неверная finalDate');
  if ((e.control === 'credit' && !['зачтено', 'не зачтено'].includes(e.final) && e.final !== null)) err(w + ': credit с оценкой');
  if ((e.control === 'exam' || e.control === 'diff') && !['5', '4', '3', '2', null].includes(e.final)) err(w + ': exam/diff без оценки');
  if (!(e.absences >= 0 && e.absences <= e.classesHeld)) err(w + ': пропуски > занятий');
  e.checkpoints.forEach((c, j) => {
    if (!c.title || !(c.max > 0) || !validDate(c.date)) err(`${w} cp[${j}]: неверные поля`);
    if (c.score !== null && !(c.score >= 0 && c.score <= c.max)) err(`${w} cp[${j}]: score вне 0..max`);
  });
});
for (const key of studentKeys) {
  const cs = curSubj[key];
  if (!cs) { err(`студент ${key}: нет текущего семестра`); continue; }
  for (const e of d.enrollments.filter((x) => x.student === key)) if (e.final === null && e.semester !== curSem[key]) err(`студент ${key}: незакрытый семестр ${e.semester}`);
  for (const [sid, e] of cs) {
    const sum = e.checkpoints.reduce((a, c) => a + c.max, 0);
    if (sum !== 60) err(`студент ${key} ${sid}: сумма max = ${sum}, нужно 60`);
    if (e.checkpoints.length < 2 || e.checkpoints.length > 4) err(`студент ${key} ${sid}: контрольных точек ${e.checkpoints.length}`);
  }
}
if (d.enrollments.filter((e) => e.control === 'course' && e.final === null).length !== 2) err('курсовая: по одной на студента в текущем семестре');

// сессия
const kindFor = { exam: 'exam', credit: 'credit', diff: 'credit', course: 'credit' };
d.sessionEvents.forEach((s, i) => {
  const w = `sessionEvent[${i}] ${s.group} ${s.subject} ${s.kind}`;
  needG(s.group, w); needS(s.subject, w); needT(s.teacher, w);
  inEnum(s.kind, ['exam', 'credit', 'consult'], w + '.kind');
  if (!validDate(s.date) || !TIME.test(s.time) || !s.room) err(w + ': дата/время/аудитория');
  const studs = d.students.filter((x) => x.group === s.group);
  for (const st of studs) {
    const e = curSubj[st.key]?.get(s.subject);
    if (!e) { err(`${w}: дисциплины нет в текущем семестре студента ${st.key}`); continue; }
    if (s.kind !== 'consult' && kindFor[e.control] !== s.kind) err(`${w}: kind не согласован с control=${e.control}`);
    if (s.kind === 'credit' && !(s.date >= '2026-12-21' && s.date <= '2026-12-26')) err(w + ': зачёт вне 21–26.12.2026');
    if (s.kind === 'exam' && !(s.date >= '2027-01-11' && s.date <= '2027-01-24')) err(w + ': экзамен вне 11–24.01.2027');
    if (weekday(s.date) === 7 && validDate(s.date)) err(w + ': воскресенье');
  }
  if (s.kind === 'exam') {
    const prev = new Date(utc(s.date) - dayMs).toISOString().slice(0, 10);
    if (!d.sessionEvents.some((c) => c.group === s.group && c.subject === s.subject && c.kind === 'consult' && c.date === prev)) err(w + ': нет консультации накануне');
  }
});
for (const st of d.students) {
  for (const [sid, e] of curSubj[st.key] ?? []) {
    const main = d.sessionEvents.filter((s) => s.group === st.group && s.subject === sid && s.kind !== 'consult');
    if (main.length !== 1) err(`студент ${st.key} ${sid}: событий сессии ${main.length}, нужно 1`);
    if (!d.lessons.some((l) => l.group === st.group && l.subject === sid)) err(`студент ${st.key} ${sid}: нет занятий в сетке`);
  }
}
for (const l of d.lessons) {
  const st = d.students.find((x) => x.group === l.group);
  if (st && !curSubj[st.key]?.has(l.subject)) err(`${lessonKey(l)}: дисциплина ${l.subject} не из текущего семестра`);
}

// объявления
const audOk = (a) => a === 'all' || (a.startsWith('group:') && groupCodes.has(a.slice(6))) || (a.startsWith('faculty:') && facultyShorts.has(a.slice(8))) || (a.startsWith('student:') && studentKeys.has(a.slice(8)));
d.announcements.forEach((a, i) => {
  const w = `announcement[${i}] ${a.title}`;
  if (!audOk(a.audience)) err(w + ': audience ' + a.audience);
  if (!validDT(a.date) || a.date < '2026-11-14' || a.date > '2026-11-22T23:59') err(w + ': дата вне 14–22.11.2026');
  if (!staffKeys.has(a.author)) err(w + ': нет автора');
  if (typeof a.important !== 'boolean' || !a.body) err(w + ': important/body');
});
if (d.announcements.filter((a) => a.important).length < 2) err('announcements: нужно ≥2 важных');

// дедлайны
d.deadlines.forEach((x, i) => {
  const w = `deadline[${i}] ${x.title}`;
  if (!audOk(x.audience)) err(w + ': audience');
  if (!validDT(x.due) || x.due < '2026-11-23' || x.due > '2026-12-12T23:59') err(w + ': due вне окна 23.11–12.12');
  inEnum(x.kind, ['study', 'finance', 'docs', 'event'], w + '.kind');
  inEnum(x.link, ['/study', '/requests', '/inbox', '/schedule'], w + '.link');
});

// заявки
const STATUS = ['submitted', 'in_progress', 'ready', 'issued', 'rejected', 'cancelled'];
const TYPES = ['cert_study', 'cert_income', 'retake', 'session_extend', 'aid', 'duplicate', 'free_form'];
d.applications.forEach((a, i) => {
  const w = `application[${i}] ${a.student} ${a.type}`;
  if (!studentKeys.has(a.student)) err(w + ': нет студента');
  inEnum(a.type, TYPES, w + '.type'); inEnum(a.status, STATUS, w + '.status');
  if (!validDT(a.createdAt)) err(w + ': createdAt');
  if (!a.events.length) { err(w + ': нет событий'); return; }
  const first = a.events[0];
  if (first.status !== 'submitted' || first.by !== a.student || first.at !== a.createdAt) err(w + ': первое событие должно быть submitted от студента на createdAt');
  a.events.forEach((e, j) => {
    inEnum(e.status, STATUS, `${w} event[${j}].status`);
    if (!validDT(e.at)) err(`${w} event[${j}]: дата`);
    if (j > 0) { if (e.at <= a.events[j - 1].at) err(`${w} event[${j}]: даты не по возрастанию`); if (!staffKeys.has(e.by)) err(`${w} event[${j}]: by должен быть сотрудником`); }
    if (!people.has(e.by)) err(`${w} event[${j}]: нет by ${e.by}`);
  });
  if (a.events.at(-1).status !== a.status) err(w + ': последнее событие не совпадает со status');
  if (a.createdAt < '2026-11-10' || a.createdAt > '2026-11-21T23:59') err(w + ': вне 10–21.11.2026');
  (a.messages ?? []).forEach((m, j) => {
    if (!validDT(m.at) || !people.has(m.by) || !m.text) err(`${w} message[${j}]: поля`);
    if (m.by !== 'D' && m.by !== a.student) err(`${w} message[${j}]: by не из участников`);
  });
  if (a.type === 'rejected' && !a.events.at(-1).comment) err(w + ': нет комментария отказа');
  if (a.status === 'rejected' && !a.events.at(-1).comment) err(w + ': нет комментария отказа');
  if (a.type === 'retake') {
    needS(a.payload.subject, w + '.payload');
    const bad = d.enrollments.find((e) => e.student === a.student && e.subject === a.payload.subject && e.final === '2');
    if (!bad) err(w + ': у студента нет долга по этой дисциплине');
  }
});
if (d.applications.filter((a) => (a.messages ?? []).length).length !== 2) err('applications: переписка должна быть ровно в двух заявках');

// ФИО и почта: только вымышленные, домен example.edu
for (const m of JSON.stringify(d).match(/[\w.+-]+@[\w.-]+/g) ?? []) if (!m.endsWith('@example.edu')) err('почта не на example.edu: ' + m);

report();

function report() {
  if (errors.length) {
    console.error(`Ошибок: ${errors.length}`);
    for (const e of errors) console.error(' - ' + e);
    process.exit(1);
  }
  const counts = sections.map((s) => `${s}: ${Array.isArray(d[s]) ? d[s].length : Object.keys(d[s]).length}`);
  console.log('OK');
  console.log(counts.join('\n'));
}
