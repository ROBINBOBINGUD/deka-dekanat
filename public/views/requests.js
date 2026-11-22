import { html, icon, api, stamp, empty, toast, busy, showFieldErrors, fmtStamp, fmtDay } from '../ui.js';

const TYPE_ICON = {
  'file-check': 'file-check', wallet: 'wallet', rotate: 'rotate-ccw', 'calendar-plus': 'calendar-plus',
  'heart-hand': 'heart-handshake', copy: 'copy', message: 'message-circle',
};
const typeIcon = (name) => icon(TYPE_ICON[name] ?? 'file-text');

// ——— список заявок и каталог ———
export async function requestsView() {
  const [{ applications }, { types, today }] = await Promise.all([api.get('/applications'), api.get('/application-types')]);
  const active = applications.filter((a) => ['submitted', 'in_progress', 'ready'].includes(a.status));
  const closed = applications.filter((a) => !active.includes(a));
  const row = (a) => html`
    <a class="row" href="/requests/${a.pid}">
      <span class="row-icon">${typeIcon(a.icon)}</span>
      <div class="row-main">
        <p class="row-title">${a.title}</p>
        <p class="row-sub">${a.summary ? `${a.summary}. ` : ''}Обновлена ${fmtStamp(a.updatedAt, today)}</p>
      </div>
      ${stamp(a.status, a.statusLabel)}
    </a>`;

  return {
    title: 'Заявки',
    body: html`
      <div class="screen-head"><div><h1 class="screen-title">Заявки и справки</h1>
        <p class="screen-sub">Подайте заявку онлайн и следите за статусом</p></div></div>

      <section class="block" style="margin-top:0">
        <div class="block-head"><h2>В работе</h2></div>
        ${active.length ? html`<div class="rows">${active.map(row)}</div>`
          : html`<p class="block-note">Сейчас ничего не ждёт ответа деканата</p>`}
      </section>

      <section class="block">
        <div class="block-head"><h2>Что можно заказать</h2></div>
        <div class="catalog rows">
          ${types.map((t) => (t.unavailable
            ? html`<div class="cat-item is-off"><span class="row-icon">${typeIcon(t.icon)}</span>
                <div><p class="row-title">${t.title}</p><p>${t.unavailable}</p></div></div>`
            : html`<a class="cat-item" href="/requests/new/${t.code}"><span class="row-icon">${typeIcon(t.icon)}</span>
                <div><p class="row-title">${t.title}</p><p>${t.about}</p><span class="chip">${icon('clock')}${t.eta}</span></div></a>`))}
        </div>
      </section>

      ${closed.length ? html`
        <section class="block">
          <div class="block-head"><h2>История</h2></div>
          <div class="rows">${closed.map(row)}</div>
        </section>` : ''}`,
  };
}

// ——— новая заявка: форма строится из описания полей, которое прислал сервер ———
function fieldHtml(f, preset) {
  const id = `f-${f.name}`;
  const value = preset[f.name] ?? f.default ?? '';
  if (f.type === 'text') {
    return html`<div class="field"><label for="${id}">${f.label}</label>
      <input id="${id}" name="${f.name}" type="text" maxlength="${f.max}" value="${value}" ${f.required ? html`required` : ''} autocomplete="off">
      ${f.suggestions ? html`<div class="suggest">${f.suggestions.map((s) => html`<button type="button" data-fill="${f.name}">${s}</button>`)}</div>` : ''}</div>`;
  }
  if (f.type === 'textarea') {
    return html`<div class="field"><label for="${id}">${f.label}${f.required ? '' : html` <span class="muted" style="font-weight:400">(если нужно)</span>`}</label>
      <textarea id="${id}" name="${f.name}" maxlength="${f.max}">${value}</textarea></div>`;
  }
  if (f.type === 'number') {
    return html`<div class="field"><label for="${id}">${f.label}</label>
      <input id="${id}" name="${f.name}" type="number" inputmode="numeric" min="${f.min}" max="${f.max}" value="${value}" style="max-width:140px"></div>`;
  }
  if (f.type === 'date') {
    return html`<div class="field"><label for="${id}">${f.label}</label>
      <input id="${id}" name="${f.name}" type="date" min="${preset.__today}" value="${value}" style="max-width:220px" ${f.required ? html`required` : ''}></div>`;
  }
  // choice и debt — карточки-переключатели
  const options = f.options ?? [];
  const picked = options.some((o) => o.value === value) ? value : options[0]?.value;
  return html`<fieldset class="field"><legend>${f.label}</legend>
    <div class="choices ${options.length <= 3 && !options.some((o) => o.hint) && f.type !== 'debt' ? 'choices--row' : ''}">
      ${options.map((o) => html`<label class="choice">
        <input type="radio" name="${f.name}" value="${o.value}" ${o.value === picked ? html`checked` : ''}>
        <span>${o.label}${o.hint ? html`<small>${o.hint}</small>` : ''}</span></label>`)}
    </div></fieldset>`;
}

