"""Печатает docs/Описание.html в docs/Описание.pdf (формат A4) через Chromium из Playwright."""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

docs = Path(__file__).resolve().parent.parent / "docs"
src, out = docs / "Описание.html", docs / "Описание.pdf"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    missing = []
    page.on("requestfailed", lambda r: missing.append(r.url))
    page.goto(src.as_uri())
    page.wait_for_load_state("networkidle")
    page.evaluate("document.fonts.ready")
    broken = page.evaluate("[...document.images].filter(i => !i.naturalWidth).map(i => i.getAttribute('src'))")
    page.pdf(path=str(out), format="A4", print_background=True,
             margin={"top": "14mm", "bottom": "14mm", "left": "14mm", "right": "14mm"})
    pages = page.evaluate("Math.ceil(document.documentElement.scrollHeight / 1123)")
    browser.close()

print(f"Готово: {out} ({out.stat().st_size // 1024} КБ, примерно {pages} стр.)")
if broken or missing:
    print("НЕ ЗАГРУЗИЛИСЬ:", *(broken + missing), sep="\n - ")
    sys.exit(1)
