-- =========================================================================
-- CORSYS CATÁLOGO B2B / B2C MULTI-TENANT - SCHEMA INICIAL & RLS V2 (HARDENED)
-- Arquivo: supabase/migrations/20260902_000001_initial_schema.sql
-- Versão: 2.3.1 — Patch Final Pré-Homologação
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. EXTENSÕES & SCHEMAS INTERNOS
-- -------------------------------------------------------------------------

-- Habilita extensão criptográfica para geração de UUID v4
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Schema interno dedicado a funções de autorização e triggers.
-- Não exposto na API REST pública do PostgREST / Supabase Data API.
CREATE SCHEMA IF NOT EXISTS private;

-- Revoga acesso ao schema interno de perfis públicos
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO anon, authenticated;

-- -------------------------------------------------------------------------
-- 1. TABELA DE ADMINISTRADORES GLOBAIS DA PLATAFORMA (PLATFORM_ADMINS)
-- -------------------------------------------------------------------------
-- Isola os SuperAdmins da plataforma SaaS dos usuários comuns de tenants.
-- SuperAdmins não são membros de um tenant específico.
CREATE TABLE public.platform_admins (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_admins IS 'Administradores globais da plataforma SaaS (Painel Master). Isola privilégios do contexto multi-tenant.';

-- -------------------------------------------------------------------------
-- 2. TABELA DE EMPRESAS (TENANTS) - DADOS ADMINISTRATIVOS PRIVADOS
-- -------------------------------------------------------------------------
-- Contém dados cadastrais, contratuais e fiscais sensíveis.
-- Usuários anônimos NÃO possuem acesso SELECT a esta tabela.
CREATE TABLE public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    trade_name TEXT,
    cnpj_cpf TEXT,
    owner_email TEXT NOT NULL,
    owner_phone TEXT,
    owner_name TEXT,
    plan TEXT NOT NULL DEFAULT 'pro' CHECK (plan IN ('starter', 'pro', 'enterprise')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trial', 'suspended', 'cancelled')),
    custom_domain TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tenants IS 'Entidade principal de multi-tenancy com dados fiscais e administrativos privados.';

-- -------------------------------------------------------------------------
-- 3. TABELA DE CONFIGURAÇÕES PÚBLICAS DO TENANT (TENANT_PUBLIC_SETTINGS)
-- -------------------------------------------------------------------------
-- Dados estritamente necessários para renderização da loja pública / catálogo.
-- NÃO expõe CNPJ, dados de faturamento, contatos pessoais do dono ou chave PIX nesta etapa.
-- O slug é canônico em public.tenants e sincronizado automaticamente via trigger.
CREATE TABLE public.tenant_public_settings (
    tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    slug TEXT UNIQUE NOT NULL,
    public_name TEXT NOT NULL,
    whatsapp_number TEXT NOT NULL,
    logo_url TEXT,
    banner_url TEXT,
    primary_color TEXT NOT NULL DEFAULT '#0284c7',
    accent_color TEXT NOT NULL DEFAULT '#0f172a',
    min_order_value NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (min_order_value >= 0),
    allow_b2b_mode BOOLEAN NOT NULL DEFAULT true,
    hide_prices_without_login BOOLEAN NOT NULL DEFAULT false,
    delivery_methods JSONB NOT NULL DEFAULT '{"pickup": true, "carrierDelivery": true, "fixedFreight": true, "fixedFreightValue": 35.00, "freeFreightThreshold": 1000.00}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tenant_public_settings IS 'Configurações visuais e regras públicas de storefront. Não expõe dados fiscais nem PIX nesta fase.';

-- -------------------------------------------------------------------------
-- 4. TABELA DE USUÁRIOS E EQUIPE DO TENANT (TENANT_USERS)
-- -------------------------------------------------------------------------
-- Membros de cada loja com papéis funcionais específicos.
-- Possui constraint de unicidade composta (tenant_id, id) para integridade relacional com orders.
CREATE TABLE public.tenant_users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'sales_rep' CHECK (role IN ('tenant_admin', 'sales_rep', 'stock_manager')),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    seller_code TEXT,
    commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (commission_rate >= 0.00 AND commission_rate <= 100.00),
    active BOOLEAN NOT NULL DEFAULT true,
    permissions JSONB NOT NULL DEFAULT '{"canEditProducts": true, "canManageOrders": true, "canManageTeam": false, "canViewReports": true}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, id),
    UNIQUE(tenant_id, email)
);

COMMENT ON TABLE public.tenant_users IS 'Associação entre auth.users e tenants com definição de roles (tenant_admin, sales_rep, stock_manager). Read-only no browser.';

-- -------------------------------------------------------------------------
-- 5. TABELA DE PRODUTOS (PRODUCTS)
-- -------------------------------------------------------------------------
-- Catálogo de produtos isolado por tenant com restrições rígidas de integridade.
CREATE TABLE public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sku TEXT NOT NULL,
    barcode TEXT,
    category TEXT NOT NULL,
    subcategory TEXT,
    brand TEXT DEFAULT 'MC Distribuição',
    description TEXT,
    technical_specs JSONB NOT NULL DEFAULT '{}'::jsonb,
    cost_price NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (cost_price >= 0.00),
    price NUMERIC(10,2) NOT NULL CHECK (price >= 0.00),
    promotional_price NUMERIC(10,2) CHECK (promotional_price >= 0.00),
    wholesale_price NUMERIC(10,2) CHECK (wholesale_price >= 0.00),
    min_order_quantity INTEGER NOT NULL DEFAULT 1 CHECK (min_order_quantity >= 1),
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    unit TEXT NOT NULL DEFAULT 'un',
    images TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    featured BOOLEAN NOT NULL DEFAULT false,
    is_new BOOLEAN NOT NULL DEFAULT false,
    active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    UNIQUE(tenant_id, sku)
);

COMMENT ON TABLE public.products IS 'Catálogo de produtos com chave composta única (tenant_id, sku) e controle de auditoria/soft delete.';

-- -------------------------------------------------------------------------
-- 6. TABELA DE FAIXAS DE PREÇO POR QUANTIDADE (WHOLESALE_TIERS)
-- -------------------------------------------------------------------------
-- Precificação progressiva para pedidos B2B / atacado vinculada a cada produto.
CREATE TABLE public.wholesale_tiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    min_quantity INTEGER NOT NULL CHECK (min_quantity >= 1),
    price NUMERIC(10,2) NOT NULL CHECK (price >= 0.00),
    discount_percentage NUMERIC(5,2) CHECK (discount_percentage >= 0.00 AND discount_percentage <= 100.00),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(product_id, min_quantity)
);

