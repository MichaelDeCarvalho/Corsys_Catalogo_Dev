# PROJECT CONTEXT - CORSYS CATÁLOGO B2B / B2C

## 1. Visão Geral do Projeto
- **Nome:** Corsys Catálogo Multi-tenant B2B / B2C
- **Cliente / Catálogo Oficial:** MC Distribuição
- **Tenant Principal Demo:** `corsys-catalogo-demo` (Slug canônico pré-existente)
- **Data da Importação Oficial:** 2026-09-03 / 2026-09-04
- **Ambiente de Banco:** Supabase PostgreSQL V2 com RLS Rigoroso e Multi-tenancy Nativo

## 2. Configurações Públicas Reais do Tenant (Etapa 5A.1)
- **Nome Público (`public_name`):** `Corsys.Catálogo`
- **WhatsApp Oficial (`whatsapp_number`):** `+5541992928033` (normalizado)
- **Modo B2B (`allow_b2b_mode`):** `true` (habilitado para atacado)
- **Visibilidade de Preços (`hide_prices_without_login`):** `false` (preços visíveis publicamente sem login)
- **Pedido Mínimo Varejo (`min_order_value`):** `R$ 400,00`
- **Pedido Mínimo Atacado (`wholesale_min_order_value`):** `R$ 1.000,00` (nova coluna adicionada ao schema)
- **Métodos de Entrega (`delivery_methods`):** `["retirada", "entrega", "uber", "transportadora", "outro"]`
- **Identidade Visual:**
  - `logo_url`: `NULL` (ainda não definido)
  - `banner_url`: `NULL` (ainda não definido)
  - `primary_color`: `#0F172A`
  - `accent_color`: `#FF5A00`
- **Paleta Visual Completa Aprovada (para aplicação no Frontend na Etapa 5B):**
  - `--primary-dark`: `#0F172A`
  - `--primary-accent`: `#FF5A00`
  - `--cta-text`: `#FFFFFF`
  - `--bg-main`: `#F8FAFC`
  - `--bg-card`: `#FFFFFF`
  - `--border-color`: `#E2E8F0`
  - `--cta-hover`: `#D94E00`
  - `--success`: `#16A34A`
  - `--text-muted`: `#475569`

## 3. Inventário do Catálogo Oficial
- **Arquivo Canônico Limpo:** `data/imports/catalogo_oficial_20260903.csv` (Exatamente 7 colunas, 520 produtos)
- **Total de Produtos Oficiais Únicos:** 520 produtos
- **Total de SKUs Duplicados na Entrada Bruta Desconsiderados:** 112 linhas repetidas (duplicatas idênticas de cauda do bloco CU002 a CH006)
- **Produtos com Atacado Nulo ('-'):** 21 produtos (convertidos para `wholesale_price = NULL`)
- **Estoque Principal Importado:** 100% fiel à fonte oficial
- **Campos Especiais e Metadados:**
  - `brand = NULL` (não inventado)
  - `technical_specs = '{}'::jsonb` (sem dados não oficiais)
  - `unit = 'un'`
  - `min_order_quantity = 1`
  - `images = ARRAY[]::TEXT[]` (sem mocks ou URLs inventadas)
  - `featured = false`, `is_new = false`, `active = true`, `sort_order = 0`
- **Wholesale Tiers:** Nenhuma tier fictícia gerada (respeito estrito ao escopo)

