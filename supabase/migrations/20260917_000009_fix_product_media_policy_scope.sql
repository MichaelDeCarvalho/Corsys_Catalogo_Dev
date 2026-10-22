-- =========================================================================
-- CORSYS CATÁLOGO B2B / B2C - MIGRATION 000009: FIX PRODUCT MEDIA POLICY SCOPE
-- Arquivo: supabase/migrations/20260917_000009_fix_product_media_policy_scope.sql
-- Motivo / Forward-Fix:
--   - Na migration 000008, a cláusula EXISTS referenciava foldername sem qualificação de tabela.
--   - Devido ao subquery 'FROM public.products p', o identificador 'name' sofreu
--     shadowing no parser PostgreSQL, sendo resolvido como 'p.name' (coluna de
--     public.products) em vez de 'storage.objects.name'.
--   - Esta migration recria as 3 policies de 'product-media' qualificando
--     explicitamente a linha externa como 'storage.objects.name', eliminando
--     a ambiguidade e garantindo a validação server-side de posse do produto.
-- Princípio de Menor Privilégio & Isolamento:
--   - Preserva rigorosamente as permissões de 000008 (SELECT, INSERT, DELETE).
--   - Sem policy de UPDATE (uploads versionados com upsert = false).
--   - Sem SELECT público em storage.objects (storefront consome CDN do bucket público).
--   - Sem DML em storage.buckets e sem ALTER TABLE em storage.objects.
-- =========================================================================

BEGIN;

-- 1. Remoção das policies anteriores de product_media para recriação com escopo qualificado
DROP POLICY IF EXISTS "product_media_select_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "product_media_insert_tenant_admin" ON storage.objects;
DROP POLICY IF EXISTS "product_media_delete_tenant_admin" ON storage.objects;

-- 2. Policy SELECT: Apenas autenticado no diretório do próprio tenant sob /products/<product_id> ou platform_admin
CREATE POLICY "product_media_select_authenticated"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'product-media'
    AND (storage.foldername(storage.objects.name))[2] = 'products'
    AND EXISTS (
        SELECT 1
        FROM public.products p
        WHERE p.id::text = (storage.foldername(storage.objects.name))[3]
          AND p.tenant_id::text = (storage.foldername(storage.objects.name))[1]
    )
    AND (
        (
            (storage.foldername(storage.objects.name))[1] = (SELECT private.get_current_tenant_id())::text
            AND (SELECT private.has_tenant_role(ARRAY['tenant_admin']))
        )
        OR (SELECT private.is_platform_admin())
    )
);

-- 3. Policy INSERT: Apenas tenant_admin gravando no namespace <tenant_uuid>/products/<product_uuid>/ do próprio tenant ou platform_admin
CREATE POLICY "product_media_insert_tenant_admin"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'product-media'
    AND (storage.foldername(storage.objects.name))[2] = 'products'
    AND EXISTS (
        SELECT 1
        FROM public.products p
        WHERE p.id::text = (storage.foldername(storage.objects.name))[3]
          AND p.tenant_id::text = (storage.foldername(storage.objects.name))[1]
    )
    AND (
        (
            (storage.foldername(storage.objects.name))[1] = (SELECT private.get_current_tenant_id())::text
            AND (SELECT private.has_tenant_role(ARRAY['tenant_admin']))
        )
        OR (SELECT private.is_platform_admin())
    )
);

-- 4. Policy UPDATE: NÃO CONCEDIDA
-- A aplicação utiliza versionamento de arquivos com identificador único/timestamp e upsert: false.
-- Nenhuma operação de UPDATE em storage.objects é necessária, atendendo ao menor privilégio.

-- 5. Policy DELETE: Apenas tenant_admin removendo mídias do namespace do seu próprio tenant ou platform_admin
CREATE POLICY "product_media_delete_tenant_admin"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'product-media'
    AND (storage.foldername(storage.objects.name))[2] = 'products'
    AND EXISTS (
        SELECT 1
        FROM public.products p
        WHERE p.id::text = (storage.foldername(storage.objects.name))[3]
          AND p.tenant_id::text = (storage.foldername(storage.objects.name))[1]
    )
    AND (
        (
            (storage.foldername(storage.objects.name))[1] = (SELECT private.get_current_tenant_id())::text
            AND (SELECT private.has_tenant_role(ARRAY['tenant_admin']))
        )
        OR (SELECT private.is_platform_admin())
    )
);

COMMIT;
