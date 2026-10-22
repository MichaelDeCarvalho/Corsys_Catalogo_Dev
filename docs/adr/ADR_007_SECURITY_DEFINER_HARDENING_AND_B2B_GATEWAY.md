# ADR 007: Hardening de Funções SECURITY DEFINER e Gateway Autenticado de Catálogo B2B

## Status
**ACEITO** (2026-09-30)

## Contexto
O Supabase Security Advisor emitiu o alerta `authenticated_security_definer_function_executable` para três funções de banco de dados executáveis pelo papel `authenticated`:
1. `public.get_my_wholesale_status(p_tenant_slug text)`
2. `public.get_wholesale_catalog(p_tenant_slug text)`
3. `public.manage_order_status(p_order_id uuid, p_new_status text)`

Todas as três funções foram criadas originalmente com `owner = postgres`, `SECURITY DEFINER = true`, `SET search_path = ''` e permissão de `EXECUTE` concedida a `authenticated`.

Análise de Risco e Menor Privilégio:
- **`get_my_wholesale_status`:** Consulta legítima do comprador B2B logado para checar o status de sua própria solicitação. No entanto, não requer privilégios de superusuário (`SECURITY DEFINER`), pois o comprador só deve ler seus próprios dados via RLS.
- **`get_wholesale_catalog`:** O comprador B2B não é membro da tabela interna `tenant_users`. Converter `get_wholesale_catalog` diretamente para `SECURITY INVOKER` exigiria conceder SELECT na tabela base `public.products` para compradores, arriscando expor a coluna restrita `cost_price` ou dados operacionais. Por outro lado, manter RPC pública `SECURITY DEFINER` aberta a `authenticated` violava as melhores práticas de menor privilégio.
- **`manage_order_status`:** Função administrativa com mutações de estoque (`pending -> approved -> cancelled`). Não deve ser invocável diretamente por usuários do browser sem mediação de gateway ou autorização estrita.

## Decisão de Arquitetura

1. **`get_my_wholesale_status` como SECURITY INVOKER:**
   - Na migration `20261001_000013_security_definer_hardening.sql`, recria a função como `SECURITY INVOKER` com `SET search_path = ''`.
   - Resolve o tenant canônico através da view/tabela `public.tenant_public_settings` (que já possui SELECT liberado para `authenticated` com RLS de tenant ativo, sem exigir membership em `tenant_users`).
   - Consulta `public.wholesale_customers` filtrando por `tenant_id` e `user_id = auth.uid()`.
   - A política RLS `wholesale_customers_select_self` atua como barreira determinística.
   - Preserva rigorosamente os estados de retorno públicos: `unauthenticated`, `tenant_not_found`, `not_registered`, `pending`, `approved`, `rejected`, `suspended`.
   - Permissões: `REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated;`.

2. **Remoção de RPC Privilegiada do Browser e Gateway Edge Function (`get-wholesale-catalog`):**
   - A função legada `public.get_wholesale_catalog(p_tenant_slug text)` teve seus privilégios de execução revogados de `PUBLIC`, `anon` e `authenticated` (preservada no banco para segurança de rollback).
   - Criada a nova RPC interna `public.get_wholesale_catalog_internal(p_tenant_slug text, p_user_id uuid)` com `SECURITY DEFINER`, `SET search_path = ''` e execução concedida **EXCLUSIVAMENTE a `service_role`**.
   - A RPC interna valida rigorosamente os parâmetros de entrada, confirma se `allow_b2b_mode = true` na loja e verifica se o comprador possui status `approved`.
   - Projeta estritamente 4 colunas autorizadas: `product_id`, `sku`, `wholesale_price`, `wholesale_min_quantity`. NUNCA retorna `cost_price`, PII ou segredos.
   - Criada a Edge Function gateway autenticada `get-wholesale-catalog`:
     - Exige cabeçalho `Authorization: Bearer <token>`.
     - Deriva o `userId` canônico exclusivamente da validação do token via `supabaseAdmin.auth.getUser(token)`.
     - Rejeita parâmetros de injeção de identidade ou dados financeiros no body (`userId`, `cost_price`, `wholesalePrice`, etc.).
     - Limita o payload de requisição a 4 KB.
     - Invoca a RPC interna com credenciais de `service_role` e retorna o array de itens sanitizado.

3. **Frontend Alinhado:**
   - `src/services/wholesaleService.ts` atualiza a função `fetchWholesaleCatalog` para consumir a Edge Function `get-wholesale-catalog` via `supabase.functions.invoke()`, cessando qualquer chamada direta a RPC legada no PostgreSQL.

4. **Revogação de Execução de `manage_order_status`:**
   - Privilégios de execução de `public.manage_order_status` revogados de `PUBLIC`, `anon`, `authenticated` e `service_role`.
   - Zero concessão para `service_role` nesta etapa por não existir gateway server-side ativo (menor privilégio estrito).
   - Função física preservada no banco para integridade e rollback; futura integração administrativa deverá estabelecer arquitetura server-side explícita antes de qualquer novo GRANT.

## Consequências

- **Positivas:**
  - Resolução completa dos achados de segurança do Supabase Security Advisor (`authenticated_security_definer_function_executable`).
  - Blindagem total da coluna `cost_price` contra vazamento para compradores B2B.
  - Eliminação de vetores de enumeração de catálogo e adulteração de status via chamadas RPC diretas do browser.
  - Alinhamento total aos princípios de defesa em profundidade e menor privilégio.
- **Status Operacional e de Deploy:**
  - **Migration 000013:** APLICADA / CONGELADA NO SUPABASE HOSTED (Database hardening: RUNTIME VERIFIED).
  - **Supabase Security Advisor:** Os 3 achados `authenticated_security_definer_function_executable` eliminados. Residual: `auth_leaked_password_protection` permanece por plano Free.
  - **Edge Function `get-wholesale-catalog`:** CORREÇÃO DE BUNDLE PREPARADA / AGUARDANDO REDEPLOY E RUNTIME VALIDATION (não declarada como runtime pass até conclusão do deploy hospedado).
  - **Cloudflare Frontend:** Último build do commit de hardening concluído com sucesso (SUCCESS).
