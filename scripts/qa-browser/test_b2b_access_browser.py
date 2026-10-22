#!/usr/bin/env python3
"""Read-only Chromium/Playwright smoke test against a *local isolated* QA stack.

Independent of Bun/CI: requires Python Playwright + a local Chromium installation.
NEVER set QA_BASE_URL or QA_SUPABASE_URL to hosted/production environments.
No fixture creation, order checkout, PDF download, or WhatsApp navigation.
"""
from __future__ import annotations

import os
import re
import sys
from urllib.parse import urlsplit

LOOPBACK = {"localhost", "127.0.0.1", "::1"}
STATUSES = {
    "pending": "Cadastro atacadista em análise.",
    "suspended": "Acesso atacadista temporariamente indisponível.",
    "rejected": "Cadastro atacadista não aprovado.",
}
APPROVED_CASES = {"approved_a": "approved", "approved_b": "not_registered"}


def require_loopback(key: str) -> str:
    value = os.getenv(key, "").strip()
    parsed = urlsplit(value)
    if (parsed.scheme not in ("http", "https") or parsed.hostname not in LOOPBACK or parsed.port is None
            or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
        sys.exit(f"BLOCKED: {key} must be an explicitly configured loopback HTTP(S) URL; no hosted access.")
    return value


def require_fixture(state: str) -> tuple[str, str]:
    prefix = "QA_B2B_" + state.upper()
    email = os.getenv(prefix + "_EMAIL", "").strip()
    password = os.getenv(prefix + "_PASSWORD", "")
    # Approved test accounts are synthetic and created by this same isolated CI;
    # reuse the existing disposable QA test password, never a Hosted credential.
    if state in APPROVED_CASES and os.getenv("GITHUB_ACTIONS") == "true" and os.getenv("QA_CONFIRM_DISPOSABLE_STACK") == "yes":
        suffix = "approved" if state == "approved_a" else "approved-b"
        email = f"qa-b2b-{suffix}@qa.invalid"
        password = os.getenv("QA_B2B_PENDING_PASSWORD", "")
    if not email or not password:
        sys.exit(f"BLOCKED: missing synthetic QA fixture: {prefix}_EMAIL / {prefix}_PASSWORD.")
    return email, password


def selected_cases() -> list[str]:
    """Run all checks by default; allow a strict subset while preparing QA accounts."""
    allowed = {"anon", *STATUSES, *APPROVED_CASES}
    raw = os.getenv("QA_B2B_CASES", "anon,pending,suspended,rejected,approved_a,approved_b")
    cases = [item.strip().lower() for item in raw.split(",")]
    if not cases or any(case not in allowed for case in cases) or len(set(cases)) != len(cases):
        sys.exit("BLOCKED: QA_B2B_CASES must contain distinct anon,pending,suspended,rejected values.")
    return cases


def guarded_context(browser, storefront_url: str, backend_url: str):
    """Abort HTTP(S) requests outside the exact two approved local QA origins."""
    allowed = {(urlsplit(url).scheme, urlsplit(url).netloc) for url in (storefront_url, backend_url)}
    allowed_websocket_endpoints = {
        (urlsplit(url).hostname, urlsplit(url).port) for url in (storefront_url, backend_url)
    }
    ctx = browser.new_context(accept_downloads=False, service_workers="block")
    if not hasattr(ctx, "route_web_socket"):
        ctx.close()
        sys.exit("BLOCKED: Playwright 1.48+ required to intercept WebSocket connections.")
    unexpected: list[str] = []

    def route_request(route):
        parsed = urlsplit(route.request.url)
        if parsed.scheme in ("http", "https") and (parsed.scheme, parsed.netloc) not in allowed:
            unexpected.append(parsed.hostname or "unknown")  # No path, token or PII
            route.abort("blockedbyclient")
        else:
            route.continue_()

    ctx.route("**/*", route_request)

    def route_websocket(ws):
        url = urlsplit(ws.url)
        if url.scheme not in ("ws", "wss") or (url.hostname, url.port) not in allowed_websocket_endpoints:
            unexpected.append(url.hostname or "unknown")
            ws.close(code=1008)
        else:
            ws.connect_to_server()

    ctx.route_web_socket("**/*", route_websocket)
    page = ctx.new_page()
    requests: list[str] = []
    page.on(
        "request",
        lambda request: requests.append("private-catalog")
        if "get-wholesale-catalog" in request.url else None,
    )
    return ctx, page, requests, unexpected


def verify_safe(requests, unexpected):
    # Storefront HTML references Google Fonts; the browser interceptor blocks
    # those harmless asset fetches before network access. Any other external
    # destination remains a failed security precondition.
    decorative_only = {"fonts.googleapis.com", "fonts.gstatic.com"}
    assert not set(unexpected).difference(decorative_only), "Blocked unexpected external destination"
    assert not requests, "Non-approved account attempted a private wholesale catalog request"


def main() -> int:
    frontend = require_loopback("QA_BASE_URL")
    backend = require_loopback("QA_SUPABASE_URL")
    if urlsplit(frontend).port == urlsplit(backend).port and urlsplit(frontend).hostname == urlsplit(backend).hostname:
        sys.exit("BLOCKED: frontend and Supabase QA need distinct endpoints.")
    cases = selected_cases()
    fixtures = {status: require_fixture(status) for status in cases if status != "anon"}
    try:
        from playwright.sync_api import sync_playwright, expect
    except ImportError:
        sys.exit("BLOCKED: install Python Playwright in isolated QA environment (pip install playwright).")
    browser_bin = os.getenv("QA_CHROMIUM_EXECUTABLE", "").strip()
    results: list[tuple[str, str]] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True, executable_path=browser_bin or None,
        )
        try:
            if "anon" in cases:
                print('QA CASE anon: start', flush=True)
                ctx, page, requests, unexpected = guarded_context(browser, frontend, backend)
                try:
                    page.goto(frontend, wait_until="domcontentloaded", timeout=20000)
                    expect(page.locator("#btn-mode-wholesale")).to_be_visible(timeout=20000)
                    page.locator("#btn-mode-wholesale").click()
                    expect(page.locator("#b2b-gate-modal")).to_be_visible(timeout=7000)
                    expect(page.locator("#btn-mode-retail")).to_have_class(
                        re.compile(".*bg-white.*"), timeout=7000,
                    )
                    verify_safe(requests, unexpected)
                    results.append(("B2B-01 (anônimo)", "PASS"))
                    print('QA CASE anon: PASS', flush=True)
                finally:
                    ctx.close()

            for state, (email, password) in fixtures.items():
                print(f'QA CASE {state}: start', flush=True)
                ctx, page, requests, unexpected = guarded_context(browser, frontend, backend)
                try:
                    page.goto(frontend, wait_until="domcontentloaded", timeout=20000)
                    expect(page.locator("#btn-mode-wholesale")).to_be_visible(timeout=20000)
                    page.locator("#btn-mode-wholesale").click()
                    page.locator("#btn-b2b-already-have-access").click()
                    page.locator('input[type="email"]').fill(email)
                    page.locator('input[type="password"]').fill(password)
                    # Request is observed before the login click to avoid missing an early response.
                    with page.expect_response(
                        lambda r: (r.url.startswith(backend.rstrip("/") + "/rest/v1/rpc/get_my_wholesale_status")
                                   and r.request.method == "POST"),
                        timeout=25000,
                    ) as status_response:
                        page.get_by_role("button", name="Entrar no Sistema").click()
                    assert status_response.value.ok, "The status RPC did not succeed"
                    returned = status_response.value.json()
                    assert isinstance(returned, dict) and returned.get("status") == APPROVED_CASES.get(state, state), "Unexpected QA buyer status"
                    expect(page.locator("#btn-mode-wholesale")).to_be_visible(timeout=15000)
                    if state == "approved_a":
                        expect(page.locator("#btn-mode-wholesale")).to_contain_text("Liberado")
                        page.locator("#btn-mode-wholesale").click()
                        expect(page.get_by_text("Preço Atacado").first).to_be_visible(timeout=15000)
                        expect(page.get_by_text("R$ 20,00").first).to_be_visible(timeout=15000)
                        assert requests, "Approved buyer should request private catalog"
                        verify_safe([], unexpected)
                        # B2B-04/05/06/07: full local-Auth wholesale review, never submit.
                        add_button = page.get_by_role(
                            "button", name=re.compile(r"^Adicionar Atacado \(\d+ [^)]+\)$")
                        ).first
                        expect(add_button).to_be_enabled(timeout=12000)
                        add_button.click()  # min 5 units, local QA total R$ 100
                        page.locator("#floating-open-cart-btn").click()
                        expect(page.locator("#btn-cart-proceed")).to_be_enabled()
                        page.locator("#btn-cart-proceed").click()
                        expect(page.get_by_placeholder("Nome completo")).to_have_count(0)
                        expect(page.get_by_placeholder("00.000.000/0001-00")).to_have_count(0)
                        expect(page.get_by_label("Razão social (varejo PJ)")).to_have_count(0)
                        expect(page.get_by_label("Observações")).to_have_count(0)
                        expect(page.get_by_label("E-mail", exact=True)).to_be_visible()
                        expect(page.get_by_label("Cidade", exact=True)).to_be_visible()
                        page.locator("#btn-validate-quote").click()
                        expect(page.get_by_text("E-mail é obrigatório.", exact=True)).to_be_visible()
                        expect(page.get_by_text("Cidade é obrigatório.", exact=True)).to_be_visible()
                        page.get_by_label("E-mail", exact=True).fill("b2b@qa.invalid")
                        page.get_by_label("Cidade", exact=True).fill("Curitiba")
                        page.get_by_label("Logradouro", exact=True).fill("Rua Fictícia QA")
                        page.locator("#btn-validate-quote").click()
                        expect(page.locator("#btn-submit-order")).to_be_visible(timeout=10000)
                        print("QA CASE approved_a: wholesale checkout review PASS; no order submitted", flush=True)
                    elif state == "approved_b":
                        page.locator("#btn-mode-wholesale").click()
                        expect(page.locator("#b2b-gate-modal")).to_be_visible(timeout=10000)
                        verify_safe(requests, unexpected)
                    else:
                        if state == "pending":
                            expect(page.locator("#btn-mode-wholesale")).to_contain_text("Em análise")
                        page.locator("#btn-mode-wholesale").click()
                        expect(page.get_by_text(STATUSES[state], exact=False)).to_be_visible(timeout=10000)
                        expect(page.locator("#btn-mode-retail")).to_have_class(
                            re.compile(".*bg-white.*"), timeout=7000,
                        )
                        verify_safe(requests, unexpected)
                    results.append((f"B2B ({state})", "PASS"))
                    print(f'QA CASE {state}: PASS', flush=True)
                finally:
                    ctx.close()
        finally:
            browser.close()

    for case, result in results:
        print(f"{case}: {result}")
    skipped = sorted({"anon", *STATUSES, *APPROVED_CASES}.difference(cases))
    print("QA browser: selected cases completed; cases not selected:", ", ".join(skipped) or "none")
    print("B2B checkout/tracking, configured fields and concurrent session races NOT EVALUATED by this script.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        # Avoid printing exception data containing URLs, tokens or personal details.
        print(f"FAIL/BLOCKED: {type(error).__name__}; see local-only QA trace for diagnosis.", file=sys.stderr)
        raise SystemExit(1)
