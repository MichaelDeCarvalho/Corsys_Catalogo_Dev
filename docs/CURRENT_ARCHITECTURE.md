# CURRENT ARCHITECTURE - CORSYS MULTI-TENANT

## 1. Arquitetura de Banco e Multi-tenancy
- **Camada de Dados:** PostgreSQL hospedado no Supabase.
- **Isolamento Multi-tenant:** Chave `tenant_id` em todas as tabelas transacionais e cadastrais com RLS (`ROW LEVEL SECURITY`) habilitado e forçado.
- **Resolução de Tenants:** Canônica pelo campo `slug` em `public.tenants` (ex: `corsys-catalogo-demo`), propagada automaticamente para `public.tenant_public_settings` via triggers de sincronização.

## 2. Estrutura de Configurações Públicas (`public.tenant_public_settings`)
- **Evolução de Schema (Migration 000003):**
  - Coluna `wholesale_min_order_value NUMERIC(10,2)` adicionada para diferenciar o valor mínimo de pedido para atacado B2B do valor mínimo geral/varejo B2C (`min_order_value`).
  - Constraint: `chk_tenant_public_settings_wholesale_min_order` (`wholesale_min_order_value IS NULL OR wholesale_min_order_value >= 0.00`).
- **Valores Gravados para `corsys-catalogo-demo`:**
  - `public_name`: `Corsys.Catálogo`
  - `whatsapp_number`: `+5541992928033`
  - `min_order_value`: `400.00`
  - `wholesale_min_order_value`: `1000.00`
  - `allow_b2b_mode`: `true`
  - `hide_prices_without_login`: `false`
  - `delivery_methods`: `'["retirada","entrega","uber","transportadora","outro"]'::jsonb`
  - `primary_color`: `#0F172A`
  - `accent_color`: `#FF5A00`
  - `logo_url`: `NULL`
  - `banner_url`: `NULL`

## 3. Catálogo Oficial e Importação (Bootstrap 000002)
- **Pipeline de Ingestão:**
  1. Fonte bruta em CSV/texto.
  2. Armazenamento canônico em `data/imports/catalogo_oficial_20260903.csv` (exatamente 7 colunas e 520 produtos).
  3. Migration `supabase/migrations/20260903_000002_import_official_catalog.sql` autocontida com 520 tuplas literais em staging table.
  4. Validações fail-closed e INSERT direto em `public.products` (sem UPSERT).

## 4. Regras de Itens e Mínimos de Atacado (Migration 000004 & Reconciliação 000007)
- **Campos Estruturados em `public.products`:**
  - `wholesale_enabled BOOLEAN NOT NULL DEFAULT false`
  - `wholesale_min_quantity INTEGER`
- **Constraints de Integridade:**
  - `chk_products_wholesale_enabled_rules`: `wholesale_enabled = true` exige `wholesale_price IS NOT NULL` e `wholesale_min_quantity >= 1`; `wholesale_enabled = false` força `wholesale_min_quantity IS NULL`.
- **View Pública (`public.catalog_products`):**
  - Recriação determinística via `DROP VIEW IF EXISTS` + `CREATE VIEW WITH (security_invoker = true)`.
  - Oculta estritamente `wholesale_price`, `wholesale_min_quantity`, `wholesale_enabled` e `cost_price` de consultas anônimas e públicas.

## 5. Arquitetura de Acesso B2B e Credenciamento (Migrations 000005 & 000007)
- **Tabela `public.wholesale_customers`:**
  - Segregação de compradores B2B com `UNIQUE(tenant_id, cnpj)` e status (`pending`, `approved`, `rejected`, `suspended`).
  - RLS deny-by-default: zero privilégios de escrita para `PUBLIC`, `anon` e `authenticated`.
  - Policies replay-safe contra duplicação em rebuilds.
  - `service_role` com privilégios colunares restritivos (Least Privilege).
  - Sem privilégio de `DELETE` no sistema.
