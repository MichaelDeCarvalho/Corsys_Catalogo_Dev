# SESSION HANDOFF — ECC ADOPTION

## Data
2026-10-02

## Objetivo
Implantar de forma seletiva os recursos pertinentes do ECC no Corsys.Catálogo sem alterar migrations congeladas, backend Supabase ou deploy de produção.

## Concluído
- Branch dedicada criada para a adoção.
- `AGENTS.md` criado com fontes canônicas, regras de segurança e comandos.
- Registro `docs/engineering/ecc-adoption.md` criado.
- Checklist `docs/RELEASE_CHECKLIST.md` criado.
- ADR 008 criado.
- `package.json` preparado com `test:regression` e `check`.
- GitHub Actions de qualidade preparado com least privilege e zero secrets.

## Arquivos alterados
- `AGENTS.md`
- `package.json`
- `.github/workflows/quality.yml`
- `docs/engineering/ecc-adoption.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/adr/ADR_008_ECC_ENGINEERING_GOVERNANCE.md`
- `docs/PROJECT_CONTEXT.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/README.md`
- `docs/SESSION_HANDOFF.md`

## Migrations
Nenhuma migration alterada ou criada.

## Variáveis de ambiente
Nenhuma variável criada ou alterada.

## Decisões
- ECC adotado seletivamente; runtime completo não copiado.
- CI de qualidade separada do deploy Cloudflare.
- Nenhum hook global, MCP, auto-update ou serviço permanente instalado.

## Testes executados
GitHub Actions Quality:
- Run #1: **FAIL** — os cenários S11/S12 foram interceptados pela guarda de Supabase não configurado (503) antes do comportamento pretendido.
- Correção: ambiente CI recebeu apenas valores públicos sintéticos `VITE_SUPABASE_URL=https://ci-test.invalid` e `VITE_SUPABASE_PUBLISHABLE_KEY=ci-public-placeholder`; nenhum secret e nenhuma conexão real.
- Run #2: **PASS** — `bun run check` concluído.
- Evidências do run #2: suíte principal **212/212**, performance **34/34**, build Vite concluído; a sequência também confirmou lint e as demais suítes porque o comando consolidado terminou com sucesso.

## Findings / riscos
- CI de qualidade está **VERIFICADA** para esta revisão.
- `main` continua potencialmente ligada ao deploy Cloudflare, portanto merge exige revisão.
- Pendência anterior do projeto permanece: Edge Function `get-wholesale-catalog` tinha correção de bundle preparada aguardando redeploy/runtime validation conforme contexto do projeto.

## Pendências
- Revisar o PR antes do merge.
- Não ativar módulos ECC adicionais sem necessidade concreta.
- Manter a pendência anterior de redeploy/runtime validation da Edge Function `get-wholesale-catalog` separada desta adoção.

## Próxima ação
Revisar o PR de adoção ECC. Merge em `main` somente após revisão humana, pois pode acionar deploy Cloudflare.

## Estado do deploy
Não deployado por esta adoção.

## Referências
- ADR: `docs/adr/ADR_008_ECC_ENGINEERING_GOVERNANCE.md`
- Adoção: `docs/engineering/ecc-adoption.md`

---

# Histórico preservado — handoff anterior

> Snapshot preservado do handoff existente em `main` antes da adoção ECC. Mantido para não perder evidências operacionais e decisões já registradas.

## Status Atual
**PRODUCT MEDIA STORAGE V1 — RUNTIME PASS (SUPABASE HOSTED + WORKSPACE VALIDADO)**  
*(Migration 000009 aplicada e congelada. Fluxo completo de upload, persistência, reordenação de principal e remoção física validado em runtime no SKU BR022.)*

---

## 1. O Que Foi Implementado e Validado no Workspace
- **Bucket `product-media` em `supabase/config.toml`:**
  - Configurado: `public = true`, `file_size_limit = "1MiB"`, `allowed_mime_types = ["image/png", "image/jpeg", "image/webp"]`.
  - SVG expressamente bloqueado (mitigação de XSS); GIF animado desabilitado nesta etapa.
- **Migration 000008 (`supabase/migrations/20260916_000008_product_media_storage.sql`):**
  - *Status:* **APLICADA NO SUPABASE HOSTED / CONGELADA** (SHA-256: `991566a46952cf2a7873f6e86393ef7d153e0ff780e79074ce997b775cb1883f`).
  - No banco real, foi identificado que `storage.foldername(name)` dentro de `EXISTS (SELECT 1 FROM public.products p ...)` sofreu shadowing para `p.name` (coluna da tabela `products`).
