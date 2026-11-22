import {
  html, icon, api, stamp, empty, KIND, WD_FULL, cap, fmtDay, relDay, fmtStamp, fmtDuration, toMinutes, plural, weekdayOf,
} from '../ui.js';

const CHANGE_TEXT = {
  cancel: () => 'пара отменена',
  room: (c, room) => `аудитория ${room} вместо ${c.was}`,
  replace: (c) => (c.was ? `замена, было: ${c.was}` : 'замена'),
  moved_out: (c) => `перенос на ${fmtDay(c.toDate)}, ${c.toPair}-я пара`,
  moved_in: (c) => `перенесена с ${fmtDay(c.fromDate)}`,
  extra: () => 'дополнительное занятие',
};
export const changeText = (item) => CHANGE_TEXT[item.change.type]?.(item.change, item.room) ?? 'изменение';
const isOff = (item) => ['cancel', 'moved_out'].includes(item.change?.type);

/** Лента дня: шесть пар, где видно прошедшие, текущую, изменённые и отменённые. */
function strip(day, nowTime, isToday) {
  const slots = [1, 2, 3, 4, 5, 6].map((n) => {
    const items = day.items.filter((i) => i.pair === n);
    const live = items.find((i) => !isOff(i)) ?? items[0];
    if (!live) return html`<div class="slot"><b>${n}</b></div>`;
    const cls = ['slot', 'is-busy'];
    if (isOff(live)) cls.push('is-off');
    else if (live.change) cls.push('is-changed');
    if (isToday && !isOff(live)) {
      if (live.end <= nowTime) cls.push('is-done');
      else if (live.start <= nowTime) cls.push('is-now');
    }
    return html`<div class="${cls.join(' ')}" title="${live.subject.name}"><b>${n}</b><small>${live.start}</small></div>`;
  });
  return html`<div class="strip" aria-hidden="true">${slots}</div>`;
}

function hero(d) {
  const now = d.now.slice(11, 16);
  const today = d.now.slice(0, 10);
  const n = d.next;

  if (!n) {
    return html`<section class="now"><p class="now-free">В ближайшие дни пар нет</p></section>`;
  }
  const it = n.item;
  let state;
  if (n.going) state = html`<span class="now-state">Идёт сейчас, до конца ${fmtDuration(toMinutes(it.end) - toMinutes(now))}</span>`;
  else if (n.isToday) state = html`<span class="now-state">Следующая пара через ${fmtDuration(toMinutes(it.start) - toMinutes(now))}</span>`;
  else {
    const when = relDay(n.date, today);
    const done = d.today.items.some((i) => !isOff(i));
    state = html`<span class="now-state">${done ? 'На сегодня всё. ' : 'Сегодня пар нет. '}Первая пара ${when === 'завтра' ? 'завтра' : `${WD_FULL[weekdayOf(n.date)] === 'вторник' ? 'во' : 'в'} ${accusative(weekdayOf(n.date))}, ${when}`}</span>`;
  }
  const stripDay = n.isToday ? d.today : d.upcomingDay;
  return html`
    <section class="now" aria-label="Ближайшая пара">
      ${state}
      <div class="now-main">
        <p class="now-time">${it.start}<small>до ${it.end}</small></p>
        <div>
          <h2 class="now-subject">${it.subject.name}</h2>
          <p class="now-meta">
            <span class="now-room">${icon('map-pin')}${it.room || 'аудитория уточняется'}</span>
            <span>${KIND[it.kind] ?? it.kind}</span>
            ${it.teacher && html`<span>${icon('user')}${shortName(it.teacher.name)}</span>`}
          </p>
        </div>
      </div>
      ${it.change && html`<p class="now-note"><span class="mark">${cap(changeText(it))}</span>${it.change.note ? ` ${it.change.note}` : ''}</p>`}
      ${stripDay && strip(stripDay, now, n.isToday)}
      ${stripDay?.hasChanges && html`<p class="strip-legend"><span><i></i>есть изменения в расписании</span></p>`}
    </section>`;
}

