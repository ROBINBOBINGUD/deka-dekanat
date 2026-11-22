// Кабинет сотрудника деканата: очередь заявок, карточка заявки, объявления, изменения расписания.

import {
  html, render, icon, api, stamp, empty, toast, busy, showFieldErrors, formData,
  fmtStamp, fmtDay, fmtTime, plural, KIND,
} from '../ui.js';

// Каркас (index.html) подключает только app.css, поэтому стили этого раздела подключаем сами.
if (!document.querySelector('link[data-staff-css]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/styles/staff.css';
  link.dataset.staffCss = '';
  document.head.append(link);
}

// «Сегодня» по Москве: в браузере считаем так же, как сервер, а не по UTC.
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date());
const isDateStr = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));

/** Ошибки полей показываем под полями; если подходящего поля нет, говорим тостом. */
function fail(form, e) {
  if (e.fields) showFieldErrors(form, e.fields);
  if (!e.fields || !form.querySelector('.field-error')) toast(e.message, 'bad');
}

// ——— 1. Очередь заявок ———
const FILTERS = [
  ['active', 'Активные'], ['submitted', 'Новые'], ['in_progress', 'В работе'],
  ['ready', 'Готовы'], ['rejected', 'Отказано'], ['all', 'Все'],
];

export async function staffQueueView(ctx) {
  const filter = FILTERS.some(([k]) => k === ctx.query.status) ? ctx.query.status : 'active';
  const [summary, list] = await Promise.all([
    api.get('/staff/summary'),
    api.get(`/staff/applications?status=${encodeURIComponent(filter)}`),
  ]);
  const now = today();
  const apps = list.applications;

  return {
    title: 'Заявки студентов',
    body: html`
      <div class="screen-head"><h1 class="screen-title">Заявки студентов</h1></div>
      <div class="stats">
        <div class="stat"><b>${summary.counts.submitted ?? 0}</b><span>Новые</span></div>
        <div class="stat"><b>${summary.counts.in_progress ?? 0}</b><span>В работе</span></div>
        <div class="stat"><b>${summary.waitingReply ?? 0}</b><span>Ждут ответа</span></div>
      </div>
      <nav class="filters block" aria-label="Фильтр заявок">
        ${FILTERS.map(([k, label]) => html`
          <a href="/staff?status=${k}" class="${k === filter ? 'is-active' : ''}" ${k === filter ? html`aria-current="page"` : ''}>${label}</a>`)}
      </nav>
      ${apps.length ? html`
        <div class="rows">
          ${apps.map((a) => html`
            <a class="row" href="/staff/requests/${encodeURIComponent(a.pid)}">
              <div class="row-main">
                <p class="row-title">${a.title}</p>
                <p class="row-sub">${a.student.fullName}, ${a.student.group}</p>
                ${a.summary && html`<p class="row-sub">${a.summary}</p>`}
              </div>
              <div class="row-side">
                ${stamp(a.status, a.statusLabel)}
                <span class="row-sub">${fmtStamp(a.createdAt, now)}</span>
                ${a.waitingReply && html`<span class="chip chip--marker">ждёт ответа</span>`}
              </div>
            </a>`)}
        </div>` : empty('inbox', 'Заявок нет', 'Здесь появятся заявки студентов.')}`,
  };
}

// ——— 2. Карточка заявки ———
const ACTION_BTN = {
  in_progress: { label: 'Взять в работу', cls: '' },
  ready: { label: 'Отметить готовой', cls: 'btn--ok' },
  issued: { label: 'Выдано', cls: '' },
  rejected: { label: 'Отказать', cls: 'btn--danger' },
};

