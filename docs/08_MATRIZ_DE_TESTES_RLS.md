# 🛡️ 08. Matriz de Testes e Validação de RLS (Row Level Security)

> **Documento Normativo e Especificação de Testes de Segurança**  
> **Status:** Migration pronta para teste, ainda não executada no Supabase V2 (Etapa 3.2 - Validação Final Pré-Execução da Migration)  
> **Aplica-se a:** Supabase PostgreSQL V2 / PostgREST / RLS Engine  
> **Suíte Executável:** `supabase/tests/01_rls_security_test.sql`  
> **Registro de Decisão:** `docs/adr/ADR_001_MULTI_TENANCY_RLS_AUTHORIZATION.md`  
> **⚠️ AVISO DE ESTADO REAL:**
> - O RLS e as permissões estão formalmente definidos no arquivo de migration (`supabase/migrations/20260902_000001_initial_schema.sql`), mas **ainda NÃO foram testados em banco de dados real**.
> - A migration **ainda NÃO foi executada no Supabase V2**.
> - Todas as operações em `orders` são **estritamente read-only via browser** nesta fase.
> - A gestão de membros (`tenant_users`) é **estritamente read-only via browser** nesta fase.
> - Parâmetros contratuais como `plan` e `status` de `tenants` são geridos **exclusivamente server-side**.
> - Operações específicas de estoque por `stock_manager` serão implementadas em etapa posterior.
> - O checkout e a criação de pedidos serão implementados **exclusivamente server-side** (via Edge Function ou RPC segura).
> - Supabase Storage (buckets e upload de imagens) **continua pendente** para etapa posterior.

---

## 1. Princípios de Segurança e Modelo de Ameaça

A arquitetura de segurança do Corsys_Catálogo baseia-se em:
1. **Deny by Default com Grants Mínimos:** Nenhuma entidade concede acesso implícito. Antes de aplicar políticas, todos os privilégios amplos são revogados (`REVOKE ALL FROM anon, authenticated`). Somente operações estritamente necessárias são concedidas via `GRANT`.
2. **Isolamento Rígido Multi-Tenant:** Um tenant jamais pode ler, modificar, inserir ou excluir dados de outro tenant.
3. **Autenticação $\neq$ Autorização:** Estar autenticado no Supabase Auth (`auth.uid()`) não concede privilégios na loja. O acesso aos dados é condicionado ao vínculo ativo em `public.tenant_users` ou `public.platform_admins`.
4. **Proteção de Segredos Comerciais:** O preço de custo (`cost_price`) é protegido no nível da engine PostgreSQL (privilégios de coluna com revogação explícita para `anon`) e omitido na view pública `catalog_products`.
5. **View Pública com Security Invoker:** A view `public.catalog_products` utiliza `WITH (security_invoker = true)` e não executa com privilégios de superusuário/owner. Ela valida a atividade da loja via helper privado `private.is_tenant_active(tenant_id)` sem depender de `SELECT` direto em `public.tenants`.
6. **Prevenção de Fraude Financeira e de Cadastro:** Usuários autenticados e anônimos não podem forjar pedidos, alterar plano/status ou auto-promover cargos diretamente via browser.

---

## 2. Personas e Atores de Teste

| Persona | Identificação no Banco | Contexto / Tenant |
| :--- | :--- | :--- |
| **Anon (Visitante / Cliente)** | `auth.role() = 'anon'`, sem JWT de usuário | Público geral acessando a vitrine |
| **Admin Tenant A** | `auth.users(id_a1)`, `tenant_users(role='tenant_admin')` | Tenant A (`tenant-alpha-uuid`) |
| **Admin Tenant B** | `auth.users(id_b1)`, `tenant_users(role='tenant_admin')` | Tenant B (`tenant-beta-uuid`) |
| **Sales Rep (Vendedor A)** | `auth.users(id_a2)`, `tenant_users(role='sales_rep', seller_code='VEND01')` | Tenant A (`tenant-alpha-uuid`) |
| **Stock Manager (Estoque A)** | `auth.users(id_a3)`, `tenant_users(role='stock_manager')` | Tenant A (`tenant-alpha-uuid`) |
| **Platform Admin (Master)** | `auth.users(id_p1)`, `platform_admins(id_p1)` | Global (SaaS Master) |

