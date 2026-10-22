# ADR 004: Arquitetura Transacional Backend de Pedidos e Checkout (Orders V1)

## Status
**Aceito / Frontend Integration & Hardened** (Data: 2026-09-28)  
- **Orders Backend:** **RUNTIME HARDENING PASS**
- **000010:** **APLICADA / CONGELADA**
- **000011:** **APLICADA / CONGELADA**
- **submit-order-checkout:** **v2 ACTIVE**
- **Feature Gate:** **RUNTIME 503 PASS / CHECKOUT DESABILITADO**
- **Frontend:** **INTEGRAÇÃO REAL IMPLEMENTADA NO WORKSPACE / AINDA NÃO VALIDADA COM PEDIDO REAL**
- **B2B:** **tenant público canônico reconciliado com PUBLIC_TENANT_SLUG / purchaseMode e shoppingMode sincronizados**
- **Legado ainda existente:** AppContext orders, OrderManager local, TenantDashboard KPIs locais

---

## Contexto

A auditoria do sistema de catálogo e checkout revelou que a criação de pedidos operava exclusivamente no navegador (`CartDrawer.tsx` / `AppContext.tsx`) com persistência em `localStorage` (`omnicatalogo_saas_data_v3_orders`). Os valores financeiros (`unitPrice`, `totalPrice`, `subtotal`, `total`) e o número do pedido (`PED-YYYY-XXXX` gerado via `Math.random()`) eram decididos pelo cliente, sem autoridade ou validação no servidor.

Adicionalmente, na migration inicial `20260902_000001_initial_schema.sql`, a tabela `public.orders` foi protegida com:
- `REVOKE ALL ON public.orders FROM anon, authenticated, service_role;`
- `GRANT SELECT ON public.orders TO authenticated;`
- RLS ativado e restrito apenas a leitura por `tenant_admin`, `stock_manager` e `sales_rep`.

Com isso, o navegador **não possui e não deve possuir permissão de INSERT direto** em `public.orders`.

Para estruturar o checkout V1 sob rígidos padrões de segurança financeira, isolamento multi-tenant, atomicidade transacional e integridade de estoque, avaliou-se o modelo arquitetural para a ingestão e gestão do ciclo de vida dos pedidos.

---

## Decisão de Arquitetura

Adota-se uma arquitetura em duas camadas (**Edge Gateway + RPC Transacional Interna**):

```
[Storefront / Browser]
       │
       ▼ (HTTP POST / JSON - Payload sem valores financeiros)
[Supabase Edge Function: submit-order-checkout]
  - Feature Gate Fail-Closed: CHECKOUT_ENABLED !== "true" retorna HTTP 503
  - Validação de formato, headers e tamanho de payload (máx. 200 itens, máx. 64 KB por bytes UTF-8)
  - Honeypot anti-bot
  - Rejeição de campos financeiros e buyerUserId no body
  - Autenticação obrigatória para atacado via Bearer JWT -> extração do user.id real
  - Varejo público sem obrigatoriedade de login
       │
       ▼ (Invocação com SUPABASE_SECRET_KEYS default)
[PostgreSQL RPC: public.create_order_checkout_internal (Migrations 000010 e 000011)]
  - LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
  - REVOKE ALL de PUBLIC, anon e authenticated
  - GRANT EXECUTE restrito estritamente a service_role
  - Validação estrita de UUID v4 para idempotency_key
  - Snapshots canônicos estritos para cliente e endereço de entrega
  - Limites de tamanho de strings (slug <= 120, seller_code <= 64, delivery_method <= 64, notes <= 1000, name <= 160, street <= 200, selectedVariant <= 160)
  - Resolução do tenant ativo por slug e configurações
  - Idempotência atômica via (tenant_id, idempotency_key)
  - Validação de produtos ativos e pertencentes ao tenant
  - Recálculo 100% server-side de preços (preço regular/promocional no varejo; preço de atacado para B2B)
  - Validação de credenciamento e status aprovado do comprador em public.wholesale_customers
  - Validação de pedidos mínimos (min_order_value / wholesale_min_order_value)
  - Validação de estoque disponível no momento da criação (FAIL CLOSED se insuficiente)
  - Geração de order_number sequencial humano via sequence pública (public.order_number_seq)
  - Criação de pedido com status 'pending' (SEM DECREMENTO DE ESTOQUE NESTA ETAPA)
       │
       ▼
[public.orders]
```

