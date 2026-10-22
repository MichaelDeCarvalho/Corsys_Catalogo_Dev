#!/usr/bin/env bash
# Independent, read-only verification of the deliberately delayed checkout.
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != "true" ||
      "${QA_CONFIRM_DISPOSABLE_STACK:-}" != "yes" ||
      "${QA_ALLOW_SYNTHETIC_LOCAL_ORDER:-}" != "yes" ||
      "${QA_SUPABASE_URL:-}" != "http://127.0.0.1:54321" ||
      -n "${SUPABASE_ACCESS_TOKEN:-}" ||
      -n "${SUPABASE_PROJECT_ID:-}" ||
      -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
  echo 'BLOCKED: only unlinked disposable local checkout race QA is permitted' >&2
  exit 1
fi
mapfile -t dbs < <(docker ps --format '{{.Names}}' | grep '^supabase_db_' || true)
if [[ ${#dbs[@]} -ne 1 ]]; then
  echo 'BLOCKED: exactly one disposable local database is required' >&2
  exit 1
fi
docker exec -i "${dbs[0]}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
DO $audit$
DECLARE v_tenant_a UUID;
BEGIN
  SELECT id INTO STRICT v_tenant_a
  FROM public.tenants WHERE slug = 'corsys-catalogo-demo';
  IF (SELECT count(*) FROM public.orders) <> 3 OR
     (SELECT count(*) FROM public.orders WHERE shopping_mode = 'retail') <> 1 OR
     (SELECT count(*) FROM public.orders WHERE shopping_mode = 'wholesale') <> 2 THEN
    RAISE EXCEPTION 'QA race must commit exactly one additional B2B order';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE tenant_id <> v_tenant_a OR status <> 'pending'
  ) THEN
    RAISE EXCEPTION 'QA checkout race crossed tenant or status boundary';
  END IF;
  IF (
    SELECT count(*)
    FROM public.orders o
    JOIN public.wholesale_customers w
      ON w.tenant_id = o.tenant_id AND w.user_id = o.buyer_user_id
    WHERE o.shopping_mode = 'wholesale'
      AND o.total = 100
      AND w.status = 'approved'
  ) <> 2 THEN
    RAISE EXCEPTION 'QA race B2B order buyer binding or total incorrect';
  END IF;
  IF to_regprocedure('private.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)') IS NULL
    OR has_function_privilege(
      'service_role',
      'private.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'QA legacy checkout implementation must be inaccessible to service_role';
  END IF;
  IF NOT has_function_privilege(
    'service_role',
    'public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'QA checkout wrapper API grants are not least privilege';
  END IF;
  RAISE NOTICE 'LOCAL-RACE DB PASS: one retail + two wholesale local orders, authorized buyer, canonical totals and no tenant B orders';
END
$audit$;
SQL