---

## 3. Matriz Completa de Permissões por Tabela (Grants + RLS)

| Tabela / Objeto | Anon | Tenant Admin A | Tenant Admin B | Sales Rep A | Stock Manager A | Platform Admin |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `public.platform_admins` | ❌ REVOKE ALL | ❌ DENY | ❌ DENY | ❌ DENY | ❌ DENY | 👁️ Apenas próprio ID |
| `public.tenants` | ❌ REVOKE ALL | 👁️ Tenant A (Read-only) | 👁️ Tenant B (Read-only) | ❌ DENY | ❌ DENY | 👁️ Todos |
| `public.tenant_public_settings` | 👁️ Ativos | 👁️✏️ Tenant A (Visual cols) | 👁️✏️ Tenant B (Visual cols) | 👁️ Todos ativos | 👁️ Todos ativos | 👁️✏️ Tenant A & B |
| `public.tenant_users` | ❌ REVOKE ALL | 👁️ Equipe A (Read-only) | 👁️ Equipe B (Read-only) | 👁️ Próprio ID | 👁️ Próprio ID | 👁️ Todos |
| `public.products` (Tabela) | 👁️ Ativos (Sem cost_price) | 👁️✏️➕🗑️ Tenant A | 👁️✏️➕🗑️ Tenant B | 👁️ Tenant A | 👁️ Tenant A (Sem UPDATE) | 👁️✏️➕🗑️ Todos |
| `public.catalog_products` (View) | 👁️ Ativos | 👁️ Ativos | 👁️ Ativos | 👁️ Ativos | 👁️ Ativos | 👁️ Ativos |
| `public.wholesale_tiers` | 👁️ Ativos | 👁️✏️➕🗑️ Tenant A | 👁️✏️➕🗑️ Tenant B | 👁️ Tenant A | 👁️ Tenant A | 👁️✏️➕🗑️ Todos |
| `public.orders` | ❌ REVOKE ALL | 👁️ Tenant A (Read-only) | 👁️ Tenant B (Read-only) | 👁️ (seller_id = auth.uid()) | 👁️ Tenant A (Read-only) | 👁️ Todos |

*Legenda:*  
👁️ = `SELECT` | ✏️ = `UPDATE` (em `tenant_public_settings`, restrito à allowlist: `public_name, whatsapp_number, logo_url, banner_url, primary_color, accent_color, min_order_value, allow_b2b_mode, hide_prices_without_login, delivery_methods`; `tenant_id` e `slug` bloqueados) | ➕ = `INSERT` | 🗑️ = `DELETE` | ❌ REVOKE ALL / DENY = Acesso bloqueado por falta de Grant ou restrição RLS.

---

## 4. Cenários Detalhados de Teste por Persona

### 4.1. Cenários para Usuário Anônimo (Anon)

* **[ANON-01] Consulta de Catálogo Público:**
  * **Ação:** `SELECT id, name, price FROM public.catalog_products WHERE tenant_id = 'tenant-alpha-uuid';`
  * **Resultado Esperado:** **SUCESSO (200 OK)** — Retorna apenas produtos com `active = true`, `deleted_at IS NULL` de tenants com `status = 'active'`.
* **[ANON-02] Consulta de Configurações Visuais do Tenant:**
  * **Ação:** `SELECT public_name, logo_url, primary_color, delivery_methods FROM public.tenant_public_settings WHERE slug = 'loja-alpha';`
  * **Resultado Esperado:** **SUCESSO (200 OK)** — Retorna dados visuais permitidos.
* **[ANON-03] Consulta de Faixas de Atacado Públicas:**
  * **Ação:** `SELECT min_quantity, price, discount_percentage FROM public.wholesale_tiers WHERE product_id = 'prod-alpha-01';`
  * **Resultado Esperado:** **SUCESSO (200 OK)** — Retorna faixas de produtos públicos ativos.
* **[ANON-04] Bloqueio de Leitura em `public.tenants`:**
  * **Ação:** `SELECT * FROM public.tenants;`
  * **Resultado Esperado:** **DENY (42501 Permission Denied ou 0 linhas)** — Não há GRANT nem policy de SELECT para `anon`.
