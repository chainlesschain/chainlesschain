import os, time
from playwright.sync_api import sync_playwright

OUT = r"C:\code\chainlesschain\docs-website-v2\public\screenshots"
os.makedirs(OUT, exist_ok=True)

pages = [
    ("dashboard", "http://127.0.0.1:18810/"),
    ("cowork", "http://127.0.0.1:18810/#/cowork"),
    ("skills", "http://127.0.0.1:18810/#/skills"),
    ("chat", "http://127.0.0.1:18810/#/chat"),
    ("agent", "http://127.0.0.1:18810/#/agent"),
    ("tools", "http://127.0.0.1:18810/#/tools"),
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1400, "height": 900}, device_scale_factor=2)
    page = ctx.new_page()
    for name, url in pages:
        try:
            print(f"[cap] {name} -> {url}")
            page.goto(url, wait_until="networkidle", timeout=30000)
            page.wait_for_timeout(2000)
            out = os.path.join(OUT, f"{name}.png")
            page.screenshot(path=out, full_page=False)
            print(f"     saved {out} ({os.path.getsize(out)//1024} KB)")
        except Exception as e:
            print(f"     FAIL: {e}")
    browser.close()
print("done")
