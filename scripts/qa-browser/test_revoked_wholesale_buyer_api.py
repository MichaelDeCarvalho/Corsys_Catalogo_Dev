#!/usr/bin/env python3
"""B2B-12: revoke approved buyer in disposable local DB and verify real Edge deny.

Only synthetic identities. Never logs JWTs, order bodies, documents or URLs.
Must run AFTER all positive B2B order audits, as it intentionally suspends A.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from uuid import uuid4
from playwright.sync_api import sync_playwright
from test_b2b_access_browser import require_fixture, require_loopback


def main() -> None:
    frontend = require_loopback("QA_BASE_URL")
    backend = require_loopback("QA_SUPABASE_URL")
    if (os.getenv("GITHUB_ACTIONS") != "true"
            or os.getenv("QA_CONFIRM_DISPOSABLE_STACK") != "yes"
            or os.getenv("QA_ALLOW_SYNTHETIC_LOCAL_ORDER") != "yes"
            or backend != "http://127.0.0.1:54321"
            or any(os.getenv(key) for key in (
                "SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_ID", "SUPABASE_DB_PASSWORD"
            )) or frontend == backend):
        sys.exit("BLOCKED: local, unlinked, synthetic QA required")

    anon = os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY", "")
    if not anon or len(anon) < 20:
        sys.exit("BLOCKED: local-only public API key missing")
    buyer_a = require_fixture("approved_a")
    buyer_b = require_fixture("approved_b")
    containers = subprocess.run(
        ["docker", "ps", "--format", "{{.Names}}"],
        check=True, capture_output=True, text=True,
    ).stdout.splitlines()
    local_dbs = [name for name in containers if re.fullmatch(r"supabase_db_[A-Za-z0-9_-]+", name)]
    if len(local_dbs) != 1:
        sys.exit("BLOCKED: expected exactly one disposable local Postgres")

    with sync_playwright() as p:
        api = p.request.new_context(base_url=backend, extra_http_headers={"apikey": anon})
        try:
            def login(fixture: tuple[str, str]) -> str:
                r = api.post("/auth/v1/token?grant_type=password", data={
                    "email": fixture[0], "password": fixture[1]
                }, max_redirects=0, timeout=20000)
                assert r.status == 200, "Synthetic buyer login failed"
                jwt = r.json().get("access_token")
                assert isinstance(jwt, str) and jwt, "Auth did not return synthetic JWT"
                return jwt

            jwt_a, jwt_b = login(buyer_a), login(buyer_b)

            def post_edge(token: str, name: str, body: dict):
                return api.post(
                    "/functions/v1/" + name,
                    headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
                    data=json.dumps(body), max_redirects=0, timeout=25000,
                )

            allowed_a = post_edge(jwt_a, "get-wholesale-catalog",
                                  {"tenantSlug": "corsys-catalogo-demo"})
            assert allowed_a.status == 200, "Approved A has no authorized private catalog"
            items = allowed_a.json().get("items", [])
            assert len(items) == 1 and items[0].get("sku") == "QA-A"
            product_id = items[0].get("productId")
            assert isinstance(product_id, str), "QA product ID absent"

            rejected_b = post_edge(jwt_b, "get-wholesale-catalog",
                                   {"tenantSlug": "corsys-catalogo-demo"})
            assert rejected_b.status == 403, "Tenant B buyer could access tenant A pricing"

            # Negative replay: an idempotency key must never act as authority
            # to retrieve an order from a different buyer or tenant. It is
            # extracted only inside the disposable test DB and never logged.
            query = """SELECT idempotency_key::text || '|' || id::text FROM public.orders
                       WHERE shopping_mode='wholesale'
                         AND tenant_id=(SELECT id FROM public.tenants
                                        WHERE slug='corsys-catalogo-demo')
                       ORDER BY created_at LIMIT 1;"""
            prior_record = subprocess.run(
                ["docker", "exec", "-i", local_dbs[0], "psql", "-U", "postgres",
                 "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", query],
                capture_output=True, text=True, check=True,
            ).stdout.strip()
            assert prior_record.count("|") == 1, "No unique QA wholesale order"
            prior_key, prior_order_id = prior_record.split("|")
            assert re.fullmatch(r"[a-f0-9-]{36}", prior_key), "No synthetic replay key"
            assert re.fullmatch(r"[a-f0-9-]{36}", prior_order_id), "No synthetic order ID"
            cross_buyer_replay = post_edge(jwt_b, "submit-order-checkout", {
                "tenantSlug": "corsys-catalogo-demo",
                "idempotencyKey": prior_key,
                "shoppingMode": "wholesale",
                "items": [{"productId": product_id, "quantity": 5,
                           "selectedVariant": None}],
                "customer": {"email": "tenant-b@qa.invalid"},
                "shippingAddress": {"street": "Rua Fictícia QA",
                                    "city": "Curitiba"},
                "paymentMethod": "pix",
                "deliveryMethod": "retirada",
            })
            assert cross_buyer_replay.status == 403, (
                "Cross-tenant idempotency replay bypassed buyer authorization"
            )

            def draft(*, key: str, qty: int = 5) -> dict:
                return {
                    "tenantSlug": "corsys-catalogo-demo",
                    "idempotencyKey": key,
                    "shoppingMode": "wholesale",
                    "items": [{"productId": product_id, "quantity": qty,
                               "selectedVariant": None}],
                    "customer": {"email": "buyer@qa.invalid"},
                    "shippingAddress": {"street": "Rua Fictícia QA",
                                        "city": "Curitiba"},
                    "paymentMethod": "pix",
                    "deliveryMethod": "retirada",
                }

            # B2B-10: same approved buyer replay is stable; no new order is made.
            positive = post_edge(jwt_a, "submit-order-checkout", draft(key=prior_key))
            assert positive.status == 201, "Approved buyer's idempotent replay failed"
            replay_receipt = positive.json().get("order", {})
            assert replay_receipt.get("id") == prior_order_id
            assert replay_receipt.get("shoppingMode") == "wholesale"
            assert float(replay_receipt.get("total") or 0) == 100
            print("LOCAL-B2B stage=approved-replay PASS", flush=True)

            # B2B-04: backend must independently enforce the product minimum.
            too_few = post_edge(jwt_a, "submit-order-checkout",
                                draft(key=str(uuid4()), qty=4))
            assert too_few.status == 400, "Backend accepted quantity below B2B minimum"

            # B2B-05: temporarily raise the minimum ONLY in disposable Postgres.
            # The product minimum remains 5; 5 x R$20 falls short of R$120.
            def local_sql(sql: str) -> None:
                subprocess.run(
                    ["docker", "exec", "-i", local_dbs[0], "psql", "-U",
                     "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"],
                    input=sql, capture_output=True, text=True, check=True,
                )

            before = """DO $qa$
