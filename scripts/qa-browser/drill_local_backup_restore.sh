#!/usr/bin/env bash
# Application/Auth-schema pg_dump/pg_restore rehearsal on disposable Supabase local only.
# Restore goes to a DIFFERENT temporary database in the same ephemeral
# container. Never modifies, deletes, exports or uploads the source database.
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
  echo 'BLOCKED: logical restore rehearsal requires isolated unlinked CI' >&2
  exit 1
fi

mapfile -t dbs < <(docker ps --format '{{.Names}}' | grep '^supabase_db_' || true)
if [[ ${#dbs[@]} -ne 1 ]]; then
  echo 'BLOCKED: exactly one disposable local PostgreSQL required' >&2
  exit 1
fi
db="${dbs[0]}"
clone='corsys_qa_restore_drill'
archive='/tmp/corsys_qa_restore_drill.dump'
created=0
cleanup() {
  if [[ "$created" == '1' ]]; then
    docker exec "$db" dropdb -U postgres --if-exists "$clone" >/dev/null 2>&1 || true
  fi
  docker exec "$db" rm -f "$archive" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Fail-closed on collision; never overwrite/delete an existing database.
if [[ -n "$(docker exec "$db" psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 \
  -c "SELECT 1 FROM pg_database WHERE datname='$clone'")" ]]; then
  echo 'BLOCKED: recovery database already exists; will not overwrite' >&2
  exit 1
fi

audit_sql=$(cat <<'SQL'
SELECT concat_ws('|',
 (SELECT count(*) FROM public.orders),
 (SELECT md5(string_agg(to_jsonb(o)::text, E'\n' ORDER BY o.id)) FROM public.orders o),
 (SELECT md5(string_agg(to_jsonb(w)::text, E'\n' ORDER BY w.user_id))
    FROM public.wholesale_customers w),
 (SELECT md5(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.tenant_id))
    FROM public.tenant_public_settings t),
 (SELECT md5(string_agg(to_jsonb(u)::text, E'\n' ORDER BY u.id))
    FROM auth.users u),
 (SELECT relrowsecurity::text FROM pg_class WHERE oid='public.orders'::regclass),
 (SELECT to_regprocedure(
   'public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)'
 ) IS NOT NULL)

);
SQL
)

source_audit=$(docker exec "$db" psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 -c "$audit_sql")
IFS='|' read -r source_n _ <<< "$source_audit"
if [[ "$source_n" != '4' ]]; then
  echo 'BLOCKED: expected exactly four synthetic checkout orders before backup' >&2
  exit 1
fi
# The clone deliberately omits owners/grants because this temporary
# Supabase PG cluster has no ability to SET ROLE supabase_admin. Independently
# require source RLS and wrapper; hosted ACL recovery remains NOT EVALUATED.
if [[ "$source_audit" != *'|true|t' ]]; then
  echo 'BLOCKED: checkout RLS/source RPC structure unexpectedly changed' >&2
  exit 1
fi
source_grants=$(docker exec "$db" psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 -c "
  SELECT
    has_function_privilege('anon',
      'public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)',
      'EXECUTE')::text || '|' ||
    has_function_privilege('authenticated',
      'public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)',
      'EXECUTE')::text || '|' ||
    has_function_privilege('service_role',
      'public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)',
      'EXECUTE')::text")
if [[ "$source_grants" != 'false|false|true' ]]; then
  echo 'BLOCKED: source RPC ACL is not least privilege' >&2
  exit 1
fi

# Keep the dump INSIDE the ephemeral container; never export it as CI artifact
# or print sensitive SQL/rows. Fail hard on any restore error.
# Limit the rehearsal to data-bearing application/Auth schemas. A raw Supabase
# full dump also contains Realtime and privileged control-plane functions
# (e.g. log_min_messages) that are not portable to a non-superuser test DB.
# This is NOT a full-platform recovery drill.
docker exec "$db" pg_dump -U postgres -d postgres -Fc \
  --schema=public --schema=private --schema=auth --schema=extensions \
  -f "$archive"
docker exec "$db" pg_restore -l "$archive" >/dev/null
docker exec "$db" createdb -U postgres -T template0 "$clone"
created=1
# template0 already contains the default public namespace; remove it ONLY in
# the newly created recovery database. pg_restore --clean is not suitable for
# an empty clone with policies (DROP POLICY requires the table to exist).
docker exec "$db" psql -U postgres -d "$clone" -v ON_ERROR_STOP=1 \
  -q -c 'DROP SCHEMA IF EXISTS public CASCADE' >/dev/null
docker exec "$db" pg_restore -U postgres -d "$clone" \
  --no-owner --no-acl --exit-on-error --single-transaction "$archive" >/dev/null

restored_audit=$(docker exec "$db" psql -U postgres -d "$clone" -Atq -v ON_ERROR_STOP=1 -c "$audit_sql")
if [[ "$source_audit" != "$restored_audit" ]]; then
  echo 'FAIL: recovered synthetic tenant/order/auth data, RLS or wrapper presence differs' >&2
  exit 1
fi

# Positive evidence for the copy, negative evidence for original preservation.
source_after=$(docker exec "$db" psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 -c "$audit_sql")
if [[ "$source_audit" != "$source_after" ]]; then
  echo 'FAIL: backup/restore rehearsal unexpectedly modified original QA database' >&2
  exit 1
fi
echo 'LOCAL-RESTORE PASS: isolated public/private/auth/extension schemas: 4 synthetic orders, Auth/tenant hashes, RLS; source preserved. Realtime/Storage data, ownership/ACL, backup history and Hosted restore NOT VERIFIED'
