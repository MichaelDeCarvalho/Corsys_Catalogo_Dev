-- =========================================================================
-- CORSYS CATÁLOGO B2B / B2C - MIGRATION 000006: STORAGE POLICIES (BRANDING)
-- Arquivo: supabase/migrations/20260909_000006_branding_storage.sql
-- Responsabilidade da Arquitetura:
--   - config.toml: Provisionamento e configuração do bucket 'tenant-assets'
--     (public = true, limite 5MiB, MIME restrito a image/png, image/jpeg, image/webp).
--   - 000006: Políticas de autorização (RLS) em storage.objects com menor privilégio
--     e isolamento multi-tenant por UUID.
-- Princípio de Menor Privilégio:
--   - Leitura pública via CDN pública do bucket (storefront).
--   - NENHUMA policy de SELECT público em storage.objects (impede enumeração de arquivos).
--   - SELECT autenticado restrito ao diretório do próprio tenant (UUID) ou platform_admin (exigido por storage.remove).
--   - INSERT autenticado restrito ao diretório do próprio tenant (UUID) para role tenant_admin.
--   - SEM policy de UPDATE (uploads utilizam timestamp versionado com upsert = false).
--   - DELETE autenticado restrito para rollback compensatório e limpeza de arquivos do próprio tenant.
--   - SVG estritamente proibido (vetor XSS). Apenas PNG, JPEG e WebP.
--   - Zero permissões para anon, sales_rep, stock_manager e wholesale_customer.
-- =========================================================================

BEGIN;

-- 1. Limpeza defensiva de policies anteriores com o mesmo nome
DROP POLICY IF EXISTS "tenant_assets_select_public" ON storage.objects;
DROP POLICY IF EXISTS "tenant_assets_select_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "tenant_assets_insert_tenant_admin" ON storage.objects;
DROP POLICY IF EXISTS "tenant_assets_update_tenant_admin" ON storage.objects;
DROP POLICY IF EXISTS "tenant_assets_delete_tenant_admin" ON storage.objects;

-- 2. Policy SELECT: Apenas autenticado no diretório do próprio tenant (UUID) ou platform_admin
-- OBS: Leitura pública de storefront é atendida pela URL pública do bucket, sem enumeração de banco.
CREATE POLICY "tenant_assets_select_authenticated"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'tenant-assets'
    AND (
        (
            (storage.foldername(name))[1] = (SELECT private.get_current_tenant_id())::text
            AND (SELECT private.has_tenant_role(ARRAY['tenant_admin']))
        )
        OR (SELECT private.is_platform_admin())
    )
);

-- 3. Policy INSERT: Apenas tenant_admin gravando no diretório do próprio tenant (UUID) ou platform_admin
CREATE POLICY "tenant_assets_insert_tenant_admin"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'tenant-assets'
    AND (
        (
            (storage.foldername(name))[1] = (SELECT private.get_current_tenant_id())::text
            AND (SELECT private.has_tenant_role(ARRAY['tenant_admin']))
        )
        OR (SELECT private.is_platform_admin())
    )
);

-- 4. Policy UPDATE: NÃO CONCEDIDA
-- A aplicação utiliza nomes de arquivos versionados com timestamp e upsert: false.
-- Nenhuma operação de UPDATE é necessária no storage, atendendo ao menor privilégio.

-- 5. Policy DELETE: Apenas tenant_admin removendo assets do próprio tenant (UUID) ou platform_admin
-- Necessário para: rollback de upload com falha no banco, remoção manual e limpeza após substituição.
CREATE POLICY "tenant_assets_delete_tenant_admin"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'tenant-assets'
    AND (
        (
            (storage.foldername(name))[1] = (SELECT private.get_current_tenant_id())::text
            AND (SELECT private.has_tenant_role(ARRAY['tenant_admin']))
        )
        OR (SELECT private.is_platform_admin())
    )
);

COMMIT;
