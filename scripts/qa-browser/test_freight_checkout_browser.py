#!/usr/bin/env python3
"""Isolated Chromium E2E: signed *synthetic* route quote -> REAL local Edge checkout
-> PostgreSQL receipt -> WhatsApp handoff intercepted without external navigation.

The browser replaces ONLY estimate-delivery's HTTP response. No Google API is called.
The submit-order-checkout Edge Function, HMAC verification and SQL RPC are real.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright
from test_b2b_access_browser import guarded_context, require_loopback, verify_safe

SLUG = "corsys-catalogo-demo"
DISTANCE_METERS = 5000  # synthetic; NEVER a live Google distance
RATE_CENTS = 250
FREIGHT_CENTS = 1250
ORIGIN = {
    "street": "Rua da Loja QA",
    "number": "10",
    "neighborhood": "Centro",
    "city": "Curitiba",
    "state": "PR",
    "zipCode": "80000000",
}


def canonical_address(address: dict[str, str]) -> str:
    return (
        f"{address['street']}, {address['number']} - "
        f"{address['neighborhood']}, {address['city']} - "
        f"{address['state']}, {address['zipCode']}"
    ).strip().lower().replace("  ", " ")


def make_quote(address: dict[str, str], secret: str) -> dict:
    canonical_origin = canonical_address(ORIGIN)
    canonical_destination = canonical_address(address)
    expiry = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")
    payload = (
        f"{SLUG}|entrega|{canonical_origin}|{canonical_destination}|"
        f"{DISTANCE_METERS}|{RATE_CENTS}|{FREIGHT_CENTS}|{expiry}"
    )
    signature = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    token = base64.b64encode(payload.encode("utf-8")).decode("ascii") + "." + signature
    return {
        "success": True,
        "quoteToken": token,
        "distanceMeters": DISTANCE_METERS,
        "rateCentsPerKm": RATE_CENTS,
        "freightCents": FREIGHT_CENTS,
        "originAddress": canonical_origin,
        "destinationAddress": canonical_destination,
        "expiresAt": expiry,
    }


def main() -> None:
    frontend = require_loopback("QA_BASE_URL")
    backend = require_loopback("QA_SUPABASE_URL")
    secret = os.environ.get("QA_FREIGHT_HMAC_SECRET", "")
    if (
        os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("QA_CONFIRM_DISPOSABLE_STACK") != "yes"
        or os.environ.get("QA_ALLOW_SYNTHETIC_LOCAL_ORDER") != "yes"
        or os.environ.get("VITE_GOOGLE_ROUTES_UI_ENABLED") != "true"
        or os.environ.get("GOOGLE_ROUTES_ENABLED") == "true"
        or len(secret) < 32
        or os.environ.get("SUPABASE_ACCESS_TOKEN")
        or os.environ.get("SUPABASE_PROJECT_ID")
        or os.environ.get("SUPABASE_DB_PASSWORD")
        or os.environ.get("DATABASE_URL")
    ):
        sys.exit("BLOCKED: unlinked synthetic local freight QA prerequisites missing")
    if urlsplit(frontend).netloc == urlsplit(backend).netloc:
        sys.exit("BLOCKED: frontend and backend must have distinct loopback origins")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            ctx, page, private, external = guarded_context(browser, frontend, backend)
            estimates: list[str] = []
            submits: list[str] = []
            endpoint = backend.rstrip("/") + "/functions/v1/estimate-delivery"
            checkout_endpoint = backend.rstrip("/") + "/functions/v1/submit-order-checkout"
            cors = {
                "Access-Control-Allow-Origin": frontend,
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
                "Cache-Control": "no-store",
                "Vary": "Origin",
            }

            def synthetic_estimate(route) -> None:
                req = route.request
                if req.method == "OPTIONS":
                    route.fulfill(status=204, headers=cors, body="")
                    return
                assert req.method == "POST", "Unexpected delivery quotation method"
                body = req.post_data_json
                assert isinstance(body, dict)
                assert body.get("slug") == SLUG
                assert body.get("method") == "entrega"
                assert body.get("privacyConfirmed") is True
                address = body.get("address")
                assert isinstance(address, dict)
                assert all(address.get(key) for key in ORIGIN.keys()), "Incomplete destination"
                assert address.get("state") == "PR" and address.get("zipCode") == "80000000"
                estimates.append("synthetic-quote")
                quote = make_quote(address, secret)
                route.fulfill(status=200, headers={
                    **cors, "Content-Type": "application/json"
                }, body=json.dumps(quote))

            def observe_request(request) -> None:
                if request.method == "POST" and request.url == checkout_endpoint:
                    submits.append("real-local-checkout")

            # Scoped interception: all other requests (including checkout) use
            # existing allowlisted local routing, not synthetic responses.
            ctx.route(endpoint, synthetic_estimate)
            ctx.on("request", observe_request)

            # Neutral popup captures the wa.me handoff entirely inside the page.
            # Never contact, open, or send to WhatsApp.
            page.add_init_script("""(() => {
              window.__qaWhatsAppLinks = [];
              window.open = (url, target) => {
                if (url !== 'about:blank' || target !== '_blank') {
                  throw new Error('Blocked unexpected popup');
                }
                return {
                  closed: false,
                  close() { this.closed = true; },
                  location: {
                    set href(url) { window.__qaWhatsAppLinks.push(url); }
                  }
                };
              };
            })();""")
            try:
                page.goto(frontend, wait_until="domcontentloaded", timeout=25000)
                expect(page.get_by_text("Loja Oficial QA", exact=True).first).to_be_visible(timeout=25000)
                page.get_by_role("button", name=re.compile(r"^Adicionar \(\d+ [^)]+\)$")).first.click()
                page.locator("#floating-open-cart-btn").click()
                page.locator("#btn-cart-proceed").click()
                page.get_by_placeholder("Nome completo").fill("Comprador QA Fictício")
                page.get_by_placeholder("00.000.000/0001-00").fill("11.222.333/0001-81")
                page.get_by_label("Razão social (varejo PJ)").fill("Empresa QA Fictícia")
                page.get_by_label("E-mail", exact=True).fill("comprador@qa.invalid")
                page.get_by_placeholder("Ex: 41987654321").fill("41999999999")
                page.get_by_role("button", name="Entrega própria").click()
                page.get_by_label("Logradouro", exact=True).fill("Rua do Destino QA")
                page.get_by_label("Número", exact=True).fill("55")
                page.get_by_label("Bairro", exact=True).fill("Centro")
                page.get_by_label("Cidade", exact=True).fill("Curitiba")
                page.get_by_label("UF", exact=True).fill("PR")
                page.get_by_label("CEP", exact=True).fill("80000000")

                assert len(estimates) == 0, "Estimate called before explicit address confirmation"
                quote_button = page.get_by_role("button", name="Calcular estimativa de entrega")
                expect(quote_button).to_be_enabled(timeout=7000)

                # Must not proceed until a quote has been requested and accepted.
                page.locator("#btn-validate-quote").click()
                expect(page.get_by_text("Calcule ou atualize o frete", exact=False)).to_be_visible()
                assert len(estimates) == 0 and len(submits) == 0

                quote_button.click()
                expect(page.get_by_text("Frete: R$ 12,50", exact=False).first).to_be_visible(timeout=10000)
                assert len(estimates) == 1

                # Editing the destination invalidates the original signed quote.
                page.get_by_label("Número", exact=True).fill("56")
                page.locator("#btn-validate-quote").click()
                expect(page.get_by_text("Calcule ou atualize o frete", exact=False)).to_be_visible()
                assert len(estimates) == 1 and len(submits) == 0

                quote_button.click()
                expect(page.get_by_text("Frete: R$ 12,50", exact=False).first).to_be_visible(timeout=10000)
                assert len(estimates) == 2
                page.locator("#btn-validate-quote").click()
                expect(page.get_by_text("Total (Produtos + Frete):")).to_be_visible()
                expect(page.get_by_text("R$ 42,50", exact=True).first).to_be_visible()

                # Real submit-order-checkout Edge + real SQL and HMAC verification.
                with page.expect_response(
                    lambda response: response.url == checkout_endpoint and
                        response.request.method == "POST", timeout=45000
                ) as completion:
                    page.locator("#btn-submit-order").click()
                result = completion.value
                assert result.status == 201, "Local checkout did not return HTTP 201"
                body = result.json()
                assert body.get("success") is True
                receipt = body.get("order") or {}
                assert receipt.get("orderNumber") and receipt.get("deliveryMethod") == "entrega"
                assert abs(float(receipt.get("subtotal", -1)) - 30.00) < 0.001
                assert abs(float(receipt.get("shippingFee", -1)) - 12.50) < 0.001
                assert abs(float(receipt.get("total", -1)) - 42.50) < 0.001
                assert len(submits) == 1, "Checkout sent multiple requests"

                page.wait_for_function(
                    "window.__qaWhatsAppLinks && window.__qaWhatsAppLinks.length === 1",
                    timeout=15000
                )
                handoff_url = page.evaluate("window.__qaWhatsAppLinks[0]")
                parsed = urlsplit(handoff_url)
                message = parse_qs(parsed.query).get("text", [""])[0]
                assert parsed.scheme == "https" and parsed.hostname == "wa.me"
                assert parsed.path == "/5500000000000"  # fictitious QA recipient
                assert receipt["orderNumber"] in message
                assert "*Frete:* R$ 12,50" in message
                assert "*Total:* R$ 42,50" in message
                assert "QA-Produto Fictício" in message
                assert "11.222.333/0001-81" not in message
                verify_safe(private, external)
                print(
                    "FREIGHT-E2E UI/Edge PASS: quote mocked only; "
                    "real local checkout HTTP 201; receipt subtotal 30.00, freight 12.50, "
                    "total 42.50; edited address required recalculation; "
                    "WhatsApp handoff intercepted; zero Google/WhatsApp external requests",
                    flush=True
                )
            finally:
                ctx.close()
        finally:
            browser.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never print customer fields, signed quote, WhatsApp text, or URL.
        print("FREIGHT-E2E: FAIL/BLOCKED (" + type(error).__name__ + ")", file=sys.stderr)
        raise SystemExit(1)