- **RPCs Sanitizadas (`SECURITY DEFINER` com `SET search_path = ''`):**
  - `public.get_wholesale_catalog(p_tenant_slug)`: Acesso estritamente autenticado e aprovado. Fail-closed total com `COALESCE(s.allow_b2b_mode, false)` (loja sem settings ou com allow_b2b_mode desabilitado bloqueia B2B).
  - `public.get_my_wholesale_status(p_tenant_slug)`: Consulta de estado de credenciamento.
  - `public.get_wholesale_catalog` com privilégios restritos a `authenticated` (`REVOKE ALL FROM PUBLIC, anon`).
- **Migration 000007 (Forward-Fix Oficial):**
  - Reconciliação determinística em produção de `catalog_products`, RPC `get_wholesale_catalog` fail-closed e grants de anon em `public.products`.

## 6. Estado das Edge Functions B2B
- `supabase/functions/submit-wholesale-application/index.ts`:
  - Configuração: `[functions.submit-wholesale-application]` com `verify_jwt = false`.
  - Validações: tenant por slug, tenant ativo, allow_b2b_mode, honeypot anti-spam, CNPJ módulo 11, duplicidade e status forçado = `pending`.
  - Status: Pronta, configurada e auditada no runtime B2B.
- `supabase/functions/manage-wholesale-customer/index.ts`:
  - Configuração: `[functions.manage-wholesale-customer]` com `verify_jwt = true`.
  - Validações: JWT bearer token, resolução do usuário no auth, autorização `tenant_admin` no mesmo `tenant_id`, convite Auth Admin com fail-closed e controle de transições (`approve`, `reject`, `suspend`, `reactivate`).
  - Status: Pronta, configurada e auditada no runtime B2B.

## 7. Design System e Paleta Visual
- `--primary-dark`: `#0F172A`
- `--primary-accent`: `#FF5A00`
- `--cta-text`: `#FFFFFF`
- `--bg-main`: `#F8FAFC`
- `--bg-card`: `#FFFFFF`
- `--border-color`: `#E2E8F0`
- `--cta-hover`: `#D94E00`
- `--success`: `#16A34A`
- `--text-muted`: `#475569`

## 8. Arquitetura de Storage para Branding (Migration 000006)
- **Bucket `tenant-assets`:**
  - Configuração: `public: true` (entrega pública de imagens via CDN do Supabase através de `getPublicUrl`), limite 5 MB (`5242880` bytes).
  - Tipos MIME permitidos: `image/png`, `image/jpeg`, `image/webp`.
  - Proibição estrita de SVG: `image/svg+xml` bloqueado tanto no frontend (MIME e Magic Bytes binários) quanto nas constraints do Storage (mitigação de XSS embutido).
- **Estrutura de Paths (Multi-tenancy Rígido):**
  - `<tenant_uuid>/branding/logo_<timestamp>.<ext>`
  - `<tenant_uuid>/branding/banner_<timestamp>.<ext>`
  - Fail-Closed: Validação estrita de UUID v4 (`isValidUUID`). Bloqueio total caso o tenantId seja slug, nome legado, vazio ou contenha path traversal.
- **Políticas RLS em `storage.objects` (Menor Privilégio):**
  - `tenant_assets_select_authenticated`: Restrito ao diretório do próprio tenant autenticado (`private.get_current_tenant_id()`) ou `platform_admin`. Necessário pois a API `storage.from().remove()` do Supabase exige privilégio de SELECT + DELETE. Nenhuma policy de enumeração pública em banco (anon não possui SELECT em `storage.objects`).
  - `tenant_assets_insert_tenant_admin`: Restrito a `tenant_admin` autenticado gravando no seu próprio diretório `<tenant_uuid>` ou `platform_admin`.
  - Sem policy de UPDATE: Menor privilégio. Todos os uploads são versionados por timestamp com `upsert: false`.
  - `tenant_assets_delete_tenant_admin`: Restrito a `tenant_admin` no seu próprio diretório `<tenant_uuid>` ou `platform_admin` para operações de rollback compensatório e limpeza de arquivos substituídos.
