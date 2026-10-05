"""Rendered modal smoke test; run against `pnpm preview` with Playwright installed."""
import os
from playwright.sync_api import sync_playwright

with sync_playwright() as playwright:
    options = {"headless": True}
    if os.environ.get("WEBKIT_EXECUTABLE"):
        options["executable_path"] = os.environ["WEBKIT_EXECUTABLE"]
    browser = playwright.webkit.launch(**options)
    page = browser.new_page(viewport={"width": int(os.environ.get("VIEWPORT_WIDTH", "1280")), "height": 900})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    base = os.environ.get("PORTFOLIO_URL", "http://127.0.0.1:4231")
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
        run = dialog.locator('[data-code-run]')
        page.wait_for_function("!document.querySelector('[data-code-run]').disabled", timeout=60000)
        assert dialog.locator('iframe').count() == 0
        assert dialog.get_by_text('Jai playground', exact=True).count() == 0
        run.click()
        dialog.locator('[data-code-output]').filter(has_text='Exit code: 42').wait_for(timeout=30000)
        if _ == 0:
            dialog.locator('[data-code-files]').click(button='right')
            dialog.get_by_role('menuitem', name='New folder', exact=True).click()
            dialog.get_by_role('textbox', name='New folder name', exact=True).fill('lib')
            dialog.get_by_role('textbox', name='New folder name', exact=True).press('Enter')
            dialog.locator('summary').filter(has_text='lib').click(button='right')
            dialog.get_by_role('menuitem', name='New file', exact=True).click()
            dialog.get_by_role('textbox', name='New file name', exact=True).fill('helper.jai')
            dialog.get_by_role('textbox', name='New file name', exact=True).press('Enter')
            dialog.locator('.cm-content').fill('answer :: () -> int { return 7; }')
            dialog.locator('[data-code-files]').get_by_role('button', name='main.jai', exact=True).click()
            dialog.locator('.cm-content').fill('#load "lib/helper.jai";\nmain :: () -> int { return answer(); }')
            run.click()
            dialog.locator('[data-code-output]').filter(has_text='Exit code: 7').wait_for(timeout=30000)
            dialog.locator('[data-code-files]').get_by_role('button', name='helper.jai', exact=True).click()
            assert 'return 7' in dialog.locator('.cm-content').inner_text()
            page.screenshot(path='/tmp/jai-owned-editor.png')
        dialog.get_by_role("button", name="Close editor", exact=True).click()
        page.wait_for_function("!document.querySelector('dialog[data-project-demo=\"jai\"]').open")
        assert dialog.locator(".cm-content").count() == 0
    page.locator('a[href="/"]').first.click()
    page.wait_for_url(base + "/")
    page.locator('a[href="/projects"]').first.click()
    page.wait_for_url("**/projects")
    page.locator('[data-project-action="try-jai"]').click()
    page.wait_for_function("document.querySelector('dialog[data-project-demo=\"jai\"]').open")
    page.keyboard.press("Escape")
    page.wait_for_function("!document.querySelector('dialog[data-project-demo=\"jai\"]').open")
    assert not errors, errors
    removed_route = page.request.get(base + "/projects/jai")
    # Cloudflare can serve the site fallback for an absent static route.
    assert removed_route.status == 404 or "data-code-workspace" not in removed_route.text()
    page.screenshot(path="/tmp/jai-modal-only-projects.png", full_page=True)
    browser.close()
    print("Passed: modal-only card, close/reopen, Astro navigation, removed route, no browser errors.")
