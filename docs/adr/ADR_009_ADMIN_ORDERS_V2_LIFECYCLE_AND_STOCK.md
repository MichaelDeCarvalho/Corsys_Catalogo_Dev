# ADR 009: Admin Orders V2 — Ciclo de Vida Server-Side, Controle Transacional de Estoque, Impressão Isolada e PDF Administrativo

## Status
**ACEITO** (2026-10-05)

## Contexto
O Admin Orders V1 estabeleceu a segregação estrita entre mocks/localStorage e a superfície administrativa, tornando a tabela `public.orders` o único *source of truth* para os KPIs e listagens do `TenantDashboard` e do `OrderManager`. Entretanto, a V1 foi propositalmente entregue em modo *read-only*, com o aviso informativo de que a mutação de ciclo de vida e estoque seria introduzida de forma controlada em uma etapa administrativa posterior.

Desafios e Requisitos da V2:
1. **Mutação Segura de Ciclo de Vida:** Operadores autorizados precisam transicionar pedidos entre estados válidos (`pending -> approved -> preparing -> dispatched -> delivered` ou `cancelled`).
2. **Controle Transacional de Estoque:** Transições para `approved` devem debitar o estoque atômica e confiavelmente com bloqueio pessimista ordenado; cancelamentos de pedidos aprovados/em separação devem restaurar o estoque exatamente uma vez.
3. **Identidade Server-Side & Menor Privilégio:** A RPC interna não deve confiar em parâmetros de identidade enviados no payload do cliente nem estar exposta a papéis de API do cliente (`anon`, `authenticated`). A autorização deve ser mediada por uma Edge Function com validação estrita de JWT.
4. **Isolamento de Impressão (Print Slip):** O botão de impressão legado acionava `window.print()` imprimindo acidentalmente elementos de fundo da página (sidebar, cabeçalho e backdrop escuro do modal).
5. **Geração de PDF Administrativo Oficial:** Operadores precisam gerar/baixar o documento PDF do pedido com branding da loja sem abrir políticas de leitura no bucket privado `order-documents`.
6. **Proibição Absoluta de Hard Delete:** Pedidos reais nunca devem sofrer deleção física (`DELETE`), preservando auditabilidade contábil e operacional.

## Decisão de Arquitetura

### 1. Migration 000014 (Forward-Only)
- Arquivo: `supabase/migrations/20261005170000_000014_admin_order_management.sql`.
- As migrations `000001` a `000013` permanecem aplicadas e congeladas.
- Reafirma defensivamente que a função legada `public.manage_order_status(UUID, TEXT)` permanece sem permissão de execução (`REVOKE ALL FROM PUBLIC, anon, authenticated, service_role`).
- Cria a nova RPC interna:
  ```sql
  public.manage_order_status_internal(
    p_order_id UUID,
    p_new_status TEXT,
    p_actor_user_id UUID
  ) RETURNS JSONB
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
  ```
- Permissões: `REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role;`.

### 2. Máquina de Estados e Travas Pessimistas no Banco
- A RPC adquire lock `FOR UPDATE` na linha do pedido.
- Autorização estrita do ator (`p_actor_user_id`):
  - `platform_admin` OU `tenant_users` do mesmo tenant com `active = true` e papel `tenant_admin` ou `stock_manager`.
  - Papel `sales_rep` e operadores cross-tenant são sumariamente rejeitados com erro `42501`.
- Estados terminais `delivered` e `cancelled` são imutáveis (erro `55000`).
- Idempotência: retorno imediato se `status = p_new_status`.
- **Transição `pending -> approved`:**
  - Locks pessimistas (`FOR UPDATE`) nos produtos ordenados deterministicamente por `productId ASC` para prevenir deadlocks.
  - Revalidação de produto ativo, não excluído (`deleted_at IS NULL`) e saldo disponível (`stock >= qty`).
  - Débito atômico de estoque (`UPDATE public.products SET stock = stock - qty`).
- **Transição `approved/preparing -> cancelled`:**
  - Locks pessimistas ordenados e restauração de estoque (`UPDATE public.products SET stock = stock + qty`).
- Retorno restrito a JSONB mínimo sem PII: `{ id, order_number, status, updated_at }`.

### 3. Edge Functions Gateway Segregadas
- **`manage-order-status` (Responsabilidade Única de Mutação):**
  - Configuração: `supabase/config.toml` com `verify_jwt = true`.
  - Validação estrita de cabeçalho `Authorization: Bearer <token>` e tamanho de payload (máx 4 KB).
  - Extrai a identidade do operador via `auth.getUser()`, derivando `actorUserId` server-side (rejeita qualquer tentativa de enviar `actorUserId` no body).
  - Body EXATO: `{ "orderId": string, "newStatus": string }` (rejeita campos extras, actions ou roles).
  - Invoca a RPC interna `manage_order_status_internal` com `service_role`.
  - Resposta mínima sanitizada sem PII.