const ACC = ['', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'];
const accusative = (wd) => ACC[wd];
export const shortName = (full) => {
  const [last, first, middle] = full.split(' ');
  return `${last} ${first ? `${first[0]}.` : ''}${middle ? `${middle[0]}.` : ''}`.trim();
};

function daysLeft(n) {
  if (n <= 0) return html`<span class="days-left is-hot">сегодня</span>`;
  if (n === 1) return html`<span class="days-left is-hot">завтра</span>`;
  return html`<span class="days-left ${n <= 3 ? 'is-hot' : ''}">${n} ${plural(n, 'день', 'дня', 'дней')}</span>`;
}

const RESOLUTION = { ok: ['ok', 'в порядке'], attention: ['warn', 'внимание'], debt: ['bad', 'долг'] };

/** Вывод «как дела с учёбой»: одна фраза, пояснение и штамп-резолюция. Общий для «Сегодня» и «Учёбы». */
export function resolution(study, tag = 'h2', action = '') {
  const [tone, label] = RESOLUTION[study.state] ?? RESOLUTION.ok;
  const title = tag === 'h3' ? html`<h3>${study.headline}</h3>` : html`<h2>${study.headline}</h2>`;
  return html`
    <div class="resolution">
      <div class="resolution-head">${title}<span class="stamp stamp--${tone}">${label}</span></div>
      <p>${study.advice}</p>
      ${action}
    </div>`;
}

export async function homeView(ctx) {
  const d = await api.get('/home');
  ctx.setUnread(d.unread);
  const today = d.now.slice(0, 10);

  const changes = d.changes.length ? html`
    <section class="block">
      <div class="block-head"><h2>Изменения в расписании</h2><a href="/schedule">Расписание</a></div>
      <div class="rows ledger">
        ${d.changes.map((c) => html`
          <a class="row" href="/schedule?date=${c.date}">
            <div class="row-main">
              <p class="row-title">${c.subject}</p>
              <p class="row-sub">
                ${c.change.type === 'replace' && c.change.was
                  ? html`<span class="mark">Замена</span> было: ${c.change.was}`
                  : html`<span class="mark">${cap(changeText({ change: c.change, room: c.room }))}</span>`}
                ${c.change.note ? html`<span class="change-note">${c.change.note}</span>` : ''}
              </p>
            </div>
            <div class="row-side"><time datetime="${c.date}">${relDay(c.date, today)}</time><span>${c.pair}-я пара</span></div>
          </a>`)}
      </div>
    </section>` : '';

  const deadlines = html`
    <section class="block">
      <div class="block-head"><h2>Сроки</h2></div>
      ${d.deadlines.length ? html`<div class="rows ledger">
        ${d.deadlines.map((x) => html`
          <a class="row" href="${x.link || '/'}">
            <div class="row-main"><p class="row-title">${x.title}</p><p class="row-sub">до ${fmtDay(x.due)}${x.due.length > 10 ? `, ${x.due.slice(11, 16)}` : ''}</p></div>
            ${daysLeft(x.daysLeft)}
          </a>`)}
      </div>` : html`<p class="block-note">Ближайших сроков нет</p>`}
    </section>`;

  const study = html`
    <section class="block">
      <div class="block-head"><h2>Учёба</h2><a href="/study">Подробнее</a></div>
      ${resolution(d.study, 'h3')}
    </section>`;

  const apps = html`
    <section class="block">
      <div class="block-head"><h2>Заявки</h2><a href="/requests">Все заявки</a></div>
      ${d.applications.length ? html`<div class="rows">
        ${d.applications.map((a) => html`
          <a class="row" href="/requests/${a.pid}">
            <div class="row-main"><p class="row-title">${a.title}</p><p class="row-sub">обновлена ${fmtStamp(a.updatedAt, today)}</p></div>
            ${stamp(a.status, a.statusLabel)}
          </a>`)}
      </div>` : html`<p class="block-note">Активных заявок нет</p>`}
      <div class="actions"><a class="btn btn--quiet" href="/requests/new/cert_study">${icon('plus')}Заказать справку</a></div>
    </section>`;

  const news = html`
    <section class="block">
      <div class="block-head"><h2>Объявления деканата</h2><a href="/inbox?filter=announcement">Все</a></div>
      ${d.news.length ? html`<div class="rows">
        ${d.news.map((x) => html`
          <article class="news-item">
            <h3>${x.title}</h3>
            <p>${x.body}</p>
            <time>${fmtStamp(x.at, today)}${x.important ? html`, <span class="news-important">важное</span>` : ''}</time>
          </article>`)}
      </div>` : empty('megaphone', 'Объявлений пока нет', '')}
    </section>`;

  return {
    title: 'Сегодня',
    body: html`
      <div class="hello">
        <h1 class="screen-title">${cap(WD_FULL[d.today.weekday])}, ${fmtDay(today)}</h1>
        <p class="screen-sub">${d.today.week}-я учебная неделя, ${d.today.parity === 'odd' ? 'нечётная' : 'чётная'}</p>
      </div>
      <div class="home-grid">
        <div>${hero(d)}${changes}${deadlines}</div>
        <div>${study}${apps}${news}</div>
      </div>
      <p class="page-foot">Концепт для конкурса MGIMO×AI Challenge. Не официальный сервис вуза, все данные вымышленные.</p>`,
  };
}
