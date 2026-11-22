"""Снимает экраны кабинета на телефоне (360 px) и на компьютере и проверяет вёрстку.

Запуск:  python scripts/shots.py <адрес> <папка для снимков> [student|staff|all]
Пароли тестовых аккаунтов берутся из seed/demo-accounts.json и нигде не печатаются.
Для каждого экрана проверяется: нет горизонтальной прокрутки, нет ошибок в консоли.
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
BASE = sys.argv[1].rstrip("/")
OUT = Path(sys.argv[2])
WHO = sys.argv[3] if len(sys.argv) > 3 else "all"
# Как и сервер: если есть файл с паролями стенда для жюри — берём его, иначе локальные.
_PROD = ROOT / "seed" / "demo-accounts.prod.json"
ACCOUNTS = json.loads((_PROD if _PROD.exists() else ROOT / "seed" / "demo-accounts.json").read_text(encoding="utf-8"))

VIEWPORTS = {"m": {"width": 360, "height": 780}, "d": {"width": 1280, "height": 860}}
STUDENT = [
    ("home", "/"),
    ("schedule-day", "/schedule?date=2026-11-24"),
    ("schedule-week", "/schedule?date=2026-11-24&view=week"),
    ("study", "/study"),
    ("study-book", "/study?tab=book"),
    ("study-session", "/study?tab=session"),
    ("requests", "/requests"),
    ("request-new", "/requests/new/cert_study"),
    ("inbox", "/inbox"),
    ("profile", "/profile"),
]
STAFF = [
    ("staff-queue", "/staff"),
    ("staff-announce", "/staff/announce"),
    ("staff-schedule", "/staff/schedule?group=25-ИСТ&date=2026-11-25"),
]
problems = []


def sign_in(page, login):
    page.goto(f"{BASE}/login")
    page.fill("#login", login)
    page.fill("#password", ACCOUNTS[login]["password"])
    page.click("button[type=submit]")
    page.wait_for_url(lambda url: "/login" not in url, timeout=10000)
    page.wait_for_selector("#view .screen-title", timeout=10000)


def shot(page, name, tag):
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(350)
    overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    if overflow > 1:
        problems.append(f"{name}-{tag}: горизонтальная прокрутка {overflow}px")
    page.screenshot(path=str(OUT / f"{name}-{tag}.png"), full_page=True)


def run(browser, login, routes, prefix=""):
    for tag, vp in VIEWPORTS.items():
        ctx = browser.new_context(viewport=vp, device_scale_factor=2 if tag == "m" else 1, locale="ru-RU")
        page = ctx.new_page()
        # 401 на /api/me до входа — штатный ответ, не ошибка
        page.on("console", lambda m: problems.append(f"консоль [{m.type}] {m.text}") if m.type == "error" and "401" not in m.text else None)
        page.on("pageerror", lambda e: problems.append(f"ошибка страницы: {e}"))
        if login is None:
            page.goto(f"{BASE}/login")
            page.wait_for_selector("form")
            shot(page, "login", tag)
        else:
            sign_in(page, login)
            for name, path in routes:
                page.goto(f"{BASE}{path}")
                page.wait_for_selector("#view .screen-title, #view .empty", timeout=10000)
                shot(page, f"{prefix}{name}", tag)
            # карточка первой заявки из списка
            first = "/staff" if login == "dekanat" else "/requests"
            page.goto(f"{BASE}{first}")
            link = page.locator("a.row").first
            if link.count():
                link.click()
                page.wait_for_selector("#view .screen-title", timeout=10000)
                shot(page, f"{prefix}request-detail", tag)
        ctx.close()


OUT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    if WHO in ("all", "student"):
        run(browser, None, [])
        run(browser, "student1", STUDENT, "a-")
        run(browser, "student2", [("home", "/"), ("study", "/study"), ("requests", "/requests")], "b-")
    if WHO in ("all", "staff"):
        run(browser, "dekanat", STAFF, "s-")
    browser.close()

print(f"Снимки: {OUT}")
if problems:
    print("ПРОБЛЕМЫ:")
    for line in dict.fromkeys(problems):
        print(" -", line)
else:
    print("Проблем вёрстки и ошибок консоли не найдено")
