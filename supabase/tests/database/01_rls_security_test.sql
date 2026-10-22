-- =========================================================================
-- CORSYS CATÁLOGO B2B / B2C - SUÍTE DE TESTES E VALIDAÇÃO DE RLS E INTEGRIDADE
-- Arquivo: supabase/tests/01_rls_security_test.sql
-- Aplica-se a: Supabase PostgreSQL V2 / PostgREST / RLS Engine
-- Estado: Script executável de teste para banco real/local pós-provisionamento.
-- =========================================================================
-- NOTA OPERACIONAL:
-- Este script foi projetado para execução em transação isolada (BEGIN ... ROLLBACK)
-- simulando os papéis 'anon', 'authenticated' e diferentes identidades de JWT
-- através dos settings do PostgREST ('request.jwt.claim.sub').
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 0. CONFIGURAÇÃO DE AMBIENTE E SEED TEMPORÁRIO DE TESTE
-- -------------------------------------------------------------------------

DO $$
DECLARE
    v_tenant_a UUID := 'a0000000-0000-0000-0000-000000000001'::uuid;
    v_tenant_b UUID := 'b0000000-0000-0000-0000-000000000002'::uuid;
    v_user_admin_a UUID := 'a1000000-0000-0000-0000-000000000001'::uuid;
    v_user_admin_b UUID := 'b1000000-0000-0000-0000-000000000001'::uuid;
    v_user_sales_a UUID := 'a2000000-0000-0000-0000-000000000002'::uuid;
    v_user_sales_b UUID := 'b2000000-0000-0000-0000-000000000002'::uuid;
    v_user_stock_a UUID := 'a3000000-0000-0000-0000-000000000003'::uuid;
    v_user_platform UUID := 'f0000000-0000-0000-0000-000000000001'::uuid;
    v_prod_a1 UUID := 'a0100000-0000-0000-0000-000000000001'::uuid;
    v_prod_b1 UUID := 'b0100000-0000-0000-0000-000000000001'::uuid;
    v_order_a1 UUID := 'a0200000-0000-0000-0000-000000000001'::uuid;
    v_count INTEGER;
BEGIN
    RAISE NOTICE '=======================================================';
    RAISE NOTICE 'INICIANDO SUÍTE DE TESTES AUTOMATIZADOS DE RLS E INTEGRIDADE';
    RAISE NOTICE '=======================================================';

    -- 1. Criação de usuários fictícios em auth.users para satisfazer FKs
    INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
    VALUES 
        (v_user_admin_a, 'admin@alpha.com', '{"name":"Admin Alpha"}'::jsonb, now(), now()),
        (v_user_admin_b, 'admin@beta.com', '{"name":"Admin Beta"}'::jsonb, now(), now()),
        (v_user_sales_a, 'vendedor@alpha.com', '{"name":"Vendedor Alpha"}'::jsonb, now(), now()),
        (v_user_sales_b, 'vendedor@beta.com', '{"name":"Vendedor Beta"}'::jsonb, now(), now()),
        (v_user_stock_a, 'estoque@alpha.com', '{"name":"Estoque Alpha"}'::jsonb, now(), now()),
        (v_user_platform, 'master@saas.com', '{"name":"Platform Master"}'::jsonb, now(), now())
    ON CONFLICT (id) DO NOTHING;

    -- 2. Criação de Platform Admin
    INSERT INTO public.platform_admins (id, email, full_name)
    VALUES (v_user_platform, 'master@saas.com', 'Platform Master')
    ON CONFLICT (id) DO NOTHING;

    -- 3. Criação dos Tenants A e B
    INSERT INTO public.tenants (id, slug, name, trade_name, owner_email, plan, status)
    VALUES 
        (v_tenant_a, 'loja-alpha', 'Loja Alpha Ltda', 'Alpha Ferramentas', 'admin@alpha.com', 'pro', 'active'),
        (v_tenant_b, 'loja-beta', 'Loja Beta Ltda', 'Beta Máquinas', 'admin@beta.com', 'pro', 'active')
    ON CONFLICT (id) DO NOTHING;

    -- 4. Criação das Configurações Públicas dos Tenants
    INSERT INTO public.tenant_public_settings (tenant_id, slug, public_name, whatsapp_number, primary_color)
    VALUES 
        (v_tenant_a, 'loja-alpha', 'Alpha Ferramentas', '5511999990001', '#0284c7'),
        (v_tenant_b, 'loja-beta', 'Beta Máquinas', '5511999990002', '#10b981')
    ON CONFLICT (tenant_id) DO NOTHING;

    -- 5. Vínculo dos Usuários aos Tenants (tenant_users)
    INSERT INTO public.tenant_users (id, tenant_id, role, name, email, seller_code, active)
    VALUES 
        (v_user_admin_a, v_tenant_a, 'tenant_admin', 'Admin Alpha', 'admin@alpha.com', NULL, true),
        (v_user_sales_a, v_tenant_a, 'sales_rep', 'Vendedor Alpha', 'vendedor@alpha.com', 'VEND-A', true),
        (v_user_stock_a, v_tenant_a, 'stock_manager', 'Estoque Alpha', 'estoque@alpha.com', NULL, true),
        (v_user_admin_b, v_tenant_b, 'tenant_admin', 'Admin Beta', 'admin@beta.com', NULL, true),
        (v_user_sales_b, v_tenant_b, 'sales_rep', 'Vendedor Beta', 'vendedor@beta.com', 'VEND-B', true)
    ON CONFLICT (id) DO NOTHING;

    -- 6. Produtos de Teste
    INSERT INTO public.products (id, tenant_id, name, sku, category, price, cost_price, active)
    VALUES 
        (v_prod_a1, v_tenant_a, 'Broca A1', 'SKU-A1', 'Brocas', 10.00, 4.00, true),
        (v_prod_b1, v_tenant_b, 'Disco B1', 'SKU-B1', 'Discos', 25.00, 12.00, true)
    ON CONFLICT (id) DO NOTHING;

    -- 7. Faixas de Atacado
    INSERT INTO public.wholesale_tiers (product_id, min_quantity, price, discount_percentage)
    VALUES 
        (v_prod_a1, 10, 8.50, 15.00),
        (v_prod_b1, 5, 20.00, 20.00)
    ON CONFLICT (product_id, min_quantity) DO NOTHING;

    -- 8. Pedidos de Teste
    INSERT INTO public.orders (
        id, order_number, tenant_id, seller_id, seller_code, customer,
        shipping_address, items, subtotal, total, status, idempotency_key
    ) VALUES (
        v_order_a1, 'PED-A-001', v_tenant_a, v_user_sales_a, 'VEND-A',
        '{"name": "Cliente 1"}'::jsonb, '{"city": "SP"}'::jsonb,
        '[{"sku": "SKU-A1", "quantity": 10}]'::jsonb, 85.00, 85.00, 'pending', gen_random_uuid()
    ) ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE 'Ambiente de teste inicializado com sucesso.';
