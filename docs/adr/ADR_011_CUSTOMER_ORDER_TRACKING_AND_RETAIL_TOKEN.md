# ADR 011: Meus Pedidos / Customer Order Tracking V1 (Secure Retail Token + Authenticated B2B)

## Status
**ACEITO** (2026-10-08) — *Implementação de Rastreamento Seguro de Pedidos pelo Cliente*.

## Contexto
O Corsys.Catálogo permite compras tanto no varejo anônimo quanto no atacado B2B aprovado.
Historicamente, clientes após o checkout dependiam exclusivamente do WhatsApp para obter status do pedido.
Uma consulta pública de pedidos diretamente no banco por `order_number`, CPF, telefone ou e-mail representaria um vetor crítico de vazamento de PII (Personally Identifiable Information) e quebra de isolamento multi-tenant.

Dessa forma, foi necessária a concepção de uma arquitetura segura de acompanhamento de pedidos para clientes, respeitando o princípio de Menor Privilégio e garantindo que:
1. Compradores anônimos de varejo consultem somente o pedido que eles mesmos criaram via token criptográfico de alta entropia.
2. Compradores atacadistas B2B consultem seu próprio histórico autenticado por JWT.
3. A tabela `public.orders` continue com zero acesso SELECT direto para `anon`.

## Decisão de Arquitetura

1. **Schema e Persistência de Auditoria (Migration 000015):**
   - Adicionada coluna `buyer_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL` em `public.orders`.
   - Adicionada coluna `tracking_token_hash TEXT NULL` com constraint `CHECK (tracking_token_hash IS NULL OR tracking_token_hash ~ '^[a-f0-9]{64}$')`.
   - Índice parcial `idx_orders_buyer_lookup (tenant_id, buyer_user_id, created_at DESC) WHERE buyer_user_id IS NOT NULL`.
   - Índice parcial `UNIQUE uq_orders_tracking_token_hash (tracking_token_hash) WHERE tracking_token_hash IS NOT NULL`.
   - A RLS de `public.orders` permanece **estritamente inalterada** (restrita a administradores e corretores do tenant). Zero SELECT público para `anon`.

2. **Fluxo de Varejo Anônimo (Secure Retail Token):**
   - Na criação do pedido retail via checkout server-side (`submit-order-checkout`), gera-se um token aleatório criptograficamente seguro de 256 bits (64 caracteres hexadecimais minúsculos via CSPRNG).
   - O servidor armazena exclusivamente o **hash SHA-256** do token em `public.orders.tracking_token_hash`. O token em texto claro nunca é gravado no banco.
   - O token raw é devolvido uma única vez no `CheckoutOrderReceipt` sanitizado (`trackingToken`).
   - O cliente frontend armazena apenas o par `{ orderNumber, trackingToken, createdAt }` em `localStorage` sob chave isolada por tenant (`corsys_order_tracking_v1:<slug>`). Não há persistência de PII nem `tenantSlug` dentro do registro.
   - Para rastreamento, o frontend invoca a Edge Function `track-order-by-token`, que calcula o SHA-256 e executa a RPC interna `track_order_by_token_internal` (service_role only). Não há busca manual por token digitado.

3. **Fluxo de Atacado B2B Autenticado:**
   - No checkout B2B, a Edge Function `submit-order-checkout` deriva o `buyerUserId` diretamente do JWT validado (`auth.getUser(token)`).
   - A RPC `create_order_checkout_internal` persiste `buyer_user_id` exclusivamente para a modalidade `wholesale`. Para `retail`, o campo é forçado a `NULL`.
   - Para listar histórico de pedidos, o cliente invoca a Edge Function `list-my-customer-orders` enviando o token Bearer.
   - A Edge Function valida a sessão e delega a consulta para a RPC interna `list_my_customer_orders_internal` (service_role only), que filtra por `tenant_id`, `buyer_user_id` e `shopping_mode = 'wholesale'`.

4. **RPCs Internas de Menor Privilégio e Hardening (Migration 000016):**
   - Migration 000015 encontra-se aplicada e congelada no Supabase Hosted.
   - Migration 000016 (`20261009000000_000016_customer_order_tracking_hardening.sql`) é o hardening forward-only desta correção (RELEASE CANDIDATE / HOSTED STATUS PENDING POST-SYNC VERIFICATION).
   - `set_order_tracking_token_internal(p_order_id UUID, p_idempotency_key UUID, p_tracking_token_hash TEXT)`:
     - `SECURITY DEFINER`, `search_path = ''`.
     - `REVOKE ALL` para `PUBLIC`, `anon`, `authenticated`.
     - `GRANT EXECUTE` exclusivamente para `service_role`.
     - Bloqueio pessimista `FOR UPDATE` exigindo `id = p_order_id`, `idempotency_key = p_idempotency_key` e `shopping_mode = 'retail'`. Zero DML direto do Edge Function. Retorna booleano sem PII.
   - `track_order_by_token_internal(p_tenant_slug TEXT, p_tracking_token_hash TEXT)`:
     - `SECURITY DEFINER`, `search_path = ''`.
     - `REVOKE ALL` para `PUBLIC`, `anon`, `authenticated`.
     - `GRANT EXECUTE` exclusivamente para `service_role`.
     - Consulta não exige `t.status = 'active'` (suporte a histórico de loja desativada).
     - Retorna projeção sanitizada e limpa: `orderNumber`, `status`, `shoppingMode`, `deliveryMethod`, `paymentMethod`, `items`, `subtotal`, `discount`, `shippingFee`, `total`, `createdAt`, `updatedAt`. Totalmente livres de `id`, `customer`, `customerName`, `shippingAddress`, `tenant_id` ou chaves internas.
   - `list_my_customer_orders_internal(p_tenant_slug TEXT, p_buyer_user_id UUID, p_limit INT, p_offset INT)`:
     - `SECURITY DEFINER`, `search_path = ''`.
     - `REVOKE ALL` para `PUBLIC`, `anon`, `authenticated`.
     - `GRANT EXECUTE` exclusivamente para `service_role`.
     - Consulta não exige `t.status = 'active'`, filtra estritamente `shopping_mode = 'wholesale'` e retorna lista paginada com a mesma projeção sanitizada (sem `id`, sem `customerName`, sem `shippingAddress`).

5. **Interface do Usuário (Storefront & Header):**
   - Criada a visualização `CustomerOrderTrackingView` (`src/components/storefront/CustomerOrderTrackingView.tsx`).
   - Botão "Meus Pedidos" adicionado ao cabeçalho principal (`Header.tsx`) e ao dropdown de usuário, chaveando o `viewMode` para `'my_orders'`.
   - Consulta estritamente via tokens locais salvos no navegador para varejo e pedidos da conta autenticada para B2B. Zero busca manual por token.
   - Interface livre de exibição de endereços ou PII (exibe somente método de entrega e forma de pagamento).
   - Ao deslogar (logout), pedidos B2B são descarregados imediatamente e o usuário é redirecionado para a vitrine pública se estiver em `my_orders`.

## Consequências

- **Positivas:**
  - Zero exposição de consultas abertas por CPF, telefone, e-mail ou número de pedido sequencial.
  - Eliminação total de PII (`shippingAddress`, `customerName`) nas projeções e na UI de rastreamento.
  - Compradores de varejo conseguem verificar status em tempo real sem fricção e com privacidade blindada.
  - Compradores B2B possuem visão centralizada e paginada de todos os seus pedidos históricos na loja.
  - Arquitetura forward-only sem alterar migrations anteriores (000001 a 000015 permanecem congeladas).
