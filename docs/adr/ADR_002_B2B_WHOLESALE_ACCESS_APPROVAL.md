# ADR 002: Acesso B2B Protegido por Aprovação Empresarial e Isolamento de Superfície Atacadista

## Status
**Aceito** (Data: 2026-09-07)

## Contexto
O catálogo do Corsys opera com modalidade híbrida (Varejo B2C e Atacado B2B). Na concepção inicial, regras de atacado e preços diferenciados podiam ser consultados ou inferidos publicamente caso não houvesse segregação rígida de autorização no banco de dados.

Para proteger políticas comerciais, margens de lucro dos distribuidores e a integridade do ecossistema B2B, foram identificados os seguintes requisitos arquiteturais:
1. **Proteção de Preços e Condições B2B:** Preços de atacado (`wholesale_price`), quantidades mínimas (`wholesale_min_quantity`) e status de habilitação (`wholesale_enabled`) não podem ser acessíveis ao visitante anônimo ou a clientes não autorizados.
2. **Credenciamento Empresarial Formal:** O acesso à compra atacadista requer validação prévia de dados cadastrais (CNPJ válido, Razão Social, Nome Fantasia, Contato, Localização) e aprovação explícita pelo administrador da loja (`tenant_admin`).
3. **Segregação de Papéis e Identidades:** Clientes atacadistas (`wholesale_customers`) não são membros da equipe operacional do lojista (`tenant_users`), exigindo tabela dedicada e ciclo de vida próprio (`pending` -> `approved` / `rejected` <-> `suspended`).
4. **Governança de Mutação (Princípio do Menor Privilégio):** Clientes no navegador jamais realizam mutações diretas em tabelas de credenciamento ou autorização. A submissão e o gerenciamento ocorrem via Edge Functions auditadas com concessões colunares restritivas para `service_role`.

---

## Decisões Tomadas

### 1. Varejo Público vs. Atacado Autenticado e Autorizado
- **Superfície Pública (Anon):** Consome a view `public.catalog_products` (ou tabela `products`), onde colunas B2B (`wholesale_price`, `wholesale_min_quantity`, `wholesale_enabled`, `cost_price`) têm privilégio `REVOKE SELECT` forçado para `anon`. O catálogo público exibe exclusivamente preços e dados de varejo.
- **Superfície Atacadista (Authenticated B2B):** Acesso liberado exclusivamente para usuários autenticados com registro aprovado (`status = 'approved'`) na tabela `public.wholesale_customers`.

### 2. Entidade de Credenciamento Dedicada (`public.wholesale_customers`)
- Segregação física entre equipe interna (`public.tenant_users`) e compradores corporativos (`public.wholesale_customers`).
- Campos estruturados: `id`, `tenant_id`, `user_id` (vinculado ao `auth.users` após ativação), `cnpj`, `legal_name`, `trade_name`, `contact_name`, `email`, `phone`, `city`, `state`, `status` (`pending`, `approved`, `rejected`, `suspended`), `approved_at`, `approved_by`, `created_at`, `updated_at`.
- Integridade: Chave única composta `UNIQUE(tenant_id, cnpj)` impedindo duplicação de cadastros corporativos dentro do mesmo tenant.

### 3. RPC Sanitizada de Catálogo Atacadista (`public.get_wholesale_catalog`)
- Criação da função `public.get_wholesale_catalog(p_tenant_slug TEXT)` com `SECURITY DEFINER` e `SET search_path = ''` (reconciliada e reafirmada na Migration 000007).
- Execução com validação estrita *fail-closed*:
  - Verifica se o tenant está ativo via status = 'active'.
  - Valida se o tenant possui `allow_b2b_mode = true` de forma fail-closed (`COALESCE(s.allow_b2b_mode, false)`).
  - Exige `auth.uid()` não nulo e com registro aprovado (`status = 'approved'`) em `public.wholesale_customers`.
  - Retorna apenas produtos ativos com `wholesale_enabled = true` e `wholesale_price IS NOT NULL`.
  - Privilégios de execução estritamente restritos a `authenticated` (`REVOKE ALL FROM PUBLIC, anon`).

### 4. RPC de Consulta de Status B2B (`public.get_my_wholesale_status`)
- Função `public.get_my_wholesale_status(p_tenant_slug TEXT)` com `SECURITY DEFINER` para permitir que o storefront autenticado consulte seu estado de credenciamento e dados da empresa sem expor queries diretas na tabela.

### 5. Regras de Item e Mínimos de Atacado (Migration 000004)
- Na tabela `public.products`, cada SKU atacadista possui regra atômica:
  - `wholesale_enabled = true` -> `wholesale_price IS NOT NULL` AND `wholesale_min_quantity >= 1`.
  - `wholesale_enabled = false` -> `wholesale_min_quantity IS NULL`.
- Lógica de incremento no frontend: uma vez atingida a quantidade mínima por SKU (ex: mín. 10), o cliente pode incrementar de 1 em 1 unidade (10 -> 11 -> 12), sem forçar múltiplos de lote.
- Bloqueio comercial estrito caso o estoque disponível seja menor que o mínimo exigido pelo produto.

### 6. Menor Privilégio Auditado para `service_role` e Edge Functions
- `PUBLIC`, `anon` e `authenticated` não possuem permissão de inserção, atualização ou exclusão em `public.wholesale_customers`.
- O papel `service_role` opera com concessões colunares mínimas necessárias:
  - `GRANT SELECT ON public.wholesale_customers TO service_role;`
  - `GRANT INSERT (tenant_id, cnpj, legal_name, trade_name, contact_name, email, phone, city, state, status) ON public.wholesale_customers TO service_role;` (utilizado por `submit-wholesale-application`).
  - `GRANT UPDATE (status, user_id, approved_at, approved_by) ON public.wholesale_customers TO service_role;` (utilizado por `manage-wholesale-customer`).
- **Ausência Total de DELETE:** Nenhuma role possui privilégio de exclusão física em `wholesale_customers`. Inativações são tratadas exclusivamente via transição de status (`suspended`).
- `updated_at` é mantido de forma determinística por trigger de banco de dados (`trg_wholesale_customers_updated_at` via `private.set_updated_at()`).

---

## Consequências

### Positivas
- **Sigilo Comercial Garantido:** Preços de atacado são completamente inacessíveis para o público geral, robôs de busca e concorrentes.
- **Auditoria e Compliance:** Todo cliente B2B possui CNPJ validado e trilha de aprovação registrada com carimbo de data/hora (`approved_at`) e identificador do administrador responsável (`approved_by`).
- **Defesa em Profundidade:** Mesmo que um cliente autenticado tente executar queries diretas via PostgREST, a camada de RLS e a ausência de grants de escrita impedem adulterações cadastrais ou auto-aprovações.
- **UX Clara e Não Destrutiva:** O carrinho do usuário preserva a integridade de dados na alternância de modos de compra, exigindo consentimento explícito antes de remover itens não elegíveis.

### Limitações e Próximos Passos
- As Edge Functions (`submit-wholesale-application` e `manage-wholesale-customer`) foram codificadas e validadas estaticamente, devendo ser implantadas na infraestrutura em etapa de deploy dedicada.
- O fluxo de convite e ativação de senha de novos usuários B2B aprovados consumirá a API de autenticação do Supabase via backend.
