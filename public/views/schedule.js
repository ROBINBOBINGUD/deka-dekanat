import { html, icon, api, empty, KIND, WD_SHORT, WD_FULL, cap, fmtDay, addDays, mondayOf, weekdayOf, toMinutes, fmtDuration } from '../ui.js';
import { changeText, shortName } from './home.js';

const isOff = (i) => ['cancel', 'moved_out'].includes(i.change?.type);

function pairRow(item, live) {
  const cls = ['pair'];
  if (isOff(item)) cls.push('is-off');
  if (live) cls.push('is-now');
  return html`
    <li class="${cls.join(' ')}">
      <div class="pair-slot"><b>${item.pair}</b>${item.start}<br>${item.end}</div>
      <div>
        <h3 class="pair-title">${item.subject.name}</h3>
        <p class="pair-meta">
          <span>${KIND[item.kind] ?? item.kind}</span>
          ${item.room && html`<span class="pair-room">${icon('map-pin')}${item.room}</span>`}
          ${item.teacher && html`<span title="${item.teacher.name}, ${item.teacher.title ?? ''}">${icon('user')}${shortName(item.teacher.name)}</span>`}
        </p>
        ${item.change && html`<p class="pair-change">
          ${item.change.type === 'replace' && item.change.was
            ? html`<span class="mark">Замена</span> было: ${item.change.was}`
            : html`<span class="mark">${cap(changeText(item))}</span>`}
          ${item.change.note ? html`<span class="change-note">${item.change.note}</span>` : ''}</p>`}
        ${live && html`<p class="pair-change pair-live">Идёт сейчас</p>`}
      </div>
    </li>`;
}

/** Список пар одного дня с пометкой «окно», если между парами есть свободная пара. */
function dayList(day, data) {
  if (!day.items.length) return empty('calendar-x', 'В этот день пар нет', '');
  const out = [];
  let prev = null;
  for (const item of day.items) {
    if (prev && !isOff(item) && item.pair - prev.pair > 1) {
      out.push(html`<li class="gap-note">Окно ${fmtDuration(toMinutes(item.start) - toMinutes(prev.end))}</li>`);
    }
    const live = day.date === data.today && !isOff(item) && item.start <= data.now && item.end > data.now;
    out.push(pairRow(item, live));
    if (!isOff(item)) prev = item;
  }
  return html`<ol class="rows">${out}</ol>`;
}

export async function scheduleView(ctx) {
  const wanted = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.date ?? '') ? ctx.query.date : null;
  const first = await api.get(`/schedule${wanted ? `?from=${mondayOf(wanted)}&days=7` : ''}`);
  const data = first;
  const today = data.today;
  const monday = data.from;
  // Воскресенье в сетке не показываем: если выбран или сегодня выходной — открываем понедельник той же недели.
  let active = wanted ?? (today >= monday && today <= addDays(monday, 5) ? today : monday);
  if (weekdayOf(active) === 7) active = addDays(active, -6);
  const mode = ctx.query.view === 'week' ? 'week' : 'day';
  const days = data.days.slice(0, 6);
  const weekInfo = days[0];
  const link = (date, view = mode) => `/schedule?date=${date}${view === 'week' ? '&view=week' : ''}`;
  const isThisWeek = mondayOf(today) === monday;

  const pills = html`
    <nav class="daypills" aria-label="Дни недели">
      ${days.map((d) => html`
        <a class="daypill ${d.date === active && mode === 'day' ? 'is-active' : ''} ${d.date === today ? 'is-today' : ''} ${d.hasChanges ? 'has-change' : ''}"
           href="${link(d.date, 'day')}" ${d.date === active && mode === 'day' ? html`aria-current="date"` : ''}
           aria-label="${WD_FULL[d.weekday]}, ${fmtDay(d.date)}${d.hasChanges ? ', есть изменения' : ''}">
          <small>${WD_SHORT[d.weekday]}</small><b>${Number(d.date.slice(8, 10))}</b>
        </a>`)}
    </nav>`;

  const activeDay = days.find((d) => d.date === active) ?? days[0];
  const dayBody = html`
    <h2 class="day-title">${cap(WD_FULL[activeDay.weekday])}, ${fmtDay(activeDay.date)}
      ${activeDay.date === today ? html`<small>сегодня</small>` : ''}</h2>
    ${dayList(activeDay, data)}`;

  const weekBody = html`
    <div class="week">
      ${days.map((d) => html`
        <section>
          <h2 class="day-title">${cap(WD_FULL[d.weekday])}, ${fmtDay(d.date)}${d.date === today ? html`<small>сегодня</small>` : ''}</h2>
          ${d.items.length ? dayList(d, data) : html`<p class="block-note">Пар нет</p>`}
        </section>`)}
    </div>`;

  return {
    title: 'Расписание',
    body: html`
      <div class="screen-head">
        <div><h1 class="screen-title">Расписание</h1><p class="screen-sub">Группа ${data.group}</p></div>
        <div class="seg" role="group" aria-label="Вид">
          <a class="${mode === 'day' ? 'is-active' : ''}" href="${link(active, 'day')}">День</a>
          <a class="${mode === 'week' ? 'is-active' : ''}" href="${link(active, 'week')}">Неделя</a>
        </div>
      </div>
      <div class="weekbar">
        <a class="round" href="${link(addDays(monday, -7))}" aria-label="Предыдущая неделя">${icon('chevron-left')}</a>
        <p class="weekbar-title">
          <b>${fmtDay(monday).split(' ')[0]}–${fmtDay(addDays(monday, 5))}</b>
          <span>${weekInfo.week}-я неделя, ${weekInfo.parity === 'odd' ? 'числитель' : 'знаменатель'}</span>
        </p>
        <a class="round" href="${link(addDays(monday, 7))}" aria-label="Следующая неделя">${icon('chevron-right')}</a>
      </div>
      ${pills}
      ${!isThisWeek ? html`<p><a class="back" href="/schedule">${icon('arrow-left')}Вернуться к текущей неделе</a></p>` : ''}
      ${mode === 'day' ? dayBody : weekBody}`,
  };
}
