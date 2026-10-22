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
- **Checkout:** **OPERACIONAL NO SUPABASE HOSTED** (pedidos reais persistidos em `public.orders`)
- **Frontend:** **INTEGRAÇÃO REAL OPERACIONAL**
  - `CartDrawer` integrado ao `orderService.submitOrderCheckout`.
  - Zero autoridade financeira no cliente (subtotal, total, descontos e fretes recalculados pelo backend).
  - Idempotência baseada em UUID v4 e digest SHA-256 da intenção do pedido; sessionStorage livre de PII.
  - Fail-closed: erros de rede e indisponibilidade tratados inline com preservação do carrinho, dados do formulário e chave de idempotência.
  - Desacoplamento total de WhatsApp da criação de pedidos; PIX hardcoded e confetti expurgados.
- **B2B:**
  - Tenant público canônico reconciliado com `PUBLIC_TENANT_SLUG`.
  - `purchaseMode` (WholesaleAccessContext) autoritativo, com `shoppingMode` (AppContext) temporariamente sincronizado.
- **Transição de Superfície Administrativa (Admin Orders V1):**
  - `TenantDashboard` e `OrderManager` desacoplados de mocks e integrados a `public.orders` via Supabase RLS em modo read-only.
  - Mocks legados em `AppContext` isolados e não-autoritativos para a gestão administrativa.
- **Decisão Arquitetural (ADR 004):** Duas camadas complementares (Edge Function pública como gateway + RPC PostgreSQL interna transacional).
- **Contrato de Ingestão de Pedidos (Zero Autoridade Financeira no Cliente):**
  - O storefront submete requisição à Edge Function `submit-order-checkout` (`verify_jwt = false`).
  - O payload contém apenas `productId`, `quantity`, `selectedVariant`, `customer`, `shippingAddress`, `deliveryMethod`, `paymentMethod` e `idempotencyKey` UUID v4 estrito.
  - Valores financeiros (`unitPrice`, `totalPrice`, `subtotal`, `discount`, `shipping_fee`, `total`) e `buyerUserId` são estritamente rejeitados do contrato client-side (HTTP 400).
- **Edge Function `submit-order-checkout` (Hospedada & Ativa):**
  - Modernizada com `Deno.serve` e `npm:@supabase/supabase-js@2`.
  - Autenticação via `SUPABASE_SECRET_KEYS` (extração segura da chave default; `SUPABASE_SERVICE_ROLE_KEY` legada removida).
  - **Feature Gate Fail-Closed:** Validação fail-closed via Edge Function (retorno seguro HTTP 503 se inativo; ativo e operacional no ambiente hospedado).
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
  - `public.orders` possui atualmente 3 pedidos reais persistidos com sucesso pelo Checkout V1 (ex: `PED-20260930-000001`, `PED-20260930-000002`, `PED-20261001-000003`).

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
  - Segregação estrita entre frontend estático e credenciais administrativas no Supabase.
  - Documentações internas e binários expurgados do diretório `public/`.
- **Status de Validação em Runtime:**
  - Cloudflare runtime validation: **PASS** (`https://corsys-catalogo.corsys1.workers.dev`).
  - Storefront runtime & Supabase connection: **PASS**.
  - Checkout e persistência transacional: **PASS** (3 pedidos reais em `public.orders`).
  - Domínio customizado: Ainda não configurado.

---

## 13. Arquitetura de Documentos de Pedido (PDF) e Handoff WhatsApp Textual (Checkout V1.2 & ADR 006 / ADR 010)
- **Fluxo do Carrinho Otimizado (Single Final CTA):**
  - O fluxo simplificado evoluiu de `cart -> details -> review -> success -> WhatsApp` para `cart -> details -> review -> WhatsApp`.
  - Na etapa `review`, existe um único CTA final: **"Enviar pedido pelo WhatsApp"**.
  - O clique revalida os dados, checa o número de WhatsApp cadastrado (fail-closed antes de chamar a rede), pré-abre uma janela neutra para contornar bloqueadores de pop-up, submete o pedido ao backend, gera o PDF oficial assinado no Storage privado para auditoria e redireciona para a conversa com mensagem textual completa baseada nos dados autoritativos do servidor.