COMMENT ON TABLE public.wholesale_tiers IS 'Regras progressivas de preços por volume para venda atacado (B2B).';

-- -------------------------------------------------------------------------
-- 7. TABELA DE PEDIDOS E COTAÇÕES (ORDERS)
-- -------------------------------------------------------------------------
-- Pedidos gerados via vendedor ou checkout validado server-side.
-- Integridade composta (tenant_id, seller_id) garante que um pedido jamais referencie vendedor de outro tenant.
CREATE TABLE public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT NOT NULL,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    seller_id UUID,
    seller_code TEXT,
    customer JSONB NOT NULL,
    shipping_address JSONB NOT NULL,
    items JSONB NOT NULL,
    subtotal NUMERIC(10,2) NOT NULL CHECK (subtotal >= 0.00),
    discount NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (discount >= 0.00),
    shipping_fee NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (shipping_fee >= 0.00),
    total NUMERIC(10,2) NOT NULL CHECK (total >= 0.00),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'preparing', 'dispatched', 'delivered', 'cancelled')),
    payment_method TEXT NOT NULL DEFAULT 'pix' CHECK (payment_method IN ('pix', 'boleto', 'credit_card', 'cash_on_delivery')),
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'whatsapp' CHECK (source IN ('sales_rep', 'whatsapp', 'web_checkout')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, order_number),
    CONSTRAINT fk_orders_tenant_seller FOREIGN KEY (tenant_id, seller_id) REFERENCES public.tenant_users(tenant_id, id) ON DELETE SET NULL (seller_id)
);

COMMENT ON TABLE public.orders IS 'Pedidos e cotações. Integridade composta seller_id x tenant_id. Read-only no browser.';

