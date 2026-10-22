#!/usr/bin/env python3
"""B2B checkout with real local Auth/Edge/Postgres in disposable CI; no external messaging."""
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
            or os.getenv("SUPABASE_ACCESS_TOKEN")
            or os.getenv("SUPABASE_PROJECT_ID")
            or os.getenv("SUPABASE_DB_PASSWORD")
            or urlsplit(frontend).netloc == urlsplit(backend).netloc):
        sys.exit("BLOCKED: disposable loopback QA authorization missing")
    email, password = require_fixture("approved_a")
    endpoint = backend.rstrip("/") + "/functions/v1/submit-order-checkout"

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            ctx, page, private_catalog, external = guarded_context(browser, frontend, backend)
            submissions = []
            ctx.on("request", lambda req: submissions.append("submit")
                   if req.method == "POST" and req.url.startswith(endpoint) else None)
            # Close only the neutral window, synchronously, before checkout returns.
            # Any attempt to open an external destination fails the test.
            page.add_init_script("""(() => {
                window.__qaClosedCount = 0;
                const nativeOpen = window.open.bind(window);
                window.open = (url, target, features) => {
                    if (url !== 'about:blank' || target !== '_blank') {
                        throw new Error('unexpected popup destination');
                    }
                    const popup = nativeOpen(url, target, features);
                    if (popup) { popup.close(); window.__qaClosedCount++; }
                    return popup;
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
                ) as login_result:
                    page.get_by_role("button", name="Entrar no Sistema").click()
                print("LOCAL-B2B stage=auth", {"rpc_ok": login_result.value.ok, "approved": login_result.value.json().get("status") == "approved"}, flush=True)
                assert login_result.value.ok and login_result.value.json().get("status") == "approved"
                expect(page.locator("#btn-mode-wholesale")).to_contain_text("Liberado", timeout=15000)
                page.locator("#btn-mode-wholesale").click()
                expect(page.get_by_text("R$ 20,00").first).to_be_visible(timeout=15000)
                print("LOCAL-B2B stage=catalog", {"private_request": bool(private_catalog)}, flush=True)
                assert private_catalog, "Approved account never requested its private catalog"
                add = page.get_by_role(
                    "button", name=re.compile(r"^Adicionar Atacado \(\d+ [^)]+\)$")
                ).first
                expect(add).to_be_enabled()
                add.click()
                page.locator("#floating-open-cart-btn").click()
                # B2B-04: cart quantity enforces the configured five-unit minimum.
                minimum_quantity = page.get_by_label("Quantidade do produto").first
                expect(minimum_quantity).to_have_value("5")
                expect(page.get_by_title("Diminuir quantidade").first).to_be_disabled()
                minimum_quantity.fill("4")
                minimum_quantity.press("Tab")
                expect(minimum_quantity).to_have_value("5")
                expect(page.get_by_text("Mín. 5", exact=True)).to_be_visible()
                expect(page.locator("#btn-cart-proceed")).to_be_enabled()
                page.locator("#btn-cart-proceed").click()
                expect(page.get_by_placeholder("Nome completo")).to_have_count(0)
                page.get_by_label("E-mail", exact=True).fill("buyer@qa.invalid")
                page.get_by_label("Cidade", exact=True).fill("Curitiba")
                page.get_by_label("Logradouro", exact=True).fill("Rua Fictícia QA")
                page.locator("#btn-validate-quote").click()
                expect(page.locator("#btn-submit-order")).to_be_enabled(timeout=10000)

                with page.expect_response(
                    lambda r: r.url.startswith(endpoint) and r.request.method == "POST",
                    timeout=45000,
                ) as result:
                    page.locator("#btn-submit-order").click()
                response = result.value
                print("LOCAL-B2B stage=edge", {"http_status": response.status}, flush=True)
                assert response.status == 201, "Wholesale Edge checkout did not return 201"
                payload = response.json()
                receipt = payload.get("order", {}) if isinstance(payload, dict) else {}
                print("LOCAL-B2B stage=receipt", {
                    "success": payload.get("success") is True,
                    "mode_wholesale": receipt.get("shoppingMode") == "wholesale",
                    "status_pending": receipt.get("status") == "pending",
                    "qty5": bool(receipt.get("items")) and receipt["items"][0].get("quantity") == 5,
                    "price20": bool(receipt.get("items")) and float(receipt["items"][0].get("unitPrice") or 0) == 20,
                    "total100": float(receipt.get("total") or 0) == 100,
                }, flush=True)
                assert payload.get("success") is True
                assert receipt.get("orderNumber") and receipt.get("shoppingMode") == "wholesale"
                assert receipt.get("status") == "pending"
                assert receipt.get("items") and receipt["items"][0].get("quantity") == 5
                assert float(receipt["items"][0]["unitPrice"]) == 20
                assert float(receipt["total"]) == 100, "Wholesale total was not server-authoritative"

                # Optional document feature: validate actual private signed PDF
                # when returned, without touching Hosted, unauthenticated public URLs,
                # or recording signed tokens/PII in CI logs.
                doc_url = receipt.get("documentUrl")
                if doc_url:
                    signed = urlsplit(doc_url)
                    local = urlsplit(backend)
                    expected_prefix = "/storage/v1/object/sign/order-documents/"
                    assert (signed.scheme, signed.netloc) == (local.scheme, local.netloc)
                    assert signed.path.startswith(expected_prefix)
                    assert signed.query, "Signed PDF URL must carry a token"
                    signed_pdf = ctx.request.get(doc_url, timeout=15000)
                    assert signed_pdf.status == 200, "Signed private order PDF not retrievable"
                    pdf_bytes = signed_pdf.body()
                    assert pdf_bytes.startswith(b"%PDF-") and len(pdf_bytes) > 500
                    # An unsigned URL to the same private object must not disclose it.
                    object_path = signed.path[len(expected_prefix):]
                    plain_url = backend.rstrip("/") + "/storage/v1/object/public/order-documents/" + object_path
                    plain_pdf = ctx.request.get(plain_url, timeout=15000)
                    assert plain_pdf.status in (400, 401, 403, 404), "Private order PDF exposed publicly"
                    print("LOCAL-B2B stage=pdf", {"signed_pdf": True, "public_access_denied": True}, flush=True)
                else:
                    # A missing optional PDF must never be misreported as PDF PASS.
                    print("LOCAL-B2B stage=pdf NOT EVALUATED: no signed document returned", flush=True)
                expect(page.get_by_text(
                    "Pedido registrado. Clique novamente para abrir o WhatsApp.", exact=False
                )).to_be_visible(timeout=12000)
                print("LOCAL-B2B stage=popup", {"submissions": len(submissions), "closed": page.evaluate("window.__qaClosedCount")}, flush=True)
                assert len(submissions) == 1 and page.evaluate("window.__qaClosedCount") == 1

                # The buyer may retry WhatsApp handoff without recreating the order.
                page.locator("#btn-submit-order").click()
                expect(page.get_by_text(
                    "Pedido registrado. Clique novamente para abrir o WhatsApp.", exact=False
                )).to_be_visible(timeout=12000)
                assert len(submissions) == 1 and page.evaluate("window.__qaClosedCount") == 2

                # B2B-11: inspect the actual wholesale WhatsApp text handoff without
                # opening any external URL, transmitting data or posting again.
                page.evaluate("""() => {
                    window.__qaWholesaleWhatsAppLinks = [];
                    window.open = (url, target) => {
                        if (url !== 'about:blank' || target !== '_blank') throw new Error('Unexpected popup');
                        return {
                            closed: false,
                            close() { this.closed = true; },
                            location: { set href(value) { window.__qaWholesaleWhatsAppLinks.push(value); } }
                        };
                    };
                }""")
                page.locator("#btn-submit-order").click()
                page.wait_for_function("window.__qaWholesaleWhatsAppLinks.length === 1", timeout=12000)
                from urllib.parse import parse_qs
                parsed_handoff = urlsplit(page.evaluate("window.__qaWholesaleWhatsAppLinks[0]"))
                wholesale_message = parse_qs(parsed_handoff.query).get("text", [""])[0]
                assert parsed_handoff.scheme == "https" and parsed_handoff.hostname == "wa.me"
                assert parsed_handoff.path == "/5500000000000", "Wholesale contact must be QA-only"
                assert receipt["orderNumber"] in wholesale_message
                assert "QA-Produto Fictício" in wholesale_message
                assert "Total:" in wholesale_message
                assert "storage/v1/" not in wholesale_message and "documentUrl" not in wholesale_message
                assert len(submissions) == 1, "WhatsApp handoff must not create another order"
                print("LOCAL-B2B stage=whatsapp", {
                    "text_handoff": True, "official_receipt": True,
                    "private_pdf_not_shared": True, "external_messages_sent": 0
                }, flush=True)

                # Same authenticated user must see the official persisted B2B order in tracking.
                # A completed in-memory WhatsApp handoff closes the drawer;
                # a closed neutral popup from earlier retries leaves it open.
                if page.get_by_title("Fechar carrinho").count():
                    page.get_by_title("Fechar carrinho").click()
                with page.expect_response(
                    lambda r: "list-my-customer-orders" in r.url and r.request.method == "POST",
                    timeout=30000,
                ) as tracking:
                    page.locator("#header-my-orders-button").click()
                print("LOCAL-B2B stage=tracking", {"http_status": tracking.value.status}, flush=True)
                assert tracking.value.ok, "B2B tracking gateway rejected approved buyer"
                history_heading = page.get_by_role("heading", name="Histórico de Atacado", exact=True)
                expect(history_heading).to_be_visible(timeout=12000)
                print("LOCAL-B2B stage=tracking-heading", {"visible": True}, flush=True)
                order_button = page.get_by_role(
                    "button", name=re.compile(r"^#" + re.escape(receipt["orderNumber"]))
                )
                expect(order_button).to_have_count(1, timeout=12000)
                expect(order_button).to_be_visible(timeout=12000)
                print("LOCAL-B2B stage=tracking-list", {"order_in_wholesale_tab": True}, flush=True)
                page.get_by_role("button", name=re.compile(r"Pedidos Recentes de Varejo")).click()
                expect(order_button).to_have_count(0, timeout=12000)
                print("LOCAL-B2B stage=retail-isolation", {"order_hidden_in_retail": True}, flush=True)
                # Record counts only, never external URLs or credentials.
                print("LOCAL-B2B stage=network-guard", {
                    "unexpected_external_hosts": len(set(external).difference({"fonts.googleapis.com", "fonts.gstatic.com"})),
                }, flush=True)
                verify_safe([], external)  # Private-catalog requests are expected for approved buyers.
                print("LOCAL-B2B: PASS Auth/Edge checkout, canonical R$100, one submission, retry, B2B tracking and retail separation; no WhatsApp sent", flush=True)
            finally:
                ctx.close()
        finally:
            browser.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        # Exception values may contain URLs, customer data, JWTs or tokens: never print them.
        print("LOCAL-B2B: FAIL/BLOCKED (" + type(err).__name__ + ")", file=sys.stderr)
        raise SystemExit(1)
