-- =========================================================================
-- CORSYS CATÁLOGO B2B / B2C - MIGRATION 000005: ACESSO ATACADISTA B2B
-- Arquivo: supabase/migrations/20260907_000005_b2b_wholesale_access.sql
-- Objetivo: 
--   1. Criar entidade public.wholesale_customers para clientes B2B
--   2. RLS deny-by-default para wholesale_customers
--   3. Sanitização definitiva de catalog_products (sem wholesale_price, sem cost_price)
--   4. Revogação de grants de colunas de atacado para perfil anon
--   5. RPC segura get_wholesale_catalog com verificação estrita de status approved
--   6. RPC segura get_my_wholesale_status para verificação do status B2B do usuário
--   7. Concessões restritas para service_role (Edge Functions de aprovação/cadastro)
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1. TABELA DE CLIENTES COMPRADORES B2B (WHOLESALE_CUSTOMERS)
-- -------------------------------------------------------------------------
-- Entidade distinta de tenant_users: representa empresas compradoras, não equipe interna.
CREATE TABLE IF NOT EXISTS public.wholesale_customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    cnpj TEXT NOT NULL,
    legal_name TEXT NOT NULL,
    trade_name TEXT,
    contact_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    city TEXT,
    state TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_wholesale_customers_cnpj_digits CHECK (cnpj ~ '^[0-9]{14}$'),
    CONSTRAINT uq_wholesale_customers_tenant_cnpj UNIQUE (tenant_id, cnpj)
);

COMMENT ON TABLE public.wholesale_customers IS 'Clientes compradores atacadistas (B2B). Isolados por tenant, com controle de aprovação administrativa.';
COMMENT ON COLUMN public.wholesale_customers.cnpj IS 'CNPJ normalizado com exatamente 14 dígitos numéricos.';
COMMENT ON COLUMN public.wholesale_customers.status IS 'Ciclo de vida B2B: pending -> approved/rejected; approved <-> suspended.';

-- Índice para busca rápida de vínculo do usuário por tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_wholesale_customers_tenant_user 
ON public.wholesale_customers(tenant_id, user_id) 
WHERE user_id IS NOT NULL;

