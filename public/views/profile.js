import { html, icon, api, toast, busy, showFieldErrors, formData } from '../ui.js';

export async function profileView(ctx) {
  const { user, student, staff, university } = ctx.me;
  const card = student ? html`
    <section class="idcard" aria-label="Студенческий профиль">
      <h2>${user.fullName}</h2>
      <p class="idcard-sub">${university?.short ?? ''}, ${student.course} курс</p>
      <dl>
        <div><dt>Группа</dt><dd>${student.group}</dd></div>
        <div><dt>Зачётная книжка</dt><dd>№ ${student.recordBook}</dd></div>
        <div class="wide"><dt>Факультет</dt><dd>${student.faculty}</dd></div>
        <div class="wide"><dt>Направление</dt><dd>${student.programCode} ${student.programName}</dd></div>
        <div><dt>Форма обучения</dt><dd>${student.studyForm}</dd></div>
        <div><dt>Основа</dt><dd>${student.funding}</dd></div>
        <div><dt>Год поступления</dt><dd>${student.admissionYear}</dd></div>
        <div><dt>Логин</dt><dd>${user.login}</dd></div>
        ${student.curator ? html`<div class="wide"><dt>Куратор группы</dt><dd>${student.curator.name}, ${student.curator.title}</dd></div>` : ''}
        ${user.email ? html`<div class="wide"><dt>Почта</dt><dd>${user.email}</dd></div>` : ''}
      </dl>
    </section>` : html`
    <section class="idcard" aria-label="Профиль сотрудника">
      <h2>${user.fullName}</h2>
      <p class="idcard-sub">${staff?.position ?? 'сотрудник деканата'}</p>
      <dl>
        <div><dt>Подразделение</dt><dd>Деканат ${staff?.faculty ?? ''}</dd></div>
        <div><dt>Логин</dt><dd>${user.login}</dd></div>
      </dl>
    </section>`;

  return {
    title: 'Профиль',
    body: html`
      <div class="screen-head"><h1 class="screen-title">Профиль</h1></div>
      <div class="profile-grid">
        <div>
          ${card}
          <div class="actions"><button class="btn btn--quiet" type="button" data-logout>${icon('log-out')}Выйти из кабинета</button></div>
        </div>
        <div>
          <section class="block">
            <div class="block-head"><h2>Как защищены ваши данные</h2></div>
            <ul class="facts rows">
              <li>${icon('shield-check')}<div><b>Вы видите только своё</b><span>Сервер определяет вас по сессии, а не по адресу страницы. Чужую заявку или оценки не открыть, даже подставив другой номер.</span></div></li>
              <li>${icon('lock')}<div><b>Пароль не хранится</b><span>В базе лежит только необратимый хеш (scrypt). Пароль не знает никто, включая деканат.</span></div></li>
              <li>${icon('eye-off')}<div><b>Справку проверяют без лишнего</b><span>По коду видно, что справка настоящая, но не видно зачётку, группу и оценки.</span></div></li>
            </ul>
          </section>
          <section class="block">
            <div class="block-head"><h2>Смена пароля</h2></div>
            ${user.isDemo ? html`<p class="block-note">Это тестовый аккаунт для жюри: смена пароля в нём отключена, чтобы вход не потерялся. В обычных аккаунтах она работает и завершает остальные сеансы.</p>` : html`
              <form class="form" data-password novalidate style="max-width:420px">
                <div class="field"><label for="current">Текущий пароль</label><input id="current" name="current" type="password" autocomplete="current-password" required></div>
                <div class="field"><label for="next">Новый пароль</label><input id="next" name="next" type="password" autocomplete="new-password" minlength="8" required>
                  <p class="field-hint">Не короче 8 символов</p></div>
                <button class="btn" type="submit">Сменить пароль</button>
              </form>`}
          </section>
          <p class="page-foot">Концепт для конкурса MGIMO×AI Challenge. Не официальный сервис ${university?.short ?? 'вуза'}, все данные вымышленные.</p>
        </div>
      </div>`,
    mount(root) {
      root.querySelector('[data-logout]').addEventListener('click', (e) => busy(e.currentTarget, () => ctx.logout()));
      root.querySelector('[data-password]')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        try {
          await busy(form.querySelector('[type=submit]'), () => api.post('/auth/password', formData(form)));
          form.reset();
          showFieldErrors(form, {});
          toast('Пароль изменён');
        } catch (err) {
          if (err.fields) showFieldErrors(form, err.fields); else toast(err.message, 'bad');
        }
      });
    },
  };
}