- **Consistência por Compensação (Sistemas Separados — Não ACID):**
  - Supabase Storage e PostgreSQL são subsistemas desacoplados sem suporte a transações distribuídas ACID. A integridade é garantida por fluxos compensáveis:
  - *Fluxo de Salvamento Simultâneo:*
    1. Upload do Logo no Storage (se selecionado).
    2. Upload do Banner no Storage (se selecionado). Se o banner falhar e o logo tiver sido enviado, executa rollback compensatório imediato apagando o novo logo do Storage.
    3. Atualização no banco de dados (`tenant_public_settings`). Se a gravação no banco falhar, executa rollback compensatório de ambos os novos objetos (logo e banner) no Storage, mantendo o banco intacto com os valores anteriores.
    4. Confirmação do banco: Atualiza estado da UI, revoga previews em memória (`URL.revokeObjectURL`) e realiza limpeza física das imagens substituídas no Storage.
  - *Fluxo de Remoção:*
    1. Atualização da coluna no banco para `NULL` primeiro.
    2. Atualização do estado da UI.
    3. Remoção física do objeto no Storage (se comprovadamente pertencente ao tenant).
- **Proteção contra Concorrência e Vazamento de Memória:**
  - Trava de concorrência (`isBusy = isSaving || isRemovingLogo || isRemovingBanner`): Bloqueio visual e disable em todos os botões de ação e inputs de arquivo durante mutações para impedir múltiplos uploads, duplos cliques e condições de corrida.
  - Gerenciamento de Object URLs: Execução obrigatória de `URL.revokeObjectURL(...)` ao trocar arquivo selecionado, ao remover preview, ao concluir salvamento e no unmount do componente via `useEffect`.
- **Exclusão Segura e Compatibilidade com URLs Legadas:**
  - Função `extractOwnedBrandingPath`: Antes de qualquer chamada a `storage.remove()`, valida que a URL antiga pertence estritamente ao bucket `tenant-assets` e começa exatamente com `<tenant_uuid>/branding/`.
  - Registros com URLs externas legadas (ex: `https://site-externo.com/logo.png`) ou de outros buckets são preservados sem tentativa de exclusão física, atualizando apenas o ponteiro no banco de dados (Fail-Closed).
- **Estado Real e Validação em Runtime (Supabase Hosted & Preview):**
  - Bucket `tenant-assets`: **EXISTE** e provisionado no Supabase Hosted (`public = true`, limite 5 MiB, MIME restrito a PNG, JPEG e WebP, SVG bloqueado).
  - Runtime via AI Studio Preview:
    - Logo upload: **PASS**
    - Logo reload e persistência: **PASS**
    - Banner upload: **PASS**
    - Banner reload e persistência: **PASS**
    - Substituição de assets: **PASS**
    - Remoção de assets: **PASS**
  - Validação de testes locais: 35/35 testes aprovados (`scripts/test-branding-storage-points.ts`), lint PASS, build PASS.
  - Teste Cross-tenant em runtime: **NOT TESTABLE IN CURRENT DATASET** (não declarar risco zero de forma cega; mitigado formalmente por RLS e validação de UUID no client).
- **Diferenciação Estrita de Domínio de Mídia:**
  - O bucket `tenant-assets` é destinado **exclusivamente ao branding da loja** (logo e banner do tenant).
  - Não armazena mídias de produto. O upload de imagens de produtos NÃO está implementado nesta etapa e fará parte de infraestrutura dedicada futura.

## 9. Governança de Migrations e Histórico
- **Migrations 000001 a 000010 Aplicadas e Congeladas:**
  - `000001_initial_schema.sql`: APLICADA / CONGELADA
  - `000002_import_official_catalog.sql`: APLICADA / CONGELADA
  - `000003_public_catalog_settings.sql`: APLICADA / CONGELADA
  - `000004_wholesale_item_rules.sql`: APLICADA / CONGELADA
  - `000005_b2b_wholesale_access.sql`: APLICADA / CONGELADA
  - `000006_branding_storage.sql`: APLICADA / CONGELADA
  - `000007_reconcile_b2b_catalog_security.sql`: APLICADA / CONGELADA
  - `000008_product_media_storage.sql`: APLICADA NO SUPABASE HOSTED / CONGELADA (SHA-256: `991566a46952cf2a7873f6e86393ef7d153e0ff780e79074ce997b775cb1883f`)
  - `000009_fix_product_media_policy_scope.sql`: APLICADA NO SUPABASE HOSTED / CONGELADA (SHA-256: `0a160dba2a7da7b6fd5fab1516afe9bd0c579820c127608bac98721696244051`)
  - `000010_orders_checkout_v1.sql`: APLICADA NO SUPABASE HOSTED / CONGELADA
