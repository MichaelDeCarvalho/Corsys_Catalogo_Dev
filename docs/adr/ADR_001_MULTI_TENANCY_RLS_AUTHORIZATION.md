# ADR 001: Arquitetura de Multi-Tenancy, Isolamento RLS e Superfície de Autorização

## Status
**Aceito** (Data: 2026-09-03)

## Contexto
O Corsys Catálogo B2B / B2C opera como uma plataforma SaaS multi-tenant distribuída, permitindo que distribuidores e atacadistas publiquem seus catálogos públicos e gerenciem vendas internas (painel administrativo, representantes de vendas e expedição).

Em iterações iniciais da prova de conceito, os clientes browser possuíam privilégios amplos de inserção e atualização em tabelas críticas como `orders` (pedidos), `tenants` (dados contratuais) e `tenant_users` (gestão de membros e permissões), confiando predominantemente em validações de front-end. Esse modelo introduzia vetores de ataque graves, tais como:
1. Adulteração de preços, totais e frete de pedidos no checkout público via cliente PostgREST;
2. Auto-atribuição de permissões administrativas (`tenant_admin`) por representantes de vendas;
3. Exposição inadvertida de segredos industriais (`cost_price`) para usuários anônimos;
4. Modificação arbitrária do plano comercial (`plan`), status da loja e `slug` diretamente pelo navegador;
5. Execução de views públicas com privilégios de superusuário (`SECURITY DEFINER` implícito).

## Decisões Tomadas

### 1. Multi-Tenancy Canônico por `tenant_id`
- Toda entidade operacional (`products`, `wholesale_tiers`, `orders`, `tenant_users`, `tenant_public_settings`) possui obrigatoriamente a coluna `tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE`.
- A fonte canônica de identificação do tenant e de seu slug público é a tabela `public.tenants(id, slug)`.
- A sincronização para `tenant_public_settings.slug` é estritamente unidirecional via trigger no banco de dados (`private.sync_tenant_slug()`), sendo impossível alterá-la via payload de atualização do browser.

### 2. Princípio de RLS Deny-by-Default e Least Privilege
- Todas as 7 tabelas do schema `public` possuem Row Level Security (RLS) habilitado sem exceção.
- O padrão inicial é `REVOKE ALL ON <table> FROM PUBLIC, anon, authenticated`. Privilégios são concedidos apenas cirurgicamente.
- O schema `private` armazena funções de apoio à autorização, tendo `REVOKE ALL` e apenas `USAGE` concedido, com privilégio `EXECUTE` revogado em lote e concedido individualmente apenas às funções estritamente necessárias (`private.is_tenant_active` para anônimo, demais helpers apenas para autenticado).

### 3. Segregação de Platform Admins
- Administradores globais da plataforma SaaS (SuperAdmins) são isolados em `public.platform_admins(id)`, referenciando `auth.users(id)`.
- SuperAdmins não possuem vínculo estático com um `tenant_id` específico e não utilizam as roles de equipe dos lojistas, possuindo autorização avaliada via helper `private.is_platform_admin()`.

### 4. Checkout e Pedidos com Escrita Exclusivamente Server-Side
- A tabela `public.orders` é estritamente **Read-Only** no browser:
  - Papel `anon`: Nenhum grant de SELECT, INSERT, UPDATE ou DELETE.
  - Papel `authenticated`: Somente privilégio de `SELECT`. Nenhuma policy de INSERT, UPDATE ou DELETE existe na tabela.
- Toda criação de pedido (checkout anônimo do catálogo ou cotação formal) e atualização operacional de status de pedido devem ocorrer obrigatoriamente via Edge Function / RPC server-side com a role `service_role`. Isso assegura o recálculo confiável de preços, regras de atacado, validação de estoque e taxas de entrega no servidor.
- Pedidos possuem integridade referencial composta: `FOREIGN KEY (tenant_id, seller_id) REFERENCES public.tenant_users(tenant_id, id) ON DELETE SET NULL (seller_id)`. O motor do PostgreSQL rejeita qualquer tentativa de vincular um vendedor de outro tenant a um pedido.
- O identificador `seller_code` é unicamente um metadado operacional, nunca um critério de autorização RLS. A autorização do vendedor baseia-se exclusivamente em `seller_id = (SELECT auth.uid())`.

### 5. Gestão de Equipe e Planos Isolada no Backend
- A tabela `public.tenant_users` é somente leitura no browser (`SELECT`), permitindo que administradores visualizem sua equipe e membros vejam seu próprio perfil. Adições de membros, convites por e-mail e alteração de `role` exigem endpoints server-side protegidos, mitigando elevação de privilégios.
- A tabela `public.tenants` é somente leitura no browser (`SELECT`). Modificações em `plan`, `status` ou propriedade financeira são efetuadas exclusivamente pelo plano de controle de faturamento no backend.

### 6. Superfícies de Exposição Sanitizadas
- A tabela `public.tenant_public_settings` restringe a atualização via browser (`GRANT UPDATE`) através de uma allowlist estrita de colunas visuais (`public_name`, `whatsapp_number`, `logo_url`, `banner_url`, `primary_color`, `accent_color`, `min_order_value`, `allow_b2b_mode`, `hide_prices_without_login`, `delivery_methods`). As colunas `tenant_id`, `slug`, `created_at` e `updated_at` estão fisicamente protegidas contra alteração via API REST.
- A view pública `public.catalog_products` é declarada com `WITH (security_invoker = true)`, executando sob os privilégios de quem a consulta e respeitando o RLS da tabela base `products`.
- A coluna confidencial `cost_price` (preço de custo) foi omitida da view pública e teve sua concessão de `SELECT` na tabela base `products` revogada para o papel `anon`. Para o papel `anon`, a coluna `deleted_at` foi concedida para permitir avaliação das cláusulas `WHERE` da view e de policies públicas sem expor `cost_price`.
- **Decisão pendente sobre `cost_price`:** Permanece na tabela `products` nesta fase (com privilégio de SELECT restrito a `authenticated` e `service_role`). Avaliar em etapa futura se deve ser segregada para uma tabela separada `product_costs` com RLS restrito exclusivamente a administradores (`tenant_admin`).
- **Débito técnico identificado em `permissions`:** O campo `tenant_users.permissions` (JSONB) foi mantido como legado/compatibilidade mas **NÃO** é utilizado para autorização neste momento. A autorização do sistema baseia-se unicamente nas colunas estruturadas `role` e nos helpers de RLS/RPC. Recomenda-se remoção ou refatoração formal em etapa posterior.

## Consequências

### Positivas
- **Imunidade contra adulteração de pedidos:** Fraudes financeiras e manipulação de valores no checkout tornam-se impossíveis via API REST direta.
- **Isolamento de dados estanque:** O isolamento entre diferentes lojistas é garantido tanto no nível de autorização (RLS) quanto na integridade referencial (FKs compostas).
- **Proteção do segredo industrial:** Concorrentes e clientes públicos não têm como extrair margens de lucro ou preços de custo.
- **Auditabilidade e Governança:** Funções auxiliares em schema `private` com `SET search_path = ''` evitam ataques de hijacking de search_path e injeções de contexto.

### Limitações e Próximos Passos
- O fluxo de checkout (criação de pedidos) e o gerenciamento de membros de equipe exigirão a implementação de Edge Functions / RPCs dedicadas antes da liberação dessas funcionalidades no front-end.
- A migration `20260902_000001_initial_schema.sql` está pronta e endurecida, permanecendo em estado pré-execução até que o provisionamento do banco Supabase V2 seja formalmente aprovado.
