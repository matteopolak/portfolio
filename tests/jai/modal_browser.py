"""Rendered modal smoke test; run against `pnpm preview` with Playwright installed."""
import os
from playwright.sync_api import sync_playwright

with sync_playwright() as playwright:
    options = {"headless": True}
    if os.environ.get("WEBKIT_EXECUTABLE"):
        options["executable_path"] = os.environ["WEBKIT_EXECUTABLE"]
    browser = playwright.webkit.launch(**options)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    base = os.environ.get("PORTFOLIO_URL", "http://127.0.0.1:4321")
    page.goto(base)
    page.locator('a[href="/projects"]').first.click()
    page.wait_for_url("**/projects")
    card = page.locator("article.project-card").filter(has=page.locator('[data-project-action="try-jai"]'))
    assert card.get_by_role("link", name="Website", exact=True).count() == 0
    assert card.get_by_role("link", name="GitHub", exact=True).count() == 1
    assert page.locator('a[href="/projects/jai"]').count() == 0
    trigger = card.get_by_role("button", name="Try it out", exact=True)
    dialog = page.locator('dialog[data-project-demo="jai"]')
    for _ in range(2):
        trigger.click()
        page.wait_for_function("document.querySelector('dialog[data-project-demo=\"jai\"]').open")
        assert dialog.get_by_text("The browser compiler is awaiting its first verified release.").is_visible()
        dialog.get_by_role("button", name="Close Jai workspace", exact=True).click()
        page.wait_for_function("!document.querySelector('dialog[data-project-demo=\"jai\"]').open")
    page.locator('a[href="/"]').first.click()
    page.wait_for_url(base + "/")
    page.locator('a[href="/projects"]').first.click()
    page.wait_for_url("**/projects")
    page.locator('[data-project-action="try-jai"]').click()
    page.wait_for_function("document.querySelector('dialog[data-project-demo=\"jai\"]').open")
    page.keyboard.press("Escape")
    page.wait_for_function("!document.querySelector('dialog[data-project-demo=\"jai\"]').open")
    assert not errors, errors
    assert page.request.get(base + "/projects/jai").status == 404
    page.screenshot(path="/tmp/jai-modal-only-projects.png", full_page=True)
    browser.close()
    print("Passed: modal-only card, close/reopen, Astro navigation, removed route, no browser errors.")