## 4. Estado das Migrations (Congeladas em Produção)
- `supabase/migrations/20260902_000001_initial_schema.sql`: **APLICADA / CONGELADA**.
- `supabase/migrations/20260903_000002_import_official_catalog.sql`: **APLICADA / CONGELADA** (bootstrap de 520 produtos).
- `supabase/migrations/20260904_000003_public_catalog_settings.sql`: **APLICADA / CONGELADA** (configurações públicas e pedido mínimo atacado).
- `supabase/migrations/20260905_000004_wholesale_item_rules.sql`: **APLICADA / CONGELADA** (regras de atacado por item e view pública sanitizada via DROP/CREATE).
- `supabase/migrations/20260907_000005_b2b_wholesale_access.sql`: **APLICADA / CONGELADA** (credenciamento B2B, tabela wholesale_customers, RPCs com fail-closed).
- `supabase/migrations/20260909_000006_branding_storage.sql`: **APLICADA / CONGELADA** (policies de autorização e menor privilégio para bucket tenant-assets).
- `supabase/migrations/20260910_000007_reconcile_b2b_catalog_security.sql`: **APLICADA / CONGELADA** (forward-fix de reconciliação determinística de catalog_products e fail-closed B2B).
- `supabase/migrations/20260916_000008_product_media_storage.sql`: **APLICADA NO SUPABASE HOSTED / CONGELADA** (bucket `product-media`, estrutura de paths e policies iniciais).
- `supabase/migrations/20260917_000009_fix_product_media_policy_scope.sql`: **APLICADA NO SUPABASE HOSTED / CONGELADA** (qualificação explícita `storage.foldername(storage.objects.name)` contra shadowing).
- `supabase/migrations/20260928_000010_orders_checkout_v1.sql`: **APLICADA NO SUPABASE HOSTED / CONGELADA** (idempotency_key, shopping_mode, delivery_method, order_number_seq, RPC interna e RPC de status).
- `supabase/migrations/20260930_000012_order_documents_storage.sql`: **APLICADA / CONGELADA** (bucket privado `order-documents`, limite 5MiB, MIME application/pdf, zero client policies em storage.objects, zero SELECT/INSERT/UPDATE/DELETE para browser, operações server-side via service_role, cliente recebe somente signed URL temporária).
- `supabase/migrations/20261001_000013_security_definer_hardening.sql`: **APLICADA / CONGELADA NO SUPABASE HOSTED** (Database hardening: RUNTIME VERIFIED - get_my_wholesale_status SECURITY INVOKER + RLS, RPC interna get_wholesale_catalog_internal service-role-only, desativação de get_wholesale_catalog para browser, revogação de manage_order_status para API roles PUBLIC, anon, authenticated e service_role).
- `supabase/migrations/20261005170000_000014_admin_order_management.sql`: **APLICADA / CONGELADA NO SUPABASE HOSTED** (Forward-only; RPC interna manage_order_status_internal service-role-only, bloqueio defensivo mantido da RPC legada manage_order_status, controle transacional de ciclo de vida e estoque pessimista ordenado).
- `supabase/migrations/20261008_000015_customer_order_tracking.sql`: **APLICADA / CONGELADA NO SUPABASE HOSTED** (Item 3: Meus Pedidos / Customer Order Tracking V1. Colunas buyer_user_id e tracking_token_hash, check constraint de 64 hex, índices dedicados, RPCs internas track_order_by_token_internal e list_my_customer_orders_internal restritas a service_role, create_order_checkout_internal recriada preservando buyer_user_id apenas para atacado).
- `supabase/migrations/20261009000000_000016_customer_order_tracking_hardening.sql`: **APLICADA / CONGELADA NO SUPABASE HOSTED** (Forward-only; sanitização estrita de saída sem PII e sem internal IDs nas RPCs de rastreamento, shopping_mode estrito por modalidade, resolução histórica de loja sem t.status = 'active', reafirmação de ACL).

- `supabase/migrations/20261009010000_000017_checkout_delivery_methods_compat.sql`: **RELEASE CANDIDATE / HOSTED STATUS PENDING POST-MERGE** (hotfix forward-only: compatibilidade de `delivery_methods` com arrays JSONB de strings e objetos `{ id, active }`; corrige SQLSTATE 22000 no checkout sem alterar migrations congeladas).\n\n*Regra de Ouro: Migrations 000001 a 000016 estão aplicadas e congeladas no Supabase Hosted. A migration 000017 é o hotfix forward-only aguardando verificação pós-merge.*

