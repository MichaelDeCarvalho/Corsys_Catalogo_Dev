-- =========================================================================
-- CORSYS CATÁLOGO B2B / B2C - MIGRATION 000004: REGRAS DE ATACADO POR ITEM
-- Arquivo: supabase/migrations/20260905_000004_wholesale_item_rules.sql
-- Objetivo: Evolução do schema (wholesale_enabled, wholesale_min_quantity),
--           constraints de integridade no banco, bootstrap dos 520 produtos
--           existentes e atualização da view pública catalog_products.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1. EVOLUÇÃO DO SCHEMA (PUBLIC.PRODUCTS)
-- -------------------------------------------------------------------------
-- Adiciona colunas para controle individual de atacado por produto/SKU.
ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS wholesale_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS wholesale_min_quantity INTEGER NULL;

COMMENT ON COLUMN public.products.wholesale_enabled IS 'Indica se o produto participa da modalidade atacado (B2B).';
COMMENT ON COLUMN public.products.wholesale_min_quantity IS 'Quantidade mínima necessária por SKU para compras na modalidade atacado. Deve ser NULL se wholesale_enabled for false.';

-- -------------------------------------------------------------------------
-- 2. BOOTSTRAP DOS PRODUTOS EXISTENTES (520 PRODUTOS)
-- -------------------------------------------------------------------------
-- Se wholesale_price IS NOT NULL:
--   wholesale_enabled = true
--   wholesale_min_quantity = 1
-- Se wholesale_price IS NULL:
--   wholesale_enabled = false
--   wholesale_min_quantity = NULL
-- Preserva rigorosamente os preços existentes sem alteração.
UPDATE public.products
SET 
    wholesale_enabled = true,
    wholesale_min_quantity = 1
WHERE wholesale_price IS NOT NULL;

UPDATE public.products
SET 
    wholesale_enabled = false,
    wholesale_min_quantity = NULL
WHERE wholesale_price IS NULL;

-- -------------------------------------------------------------------------
-- 3. CONSTRAINTS DE INTEGRIDADE NO BANCO DE DADOS
-- -------------------------------------------------------------------------
-- Constraint 1: wholesale_min_quantity deve ser NULL ou maior ou igual a 1
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_products_wholesale_min_quantity'
          AND conrelid = 'public.products'::regclass
    ) THEN
        ALTER TABLE public.products
        ADD CONSTRAINT chk_products_wholesale_min_quantity
        CHECK (wholesale_min_quantity IS NULL OR wholesale_min_quantity >= 1);
    END IF;
END $$;

-- Constraint 2: 
-- Se wholesale_enabled = true: wholesale_price IS NOT NULL E wholesale_min_quantity >= 1
-- Se wholesale_enabled = false: wholesale_min_quantity deve ser NULL
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_products_wholesale_rules'
          AND conrelid = 'public.products'::regclass
    ) THEN
        ALTER TABLE public.products
        ADD CONSTRAINT chk_products_wholesale_rules
        CHECK (
            (wholesale_enabled = true AND wholesale_price IS NOT NULL AND wholesale_min_quantity >= 1)
            OR
            (wholesale_enabled = false AND wholesale_min_quantity IS NULL)
        );
    END IF;
END $$;

-- -------------------------------------------------------------------------
-- 4. ATUALIZAÇÃO DA VIEW PÚBLICA DE CATÁLOGO (CATALOG_PRODUCTS)
-- -------------------------------------------------------------------------
-- Recriação explícita para evitar o erro 42P16 ao remover a coluna wholesale_price da view
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

COMMENT ON VIEW public.catalog_products IS 'Visão pública sanitizada com security_invoker = true. Exclui estritamente wholesale_price, cost_price e wholesale_min_quantity.';

-- -------------------------------------------------------------------------
-- 5. CONCESSÃO DE PERMISSÕES (LEAST PRIVILEGE)
-- -------------------------------------------------------------------------
-- Atualiza concessão de leitura na view catalog_products (apenas produtos públicos)
GRANT SELECT ON public.catalog_products TO anon, authenticated;

COMMIT;
