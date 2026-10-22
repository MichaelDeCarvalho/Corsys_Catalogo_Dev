#!/usr/bin/env python3
"""Prepare an unlinked, disposable CI Supabase stack with synthetic data only.

This changes CI runner files, never Git history or a hosted database.
"""
import os
from pathlib import Path

if os.getenv("GITHUB_ACTIONS") != "true" or os.getenv("QA_CONFIRM_DISPOSABLE_STACK") != "yes":
    raise SystemExit("BLOCKED: disposable CI confirmation missing")
if any(os.getenv(k) for k in ("SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_ID", "SUPABASE_DB_PASSWORD")):
    raise SystemExit("BLOCKED: hosted Supabase credential present")
root = Path("supabase")
if not root.is_dir() or (root / ".temp" / "project-ref").exists():
    raise SystemExit("BLOCKED: project missing or linked to Hosted")
catalog = root / "migrations/20260903_000002_import_official_catalog.sql"
settings = root / "migrations/20260904_000003_public_catalog_settings.sql"
if not catalog.exists() or not settings.exists():
    raise SystemExit("BLOCKED: expected migration files absent")
original = catalog.read_text()
if "Esperado 520 inserções" not in original or "staging_official_catalog" not in original:
    raise SystemExit("BLOCKED: original official import structure changed")
catalog.write_text("""-- Synthetic CI overlay, replacing the private/official product import.
BEGIN;
INSERT INTO public.tenants (slug,name,owner_email,status)
VALUES ('corsys-catalogo-demo','Loja Oficial QA','owner@qa.invalid','active'),
       ('tenant-qa-b','Loja B QA','owner-b@qa.invalid','active');
INSERT INTO public.products (tenant_id,sku,name,category,cost_price,price,wholesale_price,stock,unit,brand)
SELECT id,'QA-A','QA-Produto Fictício','QA',10,30,20,500,'un',NULL
FROM public.tenants WHERE slug='corsys-catalogo-demo';
INSERT INTO public.products (tenant_id,sku,name,category,cost_price,price,wholesale_price,stock,unit,brand)
SELECT id,'QA-B','QA-Produto Fictício B','QA',10,35,22,500,'un',NULL
FROM public.tenants WHERE slug='tenant-qa-b';
COMMIT;
""")
s = settings.read_text()
for before, after in (
    ("'Corsys.Catálogo'", "'Loja Oficial QA'"),
    ("'+5541992928033'", "'+5500000000000'"),
    ("        400.00,", "        0.00,"),
    ("        1000.00,", "        100.00,"),
):
    if before not in s:
        raise SystemExit("BLOCKED: expected public settings data changed")
    s = s.replace(before, after)
settings.write_text(s)
# Extra synthetic seed is applied after all business migrations, only in disposable CI.
qa_seed = root / "migrations/20261010150000_ci_only_synthetic_fixtures.sql"
if qa_seed.exists():
    raise SystemExit("BLOCKED: synthetic fixture migration unexpectedly exists")
qa_seed.write_text("""-- Disposable local CI fixture, never part of version-controlled migrations.
BEGIN;
INSERT INTO public.tenant_public_settings
  (tenant_id, slug, public_name, whatsapp_number, min_order_value,
   wholesale_min_order_value, allow_b2b_mode, delivery_methods)
SELECT id, slug, 'Loja B QA', '+5500000000000', 0, 100, true,
       '["retirada","entrega"]'::jsonb
FROM public.tenants WHERE slug='tenant-qa-b';
UPDATE public.tenant_public_settings
SET min_order_value=0, wholesale_min_order_value=100, whatsapp_number='+5500000000000',
    delivery_methods='["retirada","entrega"]'::jsonb
WHERE slug='corsys-catalogo-demo';
UPDATE public.products SET wholesale_enabled=true, wholesale_min_quantity=5
WHERE sku IN ('QA-A','QA-B');
-- In the disposable runner, exercise required, visible and hidden field policies.
UPDATE public.tenant_public_settings
SET checkout_fields = checkout_fields || '{
 "email":{"visible":true,"required":true},
 "city":{"visible":true,"required":true},
 "companyName":{"visible":true,"required":true},
 "notes":{"visible":false,"required":false}
}'::jsonb
WHERE slug='corsys-catalogo-demo';
INSERT INTO public.tenant_delivery_settings (tenant_id)
SELECT id FROM public.tenants WHERE slug='tenant-qa-b';
COMMIT;
""")
for path in root.glob("migrations/*google_routes*.sql"):
    path.rename(path.with_suffix(".ci-disabled"))
print("CI stack prepared: fictitious tenants/products, Google migrations excluded, no remote link")