- **Migration 000011 (Forward-Fix Hardening):**
  - `000011_orders_checkout_hardening.sql`: **CRIADA NO WORKSPACE / AGUARDANDO DEPLOY HOSTED**
- *Regra de Ouro:* Migrations 000001 a 000010 estão estritamente congeladas e aplicadas no Supabase Hosted. A migration 000011 foi criada de forma transacional e defensiva no workspace e aguarda homologação/deploy. Push para GitHub main deve ser tratado como potencial gatilho de deploy Supabase; não usar main como simples backup para mudanças ainda não aprovadas de migration ou Edge Function.

---

## 10. Arquitetura de Storage para Mídias de Produtos (Product Media Storage V1 — RUNTIME PASS)
- **Status da Etapa:** **PRODUCT MEDIA STORAGE V1 = RUNTIME PASS (SUPABASE HOSTED + WORKSPACE VALIDADO)**
- **Bucket `product-media`:**
  - Configuração em `supabase/config.toml`: `public = true`, `file_size_limit = "1MiB"`, `allowed_mime_types = ["image/png", "image/jpeg", "image/webp"]`.
  - SVG estritamente proibido (mitigação de XSS); GIF desabilitado nesta etapa.
- **Políticas RLS em `storage.objects` (Migrations 000008 e Forward-Fix 000009):**
  - *Status:* Ambas aplicadas e congeladas no Supabase Hosted.
  - Correção na 000009 qualifica explicitamente a linha externa como `storage.foldername(storage.objects.name)` contra shadowing em `products.name`.
  - `product_media_select_authenticated`: Restrito a `tenant_admin` no escopo do seu próprio tenant sob `/products/<product_id>` ou `platform_admin`, com produto existente e vinculado ao tenant.
  - `product_media_insert_tenant_admin`: Restrito a `tenant_admin` gravando sob `<tenant_uuid>/products/<product_uuid>` ou `platform_admin`, com produto existente e vinculado ao tenant.
  - `product_media_delete_tenant_admin`: Restrito a `tenant_admin` removendo sob `<tenant_uuid>/products/<product_uuid>` ou `platform_admin`, com produto existente e vinculado ao tenant.
  - Nenhuma policy de UPDATE (uploads versionados com `upsert: false`).
  - Nenhuma policy de SELECT público amplo em `storage.objects` (leitura pública consome CDN pública do bucket via `getPublicUrl`).
  - Sem DML direto em `storage.buckets` e sem `ALTER TABLE storage.objects`.
- **Validação Funcional em Runtime (SKU BR022) — RUNTIME PASS:**
  - Upload real no bucket `product-media`: PASS.
  - Path canônico `<tenant_uuid>/products/<product_uuid>/...`: PASS.
  - Persistência em `public.products.images[]`: PASS.
  - Reload administrativo preserva imagens: PASS.
  - Exposição via `catalog_products`: PASS.
  - Exibição na vitrine da loja: PASS.
  - Segunda imagem adicionada e promoção para principal (`images[0]`): PASS.
  - Nova principal refletida na vitrine: PASS.
  - Remoção lógica e exclusão física no Storage: PASS.
  - Zero imagens órfãs observadas no teste.
- **Variant Family Imagery (Storefront):**
  - Famílias de variações selecionam como imagem representativa a primeira variante real ordenada que possui imagem cadastrada (`images.length > 0`), sem alterar `product.images`.
  - Na busca por SKU (`highlightedSkus`), o card prioriza a foto do SKU pesquisado e o abre como variante inicial.