- **Handoff WhatsApp 100% Textual (ADR 010):**
  - O handoff consome exclusivamente `CheckoutOrderReceipt` retornado e validado pelo backend (`orderNumber`, `items`, `subtotal`, `discount`, `shippingFee`, `total`, `paymentMethod`, `deliveryMethod`).
  - Helper puro `buildOrderWhatsAppMessage` (`src/utils/orderWhatsAppMessage.ts`) monta a mensagem com itens, SKU, quantidades, variantes, unidades e totais.
  - Zero link de PDF na mensagem do WhatsApp.
  - Ausência de PII sensível (CPF, CNPJ, endereços completos, e-mail) no corpo da mensagem.
- **Storage Privado de Pedidos (Migration 000012):**
  - Bucket `order-documents` (`public = false`, 5 MiB, MIME `application/pdf`).
  - Nenhuma permissão para `anon` ou uploads pelo browser.
  - Gravação e criação de signed URL válidas por 7 dias (604.800 s) exclusivas da Edge Function com `service_role`.
  - Path determinístico: `<tenant_uuid>/orders/<order_uuid>/pedido-<order_number>.pdf`.
- **Geração Server-Side de PDF (`_shared/orderPdf.ts`):**
  - Gera PDF profissional através de `pdf-lib` (`npm:pdf-lib@1.17.1`).
  - Autoridade de preços, itens e status estritamente derivada de `orderResult` e snapshots validados pelo banco de dados.
  - Paginação dinâmica com cabeçalho repetido e numeração de páginas em documentos com até 200 itens.
  - PDF server-side é preservado para auditoria e impressão/emissão administrativa.

---

## 14. Hardening de Segurança V1 — Funções SECURITY DEFINER e Baseline de Autenticação (Migration 000013 & ADR 007)

- **Status Operacional de Deploy:**
  - **Migration 000013:** APLICADA / CONGELADA NO SUPABASE HOSTED (Database hardening: RUNTIME VERIFIED).
  - **Supabase Security Advisor:** Os 3 achados `authenticated_security_definer_function_executable` foram eliminados com sucesso. Residual: `auth_leaked_password_protection` permanece por restrição do plano Free.
  - **Edge Function `get-wholesale-catalog`:** ACTIVE (versão 1, `verify_jwt = true`). Deploy concluído no Supabase Hosted. Fluxo positivo B2B aprovado permanece como ainda não avaliado (NOT EVALUATED).
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

---

## 15. Arquitetura de Gestão de Pedidos Administrativos (Admin Orders V2 — Status Server-Side, Estoque, Impressão e PDF)
- **Status:** **PUBLICADO / RUNTIME PASS / CLOSED**.
- **Fonte de Dados Autoritativa:** O painel "Pedidos & Vendas" consome exclusivamente a tabela `public.orders` via Supabase Client autenticado, sob proteção rigorosa de RLS (`orders_select_tenant_admin` / `orders_select_stock_manager` / `orders_select_sales_rep` / `private.is_platform_admin()`).
- **Desacoplamento Completo de Mocks:**
  - O painel administrativo não consome `currentTenantOrders` do `AppContext`.
  - Mocks de demonstração (`INITIAL_ORDERS`, `PED-2025-0841`, `PED-2025-0842`) e `localStorage` estão estritamente segregados fora da superfície do `TenantDashboard` e do `OrderManager`.
- **Fluxo Único de Dados:**
  - `TenantDashboard` resolve o UUID real do tenant via `resolveTargetTenantId()`.
  - Executa `fetchAdminOrders(tenantId)` em `src/services/adminOrderService.ts`.
  - O `adminOrders` é o único *source of truth* da visualização.
  - KPIs de Faturamento Total (`adminOrders.reduce`), Contagem Total de Pedidos (`adminOrders.length`) e Novos Pedidos Pendentes (`adminOrders.filter(pending)`) derivam 100% dos registros do banco.
  - Injeta `orders`, `loading`, `error` e `onReload` no `OrderManager` como props puras.
- **Contrato Real do Checkout V1 & Adapter Fail-Closed:**
  - Em `src/types.ts` e `src/services/adminOrderService.ts`:
    - `customer.name`, `customer.phone`, `customer.type` são obrigatórios não-vazios; `customer.email`, `customer.document`, `customer.companyName` são opcionais (podem estar ausentes, null ou vazios sem falha de parsing).
    - `shippingAddress.street` é obrigatória não-vazia; `number`, `complement`, `neighborhood`, `city`, `state`, `zipCode` são opcionais (podem estar ausentes, null ou vazios sem mascaramento ou invenção de dados como `'S/N'`).
    - Validação Fail-Closed rigorosa contra objetos inválidos, strings obrigatórias ausentes, UUIDs incorretos, status ou pagamentos fora da allowlist e valores numéricos negativos ou NaN.