END $$;

-- -------------------------------------------------------------------------
-- TESTE 1: PERFIL ANÔNIMO (ANON)
-- -------------------------------------------------------------------------

-- 1.1 Lê catalog_products (SUCESSO)
SET LOCAL ROLE anon;
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT count(*) INTO v_count FROM public.catalog_products;
    IF v_count < 2 THEN
        RAISE EXCEPTION '[FALHA] Anon deveria visualizar produtos de catalog_products. Contagem: %', v_count;
    END IF;
    RAISE NOTICE '[PASS] Anon consulta catalog_products com sucesso (Contagem: %)', v_count;
END $$;

-- 1.2 Lê tenant_public_settings ativo (SUCESSO)
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT count(*) INTO v_count FROM public.tenant_public_settings;
    IF v_count < 2 THEN
        RAISE EXCEPTION '[FALHA] Anon deveria ler tenant_public_settings de lojas ativas.';
    END IF;
    RAISE NOTICE '[PASS] Anon consulta tenant_public_settings com sucesso.';
END $$;

-- 1.3 Faixas de preço B2B não podem contornar o gateway de compradores aprovados.
DO $$
BEGIN
    PERFORM * FROM public.wholesale_tiers;
    RAISE EXCEPTION '[FALHA DE SEGURANÇA] Anon conseguiu consultar wholesale_tiers!';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '[PASS] Anon bloqueado de ler faixas de preço B2B.';
END $$;

-- 1.4 Bloqueio de leitura em public.tenants (DEVE FALHAR COM PERMISSION DENIED)
DO $$
BEGIN
    PERFORM * FROM public.tenants;
    RAISE EXCEPTION '[FALHA DE SEGURANÇA] Anon conseguiu ler public.tenants!';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '[PASS] Anon bloqueado de ler public.tenants (insufficient_privilege).';
END $$;

-- 1.5 Bloqueio de leitura em public.tenant_users (DEVE FALHAR COM PERMISSION DENIED)
DO $$
BEGIN
    PERFORM * FROM public.tenant_users;
    RAISE EXCEPTION '[FALHA DE SEGURANÇA] Anon conseguiu ler public.tenant_users!';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '[PASS] Anon bloqueado de ler public.tenant_users (insufficient_privilege).';
