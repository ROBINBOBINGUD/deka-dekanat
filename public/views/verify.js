import { html, api, fmtDayYear } from '../ui.js';

/** Публичная страница: по коду видно, настоящая ли справка. Вход не нужен. */
export async function verifyView({ params }) {
  let data = null;
  let failure = null;
  try { data = await api.get(`/verify/${encodeURIComponent(params.code)}`); }
  catch (e) { failure = e.status === 404 ? 'Справка с таким кодом не найдена или отозвана.' : e.message; }

  const body = data ? html`
    <span class="stamp stamp--ok stamp--big stamp--press">подлинная</span>
    <h1>${data.document}</h1>
    <dl class="kv">
      <dt>Кому выдана</dt><dd>${data.holder}</dd>
      <dt>Где учится</dt><dd>${data.university?.full ?? ''}</dd>
      <dt>Направление</dt><dd>${data.program}</dd>
      <dt>Курс, форма</dt><dd>${data.course} курс, ${data.studyForm}</dd>
      <dt>Дата выдачи</dt><dd>${fmtDayYear(data.issuedAt)}</dd>
      <dt>Код</dt><dd>${params.code.toUpperCase()}</dd>
    </dl>` : html`
    <span class="stamp stamp--bad stamp--big">не найдена</span>
    <h1>Проверка не пройдена</h1>
    <p class="muted" style="margin-top:10px">${failure}</p>`;

  return {
    title: 'Проверка справки',
    body: html`
      <div class="bare"><main class="verify">
        <a class="brand" href="/"><img src="/logo.svg" alt="" width="34" height="34"><span>Дека</span></a>
        ${body}
        <p class="concept">Концепт для конкурса MGIMO×AI Challenge. Не официальный сервис вуза: справка и студент вымышленные.</p>
      </main></div>`,
  };
}
