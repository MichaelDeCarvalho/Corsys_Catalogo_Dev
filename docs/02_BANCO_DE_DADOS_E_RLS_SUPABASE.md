# 🗄️ 02. Banco de Dados & RLS Supabase

> **Documento Normativo e Arquitetura de Dados (Etapa 3.2.1 - Patch Final Pré-Homologação)**  
> **Status:** Migration pronta e blindada, aguardando primeiro run no Supabase V2 (v2.3.1)  
> **Arquivo de Migration Oficial:** `supabase/migrations/20260902_000001_initial_schema.sql` (v2.3.1)  
> **Suíte de Testes Automatizada:** `supabase/tests/01_rls_security_test.sql`  
> **Registro de Decisão Arquitetural:** `docs/adr/ADR_001_MULTI_TENANCY_RLS_AUTHORIZATION.md`  
> **Aplica-se a:** Supabase PostgreSQL V2 / PostgREST / RLS Engine  
> 
> **⚠️ DECLARAÇÃO CRÍTICA DE STATUS DO AMBIENTE:**
> - As políticas de RLS, grants e constraints estão formalmente escritas e revisadas estaticamente na migration, mas **ainda NÃO foram testadas em banco de dados real**.
> - A migration oficial **ainda NÃO foi executada no Supabase V2 remoto**.
> - Todas as operações em `orders` são **estritamente read-only via browser** nesta fase.
> - A gestão de membros (`tenant_users`) é **estritamente read-only via browser** nesta fase.
> - Parâmetros contratuais como `plan` e `status` em `tenants` são gerenciados **exclusivamente server-side**.
> - Atualizações operacionais de estoque por `stock_manager` serão implementadas em etapa posterior.
> - O fluxo de checkout e cálculo de pedidos será executado **exclusivamente server-side** (via Edge Function ou RPC segura).
> - Supabase Storage (criação de buckets, policies de upload) **continua pendente** para etapa posterior.

---

## 1. Diagrama de Relacionamento de Entidades (ERD V2 Hardened)

```text
┌──────────────────────────────────────┐
│           platform_admins            │ (SuperAdmins Globais do SaaS Master)
├──────────────────────────────────────┤
│ id (PK, UUID -> auth.users.id)       │
│ email (UNIQUE), full_name            │
│ created_at                           │
│ [READ-ONLY NO BROWSER (auth.uid())]  │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐       ┌──────────────────────────────────────┐
│               tenants                │ 1   1 │        tenant_public_settings        │
├──────────────────────────────────────┼───────┼──────────────────────────────────────┤
│ id (PK, UUID)                        │       │ tenant_id (PK, FK -> tenants.id)     │
│ slug (CANÔNICO, UNIQUE)              ├───────► slug (SINCRONIZADO VIA TRIGGER)      │
│ name, trade_name                     │       │ public_name, whatsapp_number         │
│ cnpj_cpf, owner_email, owner_phone   │       │ logo_url, banner_url                 │
│ owner_name, plan, status             │       │ primary_color, accent_color          │
│ custom_domain (UNIQUE)               │       │ min_order_value, allow_b2b_mode      │
│ created_at, updated_at               │       │ hide_prices_without_login            │
│ [READ-ONLY NO BROWSER: PLAN/STATUS]  │       │ delivery_methods (JSONB)             │
└──────────────────┬───────────────────┘       │ [PIX_KEY REMOVIDO DESTA SUPERFÍCIE]  │
                   │                           └──────────────────────────────────────┘
                   │ 1
       ┌───────────┴───────────┐
       │ 1                     │ 1
       │ N                     │ N
┌──────▼───────────────────────▼───────┐       ┌──────────────────────────────────────┐
│               products               │       │             tenant_users             │
├──────────────────────────────────────┤       ├──────────────────────────────────────┤
│ id (PK, UUID)                        │       │ id (PK, UUID -> auth.users.id)       │
│ tenant_id (FK -> tenants.id)         │       │ tenant_id (FK -> tenants.id)         │
│ name, sku, barcode, category         │       │ role (tenant_admin, sales_rep,       │
│ subcategory, brand, description      │       │       stock_manager)                 │
│ technical_specs (JSONB)              │       │ name, email, phone, seller_code      │
│ cost_price (REVOGADO ANON)           │       │ commission_rate, active, permissions │
│ price, promotional_price             │       │ UNIQUE(tenant_id, id)  ◄─────────────┤
│ wholesale_price, min_order_quantity  │       │ UNIQUE(tenant_id, email)             │
│ stock, unit, images (TEXT[])         │       │ [READ-ONLY NO BROWSER: SEM ESCRITA]  │
│ featured, is_new, active, sort_order │       └──────────────────┬───────────────────┘
│ created_at, updated_at, deleted_at   │                          │ 1
│ UNIQUE(tenant_id, sku)               │                          │
│ [UPDATE: EXCLUSIVO TENANT_ADMIN]     │                          │ N (Opcional - seller_id)
└──────────────────┬───────────────────┘                          │
                   │ 1                                            │
                   │                                              │
                   │ N                                            │
┌──────────────────▼───────────────────┐       ┌──────────────────▼───────────────────┐
│           wholesale_tiers            │       │                orders                │
├──────────────────────────────────────┤       ├──────────────────────────────────────┤
│ id (PK, UUID)                        │       │ id (PK, UUID)                        │
│ product_id (FK -> products.id)       │       │ order_number, tenant_id (FK)         │
│ min_quantity, price                  │       │ seller_id (UUID, NULLABLE)           │
│ discount_percentage                  │       │ seller_code (OPERACIONAL, NÃO-AUTH)  │
│ UNIQUE(product_id, min_quantity)     │       │ customer (JSONB), shipping_addr (JSONB)
└──────────────────────────────────────┘       │ items (JSONB), subtotal, discount    │
                                               │ shipping_fee, total, status          │
                                               │ payment_method, notes, source        │
                                               │ UNIQUE(tenant_id, order_number)      │
                                               │ FK(tenant_id, seller_id) ────────────►
                                               │ [READ-ONLY NO BROWSER: SEM ESCRITA]  │
                                               └──────────────────────────────────────┘
```