export async function requestNewView(ctx) {
  const { types, today } = await api.get('/application-types');
  const type = types.find((t) => t.code === ctx.params.type);
  if (!type || type.unavailable) {
    return { title: 'Заявка', body: empty('file-text', type ? type.unavailable : 'Такого вида заявки нет', '',
      html`<a class="btn" href="/requests">К списку заявок</a>`) };
  }
  const preset = { ...ctx.query, __today: today };
  return {
    title: type.title,
    body: html`
      <a class="back" href="/requests">${icon('arrow-left')}Заявки</a>
      <div class="screen-head" style="margin-top:0"><div><h1 class="screen-title">${type.title}</h1>
        <p class="screen-sub">${type.about}</p></div></div>
      <form class="form" novalidate style="max-width:560px">
        ${type.fields.map((f) => fieldHtml(f, preset))}
        <p class="form-error" data-error hidden></p>
        <p class="field-hint">${icon('clock', 'inline')} Срок: ${type.eta}. Статус и ответ деканата придут в уведомления.</p>
        <div class="actions" style="margin-top:0">
          <button class="btn" type="submit">Отправить заявку</button>
          <a class="btn btn--quiet" href="/requests">Не отправлять</a>
        </div>
      </form>`,
    mount(root) {
      const form = root.querySelector('form');
      const error = root.querySelector('[data-error]');
      root.querySelectorAll('[data-fill]').forEach((b) => b.addEventListener('click', () => {
        const input = form.querySelector(`[name="${b.dataset.fill}"]`);
        input.value = b.textContent;
        input.focus();
      }));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        error.hidden = true;
        const payload = Object.fromEntries(new FormData(form).entries());
        try {
          const res = await busy(form.querySelector('[type=submit]'), () => api.post('/applications', { type: type.code, payload }));
          toast('Заявка отправлена');
          ctx.navigate(`/requests/${res.pid}?new=1`, { replace: true });
        } catch (err) {
          if (err.fields) showFieldErrors(form, err.fields);
          else { error.textContent = err.message; error.hidden = false; }
        }
      });
    },
  };
}

// ——— карточка заявки ———
const STEPS = [['submitted', 'Подана'], ['in_progress', 'В работе'], ['ready', 'Готова'], ['issued', 'Выдана']];

function tracker(app) {
  if (['rejected', 'cancelled'].includes(app.status)) return '';
  const at = STEPS.findIndex(([s]) => s === app.status);
  return html`<ol class="tracker" aria-label="Этапы заявки">
    ${STEPS.map(([, label], i) => html`<li class="${i <= at ? 'is-done' : ''} ${i === at ? 'is-current' : ''}">${label}</li>`)}
  </ol>`;
}