END $$;

-- 1.6 Bloqueio de leitura em public.orders (DEVE FALHAR COM PERMISSION DENIED)
DO $$
BEGIN
    PERFORM * FROM public.orders;
    RAISE EXCEPTION '[FALHA DE SEGURANÇA] Anon conseguiu ler public.orders!';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '[PASS] Anon bloqueado de ler public.orders (insufficient_privilege).';
END $$;

-- 1.7 Bloqueio de leitura da coluna cost_price em public.products
DO $$
BEGIN
    PERFORM cost_price FROM public.products;
    RAISE EXCEPTION '[FALHA DE SEGURANÇA] Anon conseguiu ler a coluna cost_price em public.products!';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '[PASS] Anon impedido de ler cost_price em public.products (permission denied for column).';
END $$;

-- 1.8 Permissão de leitura da coluna deleted_at para avaliação de WHERE pelo Anon
DO $$
BEGIN
    PERFORM id, deleted_at FROM public.products;
    RAISE NOTICE '[PASS] Anon pode ler deleted_at para avaliação de filtros de catálogo.';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION '[FALHA DE SEGURANÇA] Anon deveria ter SELECT em deleted_at de public.products!';
END $$;

-- 1.9 Bloqueio de escrita em qualquer tabela
DO $$
BEGIN
    INSERT INTO public.products (tenant_id, name, sku, category, price)
    VALUES ('a0000000-0000-0000-0000-000000000001'::uuid, 'Hack', 'HACK', 'HACK', 1.00);
    RAISE EXCEPTION '[FALHA DE SEGURANÇA] Anon conseguiu inserir registro em public.products!';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '[PASS] Anon bloqueado de inserir em public.products (insufficient_privilege).';
END $$;


-- -------------------------------------------------------------------------
-- TESTE 2: TENANT ADMIN A (ISOLAMENTO E RESTRIÇÕES)
-- -------------------------------------------------------------------------
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';

-- 2.1 Lê próprio tenant e NÃO lê tenant B
DO $$
DECLARE
    v_count_a INTEGER;
    v_count_b INTEGER;
BEGIN
    SELECT count(*) INTO v_count_a FROM public.tenants WHERE id = 'a0000000-0000-0000-0000-000000000001'::uuid;
    SELECT count(*) INTO v_count_b FROM public.tenants WHERE id = 'b0000000-0000-0000-0000-000000000002'::uuid;
    
    IF v_count_a <> 1 OR v_count_b <> 0 THEN
        RAISE EXCEPTION '[FALHA DE ISOLAMENTO] Admin A não pode ler Tenant B. (A: %, B: %)', v_count_a, v_count_b;
    END IF;
    RAISE NOTICE '[PASS] Admin A lê exclusivamente seu próprio Tenant A.';
END $$;

-- 2.2 Gerencia produtos apenas de sua loja
DO $$
DECLARE
    v_prod_id UUID := gen_random_uuid();
BEGIN
    -- Inserir produto próprio (SUCESSO)
    INSERT INTO public.products (id, tenant_id, name, sku, category, price, cost_price)
    VALUES (v_prod_id, 'a0000000-0000-0000-0000-000000000001'::uuid, 'Novo A', 'SKU-A-NEW', 'Cat', 15.00, 5.00);

    -- Atualizar produto próprio (SUCESSO)
    UPDATE public.products SET price = 16.00 WHERE id = v_prod_id;

    -- Soft delete de produto próprio (SUCESSO via UPDATE de deleted_at)
    UPDATE public.products SET deleted_at = now() WHERE id = v_prod_id;

    -- Tentar DELETE físico de produto próprio (DEVE FALHAR COM insufficient_privilege)
    BEGIN
        DELETE FROM public.products WHERE id = v_prod_id;
        RAISE EXCEPTION '[FALHA DE SEGURANÇA] Admin A conseguiu executar DELETE físico em products!';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE '[PASS] Admin A bloqueado de DELETE físico em products (modelo soft-delete via UPDATE).';
    END;

    -- Tentar inserir produto em Tenant B (DEVE SER BLOQUEADO PELO RLS)
    BEGIN
        INSERT INTO public.products (tenant_id, name, sku, category, price)
        VALUES ('b0000000-0000-0000-0000-000000000002'::uuid, 'Invasão B', 'SKU-INVADE', 'Cat', 99.00);
        RAISE EXCEPTION '[FALHA DE ISOLAMENTO] Admin A inseriu produto no Tenant B!';
    EXCEPTION WHEN check_violation OR insufficient_privilege THEN
        RAISE NOTICE '[PASS] Admin A bloqueado de inserir produtos no Tenant B.';
    END;

    RAISE NOTICE '[PASS] Admin A gerencia apenas produtos do seu tenant.';