---

## 2. Hardening e Melhorias Implementadas na Etapa 3.1

| Componente | Estado Anterior (Etapa 3) | Estado Atual (Etapa 3.1 - Hardened) | Justificativa de Segurança e Engenharia |
| :--- | :--- | :--- | :--- |
| **View `catalog_products`** | Criada sem `security_invoker` e com `JOIN public.tenants`. | **`WITH (security_invoker = true)` sem JOIN em `tenants`.** Filtra via `private.is_tenant_active(p.tenant_id)`. | A view executa estritamente com os privilégios do chamador e não quebra para o perfil `anon` (que não tem SELECT em `tenants`). |
| **Validação de Tenant Ativo** | Policies públicas executavam `SELECT 1 FROM public.tenants` diretamente. | **Helper `private.is_tenant_active(UUID)` (SECURITY DEFINER, STABLE, search_path = '').** | Permite checagem booleana de atividade sem conceder SELECT de dados administrativos de tenants para anônimos. |
| **Grants Iniciais** | Concessões pontuais sem revogação global. | **`REVOKE ALL ... FROM anon, authenticated` em 100% das tabelas** seguido de concessões estritamente mínimas. | Aplicação rigorosa do princípio do menor privilégio (*Least Privilege*). Evita grants implícitos. |
| **Escrita em `tenant_users`** | Policies browser-side permitiam que tenant_admin fizesse INSERT/UPDATE/DELETE. | **Escrita direta bloqueada.** `tenant_users` é estritamente read-only via browser. | Impede alteração fraudulenta de roles, auto-promoção de privilégios ou invasão de tenants pelo console do navegador. |
| **Proteção de `tenants` (Plan/Status)** | Havia policy de UPDATE para tenant_admin. | **UPDATE direto removido.** `tenants` é read-only via browser. | Tenant admins não podem alterar plano de assinatura, status financeiro ou CNPJ via frontend. |
| **Permissões em `products`** | `stock_manager` possuía policy ampla de UPDATE de produtos. | **`stock_manager` removido do UPDATE de produtos.** Apenas `tenant_admin`. | Impede que estoquistas alterem preços, SKUs, categorias ou descrições. Operações específicas de estoque serão via RPC. |
| **Escrita em `orders`** | Havia policies de INSERT e UPDATE para funcionários. | **Toda escrita direta bloqueada.** `orders` é read-only via browser. | Nenhum cliente frontend pode fornecer valores financeiros, fretes ou status como autoridade. Checkout será via RPC/backend. |
| **Autorização de `sales_rep`** | Filtrava por `seller_id = auth.uid() OR seller_code = ...`. | **Filtra exclusivamente por `seller_id = auth.uid()`.** | `seller_code` não deve ser security boundary. Permanece apenas como metadado operacional. |
| **Integridade `seller_id` x `tenant_id`** | FK simples em `seller_id` permitia cross-tenant assignment. | **Constraint composta:** `FOREIGN KEY (tenant_id, seller_id) REFERENCES public.tenant_users(tenant_id, id) ON DELETE SET NULL`. | Garante em nível de banco de dados que um pedido jamais referencie um vendedor pertencente a outro tenant. |
| **Função `set_updated_at`** | Declarada com `SECURITY DEFINER`. | **Alterada para default (SECURITY INVOKER).** | Função de trigger simples não requer privilégios elevados. |
| **Policy `platform_admins`** | Chamava-se `select_self`, mas continha `OR is_platform_admin()`. | **Ajustada para estritamente `USING (id = auth.uid())`.** | Elimina divergência entre o nome da política e o escopo concedido. |
| **Políticas Públicas** | Utilizavam `TO public`. | **Substituído por `TO anon, authenticated`.** | Define explicitamente os papéis da Data API, evitando concessões em contextos de sistema. |
| **Chave PIX em Settings** | Colunas `pix_key` e `pix_key_type` em `tenant_public_settings`. | **Removidas da superfície pública nesta fase.** | Impede exposição de dados bancários/fiscais desnecessários até a implementação formal do checkout. |
| **Duplicidade de Slug** | `tenants.slug` e `tenant_public_settings.slug` existiam sem sincronização. | **`tenants.slug` é a fonte canônica.** Sincronizado via trigger `private.sync_tenant_slug()`. | Garante fonte única de verdade sem abrir mão da indexação pública direta de vitrine. |
| **DDL de Tabelas Estruturais** | Utilizava `CREATE TABLE IF NOT EXISTS`. | **Alterado para `CREATE TABLE` estrito.** | Garante que a migration falhe explicitamente caso exista drift estrutural no banco. |
| **Performance de RLS** | Chamadas diretas de funções helper. | **Padrão `(SELECT helper())` aplicado.** | Otimiza a avaliação do planejador PostgreSQL em queries com grande volume de linhas. |
| **Função `get_current_user_role`** | Declarada, mas não consumida. | **Removida da migration.** | Redução de superfície de ataque e código morto. |