- **Importação em Massa por SKU (Bulk Image Importer):**
  - Associação via `manifest.json` com dry-run obrigatório em memória (zero writes, zero uploads).
  - Lote piloto de 17 SKUs executado e validado:
    - 17 SUCCESS
    - 0 FAILED
    - 0 SKIPPED
    - 17 URLs persistidas em `public.products.images[]`
    - 17 objetos físicos no Storage
    - 0 órfãos observados no teste.
  - Persistência condicional atômica implementada via `updateAdminProductImagesIfEmpty`:
    - Filtra estritamente `tenant_id`, `id`, `deleted_at IS NULL` e `images = '{}'`.
    - Se zero linhas forem atualizadas, aborta a gravação, executa rollback cirúrgico do upload no Storage e marca `SKIPPED_CONCURRENT_IMAGE`, eliminando janelas TOCTOU e prevenindo sobrescrita de imagens adicionadas simultaneamente.
  - Novas fotos continuam podendo ser adicionadas individualmente pelo painel administrativo a qualquer momento.
- **Validação Automatizada:**
  - `scripts/test-product-media-storage-points.ts`: 153/153 testes aprovados.
  - `scripts/test-catalog-performance-points.ts`: 34/34 testes aprovados.
  - `scripts/test-branding-storage-points.ts`: 35/35 testes aprovados.
  - `npm run lint` / `npm run build`: PASS.

---

## 11. Arquitetura Transacional Backend de Pedidos e Checkout (Orders V1 Frontend Integration & Hardening)
- **Orders Backend:** **RUNTIME HARDENING PASS**
- **000010:** **APLICADA / CONGELADA**
- **000011:** **APLICADA / CONGELADA**
- **submit-order-checkout:** **v2 ACTIVE** (verify_jwt = false, autorização service_role via SUPABASE_SECRET_KEYS)
- **Feature Gate:** **RUNTIME 503 PASS / CHECKOUT DESABILITADO** (`CHECKOUT_ENABLED !== "true"` retorna HTTP 503)
- **Frontend:** **INTEGRAÇÃO REAL IMPLEMENTADA NO WORKSPACE / AINDA NÃO VALIDADA COM PEDIDO REAL**
  - `CartDrawer` integrado ao `orderService.submitOrderCheckout`.
  - Zero autoridade financeira no cliente (subtotal, total, descontos e fretes recalculados pelo backend).
  - Idempotência baseada em UUID v4 e digest SHA-256 da intenção do pedido; sessionStorage livre de PII.
  - Fail-closed: erro HTTP 503 tratado inline com preservação do carrinho, dados do formulário e chave de idempotência.
  - Desacoplamento total de WhatsApp da criação de pedidos; PIX hardcoded e confetti expurgados.
- **B2B:**
  - Tenant público canônico reconciliado com `PUBLIC_TENANT_SLUG`.
  - `purchaseMode` (WholesaleAccessContext) autoritativo, com `shoppingMode` (AppContext) temporariamente sincronizado.
- **Legado ainda existente:**
  - `AppContext` local orders
  - `OrderManager` local
  - `TenantDashboard` KPIs locais
- **Decisão Arquitetural (ADR 004):** Duas camadas complementares (Edge Function pública como gateway + RPC PostgreSQL interna transacional).
- **Contrato de Ingestão de Pedidos (Zero Autoridade Financeira no Cliente):**
  - O storefront submete requisição à Edge Function `submit-order-checkout` (`verify_jwt = false`).
  - O payload contém apenas `productId`, `quantity`, `selectedVariant`, `customer`, `shippingAddress`, `deliveryMethod`, `paymentMethod` e `idempotencyKey` UUID v4 estrito.
  - Valores financeiros (`unitPrice`, `totalPrice`, `subtotal`, `discount`, `shipping_fee`, `total`) e `buyerUserId` são estritamente rejeitados do contrato client-side (HTTP 400).
