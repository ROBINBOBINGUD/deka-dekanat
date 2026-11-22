// Точка входа клиента: маршруты, каркас (навигация), загрузка экранов.

import { html, render, icon, api, skeleton, empty } from './ui.js';
import { loginView } from './views/login.js';
import { homeView } from './views/home.js';
import { scheduleView } from './views/schedule.js';
import { studyView } from './views/study.js';
import { requestsView, requestNewView, requestDetailView } from './views/requests.js';
import { inboxView } from './views/inbox.js';
import { profileView } from './views/profile.js';
import { staffQueueView, staffDetailView, staffAnnounceView, staffScheduleView } from './views/staff.js';
import { verifyView } from './views/verify.js';

const ROUTES = [
  { path: '/login', view: loginView, access: 'guest' },
  { path: '/verify/:code', view: verifyView, access: 'public' },
  { path: '/', view: homeView, role: 'student' },
  { path: '/schedule', view: scheduleView, role: 'student' },
  { path: '/study', view: studyView, role: 'student' },
  { path: '/requests', view: requestsView, role: 'student' },
  { path: '/requests/new/:type', view: requestNewView, role: 'student' },
  { path: '/requests/:pid', view: requestDetailView, role: 'student' },
  { path: '/inbox', view: inboxView, role: 'student' },
  { path: '/profile', view: profileView },
  { path: '/staff', view: staffQueueView, role: 'staff' },
  { path: '/staff/requests/:pid', view: staffDetailView, role: 'staff' },
  { path: '/staff/announce', view: staffAnnounceView, role: 'staff' },
  { path: '/staff/schedule', view: staffScheduleView, role: 'staff' },
];

const NAV = {
  student: [
    { href: '/', icon: 'sun', label: 'Сегодня' },
    { href: '/schedule', icon: 'calendar-days', label: 'Расписание' },
    { href: '/study', icon: 'graduation-cap', label: 'Учёба' },
    { href: '/requests', icon: 'file-text', label: 'Заявки' },
    { href: '/inbox', icon: 'bell', label: 'Уведомления', railOnly: true },
    { href: '/profile', icon: 'user', label: 'Профиль' },
  ],
  staff: [
    { href: '/staff', icon: 'inbox', label: 'Заявки' },
    { href: '/staff/announce', icon: 'megaphone', label: 'Объявления' },
    { href: '/staff/schedule', icon: 'calendar-clock', label: 'Расписание' },
    { href: '/profile', icon: 'user', label: 'Профиль' },
  ],
};

const root = document.getElementById('app');
let me = null;          // ответ /api/me
let shellFor = null;    // для какой роли нарисован каркас
let navToken = 0;

const homeOf = (m) => (m.user.role === 'staff' ? '/staff' : '/');

function match(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  for (const r of ROUTES) {
    const want = r.path.split('/').filter(Boolean);
    if (want.length !== parts.length) continue;
    const params = {};
    const ok = want.every((w, i) => {
      if (w.startsWith(':')) { params[w.slice(1)] = decodeURIComponent(parts[i]); return true; }
      return w === parts[i];
    });
    if (ok) return { route: r, params };
  }
  return null;
}

export function navigate(to, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', to); else history.pushState(null, '', to);
  return route();
}

export function setUnread(n) {
  if (me) me.unread = n;
  document.querySelectorAll('[data-unread]').forEach((el) => {
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = !n;
  });
}

function drawShell() {
  const role = me.user.role;
  const items = NAV[role];
  const link = (i, cls) => html`
    <a class="${cls}" href="${i.href}" data-nav="${i.href}">
      ${icon(i.icon)}<span>${i.label}</span>
      ${i.href === '/inbox' && html`<b class="badge" data-unread hidden></b>`}
    </a>`;
  const short = me.user.fullName.split(' ').slice(0, 2).join(' ');
  render(root, html`
    <div class="shell shell--${role}">
      <aside class="rail">
        <a class="brand" href="${homeOf(me)}"><img src="/logo.svg" alt="" width="36" height="36"><span>Дека</span></a>
        <nav class="rail-nav" aria-label="Разделы">${items.map((i) => link(i, 'rail-link'))}</nav>
        <div class="rail-foot">
          <p class="rail-user">${short}<small>${role === 'staff' ? (me.staff?.position ?? 'деканат') : `группа ${me.student.group}`}</small></p>
          <p class="concept">Концепт для конкурса MGIMO×AI Challenge. Не официальный сервис ${me.university?.short ?? 'вуза'}.</p>
        </div>
      </aside>
      <header class="topbar">
        <a class="brand" href="${homeOf(me)}"><img src="/logo.svg" alt="" width="30" height="30"><span>Дека</span></a>
        ${role === 'student' && html`
          <a class="bell" href="/inbox" data-nav="/inbox" aria-label="Уведомления">${icon('bell')}<b class="badge" data-unread hidden></b></a>`}
      </header>
      <main id="view" tabindex="-1"></main>
      <nav class="tabbar" aria-label="Разделы">${items.filter((i) => !i.railOnly).map((i) => link(i, 'tab'))}</nav>
    </div>`);
  shellFor = role;
  setUnread(me.unread ?? 0);
}

