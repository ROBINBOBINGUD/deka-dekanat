// Всё время в кабинете — московское. Сервер может стоять в любом поясе,
// поэтому «сегодня» считаем здесь, а не через локальное время процесса.

const TZ = 'Europe/Moscow';
export const SEMESTER_START = '2026-08-31'; // понедельник, неделя 1 — нечётная («числитель»)

const fmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

/** Текущий момент по Москве. DEKA_NOW=2026-11-24T10:05 подменяет его (тесты, скриншоты). */
export function nowMsk() {
  const forced = process.env.DEKA_NOW;
  const stamp = forced
    ? (forced.length === 16 ? `${forced}:00` : forced)
    : fmt.format(new Date()).replace(' ', 'T');
  return { iso: stamp, date: stamp.slice(0, 10), time: stamp.slice(11, 16) };
}

const toUtc = (date) => new Date(`${date}T00:00:00Z`);

export function addDays(date, n) {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 1 — понедельник … 7 — воскресенье */
export function weekday(date) {
  return ((toUtc(date).getUTCDay() + 6) % 7) + 1;
}

export function mondayOf(date) {
  return addDays(date, 1 - weekday(date));
}

export function weekNumber(date) {
  const diff = Math.floor((toUtc(date) - toUtc(SEMESTER_START)) / 86400000);
  return Math.floor(diff / 7) + 1;
}

export function parityOf(date) {
  return weekNumber(date) % 2 === 1 ? 'odd' : 'even';
}

export function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUtc(s).getTime());
}

/** Сколько полных суток от даты a до даты b (b − a). */
export function daysBetween(a, b) {
  return Math.round((toUtc(b.slice(0, 10)) - toUtc(a.slice(0, 10))) / 86400000);
}
