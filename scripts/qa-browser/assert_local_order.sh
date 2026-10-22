#!/usr/bin/env bash
# Independent read-only Postgres audit for a disposable local Supabase checkout.
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
DECLARE actual_count bigint;
BEGIN
  SELECT count(*) INTO actual_count FROM public.orders;
  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'QA expected exactly one persisted fictitious order';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.tenants t ON t.id=o.tenant_id
    WHERE t.slug='corsys-catalogo-demo'
      AND o.shopping_mode='retail'
      AND o.status='pending'
      AND o.order_number IS NOT NULL
      AND o.total > 0
      AND o.tracking_token_hash ~ '^[a-f0-9]{64}$'
      AND jsonb_typeof(o.items) = 'array'
      AND jsonb_array_length(o.items) > 0
  ) THEN
    RAISE EXCEPTION 'QA fictitious order identity, tracking or totals invalid';
  END IF;
  RAISE NOTICE 'LOCAL-ORDER DB PASS: one fictitious order, correct tenant, items, mode and tracking hash';
END
$audit$;
SQL
