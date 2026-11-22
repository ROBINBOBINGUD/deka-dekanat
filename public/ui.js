// Общие кирпичики клиента: безопасный HTML-шаблон, запросы к API, даты, мелкие компоненты.

// ——— HTML-шаблон: всё, что вставлено через ${…}, экранируется ———
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
const toHtml = (v) => {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(toHtml).join('');
  return esc(v);
};

/** html`<p>${userText}</p>` — userText экранируется; вложенные html`…` и массивы вставляются как есть. */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += toHtml(v) + strings[i + 1]; });
  return new Safe(out);
}
export function render(el, content) {
  el.innerHTML = content instanceof Safe ? content.s : esc(content ?? '');
}
export const icon = (name, cls = '') =>
  new Safe(`<svg class="icon ${esc(cls)}" aria-hidden="true" focusable="false"><use href="/icons.svg#i-${esc(name)}"></use></svg>`);

// ——— API ———
export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields || null;
  }
}
async function request(method, path, body) {
  const headers = {};
  if (method !== 'GET') headers['X-Requested-With'] = 'deka';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method, headers, credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.message || `Ошибка ${res.status}`, data?.error?.fields);
  return data;
}
export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
};

// ——— даты (строки YYYY-MM-DD и YYYY-MM-DDTHH:MM, время московское) ———
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const WD_SHORT = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
export const WD_FULL = ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const utc = (d) => new Date(`${d.slice(0, 10)}T00:00:00Z`);
export const weekdayOf = (d) => ((utc(d).getUTCDay() + 6) % 7) + 1;
export const addDays = (d, n) => { const x = utc(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const mondayOf = (d) => addDays(d, 1 - weekdayOf(d));
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
export const fmtDay = (d) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
export const fmtDayYear = (d) => `${fmtDay(d)} ${d.slice(0, 4)}`;
export const fmtTime = (iso) => iso.slice(11, 16);
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** «сегодня», «завтра», «вчера» или «24 ноября» */
export function relDay(d, today) {
  const diff = daysBetween(today, d);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === -1) return 'вчера';
  return fmtDay(d);
}
export const fmtStamp = (iso, today) => `${relDay(iso, today)}${iso.length > 10 ? `, ${fmtTime(iso)}` : ''}`;

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
export const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export function fmtDuration(min) {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

// ——— компоненты ———
export const KIND = { lecture: 'лекция', practice: 'практика', lab: 'лабораторная' };

const STAMP_TONE = { submitted: 'ink', in_progress: 'stamp', ready: 'ok', issued: 'muted', rejected: 'bad', cancelled: 'muted' };
/** Статус заявки в виде штампа. */
export const stamp = (status, label, extra = '') =>
  html`<span class="stamp stamp--${STAMP_TONE[status] ?? 'ink'} ${extra}">${label}</span>`;

export const empty = (iconName, title, text, action = '') => html`
  <div class="empty">
    ${icon(iconName)}
    <p class="empty-title">${title}</p>
    ${text && html`<p>${text}</p>`}
    ${action}
  </div>`;

export const skeleton = (lines = 4) => html`
  <div class="skeleton" aria-hidden="true">
    <div class="sk sk--title"></div>
    <div class="sk sk--panel"></div>
    ${Array.from({ length: lines }, () => html`<div class="sk sk--row"></div>`)}
  </div>
  <p class="visually-hidden">Загружаем…</p>`;

export function toast(message, tone = 'ok') {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast--${tone}`;
  el.textContent = message;
  host.append(el);
  setTimeout(() => el.classList.add('is-leaving'), 3600);
  setTimeout(() => el.remove(), 4000);
}

/** Показывает ошибки полей под соответствующими input внутри формы. */
export function showFieldErrors(form, fields) {
  form.querySelectorAll('.field-error').forEach((n) => n.remove());
  form.querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
  let first = null;
  for (const [name, message] of Object.entries(fields || {})) {
    const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!input) continue;
    input.setAttribute('aria-invalid', 'true');
    const p = document.createElement('p');
    p.className = 'field-error';
    p.textContent = message;
    (input.closest('.field') ?? input.parentElement).append(p);
    first ??= input;
  }
  first?.focus();
}

/** Блокирует кнопку на время запроса и возвращает её в исходное состояние. */
export async function busy(button, fn) {
  if (!button) return fn();
  const label = button.innerHTML;
  button.disabled = true;
  button.classList.add('is-busy');
  try { return await fn(); }
  finally { button.disabled = false; button.classList.remove('is-busy'); button.innerHTML = label; }
}

export const formData = (form) => Object.fromEntries(new FormData(form).entries());