-- Índices de consulta administrativa e autorização
CREATE INDEX IF NOT EXISTS idx_wholesale_customers_tenant_status 
ON public.wholesale_customers(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_wholesale_customers_user 
ON public.wholesale_customers(user_id);

-- Trigger para atualização automática da coluna updated_at
DROP TRIGGER IF EXISTS trg_wholesale_customers_updated_at ON public.wholesale_customers;
CREATE TRIGGER trg_wholesale_customers_updated_at
BEFORE UPDATE ON public.wholesale_customers
FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- -------------------------------------------------------------------------
-- 2. POLÍTICAS RLS - WHOLESALE_CUSTOMERS (DENY-BY-DEFAULT)
-- -------------------------------------------------------------------------
ALTER TABLE public.wholesale_customers ENABLE ROW LEVEL SECURITY;

-- Revoga explicitamente todos os privilégios de acesso direto para clientes e público
REVOKE ALL ON public.wholesale_customers FROM PUBLIC, anon, authenticated;

-- ANON: NENHUM ACESSO DIRETO (Submissão é exclusivamente via Edge Function pública sanitizada)

-- Limpeza defensiva para replay seguro
DROP POLICY IF EXISTS "wholesale_customers_select_self" ON public.wholesale_customers;
DROP POLICY IF EXISTS "wholesale_customers_select_tenant_admin" ON public.wholesale_customers;

-- AUTHENTICATED - CLIENTE: pode consultar estritamente seu próprio cadastro B2B
CREATE POLICY "wholesale_customers_select_self"
ON public.wholesale_customers FOR SELECT
TO authenticated
USING (
    user_id = (SELECT auth.uid())
);

-- AUTHENTICATED - TENANT_ADMIN: pode consultar cadastros e solicitações da sua loja
CREATE POLICY "wholesale_customers_select_tenant_admin"
ON public.wholesale_customers FOR SELECT
TO authenticated
USING (
    (tenant_id = (SELECT private.get_current_tenant_id()) AND (SELECT private.has_tenant_role(ARRAY['tenant_admin'])))
    OR (SELECT private.is_platform_admin())
);

-- ESCRITA DIRETA BLOQUEADA NO CLIENTE:
-- Nenhuma policy de INSERT, UPDATE ou DELETE para anon ou authenticated.
-- Toda aprovação, rejeição, suspensão ou criação de cadastro é executada
-- via Edge Functions / RPC server-side com service_role ou SECURITY DEFINER.

-- Concessões de leitura para papéis do banco
GRANT SELECT ON public.wholesale_customers TO authenticated;

-- -------------------------------------------------------------------------
-- 3. SANITIZAÇÃO DEFINITIVA DO CATÁLOGO PÚBLICO (CATALOG_PRODUCTS)
-- -------------------------------------------------------------------------
-- O catálogo público de varejo NÃO expõe preços ou quantidades de atacado.
-- Nem cost_price, nem wholesale_price, nem wholesale_min_quantity.
-- Recriação determinística da view pública
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

-- -------------------------------------------------------------------------
-- 4. REVISÃO E FECHAMENTO DE GRANTS DE ATACADO EM PUBLIC.PRODUCTS
-- -------------------------------------------------------------------------
-- ANON não pode consultar wholesale_price ou wholesale_min_quantity diretamente.
-- Revoga expressamente privilégios de nível de coluna e de tabela para anon,
-- garantindo a anulação das permissões de wholesale_price concedidas na migration 000001.
REVOKE SELECT (wholesale_price) ON public.products FROM anon;
REVOKE SELECT (wholesale_enabled) ON public.products FROM anon;
REVOKE SELECT (wholesale_min_quantity) ON public.products FROM anon;
REVOKE SELECT (cost_price) ON public.products FROM anon;
REVOKE ALL PRIVILEGES ON public.products FROM anon;

GRANT SELECT (
    id, tenant_id, name, sku, barcode, category, subcategory, brand,
    description, technical_specs, price, promotional_price,
    min_order_quantity, stock, unit, images, featured, is_new, active,
    sort_order, created_at, updated_at, deleted_at
) ON public.products TO anon;

-- Garante que catalog_products é legível por anon e authenticated
GRANT SELECT ON public.catalog_products TO anon, authenticated;

-- -------------------------------------------------------------------------
-- 5. RPC SEGURA DO CATÁLOGO ATACADISTA (GET_WHOLESALE_CATALOG)
-- -------------------------------------------------------------------------
-- Superfície dedicada, sanitizada e autorizada para clientes B2B aprovados.
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

    -- 3. Valida se a modalidade B2B é permitida pela loja
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

-- Restrição de execução da RPC: apenas authenticated (anon e public revogados)
REVOKE ALL ON FUNCTION public.get_wholesale_catalog(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_wholesale_catalog(TEXT) TO authenticated;

-- -------------------------------------------------------------------------
-- 6. RPC DE CONSULTA DE STATUS B2B DO USUÁRIO (GET_MY_WHOLESALE_STATUS)
-- -------------------------------------------------------------------------
-- Permite ao cliente autenticado descobrir o estado de sua solicitação B2B no storefront.
CREATE OR REPLACE FUNCTION public.get_my_wholesale_status(p_tenant_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('status', 'unauthenticated');
    END IF;

    SELECT t.id INTO v_tenant_id
    FROM public.tenants t
    LEFT JOIN public.tenant_public_settings s ON s.tenant_id = t.id
    WHERE (s.slug = p_tenant_slug OR t.slug = p_tenant_slug)
      AND t.status = 'active';

    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('status', 'tenant_not_found');
    END IF;

    SELECT jsonb_build_object(
        'status', c.status,
        'cnpj', c.cnpj,
        'legal_name', c.legal_name,
        'trade_name', c.trade_name,
        'contact_name', c.contact_name,
        'email', c.email,
        'phone', c.phone,
        'created_at', c.created_at,
        'approved_at', c.approved_at
    )
    INTO v_result
    FROM public.wholesale_customers c
    WHERE c.tenant_id = v_tenant_id
      AND c.user_id = v_user_id;

    IF v_result IS NULL THEN
        RETURN jsonb_build_object('status', 'not_registered');
    END IF;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_my_wholesale_status(TEXT) IS 'Permite ao usuário autenticado consultar seu status comercial B2B na loja ativa.';

REVOKE ALL ON FUNCTION public.get_my_wholesale_status(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_wholesale_status(TEXT) TO authenticated;

-- -------------------------------------------------------------------------
-- 7. CONCESSÕES ESPECÍFICAS PARA SERVICE_ROLE (LEAST PRIVILEGE AUDITADO)
-- -------------------------------------------------------------------------
-- Auditoria de escrita das Edge Functions:
-- 1) submit-wholesale-application:
--    - SELECT em wholesale_customers (verificação de duplicidade de CNPJ)
--    - INSERT nas colunas de cadastro inicial (tenant_id, cnpj, legal_name, trade_name, contact_name, email, phone, city, state, status)
-- 2) manage-wholesale-customer:
--    - SELECT em wholesale_customers (leitura da solicitação para aprovação/gestão)
--    - UPDATE estrito nas colunas de ciclo de vida (status, user_id, approved_at, approved_by)
--    - updated_at é gerenciado de forma determinística pelo trigger de banco private.set_updated_at().
-- 3) NENHUMA função ou cliente executa DELETE em wholesale_customers.
-- Portanto, service_role recebe privilégios colunares restritivos:
--   - SELECT na tabela
--   - INSERT estrito nas 10 colunas da solicitação inicial (sem approved_at/approved_by/user_id)
--   - UPDATE estrito nas 4 colunas de gestão (sem id/tenant_id/cnpj/created_at)
--   - DELETE, TRUNCATE, REFERENCES e TRIGGER são expressamente negados/revogados.
REVOKE ALL ON public.wholesale_customers FROM service_role;
GRANT SELECT ON public.wholesale_customers TO service_role;
GRANT INSERT (tenant_id, cnpj, legal_name, trade_name, contact_name, email, phone, city, state, status) 
    ON public.wholesale_customers TO service_role;
GRANT UPDATE (status, user_id, approved_at, approved_by) 
    ON public.wholesale_customers TO service_role;

GRANT SELECT ON public.tenants TO service_role;
GRANT SELECT ON public.tenant_public_settings TO service_role;
GRANT SELECT ON public.tenant_users TO service_role;

COMMIT;