Para a gestão do ciclo de vida administrativo do pedido:
```
[Painel Administrativo / Tenant Admin ou Stock Manager Autenticado]
       │
       ▼
[PostgreSQL RPC: public.manage_order_status]
  - LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
  - GRANT EXECUTE restrito a authenticated
  - Validação de permissão do caller (tenant_admin/stock_manager do mesmo tenant ou platform_admin)
  - Trava de linha (SELECT ... FOR UPDATE) no pedido
  - Transição pending -> approved:
      * Lock pessimista em ordem determinística de UUID nos produtos envolvidos
      * Revalidação de estoque (stock >= quantity)
      * Decremento atômico de estoque (UPDATE public.products SET stock = stock - quantity)
      * Transição de status para 'approved'
  - Transição approved/preparing -> cancelled:
      * Restauração atômica de estoque exatamente uma vez
      * Transição de status para 'cancelled'
  - Transição pending -> cancelled:
      * Cancelamento sem alteração de estoque (já que o pending não decrementou)
  - Estados terminais imutáveis: 'delivered' e 'cancelled'
```

---

## Justificativa e Regras Fundamentais

### 1. Zero Autoridade Financeira no Cliente
O contrato da RPC `public.create_order_checkout_internal` não recebe `unitPrice`, `totalPrice`, `subtotal`, `discount`, `shipping_fee` ou `total`. Todos os valores são buscados e somados diretamente no banco de dados com precisão decimal (`NUMERIC(10,2)`). O cliente informa apenas `productId`, `quantity` e `selectedVariant`.

### 2. Ciclo de Vida de Estoque (Stock Lifecycle)
- **Criação do Pedido (`status = 'pending'`):**
  - O storefront gera uma intenção de compra. O estoque atual é validado para garantir que a quantidade solicitada existe, **mas o estoque NÃO é decrementado**.
  - Isso protege a loja contra ataques de negação de inventário (*inventory locking / stock exhaustion attacks*) por usuários anônimos gerando pedidos falsos via script.
- **Aprovação do Pedido (`status = 'approved'`):**
  - O lojista (ou operador de estoque) aprova o pedido.
  - A operação executa `FOR UPDATE` ordenado por UUID dos produtos, revalida se o estoque ainda é suficiente e decrementa atomicamente. Se faltar estoque em qualquer item, toda a transação sofre `ROLLBACK`.
- **Cancelamento (`status = 'cancelled'`):**
  - Pedidos cancelados a partir de `approved` ou `preparing` devolvem o estoque exatamente uma vez.
  - Pedidos cancelados a partir de `pending` não alteram estoque.
  - Pedidos `dispatched`, `delivered` ou já `cancelled` não podem ser cancelados.

### 3. Restrição de Menor Privilégio na RPC Interna
A RPC `public.create_order_checkout_internal` possui privilégios de execução **exclusivos para a role `service_role`**. Nenhuma chamada direta do navegador (via chave anônima ou token de usuário) pode invocá-la diretamente, eliminando o risco de chamadas maliciosas contornando o gateway da Edge Function.

### 4. Idempotência Rigorosa
Cada pedido exige `idempotency_key UUID` gerado no frontend na inicialização da tentativa de checkout. A constraint composta `UNIQUE (tenant_id, idempotency_key)` em `public.orders` garante que cliques repetidos ou retries de rede retornem o mesmo pedido já gravado sem duplicar dados nem colidir pedidos.

---

## Consequências

- **Positivas:**
  - Integridade financeira absoluta: impossível forjar preços, totais ou descontos.
  - Isolamento de tenant garantido por resolução interna via slug canônico e constraints no banco.
  - Proteção contra esgotamento forçado de estoque por checkouts anônimos.
  - Suporte completo a pedidos de atacado B2B estritamente vinculados ao credenciamento aprovado.
- **Limitações e Riscos Residuais:**
  - Como o endpoint de varejo é público, existe risco residual de spam de pedidos pendentes falsos. Mitigado no V1 com honeypot, limites de tamanho e validação estrutural; proteções adicionais (Turnstile/reCAPTCHA e rate limiting) poderão ser introduzidas na camada de borda do Cloudflare/Kong.
