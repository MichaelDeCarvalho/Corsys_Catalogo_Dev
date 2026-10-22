#!/usr/bin/env bash
# Independent read-only PF persistence audit, after all prior order assertions.
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != "true" ||
      "${QA_CONFIRM_DISPOSABLE_STACK:-}" != "yes" ||
      "${QA_ALLOW_SYNTHETIC_LOCAL_ORDER:-}" != "yes" ||
      "${QA_SUPABASE_URL:-}" != "http://127.0.0.1:54321" ||
      -n "${SUPABASE_ACCESS_TOKEN:-}" ||
      -n "${SUPABASE_PROJECT_ID:-}" ||
      -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
  echo 'BLOCKED: PF audit allowed only on local synthetic CI' >&2
  exit 1
fi
mapfile -t dbs < <(docker ps --format '{{.Names}}' | grep '^supabase_db_' || true)
if [[ ${#dbs[@]} -ne 1 ]]; then
  echo 'BLOCKED: expected exactly one local Postgres' >&2
  exit 1
fi
docker exec -i "${dbs[0]}" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<'SQL'
DO $qa$
DECLARE tenant_a uuid;
BEGIN
 SELECT id INTO STRICT tenant_a FROM public.tenants WHERE slug='corsys-catalogo-demo';
 IF (SELECT count(*) FROM public.orders) <> 4
    OR (SELECT count(*) FROM public.orders WHERE shopping_mode='wholesale') <> 2
    OR (SELECT count(*) FROM public.orders WHERE shopping_mode='retail') <> 2
    OR EXISTS (SELECT 1 FROM public.orders WHERE tenant_id<>tenant_a) THEN
   RAISE EXCEPTION 'PF QA unexpected order count or tenant binding';
 END IF;
 IF (SELECT count(*) FROM public.orders WHERE
       shopping_mode='retail'
       AND buyer_user_id IS NULL
       AND customer->>'type'='PF'
       AND customer->>'document'='52998224725'
       AND customer->>'email'='pf@qa.invalid'
       AND coalesce(customer->>'companyName','')=''
       AND coalesce(notes,'')=''
       AND status='pending'
       AND tracking_token_hash IS NOT NULL
       AND length(tracking_token_hash)=64) <> 1 THEN
   RAISE EXCEPTION 'PF QA canonical snapshot, token hash or hidden fields mismatch';
 END IF;
 RAISE NOTICE 'LOCAL-PF DB PASS: 4 synthetic orders; PF snapshot, hidden fields, token and tenant isolation valid';
END $qa$;
SQL
