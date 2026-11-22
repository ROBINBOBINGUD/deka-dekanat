// Страница для жюри: тестовые аккаунты и сценарий проверки по закрытой ссылке.
// Ссылку получают только организаторы конкурса. Ни её, ни паролей стенда в открытом репозитории нет:
// они лежат в seed/demo-accounts.prod.json, который попадает на сервер только с веткой деплоя.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const WHO = {
  student1: ['Студент, 2 курс, группа 25-ИСТ', 'с учёбой всё в порядке; готовая электронная справка с кодом проверки'],
  student2: ['Студент, 3 курс, группа 24-ХТ', 'академический долг, две дисциплины под риском, отказ по заявке'],
  dekanat: ['Сотрудник деканата', 'очередь заявок, смена статуса, объявления, изменение расписания'],
};

export function juryPage({ accounts, links }) {
  const rows = Object.entries(WHO).filter(([login]) => accounts[login]).map(([login, [who, look]]) => `
      <tr><td>${esc(who)}<small>${esc(look)}</small></td><td data-l="Логин"><code>${esc(login)}</code></td><td data-l="Пароль"><code>${esc(accounts[login].password)}</code></td></tr>`).join('');
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Дека — материалы для жюри</title>
<link rel="icon" href="/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles/app.css">
<link rel="stylesheet" href="/styles/ledger.css">
<style>
  .jury { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
  .jury h1 { margin-top: 24px; }
  .jury h2 { font: 600 18px/1.3 var(--font); color: var(--ink); margin: 32px 0 8px; }
  .jury table { width: 100%; border-collapse: collapse; }
  .jury th { text-align: left; font-weight: 600; font-size: 14px; color: var(--muted); padding: 8px 12px 8px 0; border-bottom: 1px solid var(--ink); }
  .jury td { padding: 12px 12px 12px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
  .jury td small { display: block; color: var(--muted); font-size: 14px; line-height: 1.4; margin-top: 2px; }
  .jury code { font: 500 15px/1.4 Consolas, 'Courier New', monospace; background: var(--paper); padding: 2px 6px; border-radius: 4px; white-space: nowrap; }
  .jury ol, .jury ul { padding-left: 20px; list-style: revert; display: grid; gap: 8px; }
  .jury a:not(.brand) { color: var(--stamp); font-weight: 600; overflow-wrap: anywhere; }
  .jury .note { color: var(--muted); font-size: 14px; margin-top: 32px; }
  @media (max-width: 600px) {
    .jury thead { display: none; }
    .jury tr { display: block; padding: 12px 0; border-bottom: 1px solid var(--line); }
    .jury td { display: block; padding: 0; border: 0; }
    .jury td[data-l] { margin-top: 8px; }
    .jury td[data-l]::before { content: attr(data-l) ': '; color: var(--muted); font-size: 14px; }
  }
</style>
</head>
<body>
<main class="jury">
  <a class="brand" href="/"><img src="/logo.svg" alt="" width="36" height="36"><span>Дека</span></a>
  <h1 class="screen-title">Материалы для жюри</h1>
  <p class="screen-sub">MGIMO×AI Challenge, номинация «Вайб-кодинг», задание «Цифровой деканат будущего»</p>

  <h2>Ссылки</h2>
  <ul>
    <li>Прототип: <a href="${esc(links.site)}">${esc(links.site)}</a></li>
    <li>Исходный код: <a href="${esc(links.code)}">${esc(links.code)}</a></li>
    <li>Описание процесса создания (PDF): <a href="${esc(links.doc)}">${esc(links.doc)}</a></li>
  </ul>

  <h2>Тестовые аккаунты</h2>
  <table>
    <thead><tr><th>Кто</th><th>Логин</th><th>Пароль</th></tr></thead>
    <tbody>${rows}
    </tbody>
  </table>

  <h2>Сценарий на три минуты</h2>
  <ol>
    <li>Войдите как <code>student1</code>: «Заявки», затем «Справка об обучении» и «Отправить заявку».</li>
    <li>В другом окне войдите как <code>dekanat</code>: откройте заявку, нажмите «Взять в работу», затем «Отметить готовой».</li>
    <li>Вернитесь к <code>student1</code>: пришло уведомление, в заявке появился код проверки и кнопка «Страница проверки».</li>
  </ol>

  <h2>Как убедиться, что данные разделены</h2>
  <ol>
    <li>Под <code>student1</code> откройте любую заявку и скопируйте адрес страницы.</li>
    <li>Выйдите, войдите как <code>student2</code> и вставьте этот адрес: кабинет ответит «Заявка не найдена».</li>
  </ol>

  <p class="note">Концепт для конкурса, а не официальный сервис ДПИ НГТУ. Все студенты, преподаватели и оценки вымышленные.
    Страница открывается только по этой ссылке; смена пароля в тестовых аккаунтах отключена.</p>
</main>
</body>
</html>`;
}