- **Edge Function `submit-order-checkout` (Hospedada & Ativa):**
  - Modernizada com `Deno.serve` e `npm:@supabase/supabase-js@2`.
  - Autenticação via `SUPABASE_SECRET_KEYS` (extração segura da chave default; `SUPABASE_SERVICE_ROLE_KEY` legada removida).
  - **Feature Gate Fail-Closed:** `CHECKOUT_ENABLED !== "true"` retorna HTTP 503 (`Checkout temporariamente indisponível.`).
  - Limite de 64 KB aferido por contagem de bytes UTF-8 (`TextEncoder.encode(rawBody).byteLength`).
  - Honeypot anti-spam.
  - Autenticação Bearer obrigatória para `wholesale` (extração do `user.id` real do JWT; nunca do body).
  - Whitelist de campos para RPC interna.
  - Mapeamento e sanitização de erros SQLSTATE e minimização de resposta PII (sem `idempotency_key`, `tenant_id` ou endereços brutos na resposta).
- **RPC Interna `public.create_order_checkout_internal` (Migration 000011):**
  - `SECURITY DEFINER` com `SET search_path = ''`.
  - Concedida exclusivamente para `service_role` (REVOKE de `PUBLIC`, `anon` e `authenticated`).
  - Validação estrita de UUID v4 para `idempotency_key`.
  - Snapshots canônicos estritos para cliente e endereço de entrega.
  - Limites de tamanho de strings (slug <= 120, seller_code <= 64, delivery_method <= 64, notes <= 1000, name <= 160, street <= 200, selectedVariant <= 160).
  - Resolução de tenant ativo por slug canônico; fail-closed se inativo ou ausente.
  - Idempotência transacional por `UNIQUE (tenant_id, idempotency_key)` com captura de corrida de unicidade.
  - Validações B2B para `wholesale`: exige autenticação com credenciamento aprovado em `wholesale_customers`, `allow_b2b_mode = true` e subtotal `>= wholesale_min_order_value`.
  - Validações de varejo: `quantity >= min_order_quantity` e subtotal `>= min_order_value`.
  - Valida estoque atual disponível (`stock >= quantity`), mas **NÃO DECREMENTA ESTOQUE** no status `pending`.
  - Geração server-side de `order_number` via sequence `public.order_number_seq` (`PED-YYYYMMDD-000001`).
- **RPC Administrativa `public.manage_order_status` (Migration 000010):**
  - Executada exclusivamente por `authenticated` (`tenant_admin` ou `stock_manager` do mesmo tenant ou `platform_admin`).
  - Locks pessimistas ordenados por UUID de produto para evitar deadlocks.
  - Transição `pending -> approved`: valida produto ativo, não-deleted, estoque disponível e debita atomicamente com diagnóstico `GET DIAGNOSTICS v_affected_rows = 1`.
  - Transição `approved/preparing -> cancelled`: restaura estoque atomicamente exatamente uma vez com diagnóstico `v_affected_rows = 1`.
  - Transição `pending -> cancelled`: não altera estoque.
  - Estados terminais imutáveis: `delivered` e `cancelled`.
- **Frontend e Storefront (Checkout V1.1):**
  - Fluxo do carrinho expandido: `cart` → `details` → `review` → `success`.
  - Etapa de revisão do orçamento com UX de marketplace e validação estritamente local antes da rede.
  - Validação real de CPF (PF) e CNPJ (PJ) no frontend (`src/utils/brDocument.ts`), `orderService.ts` e na Edge Function (`submit-order-checkout`).
  - Estado `confirmedCustomerSnapshot` mantido em memória React para construção do link WhatsApp sem quebra de ciclo de vida após limpeza do formulário.
  - WhatsApp explícito com valores financeiros extraídos exclusivamente do recibo oficial retornado pelo servidor.
  - `public.orders` continha exatamente 0 pedidos no momento da validação pré-hardening e permaneceu com 0 pedidos no teste de deploy.

## 12. Arquitetura de Hospedagem Frontend (Cloudflare Workers Static Assets & ADR 005)
- **Pipeline de Deploy Frontend:**
  - GitHub `main` → Cloudflare Workers Builds → Vite build (`bun run build`) → Workers Static Assets (`dist/`).
  - Deploy command: `npx wrangler deploy`.
  - Cloudflare build variable: `BUN_VERSION=1.4.2`.
  - Configuração `wrangler.jsonc`:
    - `workers_dev: true` (endpoint de validação ativo).
    - `preview_urls: false` (sem preview URLs desnecessárias).
    - `assets.directory: "./dist"`.
