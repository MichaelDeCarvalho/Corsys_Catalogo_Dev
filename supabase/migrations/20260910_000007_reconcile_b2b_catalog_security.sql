-- =========================================================================
-- CORSYS CATÁLOGO B2B / B2C - MIGRATION 000007: RECONCILE B2B CATALOG SECURITY
-- Arquivo: supabase/migrations/20260910_000007_reconcile_b2b_catalog_security.sql
-- Motivo e Justificativa de Arquitetura:
--   1. As migrations 000004 e 000005 foram corrigidas para garantir replay e rebuilds
--      determinísticos em novos ambientes (evitando erro 42P16 no PostgreSQL ao recriar
--      a view catalog_products e tornando policies replay-safe).
--   2. Esta migration 000007 atua como FORWARD-FIX OFICIAL para produção, garantindo
--      que o estado final seja aplicado de forma idempotente mesmo em bancos de dados
--      onde versões anteriores já constem registradas no histórico de migrations.
--   3. Não altera dados comerciais nem estruturas de tabelas existentes.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1. RECRIAR CATALOG_PRODUCTS DETERMINISTICAMENTE (SEM COLUNAS DE ATACADO)
-- -------------------------------------------------------------------------
-- Remove a view de forma segura e a recria sem wholesale_price, cost_price,
-- wholesale_enabled ou wholesale_min_quantity.
DROP VIEW IF EXISTS public.catalog_products;

CREATE VIEW public.catalog_products
WITH (security_invoker = true)
AS
SELECT 
    p.id,
    p.tenant_id,
    p.name,
    p.sku,
    p.barcode,
    p.category,
    p.subcategory,
    p.brand,
    p.description,
    p.technical_specs,
    p.price,
    p.promotional_price,
    p.min_order_quantity,
    p.stock,
    p.unit,
    p.images,
    p.featured,
    p.is_new,
    p.sort_order,
    p.created_at,
    p.updated_at
FROM public.products p
WHERE p.active = true
  AND p.deleted_at IS NULL
  AND private.is_tenant_active(p.tenant_id);

COMMENT ON VIEW public.catalog_products IS 'Visão pública estritamente sanitizada para varejo. Security invoker = true. Preços e regras de atacado são excluídos.';

-- Concessões de leitura para catálogo público
GRANT SELECT ON public.catalog_products TO anon, authenticated;

-- -------------------------------------------------------------------------
-- 2. REAPLICAR RPC DE CATÁLOGO ATACADISTA B2B (FAIL-CLOSED)
-- -------------------------------------------------------------------------
-- Garante a execução da RPC com search_path vazio, verificação de auth.uid(),
-- tenant ativo, validação de cliente approved e FAIL-CLOSED para allow_b2b_mode.
CREATE OR REPLACE FUNCTION public.get_wholesale_catalog(p_tenant_slug TEXT)
RETURNS TABLE (
    product_id UUID,
    sku TEXT,
    wholesale_price NUMERIC(10,2),
    wholesale_min_quantity INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_allow_b2b BOOLEAN;
    v_customer_status TEXT;
BEGIN
    -- 1. Exige usuário autenticado no Supabase Auth
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Autenticação necessária para consultar o catálogo atacadista.'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Resolve tenant pelo slug e verifica se está ativo (Fail-Closed: allow_b2b_mode = false se ausente)
    SELECT t.id, COALESCE(s.allow_b2b_mode, false)
    INTO v_tenant_id, v_allow_b2b
    FROM public.tenants t
    LEFT JOIN public.tenant_public_settings s ON s.tenant_id = t.id
    WHERE (s.slug = p_tenant_slug OR t.slug = p_tenant_slug)
      AND t.status = 'active';

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Loja não encontrada ou inativa.'
            USING ERRCODE = 'P0002';
    END IF;

    -- 3. Valida se a modalidade B2B é permitida pela loja (Fail-Closed)
    IF NOT v_allow_b2b THEN
        RAISE EXCEPTION 'A modalidade atacadista B2B não está habilitada para esta loja.'
            USING ERRCODE = '42501';
    END IF;

    -- 4. Valida se o usuário é cliente B2B devidamente aprovado pelo tenant_admin
    SELECT c.status
    INTO v_customer_status
    FROM public.wholesale_customers c
    WHERE c.tenant_id = v_tenant_id
      AND c.user_id = v_user_id;

    IF v_customer_status IS NULL THEN
        RAISE EXCEPTION 'Empresa não cadastrada para compras no atacado neste tenant.'
            USING ERRCODE = '42501';
    END IF;

    IF v_customer_status != 'approved' THEN
        RAISE EXCEPTION 'Acesso atacadista não aprovado (status atual: %).' , v_customer_status
            USING ERRCODE = '42501';
    END IF;

    -- 5. Retorno mínimo sanitizado: apenas dados B2B de itens elegíveis
    RETURN QUERY
    SELECT 
        p.id AS product_id,
        p.sku,
        p.wholesale_price,
        p.wholesale_min_quantity
    FROM public.products p
    WHERE p.tenant_id = v_tenant_id
      AND p.active = true
      AND p.deleted_at IS NULL
      AND p.wholesale_enabled = true
      AND p.wholesale_price IS NOT NULL
      AND p.wholesale_min_quantity >= 1;
END;
$$;

COMMENT ON FUNCTION public.get_wholesale_catalog(TEXT) IS 'RPC segura que retorna estritamente a projeção de preços atacadistas para clientes autenticados e com status approved.';

-- Privilégios de execução estritos da RPC: apenas authenticated (anon e public revogados)
REVOKE ALL ON FUNCTION public.get_wholesale_catalog(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_wholesale_catalog(TEXT) TO authenticated;

-- -------------------------------------------------------------------------
-- 3. DEFESA EM PROFUNDIDADE: REAFIRMAR PROTEÇÃO ANON EM PUBLIC.PRODUCTS
-- -------------------------------------------------------------------------
-- Reafirma explicitamente que o role anon não possui acesso direto de leitura
-- às colunas confidenciais (cost_price, wholesale_price, wholesale_enabled, wholesale_min_quantity).
REVOKE ALL ON public.products FROM anon;
GRANT SELECT (
    id, tenant_id, name, sku, barcode, category, subcategory, brand,
    description, technical_specs, price, promotional_price,
    min_order_quantity, stock, unit, images, featured, is_new,
    sort_order, active, created_at, updated_at, deleted_at
) ON public.products TO anon;

COMMIT;