- **Ciclo de Vida Server-Side & Controle de Estoque (Admin Orders V2):**
  - **Migration 000014:** `supabase/migrations/20261005170000_000014_admin_order_management.sql` (Forward-only; 000001 a 000013 congeladas).
  - Cria `public.manage_order_status_internal(p_order_id UUID, p_new_status TEXT, p_actor_user_id UUID)` com `SECURITY DEFINER`, `search_path = ''` e execução restrita exclusivamente a `service_role`.
  - Reafirma bloqueio defensivo de `public.manage_order_status(UUID, TEXT)` sem permissão para nenhum papel.
  - Trava pessimista `FOR UPDATE` na linha do pedido e autorização server-side do operador (`platform_admin` ou `tenant_admin`/`stock_manager` do mesmo tenant; `sales_rep` negado).
  - Locks pessimistas de produtos ordenados por UUID evitam deadlock.
  - Transição `pending -> approved` debita estoque atomicamente; transições `approved/preparing -> cancelled` restauram o estoque exatamente uma vez.
  - Estados `delivered` e `cancelled` são terminais irreversíveis.
- **Edge Functions Gateway Segregadas:**
  - **`manage-order-status` (Responsabilidade Única de Ciclo de Vida):**
    - Declarada com `verify_jwt = true` em `supabase/config.toml`.
    - Body exato: `{ "orderId": string, "newStatus": string }` (máx 4 KB). Rejeita ações extras ou identificadores de usuário no corpo.
    - Deriva `actorUserId` de forma autenticada via `auth.getUser()`.
    - Muta status via RPC interna `manage_order_status_internal` com `service_role` e trata códigos de erro PostgreSQL de forma mapeada e segura.
    - Retorno mínimo sem PII.
  - **`generate-admin-order-pdf` (Geração Dedicada de Documento):**
    - Declarada com `verify_jwt = true` em `supabase/config.toml`.
    - Body exato: `{ "orderId": string }` (máx 4 KB).
    - **Autorização RLS Contextual:** O pedido é consultado via client no contexto do JWT do operador. A RLS do PostgreSQL decide a autorização de leitura — permitindo que operadores autorizados (incluindo `sales_rep`) gerem o PDF.
    - **Service Role estritamente pós-leitura autorizada:** Gera os bytes do PDF com `generateOrderPdf` (`_shared/orderPdf.ts`), faz upload com upsert no bucket privado `order-documents` (`<tenant_id>/orders/<order_id>/pedido-<order_number>.pdf`) e emite Signed URL com validade de **exatamente 600 segundos (10 minutos)**.
    - Zero log de Signed URLs.
- **Impressão Isolada (Portal Fora do DOM da Aplicação):**
  - Componente dedicado `src/components/tenantadmin/OrderPrintDocument.tsx` renderizado via `createPortal(<div id="order-print-root"><OrderPrintDocument ... /></div>, document.body)` em `src/components/tenantadmin/OrderManager.tsx`.
  - `@media print` no `src/index.css` oculta a árvore padrão da aplicação (`body > #root { display: none !important }`) e exibe exclusivamente `#order-print-root` com `position: static !important` e `@page { size: A4 portrait; margin: 10mm; }`.
  - Quebras de página controladas via `break-inside: avoid !important` para cada bloco/item.
- **Frescor de Dados & Auto-Refresh (Estoque e Pedidos):**
  - Callback `handleOrderStatusChanged` em `TenantDashboard.tsx` recarrega atomicamente `loadAdminOrders()` e `loadAdminProducts()`, passado para `OrderManager`.
  - Auto-refresh de janela/aba com listeners em `window.addEventListener('focus')` e `document.addEventListener('visibilitychange')`.
  - Proteção anti-duplicação de refresh via throttle de 800ms (`lastRefreshAtRef`) e cleanup completo de listeners.
  - Zero polling (`setInterval`), zero `supabase.channel` e zero `postgres_changes`.
- **Ausência de Hard Delete:**
  - Permanece expressamente proibida a exclusão de pedidos (`.delete()`); registros transacionais permanecem auditáveis.
- **Gate de Qualidade Unificado:**
  - 100% de aprovação nas 8 suítes de regressão (793 testes) via `bun run check`.

---