DECLARE changed integer;
BEGIN
  UPDATE public.tenant_public_settings
  SET wholesale_min_order_value=120
  WHERE slug='corsys-catalogo-demo' AND wholesale_min_order_value=100;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'Expected QA minimum 100'; END IF;
END $qa$;"""
            restore = """UPDATE public.tenant_public_settings
                         SET wholesale_min_order_value=100
                         WHERE slug='corsys-catalogo-demo'
                           AND wholesale_min_order_value=120;"""
            local_sql(before)
            try:
                too_low = post_edge(jwt_a, "submit-order-checkout",
                                    draft(key=str(uuid4())))
                assert too_low.status == 400, "Backend accepted below-store-minimum B2B order"
            finally:
                local_sql(restore)
            print("LOCAL-B2B stage=minima PASS", flush=True)

            # B2B-09: never trust a caller's claimed buyer, tenant or prices.
            for field, forged_value in (
                ("buyerUserId", str(uuid4())),
                ("subtotal", 0.01),
                ("total", 0.01),
                ("wholesalePrice", 0.01),
            ):
                manipulated = draft(key=str(uuid4()))
                manipulated[field] = forged_value
                denial = post_edge(jwt_a, "submit-order-checkout", manipulated)
                assert denial.status == 400, "Forbidden authority field was accepted"
            # Required tenant-specific optional checkout fields must be checked
            # server-side even when a client bypasses browser validation.
            no_email = draft(key=str(uuid4()))
            del no_email["customer"]["email"]
            assert post_edge(jwt_a, "submit-order-checkout", no_email).status == 400
            no_city = draft(key=str(uuid4()))
            del no_city["shippingAddress"]["city"]
            assert post_edge(jwt_a, "submit-order-checkout", no_city).status == 400
            print("LOCAL-B2B stage=forgery-and-required-fields PASS", flush=True)

            # Additional adversarial variants are request-only and MUST never
            # create orders or expose receipts. Client authority is ignored or
            # rejected; the server determines prices, buyer and tenant.
            invalid = (
                ("nested_unit_price", lambda d: d["items"][0].update(unitPrice=0.01)),
                ("nested_discount", lambda d: d["items"][0].update(discount=99)),
                ("nested_buyer", lambda d: d["items"][0].update(buyer_user_id=str(uuid4()))),
                ("negative_quantity", lambda d: d["items"][0].update(quantity=-1)),
                ("fractional_quantity", lambda d: d["items"][0].update(quantity=5.5)),
                ("string_quantity", lambda d: d["items"][0].update(quantity="5")),
                ("invalid_variant", lambda d: d["items"][0].update(selectedVariant={"id": "bad"})),
                ("invalid_tenant_type", lambda d: d.update(tenantSlug={"slug": "corsys-catalogo-demo"})),
                ("invalid_idempotency", lambda d: d.update(idempotencyKey=str(uuid4()).replace("-4", "-1", 1))),
            )
            for case, tamper in invalid:
                crafted = draft(key=str(uuid4()))
                tamper(crafted)
                result = post_edge(jwt_a, "submit-order-checkout", crafted)
                assert result.status == 400, (
                    "Invalid checkout field accepted: " + case
                )

            # A buyer approved in tenant A is not authorized to create a
            # wholesale order in the isolated synthetic tenant B.
            alien_tenant = draft(key=str(uuid4()))
            alien_tenant["tenantSlug"] = "tenant-qa-b"
            denied = post_edge(jwt_a, "submit-order-checkout", alien_tenant)
            assert denied.status in (400, 403, 404), (
                "Cross-tenant checkout was not denied"
            )

            # Extra properties aren't an authority grant. When ignored by
            # the whitelist, replay must still return the original buyer's
            # canonical order, with no extra persisted order or forged total.
            ignored_fields = draft(key=prior_key)
            ignored_fields["tenantId"] = str(uuid4())
            ignored_fields["buyer_id"] = str(uuid4())
            ignored_fields["items"][0]["tenantId"] = str(uuid4())
            allowed_replay = post_edge(jwt_a, "submit-order-checkout", ignored_fields)
            assert allowed_replay.status == 201, (
                "Whitelist rejected safe idempotent replay unexpectedly"
            )
            safe_receipt = allowed_replay.json().get("order", {})
            assert safe_receipt.get("id") == prior_order_id
            assert safe_receipt.get("shoppingMode") == "wholesale"
            assert float(safe_receipt.get("total") or 0) == 100
            print("LOCAL-B2B stage=adversarial-variants PASS", {
                "invalid_variants": len(invalid),
                "cross_tenant_denied": True,
                "untrusted_extra_fields_ignored": True
            }, flush=True)


            # Mutation is deliberately performed against ONLY the disposable
            # postgres container after A's legitimate orders have been audited.
            sql = """DO $qa$
