-- =========================================================================
-- CORSYS CATÁLOGO B2B / B2C - MIGRATION 000012: PRIVATE ORDER DOCUMENTS STORAGE
-- Arquivo: supabase/migrations/20260930_000012_order_documents_storage.sql
-- Responsabilidade da Arquitetura:
--   - Provisionamento e configuração do bucket privado 'order-documents'
--     (public = false, limite 5MiB, MIME restrito exclusivamente a application/pdf).
--   - Políticas de autorização (RLS) em storage.objects com menor privilégio
--     e isolamento multi-tenant por UUID.
-- Princípio de Menor Privilégio e Proteção de PII:
--   - BUCKET PRIVADO (public = false): contém PII de clientes e dados comerciais de pedidos.
--   - ZERO CLIENT POLICIES: Nenhuma policy de SELECT/INSERT/UPDATE/DELETE em storage.objects
--     para anon, authenticated, tenant_admin ou platform_admin.
--   - O browser NÃO acessa diretamente storage.objects para este bucket.
--   - Gravação e geração de signed URLs ocorrem EXCLUSIVAMENTE server-side
--     via Supabase Edge Function com service_role (SUPABASE_SECRET_KEYS).
--   - Path canônico obrigatório e determinístico:
--     <tenant_uuid>/orders/<order_uuid>/pedido-<order_number>.pdf
-- =========================================================================

BEGIN;

-- 1. Provisionamento defensivo do bucket privado 'order-documents'
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('order-documents', 'order-documents', false, 5242880, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['application/pdf'];

-- 2. Limpeza defensiva de policies anteriores com o mesmo nome
DROP POLICY IF EXISTS "order_documents_select_public" ON storage.objects;
DROP POLICY IF EXISTS "order_documents_select_tenant_admin" ON storage.objects;
DROP POLICY IF EXISTS "order_documents_insert_tenant_admin" ON storage.objects;
DROP POLICY IF EXISTS "order_documents_update_tenant_admin" ON storage.objects;
DROP POLICY IF EXISTS "order_documents_delete_tenant_admin" ON storage.objects;

-- 3. Políticas em storage.objects: ZERO CLIENT POLICIES
-- O bucket 'order-documents' é estritamente server-managed nesta versão.
-- NENHUMA policy de SELECT, INSERT, UPDATE ou DELETE para anon, authenticated,
-- tenant_admin ou platform_admin.
-- Gravação e geração de signed URLs ocorrem EXCLUSIVAMENTE server-side
-- via Supabase Edge Function com service_role (SUPABASE_SECRET_KEYS).
-- O browser NÃO acessa diretamente storage.objects para este bucket.

COMMIT;
