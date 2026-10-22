#!/usr/bin/env python3
"""Read-only PF/PJ browser regression using isolated, loopback-only QA storefront.

This intentionally stops BEFORE submitting an order or opening WhatsApp.
It verifies visible interaction, not checkout persistence or tracking.
"""
from __future__ import annotations

import os
import re
import sys

from playwright.sync_api import sync_playwright, expect
from test_b2b_access_browser import guarded_context, require_loopback, verify_safe


def main() -> int:
    frontend = require_loopback("QA_BASE_URL")
    backend = require_loopback("QA_SUPABASE_URL")
    if frontend == backend:
        sys.exit("BLOCKED: frontend and Supabase must use separate local QA endpoints.")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=os.getenv("QA_CHROMIUM_EXECUTABLE") or None)
        try:
            ctx, page, private_catalog_requests, rejected_origins = guarded_context(browser, frontend, backend)
            order_requests: list[str] = []
            page.on(
                "request",
                lambda req: order_requests.append("checkout")
                if "submit-order-checkout" in req.url else None,
            )
            try:
                page.goto(frontend, wait_until="domcontentloaded", timeout=20000)
                expect(page.locator("#btn-mode-retail")).to_be_visible(timeout=20000)
                add = page.get_by_role("button", name=re.compile(r"^Adicionar \(\d+ [^)]+\)$")).first
                expect(add).to_be_enabled(timeout=20000)
                add.click()
                expect(page.locator("#floating-open-cart-btn")).to_be_visible(timeout=10000)
                page.locator("#floating-open-cart-btn").click()
                proceed = page.locator("#btn-cart-proceed")
                expect(proceed).to_be_enabled(timeout=10000)
                proceed.click()
                pj = page.get_by_role("button", name="Pessoa Jurídica (CNPJ)")
                pf = page.get_by_role("button", name="Pessoa Física (CPF)")
                expect(pj).to_be_visible()
                expect(pf).to_be_visible()

                # Start PJ; switching to PF must clear the previously entered CNPJ
                # and commercial name, not just hide a field.
                cnpj = page.get_by_placeholder("00.000.000/0001-00")
                company = page.get_by_placeholder("Supermercado Silva Ltda")
                expect(cnpj).to_be_visible()
                expect(company).to_be_visible()
                cnpj.fill("12.345.678/0001-95")
                company.fill("Empresa Fictícia QA")
                pf.click()
                cpf = page.get_by_placeholder("000.000.000-00")
                expect(cpf).to_be_visible()
                expect(cpf).to_have_value("")
                expect(company).to_have_count(0)

                # Switching back must not resurrect the old CNPJ or company name.
                pj.click()
                expect(cnpj).to_be_visible()
                expect(cnpj).to_have_value("")
                expect(company).to_be_visible()
                expect(company).to_have_value("")

                # Switching to PF again must discard the old CPF too.
                pf.click()
                cpf.fill("529.982.247-25")
                pj.click()
                pf.click()
                expect(cpf).to_have_value("")
                expect(company).to_have_count(0)

                verify_safe(private_catalog_requests, rejected_origins)
                assert not order_requests, "Read-only PF/PJ test must not submit an order"
                print("B2B-13 PF/PJ browser UI: PASS (local QA only; no checkout, tracking, WhatsApp or PDF).")
            finally:
                ctx.close()
        finally:
            browser.close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FAIL/BLOCKED: {type(error).__name__}; inspect local QA without logging credentials.", file=sys.stderr)
        raise SystemExit(1)