function markActive(pathname) {
  const hrefs = [...new Set([...document.querySelectorAll('[data-nav]')].map((a) => a.dataset.nav))];
  const best = hrefs.filter((h) => pathname === h || (h !== '/' && pathname.startsWith(`${h}/`)))
    .sort((a, b) => b.length - a.length)[0] ?? (pathname.startsWith('/requests') ? '/requests' : null);
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === best;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

async function loadMe() {
  try { me = await api.get('/me'); }
  catch (e) { if (e.status === 401) me = null; else throw e; }
}

function errorState(view, e, retry) {
  render(view, empty('triangle-alert', 'Не получилось загрузить раздел', e.message,
    html`<button class="btn" type="button" data-retry>Попробовать ещё раз</button>`));
  view.querySelector('[data-retry]')?.addEventListener('click', retry);
}

async function route() {
  const token = ++navToken;
  const url = new URL(location.href);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const query = Object.fromEntries(url.searchParams.entries());
  const found = match(pathname);
  const access = found?.route.access;

  // Публичная страница проверки справки: без входа и без каркаса.
  if (access === 'public') {
    shellFor = null;
    const v = await found.route.view({ params: found.params, query });
    document.title = `${v.title} — Дека`;
    render(root, v.body);
    v.mount?.(root);
    return;
  }

  if (!me) {
    try { await loadMe(); }
    catch (e) { render(root, html`<div class="bare">${empty('triangle-alert', 'Кабинет не отвечает', e.message)}</div>`); return; }
  }
  if (token !== navToken) return;

  if (!me) {
    if (access !== 'guest') return navigate(`/login?next=${encodeURIComponent(pathname + url.search)}`, { replace: true });
    shellFor = null;
    const v = await loginView({ query, onLogin: async () => { await loadMe(); navigate(safeNext(query.next) ?? homeOf(me), { replace: true }); } });
    document.title = `${v.title} — Дека`;
    render(root, v.body);
    v.mount?.(root);
    return;
  }
  if (access === 'guest') return navigate(homeOf(me), { replace: true });
  if (!found || (found.route.role && found.route.role !== me.user.role)) {
    if (!found && pathname !== homeOf(me)) {
      if (shellFor !== me.user.role) drawShell();
      markActive(pathname);
      document.title = 'Страница не найдена — Дека';
      render(document.getElementById('view'), empty('search', 'Такой страницы нет',
        'Возможно, ссылка устарела.', html`<a class="btn" href="${homeOf(me)}">На главную</a>`));
      return;
    }
    return navigate(homeOf(me), { replace: true });
  }

  if (shellFor !== me.user.role) drawShell();
  markActive(pathname);
  const view = document.getElementById('view');
  render(view, skeleton());
  const ctx = {
    params: found.params, query, me, navigate, setUnread,
    reload: () => route(),
    logout: async () => { await api.post('/auth/logout'); me = null; shellFor = null; navigate('/login', { replace: true }); },
  };
  try {
    const v = await found.route.view(ctx);
    if (token !== navToken) return;
    document.title = `${v.title} — Дека`;
    render(view, v.body);
    v.mount?.(view, ctx);
    window.scrollTo(0, 0);
  } catch (e) {
    if (token !== navToken) return;
    if (e.status === 401) { me = null; shellFor = null; return navigate('/login', { replace: true }); }
    if (!e.status || e.status >= 500) console.error(e);   // 404 и 403 — штатные ответы, не шумим
    if (e.status === 404) {
      render(view, empty('search', e.message, 'Проверьте ссылку или вернитесь назад',
        html`<a class="btn" href="${homeOf(me)}">На главную</a>`));
      return;
    }
    errorState(view, e, () => route());
  }
}

// После входа возвращаем только на свой адрес (никаких внешних ссылок в ?next=).
function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

// Внутренние ссылки открываем без перезагрузки страницы.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin) return;
  if (a.pathname.startsWith('/api/') || /\.[a-z0-9]+$/i.test(a.pathname)) return;
  e.preventDefault();
  navigate(a.pathname + a.search);
});
window.addEventListener('popstate', () => route());

// Счётчик непрочитанных обновляем, когда человек возвращается на вкладку.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !me || me.user.role !== 'student') return;
  try { const fresh = await api.get('/me'); setUnread(fresh.unread); } catch { /* не критично */ }
});

route();