## 17. Meus Pedidos / Customer Order Tracking V1 (ADR 011 — 2026-10-08)
- **Status da Feature:** **MIGRATIONS 000015–000016 APLICADAS / FROZEN NO HOSTED; TRACKING EDGES ACTIVE V2; MIGRATION 000017 CHECKOUT DELIVERY COMPAT RELEASE CANDIDATE / PENDING POST-MERGE**.
- **Objetivo:** Acompanhamento seguro de pedidos pelo cliente sem expor consultas por CPF, e-mail, telefone ou order_number sequencial.
- **Varejo Anônimo (Secure Retail Token):**
  - Token aleatório de 256 bits (64 hex lowercase) gerado no checkout server-side.
  - Armazenamento no banco exclusivamente do hash SHA-256 em `public.orders.tracking_token_hash`.
  - Token raw devolvido no recibo e mantido no navegador do cliente em `localStorage` sob chave isolada por tenant (`corsys_order_tracking_v1:<slug>`).
  - Registro local armazena exclusivamente `{ orderNumber, trackingToken, createdAt }` (sem `tenantSlug` interno e zero PII).
  - Consulta via Edge Function `track-order-by-token` delegando para a RPC interna `track_order_by_token_internal` (service_role only).
  - Consulta automática apenas por pedidos locais salvos. Zero busca manual por token digitado.
- **Atacado B2B Autenticado:**
  - `buyer_user_id` associado a `auth.users(id)` persistido em `public.orders` exclusivamente para modalidade wholesale.
  - Consulta paginada via Edge Function `list-my-customer-orders` validando JWT e delegando para a RPC `list_my_customer_orders_internal` (service_role only), restrita a `shopping_mode = 'wholesale'`.
- **Menor Privilégio e Segurança (Migration 000016):**
  - RLS de `public.orders` permanece restrita a gestores e corretores do tenant (zero SELECT para anon).
  - RPCs internas possuem `SECURITY DEFINER`, `search_path = ''` e execução restrita exclusivamente a `service_role`:
    - `set_order_tracking_token_internal(p_order_id UUID, p_idempotency_key UUID, p_tracking_token_hash TEXT)`: vinculação segura do hash no checkout com lock pessimista `FOR UPDATE` e checagem de `shopping_mode = 'retail'`. Zero DML direto de tabela no Edge.
    - `track_order_by_token_internal(p_tenant_slug TEXT, p_tracking_token_hash TEXT)`: consulta isolada por tenant e hash SHA-256 sem exigir `t.status = 'active'`, com projeção limpa sem PII (sem `id`, sem `customerName`, sem `shippingAddress`).
    - `list_my_customer_orders_internal(p_tenant_slug TEXT, p_buyer_user_id UUID, p_limit INT, p_offset INT)`: listagem paginada B2B autorizada server-side com mesma projeção sanitizada.
  - Declaração explícita de `[functions.track-order-by-token]` (`verify_jwt = false`) e `[functions.list-my-customer-orders]` (`verify_jwt = true`) em `supabase/config.toml`.
- **Checkout Delivery Methods Compatibility (Migration 000017):**
  - Hotfix forward-only em `create_order_checkout_internal` para aceitar o formato persistido atual `delivery_methods = ["retirada", "entrega", ...]` e também o formato estruturado futuro `[{ "id": "retirada", "active": true }]`.
  - Corrige rejeição indevida com SQLSTATE `22000` antes da persistência do pedido; nenhuma mudança em pricing, estoque, idempotência, tracking token ou WhatsApp.
- **Canonical Tenant Slug no Tracking (hotfix runtime 2026-10-08):**
  - `CustomerOrderTrackingView` usa `PUBLIC_TENANT_SLUG`, a mesma identidade pública canônica usada pelo Storefront/Checkout, para `listMyCustomerOrders`, storage varejo e `trackOrderByToken`.
  - O slug legado de `currentTenant` permanece apenas como metadado visual do AppContext e não participa de chamadas de tracking.
- **Frontend & UI:**
  - Componente `CustomerOrderTrackingView.tsx` sob `viewMode = 'my_orders'`.
  - Botão "Meus Pedidos" acessível no cabeçalho e menu de usuário.
  - Interface livre de PII ou endereço de entrega (exibe exclusivamente método de entrega e forma de pagamento).
  - Ao deslogar (logout), estado B2B é descarregado e o usuário é redirecionado para a vitrine pública se estiver em `my_orders`.



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
