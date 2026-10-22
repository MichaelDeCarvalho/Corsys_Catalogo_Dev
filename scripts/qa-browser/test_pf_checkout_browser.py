#!/usr/bin/env python3
"""B2B-13: one fictitious retail PF order + real tracking, after existing QA audits.

Must be the final synthetic write in unlinked disposable CI. WhatsApp is never sent.
"""
from __future__ import annotations

import os
import re
import sys
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright
from test_b2b_access_browser import guarded_context, require_loopback, verify_safe


def main() -> None:
    frontend = require_loopback("QA_BASE_URL")
    backend = require_loopback("QA_SUPABASE_URL")
    if (os.getenv("GITHUB_ACTIONS") != "true"
            or os.getenv("QA_CONFIRM_DISPOSABLE_STACK") != "yes"
            or os.getenv("QA_ALLOW_SYNTHETIC_LOCAL_ORDER") != "yes"
            or backend != "http://127.0.0.1:54321"
            or urlsplit(frontend).netloc == urlsplit(backend).netloc
            or any(os.getenv(k) for k in (
                "SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_ID", "SUPABASE_DB_PASSWORD"
            ))):
        sys.exit("BLOCKED: synthetic PF checkout requires unlinked local CI")
    endpoint = backend.rstrip("/") + "/functions/v1/submit-order-checkout"

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            ctx, page, private, external = guarded_context(browser, frontend, backend)
            submissions: list[str] = []
            ctx.on("request", lambda r: submissions.append("checkout")
                   if r.method == "POST" and r.url.startswith(endpoint) else None)
            page.add_init_script("""(() => {
                window.__qaPfClosed = 0;
                const nativeOpen = window.open.bind(window);
                window.open = (url, target, features) => {
                    if (url !== 'about:blank' || target !== '_blank') {
                        throw new Error('Unexpected popup');
                    }
                    const popup = nativeOpen(url, target, features);
                    if (popup) { popup.close(); window.__qaPfClosed++; }
                    return popup;
                };
            })();""")
            try:
                page.goto(frontend, wait_until="domcontentloaded", timeout=25000)
                print("LOCAL-PF stage=storefront", flush=True)
                expect(page.locator("#btn-mode-retail")).to_be_visible(timeout=25000)
                add = page.get_by_role("button", name=re.compile(r"^Adicionar \(\d+ [^)]+\)$")).first
                expect(add).to_be_enabled()
                add.click()
                page.locator("#floating-open-cart-btn").click()
                page.locator("#btn-cart-proceed").click()
                print("LOCAL-PF stage=details", flush=True)
                page.get_by_role("button", name="Pessoa Física (CPF)").click()
                expect(page.get_by_placeholder("000.000.000-00")).to_be_visible()
                expect(page.get_by_label("Razão social (varejo PJ)")).to_have_count(0)
                page.get_by_placeholder("Nome completo").fill("Comprador PF Fictício QA")
                page.get_by_placeholder("000.000.000-00").fill("529.982.247-25")
                page.get_by_placeholder("Ex: 41987654321").fill("41999999999")
                page.get_by_label("E-mail", exact=True).fill("pf@qa.invalid")
                page.get_by_label("Cidade", exact=True).fill("Curitiba")
                page.get_by_label("Logradouro", exact=True).fill("Rua PF Fictícia QA")
                expect(page.get_by_label("Observações", exact=True)).to_have_count(0)
                page.locator("#btn-validate-quote").click()
                expect(page.locator("#btn-submit-order")).to_be_enabled(timeout=15000)
                print("LOCAL-PF stage=review", flush=True)
                with page.expect_response(
                    lambda r: r.url.startswith(endpoint) and r.request.method == "POST",
                    timeout=45000
                ) as done:
                    page.locator("#btn-submit-order").click()
                print("LOCAL-PF stage=edge", {"status": done.value.status}, flush=True)
                assert done.value.status == 201, "Retail PF Edge checkout did not succeed"
                body = done.value.json()
                receipt = body.get("order", {})
                assert body.get("success") is True
                assert receipt.get("shoppingMode") == "retail"
                assert receipt.get("orderNumber") and receipt.get("trackingToken")
                print("LOCAL-PF stage=receipt", {"tracking_token_present": bool(receipt.get("trackingToken"))}, flush=True)
                expect(page.get_by_text(
                    "Pedido registrado. Clique novamente para abrir o WhatsApp.", exact=False
                )).to_be_visible(timeout=15000)
                print("LOCAL-PF stage=confirmed", flush=True)
                # Popup was intentionally closed, so checkout leaves the cart
                # drawer open. Close it before clicking the header navigation.
                page.get_by_title("Fechar carrinho").click()
                expect(page.locator("#header-my-orders-button")).to_be_visible()
                with page.expect_response(
                    lambda r: "track-order-by-token" in r.url and r.request.method == "POST",
                    timeout=30000
                ) as track:
                    page.locator("#header-my-orders-button").click()
                print("LOCAL-PF stage=tracking", {"status": track.value.status}, flush=True)
                assert track.value.status == 200, "Retail PF tracking failed"
                order = page.get_by_role(
                    "button", name=re.compile("^#" + re.escape(receipt["orderNumber"]))
                )
                expect(order).to_have_count(1, timeout=15000)
                assert len(submissions) == 1 and page.evaluate("window.__qaPfClosed") == 1
                verify_safe(private, external)
                print("LOCAL-PF PASS: retail PF HTTP201, private token tracking HTTP200, one order, no external WhatsApp", flush=True)
            finally:
                ctx.close()
        finally:
            browser.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        # No URLs, PII, credentials, JWT or order documents in logs.
        print("LOCAL-PF FAIL/BLOCKED: " + type(err).__name__, file=sys.stderr)
        raise SystemExit(1)