export async function staffDetailView(ctx) {
  const pid = encodeURIComponent(ctx.params.pid);
  const { application: a, student: s, transitions } = await api.get(`/staff/applications/${pid}`);
  const now = today();

  return {
    title: a.title,
    body: html`
      <a class="back" href="/staff">${icon('arrow-left')} Все заявки</a>
      <div class="screen-head">
        <h1 class="screen-title">${a.title}</h1>
        ${stamp(a.status, a.statusLabel, 'stamp--big')}
      </div>

      <section class="block">
        <div class="block-head"><h2>Студент</h2></div>
        <div class="sheet"><dl class="kv">
          <dt>ФИО</dt><dd>${s.fullName}</dd>
          <dt>Группа</dt><dd>${s.group}</dd>
          <dt>Курс</dt><dd>${s.course}</dd>
          <dt>Направление</dt><dd>${s.program}</dd>
          <dt>№ зачётки</dt><dd>${s.recordBook}</dd>
        </dl></div>
      </section>

      <section class="block">
        <div class="block-head"><h2>Что просит</h2></div>
        <div class="sheet">
          ${a.details?.length ? html`<dl class="kv">
            ${a.details.map((d) => html`<dt>${d.label}</dt><dd>${d.value}</dd>`)}
          </dl>` : html`<p class="muted">Студент ничего не добавил.</p>`}
          ${a.verify && html`<p class="verify-line">Код проверки справки:
            <a href="/verify/${encodeURIComponent(a.verify.code)}" target="_blank" rel="noopener"><b>${a.verify.code}</b></a></p>`}
        </div>
      </section>

      ${transitions.length ? html`
        <section class="block">
          <div class="block-head"><h2>Решение</h2></div>
          <form class="form" data-decision novalidate>
            <div class="field">
              <label for="dec-comment">Комментарий для студента</label>
              <textarea id="dec-comment" name="comment" maxlength="600"></textarea>
              <p class="field-hint">Обязателен при отказе</p>
            </div>
            <div class="actions">
              ${transitions.map((t) => html`
                <button class="btn ${ACTION_BTN[t.status]?.cls ?? ''}" type="button" data-status="${t.status}" data-label="${t.label}">
                  ${ACTION_BTN[t.status]?.label ?? t.label}</button>`)}
            </div>
          </form>
        </section>` : ''}

      <section class="block">
        <div class="block-head"><h2>История</h2></div>
        <ol class="events">
          ${a.events.map((e) => html`
            <li><b>${e.statusLabel}</b><time>${fmtStamp(e.at, now)}</time>
              ${e.comment && html`<p>${e.comment}</p>`}</li>`)}
        </ol>
      </section>

      <section class="block">
        <div class="block-head"><h2>Переписка</h2></div>
        ${a.messages.length ? html`<div class="chat">
          ${a.messages.map((m) => html`
            <div class="msg ${m.mine ? 'msg--mine' : ''}">
              <p>${m.text}</p>
              <small>${m.mine ? 'Вы' : 'Студент'}, ${fmtStamp(m.at, now)}</small>
            </div>`)}
        </div>` : html`<p class="muted chat-empty">Сообщений пока нет.</p>`}
        ${a.canWrite && html`
          <form class="send" data-send novalidate>
            <label class="visually-hidden" for="msg-text">Ответ студенту</label>
            <textarea id="msg-text" name="text" rows="1" maxlength="1500" placeholder="Ответить студенту"></textarea>
            <button class="btn" type="submit" aria-label="Отправить">${icon('send')}</button>
          </form>`}
      </section>`,

    mount(root) {
      const decision = root.querySelector('[data-decision]');
      decision?.addEventListener('click', async (ev) => {
        const button = ev.target.closest('button[data-status]');
        if (!button) return;
        const { comment } = formData(decision);
        try {
          await busy(button, () => api.post(`/staff/applications/${pid}/status`, { status: button.dataset.status, comment }));
          toast(`Статус обновлён: ${button.dataset.label}`);
          ctx.reload();
        } catch (e) { fail(decision, e); }
      });

      const send = root.querySelector('[data-send]');
      send?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const text = send.elements.text.value.trim();
        if (!text) { send.elements.text.focus(); return; }
        try {
          await busy(send.querySelector('[type=submit]'), () => api.post(`/staff/applications/${pid}/messages`, { text }));
          ctx.reload();
        } catch (e) { toast(e.message, 'bad'); }
      });
    },
  };
}

// ——— 3. Объявления ———
const audienceChip = (aud) => (aud === 'all' ? 'всем' : aud.slice(aud.indexOf(':') + 1));

