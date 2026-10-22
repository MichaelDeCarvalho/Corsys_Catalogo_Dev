#!/usr/bin/env python3
"""RACE-01/02/03: stale wholesale status/catalog, buyer switch and empty catalog.

Authenticated Chromium + real local Supabase, with only the browser-facing
reply delayed or replaced. No checkout/write, external URL or user PII logs.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright
from test_b2b_access_browser import guarded_context, require_fixture, require_loopback, verify_safe


# Every case uses a new, isolated browser context and the same synthetic
# backend. Real HTTP responses are obtained before withholding app resolution.
RACE_SHIM = """(({ kind }) => {
  const fetchOriginal = window.fetch.bind(window);
  const needle = kind === 'status' ? '/rest/v1/rpc/get_my_wholesale_status'
                               : '/functions/v1/get-wholesale-catalog';
  window.__qaWholesaleRace = {
    calls: 0, pending: false, released: false, status: 0, release: null,
    processed: false
  };
  window.fetch = (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    if (!url.includes(needle)) return fetchOriginal(...args);
    window.__qaWholesaleRace.calls++;
    return fetchOriginal(...args).then(response => {
      window.__qaWholesaleRace.status = response.status;
      if (kind === 'empty') {
        window.__qaWholesaleRace.processed = true;
        // The authenticated HTTP call above is real. Only its browser-facing
        // items are replaced with a deliberately empty synthetic catalog.
        return new Response(JSON.stringify({ success: true, items: [] }), {
          status: 200, headers: { 'content-type': 'application/json' }
        });
      }
      return new Promise(resolve => {
        window.__qaWholesaleRace.pending = true;
        window.__qaWholesaleRace.release = () => {
          window.__qaWholesaleRace.released = true;
          window.__qaWholesaleRace.pending = false;
          resolve(response);
          setTimeout(() => { window.__qaWholesaleRace.processed = true; }, 500);
        };
      });
    });
  };
})"""  # invoked by Playwright with literal case JSON


def login(page, email: str, password: str) -> None:
    page.locator("#btn-mode-wholesale").click()
    expect(page.locator("#btn-b2b-already-have-access")).to_be_visible(timeout=15000)
    page.locator("#btn-b2b-already-have-access").click()
    page.locator('input[type="email"]').fill(email)
    page.locator('input[type="password"]').fill(password)
    page.get_by_role("button", name="Entrar no Sistema").click()


def logout(page) -> None:
    expect(page.locator("#header-user-menu-btn")).to_be_visible(timeout=20000)
    page.locator("#header-user-menu-btn").click()
    page.locator("#header-user-logout-btn").click()
    expect(page.locator("#header-login-button")).to_be_visible(timeout=20000)


def assert_retail_without_a(page, *, empty_catalog: bool = False) -> None:
    expect(page.locator("#btn-mode-retail")).to_have_class(
        re.compile(".*bg-white.*"), timeout=15000
    )
    expect(page.locator("#btn-mode-wholesale")).not_to_contain_text(
        "Liberado", timeout=15000
    )
    expect(page.get_by_text("Preço Atacado")).to_have_count(0)
    expect(page.get_by_text("R$ 20,00", exact=True)).to_have_count(0)


def main() -> None:
    frontend = require_loopback("QA_BASE_URL")
    backend = require_loopback("QA_SUPABASE_URL")
    if (os.getenv("GITHUB_ACTIONS") != "true" or
        os.getenv("QA_CONFIRM_DISPOSABLE_STACK") != "yes" or
        backend != "http://127.0.0.1:54321" or
        (urlsplit(frontend).netloc == urlsplit(backend).netloc) or
        any(os.getenv(k) for k in
            ("SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_ID", "SUPABASE_DB_PASSWORD"))):
        sys.exit("BLOCKED: require disposable, unlinked local CI")
    buyer_a = require_fixture("approved_a")
    buyer_b = require_fixture("approved_b")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            # RACE-01: successful status HTTP response delayed until logout.
            ctx, page, private, external = guarded_context(browser, frontend, backend)
            try:
                page.add_init_script(
                    RACE_SHIM + "({ kind: 'status' });"
                )
                page.goto(frontend, wait_until="domcontentloaded", timeout=25000)
                expect(page.locator("#btn-mode-wholesale")).to_be_visible(timeout=25000)
                login(page, *buyer_a)
                page.wait_for_function(
                    "window.__qaWholesaleRace.pending === true", timeout=30000)
                assert page.evaluate("window.__qaWholesaleRace.status") == 200
                sibling = ctx.new_page()
                sibling.goto(frontend, wait_until="domcontentloaded", timeout=25000)
                logout(sibling)
                expect(page.locator("#header-login-button")).to_be_visible(timeout=15000)
                page.evaluate("window.__qaWholesaleRace.release()")
                page.wait_for_function(
                    "window.__qaWholesaleRace.processed === true", timeout=7000)
                assert_retail_without_a(page)
                assert not private, "Logged-out buyer attempted private catalog"
                verify_safe([], external)
                print("LOCAL-RACE-01 PASS: real approved status arrived after logout, no restored access", flush=True)
            finally:
                ctx.close()

            # RACE-02: real A catalog response delivered after logout and B login.
            ctx, page, private, external = guarded_context(browser, frontend, backend)
            try:
                page.add_init_script(RACE_SHIM + "({ kind: 'catalog' });")
                page.goto(frontend, wait_until="domcontentloaded", timeout=25000)
                expect(page.locator("#btn-mode-wholesale")).to_be_visible(timeout=25000)
                login(page, *buyer_a)
                expect(page.locator("#btn-mode-wholesale")).to_contain_text(
                    "Liberado", timeout=20000)
                page.locator("#btn-mode-wholesale").click()
                page.wait_for_function(
                    "window.__qaWholesaleRace.pending === true", timeout=30000)
                assert page.evaluate("window.__qaWholesaleRace.status") == 200
                assert private, "Approved A should request the actual private catalog"
                sibling = ctx.new_page()
                sibling.goto(frontend, wait_until="domcontentloaded", timeout=25000)
                logout(sibling)
                login(sibling, *buyer_b)
                expect(sibling.locator("#btn-mode-wholesale")).not_to_contain_text(
                    "Liberado", timeout=20000)
                expect(page.locator("#btn-mode-wholesale")).not_to_contain_text(
                    "Liberado", timeout=20000)
                page.evaluate("window.__qaWholesaleRace.release()")
                page.wait_for_function(
                    "window.__qaWholesaleRace.processed === true", timeout=7000)
                assert_retail_without_a(page)
                verify_safe([], external)
                print("LOCAL-RACE-02 PASS: buyer B cannot see delayed private A price or approval", flush=True)
            finally:
                ctx.close()

            # RACE-03: one authorized backend request, but zero wholesale
            # products in the client; no repeated request loop on rerender.
            ctx, page, private, external = guarded_context(browser, frontend, backend)
            try:
                page.add_init_script(RACE_SHIM + "({ kind: 'empty' });")
                page.goto(frontend, wait_until="domcontentloaded", timeout=25000)
                expect(page.locator("#btn-mode-wholesale")).to_be_visible(timeout=25000)
                login(page, *buyer_a)
                expect(page.locator("#btn-mode-wholesale")).to_contain_text(
                    "Liberado", timeout=20000)
                page.locator("#btn-mode-wholesale").click()
                page.wait_for_function(
                    "window.__qaWholesaleRace.processed === true", timeout=30000)
                assert page.evaluate("window.__qaWholesaleRace.status") == 200
                # The empty authorized catalog is allowed. Verify mode and
                # absence of private prices rather than coupling to CSS classes.
                expect(page.locator("#btn-mode-wholesale")).to_contain_text(
                    "Liberado", timeout=12000)
                expect(page.get_by_text("Preço Atacado")).to_have_count(0)
                page.wait_for_timeout(1200)  # bounded loop-detection window
                assert page.evaluate("window.__qaWholesaleRace.calls") == 1, (
                    "Empty catalog triggered repeated client fetches"
                )
                assert len(private) == 1, "Expected one authorized catalog HTTP request"
                verify_safe([], external)
                print("LOCAL-RACE-03 PASS: empty authorized catalog, one request, no duplicate fetch loop", flush=True)
            finally:
                ctx.close()

            # RACE-04: a buyer approved when opening the mode-switch modal
            # is suspended in disposable Postgres BEFORE final confirmation.
            # The actual status recheck must deny mode change AND retain the
            # existing retail cart. Restore only this fixture in finally.
            local_db_names = [
                name for name in subprocess.run(
                    ["docker", "ps", "--format", "{{.Names}}"],
                    capture_output=True, text=True, check=True
                ).stdout.splitlines()
                if re.fullmatch(r"supabase_db_[A-Za-z0-9_-]+", name)
            ]
            if len(local_db_names) != 1:
                raise RuntimeError("Exactly one disposable local database required")
            def local_sql(query: str) -> None:
                subprocess.run([
                    "docker", "exec", "-i", local_db_names[0], "psql",
                    "-U", "postgres", "-d", "postgres",
                    "-v", "ON_ERROR_STOP=1", "-q"
                ], input=query, capture_output=True, text=True, check=True)

            ctx, page, private, external = guarded_context(browser, frontend, backend)
            revoked = False
            try:
                page.goto(frontend, wait_until="domcontentloaded", timeout=25000)
                expect(page.locator("#btn-mode-wholesale")).to_be_visible(timeout=25000)
                login(page, *buyer_a)
                expect(page.locator("#btn-mode-wholesale")).to_contain_text(
                    "Liberado", timeout=20000)
                retail_add = page.get_by_role(
                    "button", name=re.compile(r"^Adicionar \(\d+ [^)]+\)$")
                ).first
                expect(retail_add).to_be_enabled(timeout=15000)
                retail_add.click()
                expect(page.locator("#floating-open-cart-btn")).to_be_visible()
                page.locator("#btn-mode-wholesale").click()
                expect(page.locator("#b2b-switch-mode-modal")).to_be_visible(timeout=10000)

                local_sql("""DO $qa$
