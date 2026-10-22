-- =========================================================================
-- CORSYS CATÁLOGO B2B / B2C - MIGRATION 000008: STORAGE POLICIES (PRODUCT MEDIA)
-- Arquivo: supabase/migrations/20260916_000008_product_media_storage.sql
-- Responsabilidade da Arquitetura:
--   - config.toml: Provisionamento e configuração do bucket 'product-media'
--     (public = true, limite 1MiB, MIME restrito a image/png, image/jpeg, image/webp).
--   - 000008: Políticas de autorização (RLS) em storage.objects com menor privilégio,
--     espelhando as permissões de edição de public.products e isolamento multi-tenant por UUID.
-- Princípio de Menor Privilégio:
--   - Leitura pública via CDN pública do bucket (storefront consome URL pública da imagem).
--   - NENHUMA policy de SELECT público em storage.objects (impede enumeração de arquivos do storage).
--   - SELECT autenticado restrito ao namespace <tenant_uuid>/products/ do próprio tenant ou platform_admin
--     (essencial para a API storage.remove e validações de metadados do client autenticado).
--   - INSERT autenticado restrito a tenant_admin no diretório do seu próprio tenant ou platform_admin.
--   - SEM policy de UPDATE (uploads utilizam nomenclatura versionada com upsert = false).
--   - DELETE autenticado restrito a tenant_admin para rollback compensatório e substituição de fotos.
--   - Formato SVG estritamente proibido (vetor de risco XSS).
--   - Path canônico obrigatório: <tenant_uuid>/products/<product_uuid>/media_<versao>.<ext>
-- =========================================================================

BEGIN;

-- 1. Limpeza defensiva de policies prévias de produto com o mesmo nome
DROP POLICY IF EXISTS "product_media_select_public" ON storage.objects;
DROP POLICY IF EXISTS "product_media_select_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "product_media_insert_tenant_admin" ON storage.objects;
DROP POLICY IF EXISTS "product_media_update_tenant_admin" ON storage.objects;
DROP POLICY IF EXISTS "product_media_delete_tenant_admin" ON storage.objects;

-- 2. Policy SELECT: Apenas autenticado no diretório do próprio tenant sob /products/<product_id> ou platform_admin
-- OBS: Leitura pública do catálogo/storefront consome diretamente a CDN pública do bucket, sem enumeração direta de storage.objects.
CREATE POLICY "product_media_select_authenticated"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'product-media'
    AND (storage.foldername(name))[2] = 'products'
    AND EXISTS (
        SELECT 1
        FROM public.products p
        WHERE p.id::text = (storage.foldername(name))[3]
          AND p.tenant_id::text = (storage.foldername(name))[1]
    )
    AND (
        (
            (storage.foldername(name))[1] = (SELECT private.get_current_tenant_id())::text
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
    AND (storage.foldername(name))[2] = 'products'
    AND EXISTS (
        SELECT 1
        FROM public.products p
        WHERE p.id::text = (storage.foldername(name))[3]
          AND p.tenant_id::text = (storage.foldername(name))[1]
    )
    AND (
        (
            (storage.foldername(name))[1] = (SELECT private.get_current_tenant_id())::text
            AND (SELECT private.has_tenant_role(ARRAY['tenant_admin']))
        )
        OR (SELECT private.is_platform_admin())
    )
);

-- 4. Policy UPDATE: NÃO CONCEDIDA
-- A aplicação utiliza versionamento de arquivos com identificador único/timestamp e upsert: false.
-- Nenhuma operação de UPDATE em storage.objects é necessária, atendendo ao menor privilégio.

-- 5. Policy DELETE: Apenas tenant_admin removendo mídias do namespace do seu próprio tenant ou platform_admin
-- Necessário para: rollback de upload caso a persistência em public.products falhe e limpeza de mídias antigas removidas.
CREATE POLICY "product_media_delete_tenant_admin"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'product-media'
    AND (storage.foldername(name))[2] = 'products'
    AND EXISTS (
        SELECT 1
        FROM public.products p
        WHERE p.id::text = (storage.foldername(name))[3]
          AND p.tenant_id::text = (storage.foldername(name))[1]
    )
    AND (
        (
            (storage.foldername(name))[1] = (SELECT private.get_current_tenant_id())::text
            AND (SELECT private.has_tenant_role(ARRAY['tenant_admin']))
        )
        OR (SELECT private.is_platform_admin())
    )
);

COMMIT;