## 5. Fechamento de Mídia de Produtos (Product Media Storage V1 — RUNTIME PASS)
- **Status Geral:** **RUNTIME PASS CONCLUÍDO (SUPABASE HOSTED + WORKSPACE VALIDADO)**.
- **Upload Individual:** RUNTIME PASS validado no SKU `BR022`.
- **Gestão de Imagens:** Upload, persistência em `public.products.images[]`, reordenação determinística (posição 0 como principal) e remoção física do objeto antigo no Storage: RUNTIME PASS.
- **Variant Family Imagery:** RUNTIME PASS (famílias adotam primeira variante real ordenada com foto, e busca por SKU prioriza variante destacada).
- **Importador em Massa por SKU (Bulk Image Importer):**
  - Implementado com parsing estrito de `manifest.json` e dry-run obrigatório em memória (zero writes / zero uploads).
  - Lote piloto de 17 SKUs executado e validado:
    - 17 SUCCESS
    - 0 FAILED
    - 0 SKIPPED
    - 17 URLs persistidas em `public.products.images[]`
    - 17 objetos físicos correspondentes no bucket `product-media`
    - 0 imagens órfãs observadas no teste.
  - Persistência atômica condicional implementada via `updateAdminProductImagesIfEmpty` (`images = '{}'`, `deleted_at IS NULL`, `tenant_id` e `id`), prevenindo condições de corrida TOCTOU.
  - Colisão concorrente resulta em status `SKIPPED_CONCURRENT_IMAGE` com rollback compensatório imediato do upload e preservação da imagem preexistente.
  - Novas fotos continuam podendo ser adicionadas individualmente pelo painel administrativo a qualquer momento.

## 6. Estado Atual de Orders / Checkout (V1.2 — Single WhatsApp CTA + Private PDF)
- **Pedidos Reais em Produção (Supabase Hosted):**
  - Checkout OPERACIONAL no Hosted.
  - 3 pedidos reais atualmente persistidos em `public.orders`:
    - `PED-20260930-000001`
    - `PED-20260930-000002`
    - `PED-20261001-000003` (último pedido conhecido gerado pelo checkout real)
  - Zero inclusão de PII em documentações públicas ou código.
  - Valores server-authoritative íntegros e auditáveis.
- **Checkout V1.2:**
  - Fluxo otimizado: `cart -> details -> review -> WhatsApp`.
  - Etapa intermediária "Pedido recebido" removida do fluxo padrão.
  - CTA único na etapa review: "Enviar pedido pelo WhatsApp".
  - Validação fail-closed do número de WhatsApp antes de chamar a rede.
  - Pré-abertura de aba síncrona contra bloqueio de pop-up.
  - Geração de PDF profissional server-side via `pdf-lib` (1.17.1) no bucket privado `order-documents` (zero client policies; browser consome exclusivamente signed URL temporária de 7 dias).
  - Signed URL com validade de 7 dias (604.800 s).
  - Preços e pagamentos continuam com autoridade do servidor e status pendente.
- **Handoff de WhatsApp 100% Textual (Item 2 — ADR 010):**
  - **Status:** **IMPLEMENTADO / PENDING RUNTIME VALIDATION** até teste real após publicação.
  - O handoff final para o WhatsApp consome exclusivamente os dados do servidor (`CheckoutOrderReceipt`) via helper puro `buildOrderWhatsAppMessage`.
  - Mensagem sempre textual com todos os produtos, quantidades, SKU, variantes, unidade e valores.
  - Link de PDF removido do WhatsApp. PDF server-side permanece intacto para auditoria e emissão administrativa.
- **B2B:**
  - Tenant público canônico reconciliado com `PUBLIC_TENANT_SLUG`.
  - `purchaseMode` e `shoppingMode` sincronizados com fallback fail-closed.
## 7. Hospedagem Frontend (Cloudflare Workers Static Assets)
- **Pipeline de Deploy:** GitHub `main` → Cloudflare Workers Builds → `bun run build` → Workers Static Assets (`dist/`).
- **Deploy Command:** `npx wrangler deploy`.
- **Cloudflare Build Variable:** `BUN_VERSION=1.4.2`.
- **Public Build Variables:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_PUBLIC_TENANT_SLUG`.
- **Backend:** Permanece 100% no Supabase (Auth, PostgreSQL/RLS, Storage, Edge Functions).
- **Validações Runtime:**
  - Cloudflare runtime validation: **PASS** (`https://corsys-catalogo.corsys1.workers.dev`).
  - Storefront & Conexão Supabase: **PASS**.
  - Checkout e Persistência de Pedidos: **PASS** (Operacional no Hosted com 3 pedidos reais).
  - Domínio customizado: Ainda NÃO configurado.

