#!/usr/bin/env python3
"""B2B checkout reply withheld during logout in a disposable local CI browser.

The real Edge request must finish before logout. The browser's application
promise is deliberately delayed; then a second tab signs out the same user.
No WhatsApp navigation, hosted access, or customer data is logged.
"""
from __future__ import annotations

import os
import re
import sys
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright
from test_b2b_access_browser import guarded_context, require_fixture, require_loopback, verify_safe


def main() -> None:
    frontend = require_loopback("QA_BASE_URL")
    backend = require_loopback("QA_SUPABASE_URL")
    if (os.getenv("GITHUB_ACTIONS") != "true"
            or os.getenv("QA_CONFIRM_DISPOSABLE_STACK") != "yes"
            or os.getenv("QA_ALLOW_SYNTHETIC_LOCAL_ORDER") != "yes"
            or any(os.getenv(key) for key in (
                "SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_ID", "SUPABASE_DB_PASSWORD"
            ))
            or urlsplit(frontend).netloc == urlsplit(backend).netloc):
        sys.exit("BLOCKED: synthetic checkout race may only run in disposable local CI")

    email, password = require_fixture("approved_a")
    endpoint = backend.rstrip("/") + "/functions/v1/submit-order-checkout"

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            ctx, page, private, external = guarded_context(browser, frontend, backend)
            observed = []
            def watch_response(response):
                if response.request.method == "POST" and response.url.startswith(endpoint):
                    observed.append(response)
            page.on("response", watch_response)
            # Delay delivery of a *completed* real HTTP response to the app.
            # The real checkout commits in disposable Postgres before signout,
            # but the React handler must not show its stale receipt afterward.
            page.add_init_script("""(() => {
                const realFetch = window.fetch.bind(window);
                window.__qaRace = { pending: false, httpStatus: null, released: false, observedAfterResponse: false, release: null, popups: 0 };
                window.fetch = (...args) => {
                    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
                    if (!url.includes('/functions/v1/submit-order-checkout')) return realFetch(...args);
                    return realFetch(...args).then(response => new Promise(resolve => {
                        window.__qaRace.httpStatus = response.status;
                        window.__qaRace.pending = true;
                        window.__qaRace.release = () => {
                            window.__qaRace.released = true;
                            window.__qaRace.pending = false;
                            resolve(response);
                            // Give React's awaited submit handler a browser task to settle.
                            setTimeout(() => { window.__qaRace.observedAfterResponse = true; }, 500);
                        };
                    }));
                };
                const originalOpen = window.open.bind(window);
                window.open = (url, target, features) => {
                    if (url !== 'about:blank' || target !== '_blank') {
                        throw new Error('unexpected external popup');
                    }
                    const child = originalOpen(url, target, features);
                    if (child) { child.close(); window.__qaRace.popups++; }
                    return child;
                };
            })();""")
            try:
                page.goto(frontend, wait_until="domcontentloaded", timeout=25000)
                expect(page.locator("#btn-mode-wholesale")).to_be_visible(timeout=25000)
                page.locator("#btn-mode-wholesale").click()
                page.locator("#btn-b2b-already-have-access").click()
                page.locator('input[type="email"]').fill(email)
                page.locator('input[type="password"]').fill(password)
                with page.expect_response(
                    lambda r: r.url.startswith(backend.rstrip("/") + "/rest/v1/rpc/get_my_wholesale_status")
                    and r.request.method == "POST", timeout=25000
                ) as status:
                    page.get_by_role("button", name="Entrar no Sistema").click()
                assert status.value.ok and status.value.json().get("status") == "approved"

                expect(page.locator("#btn-mode-wholesale")).to_contain_text("Liberado", timeout=15000)
                page.locator("#btn-mode-wholesale").click()
                add = page.get_by_role("button", name=re.compile(r"^Adicionar Atacado \(\d+ [^)]+\)$")).first
                expect(add).to_be_enabled(timeout=15000)
                add.click()
                page.locator("#floating-open-cart-btn").click()
                page.locator("#btn-cart-proceed").click()
                page.get_by_label("E-mail", exact=True).fill("race-buyer@qa.invalid")
                page.get_by_label("Cidade", exact=True).fill("Curitiba")
                page.get_by_label("Logradouro", exact=True).fill("Rua Corrida Fictícia QA")
                page.locator("#btn-validate-quote").click()
                expect(page.locator("#btn-submit-order")).to_be_enabled(timeout=12000)
                page.locator("#btn-submit-order").click()
                page.wait_for_function("window.__qaRace.pending === true", timeout=45000)

                assert page.evaluate("window.__qaRace.httpStatus") == 201, "The real server did not commit local B2B checkout"
                assert len(observed) == 1 and observed[0].status == 201
                server_body = observed[0].json()
                receipt = server_body.get("order", {})
                assert receipt.get("shoppingMode") == "wholesale" and receipt.get("orderNumber")
                assert float(receipt.get("total") or 0) == 100

                # Sign out using the actual header in a *second* page that shares
                # origin/localStorage/Auth BroadcastChannel with the first page.
                sibling = ctx.new_page()
                sibling.goto(frontend, wait_until="domcontentloaded", timeout=25000)
                expect(sibling.locator("#header-user-menu-btn")).to_be_visible(timeout=15000)
                sibling.locator("#header-user-menu-btn").click()
                sibling.locator("#header-user-logout-btn").click()
                expect(sibling.locator("#header-login-button")).to_be_visible(timeout=15000)
                # The original tab must observe the Auth session boundary before
                # its artificially delayed checkout response is released.
                expect(page.locator("#header-login-button")).to_be_visible(timeout=15000)
                print("LOCAL-RACE stage=logout", {"server_committed": True, "client_signed_out": True}, flush=True)

                page.evaluate("window.__qaRace.release()")
                page.wait_for_function("window.__qaRace.observedAfterResponse === true", timeout=5000)
                # No stale order receipt, B2B private pricing or WhatsApp handoff
                # may appear in the logged-out browser after the response arrives.
                expect(page.get_by_text("Pedido registrado. Clique novamente", exact=False)).to_have_count(0)
                expect(page.get_by_text("#" + receipt["orderNumber"], exact=False)).to_have_count(0)
                expect(page.get_by_text("race-buyer@qa.invalid", exact=False)).to_have_count(0)
                expect(page.locator("#btn-submit-order")).to_have_count(0)
                expect(page.locator("#btn-mode-wholesale")).not_to_contain_text("Liberado", timeout=12000)
                assert page.evaluate("window.__qaRace.popups") == 1
                assert len(observed) == 1
                verify_safe([], external)
                print("LOCAL-RACE PASS: real 201 committed, second-tab logout before response delivery, no stale receipt or duplicate submit", flush=True)
            finally:
                ctx.close()
        finally:
            browser.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        # Playwright exceptions can include JWTs, signed URLs and test PII.
        print("LOCAL-RACE: FAIL/BLOCKED (" + type(err).__name__ + ")", file=sys.stderr)
        raise SystemExit(1)