END $$;

-- 2.3 Bloqueio de escrita direta em tenant_users (NÃO pode alterar roles/equipe pelo browser)
DO $$
BEGIN
    UPDATE public.tenant_users SET role = 'tenant_admin' WHERE id = 'a2000000-0000-0000-0000-000000000002'::uuid;
    RAISE EXCEPTION '[FALHA DE SEGURANÇA] Admin A conseguiu alterar role em tenant_users diretamente!';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '[PASS] Admin A bloqueado de UPDATE em tenant_users (read-only no browser).';
END $$;

-- 2.4 Bloqueio de escrita direta em orders (Read-Only no browser)
DO $$
BEGIN
    INSERT INTO public.orders (order_number, tenant_id, customer, shipping_address, items, subtotal, total)
    VALUES ('PED-HACK', 'a0000000-0000-0000-0000-000000000001'::uuid, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 0);
    RAISE EXCEPTION '[FALHA DE SEGURANÇA] Admin A conseguiu inserir diretamente em orders!';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '[PASS] Admin A bloqueado de INSERT em orders (read-only no browser).';
END $$;

-- 2.5 Bloqueio de alteração direta de plan e status em public.tenants
DO $$
BEGIN
    UPDATE public.tenants SET plan = 'enterprise', status = 'active' WHERE id = 'a0000000-0000-0000-0000-000000000001'::uuid;
    RAISE EXCEPTION '[FALHA DE SEGURANÇA] Admin A conseguiu fazer UPDATE em public.tenants!';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '[PASS] Admin A bloqueado de alterar plan/status em public.tenants.';
END $$;

-- 2.6 UPDATE em tenant_public_settings: permitido em colunas visuais, BLOQUEADO em slug/tenant_id
DO $$
BEGIN
    -- Permitido atualizar colunas visuais (SUCESSO)
    UPDATE public.tenant_public_settings 
    SET public_name = 'Alpha Renomeada', primary_color = '#ff0000'
    WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid;

    RAISE NOTICE '[PASS] Admin A atualizou configurações visuais permitidas.';

    -- Tentativa de atualizar slug (DEVE FALHAR COM INSUFFICIENT PRIVILEGE)
    BEGIN
        UPDATE public.tenant_public_settings SET slug = 'novo-slug-arbitrario'
        WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid;
        RAISE EXCEPTION '[FALHA DE SEGURANÇA] Admin A conseguiu alterar coluna slug protegida!';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE '[PASS] Admin A impedido de atualizar slug em tenant_public_settings (coluna restrita).';
    END;
END $$;


-- -------------------------------------------------------------------------
-- TESTE 3: TENANT ADMIN B (ISOLAMENTO INVERSO)
-- -------------------------------------------------------------------------
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';

DO $$
DECLARE
    v_count_a INTEGER;
    v_count_b INTEGER;
BEGIN
    SELECT count(*) INTO v_count_a FROM public.tenants WHERE id = 'a0000000-0000-0000-0000-000000000001'::uuid;
    SELECT count(*) INTO v_count_b FROM public.tenants WHERE id = 'b0000000-0000-0000-0000-000000000002'::uuid;

    IF v_count_b <> 1 OR v_count_a <> 0 THEN
        RAISE EXCEPTION '[FALHA DE ISOLAMENTO] Admin B não deve visualizar Tenant A.';
    END IF;
    RAISE NOTICE '[PASS] Isolamento inverso confirmado: Admin B lê apenas Tenant B.';
END $$;


-- -------------------------------------------------------------------------
-- TESTE 4: SALES REP (VENDEDOR ALPHA)
-- -------------------------------------------------------------------------
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'a2000000-0000-0000-0000-000000000002';

-- 4.1 Lê apenas pedidos próprios com seller_id = auth.uid()
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT count(*) INTO v_count FROM public.orders;
    IF v_count <> 1 THEN
        RAISE EXCEPTION '[FALHA] Sales Rep deveria ver exatamente seu próprio pedido (Contagem: %)', v_count;
    END IF;
    RAISE NOTICE '[PASS] Sales Rep visualiza apenas seus próprios pedidos (seller_id = auth.uid()).';
END $$;

