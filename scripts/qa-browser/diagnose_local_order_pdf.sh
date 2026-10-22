#!/usr/bin/env bash
# Read-only private-PDF diagnostics restricted to the disposable local CI stack.
# Intentionally output only fixed labels, counts, and pass/fail (no paths, tokens or PII).
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != "true" ||
      "${QA_CONFIRM_DISPOSABLE_STACK:-}" != "yes" ||
      "${QA_SUPABASE_URL:-}" != "http://127.0.0.1:54321" ||
      -n "${SUPABASE_ACCESS_TOKEN:-}" ||
      -n "${SUPABASE_PROJECT_ID:-}" ||
      -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
  echo 'BLOCKED: private PDF diagnostics require unlinked local CI' >&2
  exit 1
fi
mapfile -t dbs < <(docker ps --format '{{.Names}}' | grep '^supabase_db_' || true)
mapfile -t edges < <(docker ps --format '{{.Names}}' | grep '^supabase_edge_runtime_' || true)
if [[ ${#dbs[@]} -ne 1 || ${#edges[@]} -ne 1 ]]; then
  echo 'BLOCKED: expected exactly one local database and Edge Runtime container' >&2
  exit 1
fi
data="$(docker exec "${dbs[0]}" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c "
  SELECT
    (SELECT CASE WHEN count(*) = 1 AND bool_and(public = false) THEN 'private' ELSE 'unsafe' END
       FROM storage.buckets WHERE id='order-documents') ||
    '|' ||
    (SELECT count(*)::text FROM storage.objects WHERE bucket_id='order-documents');
")"
IFS='|' read -r privacy objects <<< "$data"
if [[ "$privacy" != "private" || ! "$objects" =~ ^[0-9]+$ ]]; then
  echo 'LOCAL-PDF FAIL: order-documents bucket must be private' >&2
  exit 1
fi
echo "LOCAL-PDF DIAG bucket_private=true persisted_document_objects=$objects"
# Never output raw logs: these counts contain no signed URLs, access keys or PII.
log="$(docker logs "${edges[0]}" 2>&1 || true)"
count_fixed() { printf '%s\n' "$log" | grep -F -c "$1" || true; }
echo "LOCAL-PDF DIAG pdf_generation_errors=$(count_fixed 'Falha na geração do documento PDF do pedido.')"
echo "LOCAL-PDF DIAG pdf_upload_errors=$(count_fixed 'Falha no upload do documento de pedido no Storage.')"
echo "LOCAL-PDF DIAG pdf_signature_errors=$(count_fixed 'Falha na assinatura da URL do documento de pedido.')"
