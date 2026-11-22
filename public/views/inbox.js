import { html, icon, api, empty, toast, relDay, fmtTime, cap } from '../ui.js';

const KIND = {
  announcement: { icon: 'megaphone', label: 'Объявления' },
  application: { icon: 'file-text', label: 'Заявки' },
  schedule: { icon: 'calendar-clock', label: 'Расписание' },
  deadline: { icon: 'clock', label: 'Сроки' },
};

export async function inboxView(ctx) {
  const { notifications, unread, today } = await api.get('/notifications');
  ctx.setUnread(unread);
  const filter = ['unread', ...Object.keys(KIND)].includes(ctx.query.filter) ? ctx.query.filter : 'all';
  const list = notifications.filter((n) => filter === 'all' || (filter === 'unread' ? n.unread : n.kind === filter));

  // Группируем по дням: «сегодня», «вчера», «20 ноября».
  const groups = [];
  for (const n of list) {
    const day = n.at.slice(0, 10);
    if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
    groups.at(-1).items.push(n);
  }
  const tab = (key, label) => html`<a class="${filter === key ? 'is-active' : ''}" href="/inbox${key === 'all' ? '' : `?filter=${key}`}">${label}</a>`;

  return {
    title: 'Уведомления',
    body: html`
      <div class="screen-head">
        <div><h1 class="screen-title">Уведомления</h1>
          <p class="screen-sub">${unread ? `Непрочитанных: ${unread}` : 'Всё прочитано'}</p></div>
        ${unread ? html`<button class="btn btn--small btn--quiet" type="button" data-read-all>${icon('check')}Прочитать все</button>` : ''}
      </div>
      <nav class="filters" aria-label="Фильтр">
        ${tab('all', 'Все')}${tab('unread', 'Непрочитанные')}
        ${Object.entries(KIND).map(([k, v]) => tab(k, v.label))}
      </nav>
      ${groups.length ? groups.map((g) => html`
        <h2 class="day-sep">${cap(relDay(g.day, today))}</h2>
        <div>
          ${g.items.map((n) => html`
            <button class="notice notice--${n.kind} ${n.unread ? 'is-unread' : ''}" type="button" data-id="${n.id}" data-link="${n.link ?? ''}">
              <span class="notice-icon">${icon(KIND[n.kind]?.icon ?? 'bell')}</span>
              <span>
                <span class="notice-top"><h3>${n.title}</h3>${n.unread ? html`<span class="dot" aria-label="не прочитано"></span>` : ''}<time>${fmtTime(n.at)}</time></span>
                ${n.body ? html`<p>${n.body}</p>` : ''}
              </span>
            </button>`)}
        </div>`) : empty('bell', filter === 'unread' ? 'Непрочитанных нет' : 'Здесь пока пусто',
          'Объявления деканата, изменения в расписании и статусы заявок появятся в этой ленте')}`,
    mount(root) {
      root.querySelector('[data-read-all]')?.addEventListener('click', async () => {
        try { await api.post('/notifications/read-all'); ctx.setUnread(0); toast('Все уведомления прочитаны'); ctx.reload(); }
        catch (e) { toast(e.message, 'bad'); }
      });
      root.querySelectorAll('.notice').forEach((el) => el.addEventListener('click', async () => {
        if (el.classList.contains('is-unread')) {
          try {
            const r = await api.post(`/notifications/${el.dataset.id}/read`);
            ctx.setUnread(r.unread);
            el.classList.remove('is-unread');
            el.querySelector('.dot')?.remove();
          } catch { /* прочитаем в следующий раз */ }
        }
        const link = el.dataset.link;
        if (link && link !== '/inbox') ctx.navigate(link);
      }));
    },
  };
}
