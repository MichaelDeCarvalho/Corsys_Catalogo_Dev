#!/usr/bin/env python3
"""One real fictitious checkout in disposable local Supabase; no WhatsApp message sent.

Tests local Auth/Edge/Postgres and closes the neutral popup before external navigation.
Never point this test to hosted systems or use a real recipient.
"""
from __future__ import annotations

import os
import re
import sys
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect
from test_b2b_access_browser import guarded_context, require_loopback, verify_safe


def main() -> None:
    frontend = require_loopback("QA_BASE_URL")
    backend = require_loopback("QA_SUPABASE_URL")
    if (os.getenv("GITHUB_ACTIONS") != "true"
            or os.getenv("QA_CONFIRM_DISPOSABLE_STACK") != "yes"
            or os.getenv("QA_ALLOW_SYNTHETIC_LOCAL_ORDER") != "yes"
            or os.getenv("SUPABASE_ACCESS_TOKEN")
            or os.getenv("SUPABASE_PROJECT_ID")):
        sys.exit("BLOCKED: local-only disposable synthetic-order authorization missing")
    if urlsplit(frontend).netloc == urlsplit(backend).netloc:
        sys.exit("BLOCKED: frontend and backend must use distinct loopback origins")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            ctx, page, private, external = guarded_context(browser, frontend, backend)
            submits: list[str] = []

            def observe_request(req):
                if (req.url.startswith(backend.rstrip("/") + "/functions/v1/submit-order-checkout")
                        and req.method == "POST"):
                    submits.append("submit")

            ctx.on("request", observe_request)
            # Close the real about:blank window synchronously before the async
            # server checkout finishes. A Playwright popup event alone may run
            # after the application has checked Window.closed.
            page.add_init_script("""(() => {
                window.__qaClosedCount = 0;
                const nativeOpen = window.open.bind(window);
                window.open = (url, target, features) => {
                    if (url !== 'about:blank' || target !== '_blank') {
                        throw new Error('Unexpected external popup');
                    }
                    const popup = nativeOpen(url, target, features);
                    if (popup) {
                        popup.close();
                        window.__qaClosedCount++;
                    }
                    return popup;
                };
            })();""")
            try:
                page.goto(frontend, wait_until="domcontentloaded", timeout=25000)
                expect(page.get_by_text("Loja Oficial QA", exact=True).first).to_be_visible(timeout=25000)
                add = page.get_by_role("button", name=re.compile(r"^Adicionar \(\d+ [^)]+\)$")).first
                add.click()
                page.locator("#floating-open-cart-btn").click()
                page.locator("#btn-cart-proceed").click()
                page.get_by_placeholder("Nome completo").fill("Comprador Fictício QA")
                page.get_by_placeholder("00.000.000/0001-00").fill("11.222.333/0001-81")
                page.get_by_label("Razão social (varejo PJ)").fill("Empresa Fictícia QA")
                page.get_by_label("E-mail", exact=True).fill("comprador@qa.invalid")
                page.get_by_label("Cidade", exact=True).fill("Curitiba")
                page.get_by_placeholder("Ex: 41987654321").fill("41999999999")
                page.get_by_label("Logradouro", exact=True).fill("Rua Fictícia QA")
                page.locator("#btn-validate-quote").click()
                expect(page.locator("#btn-submit-order")).to_be_enabled(timeout=10000)

                print("LOCAL-ORDER: submitting one fictitious PJ retail order", flush=True)
                with page.expect_response(
                    lambda r: (r.url.startswith(backend.rstrip("/") + "/functions/v1/submit-order-checkout")
                               and r.request.method == "POST"), timeout=45000
                ) as completion:
                    page.locator("#btn-submit-order").click()
                response = completion.value
                print("LOCAL-ORDER: Edge HTTP", response.status, flush=True)
                assert response.status == 201, "Local Edge checkout did not return 201"
                body = response.json()
                receipt = body.get("order", {}) if isinstance(body, dict) else {}
                assert body.get("success") is True and receipt.get("orderNumber"), "Missing server receipt"
                assert receipt.get("shoppingMode") == "retail", "Incorrect checkout mode"
                assert receipt.get("items") and receipt.get("total") > 0, "Receipt missing canonical items"
                # Diagnostic contains only booleans/counts and field names; no PII, tokens or URLs.
                page.wait_for_timeout(450)
                print("LOCAL-ORDER UI state:", {
                    "closed_neutral_popup": page.evaluate("window.__qaClosedCount"),
                    "review_visible": page.locator("#btn-submit-order").count(),
                    "retry_banner": page.get_by_text("Pedido registrado. Clique novamente para abrir o WhatsApp.", exact=False).count(),
                    "receipt_validation_error": page.get_by_text("Resposta inválida do serviço de pedidos", exact=False).count(),
                    "generic_checkout_error": page.get_by_text("Não foi possível processar o pedido.", exact=False).count(),
                    "receipt_keys": sorted(receipt.keys()),
                    "item_keys": sorted(receipt["items"][0].keys()) if receipt.get("items") else [],
                    "receipt_types": {k: type(v).__name__ for k, v in receipt.items() if k != "items"},
                    "item_types": {k: type(v).__name__ for k, v in receipt["items"][0].items()} if receipt.get("items") else {},
                    "validation_failure": next((tag for tag in [
                        "ID ausente", "Número do pedido ausente", "Modalidade inválida",
                        "Método de entrega ausente", "Itens ausentes", "Subtotal inválido",
                        "Desconto inválido", "Taxa de frete inválida", "Total inválido",
                        "Status diferente de pending", "Forma de pagamento inválida",
                        "Data de criação inválida", "Item malformado",
                        "Dados do produto ausentes", "Imagem do produto inválida",
                        "Preço unitário inválido", "Quantidade inválida",
                        "Preço total do item inválido", "Variante do produto inválida",
                        "URL do documento inválida", "Data de expiração do documento inválida",
                        "Token de rastreamento inválido"
                    ] if page.get_by_text(tag, exact=False).count()), "unknown")
                }, flush=True)
                expect(page.get_by_text("Pedido registrado. Clique novamente para abrir o WhatsApp.", exact=False)).to_be_visible(timeout=15000)
                assert len(submits) == 1 and page.evaluate("window.__qaClosedCount") == 1, "Expected one checkout and one synchronously closed popup"

                print("LOCAL-ORDER: retrying the same order after closing popup", flush=True)
                page.locator("#btn-submit-order").click()
                expect(page.get_by_text("Pedido registrado. Clique novamente para abrir o WhatsApp.", exact=False)).to_be_visible(timeout=12000)
                assert len(submits) == 1 and page.evaluate("window.__qaClosedCount") == 2, "Retry duplicated order or did not reopen and close popup"

                print("LOCAL-ORDER: changing buyer contact before retry", flush=True)
                page.get_by_role("button", name="Voltar e editar").click()
                page.get_by_placeholder("Ex: 41987654321").fill("41988888888")
                page.locator("#btn-validate-quote").click()
                page.locator("#btn-submit-order").click()
                page.wait_for_timeout(700)
                print("LOCAL-ORDER changed-draft diagnostics:", {
                    "submits": len(submits),
                    "stale_receipt_notice": page.get_by_text("O pedido anterior já foi registrado com outros dados.", exact=False).count(),
                    "retry_notice": page.get_by_text("Pedido registrado. Clique novamente", exact=False).count(),
                    "popup_closed": page.evaluate("window.__qaClosedCount"),
                    "review_visible": page.locator("#btn-submit-order").count(),
                    "auth_or_settings_notice": page.get_by_text("Sessão ou loja alterada", exact=False).count(),
                }, flush=True)
                expect(page.get_by_text("O pedido anterior já foi registrado com outros dados.", exact=False)).to_be_visible(timeout=12000)
                assert len(submits) == 1, "Modified draft attempted another order"

                # For the final original-draft retry, replace only window.open
                # with a same-page sink. We inspect the real generated wa.me URL
                # but never open a tab, connect to WhatsApp, or send a message.
                page.evaluate("""() => {
                  window.__qaWhatsAppLinks = [];
                  window.open = (url, target) => {
                    if (url !== 'about:blank' || target !== '_blank') throw new Error('unexpected popup');
                    return {
                      closed: false,
                      close() { this.closed = true; },
                      location: {
                        set href(value) { window.__qaWhatsAppLinks.push(value); }
                      }
                    };
                  };
                }""")
                page.get_by_role("button", name="Voltar e editar").click()
                page.get_by_placeholder("Ex: 41987654321").fill("41999999999")
                page.locator("#btn-validate-quote").click()
                page.locator("#btn-submit-order").click()
                page.wait_for_function("window.__qaWhatsAppLinks && window.__qaWhatsAppLinks.length === 1", timeout=12000)
                from urllib.parse import parse_qs
                handoff_url = page.evaluate("window.__qaWhatsAppLinks[0]")
                parsed = urlsplit(handoff_url)
                message = parse_qs(parsed.query).get("text", [""])[0]
                handoff_checks = {
                    "https_wa_domain": parsed.scheme == "https" and parsed.hostname == "wa.me",
                    "synthetic_recipient": parsed.path == "/5500000000000",
                    "server_order_number": receipt["orderNumber"] in message,
                    "synthetic_product": "QA-Produto Fictício" in message,
                    "total_in_message": "Total:" in message,
                    "no_full_document": "11.222.333/0001-81" not in message,
                    "single_submission": len(submits) == 1,
                    "exactly_three_real_popups_closed": page.evaluate("window.__qaClosedCount") == 3,
                }
                print("LOCAL-ORDER WhatsApp handoff contract:", handoff_checks, flush=True)
                assert all(handoff_checks.values()), "Local WhatsApp handoff contract failed"

                # B2B-13 retail regression: same fictitious PJ receipt is
                # recoverable with the real token-based tracking endpoint.
                with page.expect_response(
                    lambda r: "track-order-by-token" in r.url and r.request.method == "POST",
                    timeout=30000,
                ) as retail_tracking:
                    page.locator("#header-my-orders-button").click()
                print("LOCAL-ORDER tracking-stage=response", {"status": retail_tracking.value.status}, flush=True)
                assert retail_tracking.value.status == 200, "Retail tracking token was rejected"
                expect(page.get_by_role("heading", name="Pedidos Neste Navegador")).to_be_visible(timeout=12000)
                print("LOCAL-ORDER tracking-stage=list-visible", flush=True)
                retail_order = page.get_by_role(
                    "button", name=re.compile(r"^#" + re.escape(receipt["orderNumber"]))
                )
                expect(retail_order).to_have_count(1, timeout=12000)
                expect(retail_order).to_be_visible()
                retail_order.click()
                print("LOCAL-ORDER tracking-stage=order-opened", flush=True)
                expect(page.get_by_text("Varejo", exact=True).first).to_be_visible(timeout=12000)
                print("LOCAL-ORDER tracking-stage=retail-label", flush=True)
                tab_count = page.get_by_role("button", name=re.compile("Atacado B2B")).count()
                print("LOCAL-ORDER tracking-stage=tab-count", {"unexpected": tab_count}, flush=True)
                assert tab_count == 0
                print("LOCAL-ORDER stage=retail-tracking", {
                    "http_status": retail_tracking.value.status,
                    "pj_receipt_in_retail": True, "wholesale_tab_hidden": True
                }, flush=True)
                verify_safe(private, external)
                print("LOCAL-ORDER: PASS local Edge/Postgres receipt, two closed popups, retry/stale draft, and intercepted WhatsApp message link; zero messages sent", flush=True)
            finally:
                ctx.close()
        finally:
            browser.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        # No URLs, tokens, customer PII or message contents in CI logs.
        print("LOCAL-ORDER: FAIL/BLOCKED (" + type(err).__name__ + ")", file=sys.stderr)
        raise SystemExit(1)