## 8. Gestão Administrativa de Pedidos (Admin Orders V1 & V2)
- **Admin Orders V1:** **PUBLICADO / RUNTIME READ PASS**.
  - O painel "Pedidos & Vendas" consome exclusivamente a tabela `public.orders` via Supabase Client autenticado sob proteção rigorosa de RLS (`orders_select_tenant_admin` / `platform_admin`).
  - Mocks (`INITIAL_ORDERS`, `PED-2025-0841`, `PED-2025-0842`) e `localStorage` estão 100% isolados fora da superfície administrativa.
  - `TenantDashboard` resolve o UUID real do tenant via `resolveTargetTenantId()` e invoca `fetchAdminOrders(tenantId)`. KPIs de faturamento, total de pedidos e novos pedidos pendentes derivam 100% dos dados reais do banco.
  - `OrderManager` é componente props-driven (`orders`, `loading`, `error`, `onReload`).
  - Contrato real fail-closed com campos opcionais seguros (`number`, `complement`, `neighborhood`, `city`, `state`, `zipCode`, `email`, `document`, `companyName`).
- **Admin Orders V2:** **PUBLICADO / RUNTIME PASS / CLOSED**.
  - **Migration 000014:** `supabase/migrations/20261005170000_000014_admin_order_management.sql` = **APLICADA / CONGELADA NO SUPABASE HOSTED**.
  - **RPC Interna Segura:** `public.manage_order_status_internal(p_order_id, p_new_status, p_actor_user_id)` com `SECURITY DEFINER`, `search_path = ''` e privilégios concedidos exclusivamente a `service_role`.
  - Reafirmação defensiva de revogação da RPC legada `manage_order_status` para `PUBLIC`, `anon`, `authenticated` e `service_role`.
  - **Controle Transacional de Estoque:** Locks pessimistas ordenados por UUID em produtos para débito atômico na aprovação (`pending -> approved`) e estorno no cancelamento (`approved/preparing -> cancelled`).
  - Estados `delivered` e `cancelled` são terminais irreversíveis.
  - **Edge Function `manage-order-status`:** **ACTIVE v1 / verify_jwt = true**.
    - Declarada com `verify_jwt = true` em `supabase/config.toml`.
    - Responsabilidade única de ciclo de vida: payload exato `{ orderId, newStatus }` (<= 4 KB).
    - Derivação do operador server-side via `auth.getUser()`.
    - Invocação da RPC interna com credenciais `service_role` e retorno mínimo sem PII.
  - **Edge Function `generate-admin-order-pdf`:** **ACTIVE v1 / verify_jwt = true**.
    - Declarada com `verify_jwt = true` em `supabase/config.toml`.
    - Payload exato `{ orderId }` (<= 4 KB).
    - **Autorização de Leitura via RLS:** Pedido consultado primeiro no contexto do JWT do operador; RLS autoriza (permitindo que `sales_rep` gere o PDF).
    - `service_role` executada estritamente pós-leitura autorizada para salvar no bucket `order-documents` e gerar Signed URL com **validade de exatamente 600 segundos**.
    - Zero logging de Signed URLs.
  - **Validação de Runtime Hosted:**
    - Controles de status: PASS.
    - Débito transacional de estoque: PASS.
    - Cancelamento e estorno de estoque: PASS.
    - Emissão e download de PDF oficial: PASS.
  - **Hotfix de Impressão e Frescor de Dados:**
    - Portal de impressão isolado fora da hierarquia React/Modal (`OrderPrintDocument` + `createPortal` para `document.body` com `#order-print-root`): **PASS / CLOSED**.
    - Ocultação de `#root` na impressão (`body > #root { display: none !important }`) e regras `@media print` com A4 portrait: **PASS / CLOSED**.
    - Callback `handleOrderStatusChanged` recarregando concorrentemente pedidos e produtos após mutação de status: **PASS / CLOSED**.
    - Auto-refresh de janela/aba via `focus` e `visibilitychange` com throttle de 800ms (`lastRefreshAtRef`): **PASS / CLOSED**.
    - Proibição de `setInterval` e Realtime (`supabase.channel`, `postgres_changes`).
  - **Hard Delete Proibido:** Permanece estritamente vedada a exclusão física de pedidos (`.delete()`); histórico transacional auditável.
  - **Gate de Qualidade CI:**
    - `bun run test:regression` e `bun run check` encadeando 8 suítes com 100% de aprovação. Registrado no ADR 009.