---

## 3. Matriz de Grants Explícitos

```sql
-- 1. Revogação universal prévia
REVOKE ALL ON public.platform_admins, public.tenants, public.tenant_public_settings,
              public.tenant_users, public.products, public.wholesale_tiers, public.orders 
FROM anon, authenticated, service_role;

REVOKE ALL ON public.catalog_products FROM PUBLIC, anon, authenticated, service_role;

-- 2. Concessões para 'anon'
GRANT SELECT ON public.tenant_public_settings TO anon;
GRANT SELECT (
    id, tenant_id, name, sku, barcode, category, subcategory, brand,
    description, technical_specs, price, promotional_price, wholesale_price,
    min_order_quantity, stock, unit, images, featured, is_new, active,
    sort_order, created_at, updated_at, deleted_at
) ON public.products TO anon;
GRANT SELECT ON public.catalog_products TO anon;
GRANT SELECT ON public.wholesale_tiers TO anon;

-- 3. Concessões para 'authenticated'
GRANT SELECT ON public.platform_admins TO authenticated;
GRANT SELECT ON public.tenants TO authenticated;
GRANT SELECT ON public.tenant_public_settings TO authenticated;
GRANT UPDATE (
    public_name, whatsapp_number, logo_url, banner_url,
    primary_color, accent_color, min_order_value, allow_b2b_mode,
    hide_prices_without_login, delivery_methods
) ON public.tenant_public_settings TO authenticated;
GRANT SELECT ON public.tenant_users TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.products TO authenticated;
GRANT SELECT ON public.catalog_products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wholesale_tiers TO authenticated;
GRANT SELECT ON public.orders TO authenticated;

-- 4. Concessões para 'service_role' (exclusivamente server-side / Edge Functions / RPC)
-- Permanece sem privilégios antecipados nesta migration inicial (deny-by-default).
-- Privilégios específicos serão introduzidos em migrations futuras acompanhando cada fluxo server-side.
```

---

## 4. Estratégia da View `catalog_products` e Proteção de `cost_price`

A view pública é definida como:
```sql
CREATE OR REPLACE VIEW public.catalog_products
WITH (security_invoker = true)
AS
SELECT 
    p.id, p.tenant_id, p.name, p.sku, p.barcode, p.category, p.subcategory,
    p.brand, p.description, p.technical_specs, p.price, p.promotional_price,
    p.wholesale_price, p.min_order_quantity, p.stock, p.unit, p.images,
    p.featured, p.is_new, p.sort_order, p.created_at, p.updated_at
FROM public.products p
WHERE p.active = true 
  AND p.deleted_at IS NULL
  AND private.is_tenant_active(p.tenant_id);
```

### Por que esta abordagem é segura?
1. **`WITH (security_invoker = true)`:** A consulta à view é executada com o contexto e permissões do usuário que fez a requisição (e não do dono/postgres).
2. **Sem JOIN em `public.tenants`:** O usuário `anon` não possui permissão de leitura em `public.tenants`. O filtro é realizado via `private.is_tenant_active(UUID)`, uma função `SECURITY DEFINER` que avalia unicamente se a loja está com status `'active'`.
3. **Exclusão Absoluta de `cost_price`:** A coluna de preço de custo não consta na view, e qualquer tentativa de forçar a leitura via REST sobre a tabela base resulta em erro `42501 (permission denied for column cost_price)` emitido pelo PostgreSQL.

---

## 5. Documentos Relacionados

* **Migration SQL Hardened:** `supabase/migrations/20260902_000001_initial_schema.sql`
* **Suíte de Testes Automatizada de RLS:** `supabase/tests/01_rls_security_test.sql`
* **Registro de Decisão Arquitetural (ADR):** `docs/adr/ADR_001_MULTI_TENANCY_RLS_AUTHORIZATION.md`
* **Matriz de Testes e Asserções de Segurança:** `docs/08_RLS_TEST_MATRIX.md` (e `docs/08_MATRIZ_DE_TESTES_RLS.md`)
* **Gestão de Produtos e Imagens:** `docs/09_GESTAO_DE_PRODUTOS_E_IMAGENS.md`