-- -------------------------------------------------------------------------
-- 8. FUNÇÕES AUXILIARES DE AUTORIZAÇÃO (SCHEMA PRIVATE)
-- -------------------------------------------------------------------------

-- Helper 1: Verifica se um tenant está ativo sem expor dados administrativos
CREATE OR REPLACE FUNCTION private.is_tenant_active(p_tenant_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.tenants t 
    WHERE t.id = p_tenant_id 
      AND t.status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = '';

COMMENT ON FUNCTION private.is_tenant_active(UUID) IS 'Retorna true se o tenant existir e possuir status ativo. Usado em policies públicas.';

-- Helper 2: Recupera o tenant_id associado ao usuário logado
CREATE OR REPLACE FUNCTION private.get_current_tenant_id()
RETURNS UUID AS $$
BEGIN
  RETURN (
    SELECT u.tenant_id 
    FROM public.tenant_users u
    INNER JOIN public.tenants t ON t.id = u.tenant_id
    WHERE u.id = auth.uid() 
      AND u.active = true
      AND t.status = 'active'
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = '';

COMMENT ON FUNCTION private.get_current_tenant_id() IS 'Retorna o UUID do tenant ativo do usuário autenticado a partir de tenant_users.';

-- Helper 3: Verifica se o usuário autenticado possui uma das roles especificadas
CREATE OR REPLACE FUNCTION private.has_tenant_role(required_roles TEXT[])
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.tenant_users u
    WHERE u.id = auth.uid() 
      AND u.active = true
      AND u.role = ANY(required_roles)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = '';

COMMENT ON FUNCTION private.has_tenant_role(TEXT[]) IS 'Verifica se o usuário logado possui uma das roles requeridas.';

-- Helper 4: Verifica se o usuário autenticado é um SuperAdmin global da plataforma
CREATE OR REPLACE FUNCTION private.is_platform_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.platform_admins a
    WHERE a.id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = '';

COMMENT ON FUNCTION private.is_platform_admin() IS 'Verifica se auth.uid() é cadastrado na tabela platform_admins.';

-- Helper 5: Trigger para atualização automática da coluna updated_at (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION private.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- Helper 6: Sincronização do slug canônico de tenants para tenant_public_settings
-- Garante em nível de banco que tenant_public_settings.slug sempre é derivado de public.tenants.slug
CREATE OR REPLACE FUNCTION private.sync_tenant_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug THEN
    UPDATE public.tenant_public_settings 
    SET slug = NEW.slug 
    WHERE tenant_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- Helper 7: Derivação forçada do slug canônico no INSERT/UPDATE de tenant_public_settings
-- O fluxo é unidirecional: public.tenants.slug -> public.tenant_public_settings.slug
CREATE OR REPLACE FUNCTION private.enforce_tenant_public_settings_slug()
RETURNS TRIGGER AS $$
DECLARE
  v_canonical_slug TEXT;
BEGIN
  SELECT slug INTO v_canonical_slug
  FROM public.tenants
  WHERE id = NEW.tenant_id;

  IF v_canonical_slug IS NULL THEN
    RAISE EXCEPTION 'Tenant % não encontrado para associar configurações públicas.', NEW.tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Força o slug de tenant_public_settings a ser rigorosamente igual ao canônico em tenants
  NEW.slug := v_canonical_slug;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- Triggers de updated_at
CREATE TRIGGER trg_tenants_updated_at
BEFORE UPDATE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER trg_tenant_public_settings_updated_at
BEFORE UPDATE ON public.tenant_public_settings
FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER trg_tenant_users_updated_at
BEFORE UPDATE ON public.tenant_users
FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER trg_orders_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- Trigger de sincronização de slug em tenants (quando o slug canônico mudar)
CREATE TRIGGER trg_tenants_sync_slug
AFTER UPDATE OF slug ON public.tenants
FOR EACH ROW EXECUTE FUNCTION private.sync_tenant_slug();

-- Trigger de derivação/garantia de slug canônico em tenant_public_settings (INSERT ou UPDATE)
CREATE TRIGGER trg_tenant_public_settings_enforce_slug
BEFORE INSERT OR UPDATE OF slug, tenant_id ON public.tenant_public_settings
FOR EACH ROW EXECUTE FUNCTION private.enforce_tenant_public_settings_slug();

-- -------------------------------------------------------------------------
-- 9. PERMISSÕES DE EXECUÇÃO EM FUNÇÕES (HARDENING SECURITY DEFINER)
-- -------------------------------------------------------------------------

-- Revoga execução ampla de todas as funções do schema private
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.is_tenant_active(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.get_current_tenant_id() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.has_tenant_role(TEXT[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.is_platform_admin() FROM PUBLIC, anon, authenticated, service_role;

-- Hardening de privilégios padrão: Deny-by-default para schemas private e public
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES
FROM anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS
FROM anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE USAGE, SELECT ON SEQUENCES
FROM anon, authenticated, service_role;

-- is_tenant_active é pública (retorna apenas booleano) para viabilizar RLS anônimo na vitrine
GRANT EXECUTE ON FUNCTION private.is_tenant_active(UUID) TO anon, authenticated;

-- Helpers de contexto interno e autorização concedidos estritamente a authenticated
GRANT EXECUTE ON FUNCTION private.get_current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_tenant_role(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_platform_admin() TO authenticated;

-- -------------------------------------------------------------------------
-- 10. VIEW PÚBLICA DE PRODUTOS (CATALOG_PRODUCTS - SECURITY INVOKER)
-- -------------------------------------------------------------------------
-- Executa sob os privilégios do chamador (security_invoker = true).
-- Não faz JOIN com tenants para não falhar sob anon. Utiliza private.is_tenant_active().
-- O RLS de products atua naturalmente sobre os registros consultados.
CREATE OR REPLACE VIEW public.catalog_products
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
    p.wholesale_price,
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

COMMENT ON VIEW public.catalog_products IS 'Visão pública sanitizada com security_invoker = true. Não expõe cost_price e filtra por tenant ativo.';

-- -------------------------------------------------------------------------
-- 11. ÍNDICES DE PERFORMANCE E CONSULTAS RLS
-- -------------------------------------------------------------------------

-- Tenants
CREATE INDEX IF NOT EXISTS idx_tenants_status ON public.tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_custom_domain ON public.tenants(custom_domain) WHERE custom_domain IS NOT NULL;

-- Configurações Públicas
-- Nota de otimização: idx_tenant_public_settings_slug omitido pois slug já possui constraint UNIQUE implícita.

-- Usuários e Equipe
CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_role ON public.tenant_users(tenant_id, role);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_users_tenant_seller_code ON public.tenant_users(tenant_id, seller_code) WHERE seller_code IS NOT NULL;

-- Produtos
CREATE INDEX IF NOT EXISTS idx_products_tenant_active ON public.products(tenant_id, active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_tenant_category ON public.products(tenant_id, category) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_tenant_sort ON public.products(tenant_id, sort_order) WHERE deleted_at IS NULL;

-- Faixas de Atacado
-- Nota de otimização: idx_wholesale_tiers_product_id omitido pois UNIQUE(product_id, min_quantity) já indexa product_id como coluna condutora.

-- Pedidos
CREATE INDEX IF NOT EXISTS idx_orders_tenant_status ON public.orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_created ON public.orders(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_seller ON public.orders(tenant_id, seller_id) WHERE seller_id IS NOT NULL;

-- -------------------------------------------------------------------------
-- 12. ATIVAÇÃO DE ROW LEVEL SECURITY (RLS) EM TODAS AS TABELAS
-- -------------------------------------------------------------------------

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_public_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------------------
-- 13. GRANTS EXPLÍCITOS (LEAST PRIVILEGE + COLUNAS SENSÍVEIS PROTEGIDAS)
-- -------------------------------------------------------------------------

-- Revoga todos os privilégios amplos pré-existentes de todas as tabelas
REVOKE ALL ON public.platform_admins FROM anon, authenticated, service_role;
REVOKE ALL ON public.tenants FROM anon, authenticated, service_role;
REVOKE ALL ON public.tenant_public_settings FROM anon, authenticated, service_role;
REVOKE ALL ON public.tenant_users FROM anon, authenticated, service_role;
REVOKE ALL ON public.products FROM anon, authenticated, service_role;
REVOKE ALL ON public.wholesale_tiers FROM anon, authenticated, service_role;
REVOKE ALL ON public.orders FROM anon, authenticated, service_role;

-- Revoga privilégios prévios da view pública de catálogo
REVOKE ALL ON public.catalog_products FROM PUBLIC, anon, authenticated, service_role;

-- CONCESSÕES PARA 'ANON':
-- 1. Vitrine pública do tenant (configurações visuais)
GRANT SELECT ON public.tenant_public_settings TO anon;

-- 2. Produtos: concessão apenas em colunas públicas (incluindo deleted_at para avaliação de WHERE na view e policies).
-- cost_price É RIGOROSAMENTE EXCLUÍDO (segredo industrial).
GRANT SELECT (
    id, tenant_id, name, sku, barcode, category, subcategory, brand,
    description, technical_specs, price, promotional_price, wholesale_price,
    min_order_quantity, stock, unit, images, featured, is_new, active,
    sort_order, created_at, updated_at, deleted_at
) ON public.products TO anon;

-- 3. View pública do catálogo (Security Invoker, somente leitura)
GRANT SELECT ON public.catalog_products TO anon;

-- 4. Faixas públicas de atacado
GRANT SELECT ON public.wholesale_tiers TO anon;

-- CONCESSÕES PARA 'AUTHENTICATED':
-- 1. Platform Admins: leitura controlada por RLS
GRANT SELECT ON public.platform_admins TO authenticated;

-- 2. Tenants: somente leitura no browser (plan e status são geridos via server-side/RPC)
GRANT SELECT ON public.tenants TO authenticated;

-- 3. Tenant Public Settings: leitura completa e atualização restrita a colunas visuais pelo admin da loja
-- Bloqueados expressamente contra alteração direta: tenant_id, slug, created_at, updated_at
GRANT SELECT ON public.tenant_public_settings TO authenticated;
GRANT UPDATE (
    public_name,
    whatsapp_number,
    logo_url,
    banner_url,
    primary_color,
    accent_color,
    min_order_value,
    allow_b2b_mode,
    hide_prices_without_login,
    delivery_methods
) ON public.tenant_public_settings TO authenticated;

-- 4. Tenant Users: somente leitura no browser (convites e roles geridos via server-side/RPC)
GRANT SELECT ON public.tenant_users TO authenticated;

-- 5. Products: leitura completa (inclui cost_price para membros do tenant) e gestão por Tenant Admin (soft delete via UPDATE em deleted_at)
GRANT SELECT, INSERT, UPDATE ON public.products TO authenticated;
GRANT SELECT ON public.catalog_products TO authenticated;

-- 6. Wholesale Tiers: leitura e gestão por Tenant Admin
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wholesale_tiers TO authenticated;

-- 7. Orders: SOMENTE LEITURA no browser. Toda escrita é via RPC server-side na etapa de checkout.
GRANT SELECT ON public.orders TO authenticated;

-- CONCESSÕES PARA 'SERVICE_ROLE' (EXCLUSIVAMENTE SERVER-SIDE / EDGE FUNCTIONS / RPC):
-- Nesta migration inicial, service_role permanece sem privilégios de aplicação antecipados (deny-by-default).
-- Concessões específicas serão introduzidas futuramente junto com a homologação de cada fluxo server-side real.

-- -------------------------------------------------------------------------
-- 14. POLÍTICAS RLS - PLATFORM_ADMINS
-- -------------------------------------------------------------------------
-- Nenhuma escrita permitida via cliente browser.
-- Leitura permitida apenas para o próprio admin global autenticado.

CREATE POLICY "platform_admins_select_self"
ON public.platform_admins FOR SELECT
TO authenticated
USING (id = (SELECT auth.uid()));

-- -------------------------------------------------------------------------
-- 15. POLÍTICAS RLS - TENANTS
-- -------------------------------------------------------------------------
-- Usuários anônimos NÃO têm acesso a public.tenants.
-- Escrita bloqueada nesta fase para proteção de plan, status e billing.

CREATE POLICY "tenants_select_own"
ON public.tenants FOR SELECT
TO authenticated
USING (
  id = (SELECT private.get_current_tenant_id())
  OR (SELECT private.is_platform_admin())
);

-- -------------------------------------------------------------------------
-- 16. POLÍTICAS RLS - TENANT_PUBLIC_SETTINGS
-- -------------------------------------------------------------------------
-- Vitrine pública: anônimos e autenticados podem ler configurações visuais de lojas ativas.
-- Validação via private.is_tenant_active(tenant_id) sem depender de SELECT em tenants.

CREATE POLICY "tenant_public_settings_select_public"
ON public.tenant_public_settings FOR SELECT
TO anon, authenticated
USING (
  private.is_tenant_active(tenant_id)
);

CREATE POLICY "tenant_public_settings_update_admin"
ON public.tenant_public_settings FOR UPDATE
TO authenticated
USING (
  (tenant_id = (SELECT private.get_current_tenant_id()) AND (SELECT private.has_tenant_role(ARRAY['tenant_admin'])))
  OR (SELECT private.is_platform_admin())
)
WITH CHECK (
  (tenant_id = (SELECT private.get_current_tenant_id()) AND (SELECT private.has_tenant_role(ARRAY['tenant_admin'])))
  OR (SELECT private.is_platform_admin())
);

-- -------------------------------------------------------------------------
-- 17. POLÍTICAS RLS - TENANT_USERS (SOMENTE LEITURA VIA BROWSER)
-- -------------------------------------------------------------------------
-- Escrita direta pelo browser bloqueada nesta fase.
-- Membros, convites e modificações de roles serão implementados por RPC server-side segura.

CREATE POLICY "tenant_users_select_self"
ON public.tenant_users FOR SELECT
TO authenticated
USING (id = (SELECT auth.uid()));

CREATE POLICY "tenant_users_select_team"
ON public.tenant_users FOR SELECT
TO authenticated
USING (
  tenant_id = (SELECT private.get_current_tenant_id())
  AND (SELECT private.has_tenant_role(ARRAY['tenant_admin']))
);

CREATE POLICY "tenant_users_select_platform"
ON public.tenant_users FOR SELECT
TO authenticated
USING ((SELECT private.is_platform_admin()));

-- -------------------------------------------------------------------------
-- 18. POLÍTICAS RLS - PRODUCTS
-- -------------------------------------------------------------------------

-- 1) Leitura pública: produtos ativos de lojas ativas (soft deleted são ignorados)
-- Usa private.is_tenant_active(tenant_id)
CREATE POLICY "products_select_public"
ON public.products FOR SELECT
TO anon
USING (
  active = true 
  AND deleted_at IS NULL
  AND private.is_tenant_active(tenant_id)
);

-- 2) Leitura autenticada: membros do tenant (inclui inativos e cost_price para gestão interna)
CREATE POLICY "products_select_tenant"
ON public.products FOR SELECT
TO authenticated
USING (
  (tenant_id = (SELECT private.get_current_tenant_id()) AND deleted_at IS NULL)
  OR (SELECT private.is_platform_admin())
);

-- 3) Criação de produtos: apenas Tenant Admin
CREATE POLICY "products_insert_admin"
ON public.products FOR INSERT
TO authenticated
WITH CHECK (
  (tenant_id = (SELECT private.get_current_tenant_id()) AND (SELECT private.has_tenant_role(ARRAY['tenant_admin'])))
  OR (SELECT private.is_platform_admin())
);

-- 4) Atualização de produtos: apenas Tenant Admin (Stock Manager não tem UPDATE amplo de produtos)
CREATE POLICY "products_update_admin"
ON public.products FOR UPDATE
TO authenticated
USING (
  (tenant_id = (SELECT private.get_current_tenant_id()) AND (SELECT private.has_tenant_role(ARRAY['tenant_admin'])))
  OR (SELECT private.is_platform_admin())
)
WITH CHECK (
  (tenant_id = (SELECT private.get_current_tenant_id()) AND (SELECT private.has_tenant_role(ARRAY['tenant_admin'])))
  OR (SELECT private.is_platform_admin())
);

-- 5) Deleção de produtos: DELETE físico proibido via browser (sem concessão de DELETE e sem policy DELETE).
-- A exclusão de produtos é modelada como soft-delete via UPDATE de deleted_at por tenant_admin.

-- -------------------------------------------------------------------------
-- 19. POLÍTICAS RLS - WHOLESALE_TIERS
-- -------------------------------------------------------------------------

-- Leitura pública de faixas atreladas a produtos ativos de lojas ativas
CREATE POLICY "wholesale_tiers_select_public"
ON public.wholesale_tiers FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = wholesale_tiers.product_id
      AND p.active = true
      AND p.deleted_at IS NULL
      AND private.is_tenant_active(p.tenant_id)
  )
);

-- Leitura administrativa interna da loja
CREATE POLICY "wholesale_tiers_select_tenant"
ON public.wholesale_tiers FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = wholesale_tiers.product_id
      AND p.tenant_id = (SELECT private.get_current_tenant_id())
  )
  OR (SELECT private.is_platform_admin())
);

