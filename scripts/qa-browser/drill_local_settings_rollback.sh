#!/usr/bin/env bash
# Disposable local transaction rollback exercise, NOT a production restore drill.
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != "true" ||
      "${QA_CONFIRM_DISPOSABLE_STACK:-}" != "yes" ||
      "${QA_SUPABASE_URL:-}" != "http://127.0.0.1:54321" ||
      -n "${SUPABASE_ACCESS_TOKEN:-}" ||
      -n "${SUPABASE_PROJECT_ID:-}" ||
      -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
  echo 'BLOCKED: rollback exercise requires local unlinked CI' >&2
  exit 1
fi
mapfile -t dbs < <(docker ps --format '{{.Names}}' | grep '^supabase_db_' || true)
if [[ ${#dbs[@]} -ne 1 ]]; then
  echo 'BLOCKED: exactly one local Postgres required' >&2
  exit 1
fi
docker exec -i "${dbs[0]}" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DO $qa$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.tenant_public_settings
    WHERE slug='corsys-catalogo-demo' AND wholesale_min_order_value=100) THEN
    RAISE EXCEPTION 'Baseline value differs from expected synthetic fixture';
 END IF;
END $qa$;
UPDATE public.tenant_public_settings SET wholesale_min_order_value=120
WHERE slug='corsys-catalogo-demo' AND wholesale_min_order_value=100;
DO $qa$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.tenant_public_settings
    WHERE slug='corsys-catalogo-demo' AND wholesale_min_order_value=120) THEN
    RAISE EXCEPTION 'Test mutation did not take effect';
 END IF;
END $qa$;
ROLLBACK;
DO $qa$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.tenant_public_settings
    WHERE slug='corsys-catalogo-demo' AND wholesale_min_order_value=100) THEN
   RAISE EXCEPTION 'Rollback did not restore local setting';
 END IF;
 IF (SELECT count(*) FROM public.orders) <> 4 THEN
   RAISE EXCEPTION 'Rollback drill affected synthetic orders';
 END IF;
 RAISE NOTICE 'LOCAL-ROLLBACK PASS: local transaction rolled back; original setting and 4 synthetic orders preserved';
END $qa$;
SQL