- **Separação Estrita de Responsabilidades:**
  - Frontend: Single Page Application (SPA) em React 19 + Vite 6 servida estaticamente pelo Cloudflare Workers Static Assets.
  - Backend: Supabase Auth, PostgreSQL/RLS, Storage e Edge Functions (Deno).
  - O Cloudflare não possui Worker backend, bindings, banco de dados ou autoridade financeira.
- **Variáveis Públicas de Build:**
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`
  - `VITE_PUBLIC_TENANT_SLUG`
- **Segurança de Ativos e Secrets:**
  - Zero secrets server-side no bundle client-side.
  - `CHECKOUT_ENABLED` pertence exclusivamente à Edge Function Supabase e permanece desabilitado/fail-closed (`503`).
  - Documentações internas e binários expurgados do diretório `public/`.
- **Status de Validação em Runtime:**
  - Cloudflare runtime validation: **PASS** (`https://corsys-catalogo.corsys1.workers.dev`).
  - Storefront runtime & Supabase connection: **PASS**.
  - Checkout fail-closed 503: **PASS** (`public.orders` permaneceu em 0).
  - Domínio customizado: Ainda não configurado.

---

## 13. Arquitetura de Documentos de Pedido (PDF) e Handoff WhatsApp com CTA Único (Checkout V1.2 & ADR 006)
- **Fluxo do Carrinho Otimizado (Single Final CTA):**
  - O fluxo simplificado evoluiu de `cart -> details -> review -> success -> WhatsApp` para `cart -> details -> review -> WhatsApp`.
  - Na etapa `review`, existe um único CTA final: **"Enviar pedido pelo WhatsApp"**.
  - O clique revalida os dados, checa o número de WhatsApp cadastrado (fail-closed antes de chamar a rede), pré-abre uma janela neutra para contornar bloqueadores de pop-up, submete o pedido ao backend, gera o PDF oficial assinado e redireciona para a conversa com mensagem concisa.
- **Storage Privado de Pedidos (Migration 000012):**
  - Bucket `order-documents` (`public = false`, 5 MiB, MIME `application/pdf`).
  - Nenhuma permissão para `anon` ou uploads pelo browser.
  - Gravação e criação de signed URL válidas por 7 dias (604.800 s) exclusivas da Edge Function com `service_role`.
  - Path determinístico: `<tenant_uuid>/orders/<order_uuid>/pedido-<order_number>.pdf`.
- **Geração Server-Side de PDF (`_shared/orderPdf.ts`):**
  - Gera PDF profissional através de `pdf-lib` (`npm:pdf-lib@1.17.1`).
  - Autoridade de preços, itens e status estritamente derivada de `orderResult` e snapshots validados pelo banco de dados.
  - Paginação dinâmica com cabeçalho repetido e numeração de páginas em documentos com até 200 itens.
  - Resiliente: se a geração de PDF ou upload falhar, o pedido já criado não é abortado e o frontend cai para mensagem textual com dados do recibo (Graceful Fallback).
- **Proteção de PII:**
  - A mensagem curta no WhatsApp não expõe CPF/CNPJ completo, e-mail ou endereço completo; esses dados residem de forma segura dentro do PDF assinado no storage privado.

---

## 14. Hardening de Segurança V1 — Funções SECURITY DEFINER e Baseline de Autenticação (Migration 000013 & ADR 007)

- **Status Operacional de Deploy:**
  - **Migration 000013:** APLICADA / CONGELADA NO SUPABASE HOSTED (Database hardening: RUNTIME VERIFIED).
  - **Supabase Security Advisor:** Os 3 achados `authenticated_security_definer_function_executable` foram eliminados com sucesso. Residual: `auth_leaked_password_protection` permanece por restrição do plano Free.
  - **Edge Function `get-wholesale-catalog`:** CORREÇÃO DE BUNDLE PREPARADA / AGUARDANDO REDEPLOY E RUNTIME VALIDATION (não declarada como runtime pass até conclusão do deploy hospedado).
  - **Cloudflare Frontend:** Último build do commit de hardening concluído com sucesso (SUCCESS).