- **Migration 000009 (`supabase/migrations/20260917_000009_fix_product_media_policy_scope.sql`):**
  - *Status:* **APLICADA NO SUPABASE HOSTED / CONGELADA** (SHA-256: `0a160dba2a7da7b6fd5fab1516afe9bd0c579820c127608bac98721696244051`).
  - Dropa as 3 policies de 000008 e as recria com qualificação explícita do outer row: `storage.foldername(storage.objects.name)`.
  - Preserva integralmente as permissões e lógica de menor privilégio da 000008, sem qualquer ampliação de privilégios.
  - *Runtime de Product Media:* **VALIDADO COM SUCESSO (PASS)** em ambiente real.
  - Policies em `storage.objects` com Menor Privilégio:
    - `product_media_select_authenticated`: SELECT autenticado restrito ao namespace do próprio tenant sob `/products/<product_id>` ou platform_admin, com produto existente e pertencente ao tenant.
    - `product_media_insert_tenant_admin`: INSERT restrito a tenant_admin no diretório `<tenant_uuid>/products/<product_uuid>` ou platform_admin, com produto existente e pertencente ao tenant.
    - `product_media_delete_tenant_admin`: DELETE restrito a tenant_admin no diretório `<tenant_uuid>/products/<product_uuid>` ou platform_admin, com produto existente e pertencente ao tenant.
    - Nenhuma policy de UPDATE (uploads com versionamento determinístico e `upsert: false`).
    - Nenhuma policy de SELECT público amplo em `storage.objects` (acesso público via CDN do bucket).
    - Nenhum DML direto em `storage.buckets` e sem `ALTER TABLE storage.objects`.