-- Gerenciamento de faixas: Tenant Admin
CREATE POLICY "wholesale_tiers_insert_admin"
ON public.wholesale_tiers FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = wholesale_tiers.product_id
      AND p.tenant_id = (SELECT private.get_current_tenant_id())
      AND (SELECT private.has_tenant_role(ARRAY['tenant_admin']))
  )
  OR (SELECT private.is_platform_admin())
);

CREATE POLICY "wholesale_tiers_update_admin"
ON public.wholesale_tiers FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = wholesale_tiers.product_id
      AND p.tenant_id = (SELECT private.get_current_tenant_id())
      AND (SELECT private.has_tenant_role(ARRAY['tenant_admin']))
  )
  OR (SELECT private.is_platform_admin())
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = wholesale_tiers.product_id
      AND p.tenant_id = (SELECT private.get_current_tenant_id())
      AND (SELECT private.has_tenant_role(ARRAY['tenant_admin']))
  )
  OR (SELECT private.is_platform_admin())
);

CREATE POLICY "wholesale_tiers_delete_admin"
ON public.wholesale_tiers FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = wholesale_tiers.product_id
      AND p.tenant_id = (SELECT private.get_current_tenant_id())
      AND (SELECT private.has_tenant_role(ARRAY['tenant_admin']))
  )
  OR (SELECT private.is_platform_admin())
);

