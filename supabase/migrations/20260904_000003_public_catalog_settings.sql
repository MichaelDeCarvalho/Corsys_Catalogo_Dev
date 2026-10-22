-- =========================================================================
-- CORSYS CATÁLOGO B2B / B2C - MIGRATION 000003: CONFIGURAÇÃO PÚBLICA DO TENANT
-- Arquivo: supabase/migrations/20260904_000003_public_catalog_settings.sql
-- Objetivo: Evolução do schema (wholesale_min_order_value) e bootstrap
--           das configurações públicas reais para o tenant 'corsys-catalogo-demo'.
-- Resolução de Tenant: Exclusiva por slug 'corsys-catalogo-demo' (Fail-Closed)
-- Sem provisionamento de tenant / Sem UPSERT / Sem alteração de RLS/Grants
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1. EVOLUÇÃO MÍNIMA DO SCHEMA (TENANT_PUBLIC_SETTINGS)
-- -------------------------------------------------------------------------
-- Adiciona coluna para valor mínimo de pedido no atacado (B2B), mantendo
-- min_order_value com semântica de valor mínimo de varejo (B2C) / padrão.
ALTER TABLE public.tenant_public_settings
ADD COLUMN IF NOT EXISTS wholesale_min_order_value NUMERIC(10,2);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_tenant_public_settings_wholesale_min_order'
          AND conrelid = 'public.tenant_public_settings'::regclass
    ) THEN
        ALTER TABLE public.tenant_public_settings
        ADD CONSTRAINT chk_tenant_public_settings_wholesale_min_order
        CHECK (wholesale_min_order_value IS NULL OR wholesale_min_order_value >= 0.00);
    END IF;
END $$;

COMMENT ON COLUMN public.tenant_public_settings.min_order_value IS 'Valor mínimo de pedido para compras no varejo (B2C) ou valor padrão da loja.';
COMMENT ON COLUMN public.tenant_public_settings.wholesale_min_order_value IS 'Valor mínimo de pedido para compras no atacado (B2B). Permite NULL se o tenant não operar B2B.';

-- -------------------------------------------------------------------------
-- 2. VALIDAÇÃO FAIL-CLOSED E RESOLUÇÃO DO TENANT POR SLUG
-- -------------------------------------------------------------------------
DO $$
DECLARE
    v_tenant_id UUID;
    v_tenant_status TEXT;
    v_tenant_name TEXT;
    v_count_tenants INTEGER;
    v_count_existing_settings INTEGER;
    v_inserted_count INTEGER;
BEGIN
    -- a) Validar existência única do tenant por slug
    SELECT count(*) INTO v_count_tenants 
    FROM public.tenants 
    WHERE slug = 'corsys-catalogo-demo';

    IF v_count_tenants = 0 THEN
        RAISE EXCEPTION 'Validação fail-closed: Tenant com slug "corsys-catalogo-demo" não encontrado em public.tenants. A migration não cria tenants.';
    ELSIF v_count_tenants > 1 THEN
        RAISE EXCEPTION 'Validação fail-closed: Múltiplos tenants (%) encontrados com slug "corsys-catalogo-demo". Resolução ambígua abortada.', v_count_tenants;
    END IF;

    -- b) Validar status ativo do tenant
    SELECT id, status, name INTO v_tenant_id, v_tenant_status, v_tenant_name
    FROM public.tenants 
    WHERE slug = 'corsys-catalogo-demo';

    IF v_tenant_status <> 'active' THEN
        RAISE EXCEPTION 'Validação fail-closed: Tenant "corsys-catalogo-demo" (ID: %) está inativo (status atual: "%").', v_tenant_id, v_tenant_status;
    END IF;

    -- c) Precondição fail-closed: tenant_public_settings NÃO deve possuir registro anterior
    SELECT count(*) INTO v_count_existing_settings
    FROM public.tenant_public_settings
    WHERE tenant_id = v_tenant_id;

    IF v_count_existing_settings > 0 THEN
        RAISE EXCEPTION 'Validação fail-closed: Tenant % ("%") já possui configuração cadastrada em public.tenant_public_settings. UPSERT desativado.', v_tenant_id, v_tenant_name;
    END IF;

    -- ---------------------------------------------------------------------
    -- 3. CARGA DOS DADOS PÚBLICOS OFICIAIS (INSERT SIMPLES ATÔMICO)
    -- ---------------------------------------------------------------------
    INSERT INTO public.tenant_public_settings (
        tenant_id,
        slug,
        public_name,
        whatsapp_number,
        logo_url,
        banner_url,
        primary_color,
        accent_color,
        min_order_value,
        wholesale_min_order_value,
        allow_b2b_mode,
        hide_prices_without_login,
        delivery_methods,
        created_at,
        updated_at
    ) VALUES (
        v_tenant_id,
        'corsys-catalogo-demo',
        'Corsys.Catálogo',
        '+5541992928033',
        NULL,
        NULL,
        '#0F172A',
        '#FF5A00',
        400.00,
        1000.00,
        true,
        false,
        '["retirada","entrega","uber","transportadora","outro"]'::jsonb,
        now(),
        now()
    );

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    IF v_inserted_count <> 1 THEN
        RAISE EXCEPTION 'Falha crítica: Esperada 1 inserção em tenant_public_settings, executadas: %.', v_inserted_count;
    END IF;

    RAISE NOTICE '=======================================================';
    RAISE NOTICE 'CONFIGURAÇÕES PÚBLICAS DO TENANT GRAVADAS COM SUCESSO:';
    RAISE NOTICE 'Tenant: corsys-catalogo-demo (UUID: %)', v_tenant_id;
    RAISE NOTICE 'Nome Público: Corsys.Catálogo';
    RAISE NOTICE 'WhatsApp: +5541992928033';
    RAISE NOTICE 'Mínimo Varejo: R$ 400,00 | Mínimo Atacado: R$ 1.000,00';
    RAISE NOTICE 'Cores: Primária #0F172A | Destaque #FF5A00';
    RAISE NOTICE 'B2B: Ativo | Preços Públicos: Visíveis sem login';
    RAISE NOTICE '=======================================================';
END $$;

COMMIT;