## 9. Governança de Engenharia — ECC (2026-10-02)
- **Gerenciador de Pacotes:** `bun@1.4.2` especificado no `package.json`.
- **Quality Gate Unificado:** `bun run check` encadeia `bun run lint` (`tsc --noEmit`), `bun run build` (`vite build`) e `bun run test:regression` (8 suítes automatizadas aprovadas).
- **GitHub Actions Quality:** Workflow `.github/workflows/quality.yml` com `permissions: contents: read` e zero secrets no runner.
- **Governança Documental:** Registrado nos ADRs 008 (`docs/adr/ADR_008_ECC_ENGINEERING_GOVERNANCE.md`) e 009 (`docs/adr/ADR_009_ADMIN_ORDERS_V2_LIFECYCLE_AND_STOCK.md`).




## Item 4 — Configurabilidade dos campos do checkout (2026-10-08)
- Implementação: ADR 012; nova migration `20261009020000_000018_checkout_field_settings.sql`.
- Configuração por tenant com allowlist explícita de 14 campos e flags booleanas `visible`/`required`; 10 campos configuráveis e 4 campos obrigatórios fixos nesta versão.
- Enforcement na RPC transacional, descarte de valores ocultos, políticas RLS/grants existentes preservadas. Administração em Configurações da Loja com UPDATE condicional contra sobrescrita concorrente.
- Identidade B2B oficial, Itens 1–3, WhatsApp textual, PDFs e tracking preservados. Itens 5/6 fora do escopo.
- Estado desta revisão: tipos/build/regressão local PASS; Hosted/CI/publicação aguardam evidência pós-commit no SESSION_HANDOFF.
- Confirmação de retomada: migrations 000001–000017 aplicadas no Hosted em 2026-10-08; notas históricas anteriores de pendência de 000016/17 estão superadas por esta inspeção.

### Evidência operacional Item 4
Schema 000018 e testes transacionais do Hosted PASS; Quality/Verify no commit 884c741 SUCCESS. A migration recebeu versão automática 20261008202538, distinta do arquivo 20261009020000; alinhamento somente desta nova entrada depende de autorização específica após rejeição da revisão automática. PR 2 aberto; publicação Cloudflare pendente. Consulte SESSION_HANDOFF para evidências e próximos passos. Migrations 1–17 e pedidos reais preservados.

Atualização: alinhamento da migration 000018 autorizado explicitamente e executado em 2026-10-08; versão Hosted=20261009020000, idêntica ao arquivo. Bloqueio anterior resolvido; publicação em andamento (estado final no SESSION_HANDOFF).

Estado final Item 4: PR 2 integrado (4759ae5), Hosted alinhado em 000018=20261009020000, CI PASS e runtime Cloudflare publicado. Edição administrativa autenticada com save da política original e recarga PASS. Evidências e limites no SESSION_HANDOFF. Itens 5/6 não iniciados.


## Continuidade — Proteção de sessão B2B (PR #6, 2026-10-09)

- Revisão retomada encontrou e corrigiu a herança de modo/carrinho/modal na troca direta de comprador. Sete testes executando o provider React DOM passaram após correção, e `bun run check` local passou com Bun 1.4.2; limites, release e recuperação parcial dos Itens 5/6 registrados no início do handoff. PR segue sem merge/deploy e E2E autenticado pendente.

- A revisão de QA identificou possível race condition de respostas antigas de status/catálogo após logout ou troca de comprador. A correção está somente em branch de QA e **não foi publicada** em produção.
- `WholesaleAccessContext` usa `src/utils/wholesaleRequestGate.ts` para invalidar resultados obsoletos e restringir o estado de identidade/preço B2B à sessão atual. O backend mantém autoridade sobre elegibilidade e valores.
- Foram adicionados testes de contrato do payload atacadista e de ordenação de respostas; conclusão de CI está registrada no PR correspondente, após execução.
- Itens 5 e 6 seguem com escopo desconhecido, fora desta correção. O E2E B2B navegador ainda requer ambiente isolado e usuário de teste aprovado vinculado à autenticação.
# Continuidade Cloudflare — 2026-10-10
Log autenticado identificou ausência de `previews` como causa da falha de branch. Correção mínima de configuração preserva URLs desativadas, produção e isolamento sem backend. Resultado remoto da nova revisão deve ser confirmado separadamente. E2E B2B isolado e requisitos 5/6 continuam pendentes; não provisionar custo nem usar fixtures de produção.