-- -------------------------------------------------------------------------
-- 20. POLÍTICAS RLS - ORDERS (SOMENTE LEITURA VIA BROWSER)
-- -------------------------------------------------------------------------
-- Toda escrita direta (INSERT, UPDATE, DELETE) pelo browser é BLOQUEADA nesta fase.
-- O checkout público e atualizações operacionais serão executados via RPC / Edge Function
-- com validação server-side de integridade financeira, frete e estoque.

-- Leitura: Tenant Admin lê todos os pedidos da sua loja
CREATE POLICY "orders_select_tenant_admin"
ON public.orders FOR SELECT
TO authenticated
USING (
  (tenant_id = (SELECT private.get_current_tenant_id()) AND (SELECT private.has_tenant_role(ARRAY['tenant_admin'])))
  OR (SELECT private.is_platform_admin())
);

-- Leitura: Stock Manager lê pedidos para separação e despacho
CREATE POLICY "orders_select_stock_manager"
ON public.orders FOR SELECT
TO authenticated
USING (
  tenant_id = (SELECT private.get_current_tenant_id()) 
  AND (SELECT private.has_tenant_role(ARRAY['stock_manager']))
);

-- Leitura: Vendedor (Sales Rep) lê apenas pedidos onde seller_id = (SELECT auth.uid())
-- O seller_code NÃO concede acesso e é puramente operacional.
CREATE POLICY "orders_select_sales_rep"
ON public.orders FOR SELECT
TO authenticated
USING (
  tenant_id = (SELECT private.get_current_tenant_id())
  AND (SELECT private.has_tenant_role(ARRAY['sales_rep']))
  AND seller_id = (SELECT auth.uid())
);

-- Fim da migration 20260902_000001_initial_schema.sql (Hardened)
