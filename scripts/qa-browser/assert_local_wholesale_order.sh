#!/usr/bin/env bash
# Read-only audit of two synthetic checkouts in disposable local Supabase.
# Direct SQL is intentional: PostgREST orders SELECT is denied to service_role (42501).
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" ||
      "${QA_CONFIRM_DISPOSABLE_STACK:-}" != "yes" ||
      "${QA_ALLOW_SYNTHETIC_LOCAL_ORDER:-}" != "yes" ||
      "${QA_SUPABASE_URL:-}" != "http://127.0.0.1:54321" ||
      -n "${SUPABASE_ACCESS_TOKEN:-}" ||
      -n "${SUPABASE_PROJECT_ID:-}" ||
      -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
  echo 'BLOCKED: only unlinked disposable local QA is permitted' >&2
  exit 1
fi

mapfile -t dbs < <(docker ps --format '{{.Names}}' | grep '^supabase_db_' || true)
if [[ ${#dbs[@]} -ne 1 ]]; then
  echo 'BLOCKED: expected exactly one local Supabase DB container' >&2
  exit 1
fi

docker exec -i "${dbs[0]}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
DO $audit$
DECLARE
  v_total BIGINT;
  v_retail BIGINT;
  v_wholesale BIGINT;
  v_tenant_a UUID;
  v_tenant_b UUID;
BEGIN
  SELECT id INTO STRICT v_tenant_a
  FROM public.tenants WHERE slug = 'corsys-catalogo-demo';
  SELECT id INTO STRICT v_tenant_b
  FROM public.tenants WHERE slug = 'tenant-qa-b';
  IF v_tenant_a = v_tenant_b THEN
    RAISE EXCEPTION 'QA synthetic tenants must be distinct';
  END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE shopping_mode = 'retail'),
         COUNT(*) FILTER (WHERE shopping_mode = 'wholesale')
    INTO v_total, v_retail, v_wholesale
  FROM public.orders;

  IF v_total <> 2 OR v_retail <> 1 OR v_wholesale <> 1 THEN
    RAISE EXCEPTION 'QA expected exactly one retail and one wholesale order';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE tenant_id <> v_tenant_a OR status <> 'pending'
       OR order_number IS NULL OR order_number = ''
       OR total IS NULL OR total <= 0
       OR jsonb_typeof(items) IS DISTINCT FROM 'array'
       OR jsonb_array_length(items) = 0
  ) THEN
    RAISE EXCEPTION 'QA order status, tenant, identifier, items or total invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE tenant_id = v_tenant_a
      AND shopping_mode = 'retail'
      AND buyer_user_id IS NULL
      AND tracking_token_hash ~ '^[a-f0-9]{64}$'
  ) THEN
    RAISE EXCEPTION 'QA retail buyer or tracking hash invariant failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.wholesale_customers wc
      ON wc.user_id = o.buyer_user_id AND wc.tenant_id = o.tenant_id
    WHERE o.tenant_id = v_tenant_a
      AND o.shopping_mode = 'wholesale'
      AND o.total = 100
      AND wc.status = 'approved'
      AND o.buyer_user_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'QA wholesale buyer authorization or canonical amount invalid';
  END IF;

  IF EXISTS (SELECT 1 FROM public.orders WHERE tenant_id = v_tenant_b) THEN
    RAISE EXCEPTION 'QA tenant B has an unexpected order';
  END IF;

  -- B2B-06/07/13: configured notes are hidden, while the fictitious retail
  -- PJ company's required fields must survive server-side persistence.
  IF EXISTS (SELECT 1 FROM public.orders WHERE coalesce(notes,'') <> '') THEN
    RAISE EXCEPTION 'Hidden notes field leaked into persisted QA order';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE shopping_mode='retail'
      AND customer->>'type'='PJ'
      AND customer->>'companyName'='Empresa Fictícia QA'
      AND customer->>'email'='comprador@qa.invalid'
  ) THEN
    RAISE EXCEPTION 'QA required PJ fields not preserved in official persisted snapshot';
  END IF;

  RAISE NOTICE 'LOCAL-B2B DB PASS: one retail and one wholesale order; pending, tenant A, approved B2B buyer, canonical total, no tenant B orders';
END
$audit$;
SQL
