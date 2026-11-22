import { html, icon, api, busy, showFieldErrors, formData } from '../ui.js';

export async function loginView({ onLogin }) {
  let uni = 'вуза';
  try { uni = (await api.get('/public')).university?.short ?? uni; } catch { /* экран входа покажем и без справки */ }

  const body = html`
    <div class="auth">
      <section class="auth-brand">
        <span class="brand"><img src="/logo.svg" alt="" width="40" height="40"><span>Дека</span></span>
        <h1>Деканат, в который не нужно идти</h1>
        <ul>
          <li>${icon('check')}<span>Ближайшая пара и переносы — на первом экране</span></li>
          <li>${icon('check')}<span>Оценки, долги и сессия — одной понятной картиной</span></li>
          <li>${icon('check')}<span>Справка за минуту, статус — как у посылки</span></li>
        </ul>
      </section>
      <section class="auth-form">
        <h2>Вход в кабинет</h2>
        <form class="form" novalidate>
          <div class="field">
            <label for="login">Логин</label>
            <input id="login" name="login" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required>
          </div>
          <div class="field">
            <label for="password">Пароль</label>
            <div class="pw">
              <input id="password" name="password" type="password" autocomplete="current-password" required>
              <button type="button" data-toggle aria-label="Показать пароль" aria-pressed="false">${icon('eye')}</button>
            </div>
          </div>
          <p class="form-error" data-error hidden></p>
          <button class="btn btn--block" type="submit">Войти</button>
        </form>
        <p class="concept">Это концепт для конкурса MGIMO×AI Challenge, а не официальный сервис ${uni}.
          Все студенты, преподаватели и оценки в нём вымышленные. Тестовые логины и пароли — в описании работы.</p>
      </section>
    </div>`;

  return {
    title: 'Вход',
    body,
    mount(root) {
      const form = root.querySelector('form');
      const error = root.querySelector('[data-error]');
      const pw = root.querySelector('#password');
      root.querySelector('[data-toggle]').addEventListener('click', (e) => {
        const show = pw.type === 'password';
        pw.type = show ? 'text' : 'password';
        e.currentTarget.setAttribute('aria-pressed', String(show));
        e.currentTarget.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        error.hidden = true;
        const data = formData(form);
        const missing = {};
        if (!data.login.trim()) missing.login = 'Введите логин';
        if (!data.password) missing.password = 'Введите пароль';
        showFieldErrors(form, missing);
        if (Object.keys(missing).length) return;
        try {
          await busy(form.querySelector('[type=submit]'), () => api.post('/auth/login', data));
          await onLogin();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
          pw.select();
        }
      });
      root.querySelector('#login').focus();
    },
  };
}