export async function staffAnnounceView(ctx) {
  const [{ groups, faculties }, { announcements }] = await Promise.all([
    api.get('/staff/groups'), api.get('/staff/announcements'),
  ]);
  const now = today();

  return {
    title: 'Объявления',
    body: html`
      <div class="screen-head"><h1 class="screen-title">Объявления</h1></div>
      <form class="form" data-announce novalidate>
        <div class="field">
          <label for="an-title">Заголовок</label>
          <input id="an-title" type="text" name="title" maxlength="120" autocomplete="off">
        </div>
        <div class="field">
          <label for="an-body">Текст</label>
          <textarea id="an-body" name="body" maxlength="1500"></textarea>
        </div>
        <div class="field">
          <label for="an-aud">Кому</label>
          <select id="an-aud" name="audience">
            <option value="all">Всем студентам</option>
            ${faculties.map((f) => html`<option value="faculty:${f.short}">Факультет ${f.short}</option>`)}
            ${groups.map((g) => html`<option value="group:${g.code}">Группа ${g.code}</option>`)}
          </select>
        </div>
        <label class="check"><input type="checkbox" name="important"> Важное</label>
        <div class="actions"><button class="btn" type="submit">Опубликовать</button></div>
      </form>

      <section class="block">
        <div class="block-head"><h2>Опубликованные</h2></div>
        ${announcements.length ? html`<div class="rows">
          ${announcements.map((n) => html`
            <div class="row">
              <div class="row-main">
                <p class="row-title">${n.title}</p>
                <p class="row-sub clamp2">${n.body}</p>
              </div>
              <div class="row-side">
                <span class="row-sub">${fmtStamp(n.at, now)}</span>
                <span class="chip">${audienceChip(n.audience)}</span>
                ${n.important ? html`<span class="chip chip--bad">важное</span>` : ''}
              </div>
            </div>`)}
        </div>` : empty('megaphone', 'Пока ничего нет', 'Опубликованные объявления появятся здесь.')}
      </section>`,

    mount(root) {
      const form = root.querySelector('[data-announce]');
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const d = formData(form);
        const body = { title: d.title, body: d.body, audience: d.audience, important: form.elements.important.checked };
        try {
          const res = await busy(form.querySelector('[type=submit]'), () => api.post('/staff/announcements', body));
          toast(`Опубликовано: получат ${res.recipients} ${plural(res.recipients, 'студент', 'студента', 'студентов')}`);
          ctx.reload();
        } catch (e) { fail(form, e); }
      });
    },
  };
}

// ——— 4. Изменение расписания ———
const CHANGE_LABEL = {
  cancel: 'отменена', room: 'другая аудитория', replace: 'замена',
  moved_out: 'перенесена', moved_in: 'перенос сюда', extra: 'доп. занятие',
};
const PAIRS = [1, 2, 3, 4, 5, 6];

const noteField = (pair) => html`
  <div class="field">
    <label for="sc-note-${pair}">Причина</label>
    <input id="sc-note-${pair}" type="text" name="note" maxlength="200" autocomplete="off">
  </div>`;

function slotForm(pair, type, min) {
  return html`
    <form class="lesson-form form" data-change data-pair="${pair}" data-type="${type}" novalidate>
      ${type === 'room' && html`
        <div class="field">
          <label for="sc-room-${pair}">Новая аудитория</label>
          <input id="sc-room-${pair}" type="text" name="room" maxlength="40" autocomplete="off">
        </div>`}
      ${type === 'move' && html`
        <div class="field">
          <label for="sc-date-${pair}">Новая дата</label>
          <input id="sc-date-${pair}" type="date" name="toDate" min="${min}">
        </div>
        <div class="field">
          <label for="sc-pair-${pair}">Пара</label>
          <select id="sc-pair-${pair}" name="toPair">
            ${PAIRS.map((p) => html`<option value="${p}">${p}-я пара</option>`)}
          </select>
        </div>`}
      ${noteField(pair)}
      <div class="actions">
        <button class="btn btn--small" type="submit">Сохранить изменение</button>
        <button class="btn btn--small btn--quiet" type="button" data-close>Не менять</button>
      </div>
    </form>`;
}

