-- =========================================================================
-- CORSYS CATÁLOGO B2B / B2C - MIGRATION 000013: SECURITY DEFINER HARDENING
-- Arquivo: supabase/migrations/20260930_000013_security_definer_hardening.sql
-- Responsabilidade da Arquitetura:
--   - Correção do achado do Supabase Security Advisor (authenticated_security_definer_function_executable)
--   - Conversão de public.get_my_wholesale_status para SECURITY INVOKER com RLS
--   - Criação da RPC interna public.get_wholesale_catalog_internal (service_role only)
--   - Revogação de EXECUTE de public.get_wholesale_catalog para authenticated/anon/PUBLIC
--   - Revogação de EXECUTE de public.manage_order_status para authenticated/anon/PUBLIC
-- Princípios de Menor Privilégio:
--   - Navegadores/clientes authenticated não invocam diretamente RPCs com SECURITY DEFINER e privilégios de postgres
--   - Projeção de catálogo B2B protegida por Edge Function autenticada gateway
--   - Zero expansão de RLS em public.products para compradores B2B (proteção de cost_price)
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1. CONVERTER GET_MY_WHOLESALE_STATUS PARA SECURITY INVOKER
-- -------------------------------------------------------------------------
-- O storefront autenticado executa esta função diretamente para consultar o
-- status da própria solicitação B2B. A função passa a rodar com as permissões
-- do próprio usuário invocador (SECURITY INVOKER) e search_path vazio.
-- A resolução do tenant é realizada sobre tenant_public_settings (legível por
-- authenticated) e o registro é protegido pela RLS wholesale_customers_select_self.
CREATE OR REPLACE FUNCTION public.get_my_wholesale_status(p_tenant_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_result JSONB;
BEGIN
    -- 1.1 Verifica autenticação do invocador
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('status', 'unauthenticated');
    END IF;

    -- 1.2 Valida slug do tenant de forma defensiva
    IF p_tenant_slug IS NULL OR trim(p_tenant_slug) = '' THEN
        RETURN jsonb_build_object('status', 'tenant_not_found');
    END IF;
    IF length(trim(p_tenant_slug)) > 120 THEN
        RETURN jsonb_build_object('status', 'tenant_not_found');
    END IF;

    -- 1.3 Resolve tenant_id usando exclusivamente public.tenant_public_settings
    -- (tabela que possui SELECT para authenticated e RLS ativa, sem exigir
    -- membership tenant_users do comprador B2B)
    SELECT s.tenant_id INTO v_tenant_id
    FROM public.tenant_public_settings s
    WHERE s.slug = trim(p_tenant_slug);

    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('status', 'tenant_not_found');
    END IF;

    -- 1.4 Consulta wholesale_customers protegido pela RLS wholesale_customers_select_self
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

COMMENT ON FUNCTION public.get_my_wholesale_status(TEXT) IS 'Consulta o status comercial B2B do usuário autenticado usando SECURITY INVOKER e RLS de wholesale_customers.';

REVOKE ALL ON FUNCTION public.get_my_wholesale_status(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_wholesale_status(TEXT) TO authenticated;


-- -------------------------------------------------------------------------
-- 2. CRIAR RPC INTERNA: GET_WHOLESALE_CATALOG_INTERNAL (SERVICE_ROLE ONLY)
-- -------------------------------------------------------------------------
-- Executada exclusivamente no backend pela Edge Function get-wholesale-catalog
-- após validação rigorosa de identidade via JWT. Não é exposta a authenticated.
CREATE OR REPLACE FUNCTION public.get_wholesale_catalog_internal(
    p_tenant_slug TEXT,
    p_user_id UUID
)
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
    v_tenant_id UUID;
    v_allow_b2b BOOLEAN;
    v_customer_status TEXT;
BEGIN
    -- 2.1 Validações estritas de parâmetros
    IF p_tenant_slug IS NULL OR trim(p_tenant_slug) = '' THEN
        RAISE EXCEPTION 'Slug do tenant é obrigatório.'
            USING ERRCODE = '22000';
    END IF;
    IF length(trim(p_tenant_slug)) > 120 THEN
        RAISE EXCEPTION 'Slug do tenant excede o limite máximo de 120 caracteres.'
            USING ERRCODE = '22000';
    END IF;
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'Identificador do usuário comprador é obrigatório.'
            USING ERRCODE = '22000';
    END IF;

    -- 2.2 Resolve tenant ativo e verifica se B2B está habilitado (Fail-Closed)
    SELECT t.id, COALESCE(s.allow_b2b_mode, false)
    INTO v_tenant_id, v_allow_b2b
    FROM public.tenants t
    LEFT JOIN public.tenant_public_settings s ON s.tenant_id = t.id
    WHERE (s.slug = trim(p_tenant_slug) OR t.slug = trim(p_tenant_slug))
      AND t.status = 'active';

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Loja não encontrada ou inativa.'
            USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_allow_b2b THEN
        RAISE EXCEPTION 'A modalidade atacadista B2B não está habilitada para esta loja.'
            USING ERRCODE = '42501';
    END IF;

    -- 2.3 Confirma que o comprador possui solicitação cadastrada e aprovada
    SELECT c.status
    INTO v_customer_status
    FROM public.wholesale_customers c
    WHERE c.tenant_id = v_tenant_id
      AND c.user_id = p_user_id;

    IF v_customer_status IS NULL THEN
        RAISE EXCEPTION 'Empresa não cadastrada para compras no atacado neste tenant.'
            USING ERRCODE = '42501';
    END IF;

    IF v_customer_status <> 'approved' THEN
        RAISE EXCEPTION 'Acesso atacadista não aprovado.'
            USING ERRCODE = '42501';
    END IF;

    -- 2.4 Retorno sanitizado B2B: apenas 4 colunas estritamente autorizadas
    -- NUNCA retorna cost_price, preço de custo, customer PII ou segredos
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
      AND p.wholesale_price > 0
      AND p.wholesale_min_quantity >= 1;
END;
$$;

COMMENT ON FUNCTION public.get_wholesale_catalog_internal(TEXT, UUID) IS 'RPC interna de projeção B2B sanitizada, executável exclusivamente por service_role via Edge Function gateway.';

-- Privilégios da RPC interna: EXCLUSIVAMENTE service_role
REVOKE ALL ON FUNCTION public.get_wholesale_catalog_internal(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_wholesale_catalog_internal(TEXT, UUID) TO service_role;


-- -------------------------------------------------------------------------
-- 3. REVOGAR ACESSO DO BROWSER À RPC ANTIGA GET_WHOLESALE_CATALOG
-- -------------------------------------------------------------------------
-- Preservada fisicamente no banco para fins de compatibilidade/rollback,
-- mas com permissão de execução REVOGADA para authenticated, anon e PUBLIC.
-- O frontend consome exclusivamente a Edge Function autenticada get-wholesale-catalog.
REVOKE ALL ON FUNCTION public.get_wholesale_catalog(TEXT) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.get_wholesale_catalog(TEXT) IS 'DEPRECATED/REVOKED: RPC direta pelo browser revogada por segurança. Substituída pelo gateway get-wholesale-catalog.';


-- -------------------------------------------------------------------------
-- 4. REVOGAR ACESSO DIRETO DE AUTHENTICATED A MANAGE_ORDER_STATUS
-- -------------------------------------------------------------------------
-- A função manage_order_status possui SECURITY DEFINER e não é consumida pelo
-- frontend atual (OrderManager ainda opera em estado legado no client).
-- O privilégio de execução direta para authenticated é revogado para eliminar
-- o vetor de mutação direta no banco sem gateway de autorização.
REVOKE EXECUTE ON FUNCTION public.manage_order_status(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.manage_order_status(UUID, TEXT) IS 'Lógica administrativa de status de pedidos. Acesso direto por papéis de API revogado por menor privilégio (sem gateway server-side ativo nesta etapa).';

COMMIT;
