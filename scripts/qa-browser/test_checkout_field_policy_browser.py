#!/usr/bin/env python3
"""Real Chromium checkout field rules against a disposable local Supabase; no orders."""
from __future__ import annotations
import os
import re
import sys
from playwright.sync_api import sync_playwright, expect
from test_b2b_access_browser import require_loopback, guarded_context, verify_safe

def main():
    frontend = require_loopback("QA_BASE_URL")
    backend = require_loopback("QA_SUPABASE_URL")
    if os.getenv("GITHUB_ACTIONS") != "true" or os.getenv("QA_CONFIRM_DISPOSABLE_STACK") != "yes":
        sys.exit("BLOCKED: isolated CI-only field QA")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            ctx, page, private, external = guarded_context(browser, frontend, backend)
            orders = []
            page.on("request", lambda r: orders.append(1) if "submit-order-checkout" in r.url else None)
            try:
                page.goto(frontend, wait_until="domcontentloaded", timeout=20000)
                add = page.get_by_role("button", name=re.compile(r"^Adicionar \(\d+ [^)]+\)$")).first
                expect(add).to_be_enabled(timeout=20000)
                add.click()
                page.locator("#floating-open-cart-btn").click()
                page.locator("#btn-cart-proceed").click()
                company = page.get_by_label("Razão social (varejo PJ)")
                email = page.get_by_label("E-mail", exact=True)
                city = page.get_by_label("Cidade", exact=True)
                expect(company).to_be_visible()
                expect(email).to_be_visible()
                expect(city).to_be_visible()
                assert company.get_attribute("required") is not None
                assert email.get_attribute("required") is not None
                assert city.get_attribute("required") is not None
                expect(page.get_by_label("Observações", exact=True)).to_have_count(0)
                # All configurable address/contact fields are checked, not
                # only the three required ones. The synthetic DB hides notes.
                expected_required = ("Razão social (varejo PJ)", "E-mail", "Logradouro", "Cidade")
                expected_optional = ("Número", "Complemento", "Bairro", "UF", "CEP", "Código do vendedor")
                for field in expected_required:
                    input_field = page.get_by_label(field, exact=True)
                    expect(input_field).to_be_visible()
                    assert input_field.get_attribute("required") is not None, field
                for field in expected_optional:
                    input_field = page.get_by_label(field, exact=True)
                    expect(input_field).to_be_visible()
                    assert input_field.get_attribute("required") is None, field
                assert page.get_by_placeholder("Nome completo").get_attribute("required") is not None
                assert page.get_by_placeholder("Ex: 41987654321").get_attribute("required") is not None
                page.locator("#btn-validate-quote").click()
                expect(page.get_by_text("Razão social (varejo PJ) é obrigatório.", exact=True)).to_be_visible()
                expect(page.get_by_text("E-mail é obrigatório.", exact=True)).to_be_visible()
                expect(page.get_by_text("Cidade é obrigatório.", exact=True)).to_be_visible()
                expect(page.locator("#btn-submit-order")).to_have_count(0)
                company.fill("Empresa Fictícia QA")
                email.fill("comprador@qa.invalid")
                city.fill("Curitiba")
                page.get_by_placeholder("Nome completo").fill("Comprador Fictício QA")
                page.get_by_placeholder("00.000.000/0001-00").fill("11.222.333/0001-81")
                page.get_by_placeholder("Ex: 41987654321").fill("41999999999")
                page.get_by_label("Logradouro", exact=True).fill("Rua Fictícia QA")
                page.locator("#btn-validate-quote").click()
                expect(page.locator("#btn-submit-order")).to_be_visible(timeout=10000)
                # PJ-only company field must disappear on PF, but required
                # shared address/email rules must persist across the switch.
                page.get_by_role("button", name="Voltar e editar").click()
                page.get_by_role("button", name="Pessoa Física (CPF)").click()
                expect(page.get_by_label("Razão social (varejo PJ)")).to_have_count(0)
                for field in ("E-mail", "Cidade", "Logradouro"):
                    assert page.get_by_label(field, exact=True).get_attribute("required") is not None
                expect(page.get_by_label("Observações", exact=True)).to_have_count(0)
                assert not orders, "Form validation must not create an order"
                verify_safe(private, external)
                print("B2B-06/07 local browser: required and hidden fields, review PASS; zero order submissions.")
            finally:
                ctx.close()
        finally:
            browser.close()

if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print("B2B-06/07 browser FAIL/BLOCKED: " + type(err).__name__, file=sys.stderr)
        raise SystemExit(1)
