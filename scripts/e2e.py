"""Сквозной сценарий в настоящем браузере на ширине телефона (360 px).

Студент подаёт заявку и пишет в деканат → сотрудник берёт её в работу и отмечает готовой →
студент видит электронную справку и уведомление → публичная проверка кода. Плюс объявление,
изменение расписания, отмена заявки и заявление на пересдачу у второго студента.

Запуск:  python scripts/e2e.py <адрес> [папка для снимков]
Запускать на отдельной тестовой БД: сценарий создаёт заявки и объявления.
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
BASE = sys.argv[1].rstrip("/")
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else None
# Как и сервер: если есть файл с паролями стенда для жюри — берём его, иначе локальные.
_PROD = ROOT / "seed" / "demo-accounts.prod.json"
ACCOUNTS = json.loads((_PROD if _PROD.exists() else ROOT / "seed" / "demo-accounts.json").read_text(encoding="utf-8"))
MOBILE = {"width": 360, "height": 780}
errors = []
step_no = 0


def step(title):
    global step_no
    step_no += 1
    print(f"{step_no:>2}. {title}")


def snap(page, name):
    if OUT:
        OUT.mkdir(parents=True, exist_ok=True)
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / f"{step_no:02d}-{name}.png"), full_page=False)


def new_page(browser):
    ctx = browser.new_context(viewport=MOBILE, device_scale_factor=2, locale="ru-RU")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"ошибка страницы: {e}"))
    page.on("console", lambda m: errors.append(f"консоль: {m.text}") if m.type == "error" and "40" not in m.text else None)
    return page


def sign_in(page, login, password=None):
    page.goto(f"{BASE}/login")
    page.fill("#login", login)
    page.fill("#password", password or ACCOUNTS[login]["password"])
    page.click("button[type=submit]")


with sync_playwright() as p:
    browser = p.chromium.launch()
    student, staff, other = new_page(browser), new_page(browser), new_page(browser)

    step("Неверный пароль: понятная ошибка, в кабинет не пускает")
    sign_in(student, "student1", "definitely-wrong")
    expect(student.locator("[data-error]")).to_contain_text("Неверный логин или пароль")
    snap(student, "login-error")

    step("Вход студента, экран «Сегодня»")
    sign_in(student, "student1")
    expect(student.locator("#view .screen-title")).to_be_visible()
    expect(student.locator(".now")).to_be_visible()
    snap(student, "home")

    step("Расписание: день и неделя")
    student.click(".tabbar a[href='/schedule']")
    expect(student.locator(".daypills")).to_be_visible()
    student.click(".seg a:has-text('Неделя')")
    expect(student.locator(".week")).to_be_visible()

    step("Учёба: семестр, зачётка, сессия")
    student.click(".tabbar a[href='/study']")
    expect(student.locator(".resolution")).to_be_visible()
    student.click(".seg a:has-text('Зачётка')")
    expect(student.locator(".sem-title").first).to_be_visible()
    student.click(".seg a:has-text('Сессия')")
    expect(student.locator(".timeline")).to_be_visible()

    step("Студент заказывает электронную справку об обучении")
    student.click(".tabbar a[href='/requests']")
    student.click("a.cat-item[href='/requests/new/cert_study']")
    student.click("button[data-fill='purpose']:has-text('В банк')")
    snap(student, "request-form")
    student.click("form button[type=submit]")
    student.wait_for_url("**/requests/*?new=1")
    expect(student.locator(".app-head .stamp")).to_have_text("Подана")
    request_url = student.url.split("?")[0]
    snap(student, "request-submitted")

    step("Студент пишет в деканат внутри заявки")
    student.fill("#msg", "Справка нужна до пятницы, успеете?")
    student.click("form[data-send] button")
    expect(student.locator(".msg--mine")).to_contain_text("до пятницы")

    step("Сотрудник видит заявку в очереди с пометкой «ждёт ответа»")
    sign_in(staff, "dekanat")
    expect(staff.locator("#view .screen-title")).to_be_visible()
    row = staff.locator("a.row", has_text="Ситников").filter(has_text="В банк").first
    expect(row).to_contain_text("ждёт ответа")
    snap(staff, "staff-queue")
    row.click()

    step("Сотрудник отвечает и берёт заявку в работу, затем отмечает готовой")
    staff.fill("textarea[name=text]", "Успеем, будет готова сегодня.")
    staff.locator("form.send button, form[data-send] button").first.click()
    expect(staff.locator(".msg--mine")).to_contain_text("Успеем")
    staff.get_by_role("button", name="Взять в работу").click()
    expect(staff.locator("#view .stamp").first).to_have_text("В работе")
    staff.get_by_role("button", name="Отметить готовой").click()
    expect(staff.locator("#view .stamp").first).to_have_text("Готова")
    snap(staff, "staff-ready")

    step("У студента: статус «Готова», электронная справка с кодом, уведомления")
    student.goto(request_url)
    expect(student.locator(".app-head .stamp")).to_have_text("Готова")
    code = student.locator(".cert-code").inner_text().strip()
    assert len(code) == 11, f"код проверки выглядит странно: {code!r}"
    snap(student, "request-ready")
    student.click(".bell")
    expect(student.locator(".notice.is-unread", has_text="Справка об обучении: готова").first).to_be_visible()
    expect(student.locator(".notice", has_text="Деканат ответил").first).to_be_visible()
    snap(student, "inbox")

    step("Публичная проверка справки по коду — без входа и без лишних данных")
    guest = new_page(browser)
    guest.goto(f"{BASE}/verify/{code}")
    expect(guest.locator(".verify .stamp")).to_have_text("подлинная")
    body = guest.locator(".verify").inner_text()
    assert "Ситников" not in body and "25-0417" not in body and "25-ИСТ" not in body, "на странице проверки лишние данные"
    snap(guest, "verify")
    guest.goto(f"{BASE}/verify/AAAAA-AAAAA")
    expect(guest.locator(".verify .stamp")).to_have_text("не найдена")

    step("Сотрудник публикует объявление для группы 25-ИСТ")
    staff.click(".tabbar a[href='/staff/announce']")
    staff.fill("[name=title]", "Сбор зачёток перед сессией")
    staff.fill("[name=body]", "Староста собирает зачётные книжки до пятницы и приносит в деканат.")
    staff.select_option("[name=audience]", "group:25-ИСТ")
    staff.get_by_role("button", name="Опубликовать").click()
    expect(staff.locator("#toasts")).to_contain_text("Опубликовано")

    step("Сотрудник отменяет пару 7 декабря — группа получает уведомление")
    staff.goto(f"{BASE}/staff/schedule?group=25-ИСТ&date=2026-12-07")
    staff.get_by_role("button", name="Отменить").first.click()
    staff.fill("[name=note]", "Преподаватель в командировке")
    staff.get_by_role("button", name="Сохранить изменение").click()
    expect(staff.locator("#toasts")).to_contain_text("Изменение сохранено")
    snap(staff, "staff-schedule")

    step("Студент видит объявление и изменение расписания; второй студент — нет")
    student.goto(f"{BASE}/inbox")
    expect(student.locator(".notice", has_text="Сбор зачёток перед сессией").first).to_be_visible()
    student.locator(".notice--schedule.is-unread").first.click()
    student.wait_for_url("**/schedule?date=*")
    student.goto(f"{BASE}/schedule?date=2026-12-07")
    expect(student.locator(".pair.is-off")).to_be_visible()
    snap(student, "schedule-cancelled")
    sign_in(other, "student2")
    expect(other.locator("#view .screen-title")).to_be_visible()
    other.goto(f"{BASE}/inbox")
    expect(other.locator(".notice", has_text="Сбор зачёток перед сессией")).to_have_count(0)

    step("Второй студент не может открыть заявку первого даже по прямой ссылке")
    other.goto(request_url)
    expect(other.locator("#view .empty")).to_contain_text("Заявка не найдена")
    snap(other, "foreign-request")

    step("Второй студент подаёт заявление на пересдачу прямо из «Учёбы»")
    other.goto(f"{BASE}/study")
    other.click(".resolution a.btn")
    other.wait_for_url("**/requests/new/retake*")
    other.fill("[name=wish]", "Любой день после 10 декабря")
    other.click("form button[type=submit]")
    other.wait_for_url("**/requests/*?new=1")
    expect(other.locator(".app-head .stamp")).to_have_text("Подана")

    step("Студент отменяет только что поданную заявку")
    student.goto(f"{BASE}/requests/new/free_form")
    student.click("form button[type=submit]")
    expect(student.locator(".field-error").first).to_be_visible()   # пустая форма не уходит
    student.fill("[name=topic]", "Пропуск в общежитие")
    student.fill("[name=text]", "Где продлить пропуск на следующий семестр?")
    student.click("form button[type=submit]")
    student.wait_for_url("**/requests/*?new=1")
    student.click("[data-cancel]")
    student.click("[data-cancel]")
    expect(student.locator(".app-head .stamp")).to_have_text("Отменена")

    step("Выход: кабинет закрыт, прямые ссылки ведут на вход")
    student.click(".tabbar a[href='/profile']")
    student.click("[data-logout]")
    student.wait_for_url("**/login")
    student.goto(request_url)
    student.wait_for_url("**/login?next=*")

    browser.close()

if errors:
    print("ОШИБКИ В БРАУЗЕРЕ:")
    for e in dict.fromkeys(errors):
        print(" -", e)
    sys.exit(1)
print(f"Сквозной сценарий пройден: {step_no} шагов, ошибок в браузере нет")
