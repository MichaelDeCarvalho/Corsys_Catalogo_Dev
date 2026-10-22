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

*Regra de Ouro: Migrations 000001 a 000013 estão estritamente aplicadas e congeladas no Supabase Hosted. O hardening de banco foi verificado em runtime (3 achados do Security Advisor eliminados; residual auth_leaked_password_protection permanece por plano Free). A Edge Function get-wholesale-catalog está com correção de bundle preparada aguardando redeploy e runtime validation. Cloudflare frontend build: SUCCESS.*

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
- **Pedidos Reais em Produção:**
  - PED-20260930-000001 validado no Supabase hosted:
    - Status: `pending`
    - Valores server-authoritative íntegros
    - Estoque não decrementado (correto para pending)
    - Sem duplicidades
- **Checkout V1.2:**
  - Fluxo otimizado: `cart -> details -> review -> WhatsApp`.
  - Etapa intermediária "Pedido recebido" removida do fluxo padrão.
  - CTA único na etapa review: "Enviar pedido pelo WhatsApp".
  - Validação fail-closed do número de WhatsApp antes de chamar a rede.
  - Pré-abertura de aba síncrona contra bloqueio de pop-up.
  - Geração de PDF profissional server-side via `pdf-lib` (1.17.1) no bucket privado `order-documents` (zero client policies; browser consome exclusivamente signed URL temporária de 7 dias).
  - Signed URL com validade de 7 dias (604.800 s).
  - Mensagem curta no WhatsApp com link para o documento, minimizando exposição de PII.
  - Graceful fallback textual caso a geração/assinatura do PDF falhe.
  - Preços e pagamentos continuam com autoridade do servidor e status pendente.
- **B2B:**
  - Tenant público canônico reconciliado com `PUBLIC_TENANT_SLUG`.
  - `purchaseMode` e `shoppingMode` sincronizados com fallback fail-closed.
- **Legado ainda existente:**
  - `AppContext` local orders
  - `OrderManager` local
  - `TenantDashboard` KPIs locais

## 7. Hospedagem Frontend (Cloudflare Workers Static Assets)
- **Pipeline de Deploy:** GitHub `main` → Cloudflare Workers Builds → `bun run build` → Workers Static Assets (`dist/`).
- **Deploy Command:** `npx wrangler deploy`.
- **Cloudflare Build Variable:** `BUN_VERSION=1.4.2`.
- **Public Build Variables:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_PUBLIC_TENANT_SLUG`.
- **Backend:** Permanece 100% no Supabase (Auth, PostgreSQL/RLS, Storage, Edge Functions).
- **Validações Runtime:**
  - Cloudflare runtime validation: **PASS** (`https://corsys-catalogo.corsys1.workers.dev`).
  - Storefront & Conexão Supabase: **PASS**.
  - Checkout Feature Gate (503 fail-closed): **PASS**.
  - `CHECKOUT_ENABLED`: Mantido desligado (OFF).
  - Domínio customizado: Ainda NÃO configurado.

## 8. Governança de Engenharia — ECC (2026-10-02)
- ECC adotado seletivamente como metodologia de engenharia; bundle/runtime completo não foi copiado.
- Comando consolidado: `bun run check` = typecheck + regressões + build.
- GitHub Actions de qualidade executa em PR/push para `main` com `contents: read` e sem secrets.
- Referência: `docs/engineering/ecc-adoption.md` e ADR 008.
- Nenhuma migration, dado ou configuração Supabase hosted foi alterada por esta adoção.