## QA local autenticado — 2026-10-10

Ver ADR 013 para decisões, migration 000020 e diferenças controladas do ambiente local. Supabase local real, Auth real e fixtures fictícias; nenhuma alteração Hosted. RLS/integridade e checkout_fields executados no PostgreSQL com rollback: PASS. Oito testes de API local: PASS (anon/pending denied, aprovado A, isolamento A/B, total forjado negado, mínimo negado, pedido oficial total 100, idempotência). Correções encontradas: arquivamento de produto por admin, tiers B2B públicos, catálogo vazio após reload de comprador autenticado e recibo HTTP local. Bun check inclui fronteiras HTTPS/loopback.

A matriz RLS legada fica corrigida pela ADR 013: anon não consulta wholesale_tiers; equipe autorizada mantém políticas próprias. Os testes de preparação de orders agora incluem idempotency_key. Não declarar que Hosted recebeu essas correções.



## Estado consolidado — entrega Google Routes, 2026-10-11

Integração local implementada: painel de métodos/endereço/tarifas, cálculo automático DRIVE básico no servidor, link Maps sem chave e estimativa separada do total oficial. Sem distância manual. Chave exclusivamente no servidor local, Routes API somente, sem restrição IP por decisão expressa do usuário após explicação dos riscos. Quatro consultas Google reais: 4143 metros, Moto R$7,46, Carro/Caminhão R$10,36. Produção permanece sem ativação.

Limites persistentes: 10 tentativas por janela de 60 segundos, 250/dia e 7500/mês; reserva antes da chamada, falhas consomem cota, bloqueios sem fallback. Arquivo secreto fora do checkout com ACL restrita; check examina código e artefatos para impedir publicação de chaves. Endereço da loja é compartilhado no resultado/link, apesar de a configuração ser privada; painel informa isso explicitamente.

Revalidação HTTP com Auth real local: 18/18 PASS em 2026-10-11, incluindo isolamento A/B, revogação, idempotência, mínimos, campos e varejo. Nenhuma mensagem enviada. A matriz completa de interface B2B e corridas com rede real continua PARTIAL; não converter cobertura de API/componente em E2E PASS. Relatório detalhado em docs/qa/GOOGLE_MAPS_ACTIVATION.md.

Riscos: Origin não autentica; abuso pode esgotar limites. Chave vazada permite chamadas diretas que ignoram contadores locais; Routes API não restringe SKU e alertas não bloqueiam cobrança. IAM/2FA ainda não avaliados. Não há garantia de custo zero, nem autorização de merge/deploy de produção.

## Marco de QA/release em 2026-10-14 (PR #6)

- Autorizadas e aplicadas somente migrations 000019 (entrega privada) e 000020 (RLS preços por faixas); histórico da produção alinhado, 20 migrations/6 pedidos/520 produtos. Entrega por rotas pagas permanece desativada, sem execução das migrations Google ou implantação de nova Edge Function.
- Na branch QA, os testes React DOM do contexto B2B cresceram de 8 para 14 cenários sintéticos, incluindo suspenso/rejeitado, erro, clique duplicado e revogação; o CI dessas alterações foi confirmado separadamente. Alterações de UI exigem opt-in público VITE_GOOGLE_ROUTES_UI_ENABLED='true' para mostrar cálculo e habilitar opção administrativa; backend continua com flag separada.
- Homologação B2B local real histórica cobre happy path, 18 requisições autenticadas, RACE-01–04 e PF com recibo/tracking; matriz B2B-01–13 continua PARTIAL para subcasos de blocked, todos os campos, PJ e handoff externo. Não autorizar merge por equivalência de CI a E2E. Documentos de status e release: docs/qa/CHECKOUT_B2B_E2E_VALIDATION.md e docs/qa/PR6_RELEASE_GATE_20261014.md.
