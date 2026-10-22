#!/usr/bin/env bash
# Disposable CI-only: real PostgreSQL sequential 000023 + 000024 in a synthetic restored DB.
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != true || "${QA_CONFIRM_DISPOSABLE_STACK:-}" != yes ||
      -n "${SUPABASE_ACCESS_TOKEN:-}" || -n "${SUPABASE_PROJECT_ID:-}" ||
      -n "${SUPABASE_DB_PASSWORD:-}" || -n "${DATABASE_URL:-}" ||
      -n "${PGHOST:-}" || -n "${PGPASSWORD:-}" ]]; then
  echo 'BLOCKED: disposable unlinked CI staging only' >&2; exit 1
fi
[[ ! -e supabase/.temp/project-ref ]] || { echo 'BLOCKED: Supabase project linked'; exit 1; }

mapfile -t dbs < <(docker ps --format '{{.Names}}' | grep '^supabase_db_' || true)
[[ ${#dbs[@]} -eq 1 ]] || { echo 'BLOCKED: only one local database permitted'; exit 1; }
db="${dbs[0]}"
stage='corsys_stage_000023_000024'
dump='/tmp/corsys_000023_000024_pre.dump'
p23='supabase/migrations/20261016000000_000023_checkout_idempotency_buyer_guard.sql'
p24='supabase/migrations/20261022000000_000024_checkout_shipping_fee_support.sql'
qa_path='supabase/tests/database/07_checkout_shipping_000024_isolated.sql'
for file in "$p23" "$p24" "$qa_path"; do
  [[ -s "$file" ]] || { echo "BLOCKED: required test file missing: $file"; exit 1; }
done
exists=$(docker exec "$db" psql -U postgres -d postgres -Atqc "SELECT count(*) FROM pg_database WHERE datname='$stage'")
[[ "$exists" == 0 ]] || { echo 'BLOCKED: staging database already exists'; exit 1; }

cleanup() {
  docker exec "$db" dropdb -U postgres --if-exists "$stage" >/dev/null 2>&1 || true
  docker exec "$db" rm -f "$dump" /tmp/corsys_000023.sql /tmp/corsys_000024.sql /tmp/corsys_checkout_qa.sql >/dev/null 2>&1 || true
}
trap cleanup EXIT

base_sql="SELECT
  to_regprocedure('public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)') IS NOT NULL,
  to_regprocedure('private.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)') IS NULL,
  to_regprocedure('public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,numeric,text,text,uuid)') IS NULL,
  (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20261016000000','20261022000000')) = 0"
before=$(docker exec "$db" psql -U postgres -d postgres -Atq -F '|' -c "$base_sql")
[[ "$before" == 't|t|t|t' ]] || { echo "BLOCKED: source must be before both migrations: $before"; exit 1; }

digest_sql="SELECT concat_ws('|',
  (SELECT count(*) FROM public.tenants),
  (SELECT count(*) FROM public.products),
  (SELECT count(*) FROM public.orders),
  (SELECT md5(string_agg(to_jsonb(t)::text,E'\n' ORDER BY t.id)) FROM public.tenants t),
  (SELECT md5(string_agg(to_jsonb(p)::text,E'\n' ORDER BY p.id)) FROM public.products p),
  (SELECT md5(string_agg(to_jsonb(u)::text,E'\n' ORDER BY u.id)) FROM auth.users u),
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.orders'::regclass)
)"
source_before=$(docker exec "$db" psql -U postgres -d postgres -Atq -c "$digest_sql")
docker exec "$db" pg_dump -U postgres -d postgres -Fc -f "$dump" \
  --schema=public --schema=private --schema=auth --schema=extensions
docker exec "$db" createdb -U postgres -T template0 "$stage"
docker exec "$db" psql -U postgres -d "$stage" -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA IF EXISTS public CASCADE' >/dev/null
docker exec "$db" pg_restore -U postgres -d "$stage" --no-owner --no-acl \
  --exit-on-error --single-transaction "$dump" >/dev/null
restored=$(docker exec "$db" psql -U postgres -d "$stage" -Atq -c "$digest_sql")
[[ "$restored" == "$source_before" ]] || { echo 'FAIL: synthetic restored DB differs from source'; exit 1; }

docker cp "$p23" "$db:/tmp/corsys_000023.sql"
docker cp "$p24" "$db:/tmp/corsys_000024.sql"
docker cp "$qa_path" "$db:/tmp/corsys_checkout_qa.sql"
docker exec "$db" psql -U postgres -d "$stage" -X -v ON_ERROR_STOP=1 -q -f /tmp/corsys_000023.sql >/dev/null
docker exec "$db" psql -U postgres -d "$stage" -X -v ON_ERROR_STOP=1 -q -f /tmp/corsys_000024.sql >/dev/null
after_ddl=$(docker exec "$db" psql -U postgres -d "$stage" -Atq -c "$digest_sql")
[[ "$after_ddl" == "$source_before" ]] || { echo 'FAIL: migrations changed original business rows'; exit 1; }

docker exec "$db" psql -U postgres -d "$stage" -X -v ON_ERROR_STOP=1 -q -f /tmp/corsys_checkout_qa.sql
source_after=$(docker exec "$db" psql -U postgres -d postgres -Atq -c "$digest_sql")
[[ "$source_after" == "$source_before" ]] || { echo 'FAIL: source local DB modified by staging tests'; exit 1; }
source_migration_state=$(docker exec "$db" psql -U postgres -d postgres -Atq -F '|' -c "$base_sql")
[[ "$source_migration_state" == 't|t|t|t' ]] || { echo 'FAIL: source migration state unexpectedly changed'; exit 1; }
echo 'STAGING-000023-000024 PASS: isolated synthetic restore, ordered DDL, checkout integration, no source mutations'
echo 'NOT EVALUATED: Hosted recovery/ownership, physical Storage, Edge E2E and paid Google'