* **[ANON-05] Bloqueio de Leitura em `public.tenant_users`:**
  * **Ação:** `SELECT * FROM public.tenant_users;`
  * **Resultado Esperado:** **DENY (42501 Permission Denied ou 0 linhas)**.
* **[ANON-06] Bloqueio de Leitura em `public.orders`:**
  * **Ação:** `SELECT * FROM public.orders;`
  * **Resultado Esperado:** **DENY (42501 Permission Denied ou 0 linhas)**.
* **[ANON-07] Bloqueio de Inserção Direta em `public.orders`:**
  * **Ação:** `INSERT INTO public.orders (order_number, tenant_id, total, status) VALUES ('PED-001', 'tenant-alpha-uuid', 10.00, 'approved');`
  * **Resultado Esperado:** **DENY (42501 Permission Denied)** — Sem GRANT de INSERT.
* **[ANON-08] Bloqueio de Leitura de `cost_price`:**
  * **Ação:** `SELECT cost_price FROM public.products;`
  * **Resultado Esperado:** **DENY (42501 permission denied for column cost_price)** — Protegido em nível de engine.
* **[ANON-09] Bloqueio de Escrita (INSERT, UPDATE, DELETE) em Qualquer Tabela:**
  * **Ação:** Tentativas de escrita em qualquer tabela pública.
  * **Resultado Esperado:** **DENY (42501 Permission Denied)**.

---

### 4.2. Cenários para Tenant Admin (Admin Loja A)

* **[ADMIN-01] Leitura do seu Próprio Tenant:**
  * **Ação:** `SELECT * FROM public.tenants WHERE id = 'tenant-alpha-uuid';`
  * **Resultado Esperado:** **SUCESSO (1 linha)**.
* **[ADMIN-02] Leitura da Equipe da sua Loja:**
  * **Ação:** `SELECT id, name, role, email FROM public.tenant_users WHERE tenant_id = 'tenant-alpha-uuid';`
  * **Resultado Esperado:** **SUCESSO** — Visualiza membros de sua loja.
* **[ADMIN-03] Bloqueio de Alteração Direta de Membros em `tenant_users`:**
  * **Ação:** `UPDATE public.tenant_users SET role = 'tenant_admin' WHERE id = 'user-a2';`
  * **Resultado Esperado:** **DENY (42501 Permission Denied)** — Não há GRANT de UPDATE nem policy no browser. A gestão de equipe será via RPC/backend seguro.
* **[ADMIN-04] Bloqueio de Inserção Direta de Membro em `tenant_users`:**
  * **Ação:** `INSERT INTO public.tenant_users (id, tenant_id, role, name, email) VALUES ('uuid', 'tenant-alpha-uuid', 'tenant_admin', 'Teste', 'a@a.com');`
  * **Resultado Esperado:** **DENY (42501 Permission Denied)**.
* **[ADMIN-05] Gestão Completa de Produtos da sua Loja:**
  * **Ação:** `INSERT`, `UPDATE` e `DELETE` em `public.products` com `tenant_id = 'tenant-alpha-uuid'`.
  * **Resultado Esperado:** **SUCESSO (Linhas afetadas com sucesso)**.
* **[ADMIN-06] Bloqueio de Alteração Direta de `plan` e `status` em `public.tenants`:**
  * **Ação:** `UPDATE public.tenants SET plan = 'enterprise', status = 'active' WHERE id = 'tenant-alpha-uuid';`
  * **Resultado Esperado:** **DENY (42501 Permission Denied)** — Não há GRANT de UPDATE concedido a `authenticated` em `public.tenants`.
* **[ADMIN-07] Leitura de Pedidos da sua Loja:**
  * **Ação:** `SELECT * FROM public.orders WHERE tenant_id = 'tenant-alpha-uuid';`
  * **Resultado Esperado:** **SUCESSO** — Visualiza todos os pedidos do seu tenant.
