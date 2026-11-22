// Успеваемость: зачётка по семестрам, текущие баллы и вывод «как у меня дела».

const CONTROL_LABEL = { exam: 'экзамен', credit: 'зачёт', diff: 'зачёт с оценкой', course: 'курсовая работа' };
const plural = (n, one, few, many) => {
  const a = n % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
};

export function buildGrades(db, studentId, today) {
  const rows = db.all(
    `SELECT e.id, e.semester, e.subject_id AS subjectId, e.control, e.final, e.final_date AS finalDate,
            e.absences, e.classes_held AS classesHeld, s.name AS subject, s.short, t.name AS teacher
       FROM enrollments e JOIN subjects s ON s.id = e.subject_id LEFT JOIN teachers t ON t.id = e.teacher_id
      WHERE e.student_id = ? ORDER BY e.semester, s.name`, studentId);
  const points = db.all(
    `SELECT c.enrollment_id AS enrollmentId, c.title, c.max, c.score, c.date
       FROM checkpoints c JOIN enrollments e ON e.id = c.enrollment_id
      WHERE e.student_id = ? ORDER BY c.date, c.id`, studentId);

  const byEnrollment = new Map();
  for (const p of points) {
    if (!byEnrollment.has(p.enrollmentId)) byEnrollment.set(p.enrollmentId, []);
    byEnrollment.get(p.enrollmentId).push({ title: p.title, max: p.max, score: p.score, date: p.date });
  }

  const items = rows.map((r) => {
    const cps = byEnrollment.get(r.id) ?? [];
    const done = cps.filter((c) => c.score !== null);
    const earned = done.reduce((s, c) => s + c.score, 0);
    const held = done.reduce((s, c) => s + c.max, 0);
    const percent = held ? Math.round((earned / held) * 100) : null;
    const absenceShare = r.classesHeld ? r.absences / r.classesHeld : 0;
    const isDebt = r.final === '2' || r.final === 'не зачтено';
    const reasons = [];
    if (r.final === null && percent !== null && percent < 50) reasons.push(`набрано ${percent}% баллов`);
    if (r.final === null && absenceShare > 0.3) reasons.push(`пропущено ${r.absences} из ${r.classesHeld} занятий`);
    return {
      semester: r.semester, subjectId: r.subjectId, subject: r.subject, short: r.short, teacher: r.teacher,
      control: r.control, controlLabel: CONTROL_LABEL[r.control] ?? r.control,
      final: r.final, finalDate: r.finalDate, isDebt,
      absences: r.absences, classesHeld: r.classesHeld,
      checkpoints: cps, earned, held, total: cps.reduce((s, c) => s + c.max, 0), percent,
      risk: reasons.length ? reasons.join(', ') : null,
    };
  });

  const semesters = [...new Set(items.map((i) => i.semester))].sort((a, b) => a - b);
  const open = items.filter((i) => i.final === null);
  const current = open.length ? Math.max(...open.map((i) => i.semester)) : (semesters.at(-1) ?? 1);
  const now = items.filter((i) => i.semester === current);

  const numeric = items.filter((i) => ['5', '4', '3'].includes(i.final)).map((i) => Number(i.final));
  const gpa = numeric.length ? Math.round((numeric.reduce((a, b) => a + b, 0) / numeric.length) * 100) / 100 : null;
  const debts = items.filter((i) => i.isDebt);
  const risks = now.filter((i) => i.risk);
  const earned = now.reduce((s, i) => s + i.earned, 0);
  const held = now.reduce((s, i) => s + i.held, 0);
  const upcoming = now
    .flatMap((i) => i.checkpoints.filter((c) => c.score === null && c.date >= today).map((c) => ({ ...c, subject: i.subject })))
    .sort((a, b) => a.date.localeCompare(b.date));

  let state = 'ok';
  let headline = 'Долгов нет, баллы выше порога';
  let advice = 'По всем дисциплинам семестра набрано больше половины возможных баллов, пропусков немного.';
  if (risks.length) {
    state = 'attention';
    headline = `${risks.length} ${plural(risks.length, 'дисциплина требует', 'дисциплины требуют', 'дисциплин требуют')} внимания`;
    advice = `${risks.map((r) => r.subject).join(', ')}: до сессии ещё можно добрать баллы на ближайших контрольных точках.`;
  }
  if (debts.length) {
    state = 'debt';
    headline = `${debts.length} ${plural(debts.length, 'академический долг', 'академических долга', 'академических долгов')}`;
    advice = `${debts.map((d) => d.subject).join(', ')}. Подайте заявление на пересдачу — деканат согласует дату.`
      + (risks.length ? ` Ещё ${risks.length} ${plural(risks.length, 'дисциплина', 'дисциплины', 'дисциплин')} под риском в этом семестре.` : '');
  }

  return {
    currentSemester: current,
    semesters: semesters.map((n) => ({ number: n, current: n === current, items: items.filter((i) => i.semester === n) })),
    summary: {
      state, headline, advice, gpa,
      closed: items.filter((i) => i.final !== null && !i.isDebt).length,
      debts: debts.map((d) => ({ subjectId: d.subjectId, subject: d.subject, semester: d.semester })),
      risks: risks.map((r) => ({ subject: r.subject, reason: r.risk })),
      progress: { earned, held, percent: held ? Math.round((earned / held) * 100) : null },
      nextCheckpoint: upcoming[0] ?? null,
      fives: numeric.filter((n) => n === 5).length, fours: numeric.filter((n) => n === 4).length, threes: numeric.filter((n) => n === 3).length,
    },
  };
}