export async function requestDetailView(ctx) {
  const { application: a, today } = await api.get(`/applications/${encodeURIComponent(ctx.params.pid)}`);
  const rejected = a.status === 'rejected' ? a.events.findLast((e) => e.status === 'rejected') : null;
  const verifyUrl = a.verify ? `${location.origin}/verify/${a.verify.code}` : null;

  return {
    title: a.title,
    body: html`
      <a class="back" href="/requests">${icon('arrow-left')}Заявки</a>
      <div class="app-head">
        <div><h1 class="screen-title">${a.title}</h1><p class="screen-sub">Подана ${fmtStamp(a.createdAt, today)}, обычный срок: ${a.eta}</p></div>
        ${stamp(a.status, a.statusLabel, `stamp--big ${ctx.query.new ? 'stamp--press' : ''}`)}
      </div>
      ${tracker(a)}

      ${rejected ? html`<section class="verdict verdict--debt" style="margin-top:20px">${icon('info')}
        <div><h2>Деканат отказал</h2><p>${rejected.comment}</p></div></section>` : ''}

      ${a.verify ? html`
        <section class="block">
          <div class="cert">
            <span class="stamp stamp--ok">действительна</span>
            <h3>Электронная ${a.title.toLowerCase()}</h3>
            <p>Покажите код или ссылку там, где нужна справка: по ней любой может проверить подлинность, не видя ваших оценок и номера зачётки.</p>
            <p class="cert-code">${a.verify.code}</p>
            <div class="actions">
              <a class="btn btn--small" href="/verify/${a.verify.code}" target="_blank" rel="noopener">${icon('external-link')}Страница проверки</a>
              <button class="btn btn--small btn--quiet" type="button" data-copy="${verifyUrl}">${icon('copy')}Скопировать ссылку</button>
            </div>
          </div>
        </section>` : ''}
      ${a.status === 'ready' && !a.verify ? html`<section class="verdict" style="margin-top:20px">${icon('door-open')}
        <div><h2>Можно забирать</h2><p>Документ ждёт в деканате. Возьмите студенческий билет.</p></div></section>` : ''}

      <section class="block">
        <div class="block-head"><h2>Что в заявке</h2></div>
        <dl class="kv">${a.details.map((d) => html`<dt>${d.label}</dt><dd>${d.value}</dd>`)}</dl>
      </section>

      <section class="block">
        <div class="block-head"><h2>История</h2></div>
        <ol class="events">
          ${a.events.map((e) => html`<li><b>${e.statusLabel}</b><time>${fmtStamp(e.at, today)}</time>
            ${e.comment ? html`<p>${e.comment}</p>` : ''}</li>`)}
        </ol>
      </section>

      <section class="block">
        <div class="block-head"><h2>Переписка с деканатом</h2></div>
        ${a.messages.length ? html`<div class="chat">
          ${a.messages.map((m) => html`<div class="msg ${m.mine ? 'msg--mine' : ''}"><p>${m.text}</p>
            <small>${m.mine ? 'Вы' : 'Деканат'}, ${fmtStamp(m.at, today)}</small></div>`)}
        </div>` : html`<p class="block-note">Есть вопрос по этой заявке? Напишите — ответ придёт сюда и в уведомления.</p>`}
        ${a.canWrite ? html`
          <form class="send" data-send>
            <label class="visually-hidden" for="msg">Сообщение деканату</label>
            <textarea id="msg" name="text" rows="1" maxlength="1000" placeholder="Сообщение деканату" required></textarea>
            <button class="btn" type="submit" aria-label="Отправить">${icon('send')}</button>
          </form>` : ''}
      </section>

      ${a.canCancel ? html`<div class="actions"><button class="btn btn--danger" type="button" data-cancel>Отменить заявку</button></div>` : ''}`,
    mount(root) {
      root.querySelector('[data-copy]')?.addEventListener('click', async (e) => {
        try { await navigator.clipboard.writeText(e.currentTarget.dataset.copy); toast('Ссылка скопирована'); }
        catch { toast('Не получилось скопировать. Выделите код вручную.', 'bad'); }
      });
      root.querySelector('[data-send]')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const text = form.text.value.trim();
        if (!text) return form.text.focus();
        try {
          await busy(form.querySelector('button'), () => api.post(`/applications/${a.pid}/messages`, { text }));
          toast('Сообщение отправлено');
          ctx.navigate(`/requests/${a.pid}`, { replace: true });
        } catch (err) { toast(err.message, 'bad'); }
      });
      const cancel = root.querySelector('[data-cancel]');
      cancel?.addEventListener('click', async () => {
        // Двойное нажатие вместо диалога: первое — предупреждение, второе — действие.
        if (!cancel.dataset.armed) {
          cancel.dataset.armed = '1';
          cancel.textContent = 'Нажмите ещё раз, чтобы отменить';
          setTimeout(() => { delete cancel.dataset.armed; cancel.textContent = 'Отменить заявку'; }, 4000);
          return;
        }
        try {
          await busy(cancel, () => api.post(`/applications/${a.pid}/cancel`));
          toast('Заявка отменена');
          ctx.navigate(`/requests/${a.pid}`, { replace: true });
        } catch (err) { toast(err.message, 'bad'); }
      });
    },
  };
}