-- 4.2 Não possui acesso a pedidos de outro vendedor mesmo no mesmo tenant
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT count(*) INTO v_count FROM public.orders WHERE seller_id <> 'a2000000-0000-0000-0000-000000000002'::uuid;
    IF v_count > 0 THEN
        RAISE EXCEPTION '[FALHA DE SEGURANÇA] Sales Rep conseguiu visualizar pedidos de outro vendedor!';
    END IF;
    RAISE NOTICE '[PASS] Sales Rep não acessa pedidos de outros vendedores.';
END $$;


-- -------------------------------------------------------------------------
-- TESTE 5: STOCK MANAGER (ESTOQUISTA ALPHA)
-- -------------------------------------------------------------------------
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'a3000000-0000-0000-0000-000000000003';

-- 5.1 Lê produtos do tenant
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT count(*) INTO v_count FROM public.products WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid;
    IF v_count < 1 THEN
        RAISE EXCEPTION '[FALHA] Stock Manager deveria ler produtos do Tenant A.';
    END IF;
    RAISE NOTICE '[PASS] Stock Manager lê produtos do Tenant A com sucesso.';
END $$;

-- 5.2 Não pode realizar UPDATE geral de produtos
DO $$
BEGIN
    UPDATE public.products SET price = 999.00 WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid;
    -- RLS deve impedir a atualização (0 linhas afetadas)
    IF FOUND THEN
        RAISE EXCEPTION '[FALHA DE SEGURANÇA] Stock Manager conseguiu atualizar produtos pelo UPDATE geral!';
    END IF;
    RAISE NOTICE '[PASS] Stock Manager impedido de UPDATE geral de produtos (0 linhas afetadas por RLS).';
END $$;

-- 5.3 Lê pedidos para separação
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT count(*) INTO v_count FROM public.orders WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid;
    IF v_count < 1 THEN
        RAISE EXCEPTION '[FALHA] Stock Manager deveria visualizar pedidos do Tenant A para despacho.';
    END IF;
    RAISE NOTICE '[PASS] Stock Manager visualiza pedidos do Tenant A para separação/logística.';
END $$;

-- 5.4 Não pode alterar orders diretamente
DO $$
BEGIN
    UPDATE public.orders SET status = 'delivered' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid;
    RAISE EXCEPTION '[FALHA DE SEGURANÇA] Stock Manager conseguiu atualizar orders diretamente!';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '[PASS] Stock Manager impedido de UPDATE direto em orders.';
END $$;


-- -------------------------------------------------------------------------
-- TESTE 6: PLATFORM ADMIN (MASTER)
-- -------------------------------------------------------------------------
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'f0000000-0000-0000-0000-000000000001';

DO $$
DECLARE
    v_count_tenants INTEGER;
BEGIN
    SELECT count(*) INTO v_count_tenants FROM public.tenants;
    IF v_count_tenants < 2 THEN
        RAISE EXCEPTION '[FALHA] Platform Admin deveria enxergar todos os tenants. Encontrados: %', v_count_tenants;
    END IF;
    RAISE NOTICE '[PASS] Platform Admin visualiza todos os tenants da plataforma (Contagem: %).', v_count_tenants;
END $$;


-- -------------------------------------------------------------------------
-- TESTE 7: INTEGRIDADE REFERENCIAL CROSS-TENANT (DATABASE ENGINE)
-- -------------------------------------------------------------------------
RESET ROLE;

-- 7.1 Violação de integridade: Pedido do Tenant A referenciando vendedor do Tenant B
DO $$
BEGIN
    INSERT INTO public.orders (
        order_number, tenant_id, seller_id, customer, shipping_address, items, subtotal, total, idempotency_key
    ) VALUES (
        'PED-CROSS-FAIL',
        'a0000000-0000-0000-0000-000000000001'::uuid, -- Tenant A
        'b2000000-0000-0000-0000-000000000002'::uuid, -- Vendedor do Tenant B!
        '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 10.00, 10.00, gen_random_uuid()
    );
    RAISE EXCEPTION '[FALHA DE INTEGRIDADE] Banco de dados permitiu vendedor cross-tenant em pedido!';
EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE '[PASS] Integridade referencial composta fk_orders_tenant_seller rejeitou vendedor de outro tenant.';
END $$;

DO $$
BEGIN
    RAISE NOTICE '=======================================================';
    RAISE NOTICE 'TODAS AS ASSERÇÕES DE RLS E INTEGRIDADE FORAM APROVADAS COM SUCESSO!';
    RAISE NOTICE '=======================================================';
END $$;

ROLLBACK; -- Garante que o banco permaneça 100% inalterado após a execução dos testes