* **[ADMIN-08] Bloqueio de Escrita Direta em `public.orders`:**
  * **Ação:** Tentativa de `INSERT`, `UPDATE` ou `DELETE` em `public.orders`.
  * **Resultado Esperado:** **DENY (42501 Permission Denied)** — Tabela é estritamente read-only para clientes browser.

---

### 4.3. Cenários para Stock Manager (Estoquista Loja A)

* **[STOCK-01] Leitura de Produtos da sua Loja:**
  * **Ação:** `SELECT * FROM public.products WHERE tenant_id = 'tenant-alpha-uuid';`
  * **Resultado Esperado:** **SUCESSO** — Leitura autorizada via `products_select_tenant`.
* **[STOCK-02] Bloqueio de Alteração Ampla de Produtos:**
  * **Ação:** `UPDATE public.products SET price = 1.00, sku = 'NOVO', cost_price = 0.50 WHERE id = 'prod-alpha-01';`
  * **Resultado Esperado:** **0 LINHAS AFETADAS ou DENY** — Stock Manager foi removido da policy `products_update_admin`. Não pode alterar produtos diretamente.
* **[STOCK-03] Leitura de Pedidos para Separação e Despacho:**
  * **Ação:** `SELECT * FROM public.orders WHERE tenant_id = 'tenant-alpha-uuid';`
  * **Resultado Esperado:** **SUCESSO** — Autorizado via `orders_select_stock_manager`.
* **[STOCK-04] Bloqueio de Alteração Direta em `orders`:**
  * **Ação:** `UPDATE public.orders SET status = 'dispatched' WHERE id = 'order-01';`
  * **Resultado Esperado:** **DENY (42501 Permission Denied)** — Não há GRANT de UPDATE em `orders`. Atualização de despacho será via RPC de workflow.

---

### 4.4. Cenários para Sales Rep (Vendedor Loja A)

* **[SALES-01] Leitura Estrita de Pedidos Próprios (`seller_id = auth.uid()`):**
  * **Ação:** `SELECT * FROM public.orders WHERE tenant_id = 'tenant-alpha-uuid' AND seller_id = auth.uid();`
  * **Resultado Esperado:** **SUCESSO** — Visualiza apenas os pedidos que criou/assumiu.
* **[SALES-02] Bloqueio de Acesso Baseado em `seller_code`:**
  * **Ação:** `SELECT * FROM public.orders WHERE seller_code = 'VEND01' AND (seller_id IS NULL OR seller_id != auth.uid());`
  * **Resultado Esperado:** **0 LINHAS RETORNADAS** — `seller_code` não é critério de autorização RLS.
* **[SALES-03] Bloqueio de Acesso a Pedidos de Outro Vendedor:**
  * **Ação:** `SELECT * FROM public.orders WHERE seller_id = 'outro-vendedor-uuid';`
  * **Resultado Esperado:** **0 LINHAS RETORNADAS**.

---

### 4.5. Cenários de Isolamento Cross-Tenant

* **[CROSS-01] Tentativa de Referenciar Vendedor de Outro Tenant (Integridade de Banco):**
  * **Ação:** `INSERT INTO public.orders (tenant_id, seller_id, ...) VALUES ('tenant-alpha-uuid', 'vendedor-do-tenant-beta', ...);`
  * **Resultado Esperado:** **VIOLAÇÃO DE CHAVE ESTRANGEIRA (23503 Foreign Key Violation)** — A constraint composta `fk_orders_tenant_seller FOREIGN KEY (tenant_id, seller_id) REFERENCES public.tenant_users(tenant_id, id)` rejeita a operação em nível de integridade referencial PostgreSQL.
* **[CROSS-02] Tentativa de Ler Produtos de Outro Tenant:**
  * **Ação:** Admin A consulta `SELECT * FROM public.products WHERE tenant_id = 'tenant-beta-uuid';`
  * **Resultado Esperado:** **0 LINHAS RETORNADAS**.
* **[CROSS-03] Tentativa de Ler Pedidos de Outro Tenant:**
  * **Ação:** Admin A consulta `SELECT * FROM public.orders WHERE tenant_id = 'tenant-beta-uuid';`
  * **Resultado Esperado:** **0 LINHAS RETORNADAS**.