- **Correção dos Achados do Supabase Security Advisor (`authenticated_security_definer_function_executable`):**
  - **`public.get_my_wholesale_status(p_tenant_slug text)`:** Convertida para `SECURITY INVOKER` com `SET search_path = ''`. Resolução canônica de tenant realizada sobre `public.tenant_public_settings` (onde `authenticated` possui SELECT sob RLS, sem requerer vínculo em `tenant_users`). Acesso aos dados do comprador protegido pela barreira RLS `wholesale_customers_select_self` (`user_id = auth.uid()`). Execução concedida a `authenticated` e revogada de `PUBLIC` e `anon`.
  - **`public.get_wholesale_catalog(p_tenant_slug text)` (Legada):** Permissão de execução revogada para `PUBLIC`, `anon` e `authenticated`. A função física permanece no banco de dados exclusivamente para segurança de rollback, mas não pode ser chamada pelo browser.
  - **RPC Interna `public.get_wholesale_catalog_internal(p_tenant_slug text, p_user_id uuid)`:** Criada na migration 000013 como `SECURITY DEFINER` com `SET search_path = ''` e permissão de execução concedida **EXCLUSIVAMENTE a `service_role`** (`REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role;`). Valida parâmetros, status ativo do tenant, `allow_b2b_mode = true` e credenciamento `approved`. Retorna estritamente 4 colunas (`product_id`, `sku`, `wholesale_price`, `wholesale_min_quantity`).
  - **Blindagem de `public.products` (Zero Ampliação de RLS):** A RLS da tabela `products` NÃO foi ampliada para compradores B2B. A projeção de preços atacadistas é sanitizada via gateway backend, impedindo qualquer exposição de `cost_price` ou dados internos da loja.
  - **Gateway Edge Function Autenticado (`get-wholesale-catalog`):** Endpoint autenticado configurado com `verify_jwt = true` em `supabase/config.toml`. Exige token Bearer, extrai o usuário validado via `auth.getUser(token)`, rejeita payloads com injeção de identidade ou dados financeiros (`userId`, `costPrice`, etc.), limita o body a 4 KB e consome a RPC interna com credenciais de `service_role`.
  - **Frontend (`src/services/wholesaleService.ts`):** `fetchWholesaleCatalog` invoca `get-wholesale-catalog` via `supabase.functions.invoke()`, sem nenhuma chamada RPC direta pelo browser.
  - **`public.manage_order_status(p_order_id uuid, p_new_status text)`:** Execução revogada de todos os papéis de API (`PUBLIC`, `anon`, `authenticated`, `service_role`). Sem concessão para `service_role` nesta etapa por não existir gateway server-side ativo (princípio do menor privilégio estrito).
- **Baseline de Autenticação em Código (`supabase/config.toml`):**
  - `minimum_password_length = 12`
  - `password_requirements = "lower_upper_letters_digits_symbols"`
  - `secure_password_change = true`
  - `enable_signup = true`
  - `enable_anonymous_sign_ins = false`
  - `auth.email.enable_signup = true`
  - `auth.email.enable_confirmations = false`
  - `[functions.get-wholesale-catalog] verify_jwt = true`
  - *Governança de Ambiente:* Estas configurações de Auth foram estabelecidas no arquivo fonte `supabase/config.toml` do workspace como baseline declarativo de governança. Não declarar que a instância Supabase Hosted já recebeu essas configurações, uma vez que a aplicação no hosted depende de sincronização via CLI / painel do projeto. A proteção contra vazamento de senhas comprometidas (*leaked-password protection*) permanece como risco residual aceito pela restrição de tiers do plano Free do Supabase.

## 7. Engenharia / CI — Adoção ECC (2026-10-02)
- Package manager canônico: Bun 1.4.2 para os checks versionados desta adoção.
- Gate local: `bun run check`.
- Gate remoto: `.github/workflows/quality.yml` em PR/push para `main` e execução manual.
- Permissões da Action: `contents: read`; nenhum secret é fornecido ao job de qualidade.
- A CI valida o código, mas não executa deploy. Cloudflare Workers Builds permanece uma esteira separada.
- Runtime ECC completo, hooks globais, MCPs e auto-update não fazem parte da arquitetura do produto.
