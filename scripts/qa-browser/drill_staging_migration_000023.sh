#!/usr/bin/env bash
# Disposable staging-only backup/restore + forward migration 000023 rehearsal.
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != true || "${QA_CONFIRM_DISPOSABLE_STACK:-}" != yes ||
      -n "${SUPABASE_ACCESS_TOKEN:-}" || -n "${SUPABASE_PROJECT_ID:-}" ||
      -n "${SUPABASE_DB_PASSWORD:-}" || -n "${DATABASE_URL:-}" ||
      -n "${PGHOST:-}" || -n "${PGPASSWORD:-}" ]]; then
  echo 'BLOCKED: disposable CI staging only' >&2; exit 1
fi
mapfile -t dbs < <(docker ps --format '{{.Names}}' | grep '^supabase_db_' || true)
[[ ${#dbs[@]} -eq 1 ]] || { echo 'BLOCKED: one local Supabase database required'; exit 1; }
db="${dbs[0]}"
staging='corsys_stage_000023'
dump='/tmp/corsys_stage_before_000023.dump'
local_sql='/tmp/corsys_stage_000023.sql'
cleanup() {
  docker exec "$db" dropdb -U postgres --if-exists "$staging" >/dev/null 2>&1 || true
  docker exec "$db" rm -f "$dump" "$local_sql" >/dev/null 2>&1 || true
}
# Collision is fatal; never erase an existing staging DB.
docker exec "$db" psql -U postgres -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname='$staging'" | grep -q 1 && {
  echo 'BLOCKED: staging database already exists'; exit 1;
}
trap cleanup EXIT
if [[ ! -s supabase/migrations/20261016000000_000023_checkout_idempotency_buyer_guard.sql ]]; then
  echo 'BLOCKED: versioned 000023 migration missing'; exit 1
fi
# Assert source is at pre-000023 state, even though original schema has 000019/000020.
base_sql="SELECT
  to_regprocedure('public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)') IS NOT NULL,
  to_regprocedure('private.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)') IS NULL,
  (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261016000000')=0"
actual=$(docker exec "$db" psql -U postgres -d postgres -Atq -F '|' -c "$base_sql")
[[ "$actual" == 't|t|t' ]] || { echo "BLOCKED: source must be pre-000023"; exit 1; }
# Snapshot synthetic staging data only; never export a Hosted dump or an artifact.
docker exec "$db" pg_dump -U postgres -d postgres -Fc -f "$dump" --schema=public --schema=private --schema=auth --schema=extensions
docker exec "$db" createdb -U postgres -T template0 "$staging"
docker exec "$db" psql -U postgres -d "$staging" -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA IF EXISTS public CASCADE'
docker exec "$db" pg_restore -U postgres -d "$staging" --no-owner --no-acl --exit-on-error --single-transaction "$dump" >/dev/null
check_sql=$(cat <<'SQL'
SELECT concat_ws('|',
  (SELECT count(*) FROM public.tenants),
  (SELECT count(*) FROM public.products),
  (SELECT count(*) FROM public.orders),
  (SELECT md5(string_agg(to_jsonb(t)::text,E'\n' ORDER BY t.id)) FROM public.tenants t),
  (SELECT md5(string_agg(to_jsonb(p)::text,E'\n' ORDER BY p.id)) FROM public.products p),
  (SELECT md5(string_agg(to_jsonb(u)::text,E'\n' ORDER BY u.id)) FROM auth.users u),
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.orders'::regclass)
)
SQL
)
source=$(docker exec "$db" psql -U postgres -d postgres -Atq -c "$check_sql")
restored=$(docker exec "$db" psql -U postgres -d "$staging" -Atq -c "$check_sql")
[[ "$source" == "$restored" ]] || { echo 'FAIL: staging restore data/RLS differs'; exit 1; }
# Restore grants are excluded, so independently reproduce the expected least-privilege
# wrapper ACL. Do not interpret this as a full platform/Hosted restore.
docker cp supabase/migrations/20261016000000_000023_checkout_idempotency_buyer_guard.sql "$db:$local_sql"
docker exec "$db" psql -U postgres -d "$staging" -v ON_ERROR_STOP=1 -f "$local_sql" >/dev/null
post_sql="SELECT
 to_regprocedure('public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)') IS NOT NULL,
 to_regprocedure('private.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)') IS NOT NULL,
 has_function_privilege('anon','public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)','EXECUTE'),
 has_function_privilege('authenticated','public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)','EXECUTE'),
 has_function_privilege('service_role','public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)','EXECUTE'),
 has_function_privilege('service_role','private.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)','EXECUTE')"
# Explicitly verify source remains untouched and staging has expected function shape.
after=$(docker exec "$db" psql -U postgres -d "$staging" -Atq -F '|' -c "$post_sql")
[[ "$after" == 't|t|f|f|t|f' ]] || { echo "FAIL: staging RPC privileges unexpected"; exit 1; }
staging_data=$(docker exec "$db" psql -U postgres -d "$staging" -Atq -c "$check_sql")
[[ "$source" == "$staging_data" ]] || { echo "FAIL: applying 000023 modified business data"; exit 1; }
source_after=$(docker exec "$db" psql -U postgres -d postgres -Atq -c "$check_sql")
[[ "$source_after" == "$source" ]] || { echo "FAIL: original local QA source mutated"; exit 1; }
still_before=$(docker exec "$db" psql -U postgres -d postgres -Atq -F '|' -c "$base_sql")
[[ "$still_before" == 't|t|t' ]] || { echo 'FAIL: source migration state changed'; exit 1; }
echo 'STAGING-000023 PASS: synthetic logical recovery, selective migration, wrapper ACL, data digests, source isolation'
echo 'NOT EVALUATED: full ownership/ACL restore, Storage objects, Realtime, PITR, Hosted recovery, RTO/RPO'