* **[CROSS-04] Tentativa de Consultar Membros de Outro Tenant:**
  * **Ação:** Admin A consulta `SELECT * FROM public.tenant_users WHERE tenant_id = 'tenant-beta-uuid';`
  * **Resultado Esperado:** **0 LINHAS RETORNADAS**.

---

## 5. Script de Verificação Estática de Conformidade (SQL Test Suite)

O script abaixo pode ser executado no SQL Editor do Supabase ou via runner SQL local para validação estrutural:

```sql
DO $$
DECLARE
  v_pass_count INTEGER := 0;
BEGIN
  RAISE NOTICE 'Iniciando validação estática das políticas de RLS e integridade...';

  -- 1. Verifica se RLS está habilitado em 100% das tabelas públicas
  IF EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename IN ('platform_admins', 'tenants', 'tenant_public_settings', 'tenant_users', 'products', 'wholesale_tiers', 'orders')
      AND rowsecurity = false
  ) THEN
    RAISE EXCEPTION 'FALHA DE SEGURANÇA: Uma ou mais tabelas públicas estão com RLS desativado!';
  ELSE
    RAISE NOTICE 'PASS: Todas as tabelas públicas possuem Row Level Security ativo.';
    v_pass_count := v_pass_count + 1;
  END IF;

  -- 2. Verifica se cost_price está protegido contra consulta de anon
  IF EXISTS (
    SELECT 1 FROM information_schema.column_privileges 
    WHERE table_schema = 'public' 
      AND table_name = 'products' 
      AND column_name = 'cost_price' 
      AND grantee = 'anon' 
      AND privilege_type = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'FALHA DE SEGURANÇA: O perfil anon possui permissão de leitura sobre cost_price!';
  ELSE
    RAISE NOTICE 'PASS: Coluna cost_price está protegida contra consultas de anônimos.';
    v_pass_count := v_pass_count + 1;
  END IF;

  -- 3. Verifica se orders NÃO possui grant de INSERT/UPDATE para anon ou authenticated
  IF EXISTS (
    SELECT 1 FROM information_schema.table_privileges 
    WHERE table_schema = 'public' 
      AND table_name = 'orders' 
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'FALHA DE SEGURANÇA: Tabela orders possui grant de escrita concedido a clientes browser!';
  ELSE
    RAISE NOTICE 'PASS: Tabela orders é estritamente read-only para anon e authenticated.';
    v_pass_count := v_pass_count + 1;
  END IF;

  -- 4. Verifica se tenant_users NÃO possui grant de INSERT/UPDATE para authenticated
  IF EXISTS (
    SELECT 1 FROM information_schema.table_privileges 
    WHERE table_schema = 'public' 
      AND table_name = 'tenant_users' 
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'FALHA DE SEGURANÇA: Tabela tenant_users possui grant de escrita concedido a clientes browser!';
  ELSE
    RAISE NOTICE 'PASS: Tabela tenant_users é estritamente read-only para anon e authenticated.';
    v_pass_count := v_pass_count + 1;
  END IF;

  -- 5. Verifica existência da constraint composta em orders
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_orders_tenant_seller'
      AND table_name = 'orders'
  ) THEN
    RAISE EXCEPTION 'FALHA DE INTEGRIDADE: Constraint fk_orders_tenant_seller não encontrada em orders!';
  ELSE
    RAISE NOTICE 'PASS: Integridade composta seller_id x tenant_id validada.';
    v_pass_count := v_pass_count + 1;
  END IF;

  RAISE NOTICE 'Validação estática de conformidade RLS concluída: % verificações aprovadas.', v_pass_count;
END $$;
```

---

## 6. Procedimento Operacional Pós-Provisionamento

Quando a infraestrutura de banco de dados do Supabase V2 for ativada na etapa de infraestrutura:
1. Criar dois tenants de teste (`tenant_alpha` e `tenant_beta`).
2. Criar usuários correspondentes em `auth.users` via painel do Supabase.
3. Executar o conjunto de requisições REST autenticadas com os respectivos JWTs (`Bearer <token>`) e com a chave `anon`.
4. Registrar o log de auditoria comprovando que todos os cenários especificados nesta matriz foram validados com êxito.