- **Serviço de Mídias de Produto (`src/services/productMediaStorageService.ts`):**
  - Inspeção binária de magic bytes (PNG, JPEG, WebP).
  - Validação rigorosa de UUID v4 para `tenant_id` e `product_id` (Fail-Closed).
  - Extração segura de paths (`extractOwnedProductMediaPath`) com rejeição de path traversal (`..`, `\`), schemas perigosos (`blob:`, `data:`, `javascript:`) e isolamento cross-tenant / cross-product.
  - Funções de compensação (`rollbackProductMediaUploads`, `removeProductMediaImage`).
- **Integração no `AdminCatalogService` (`src/services/adminCatalogService.ts`):**
  - `AdminProductUpdatePayload` com campo `images?: string[]`.
  - Sanitização estrita HTTPS-Only em `updateAdminProduct`: aceita exclusivamente `https://` (URLs novas ou legadas), rejeita schemas não-HTTPS (`http://`, `blob:`, `data:`, `javascript:`, `file:`, etc.), sem duplicatas mantendo ordem e sem strings vazias.
- **Interface Administrativa (`src/components/tenantadmin/ProductEditModal.tsx`):**
  - Seção "Fotos do Produto" com upload múltiplo, preview local temporário (`URL.createObjectURL` com revogação via `URL.revokeObjectURL`).
  - Zero uploads remotos ao selecionar arquivos ou cancelar modal. Upload somente ao clicar em "Salvar Alterações".
  - Trava de concorrência (`saving`), reordenação determinística e destaque na posição 0.
  - Fluxo compensatório client-side com rollback automático de uploads em caso de falha no banco.
- **Atualização de Placeholders (`src/utils/productImages.ts` e `ProductManager.tsx`):**
  - Mensagem do SVG placeholder atualizada de "Aguardando ativação Storage V2" para "Sem foto cadastrada".
  - Badge em `ProductManager.tsx` atualizado para "Importação em massa pendente".
- **ADR 003 (`docs/adr/ADR_003_PRODUCT_MEDIA_STORAGE.md`):** Criado com especificações completas de arquitetura, isolamento e segurança.
- **Hotfix Consolidado de Performance do Catálogo (Admin & Serviços):**
  - `ProductManager.tsx`: Paginação client-side simples com `ITEMS_PER_PAGE = 40`.
  - Tabela principal renderiza estritamente `paginatedProducts.map` (redução drástica do DOM de ~520 nós de produto para 40 simultâneos).
  - Memoização com `useMemo` em `categories`, `categoryCounts` (contagem em passagem única O(N)), `filteredProducts` e `paginatedProducts`.
  - Reset automático de `currentPage` para 1 ao modificar filtros ou busca.
  - Seleção em massa na página visível opera sobre `paginatedProducts`, preservando IDs de produtos selecionados em outras páginas.
  - Atributos `loading="lazy"` e `decoding="async"` nos thumbnails da listagem administrativa.
  - `variantCatalogService.ts`: `buildCatalogDisplayItems` purificada, removendo o loop de `console.warn` por SKU não mapeado/ausente durante o ciclo de render/memoização.
  - `ProductEditModal.tsx`: Trava de compensação idempotente (`performRollbackOnce`) garantindo que `rollbackProductMediaUploads` execute no máximo uma vez em caso de falha de persistência no banco.
- **Validação Runtime do Hotfix de Performance:**
  - Performance Profile pós-hotfix capturado no AI Studio Preview com `No throttling`.
  - Entrada no Painel Loja: **~99 ms** (baseline anterior: ~169 ms).
  - Abrir `Editar Produto`: **~269 ms** (baseline anterior: ~2,37 s; melhora aproximada de 89%).
  - Fechar `Editar Produto`: **~329 ms** (baseline anterior: ~5,55 s; melhora aproximada de 94%).
  - Pico de DOM observado caiu de ~64.304 para ~20.154 nós (redução aproximada de 69%).
  - Nenhuma ocorrência de mensagens `[Variações]` observada no trace pós-hotfix.
  - Heap JavaScript observado entre ~19 MB e ~37,7 MB durante o teste; sem evidência de pressão equivalente ao baseline.
  - Extensões Kaspersky ainda estavam presentes no Preview, porém não explicaram o custo residual das interações do modal.
- **Hotfix Tenant UUID / Product Media:**
  - `TenantDashboard` passa explicitamente o tenant UUID administrativo real ao `ProductManager`.
  - `ProductManager` deriva `effectiveTenantId` apenas de UUIDs válidos.
  - Removido fallback de escrita para `currentTenant.id` / IDs legados.
  - Edição individual bloqueia fail-closed se `product.tenantId` não corresponder ao `effectiveTenantId`.
  - Edição em massa valida que todos os `selectedProductIds` existem e pertencem ao mesmo `effectiveTenantId` antes de abrir o modal.
  - `productMediaStorageService` e sua validação UUID permaneceram inalterados.
  - O erro runtime anterior confirmou que o fail-closed bloqueou corretamente um tenant ID legado antes do upload.
- **Validação Funcional Runtime de Product Media (SKU BR022) — RUNTIME PASS:**
  - **Upload real no bucket `product-media`:** PASS.
  - **Path canônico isolado `<tenant_uuid>/products/<product_uuid>/...`:** PASS.
  - **Persistência em `public.products.images[]`:** PASS.
  - **Reload administrativo:** Imagens persistem integralmente: PASS.
  - **Exposição via `catalog_products`:** PASS.
  - **Exibição na Storefront / Vitrine:** PASS.
  - **Adição de segunda imagem:** PASS.
  - **Troca de imagem principal (promoção para `images[0]`):** PASS.
  - **Nova imagem principal refletida na vitrine:** PASS.
  - **Remoção lógica da imagem antiga:** `public.products.images[]` atualizado: PASS.
  - **Remoção física no Storage:** Objeto físico deletado do bucket `product-media`: PASS.
  - **Objeto principal preservado no Storage:** PASS.
  - **Estado final do BR022 no Supabase:** Exatamente 1 imagem em `images[]` e exatamente 1 objeto no namespace do produto (zero imagens órfãs): PASS.
  - *(Nota: Rollback forçado por erro de persistência no banco não foi testado em runtime no teste produtivo; a cobertura de consistência compensatória permanece assegurada pelas suítes de testes automatizados e unitários).*
- **Hotfix Imagem de Família / Variante na Storefront:**
  - Gap de apresentação identificado durante validação runtime: famílias selecionavam cegamente o primeiro item ordenado (que podia não ter imagem).
  - Corrigido em `variantCatalogService.ts`: a família agora seleciona como representativa a primeira variante real da lista que possua imagem cadastrada (sem inventar fotos e sem mutar produtos).
  - Em `VariantGroupCard.tsx`: quando houver busca por SKU (`highlightedSkus`), o card prioriza visualmente a foto do SKU pesquisado e passa `highlightedInitialSku` ao abrir o modal de detalhes (`ProductDetailModal`).
  - Sem `highlightedSku`, mantém comportamento normal da família sem seleção artificial de variante.
- **Importador de Imagens em Massa por SKU (V1 Fail-Closed & Persistência Atômica):**
  - Product Media V1 continua **RUNTIME PASS**.
  - Lote piloto de 17 imagens (AP001, EP003, SG002, CH001, JG002, VE001, LA001, GZ001, FT004, FT002, DS018, FL004, SR021, SR006, SR007, SR008, SR009) foi validado visualmente pelo usuário (arquivos WebP < 1 MiB).
  - Bulk image importer implementado no workspace (`src/services/bulkImageImportService.ts` e `src/components/tenantadmin/ProductBulkImageImportModal.tsx`).
  - Associação estrita por SKU com leitura e validação de `manifest.json`.
  - Dry-run obrigatório de segurança em memória (zero uploads, zero updates, zero deletes).
  - Revalidação de tenant ownership e preservação de produtos que já possuem fotos (`SKIPPED_EXISTING_IMAGE`).
  - **Correção Pré-Sync: Persistência Atômica Condicional (Prevenção TOCTOU):**
    - Criada função `updateAdminProductImagesIfEmpty` em `src/services/adminCatalogService.ts`.
    - Executa UPDATE condicional estrito via PostgREST: `tenant_id = tenantId`, `id = productId`, `deleted_at IS NULL` e `images = '{}'` (array vazio).
    - Elimina completamente a janela de corrida onde outra sessão pudesse adicionar imagem entre o dry-run e a persistência remota.
    - Se zero linhas forem atualizadas, o upload recém-enviado é imediatamente compensado no Storage e o item é classificado como `SKIPPED_CONCURRENT_IMAGE`, preservando intacta a foto preexistente.
    - Se ocorrer erro de persistência no banco, o upload daquele item é compensado cirurgicamente e classificado como `FAILED`.
  - **Execução e Resultados do Lote Piloto de 17 SKUs:**
    - Lote executado com arquivos WebP (< 1 MiB) e `manifest.json`.
    - **17 SUCCESS**
    - **0 FAILED**
    - **0 SKIPPED**
    - **17 URLs** persistidas em `public.products.images[]`
    - **17 objetos físicos** correspondentes criados no bucket `product-media`
    - **0 imagens órfãs** observadas no teste realizado.
  - O importador em massa utiliza persistência condicional atômica via `updateAdminProductImagesIfEmpty` (`images = '{}'`, `deleted_at IS NULL`, `tenant_id` e `id`).
  - Em condição concorrente (imagem adicionada por outra sessão após o dry-run), a gravação condicional atômica resulta em `SKIPPED_CONCURRENT_IMAGE` com rollback imediato do upload recém-criado e preservação da imagem existente.
  - Novas fotos continuam podendo ser adicionadas individualmente pelo painel administrativo através do `ProductEditModal`.
  - *(Nota de governança: o número total de produtos com foto no catálogo reflete estritamente as evidências dos testes executados — SKU BR022 individual + 17 SKUs do lote piloto —, sem assunção de risco zero em cenários não cobertos).*
- **Suítes de Testes Automatizados:**
  - `scripts/test-product-media-storage-points.ts`: **153/153 PASSOU (0 FALHOU)** (inclui testes de parsing de manifest, dry-run, upload sequencial, compensação por item, relatório, filtros atômicos de `updateAdminProductImagesIfEmpty`, mitigação TOCTOU e `SKIPPED_CONCURRENT_IMAGE`).
  - `scripts/test-catalog-performance-points.ts`: **34/34 PASSOU (0 FALHOU)**.
  - `scripts/test-branding-storage-points.ts`: **35/35 PASSOU (0 FALHOU - Regressão Zero)**.
  - `npm run lint` (`tsc --noEmit`): **PASSOU**.
  - `npm run build` (`vite build`): **PASSOU**.

---

## 2. Histórico e Governança de Migrations
- `supabase/migrations/20260902_000001_initial_schema.sql`: **APLICADA / CONGELADA**
- `supabase/migrations/20260903_000002_import_official_catalog.sql`: **APLICADA / CONGELADA**
- `supabase/migrations/20260904_000003_public_catalog_settings.sql`: **APLICADA / CONGELADA**
- `supabase/migrations/20260905_000004_wholesale_item_rules.sql`: **APLICADA / CONGELADA**
- `supabase/migrations/20260907_000005_b2b_wholesale_access.sql`: **APLICADA / CONGELADA**
- `supabase/migrations/20260909_000006_branding_storage.sql`: **APLICADA / CONGELADA**
- `supabase/migrations/20260910_000007_reconcile_b2b_catalog_security.sql`: **APLICADA / CONGELADA**
- `supabase/migrations/20260916_000008_product_media_storage.sql`: **APLICADA NO SUPABASE HOSTED / CONGELADA** (SHA-256: `991566a46952cf2a7873f6e86393ef7d153e0ff780e79074ce997b775cb1883f`)
- `supabase/migrations/20260917_000009_fix_product_media_policy_scope.sql`: **APLICADA NO SUPABASE HOSTED / CONGELADA** (SHA-256: `0a160dba2a7da7b6fd5fab1516afe9bd0c579820c127608bac98721696244051`)
- `supabase/migrations/20260928_000010_orders_checkout_v1.sql`: **APLICADA NO SUPABASE HOSTED / CONGELADA**
- `supabase/migrations/20260929_000011_orders_checkout_hardening.sql`: **APLICADA NO SUPABASE HOSTED / CONGELADA**

*Regra de Ouro: Migrations 000001 a 000011 estão estritamente congeladas e aplicadas no Supabase Hosted. Push para GitHub main deve ser tratado como potencial gatilho de deploy Supabase; não usar main como simples backup para mudanças ainda não aprovadas de migration ou Edge Function.*

---

## 3. Estado de Orders / Checkout V1 (Frontend Integration & Runtime Hardening)
- **Orders Backend:** **RUNTIME HARDENING PASS**
- **000010:** **APLICADA / CONGELADA**
- **000011:** **APLICADA / CONGELADA**
- **submit-order-checkout:** **v2 ACTIVE** (verify_jwt = false, autorização service_role via SUPABASE_SECRET_KEYS)
- **Feature Gate:** **RUNTIME 503 PASS / CHECKOUT DESABILITADO** (`CHECKOUT_ENABLED !== "true"` retorna HTTP 503)
- **Frontend Integration Hardening & Correção Residual Final:** **CONCLUÍDO / PASS (158/158)**
  - `buildCheckoutRequestBody`: Helper puro e testável extraído em `orderService.ts` com validação fail-closed antes da rede.
  - Wholesale vazio: Se e-mail e telefone operacionais não forem fornecidos, envia explicitamente `customer: {}` (nunca `undefined`). Identidade comercial oficial provém estritamente do banco de dados (`wholesale_customers`), sem nunca enviar `name`, `document`, `companyName`, `type` ou `buyerUserId` pelo client.
  - Retail: `customer`, `name` e `phone` são estritamente obrigatórios. Tipagem `PF` ou `PJ` validada sem coerção silenciosa.
  - Fail-closed runtime input: `selectedVariant` validado estritamente como string com trim (máximo 160 caracteres), variantes vazias convertidas para `null`, rejeitando outros tipos; `quantity` restrita a inteiros entre 1 e 2147483647; limite técnico de no máximo 200 itens por pedido.
  - `validateReceipt` estrito: Expurgada qualquer coerção arbitrária (`String(itemObj.selectedVariant)` removido); `selectedVariant` aceita apenas `undefined`, `null` ou `string`; quantidades, preços e totais exigem valores finitos `>= 0`; validação estrita de data em `createdAt` via `Date.parse`, rejeitando strings vazias, não-strings ou datas malformadas.
  - Idempotência: Validação estrita de SHA-256 (64 hexadecimais), UUID v4 e TTL de 2 horas em `validateStoredAttempt` e `readStoredAttempt`; rejeição estrita fail-closed sem tolerância para `createdAt` no futuro (`now = Date.now(); createdAt > now` rejeitado, inclusive `now + 1` e `now + 5000`); purga automática de storage corrompido, futuro ou expirado; sessionStorage estritamente livre de PII.
  - Resets e Ciclo de Vida: Botão de fechar (X) e "Voltar ao Catálogo" acionam `resetCheckoutLifecycle()`; inclusão de novos itens no carrinho reseta recibo antigo; formulário PII limpo após sucesso; tela de sucesso só consome recibo validado do servidor.
  - Revalidação Pre-Network Completa (10 Guards): `handleFinishOrder` revalida imediatamente antes da chamada à Edge Function: (1) `settings` existe; (2) `settings.slug` válido e não vazio; (3) carrinho não vazio; (4) autorização de atacado ativa; (5) `wholesaleMinOrderValue` não nulo quando em atacado; (6) mínimo wholesale estimado atendido; (7) nenhum item com quantidade abaixo do mínimo ou estoque insuficiente; (8) `availableDeliveryMethods` não vazio; (9) `deliveryMethod` atual pertencente a `availableDeliveryMethods`; (10) formulário obrigatório válido.
  - Formas de Pagamento: UI oferece exclusivamente PIX Instantâneo e Boleto Bancário; `PaymentMethod` canônico mantém os 4 valores válidos.
  - Transição de Modalidade B2B: Confirmação limpa carrinho antes da troca; eliminados `recalculate` e `remove_incompatible`; `clearCart` desacoplado de state updaters de React; `cart.length` removido das dependências de recarga B2B; removido setter público desprotegido `setPurchaseMode`.
  - Vitrine B2B: Atalho de cadastro B2B oculto quando `allowB2bMode = false`; switcher de grade rápida restrito a `allowB2bMode && purchaseMode === 'wholesale' && isApproved`; reset automático de quick mode para `false` ao sair de atacado ou revogação de aprovação.
  - WhatsApp & Wording: WhatsApp disparado exclusivamente sob demanda após pedido criado; sanitização impede abertura com telefone vazio; recibo do servidor exibe "Total validado pelo servidor"; frete zero apresentado como "A combinar / Calculado pela loja" (nunca como frete grátis/total definitivo).
- **Ativos Protegidos Intactos:**
  - `AppContext.tsx`, `OrderManager.tsx`, `TenantDashboard.tsx`, `supabase/config.toml`, `supabase/functions/*`, `supabase/migrations/*` (000001 a 000011) permanecem estritamente congelados e inalterados.
- **Checkout V1.1 — Revisão de Orçamento + CPF/CNPJ Obrigatório + WhatsApp Handoff:** **CONCLUÍDO / PASS**
  - `checkoutStep = 'review'`: Fluxo evoluído para `cart` → `details` → `review` → `success`.
  - "Validar orçamento": Na etapa `details`, valida formulário e regras localmente (zero chamadas à rede) e avança para `review`.
  - Tela de Revisão: UX marketplace com resumo completo dos itens, fotos, subtotal, frete a combinar, total estimado, forma de pagamento, entrega, dados do cliente, endereço e disclaimer explícito de que preços, estoque e regras serão revalidados pelo servidor. "Voltar e editar" preserva todos os dados; "Confirmar pedido" executa `submitOrderCheckout`.
  - Validação Real de CPF/CNPJ: Módulo puro `src/utils/brDocument.ts` (sem dependências externas) com algoritmo módulo 11 para CPF (11 dígitos) e CNPJ (14 dígitos), rejeição de sequências repetidas e normalização de pontuação.
  - Varejo: CPF obrigatório para PF e CNPJ obrigatório para PJ com mensagens inline específicas. Chaveamento PF/PJ limpa erros de documento.
  - Fail-Closed em `orderService.ts`: `buildCheckoutRequestBody` exige documento válido no varejo e normaliza para dígitos.
  - Edge Function `submit-order-checkout`: Exige documento válido no varejo, valida checksum módulo 11 (CPF para PF, CNPJ para PJ) e rejeita com HTTP 400 em caso de documento inválido. `CHECKOUT_ENABLED` mantido fail-closed.
  - Lifecycle de Dados para WhatsApp: Estado `confirmedCustomerSnapshot` em memória React (nunca em localStorage/sessionStorage/IndexedDB) preservado durante a confirmação e mantido após o sucesso do pedido. Limpo no `resetCheckoutLifecycle`.
  - WhatsApp: Botão explícito "Enviar pedido pelo WhatsApp" utiliza exclusivamente dados financeiros e itens do recibo validado do servidor (`createdOrder`), mesclando dados cadastrais do snapshot e incluindo CPF/CNPJ.
- **Suítes de Testes Automatizados (5 Suítes - 518/518 testes):**
  - `scripts/test-orders-frontend-integration-points.ts`: **207/207 PASSOU (0 FALHOU)**.
  - `scripts/test-orders-checkout-points.ts`: **89/89 PASSOU (0 FALHOU)**.
  - `scripts/test-product-media-storage-points.ts`: **153/153 PASSOU (0 FALHOU)**.
  - `scripts/test-catalog-performance-points.ts`: **34/34 PASSOU (0 FALHOU)**.
  - `scripts/test-branding-storage-points.ts`: **35/35 PASSOU (0 FALHOU)**.
  - `npm run lint` (`tsc --noEmit`): **PASSOU**.
  - `npm run build` (`vite build`): **PASSOU**.
- **ADR 004:** Atualizado formalmente em `docs/adr/ADR_004_ORDERS_CHECKOUT_V1.md`.

---

## 4. Hospedagem Frontend (Cloudflare Workers Static Assets & ADR 005)
- **Frontend Deploy Pipeline:**
  - Repositório: GitHub `main`.
  - Esteira: Cloudflare Workers Builds.
  - Build command: `bun run build` (output em `dist/`).
  - Deploy command: `npx wrangler deploy`.
  - Cloudflare build variable: `BUN_VERSION=1.4.2`.
  - Configuração `wrangler.jsonc`:
    - `workers_dev: true`.
    - `preview_urls: false`.
    - `assets.directory: "./dist"`.
- **Separação Arquitetural:**
  - Frontend: Single Page Application (SPA) em React 19 + Vite 6 servida estaticamente pelo Cloudflare Workers Static Assets.
  - Backend: Supabase Auth, PostgreSQL/RLS, Storage e Edge Functions (Deno).
  - Cloudflare NÃO possui Worker backend, bindings, banco de dados ou autoridade financeira.
- **Variáveis Públicas de Build:**
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`
  - `VITE_PUBLIC_TENANT_SLUG`
- **Hardening de Ativos Públicos:**
  - `public/documentacao-projeto.zip` expurgado do diretório público para não vazar documentação interna no bundle `dist/`.
  - Arquivo de documentação mantido apenas como artefato interno na raiz (`documentacao-projeto.zip`).
- **Validações em Runtime:**
  - Cloudflare runtime validation: **PASS** (`https://corsys-catalogo.corsys1.workers.dev`).
  - Storefront & Conexão Supabase: **PASS**.
  - Checkout Feature Gate (fail-closed HTTP 503): **PASS** (`public.orders` permaneceu em 0).
  - `CHECKOUT_ENABLED`: Mantido desligado (OFF).
  - Domínio customizado: Ainda NÃO configurado.
- **ADR 005:** Registrado formalmente em `docs/adr/ADR_005_CLOUDFLARE_FRONTEND_DEPLOY.md`.

---

## 5. Checkout V1.2 — Single WhatsApp CTA + Private PDF (ADR 006)
- **Status:** **IMPLEMENTADO NO WORKSPACE / AGUARDANDO DEPLOY**
- **Validação de Pedido Real em Produção:**
  - `PED-20260930-000001` criado e validado no Supabase hosted.
  - Status `pending`, preços server-authoritative íntegros, sem duplicidade e sem decremento de estoque.
  - `CHECKOUT_ENABLED` desativado novamente após o teste.
- **Migration 000012 (`supabase/migrations/20260930_000012_order_documents_storage.sql`):**
  - Bucket privado `order-documents` (5 MiB, `application/pdf`).
  - Sem acesso público, sem policies para anon ou browser upload.
  - Gravado exclusivamente via `service_role` na Edge Function.
  - Path canônico: `<tenant_uuid>/orders/<order_uuid>/pedido-<order_number>.pdf`.
- **Geração de PDF Server-Side (`supabase/functions/_shared/orderPdf.ts`):**
  - Implementado com `pdf-lib` (`npm:pdf-lib@1.17.9`).
  - Formatação multi-página para até 200 itens com cabeçalho repetido.
  - Signed URL válida por 7 dias.
  - Graceful fallback: se falhar geração ou assinatura do PDF, o pedido não é desfeito e o cliente recebe mensagem textual com dados do recibo oficial.
- **Frontend `CartDrawer`:**
  - Fluxo otimizado: `cart -> details -> review -> WhatsApp` (step `success` intermediário removido).
  - CTA único: "Enviar pedido pelo WhatsApp".
  - Fail-closed: validação de WhatsApp da loja antes de qualquer requisição.
  - Popup blocker pre-emption: pré-abertura de aba síncrona antes do `await` da Edge Function.
  - Minimização de PII: mensagem curta no WhatsApp com link do documento PDF, omitindo CPF/CNPJ completo e endereços extensos do texto da conversa.
- **ADR 006:** Registrado em `docs/adr/ADR_006_ORDER_DOCUMENT_AND_WHATSAPP_HANDOFF.md`.

---

## 6. Security Hardening V1 — SECURITY DEFINER & Acesso B2B Privilegiado (ADR 007)
- **Status:** **MIGRATION 000013 APLICADA / CONGELADA NO SUPABASE HOSTED (DATABASE HARDENING: RUNTIME VERIFIED) | EDGE FUNCTION GET-WHOLESALE-CATALOG: CORREÇÃO DE BUNDLE PREPARADA / AGUARDANDO REDEPLOY E RUNTIME VALIDATION**
- **Supabase Security Advisor:**
  - Os 3 achados `authenticated_security_definer_function_executable` foram eliminados com sucesso no banco Hosted.
  - Risco residual: `auth_leaked_password_protection` permanece devido a restrições do plano Free do Supabase.
- **Cloudflare Frontend:** Último build do commit de hardening concluído com sucesso (SUCCESS).
- **Tratamento dos 3 Achados de Segurança do Supabase Security Advisor (`authenticated_security_definer_function_executable`):**
  1. **`public.get_my_wholesale_status(p_tenant_slug text)`:**
     - Convertida de `SECURITY DEFINER` para `SECURITY INVOKER` com `SET search_path = ''`.
     - Resolução canônica de tenant realizada exclusivamente sobre `public.tenant_public_settings` (onde `authenticated` possui SELECT sob RLS, sem requerer vínculo em `tenant_users`).
     - Consulta a `public.wholesale_customers` protegida deterministicamente pela política RLS `wholesale_customers_select_self` (`user_id = auth.uid()`).
     - Preserva rigorosamente os estados de retorno públicos: `unauthenticated`, `tenant_not_found`, `not_registered`, `pending`, `approved`, `rejected`, `suspended`.
     - Privilégios: `REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated;`.
  2. **`public.get_wholesale_catalog(p_tenant_slug text)`:**
     - Não convertida para `SECURITY INVOKER` direto no browser, para evitar expansão indevida de RLS em `public.products` que pudesse expor `cost_price` ou dados operacionais a compradores B2B.
     - Privilégio de execução revogado de `PUBLIC`, `anon` e `authenticated`. Função física preservada no banco para segurança de rollback.
     - Nova RPC interna `public.get_wholesale_catalog_internal(p_tenant_slug text, p_user_id uuid)` criada com `SECURITY DEFINER`, `SET search_path = ''` e execução concedida **EXCLUSIVAMENTE a `service_role`** (`REVOKE ALL FROM PUBLIC, anon, authenticated;`).
     - Projeção atacadista estritamente sanitizada: retorna exclusivamente 4 colunas (`product_id`, `sku`, `wholesale_price`, `wholesale_min_quantity`). Jamais projeta `cost_price`, dados internos ou PII.
  3. **Gateway Edge Function Autenticado (`get-wholesale-catalog`):**
     - Ponto único de entrada para o browser obter preços de atacado.
     - Validação obrigatória de cabeçalho `Authorization: Bearer <token>` via `supabaseAdmin.auth.getUser(token)`.
     - O `userId` é estritamente derivado da sessão validada server-side; o payload do cliente não possui autoridade para declarar `userId` ou `tenantId`.
     - Bloqueio imediato de campos proibidos no body (`userId`, `costPrice`, chaves financeiras, etc.) e allowlist exata (`tenantSlug`).
     - Limite técnico de tamanho de body de 4 KB aferido em bytes UTF-8.
     - Frontend em `src/services/wholesaleService.ts` consome a Edge Function via `supabase.functions.invoke('get-wholesale-catalog', ...)` e cessa chamadas diretas a RPC legada.
     - Correção de bundle preparada no workspace; aguardando redeploy e validação em runtime.
  4. **`public.manage_order_status(p_order_id uuid, p_new_status text)`:**
     - Revogação de privilégios de execução de `PUBLIC`, `anon`, `authenticated` e `service_role` (`REVOKE EXECUTE FROM PUBLIC, anon, authenticated, service_role`).
     - Zero concessão para `service_role` nesta etapa por não existir gateway server-side ativo (menor privilégio estrito).
     - Função física preservada no banco; futura integração administrativa deverá estabelecer arquitetura server-side explícita antes de qualquer novo GRANT.
     - Elimina o achado de segurança de execução direta de RPC `SECURITY DEFINER` por papéis de API.
- **ADR 007:** Registrado formalmente em `docs/adr/ADR_007_SECURITY_DEFINER_HARDENING_AND_B2B_GATEWAY.md`.
- **Suítes de Testes Automatizados (5 Suítes - 538 testes no total):**
  - `scripts/test-orders-frontend-integration-points.ts`: **211/211 PASSOU (0 FALHOU)**.
  - `scripts/test-orders-checkout-points.ts`: **105/105 PASSOU (0 FALHOU)**.
  - `scripts/test-product-media-storage-points.ts`: **153/153 PASSOU (0 FALHOU)**.
  - `scripts/test-catalog-performance-points.ts`: **34/34 PASSOU (0 FALHOU)**.
  - `scripts/test-branding-storage-points.ts`: **35/35 PASSOU (0 FALHOU)**.
  - `bun run lint` (`tsc --noEmit`): **PASSOU**.
  - `bun run build` (`vite build`): **PASSOU**.