DECLARE n integer;
BEGIN
 UPDATE public.wholesale_customers SET status='suspended'
 WHERE user_id=(SELECT id FROM auth.users
                WHERE email='qa-b2b-approved@qa.invalid')
   AND tenant_id=(SELECT id FROM public.tenants
                  WHERE slug='corsys-catalogo-demo')
   AND status='approved';
 GET DIAGNOSTICS n = ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'QA expected one approved A'; END IF;
END $qa$;""")
                revoked = True
                with page.expect_response(
                    lambda r: "get_my_wholesale_status" in r.url
                    and r.request.method == "POST", timeout=25000
                ) as response:
                    page.locator("#btn-confirm-clear-and-switch").click()
                assert response.value.status == 200
                assert response.value.json().get("status") == "suspended"
                expect(page.locator("#b2b-switch-mode-modal")).to_have_count(
                    0, timeout=15000)
                expect(page.locator("#btn-mode-retail")).to_have_class(
                    re.compile(".*bg-white.*"), timeout=15000)
                expect(page.locator("#floating-open-cart-btn")).to_be_visible()
                expect(page.locator("#btn-mode-wholesale")).not_to_contain_text(
                    "Liberado", timeout=15000)
                assert not private, "Revoked buyer requested private catalog"
                verify_safe([], external)
                print("LOCAL-RACE-04 PASS: real revocation recheck denied switch, existing retail cart preserved", flush=True)
            finally:
                ctx.close()
                if revoked:
                    local_sql("""DO $qa$
DECLARE n integer;
BEGIN
 UPDATE public.wholesale_customers SET status='approved'
 WHERE user_id=(SELECT id FROM auth.users
                WHERE email='qa-b2b-approved@qa.invalid')
   AND tenant_id=(SELECT id FROM public.tenants
                  WHERE slug='corsys-catalogo-demo')
   AND status='suspended';
 GET DIAGNOSTICS n = ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'QA approved status restore failed'; END IF;
END $qa$;""")
        finally:
            browser.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Exceptions may include signed URLs/JWT; never echo them.
        print("LOCAL-RACE-01-03 FAIL/BLOCKED: " + type(error).__name__,
              file=sys.stderr)
        raise SystemExit(1)
