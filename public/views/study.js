import { html, icon, api, stamp, empty, fmtDay, fmtDayYear, daysBetween, plural, WD_SHORT, weekdayOf } from '../ui.js';
import { shortName } from './home.js';

const VERDICT_ICON = { ok: 'circle-check', attention: 'triangle-alert', debt: 'flame' };
const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function finalMark(item) {
  if (item.final === null) return '';
  if (item.final === 'зачтено') return stamp('ready', 'зачтено');
  if (item.final === 'не зачтено') return stamp('rejected', 'не зачтено');
  return html`<span class="grade ${item.final === '2' ? 'grade--bad' : ''}" aria-label="оценка ${item.final}">${item.final}</span>`;
}

const tone = (p) => (p === null ? '' : p >= 70 ? 'bar--ok' : p >= 50 ? 'bar--warn' : 'bar--bad');

/** Дисциплина текущего семестра: баллы, полоса прогресса, контрольные точки по клику. */
function current(item, today) {
  return html`
    <details class="disc">
      <summary>
        <span class="disc-name">${item.subject}</span>
        <span class="disc-score">${item.earned}<small>из ${item.held || item.total}</small></span>
        <span class="disc-meta">
          <span>${item.controlLabel}</span>
          ${item.risk ? html`<span class="chip chip--bad">${icon('triangle-alert')}под риском</span>` : ''}
          ${item.absences ? html`<span>пропусков ${item.absences} из ${item.classesHeld}</span>` : ''}
        </span>
        <span class="bar ${tone(item.percent)}"><i style="width:${item.percent ?? 0}%"></i></span>
      </summary>
      <div class="disc-body">
        ${item.teacher ? html`<p class="block-note">Преподаватель: ${shortName(item.teacher)}</p>` : ''}
        ${item.risk ? html`<p class="block-note"><span class="mark">Почему под риском</span> ${item.risk}.</p>` : ''}
        <table class="points">
          <tbody>
            ${item.checkpoints.map((c) => html`
              <tr class="${c.score === null ? 'is-future' : ''}">
                <td>${c.title}<br><span class="muted">${c.date ? fmtDay(c.date) : ''}${c.score === null && c.date >= today ? ', впереди' : ''}</span></td>
                <td>${c.score === null ? `до ${c.max}` : `${c.score} из ${c.max}`}</td>
              </tr>`)}
          </tbody>
        </table>
      </div>
    </details>`;
}

function book(sem) {
  return html`
    <h2 class="sem-title">${sem.number} семестр</h2>
    <div class="rows">
      ${sem.items.map((i) => html`
        <div class="row">
          <div class="row-main">
            <p class="row-title">${i.subject}</p>
            <p class="row-sub">${i.controlLabel}${i.finalDate ? `, ${fmtDayYear(i.finalDate)}` : ''}</p>
          </div>
          ${i.isDebt
            ? html`<div class="row-side">${finalMark(i)}<a class="chip chip--bad" href="/requests/new/retake?subject=${i.subjectId}">пересдать</a></div>`
            : finalMark(i)}
        </div>`)}
    </div>`;
}

function session(events, today) {
  if (!events.length) return empty('calendar-days', 'Расписание сессии ещё не опубликовано', 'Как только деканат его утвердит, оно появится здесь.');
  const KIND = { exam: 'Экзамен', credit: 'Зачёт', consult: 'Консультация' };
  return html`
    <p class="block-note">Зачётная неделя и экзамены. До первого события — ${Math.max(daysBetween(today, events[0].date), 0)} ${plural(Math.max(daysBetween(today, events[0].date), 0), 'день', 'дня', 'дней')}.</p>
    <div class="rows timeline">
      ${events.map((e) => html`
        <div class="row">
          <p class="tl-date"><b>${Number(e.date.slice(8, 10))}</b><small>${MONTH_SHORT[Number(e.date.slice(5, 7)) - 1]}, ${WD_SHORT[weekdayOf(e.date)]}</small></p>
          <div class="row-main">
            <p class="row-title">${e.subject}</p>
            <p class="row-sub">${e.time ?? ''}${e.room ? `, ауд. ${e.room}` : ''}${e.teacher ? `, ${shortName(e.teacher)}` : ''}</p>
          </div>
          <span class="chip ${e.kind === 'exam' ? 'chip--bad' : e.kind === 'credit' ? 'chip--warn' : ''}">${KIND[e.kind] ?? e.kind}</span>
        </div>`)}
    </div>`;
}

export async function studyView(ctx) {
  const tab = ['now', 'book', 'session'].includes(ctx.query.tab) ? ctx.query.tab : 'now';
  const [g, s] = await Promise.all([api.get('/grades'), api.get('/session')]);
  const sum = g.summary;
  const cur = g.semesters.find((x) => x.current);
  const past = g.semesters.filter((x) => !x.current).reverse();
  const debt = sum.debts[0];

  let body;
  if (tab === 'now') {
    body = cur ? html`
      <p class="block-note">${cur.number} семестр. Баллы за контрольные точки; нажмите на дисциплину, чтобы увидеть детали.
        ${sum.nextCheckpoint ? html`Ближайшая точка: ${sum.nextCheckpoint.title.toLowerCase()} по дисциплине «${sum.nextCheckpoint.subject}», ${fmtDay(sum.nextCheckpoint.date)}.` : ''}</p>
      <div>${cur.items.map((i) => current(i, s.today))}</div>` : empty('book-open', 'Дисциплин пока нет', '');
  } else if (tab === 'book') {
    body = past.length ? past.map(book) : empty('book-open', 'Зачётка пока пустая', 'Первые оценки появятся после зимней сессии.');
  } else {
    body = session(s.events, s.today);
  }

  return {
    title: 'Учёба',
    body: html`
      <div class="screen-head"><h1 class="screen-title">Учёба</h1></div>
      <section class="verdict verdict--${sum.state}">
        ${icon(VERDICT_ICON[sum.state])}
        <div>
          <h2>${sum.headline}</h2>
          <p>${sum.advice}</p>
          ${debt ? html`<a class="btn btn--small" href="/requests/new/retake?subject=${debt.subjectId}">Подать на пересдачу</a>` : ''}
        </div>
      </section>
      <div class="stats">
        <div class="stat"><b>${sum.gpa === null ? '—' : sum.gpa.toFixed(2).replace('.', ',')}</b><span>средний балл по зачётке</span></div>
        <div class="stat"><b>${sum.progress.percent === null ? '—' : `${sum.progress.percent}%`}</b><span>баллов набрано в семестре</span></div>
        <div class="stat"><b>${sum.closed}</b><span>${plural(sum.closed, 'дисциплина закрыта', 'дисциплины закрыты', 'дисциплин закрыто')}</span></div>
      </div>
      <div class="tabs">
        <div class="seg" role="group" aria-label="Раздел">
          <a class="${tab === 'now' ? 'is-active' : ''}" href="/study">Семестр</a>
          <a class="${tab === 'book' ? 'is-active' : ''}" href="/study?tab=book">Зачётка</a>
          <a class="${tab === 'session' ? 'is-active' : ''}" href="/study?tab=session">Сессия</a>
        </div>
      </div>
      ${body}`,
  };
}