export async function staffScheduleView(ctx) {
  const min = today();
  const { groups } = await api.get('/staff/groups');
  const group = groups.some((g) => g.code === ctx.query.group) ? ctx.query.group : '';
  const date = isDateStr(ctx.query.date) ? ctx.query.date : min;
  const day = group
    ? (await api.get(`/staff/schedule?group=${encodeURIComponent(group)}&date=${encodeURIComponent(date)}`)).day
    : null;

  return {
    title: 'Изменение расписания',
    body: html`
      <div class="screen-head">
        <div>
          <h1 class="screen-title">Изменение расписания</h1>
          <p class="screen-sub">Студенты группы сразу получат уведомление</p>
        </div>
      </div>
      <form class="pick form" data-pick novalidate>
        <div class="field">
          <label for="sc-group">Группа</label>
          <select id="sc-group" name="group">
            <option value="" ${group ? '' : html`selected`}>Выберите группу</option>
            ${groups.map((g) => html`<option value="${g.code}" ${g.code === group ? html`selected` : ''}>${g.code}</option>`)}
          </select>
        </div>
        <div class="field">
          <label for="sc-day">Дата</label>
          <input id="sc-day" type="date" name="date" value="${date}" min="${min}">
        </div>
      </form>

      ${day ? html`
        <section class="block">
          <div class="block-head"><h2>${fmtDay(date)}</h2></div>
          ${day.items.length ? html`<div class="rows">
            ${day.items.map((i) => html`
              <div class="lesson" data-lesson="${i.pair}">
                <div class="row">
                  <b class="lesson-no">${i.pair}</b>
                  <div class="row-main">
                    <p class="row-title">${i.subject.name}</p>
                    <p class="row-sub">${i.start}–${i.end}, ${KIND[i.kind] ?? i.kind}, ауд. ${i.room || '—'}</p>
                    ${i.teacher && html`<p class="row-sub">${i.teacher.name}</p>`}
                  </div>
                  ${i.change && html`<div class="row-side"><span class="chip chip--marker">${CHANGE_LABEL[i.change.type] ?? i.change.type}</span></div>`}
                </div>
                ${i.change ? '' : html`
                  <div class="lesson-tools">
                    <button class="btn btn--small btn--quiet" type="button" data-open="cancel">Отменить</button>
                    <button class="btn btn--small btn--quiet" type="button" data-open="room">Сменить аудиторию</button>
                    <button class="btn btn--small btn--quiet" type="button" data-open="move">Перенести</button>
                  </div>
                  <div data-slot></div>`}
              </div>`)}
          </div>` : empty('calendar-x', 'В этот день пар нет', 'Выберите другую дату.')}
        </section>` : empty('calendar-clock', 'Выберите группу', 'Покажем занятия на выбранный день.')}`,

    mount(root) {
      const pick = root.querySelector('[data-pick]');
      const go = () => {
        const g = pick.elements.group.value;
        const d = pick.elements.date.value;
        if (!d) return;
        ctx.navigate(`/staff/schedule?group=${encodeURIComponent(g)}&date=${encodeURIComponent(d)}`, { replace: true });
      };
      pick.addEventListener('change', go);
      pick.addEventListener('submit', (ev) => ev.preventDefault());

      root.addEventListener('click', (ev) => {
        const open = ev.target.closest('[data-open]');
        if (open) {
          const lesson = open.closest('[data-lesson]');
          render(lesson.querySelector('[data-slot]'), slotForm(lesson.dataset.lesson, open.dataset.open, min));
          lesson.querySelector('[data-slot] input, [data-slot] select')?.focus();
          return;
        }
        if (ev.target.closest('[data-close]')) render(ev.target.closest('[data-slot]'), '');
      });

      root.addEventListener('submit', async (ev) => {
        const form = ev.target.closest('[data-change]');
        if (!form) return;
        ev.preventDefault();
        const type = form.dataset.type;
        const d = formData(form);
        const body = { group, date, pair: Number(form.dataset.pair), type, note: d.note };
        if (type === 'room') body.room = d.room;
        if (type === 'move') { body.toDate = d.toDate; body.toPair = Number(d.toPair); }
        try {
          const res = await busy(form.querySelector('[type=submit]'), () => api.post('/staff/schedule-changes', body));
          toast(`Изменение сохранено, уведомлены ${res.recipients} ${plural(res.recipients, 'студент', 'студента', 'студентов')}`);
          ctx.reload();
        } catch (e) { fail(form, e); }
      });
    },
  };
}