DECLARE changed integer;
BEGIN
  UPDATE public.wholesale_customers SET status='suspended'
  WHERE tenant_id=(SELECT id FROM public.tenants WHERE slug='corsys-catalogo-demo')
    AND user_id=(SELECT id FROM auth.users WHERE email='qa-b2b-approved@qa.invalid')
    AND status='approved';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'Expected exactly one QA buyer suspended'; END IF;
END $qa$;"""
            subprocess.run(
                ["docker", "exec", "-i", local_dbs[0], "psql", "-U", "postgres",
                 "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"],
                input=sql, capture_output=True, text=True, check=True,
            )

            rejected_a = post_edge(jwt_a, "get-wholesale-catalog",
                                   {"tenantSlug": "corsys-catalogo-demo"})
            assert rejected_a.status == 403, "Revoked A still reads private wholesale prices"

            attempted = post_edge(jwt_a, "submit-order-checkout", {
                "tenantSlug": "corsys-catalogo-demo",
                "idempotencyKey": str(uuid4()),
                "shoppingMode": "wholesale",
                "items": [{"productId": product_id, "quantity": 5, "selectedVariant": None}],
                "customer": {"email": "revoked@qa.invalid"},
                "shippingAddress": {"street": "Rua Fictícia QA", "city": "Curitiba"},
                "paymentMethod": "pix",
                "deliveryMethod": "retirada",
            })
            assert attempted.status == 403, "Revoked A created an unauthorized B2B checkout"

            verify = """DO $qa$
BEGIN
  IF (SELECT count(*) FROM public.orders) <> 3 THEN
    RAISE EXCEPTION 'Revoked buyer caused an unexpected order';
  END IF;
  IF (SELECT count(*) FROM public.orders o JOIN public.tenants t ON t.id=o.tenant_id
      WHERE t.slug='tenant-qa-b') <> 0 THEN
    RAISE EXCEPTION 'Tenant B isolation failed';
  END IF;
END $qa$;"""
            subprocess.run(
                ["docker", "exec", "-i", local_dbs[0], "psql", "-U", "postgres",
                 "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"],
                input=verify, capture_output=True, text=True, check=True,
            )
            print("LOCAL-B2B-12 PASS: A before revoke 200; tenant B 403; revoked A catalog and checkout 403; DB order count unchanged", flush=True)
        finally:
            api.dispose()


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print("LOCAL-B2B-12 FAIL/BLOCKED: " + type(err).__name__, file=sys.stderr)
        raise SystemExit(1)