- **`generate-admin-order-pdf` (Geração Dedicada de Documento Administrativo):**
  - Configuração: `supabase/config.toml` com `verify_jwt = true`.
  - Body EXATO: `{ "orderId": string }` (máx 4 KB).
  - **Autorização via RLS:** O pedido é consultado primeiro no contexto do JWT do usuário (`supabaseUserClient.from("orders").select(...).eq("id", orderId)`). A RLS do PostgreSQL decide a autorização de leitura — permitindo que operadores como `sales_rep` gerem o PDF administrativo mesmo que não tenham permissão para mutar status.
  - Caso a RLS não retorne a linha, emite resposta 404 sanitizada sem vazar dados entre tenants.
  - **Uso de service_role estritamente pós-leitura:** Renderiza bytes via `generateOrderPdf`, armazena com upsert em `order-documents` no path `<tenant_id>/orders/<order_id>/pedido-<order_number>.pdf` e emite Signed URL com TTL de **exatamente 600 segundos (10 minutos)**.
  - Zero log de Signed URLs.

### 4. Arquitetura de Impressão Isolada (Portal Fora do DOM da Aplicação)
- Em `src/components/tenantadmin/OrderPrintDocument.tsx`: componente estritamente dedicado ao documento de impressão (sem modal, sem overlay, sem fixed/absolute posicional, sem handlers/botões e sem `dangerouslySetInnerHTML`).
- Em `src/components/tenantadmin/OrderManager.tsx`: renderizado via `createPortal(<div id="order-print-root"><OrderPrintDocument ... /></div>, document.body)` fora de `#root` e de containers `.fixed`.
- Em `src/index.css`:
  - Removida a estratégia legada `body * { visibility: hidden }`.
  - Screen: `#order-print-root { display: none; }`.
  - `@media print`: `body > #root { display: none !important; }`, `#order-print-root { display: block !important; position: static !important; }`, `@page { size: A4 portrait; margin: 10mm; }`, `.print-avoid-break { break-inside: avoid !important; }`.

### 5. Frescor de Dados e Auto-Refresh de Estoque & Pedidos
- `src/components/tenantadmin/TenantDashboard.tsx`:
  - Callback `handleOrderStatusChanged`: recarrega atomicamente `loadAdminOrders()` e `loadAdminProducts()`.
  - Passado via prop `onStatusChanged` para `OrderManager`.
  - Auto-refresh de janela/aba com listeners em `window.addEventListener('focus')` e `document.addEventListener('visibilitychange')`.
  - Guarda anti-duplicação via `lastRefreshAtRef` (throttle de 800ms) e cleanup obrigatório em desmontagem.
  - Zero polling (`setInterval`), zero `supabase.channel` e zero `postgres_changes`.

### 6. Frontend & Serviços
- `src/services/adminOrderService.ts`:
  - `updateAdminOrderStatus(orderId, newStatus)`: invoca exclusivamente `manage-order-status` com validação fail-closed.
  - `generateAdminOrderPdf(orderId)`: invoca exclusivamente `generate-admin-order-pdf` com validação fail-closed.
  - Contratos e payloads estritamente segregados (zero envio de `action`).
  - Preserva `fetchAdminOrders` e o adapter fail-closed.
- `src/components/tenantadmin/OrderManager.tsx`:
  - Botões contextuais de transição de status para estados válidos.
  - Indicador de estado terminal para pedidos entregues ou cancelados.
  - Botão oficial "Gerar PDF" integrado com download/abertura em nova aba.
  - Botão "Imprimir" aciona `window.print()` renderizando o portal dedicado.
  - Proibição contínua de hard delete (zero chamadas a `.delete()`).

## Validação de Runtime e Governança
- **Status da Migration 000014:** APLICADA / FROZEN.
- **Edge Functions:**
  - `manage-order-status`: ACTIVE v1 / `verify_jwt = true`.
  - `generate-admin-order-pdf`: ACTIVE v1 / `verify_jwt = true`.
- **Runtime Evidenciado em Produção/Hosted:**
  - Controles de status: PASS.
  - Débito transacional de estoque (`pending -> approved`): PASS.
  - Cancelamento de pedido (`approved -> cancelled`): PASS.
  - Restauração de estoque (`approved -> cancelled`): PASS.
  - Emissão e download de PDF oficial: PASS.
- **Itens do Hotfix de Impressão e Frescor:**
  - Impressão isolada em página única via Portal (`OrderPrintDocument`): **PENDING RUNTIME REVALIDATION**.
  - Refresh de estoque na mesma sessão pós-status: **PENDING RUNTIME REVALIDATION**.
  - Auto-refresh em outra aba via focus/visibilitychange: **PENDING RUNTIME REVALIDATION**.
- **Regressão Automatizada:**
  - 8 suítes de regressão (793 testes) aprovadas com 100% de sucesso no `bun run check`.
