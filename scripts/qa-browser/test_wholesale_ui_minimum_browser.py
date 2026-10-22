#!/usr/bin/env python3
"""B2B-05: monetary minimum blocks checkout in real Chromium, with no order created."""
from __future__ import annotations

import os
import re
import subprocess
import sys
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright
from test_b2b_access_browser import guarded_context, require_fixture, require_loopback, verify_safe


def main() -> None:
    frontend, backend = require_loopback("QA_BASE_URL"), require_loopback("QA_SUPABASE_URL")
    if (os.getenv("GITHUB_ACTIONS") != "true"
            or os.getenv("QA_CONFIRM_DISPOSABLE_STACK") != "yes"
            or backend != "http://127.0.0.1:54321"
            or urlsplit(frontend).netloc == urlsplit(backend).netloc
            or any(os.getenv(k) for k in ("SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_ID",
                                          "SUPABASE_DB_PASSWORD"))):
        sys.exit("BLOCKED: local disposable CI required")
    email, password = require_fixture("approved_a")
    dbs = [name for name in subprocess.run(
        ["docker", "ps", "--format", "{{.Names}}"],
        check=True, text=True, capture_output=True
    ).stdout.splitlines() if re.fullmatch(r"supabase_db_[A-Za-z0-9_-]+", name)]
    if len(dbs) != 1:
        sys.exit("BLOCKED: exactly one local DB required")

    def sql(statement: str) -> None:
        subprocess.run(
            ["docker", "exec", "-i", dbs[0], "psql", "-U", "postgres",
             "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"],
            input=statement, text=True, capture_output=True, check=True,
        )

    # One fixture mutation; restore unconditionally before any other QA checkout.
    sql("""DO $qa$
DECLARE changed int;
BEGIN
 UPDATE public.tenant_public_settings SET wholesale_min_order_value=120
 WHERE slug='corsys-catalogo-demo' AND wholesale_min_order_value=100;
 GET DIAGNOSTICS changed = ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Unexpected QA wholesale minimum'; END IF;
END $qa$;""")
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                ctx, page, private, external = guarded_context(browser, frontend, backend)
                submissions: list[str] = []
                ctx.on("request", lambda r: submissions.append("checkout")
                       if "submit-order-checkout" in r.url else None)
                try:
                    page.goto(frontend, wait_until="domcontentloaded", timeout=25000)
                    expect(page.locator("#btn-mode-wholesale")).to_be_visible(timeout=25000)
                    page.locator("#btn-mode-wholesale").click()
                    page.locator("#btn-b2b-already-have-access").click()
                    page.locator('input[type="email"]').fill(email)
                    page.locator('input[type="password"]').fill(password)
                    with page.expect_response(
                        lambda r: "get_my_wholesale_status" in r.url and r.request.method == "POST",
                        timeout=25000
                    ) as status:
                        page.get_by_role("button", name="Entrar no Sistema").click()
                    print("LOCAL-B2B-05 stage=auth", {
                        "http_ok": status.value.ok,
                        "approved": status.value.json().get("status") == "approved"
                    }, flush=True)
                    assert status.value.ok and status.value.json().get("status") == "approved"
                    expect(page.locator("#btn-mode-wholesale")).to_contain_text("Liberado", timeout=15000)
                    page.locator("#btn-mode-wholesale").click()
                    add = page.get_by_role(
                        "button", name=re.compile(r"^Adicionar Atacado \(\d+ [^)]+\)$")
                    ).first
                    expect(add).to_be_enabled(timeout=15000)
                    add.click()
                    page.locator("#floating-open-cart-btn").click()
                    print("LOCAL-B2B-05 stage=cart", {
                        "warning": page.get_by_text("Pedido mínimo da loja (Atacado):", exact=False).count(),
                        "min120": page.get_by_text("R$ 120,00", exact=True).count(),
                        "button_disabled": page.locator("#btn-cart-proceed").is_disabled(),
                        "wholesale_price20": page.get_by_text("R$ 20,00", exact=False).count() > 0
                    }, flush=True)
                    warning = page.get_by_text("Pedido mínimo da loja (Atacado):", exact=False)
                    expect(warning).to_be_visible()
                    expect(warning.locator("strong").first).to_have_text("R$ 120,00")
                    expect(page.locator("#btn-cart-proceed")).to_be_disabled()
                    assert not submissions, "Minimum warning sent order to server"
                    # This buyer is approved: the *authorized* private catalog
                    # request must exist. verify_safe() expects nonapproved users.
                    assert private, "Approved buyer did not request the private catalog"
                    verify_safe([], external)
                    print("LOCAL-B2B-05 UI PASS: R$100 below R$120 blocks checkout, no POST", flush=True)
                finally:
                    ctx.close()
            finally:
                browser.close()
    finally:
        # Restore even when UI assertions fail (never rely on the next test).
        sql("""DO $qa$
DECLARE changed int;
BEGIN
 UPDATE public.tenant_public_settings SET wholesale_min_order_value=100
 WHERE slug='corsys-catalogo-demo' AND wholesale_min_order_value=120;
 GET DIAGNOSTICS changed = ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'QA minimum restoration failed'; END IF;
END $qa$;""")


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print("LOCAL-B2B-05 UI FAIL/BLOCKED: " + type(err).__name__, file=sys.stderr)
        raise SystemExit(1)
