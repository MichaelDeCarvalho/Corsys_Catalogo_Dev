#!/usr/bin/env bash
# Independent read-only PostgreSQL assertion after synthetic-quote browser E2E.
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != 'true' ||
      "${QA_CONFIRM_DISPOSABLE_STACK:-}" != 'yes' ||
      "${QA_ALLOW_SYNTHETIC_LOCAL_ORDER:-}" != 'yes' ||
      "${QA_SUPABASE_URL:-}" != 'http://127.0.0.1:54321' ||
      -n "${SUPABASE_ACCESS_TOKEN:-}" ||
      -n "${SUPABASE_PROJECT_ID:-}" ||
      -n "${SUPABASE_DB_PASSWORD:-}" ||
      -n "${DATABASE_URL:-}" ||
      -n "${PGHOST:-}" ||
      -n "${PGPASSWORD:-}" ]]; then
  echo 'BLOCKED: local synthetic isolated DB only' >&2
  exit 1
fi
[[ ! -e supabase/.temp/project-ref ]] || { echo 'BLOCKED: linked project'; exit 1; }
mapfile -t dbs < <(docker ps --format '{{.Names}}' | grep '^supabase_db_' || true)
[[ ${#dbs[@]} -eq 1 ]] || { echo 'BLOCKED: expected one synthetic local database'; exit 1; }
docker exec -i "${dbs[0]}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
DO $audit$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.orders;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FREIGHT-QA expected one and only one local order; found %', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.tenants t ON t.id = o.tenant_id
    WHERE t.slug = 'corsys-catalogo-demo'
      AND o.shopping_mode = 'retail'
      AND o.delivery_method = 'entrega'
      AND o.status = 'pending'
      AND o.subtotal = 30.00::numeric
      AND o.shipping_fee = 12.50::numeric
      AND o.total = 42.50::numeric
      AND o.discount = 0.00::numeric
      AND o.idempotency_key IS NOT NULL
      AND o.order_number IS NOT NULL
      AND jsonb_typeof(o.items) = 'array'
      AND jsonb_array_length(o.items) = 1
  ) THEN
    RAISE EXCEPTION 'FREIGHT-QA persisted subtotal/freight/total/tenant invalid';
  END IF;
  RAISE NOTICE 'FREIGHT-E2E DB PASS: one synthetic retail order, subtotal 30.00, shipping 12.50, total 42.50, correct tenant';
END
$audit$;
SQL
