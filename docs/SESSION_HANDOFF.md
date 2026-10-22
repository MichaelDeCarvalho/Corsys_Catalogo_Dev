## Handoff — 21/10/2026: priorização da liberação comercial, sem instalação local

O proprietário esclareceu que os 520 produtos são catálogo provisório e serão selecionados/recadastrados antes da comercialização. Alvo agora é liberar plataforma B2C/B2B estável/segura, não preservar SKUs atuais a qualquer custo. **Não interpretar isso como autorização de excluir o banco, 6 pedidos, 2 contas Auth ou 5 PDFs privados**; a classificação/exclusão de dados requer decisão granular.

Feito na PR #6: adicionado fail-closed em `vite.config.ts` impedindo build com `VITE_GOOGLE_ROUTES_UI_ENABLED=true` porque Edge `estimate-delivery` foi isolada em outra branch. Teste negativo incorporado ao workflow Quality, que deve comprovar o motivo de falha; CI do novo HEAD exige conferência. Nenhum Hosted/deploy/merge alterado. Read-only Supabase: 20 migrations, 520 produtos, 6 pedidos, 2 usuários Auth, 5 documentos privados, 0 atacadistas aprovados. Segurança: Supabase advisor alerta leaked-password protection inativa no plano Free (controle Pro+), a tratar para lançamento comercial por configuração operacional/plano, sem inventar proteção.

Próximo item crítico: conclusão do gate Hosted da `000023`, recuperação proporcional e publicação autorizada, seguida de smoke de operações reais. Após isso, catálogo definitivo e critérios comerciais; manter Google pago fora do primeiro release. Detalhes/critério de aceite em `docs/qa/PR6_RELEASE_GATE_20261014.md`.

## Checkpoint autorizado — 21/10/2026: pré-flight Hosted verificado; backup Free pendente

- **Escopo autorizado:** preparar exclusivamente implantação seletiva 000023 para Supabase `vlpwtdqqnecdvccxyodp` após backup recuperável; Google Routes desligado. Não autoriza merge/deploy nem DDL sem recuperação comprovada.
- **Evidência READ-ONLY:** organização plano Free (sem backups automáticos diários), projeto saudável, banco com 20 migrations (18–20 presentes; 23/Google ausentes), 520 produtos/6 pedidos/2 usuários Auth/105 metadados Storage; RPC checkout pública EXECUTE somente service_role, implementação private ainda ausente; banco não alterado.
- **Verificado:** PR #6 HEAD `62895fa97c3d92060e22cf7d9102fa0218494ce8`, CI Quality, Isolated Browser QA, Isolated Staging Recovery = SUCCESS. QA local não é recuperação da produção.
- **BLOQUEIO REAL:** não foi possível observar backup Hosted recuperável, restore com grants/roles/Auth, blobs Storage e janela RTO/RPO. Ferramenta Supabase disponível não fornece exportação/restore verificados de backups nem acesso aos binários Storage. Não inferir PASS nem executar 000023.
- **PRÓXIMA AÇÃO ÚNICA:** responsável operacional gerar backup lógico roles/schema/data e cópia separada de Storage, testar restauração descartável e registrar evidência **sem segredos/PII**. Depois executar preflight imediatamente anterior à implantação seletiva, mediante janela/aprovação específica. Detalhes: `docs/qa/PR6_SELECTIVE_MIGRATION_000023_RUNBOOK_20261019.md`.
- Status **BLOQUEADO PARA DDL HOSTED**, sem `db push`, sem migration/merge/deploy, Google desativado.

## Retomada CorSys.Catálogo — PR #6 release sem backend Google — 21/10/2026

Sistema e repo corretos: `MichaelDeCarvalho/Corsys_Catalogo`, branch `qa/b2b-checkout-e2e-readiness-20261008` / PR #6; não confundir com Corsys.TroncoDigital. Snapshot do trabalho Google antes do corte preservado em `hold/google-routes-after-pr6-20261021` (SHA `277ff2169726a1daecef72de487fdf3944345912`). O PR #6 retirou as duas migrations Google, Edge `estimate-delivery`, registro da função em config e dois testes SQL pagos; guard CI refeito para negar retorno desses arquivos. Código de UI/adapter Google permanece desativado e sem endpoint implantado. `000023` continua na branch e pendente Hosted. Leia o runbook seletivo para preflight e restrições.

Supabase Hosted `vlpwtdqqnecdvccxyodp` READ-ONLY: 000018–20 presentes, 000023/Google ausentes; checkout público service_role-only, privado ainda não criado, RLS de atacado sem SELECT anon; 520 produtos, 6 pedidos. Nenhuma alteração produtiva. QA staging sintética 000023 e CI do snapshot anterior eram PASS; **CI do novo HEAD com Google separado deve ser conferida**. Próximo: verificar CI exato e diff, fechar gate de backup/restore/ACL/Storage/RTO/RPO Hosted e revisar integrações externas; migração Hosted 000023, merge e Cloudflare deploy só com autorizações distintas. Não repetir E2E B2B/RACE já aprovado nem aplicar `db push` indiscriminado.

# SESSION HANDOFF — ITEM 3: CUSTOMER ORDER TRACKING V1 — PRODUCTION HARDENING HOTFIX

## Retomada do PR #6 — revisão e regressões de identidade (2026-10-09, America/Sao_Paulo)

### Verificação de continuidade — 2026-10-10
- **Resultado da correção `67cf47508edf5e7d6fffb3bf666cd91ffb7b998d`:** Quality #40 / run `38085743706` SUCCESS; Netlify preview READY. Cloudflare build `6364d5f6-2d0a-4c51-ad92-936ad47f890e` **SUCCESS**, log confirma `Preview: qa/b2b-checkout-e2e-readiness-20261008 (updated)`, três assets enviados e `This Preview deployment has no active URLs`. Falha do pipeline corrigida; nenhuma URL pública habilitada. Produção observada em `d29a5a2` / versão `d3799ee3`, PR sem merge. Próximo commit apenas documental terá checks próprios; esta evidência se refere exatamente a `67cf475`.
- **Cloudflare autenticado, causa confirmada:** build `231ce770-ec5c-4487-a321-5fa7551372d0` no commit `112d8f2` compilou e falhou em `npx wrangler preview` por ausência do bloco `previews`. Diagnóstico anterior NOT EVALUATED superado para esta build; não assumir resultado da próxima execução.
- **Correção mínima:** `previews: {}` no Wrangler, sem alterar `preview_urls: false`, assets, produção ou bindings. Dry-run local Wrangler 4.143.0 PASS, quatro assets e zero bindings, sem upload; este dry-run não executa a API Preview. O comando preview não oferece dry-run.
- **Isolamento observado no painel:** produção usa `main`/`npx wrangler deploy`; Base de Prévias usa `npx wrangler preview`, nenhuma variável/segredo de build e URLs desativadas. Não copiar endpoint/chaves de produção para prévias. Prévia estática sem backend não valida autenticação B2B. Nenhuma configuração do painel salva, URL habilitada ou recurso de backend criado.
- Quality #39 / run `38085135091`: SUCCESS no commit documental `2f4dbd1238c9e14f5621d4539cd53f9dd2442722`. Próxima CI e Cloudflare da correção ainda aguardam evidência; PR permanece sem merge. Backend isolado e escopo 5/6 continuam pendentes.
- PR #6 permanece aberto, sem merge; revisão inspecionada `ee3561f3cbd32c9297ad874663ac37c17ec62d4a`. Quality #38 / Verify SUCCESS registrado no PR; código não modificado nesta retomada.
- Bot Cloudflare confirma **FAILED** também para a revisão final `ee3561f`, build `d8ead3d7-596b-438a-a703-8dc3694f9e2a`. O painel mostrou indisponibilidade temporária e depois redirecionou para login; log privado não acessível, causa **NOT EVALUATED**. Não confundir a falha do pipeline com regressão comprovada do código.
- **VERIFIED/PASS local:** Wrangler **4.143.0**, comando `deploy --dry-run --outdir .wrangler/qa-dry-run`, exit 0, quatro arquivos de assets lidos, zero bindings, encerramento explícito sem upload. Usados somente assets sintéticos do build local; telemetria desligada e logs direcionados à pasta ignorada do workspace. Primeiro ensaio encontrou restrição de escrita do log global; corrigido o destino local, segunda execução limpa. [Semântica oficial do dry-run](https://developers.cloudflare.com/workers/wrangler/commands/#deploy): validação local, não publicação/runtime remoto.
- Confirmada ausência de Docker/Podman; `wsl --list --quiet` informa WSL não instalado. Listagem Supabase continua somente com branch `main`. O E2E isolado não pode executar neste ambiente atual; nenhuma instalação de componente do sistema, provisão paga ou fixture em produção realizada.
- Próximos passos dependentes: disponibilizar acesso autenticado ao log Cloudflare; ambiente Supabase QA autorizado ou runtime local de containers; requisitos completos 5/6. A instrução genérica de continuar não fornece credenciais, backend isolado nem definição funcional. Nenhum merge/deploy executado.

- Baseline revisada: `112d8f2b8aac6ab96f0c0d36ff6812cc8a68c5cf`, base `d29a5a2`. PR aberto; Quality #36 / Verify SUCCESS confirmado por jobs e logs, incluindo tipos, build e testes B2B. Isso não comprova E2E autenticado.
- Checkout original `Corsys_Catalogo` em `feat/delivery-settings`, com alterações locais de entrega/migration 000019: preservado integralmente. Trabalho deste marco em cópia independente `review-pr6`, branch `qa/b2b-checkout-e2e-readiness-20261008`.
- **Reprodução real com React DOM + jsdom**, usando o provider original e fronteiras Auth/App/rede sintéticas: baseline **5 PASS / 2 FAIL**. Troca direta de comprador A para B mantinha modo atacado/carrinho e modal pendente de A. Não houve teste com clientes reais ou JWT.
- **Correção mínima:** comparar identidade anterior no efeito de autenticação e executar `clearWholesaleSession` antes de consultar o novo comprador. Troca de comprador volta ao varejo, remove carrinho atacadista e cancela modal antigo; renovação do token do mesmo comprador preserva modo/carrinho.
- `scripts/test-wholesale-context.mjs` incorporado ao `test:regression`; jsdom `30.1.2` como dependência exclusiva de desenvolvimento, lockfile Bun atualizado. Esbuild já existente compila o provider sem alterar sua lógica; stubs limitados às dependências de ambiente.
- **VERIFIED/PASS local:** Bun **1.4.2**, instalação baseada no lockfile, `bun run check` exit 0: TypeScript, Vite build, dez suítes existentes e sete cenários React DOM. Os sete cobrem logout tardio, catálogo vazio, resposta fora de ordem, troca de comprador/carrinho, modal de comprador anterior, renovação do mesmo comprador e revogação. Aviso de bundle >500 kB permanece; não é falha de build.
- Problema inicial Windows: checkout com CRLF fazia duas asserções textuais falharem. Cópia isolada restaurada com `core.autocrlf=false`; baseline completa voltou a PASS. Nenhuma expectativa de teste foi flexibilizada. Dependências do checkout original também diferiam do lockfile; a verificação final usa instalação independente pelo Bun.
- **Ambiente isolado:** listagem Supabase atual confirmou somente branch `main` no projeto Corsys_Catalogo. Nenhum projeto QA identificado como dedicado a este sistema. Docker não encontrado no PATH nem no local padrão Windows. Nenhum recurso provisionado, custo autorizado/gerado por provisão, segredo consultado ou escrita em dados de produção.
- **Publicação BLOCKED:** comentário do bot Cloudflare registra preview FAILED para `112d8f2`, build `231ce770-ec5c-4487-a321-5fa7551372d0`; log exige autenticação Cloudflare nesta sessão. Causa NOT EVALUATED. Netlify deploy-preview estava SUCCESS no status GitHub; não comprova backend isolado nem release Cloudflare.
- **Merge/deploy não executados:** `main` pode publicar automaticamente. Gate de release permanece: nova CI, diagnóstico Cloudflare, E2E isolado e autorização concreta de publicação quando necessária. Rollback desta correção frontend: reverter o commit da correção via PR; nenhuma migration a reverter.
- **Itens 5/6: recuperação parcial, não fechamento.** Chat “Configurar campos do checkout” (`01a11d26-1201-7270-a684-8ca4504fda5f`) teve retomada interrompida por limite de uso. O assistente relatou configuração de métodos/endereço de saída/tarifas e depois distância rodoviária/estimativa Uber Moto/Carro. O usuário informou que Google Maps ainda não estava configurado. O pedido original completo e o mapeamento exato 5/6 não foram recuperados: relato do assistente não substitui requisitos autoritativos. Código local não commitado é rascunho, não release; manter separado do PR #6 e confirmar critérios de aceite antes de concluir essas funcionalidades.
- **Pendências efetivas:** E2E B2B-01–13 e RACE-01–04 com backend isolado/fixtures fictícias; acesso ao log Cloudflare; confirmar especificação funcional 5/6. Nenhum desses itens marcado PASS por esta revisão.
- **Entrega da correção:** commit `accdc371e55067a6b5fc08877d75b8046f20b110` enviado ao PR #6. [Quality #37](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38011123354) / Verify **SUCCESS**; instalação frozen, tipos, build e regressão com sete testes React DOM confirmados nos logs. PR aberto, sem merge; commit seguinte apenas registra esta evidência.


## Data
2026-10-08

## Objetivo
Aplicar hotfix e hardening de produção no Customer Order Tracking V1 (Item 3 — ADR 011), garantindo conformidade estrita de privacidade: remoção total de PII (`shippingAddress`, `customerName`) e IDs internos das projeções e da UI, isolamento de localStorage por tenant (`corsys_order_tracking_v1:<slug>`), remoção de busca manual por token, isolamento de modalidade de compra nas RPCs (`shopping_mode = 'retail'` e `shopping_mode = 'wholesale'`), suporte a histórico de lojas desativadas e governança estrita de migrations (000015 congelada e 000016 forward-only).

## Status Operacional Atual
- **Item 3 — Customer Order Tracking Hardening (000016):** **APLICADA / FROZEN NO SUPABASE HOSTED**\n- **Checkout Delivery Methods Hotfix (000017):** **RELEASE CANDIDATE / HOSTED STATUS PENDING POST-MERGE**
- **Migration 000015 & Edge Functions:** **APLICADA / FROZEN NO SUPABASE HOSTED (track-order-by-token ACTIVE v2, list-my-customer-orders ACTIVE v2, submit-order-checkout ACTIVE v19)**
- **Admin Orders V2 (000014):** **APLICADA / FROZEN NO SUPABASE HOSTED / RUNTIME PASS / CLOSED**
- **Item 2 — WhatsApp Textual Handoff (ADR 010):** **RUNTIME PASS / CLOSED**

## Concluído nesta Etapa
- **Hotfix de slug canônico no Meus Pedidos:** auditoria runtime confirmou quatro HTTP 404 em `list-my-customer-orders` porque a view usava `currentTenant.slug` (estado legado/mock) enquanto Storefront/Checkout usam `PUBLIC_TENANT_SLUG`. B2B, storage varejo e lookup por token agora usam o slug público canônico único.\n- **Bug runtime reproduzido em 2026-10-08:** checkout retornava HTTP 400 / SQLSTATE `22000` com `O método de entrega "retirada" não está ativo ou não é aceito por esta loja.` O tenant persistia `delivery_methods` como array JSONB de strings, enquanto a validação introduzida em 000015 esperava somente objetos `{ id, active }`.\n- **Migration 000017:** recria somente `create_order_checkout_internal` preservando toda a lógica vigente e aceitando ambos os formatos de `delivery_methods`; migrations 000001–000016 permanecem congeladas.\n- `supabase/migrations/20261009000000_000016_customer_order_tracking_hardening.sql` criada forward-only sem alterar 000001–000015, recriando as RPCs `track_order_by_token_internal` e `list_my_customer_orders_internal` com projeções sanitizadas sem PII (`shippingAddress`, `customerName`, `id`, `tenant_id`, etc.), shopping_mode estrito e sem exigência de `t.status = 'active'`.
- `supabase/functions/track-order-by-token/index.ts` atualizada com allowlist exata de body (`tenantSlug`, `trackingToken`), sanitização defensiva explícita de saída e 404 genérico sem mensagens SQL internas.
- `supabase/functions/list-my-customer-orders/index.ts` atualizada com allowlist estrita de chaves (`tenantSlug`, `limit`, `offset`), rejeição de chaves proibidas (`userId`, etc.), extração server-side de `buyerUserId` e sanitização de cada item de saída.
- `src/services/customerTrackingService.ts` atualizado com tipo `CustomerTrackedOrder` livre de PII/IDs, validador fail-closed em runtime, storage isolado por tenant (`corsys_order_tracking_v1:<slug>`), registros sem `tenantSlug` interno (`{ orderNumber, trackingToken, createdAt }`) e migração segura client-side da chave legada.
- `src/components/storefront/CustomerOrderTrackingView.tsx` atualizado: remoção total de busca manual por token, remoção completa de "Endereço de Entrega" e PII da interface, identificação de pedidos por `orderNumber` (sem dependência de UUID), isolamento de tenant no carregamento com `Promise.allSettled`, e limpeza de pedidos B2B no logout.
- `src/components/storefront/CartDrawer.tsx` atualizado para invocar `storeRetailOrderTracking(settings.slug, ...)` com escopo de tenant.
- `src/context/AuthContext.tsx` atualizado para redirecionar `viewMode = 'my_orders'` para `'storefront'` ao executar `signOut()`.
- `scripts/test-admin-orders-points.ts` e `scripts/test-admin-orders-v2-points.ts` atualizados para validar exatamente 16 migrations (sem `>=`).
- `scripts/test-customer-order-tracking-points.ts` atualizado com suíte completa de privacidade e hardening (37 asserções aprovadas).
- `docs/SECURITY_REGISTER.md` atualizado com registro de risco do Retail Tracking Token como bearer credential em localStorage (mitigações e risco residual MITIGATED / RESIDUAL).
- `docs/adr/ADR_011_CUSTOMER_ORDER_TRACKING_AND_RETAIL_TOKEN.md`, `docs/CURRENT_ARCHITECTURE.md` e `docs/PROJECT_CONTEXT.md` atualizados.
- As 9 suítes de teste de regressão aprovadas (236 + 100 + 153 + 34 + 35 + 63 + 102 + 98 + 40 = 861 testes / 0 falhas).
- `bun run check` (lint + build + test:regression) validado com 100% PASS.

---

# SESSION HANDOFF — ITEM 2: WHATSAPP TEXTUAL HANDOFF & ADMIN ORDERS V2 CLOSEOUT

## Data
2026-10-07

## Objetivo
Implementar o handoff 100% textual para WhatsApp no Checkout (Item 2 — ADR 010), eliminando links de PDF da mensagem e preservando a infraestrutura de PDF server-side intacta, e consolidar o fechamento de Admin Orders V2 (RUNTIME PASS / CLOSED).

## Status Operacional Atual
- **Admin Orders V2:** **RUNTIME PASS / CLOSED** (Controles de status, débito/estorno atômico de estoque, portal isolado de impressão `#order-print-root` e auto-refresh de frescor de dados validados).
- **Item 2 — WhatsApp Textual Handoff (ADR 010):** **IMPLEMENTADO / PENDING RUNTIME VALIDATION** (helper puro `buildOrderWhatsAppMessage` criado, CartDrawer consome exclusivamente dados autoritativos do servidor, bifurcação removida, link de PDF eliminado da mensagem do WhatsApp).

## Concluído nesta Etapa
- `src/utils/orderWhatsAppMessage.ts` criado com helper puro `buildOrderWhatsAppMessage`.
- `src/components/storefront/CartDrawer.tsx` refatorado para consumir exclusivamente o helper sem bifurcação de PDF.
- `scripts/test-orders-frontend-integration-points.ts` atualizado com 24 asserções comportamentais do helper (236/236 testes aprovados).
- `docs/adr/ADR_010_WHATSAPP_TEXTUAL_ORDER_HANDOFF.md` criado.
- `docs/PROJECT_CONTEXT.md` e `docs/CURRENT_ARCHITECTURE.md` atualizados.
- As 8 suítes de teste de regressão aprovadas (236 + 100 + 153 + 34 + 35 + 63 + 100 + 96 = 817 testes / 0 falhas).
- `bun run lint`, `bun run build` e `bun run check` validados com sucesso.

---

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
- **Suítes de Testes Automatizados (7 Suítes - 687 testes no total):**
  - `scripts/test-orders-frontend-integration-points.ts`: **212/212 PASSOU (0 FALHOU)**.
  - `scripts/test-orders-checkout-points.ts`: **105/105 PASSOU (0 FALHOU)**.
  - `scripts/test-product-media-storage-points.ts`: **153/153 PASSOU (0 FALHOU)**.
  - `scripts/test-catalog-performance-points.ts`: **34/34 PASSOU (0 FALHOU)**.
  - `scripts/test-branding-storage-points.ts`: **35/35 PASSOU (0 FALHOU)**.
  - `scripts/test-security-hardening-points.ts`: **63/63 PASSOU (0 FALHOU)**.
  - `scripts/test-admin-orders-points.ts`: **85/85 PASSOU (0 FALHOU)** (inclui validação de shape real do Checkout V1 sem PII, campos opcionais vazios no banco e fail-closed).
  - `bun run lint` (`tsc --noEmit`): **PASSOU**.
  - `bun run build` (`vite build`): **PASSOU**.
  - `bun run test:regression`: **PASSOU (687/687)**.
  - `bun run check`: **PASSOU (lint + build + test:regression com exit code 0)**.

---

## 7. Admin Orders V2 — Ciclo de Vida Server-Side, Controle de Estoque, Impressão e PDF
- **Status:** **CONCLUÍDO NO WORKSPACE / CI PASS / PRE-SYNC**.
- **Contexto Operacional:**
  - O checkout real persiste pedidos em `public.orders` (ex: `PED-20260930-000001`, `PED-20260930-000002`, `PED-20261001-000003`).
  - Mocks continuam 100% segregados fora do painel administrativo.
  - `TenantDashboard` resolve o UUID real do tenant (`resolveTargetTenantId`) e executa `fetchAdminOrders(tenantId)`.
  - O único *source of truth* para KPIs e listagem é `adminOrders` no `TenantDashboard`.
  - `OrderManager` é props-driven (`orders`, `loading`, `error`, `onReload`).
- **Arquitetura Implementada (V2):**
  - **Migration 000014:** `supabase/migrations/20261005170000_000014_admin_order_management.sql`.
    - RPC `public.manage_order_status_internal(p_order_id UUID, p_new_status TEXT, p_actor_user_id UUID)` com `SECURITY DEFINER` e execução restrita exclusivamente a `service_role`.
    - Reafirmação de bloqueio da RPC legada `public.manage_order_status(UUID, TEXT)`.
    - Trava pessimista `FOR UPDATE` na linha do pedido e autorização server-side do operador (`platform_admin` ou `tenant_admin`/`stock_manager` do mesmo tenant; `sales_rep` negado).
    - Locks pessimistas de produtos ordenados por UUID evitam deadlock.
    - Transição `pending -> approved` debita estoque atomicamente; transições `approved/preparing -> cancelled` restauram o estoque uma única vez.
    - Estados `delivered` e `cancelled` são terminais irreversíveis.
  - **Edge Functions Gateway Segregadas:**
    - `supabase/functions/manage-order-status/index.ts`: Responsabilidade única de ciclo de vida. Payload exato `{ orderId, newStatus }`. Deriva ator server-side via `auth.getUser()` e delega para RPC interna com `service_role`.
    - `supabase/functions/generate-admin-order-pdf/index.ts`: Função dedicada com payload exato `{ orderId }`. Autorização de leitura via RLS no contexto do JWT do operador (permite `sales_rep`). Service role estritamente pós-leitura para persistir no bucket `order-documents` e emitir Signed URL com TTL de **exatamente 600 segundos**.
    - Ambas declaradas com `verify_jwt = true` em `supabase/config.toml`.
  - **Impressão Isolada & Frescor de Dados:**
    - `src/components/tenantadmin/OrderPrintDocument.tsx` renderizado via `createPortal` em `document.body` com `#order-print-root`.
    - `src/index.css` oculta a árvore padrão com `body > #root { display: none !important }` e exibe exclusivamente `#order-print-root` em `@media print` com `@page { size: A4 portrait; margin: 10mm; }`.
    - Callback `handleOrderStatusChanged` em `TenantDashboard.tsx` recarrega `loadAdminOrders` e `loadAdminProducts` atomicamente.
    - Auto-refresh de janela/aba via `focus` e `visibilitychange` com throttle de 800ms (`lastRefreshAtRef`) e cleanup de listeners.
    - Ausência de `setInterval`, `supabase.channel` e `postgres_changes`.
    - Botão "Gerar PDF" no `OrderManager` consome `generateAdminOrderPdf` e abre o documento em nova aba.
  - **Serviços & Contrato:**
    - `updateAdminOrderStatus` e `generateAdminOrderPdf` exportados em `src/services/adminOrderService.ts`.
    - Proibição absoluta de hard delete (`.delete()`) mantida.
- **Governança & Gate de Qualidade:**
  - Registrado no ADR 009 (`docs/adr/ADR_009_ADMIN_ORDERS_V2_LIFECYCLE_AND_STOCK.md`).
  - 14 migrations rastreadas com prefixos de versão estritamente únicos.
  - `bun run check` (lint + build + 8 suítes de teste de regressão, totalizando 793 testes) validado com exit code 0.




## Item 4 — Configurabilidade dos campos do checkout (2026-10-08)
- Implementação: ADR 012; nova migration `20261009020000_000018_checkout_field_settings.sql`.
- Configuração por tenant com allowlist explícita de 14 campos e flags booleanas `visible`/`required`; 10 campos configuráveis e 4 campos obrigatórios fixos nesta versão.
- Enforcement na RPC transacional, descarte de valores ocultos, políticas RLS/grants existentes preservadas. Administração em Configurações da Loja com UPDATE condicional contra sobrescrita concorrente.
- Identidade B2B oficial, Itens 1–3, WhatsApp textual, PDFs e tracking preservados. Itens 5/6 fora do escopo.
- Estado desta revisão: tipos/build/regressão local PASS; Hosted/CI/publicação aguardam evidência pós-commit no SESSION_HANDOFF.
- Confirmação de retomada: migrations 000001–000017 aplicadas no Hosted em 2026-10-08; notas históricas anteriores de pendência de 000016/17 estão superadas por esta inspeção.

### Evidência após commit 884c741 — Item 4 (2026-10-08)
- PR: https://github.com/MichaelDeCarvalho/Corsys_Catalogo/pull/2 (aberto, sem merge).
- Local: npm run lint, npm run build e npm run test:regression PASS; 10 suítes. Bun não disponível no PATH local; CI usa Bun 1.4.2 + frozen lockfile.
- GitHub Quality run 37839268285 / Verify: SUCCESS no commit 884c7412a6fd70ab1324ef40b8778e2a8899b712.
- Migration 000018 aplicada no Hosted vlpwtdqqnecdvccxyodp via MCP. Schema e função ativos. A API gerou versão 20261008202538; arquivo usa 20261009020000 para ficar após migrations 16/17. Somente a nova entrada precisa alinhamento; migrations 1–17 intactas.
- BLOCKER: revisão automática rejeitou UPDATE direto de supabase_migrations.schema_migrations por risco de drift durável e ausência de autorização específica. Aprovação solicitada para trocar apenas version de 000018 (20261008202538 -> 20261009020000). Nenhuma tentativa de contornar. Não fazer merge/publicação enquanto pendente.
- Teste SQL 02_checkout_fields_test.sql executado no Hosted: PASS, incluindo constraints, required dos 10 campos configuráveis, ocultos, anon/admin/sales/stock/platform/cross-tenant, identidade B2B sintética, preços, estoque e idempotência.
- Verificação pós-rollback: 6 pedidos reais; zero usuários/tenants de teste; configurações válidas; RLS ativa; anon sem UPDATE; authenticated com grant da coluna sob RLS; RPC negada ao browser.
- Advisors de segurança antes/depois: nenhum finding novo; permanece aviso preexistente de leaked password protection desabilitada (fora do Item 4).
- Preview Netlify automático SUCCESS: https://deploy-preview-2--mcdistribuicao.netlify.app (pipeline preexistente, não alterado). Navegador: 520 SKUs carregados; campos padrão visíveis; mensagens obrigatórias; varejo PF sintético avançou para revisão e voltou preservando valores. Nenhum envio, pedido ou WhatsApp disparado pelo navegador.
- Supabase Preview dedicado: NOT EVALUATED; apenas branch main existente na listagem. Não confundir preview Netlify com branch Supabase.
- Nova versão Cloudflare: NOT PUBLISHED/NOT EVALUATED, aguardando blocker. Edição administrativa ponta a ponta pelo browser: NOT EVALUATED; controle e RLS verificados pelo SQL, componente implementado.
- Próximo passo após aprovação: alinhar só a nova versão; confirmar history e schema; registrar evidência; checks da revisão final; merge PR e validar versão/runtime Cloudflare e edição administrativa. Não iniciar Item 5/6.

### Alinhamento autorizado — 2026-10-08
- Usuário autorizou explicitamente somente a troca de versão da nova migration 000018 de 20261008202538 para 20261009020000 para concluir a publicação.
- UPDATE condicionado por versão anterior e nome retornou exatamente uma entrada: version=20261009020000, name=000018_checkout_field_settings. Não houve alteração de schema, função, statements ou migrations 1–17 nesta operação.
- Bloqueio anterior RESOLVIDO. Histórico alinhado ao arquivo forward-only; testes do Hosted previamente aprovados permanecem pertinentes (somente metadado mudou).
- Quality run 37839821291: SUCCESS no commit documental f0fae4a. Preview Netlify SUCCESS na mesma revisão.
- Publicação Cloudflare e validação administrativa continuam pendentes de execução, a registrar abaixo.

### Fechamento publicado — Item 4 (2026-10-08)
- Estado final: IMPLEMENTADO/PUBLICADO. PR 2 integrado em main no commit 4759ae5159a4d024d988f9cba0d3e41c354b1b9c; Quality run 37840134708 SUCCESS no head f99b4ca. GitHub mostra 3/3 checks de main concluídos com sucesso.
- Runtime Cloudflare confirmado em https://corsys-catalogo.corsys1.workers.dev/: novo componente Campos do checkout disponível; asset publicado /assets/index-DjufW1bk.js. Version ID da Cloudflare não consultado: CLI local sem credencial configurada. Evidência de publicação é a UI nova em produção e os checks de main.
- Administração autenticada: leitura real dos 14 campos PASS; campos fixos bloqueados; ocultar e-mail remove required e desabilita o controle. Alterações locais revertidas antes do save; salva somente política padrão original. Mensagem de sucesso real, recarga e flags persistidas confirmadas. Nenhuma mudança comercial efetiva.
- Hosted após save: 6 pedidos, todas as configurações válidas, e-mail visível/opcional preservado. Histórico 000018=20261009020000 alinhado; migrations 1–17 intactas.
- Limites: Supabase Preview dedicado e happy path B2B pelo navegador permanecem NOT EVALUATED. B2B sintético, isolamento e enforcement avaliados em testes SQL reais com rollback. Nenhum pedido ou WhatsApp criado no navegador.
- Encerramento em PR 3: documentação e correção mínima de contraste (text-slate-900) na seção administrativa. Sem alteração de schema ou política. Itens 5/6 não iniciados.


---

## Continuidade de QA — Checkout B2B / Estado de fechamento (2026-10-08)

- **Escopo desta revisão:** checagem de readiness do happy path B2B autenticado e do Supabase Preview sem mutações de produção. Baseline Item 4 segue CLOSED/PUBLISHED.
- **Hospedado, observado via leitura:** 18 migrations, última `20261009020000`; 8 Edge Functions ACTIVE; 6 pedidos preservados; política checkout válida (1/1); 0 cadastros B2B approved com user_id vinculado; somente branch Supabase `main`.
- **Autorização técnica observada:** `create_order_checkout_internal` e `get_wholesale_catalog_internal` sem EXECUTE para anon/authenticated, com EXECUTE para service_role. O veredito não inclui teste de JWT/HTTP no navegador.
- **Security Advisor:** somente WARN preexistente `auth_leaked_password_protection` desabilitada; não foi habilitada ou alterada.
- **Teste B2B navegador:** BLOCKED por ausência de usuário B2B aprovado vinculado a Auth em ambiente isolado e por ausência de Supabase Preview; `NOT EVALUATED` funcionalmente.
- **Teste Supabase Preview:** BLOCKED por falta de ambiente dedicado; provisão pode exigir plano pago e autorização de custo. Não foi criado.
- **Roteiro reproduzível:** `docs/qa/CHECKOUT_B2B_E2E_VALIDATION.md` (13 casos positivos, negativos, limites comerciais, idempotência, isolamento, privacidade, WhatsApp textual e regressão varejo).
- **Itens 5/6:** requisitos funcionais não localizados no material versionado; status permanece `SCOPE UNKNOWN / NOT STARTED`, sem inferir escopo.
- **Sem alterações de produção:** nenhuma migration aplicada, Edge Function implantada, política alterada, pedido criado ou dado B2B modificado nesta revisão.
- **Próxima execução válida:** provisionar ambiente isolado autorizado, criar identidades fictícias e buyer B2B aprovado nele, cumprir QA B2B-01–13 e registrar evidências sanitizadas. Item 5/6 depende de definição real.
- **Entrega desta documentação:** branch GitHub `qa/b2b-checkout-e2e-readiness-20261008`; sem merge em `main`, sem CI/preview decorrente de PR e sem novo deploy Cloudflare. O teste completo ainda não pode ser marcado PASS.


---

## Continuação — B2B session race hardening / PR #6 (2026-10-09)

- **Motivo:** leitura de `WholesaleAccessContext` encontrou respostas de `refreshWholesaleStatus` e `loadWholesaleCatalog` sem verificação de sessão/ordem após `await`, com possibilidade de repovoamento do estado B2B após logout/troca de usuário ou chegada fora de ordem. O modal de troca também não revalidava aprovação no momento de confirmar.
- **Implementado somente na branch de QA:** `src/utils/wholesaleRequestGate.ts` (versão de requisição + proprietário da sessão), integração em `WholesaleAccessContext` com invalidação ao limpar autenticação/iniciar novos carregamentos, renderização de estado/catálogo condicionada ao usuário atual e confirmação de atacado sujeita à aprovação atual.
- **Regressão adicional:** catálogo aprovado vazio não aciona loop de refetch; marcador por usuário permite nova carga depois de refresh explícito.
- **Teste automatizado:** `scripts/test-checkout-fields.ts` cobre whitelist de dados B2B, fingerprint por tenant/usuário e guarda assíncrona com resposta atrasada, ordem invertida, logout e revogação. CI da revisão final deve ser verificado no PR antes de fechar esta atividade; não interpretar commit salvo como teste executado.
- **Artefatos de governança:** `docs/SECURITY_REGISTER.md`, `docs/CURRENT_ARCHITECTURE.md`, `docs/PROJECT_CONTEXT.md` e este handoff atualizados; nenhuma migration, Edge Function ou segredo alterado.
- **Publicação:** PR #6 em review; branch não integrada a `main`. **Sem deploy Cloudflare** e sem qualquer operação de escrita no Supabase Hosted.
- **Limitações:** testes com React renderizado no navegador, autenticação B2B E2E real multiusuário e Supabase Preview dedicado continuam `NOT EVALUATED / BLOCKED`, conforme issue #4; itens 5/6 continuam sem requisitos versionados, conforme issue #5.
- **Próxima ação:** observar CI Quality do commit final e anexar resultado ao PR. Revisar mudança antes de merge/publicação; após existir backend de QA, executar B2B-01–13 e os cenários de logout, alternância rápida de usuários e catálogo vazio com evidência real.

## QA local autenticado — 2026-10-10

Ver ADR 013 para decisões, migration 000020 e diferenças controladas do ambiente local. Supabase local real, Auth real e fixtures fictícias; nenhuma alteração Hosted. RLS/integridade e checkout_fields executados no PostgreSQL com rollback: PASS. Oito testes de API local: PASS (anon/pending denied, aprovado A, isolamento A/B, total forjado negado, mínimo negado, pedido oficial total 100, idempotência). Correções encontradas: arquivamento de produto por admin, tiers B2B públicos, catálogo vazio após reload de comprador autenticado e recibo HTTP local. Bun check inclui fronteiras HTTPS/loopback.

A matriz RLS legada fica corrigida pela ADR 013: anon não consulta wholesale_tiers; equipe autorizada mantém políticas próprias. Os testes de preparação de orders agora incluem idempotency_key. Não declarar que Hosted recebeu essas correções.


Atualização final deste registro: 18 testes de API local PASS; pedido do navegador PED-20261010-000006 confirmado no banco (wholesale/pending/R). Cobertura consolidada PARTIAL, com limites por caso em docs/qa/LOCAL_RUNTIME_20261010.md. RACE com fronteiras reais de navegador e alguns subcasos UI/retail/tracking permanecem pendentes. Inspeção da aba externa WhatsApp foi bloqueada pela revisão automática; nenhum envio efetuado. Sem merge/deploy de produção.


Teste adicional 03_private_wholesale_tiers_test.sql: PASS em papéis reais, com duas faixas não vazias. Comprador aprovado não consulta tiers/produtos privados; administrador consulta somente tiers próprios e arquiva produto próprio; anon negado. Fixtures e alterações revertidas na transação.

## Preparacao Google Maps solicitada pelo usuario
Google substitui Geoapify/manual. Ver docs/qa/GOOGLE_MAPS_ACTIVATION.md para escopo, testes e bloqueios. Adapter Essentials, calculo em centavos e componente Maps URL preparados sem integracao/ativacao; teste sintetico e lint PASS. Reserva persistente de quota, endpoint e UI ainda pendentes. Console autenticado atualmente MEDICAOAGUA, projeto do Catalogo nao identificado; billing/quota/key/alerta nao modificados. Solicitados projeto/email e decisao sobre rota DRIVE comum versus perfis Enterprise. Nenhuma garantia de risco zero ou deploy. Alteracoes ainda locais, checks do head 3b9c115 nao validam este novo rascunho.

2026-10-11:contador global Google250/dia7500/mes implementado em migration20261011032224 e validado em SQL05 no banco local, fixturesrevertidas. Integracao endpoint/UI e protecao de chave pendentes; sem chamadasGooglereais,mergeoudeploy. Evidencias em GOOGLE_MAPS_ACTIVATION.md.

2026-10-11: estimate-delivery eAutomaticDeliveryEstimate conectados aoCartDrawer; painelDeliverySettings integrado. Migration19 aplicada localmente eSQL04PASS comrollback; SQL05contadorPASS anterior. BuncheckPASS(logqa-google-code-check.log); test-delivery-settings eGoogleRoutingPASS adicionais incluidos emcheck. POSTlocal semAuth401gateway, comanonJWT403origemnegada; OPTIONS403. Nao alegar testeativo503 ou chamadaGoogle. Configqa-local ainda precisa estanza functions.estimate-delivery verify_jwtfalse e origens deQA ao retomar. FeatureflagGooglefalse/ausente e semchave, portanto nenhumconsumo. UI corrida/revisao ainda naoexecutadas. Aindaalteracoeslocais semcommit/push/merge/deploy.

2026-10-11: validacaoUI entregaMoto comenderecoficticio completo ePOST503desativadoPASS; componente impedeenderecoincompleto,nadaGoogleenviado. ProtecaodechaveporIPbloqueadapelaausenciadeIPestaticoSupabase. Nao baixar exigenciariscozero/HTTPref semdecisaoexplicita; OAuthalternativaaindaNAOAVALIADA paraesteprojeto. Sessao functions16937 ativa,origemlocalhostpermitida,Googlefalse. Alteracoeslocais,semcommit/deploy.

## Validação real local — 2026-10-11

O usuário aprovou prosseguir após receber a explicação sobre o risco residual da chave sem restrição por IP. Restrição à Routes API confirmada novamente no Console. Chave instalada exclusivamente no arquivo privado de ambiente do servidor local, fora do checkout Git; valor não registrado nesta documentação nem exposto no navegador.

Quatro consultas reais passaram pelo endpoint local e foram contabilizadas nos dois contadores privados (dia: 4; mês: 4). Endereços públicos de teste: MASP, Avenida Paulista 1578, e Praça da Sé 1, São Paulo. Retorno Google: 4143 metros. Moto a 180 centavos/km: 746 centavos; Carro/Caminhão a 250 centavos/km: 1036 centavos. Ambas as modalidades usam DRIVE básico.

Na interface: distância 4,14 km; Moto R$ 7,46; Carro/Caminhão R$ 10,36. Trocar modalidade removeu o resultado anterior. Link universal Maps gerado com origem/destino e sem chave. Total do pedido continuou R$ 30,00, com frete a combinar; nenhum pedido foi enviado. Evidência visual: qa-google-route-success.png na raiz do workspace.

Requisições com origem não permitida, endereço incompleto e consentimento ausente foram rejeitadas (403/400/400). Verificação completa `check` passou, incluindo testes existentes e novos testes de entrega/rotas. Testes sintéticos não substituem o registro separado das quatro consultas reais.

Ativação limitada ao ambiente local. Produção não recebeu chave, migrations nem deploy. Cota Google anteriormente verificada: 250/dia; limite local: 250/dia e 7500/mês. O limite mensal local não protege chamadas realizadas diretamente com uma chave vazada; alertas de faturamento não bloqueiam gastos. Sem garantia de custo zero. Link Maps foi inspecionado; a navegação externa não foi testada. Matriz B2B completa e CI do novo trabalho continuam pendentes.

## Reauditoria da chave e controles adicionais — 2026-10-11

Escopo autorizado: adapter Google, endpoint público estimate-delivery, limites PostgreSQL, arquivo secreto local, código/frontend compilado e logs locais. Produção, IAM/2FA da conta Google e histórico completo Git não avaliados nesta rodada. Nenhuma nova chamada Google foi necessária.

Achado confirmado: uma pessoa pode falsificar Origin fora do navegador e esgotar a cota global; CORS não autentica. Mitigação aplicada: reserva serializada também limita a 10 tentativas por janela de 60 segundos, mantendo 250/dia e 7500/mês. Não elimina abuso lento/distribuído nem protege uso direto de chave vazada. A janela permite rajadas na fronteira entre janelas; não é limite móvel. Uso legítimo acima do limite recebe indisponibilidade temporária, sem fallback pago.

Achado confirmado: arquivo privado .env herdava permissão de leitura do grupo local CodexSandboxUsers. Remediação aplicada e lida novamente: herança removida e três identidades explícitas — usuário atual, SYSTEM e Administradores. Administradores e processos executados como o usuário ainda podem acessar o segredo. Arquivo permanece fora do checkout e deve ser excluído de backups/exportações compartilhadas. Não houve criptografia adicional do arquivo nem avaliação de BitLocker.

Prevenção adicional: check inclui test-google-secret-boundary.ts. Rejeita padrões de chave Google em fontes/artefatos e referência à variável/header server-only em frontend/dist. Mensagens não imprimem valores de credenciais. Comparação exata com a chave real em 18 logs/artefatos locais passou, inclusive arquivos de log abertos (leitura compartilhada). Isso não certifica outros logs, backups, histórico remoto ou serviços externos.

Endpoint mantém destino Google fixo, HTTPS, redirects recusados, timeout 8s, sem retries automáticos, resposta de erro sanitizada e corpo máximo 4096 bytes. JSON malformado agora retorna 400. Chave enviada em cabeçalho, nunca em URL; nenhum console/log do endpoint registra chave ou endereço. Esses controles foram inspecionados; redirects/timeout não foram ensaiados contra Google nesta rodada.

VERIFIED: testes SQL de cotas diária/mensal e isolamento; SQL de rajada (10 permitidas, 11 bloqueada, janela expirada libera, serviço não reseta); check completo (tipos/build/regressões/rotas/fronteira do segredo). SQL transacional com rollback, sem consumo Google. Migration nova aplicada somente no banco local. Não foi feito teste de carga ou concorrência em conexões independentes.

Risco residual: chave sem restrição IP pode ser reutilizada por quem a obtiver. Restrição Routes não limita SKU; alertas não bloqueiam cobrança. IP de saída fixo/identidade OAuth, proteção adicional de bot e revisão de IAM/2FA devem ser avaliados antes da ativação em produção, sem criar infraestrutura paga. Não foi observado vazamento nos arquivos examinados; não é garantia absoluta.

Fonte oficial consultada: https://developers.google.com/maps/api-security-best-practices . Rollback: reverter migration de rajada para a função anterior preservando cotas, remover teste de scanner se necessário; restauração de ACL requer decisão explícita e não é recomendada. Documentos anteriores permanecem registro histórico; este marco descreve controles atuais.
## Estado consolidado — entrega Google Routes, 2026-10-11

Integração local implementada: painel de métodos/endereço/tarifas, cálculo automático DRIVE básico no servidor, link Maps sem chave e estimativa separada do total oficial. Sem distância manual. Chave exclusivamente no servidor local, Routes API somente, sem restrição IP por decisão expressa do usuário após explicação dos riscos. Quatro consultas Google reais: 4143 metros, Moto R$7,46, Carro/Caminhão R$10,36. Produção permanece sem ativação.

Limites persistentes: 10 tentativas por janela de 60 segundos, 250/dia e 7500/mês; reserva antes da chamada, falhas consomem cota, bloqueios sem fallback. Arquivo secreto fora do checkout com ACL restrita; check examina código e artefatos para impedir publicação de chaves. Endereço da loja é compartilhado no resultado/link, apesar de a configuração ser privada; painel informa isso explicitamente.

Revalidação HTTP com Auth real local: 18/18 PASS em 2026-10-11, incluindo isolamento A/B, revogação, idempotência, mínimos, campos e varejo. Nenhuma mensagem enviada. A matriz completa de interface B2B e corridas com rede real continua PARTIAL; não converter cobertura de API/componente em E2E PASS. Relatório detalhado em docs/qa/GOOGLE_MAPS_ACTIVATION.md.

Riscos: Origin não autentica; abuso pode esgotar limites. Chave vazada permite chamadas diretas que ignoram contadores locais; Routes API não restringe SKU e alertas não bloqueiam cobrança. IAM/2FA ainda não avaliados. Não há garantia de custo zero, nem autorização de merge/deploy de produção.
## Continuidade de navegador — 2026-10-11, head b6d9691

VERIFIED no navegador local com Auth real: comprador A abriu atacado, preço R$20 e mínimo 5. Carrinho com 5 unidades/R$100 foi encerrado via logout. Após conclusão assíncrona: botão Entrar, carrinho sem contagem, catálogo varejo R$30, sem identificação comercial/preço atacadista. Isso comprova logout normal; não é o cenário RACE de resposta deliberadamente atrasada.

VERIFIED B2B-02 (subcaso pending): login pending-a fictício, status Em análise. Clique no atacado manteve varejo R$30 e exibiu aviso de análise administrativa. Nenhum pedido criado ou mensagem enviada. Evidência visual privada: qa-b2b-pending-blocked.png fora do Git. Subcaso blocked ainda não executado no navegador.

Quality #44 SUCCESS para b6d96910dc310c497bce566f4828b534d887a9c9 foi confirmado na etapa anterior. Alterações desta etapa são apenas documentação de evidência. Matriz geral continua PARTIAL. Após carregamento, IAM confirmou Permissões do projeto Catalogo: uma identidade de usuário visível, Michael Carvalho, papel Proprietário. Sem outros usuários/grupos na tabela sem filtros. Concessões de papel fornecidas pelo Google não incluídas (checkbox desmarcado); revisão limitada aos acessos exibidos. 2FA não avaliada. Nenhuma permissão modificada.
## Campos e mínimo na interface — 2026-10-11

Head b6d9691, usuário aprovado fictício A, Supabase local. B2B-05: mínimo temporário R$500, carrinho 5 x R$20=R$100; interface informou faltam R$400 e desabilitou Avançar. Quantidade 25 atingiu R$500 e permitiu abrir entrega. B2B-07 (email): política visible/required true, email exibido com asterisco; Validar orçamento com campo vazio produziu E-mail é obrigatório e manteve entrega, sem envio de pedido. Evidência local qa-b2b-required-email.png fora do Git.

Configurações restauradas do snapshot privado local: mínimo R$100 e email visible/required false, conferidos no banco. Recarregamento e nova abertura B2B da tela de entrega confirmaram ausência do textbox E-mail (B2B-06, subcaso email oculto). Não estender resultado a todos os campos configuráveis. Nenhum pedido ou chamada Google foi gerado. Snapshot de recuperação mantido somente no banco QA local. Matriz geral continua PARTIAL, especialmente PF/PJ/tracking completo e RACE com atrasos controlados de rede real.
## Acompanhamento e resposta antiga — 2026-10-11

Navegador local real listou 11 pedidos B2B do comprador A e abriu PED-20261011-000018: pending/Aguardando Aprovação, 5 unidades x R$20, subtotal/total R$100, frete a combinar. Nenhum novo pedido criado. Identificação visual da loja no tracking ainda usa nome legado do AppContext (MC Distribuição), apesar do catálogo QA; não é evidência de acesso a dados de outro tenant (consulta usa PUBLIC_TENANT_SLUG). Ajuste dessa identificação permanece pendente.

Revisão encontrou ausência de descarte de resposta antiga em loadB2bOrders. Remediação: identidade atual e geração de requisição guardam resultados/erros/loading; dados privados só são renderizados para a identidade que os carregou; mudança de identidade limpa seleção e cache. Teste React DOM real com fronteiras de Auth/rede sintéticas PASS: resposta A atrasada após troca para B não aparece, resposta B aparece, logout remove pedidos. Não declarar RACE com rede real PASS. Teste incluído em check. Cobertura PF/PJ e varejo por token continua pendente.
## Varejo PF/PJ e tracking por token — 2026-10-11

Quality #46 SUCCESS confirmado para b7dfbc939294a1d3c20aeafe99df7d83e4cbe6f2. Navegador QA: formulário PJ exibe CNPJ e razão social; trocar para PF exibe CPF e remove razão social. Dados fictícios válidos alcançaram revisão PF e PJ, itens 1 x R$30/total R$30, retirada e PIX; voltar/editar preservou dados. CTA de WhatsApp não acionado. Estes são subcasos de revisão, não entrega/envio E2E completo.

HTTP real local: pedido varejo 201 com token em order.trackingToken; tracking correto 200; mesmo token em outro tenant negado; token desconhecido negado; documento do comprador ausente da resposta de acompanhamento. Tokens nunca impressos/armazenados em relatório. Roteiro inicial acessou nível incorreto da resposta e falhou após criar um pedido; corrigido e repetido com sucesso. Dois pedidos fictícios criados nesta rodada; nenhum envio de mensagem ou chamada Google. Tracking varejo no navegador por recibo salvo ainda pendente; resultado HTTP não substitui esse subcaso.
## Dependência do percurso completo de varejo — 2026-10-11

VERIFIED: navegador real, aba Pedidos Recentes de Varejo (0) exibe orientação de recibos vinculados ao navegador e nenhum pedido selecionado. Leitura de CartDrawer confirma que storeRetailOrderTracking ocorre após submitOrderCheckout e antes de redirecionar prepWindow ao WhatsApp. O único CTA atual acopla criação/salvamento do recibo à abertura externa de wa.me com resumo de pedido. Nenhuma nova alteração de código ou pedido nesta etapa.

Para executar esse percurso sem alterar artificialmente storage/estado da aplicação, solicitar autorização específica de abertura do WhatsApp com resumo exclusivamente fictício (loja QA, produto fictício, quantidade e valores de teste), sem enviar mensagem. Inspeção de URL externa de pedido foi rejeitada pela revisão automática em etapa anterior por potencial divulgação do payload; não contornar o bloqueio. Nenhum CPF, CNPJ, endereço pessoal ou credencial deve integrar a URL de teste. Enquanto isso, tracking por token HTTP real e estado vazio UI são PASS separados; percurso com recibo salvo no navegador permanece pendente.
## Percurso real de varejo autorizado — 2026-10-11

Usuário autorizou explicitamente abrir WhatsApp com resumo exclusivamente fictício, sem envio e sem documento/endereço pessoal. Navegador local criou PED-20261011-000022 varejo, 1 unidade QA-A x R$30, PIX, retirada. Carrinho limpo após registro. Aba externa observada via metadados de URL: api.whatsapp.com e resumo do pedido, cliente fictício, item/quantidade/preço/total; sem documento, endereço pessoal, token ou PDF. Nenhum controle de envio foi acionado; envio/recebimento NÃO avaliados.

Após reload, Meus Pedidos > Pedidos Recentes de Varejo mostrou 1 pedido; seleção de PED-20261011-000022 exibiu Varejo/pending/Aguardando Aprovação, 1 x R$30, total R$30 e frete a combinar. Recibo salvo pelo próprio fluxo real, sem injeção de storage. Evidência visual privada qa-retail-tracking-success.png fora do Git. Clique inicial em Meus Pedidos imediatamente após checkout não produziu navegação observável; reload e novo clique funcionaram. Não alterar código por esse sintoma sem reprodução independente.

Fechado subcaso de criação PF + recibo salvo + tracking de varejo no navegador. PJ foi validado até revisão, não criação final. Matriz geral permanece PARTIAL para RACE com rede real, subcasos blocked/revogação na UI e cenários adicionais. Sem novas consultas Google, merge ou ativação de produção.

2026-10-11: cenário local com zero produtos atacadistas habilitados executado no navegador com comprador A aprovado. UI manteve autorização, exibiu produto somente varejo e bloqueou botão de compra atacadista. RACE-03 parcial: estado coerente verificado, ausência de loop de rede ainda não medida. Preparação inicial foi rejeitada por constraint sem alteração; fixture corrigida após leitura da regra. Produto restaurado no banco (enabled true, preço 20, mínimo 5). RACE-01/02/04 com atraso real continuam pendentes. Nenhuma chamada Google, mensagem ou produção.


2026-10-11: navegador + Auth/Edge real local, cenário adicional de logout durante catálogo. Cópia QA de get-wholesale-catalog atrasou resposta válida por 15s após autenticação/consulta reais, marcadores sem dados sensíveis QA_RACE_DELAY_STARTED/COMPLETED. Logout entre início/fim; após resposta, botão Entrar, varejo R, sem identidade/preço B2B antigo. PASS deste subcaso real. NÃO equivale a RACE-01 (status RPC atrasado), nem RACE-02 (troca A->B); continuam pendentes. Função QA restaurada byte a byte da cópia anterior; código versionado não recebeu atraso. Nenhuma chamada Google, pedido, WhatsApp ou produção nesta rodada.

## RACE-01/02 com rede local real — 2026-10-11

RACE-02 PASS no percurso A -> logout -> login B: get-wholesale-catalog QA atrasou resposta válida de A por 45 segundos após autenticação e consulta reais. Logs sanitizados mostram início 04:38:27.241 UTC e fim 04:39:12.250 UTC. B entrou antes do fim; menu confirmou approved-b fictício, catálogo da loja A permaneceu varejo R$30, sem identidade comercial ou preço privado de A. B é aprovado somente na loja B, sem autorização na loja A. Não equivale a troca direta de sessão sem logout, coberta apenas pelo teste de componente. Nenhum pedido criado.

RACE-01 PASS: RPC get_my_wholesale_status local preservou autenticação/RLS e atrasou RETURN v_result por 20 segundos via pg_sleep. pg_stat_activity confirmou uma consulta real em PgSleep antes do logout. Após logout e término do atraso: botão Entrar, varejo R$30, sem aprovação ou dados comerciais antigos. Definição original restaurada e igualdade pg_get_functiondef confirmada; nenhuma consulta atrasada remanescente. Função de catálogo também restaurada com hash idêntico ao backup. A instrumentação nunca entrou no código Git.

Nenhuma consulta Google ou interação WhatsApp nesta rodada; sem merge/deploy. RACE-03 continua parcial (ausência de loop ainda não medida) e RACE-04 ainda pendente no navegador. Cobertura geral B2B permanece PARTIAL. Evidências desta rodada são observações de UI e marcadores/estado do banco sanitizados, sem tokens.

2026-10-11: RACE-03 PASS na janela observada de 20 segundos: um POST get-wholesale-catalog com catálogo vazio, medido por marcador QA sanitizado; sem repetição. Produto e função restaurados. RACE-04 FAIL reproduzido: carrinho varejo 1 unidade/R, modal para atacado aberto; status do comprador fictício A mudou approved->suspended no banco local; confirmação limpou carrinho antes da consulta. Backend negou atacado e exibiu Acesso atacadista não aprovado; não houve vazamento de preços nem pedido, mas carrinho perdido e badge de aprovação antigo. Comprador restaurado approved. Correção necessária: revalidar aprovação no servidor antes de limpar carrinho/ativar modalidade, mantendo descarte por identidade/generation e fail-closed em erro. Não marcar matriz completa ou autorizar merge enquanto este caso falhar.


2026-10-11: RACE-04 corrigido: confirmação do modal agora aguarda refreshWholesaleStatus antes de clearCart/ativar atacado. Identidade/generation e trava contra confirmações duplicadas impedem confirmação antiga; cancelar/invalidation encerra tentativa. Suspensão/erro mantêm carrinho varejo. Regressão React DOM adicionada: confirmação consultou servidor e recebeu suspended, sem limpeza; suíte 8/8 PASS. Reteste navegador/SQL real: modal com item R, revogação local, confirmar => modal fechado, varejo, carrinho 1/R preservado e aviso; usuário restaurado approved. Isso fecha subcaso de revogação RACE-04, sem prometer eliminar TOCTOU entre consulta e mudança posterior; catálogo/checkout seguem validando no backend. Nenhum pedido/Google/WhatsApp/produção nesta rodada.


---

## Retomada 2026-10-14 — nome canônico e pré-flight de release

- **Escopo:** revisão somente leitura do estado GitHub/Supabase Hosted e correção mínima do cabeçalho visual em `CustomerOrderTrackingView`: antes mostrava `currentTenant.name` do `AppContext` legado, apesar de consultar pedidos pelo slug canônico `PUBLIC_TENANT_SLUG`. Agora busca `fetchTenantPublicSettings(PUBLIC_TENANT_SLUG)` e apresenta `publicName` oficial; erro usa rótulo neutro `sua loja` (sem nome de tenant antigo). Resposta descartada após desmontagem do componente. Teste React DOM cobre marca canônica e ausência de nome legado.
- **GitHub:** correção em `d7b8ac3` e teste em `7020c99`, branch `qa/b2b-checkout-e2e-readiness-20261008`; Quality #53 / run `38654073837` **SUCCESS** no commit `7020c992eee261746ef000e0bd1021ed696c26f1`, incluindo `bun run check`, 8 testes React DOM wholesale, scanner de segredo e `Tracking React DOM PASS: canonical tenant display...`. Commits documentais subsequentes têm checks próprios.
- **Hosted somente leitura:** 18 migrations, última `20261009020000`; 8 Edge Functions ACTIVE; 6 pedidos intactos; somente Supabase branch `main`; configuração atual de métodos `retirada, entrega, uber, transportadora, outro` compatível com migration 000019. Tabelas privadas de entrega e Google ainda inexistentes no Hosted; nenhuma escrita ou deploy.
- **Achado de segurança:** `wholesale_tiers` concede SELECT a anon e possui política pública apesar de RLS ligada. A tabela tem **0 linhas atualmente**; não se constatou exposição efetiva de registros existentes, mas a configuração permite leitura pública se faixas forem cadastradas. Migration 000020 prepara correção; **não aplicada em Hosted**. Registrar risco no SECURITY_REGISTER e priorizar correção no release.
- **Release gate:** `docs/qa/PR6_RELEASE_GATE_20261014.md` descreve homologação B2B residual, sequência forward-only de migrations e publicação. PR #6 continua aberto; main/Cloudflare não alterado. Google Routes permanece sem ativação em produção, com riscos financeiros/abuso e credencial sem restrição IP registrados; jamais deduzir autorização de ativação de ensaios QA.
- **Bloqueios remanescentes:** execução integral/evidências dos subcasos B2B do roteiro e aprovação de produção; decisões de segurança/limite financeiro do Google; formalização dos critérios funcionais dos Itens 5 e 6. Uma aprovação genérica para continuar desenvolvimento não é aprovação de custo ou alteração irreversível de Hosted.


## Aplicação autorizada no Hosted — migrations 000019 e 000020 (2026-10-14)

- **Autorização expressa recebida:** usuário autorizou especificamente aplicar 000019 e 000020 no Supabase produção `vlpwtdqqnecdvccxyodp`. Sem autorização de Google Routes, merge do PR ou alterações adicionais de produção.
- **Pré-flight read-only:** projeto `Corsys_Catalogo` ACTIVE_HEALTHY, Postgres 17; histórico 000001–000018; 6 pedidos, 520 produtos, 1 tenant e 1 configuração de checkout. Valores existentes de `delivery_methods` compatíveis com a allowlist proposta; funções privadas de autorização presentes. Advisor anterior: somente aviso preexistente `auth_leaked_password_protection`.
- **EXECUTADO / SUCCESS:** SQL byte a byte de `supabase/migrations/20261009030000_000019_delivery_settings.sql` (`sha` GitHub blob `412148bb4988cd3e583cbe9a27780a5ff7e8cbdb`) via `apply_migration` `000019_delivery_settings`. Criada `public.tenant_delivery_settings`, linha padrão para o tenant e RPC de salvamento com RLS. Verificação: `delivery_rows=1`, `anon_delivery_select=false`, `delivery_policies=3`, `enabled_google_rows=0`; pedidos e produtos intactos.
- **EXECUTADO / SUCCESS:** SQL byte a byte de `supabase/migrations/20261010000000_000020_product_rls_and_private_wholesale_tiers.sql` (`sha` GitHub blob `8c3adbed2387b9e60af235522dd3852f81d4be16`) via `apply_migration` `000020_product_rls_and_private_wholesale_tiers`. Verificação: `anon_wholesale_select=false`, `public_tiers_policies=0`, `tenant_tiers_policies=1`, `products_tenant_policies=1`; RLS habilitada em products/wholesale_tiers/delivery; 6 pedidos, 520 produtos, 1 loja, 1 configuração, 0 faixas B2B preservados.
- **Histórico — DRIFT DE VERSIONAMENTO PENDENTE:** `apply_migration` atribuiu versões automáticas `20261014233626` a 000019 e `20261014233650` a 000020. Arquivos de Git são `20261009030000` (000019) e `20261010000000` (000020). **Os SQLs estão aplicados**, mas o registro de versão difere. **NÃO atualizar `supabase_migrations.schema_migrations` sem autorização específica**, como no precedente 000018. O arquivo original e as versões 000001–000018 permanecem intactos.
- **Advisors de segurança pós-operação:** nenhum achado novo, somente `Leaked Password Protection Disabled` anterior. [Remediação oficial](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) fora do escopo.
- **Não executado:** SQL das migrations Google, Edge Function `estimate-delivery`, alteração de secrets/flag Google, merge, Cloudflare build/deploy ou testes com pedidos comerciais. Teste RLS HTTP autenticado de papéis em produção NOT EVALUATED; políticas e grants verificados por consultas do catálogo.
- **Próximo bloqueio:** obter aprovação específica para alinhar **somente metadados de versão** de 000019/000020 (depois confirmar unicidade/dados, sem editar schema) e seguir gates do PR #6. Nenhuma outra mudança Hosted é parte da autorização recebida.


## Alinhamento autorizado do histórico — 2026-10-14

- Usuário autorizou especificamente corrigir as versões de 000019 e 000020 no histórico de migrations de produção.
- Operação SQL transacional com pré-condições estritas e verificação de exatamente duas linhas: `000019_delivery_settings` de `20261014233626` para `20261009030000`; `000020_product_rls_and_private_wholesale_tiers` de `20261014233650` para `20261010000000`.
- Verificação pós-commit em `supabase_migrations.schema_migrations` e `list_migrations`: 20 migrations, duas versões finais corretas, zero versões antigas, sem colisões; seis pedidos e 520 produtos preservados, uma configuração privada de entrega preservada e `anon` sem SELECT em `wholesale_tiers`.
- Somente campo `version` dessas duas entradas alterado; nenhum schema, função, política comercial ou dado de negócio modificado nesta operação. Sem merge, deploy ou ativação Google Routes.


## Continuidade QA B2B e pré-release PR #6 — 2026-10-14

- **Autorizado pelo usuário:** continuar a homologação B2B e preparar publicação da PR #6. **Não** autorizado nesta etapa: merge, deploy Cloudflare/Edge Function, novas migrations Hosted, Google Routes pago ou segredos. PR #6 segue OPEN.
- **Código de teste:** seis novos cenários em `scripts/test-wholesale-context.mjs` — status pending/suspended/rejected, revalidação com erro sem perder carrinho, confirmação dupla sem duplo submit/reset e revogação de catálogo carregado. [Quality #59](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38656900813) SUCCESS em `de6109d`, log mostra **14 PASS / 0 FAIL** em React DOM com fronteiras Auth/rede sintéticas.
- **Flag explícita de UI paga default-off:** `src/components/storefront/CartDrawer.tsx` exige `import.meta.env.VITE_GOOGLE_ROUTES_UI_ENABLED === 'true'` para renderizar o cálculo; `src/components/tenantadmin/DeliverySettings.tsx` desabilita o checkbox de ativação quando a flag não é `true`. Verificações correspondentes em `scripts/test-google-routing.ts`. A flag Vite é pública e não protege segredo; a Edge exige separadamente `GOOGLE_ROUTES_ENABLED` e reservas server-side. [Quality #62](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38657056819) SUCCESS em `a44e7a6` na primeira revisão da flag. Validar Quality do HEAD que inclui também a desabilitação no painel e documentação.
- **Hosted read-only nesta rodada:** 20 migrations com 000019/000020 alinhadas, 6 pedidos/520 produtos preservados; 1 config privada de entrega com `estimateEnabled=false`; `anon` sem SELECT em `wholesale_tiers`, zero policy pública; 8 Edge Functions, sem `estimate-delivery`; tabelas Google de cota/rajada ausentes. **Nenhuma escrita** ao Hosted neste turno.
- **Aceite documental:** `docs/qa/CHECKOUT_B2B_E2E_VALIDATION.md` agora apresenta matriz reconciliada caso a caso com limites reais; `docs/qa/PR6_RELEASE_GATE_20261014.md` foi atualizado para não propor reaplicação de 19/20 e para impedir `db push` indiscriminado de migrations Google. Arquitetura/contexto/registro de segurança/ADR 014 atualizados. Não alterar os registros históricos que explicam testes anteriores.
- **Limitação desta rodada:** sem navegador local apontado a Supabase QA isolado e sem credenciais de identidades Auth fictícias no runtime atual, portanto **nenhum E2E navegador novo**. Evidência anterior de outubro 10/11 permanece válida para a revisão que foi testada, não comprova a revisão de código 14/10.
- **Próximos gates:** concluir B2B-02 suspended/blocked, B2B-06/07 campos restantes, B2B-11 handoff externo autorizado sem envio, B2B-12 fluxo multiusuário e B2B-13 PJ/tracking/filtros no QA local. Após os testes, revisar PR #6 e pedir autorização específica de merge/publicação Cloudflare; não ativar Google até análise própria de segurança/custos e aprovação explícita. Issue #4 permanece aberta.


## Continuação autorizada da homologação E2E — 2026-10-14/15

- Usuário autorizou explicitamente **concluir os testes de navegador** e submeter PR #6 a aprovação específica somente após conclusão. Nenhum merge/deploy foi autorizado. Google Routes segue sem aprovação de segurança/custos e desativado.
- **Limitação de execução VERIFICADA:** runtime atual dispõe de Python Playwright e Chromium, mas **não possui** checkout Git do projeto, Supabase CLI, Docker/runtime Supabase QA isolado, fixtures Auth fictícias da estação Windows/WSL 10–11/10; egress container não resolve github.com. Conector GitHub possibilita ler/gravar fonte, e conector Supabase aponta ao Hosted produção (que não deve receber fixtures/pedidos de teste). Assim, os cenários B2B que exigem browser+Auth/Edge real **não foram executados novamente** nesta sessão. Estado de aceite: **BLOCKED / PARTIAL**, nunca PASS.
- **Entregue na branch QA:** script independente `scripts/qa-browser/test_b2b_access_browser.py` que executa Chrome/Playwright contra **somente** URLs loopback (`QA_BASE_URL` e `QA_SUPABASE_URL`), com identidades QA pending/suspended/rejected preexistentes, interações reais de login e status RPC, verificação de ausência de request ao catálogo privado, e bloqueio preventivo de egress HTTP(S) externo. Sem criação de pedido/WhatsApp/dados de produção. Requer Python Playwright e ambiente QA anterior em funcionamento; não configura/contrata backend externo.
- **Pipeline CI:** passo `python3 -m py_compile scripts/qa-browser/test_b2b_access_browser.py` adicionado ao workflow Quality, para detectar erros de sintaxe **sem executar navegador**. A execução real depende da máquina QA e fixtures privadas; não inserir credenciais em CI.
- **Documentação:** `docs/qa/CHECKOUT_B2B_E2E_VALIDATION.md` seção 7 registra modo de execução e estados esperados. Continuam pendentes B2B-02 navegador com contas suspensa/rejeitada, B2B-06/07 cobertura integral de campos, B2B-11 observação externa sem enviar, B2B-12 troca final de usuário e B2B-13 PJ/tracking/filtros. Evidências anteriores de 10–11/10 e CI React DOM de 14/10 são preservadas, porém não transferíveis ao HEAD E2E atual sem reteste.
- **Release gate:** PR #6 segue aberto, sem merge, Cloudflare e Hosted preservados. As migrations 19/20 já foram autorizadas/aplicadas/alinhadas; não reaplicar nem executar as Google. Solicitação de publicação apenas após execução efetiva da matriz contra QA isolada e aprovação específica.


## Continuação da homologação browser — 2026-10-14 (sessão subsequente)

- **Objetivo autorizado:** continuar a QA do PR #6, sem merge/Cloudflare deploy, sem mudanças no Supabase produção nem ativação do Google Routes.
- **Pré-flight local desta sessão:** diretório de trabalho contém templates do projeto, **não** o checkout GitHub; não existem processos em `127.0.0.1:3000` / `5173` / `54321`. `git` e Chromium 144/Playwright Python estão instalados; `bun` e Docker ausentes. Chrome inicia, mas falhou em `Page.goto(data:)` e em `Page.goto(http://127.0.0.1:porta)` com `net::ERR_BLOCKED_BY_ADMINISTRATOR`. Não contornar política do navegador. Conector Supabase possui somente branch Hosted main, sem Preview dedicado. **NENHUM teste de UI autenticada do PR foi executado neste runtime.**
- **Novo roteiro em branch QA:** `scripts/qa-browser/test_retail_identity_browser.py` para validar alternância PF→PJ→PF, inputs CPF/CNPJ/razão social com produto fictício de QA, sem invocar `submit-order-checkout`, consultar catálogo B2B privado, navegar ao WhatsApp ou criar pedidos. Depende de frontend/backend local isolados e fixture varejo habilitada. Resultado de execução browser = **BLOCKED**, não PASS.
- **Runner B2B anterior endurecido:** `scripts/qa-browser/test_b2b_access_browser.py` verifica que URLs `QA_BASE_URL`/`QA_SUPABASE_URL` são origens HTTP(S) loopback explícitas, sem path, query, credenciais ou fragmento; roteamento aborta HTTP(S) para qualquer origem diferente do par autorizado, e observa RPC de status no backend QA configurado. O runner varejo reutiliza exatamente esse guard.
- **CI:** `.github/workflows/quality.yml` agora sintaticamente compila os dois scripts Python com `py_compile` no Verify, além de `bun run check` existente. **Isso não executa Chromium/QA E2E**; registrar conclusão por run/HEAD específico depois da última atualização.
- **Pendente:** B2B-02 com estados negados no navegador QA local e restantes B2B-06/07/11/12/13; retomar a estação Windows/WSL com Supabase local e identidades fictícias. Checar browser sem política administrativa de bloqueio; nenhuma credencial/fixture deve ser publicada. Release gate segue **PARTIAL/BLOCKED**, PR #6 OPEN, sem permissão de merge.



## QA browser — seleção incremental e testes de preflight (2026-10-14)

- Autorização permanece para **continuar a homologação**, não para merge/deploy. Nenhuma alteração executada no Supabase Hosted ou Cloudflare; Google Routes permanece desligado.
- Conector GitHub confirmou PR #6 OPEN. Nesta sessão container não contém checkout local do repositório nem serviços Supabase QA nas portas 3000/5173/54321. Chromium disponível, mas navegação `data:` foi bloqueada por `ERR_BLOCKED_BY_ADMINISTRATOR`; portanto **NENHUM caso E2E de navegador autenticado foi executado**.
- Runner `scripts/qa-browser/test_b2b_access_browser.py`: agora `QA_B2B_CASES` permite executar somente `anon` (sem fixture/senha) ou subconjunto explícito de `pending,suspended,rejected`; padrão continua completo, ausências/duplicatas/valores inválidos falham fechado. Estados não selecionados não recebem PASS.
- Segurança dos runners: `service_workers="block"` protege a interceptação HTTP de Service Workers; interceptação WebSocket via Playwright >=1.48 impede conexão direta fora de dois endpoints QA loopback explicitamente configurados. Trata-se de defesa de teste, **não de isolamento de rede garantido**, especialmente devido ao tratamento de redirects; executar somente em QA isolada de produção.
- Novo teste `scripts/qa-browser/test_browser_preflight.py` com Python unittest e objetos sintéticos, sem browser/credenciais/rede, cobre seleção, URL preflight e bloqueio HTTP/WebSocket. Workflow `Quality` agora roda `py_compile` e `unittest discover` além de `bun run check`. Verificar resultado do CI **do HEAD final** antes de afirmar PASS.
- Roteiro e limitações detalhados em `docs/qa/CHECKOUT_B2B_E2E_VALIDATION.md` §9. Ainda faltam os cenários navegador B2B-02 bloqueado/suspenso, B2B-06/07, B2B-11, B2B-12, B2B-13, com autenticação e persistência reais **somente na estação QA Windows/WSL local anterior**.


## Homologação incremental de campos e comprador PF/PJ — 2026-10-14

- Escopo autorizado: continuar QA do PR #6, **sem merge/deploy**, Google Routes desativado e sem escrita em Hosted.
- Estado inicial: PR #6 OPEN no head `3d059fcc...`, CI [#98](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38670839064) retornou **SUCCESS** após runner React DOM experimental removido; CI #95 prolongado foi cancelado. Nenhum E2E autenticado de navegador executado nesta sessão.
- Revisão de checkout: `CartDrawer.tsx` mantinha `companyName` (razão social PJ) e o erro correspondente ao mudar para PF. Corrigido no handler PJ→PF: limpa razão social guardada e `errors.companyName`, além de documento incompatível já corrigido na rodada anterior. Troca PF→PJ continua descartando CPF anterior. O restante do formulário é mantido. Teste de wiring `81s` atualizado em `scripts/test-orders-frontend-integration-points.ts`.
- CI [#100](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38671302884) **SUCCESS** com correção de razão social. Ampliada a suíte pura `scripts/test-checkout-fields.ts`: 40 validações da matriz de ocultação/obrigatoriedade cobrindo 10 campos opcionais e modalidades varejo PJ e atacado; `fieldApplies` separa companyName de B2B. CI [#101](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38671426663) **SUCCESS**, logs: 40 checks PASS, Wholesale React DOM 14/14 PASS, Python browser preflight 5/5 PASS.
- Limitação explícita: estas verificações não constituem navegador autenticado, nem avaliam visualmente todos os campos, persistência do pedido PJ, tracking, WhatsApp, RLS no browser ou troca de identidades. Matriz E2E B2B-01–13 permanece **PARTIAL/BLOCKED** até executar na estação Windows/WSL com Supabase local. O teste React DOM experimental foi removido sem resultado conclusivo e não deve aparecer como PASS.
- Evidência ampliada está em `docs/qa/CHECKOUT_B2B_E2E_VALIDATION.md` §10. Esperar CI no HEAD final documental antes de promover qualquer aprovação de release; release continua NÃO AUTORIZADO.


## Revisão de segurança do recibo de checkout — 2026-10-14

- Escopo autorizado: continuar homologação e preparar PR #6; **sem merge, deploy, escritas Hosted ou ativação Google**. PR aberto, Quality #103 PASS na revisão anterior.
- **Achado de revisão no checkout:** ao fechar a aba de WhatsApp após confirmação no banco, o estado `createdOrder` era reutilizado sem verificar se itens, comprador, contato ou entrega haviam mudado desde a confirmação. Não houve reprodução em navegador/produção, mas o ramo é alcançável pelo código.
- **Mudança mínima na branch QA:** `src/components/storefront/CartDrawer.tsx` calcula `computeOrderFingerprint(draft, user?.id || 'anonymous')` da mesma lógica canônica do serviço, guarda o SHA-256 apenas na memória quando o popup fecha após receipt e recusa reutilização do recibo se novo hash diferir. `resetCheckoutLifecycle` descarta o hash. Nenhuma PII nova persistida.
- **Testes:** `scripts/test-orders-frontend-integration-points.ts` adiciona assert `67c` sobre vínculo/hash/reset; `scripts/test-checkout-fields.ts` testa fingerprint alterado por endereço, pagamento, contato e modalidade, além dos testes anteriores de usuário, tenant e itens. [Quality #107](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38672256780) **SUCCESS** no commit `3be9b2446b245e6cbb8e83df099666efcedf3cf8`; log mostra `67c`, `Checkout receipt fingerprint...PASS`, 40 regras de formulário, B2B DOM 14/14 e Python preflight 5/5.
- **Aguardando QA browser:** popup realmente bloqueado/fechado, retry mesmo draft, mudança de draft, troca de usuário durante await e B2B-02/06/07/11/12/13. Todos **NOT EVALUATED** no navegador autenticado atual. Release continua bloqueado. A mudança de sessão durante request é um cenário específico a investigar, não coberto só pelo fingerprint na segunda tentativa.


## Tentativa de execução E2E autenticado — 2026-10-14

- Solicitação explícita: **executar** navegador real com Supabase local para popup WhatsApp fechado/reabertura, alteração do draft, troca de usuário durante request e outros B2B pendentes; não inferir autorização de produção.
- Verificação direta nesta sessão: nenhum checkout de repositório, bun/docker/supabase CLI ou stack local nas portas 3000/5173/54321/54322. Python Playwright e Chromium presentes, mas navegação real para `data:text/html` negada pelo navegador com `ERR_BLOCKED_BY_ADMINISTRATOR`. **Resultado E2E desta sessão: BLOCKED; nenhum pedido gerado ou API produtiva consultada**.
- Mudança QA mínima: `scripts/qa-browser/test_retail_identity_browser.py` reforçado para preencher CNPJ/razão social fictícios e CPF, alternar buyer type e exigir campos vazios sem ressurreição. [Quality #111](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38672959324) SUCCESS no commit `05ac5b59`. Passou o pipeline de build/testes existentes e sintaxe Python, **não o navegador**.
- Tentativa de adicionar runner próprio do popup WhatsApp não foi efetivada; não referenciar arquivo inexistente. Restam cenários browser popup, retry, troca de identidade durante request, filtros/tracking PJ e B2B-02/06/07/11/12/13. A estação Windows/WSL isolada de 10–11/10, com fixtures Auth/Edge locais, é pré-requisito operacional.
- Escopo preservado: PR #6 OPEN, main sem merge, sem Cloudflare deploy, Google Routes desativado e Supabase produção sem novos testes/dados.


## Marco CI com navegador real e isolamento multi-tenant — 2026-10-15

- Autorizações vigentes: usuário permitiu continuar QA e pediu resolver bloqueios autonomamente; **não há autorização de merge, deploy ou ativação Google Routes**, nem de tocar em produção com dados fictícios.
- **Implementado** workflow `.github/workflows/qa-isolated.yml` ativado para PR #6, job Docker local; preparação `scripts/qa-browser/prepare_isolated_stack.py` substitui 000002/000003 somente na cópia efêmera e adiciona SQL fictício pós-000020, removendo migrations Google apenas no runner. `seed_isolated_stack.mjs` cria Auth fictícios respeitando grants colunares da tabela wholesale_customers. Sem Hosted secrets ou link.
- **QA browser real comprovada:** [Isolated Browser QA #10](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38676386325) SUCCESS. Seis cenários de acesso (`anon,pending,suspended,rejected,approved_a,approved_b`) em Chromium com Supabase local/Auth/Edge. A aprovado visualizou atacado com preço R$20; usuário B não obteve atacado no tenant A. PF/PJ alternância sem CPF/CNPJ/razão social obsoletos PASS no navegador. Relatório em `docs/qa/CHECKOUT_B2B_E2E_VALIDATION.md` §13.
- **Race-guard em branch:** `CartDrawer` compara identidade atual de tenant/comprador no início e após a chamada de checkout antes de hidratar recibo; troca de identidade limpa formulário/receipt/PII em memória. Teste estrutural `67d`; Quality #127 SUCCESS. Validar resultado de Isolated Browser QA #12 no head desse código. **Não declarar corrida de sessão durante submissão como E2E PASS**: casos read-only do workflow não acionam submit.
- **Restante impeditivo:** popup fechado/retry com uma única linha de pedido fictício, eventual troca de comprador durante request de checkout, campos ocultos/obrigatórios completos no navegador, finalização PJ e tracking/filtros ainda exigem provas. Tentativa de introduzir runner automatizado de criação de pedido local foi bloqueada pelas configurações de segurança do conector; não criado. Este impeditivo não justifica regressar ao acesso Hosted. PR #6 continua OPEN, sem merge/deploy, Google desativado.


## Checkout transacional e WhatsApp: gate destravado na QA isolada — 2026-10-15

- **Resultado validado:** [Quality #152](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38831184718) SUCCESS e [Isolated Browser QA #37](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38831184711) SUCCESS no `c62c65bb8ecff269f807224cfd7f3ec24114a13d`. Chromium + Supabase local descartável: 6 cenários B2B, PF/PJ, campos ocultos/obrigatórios, pedido fictício PJ varejo HTTP 201, retry após popup fechado sem segundo POST, draft alterado recusado, draft original gerou link `wa.me` verificado somente em memória, **0 mensagens enviadas**; DB local confirmou exatamente 1 pedido correto e hash de rastreamento.
- **Falhas anteriores resolvidas com mínimo privilégio:** receipt assinado devolvido pelo backend tinha URL incompatível com validação do browser, normalizada em `submit-order-checkout/index.ts` para origem oficial Supabase e prefixo Storage privado; a ausência opcional de documento não invalida o pedido. A auditoria via `service_role`/PostgREST do `orders` foi negada com `42501` (segurança válida), portanto migrada para `scripts/qa-browser/assert_local_order.sh` com `docker exec psql` **somente na instância QA CI**. Nenhuma política RLS ou GRANT modificada. O antigo `assert_local_order.mjs` está sem uso no workflow.
- **Limites de evidência:** `window.open` é substituído no teste para fechar popup ou interceptar em memória URL `wa.me`, sem chamar WhatsApp nem enviar texto; prova geração segura do handoff, **não entrega na rede WhatsApp**. `documentUrl` ausente no recibo local dessa bateria: geração/recuperação de PDF ainda não verificada ponta a ponta.
- **Pendências objetivas para aprovação do PR #6:** sessão/Auth trocada durante request in-flight de checkout; submissão e listagem de pedido B2B; tracking/filtros real de PJ; PDF quando aplicável; revisão final do diff e release sem Google. PR OPEN, sem merge, Cloudflare deploy, Hosted write ou ativação Google. Para homologar cenários restantes, continuar usando stack disposable do workflow `qa-isolated.yml`, nunca Hosted.

## Continuidade técnica — 15/10/2026, B2B integrado e gate de release

- **Escopo/autorização:** continuação de QA do PR #6. Sem merge, deploy Cloudflare, migrations Hosted, Google Routes em produção ou dados reais de teste. Todo pedido novo desta rodada pertenceu ao Supabase local descartável do GitHub Actions.
- **Implementação de testes:** `scripts/qa-browser/test_wholesale_transaction_browser.py` percorre login approved A, catálogo privado, pedido atacadista de cinco unidades, recibo HTTP 201 (R$ 20/un; R$ 100 total; pending), popup neutro fechado/retry sem segunda submissão, acompanhamento B2B e separação visual da aba varejo. O workflow `.github/workflows/qa-isolated.yml` executa o teste depois do checkout varejo, seguido de `scripts/qa-browser/assert_local_wholesale_order.mjs` para auditoria independente. `.github/workflows/quality.yml` compila o novo Python.
- **Evidência integrada real:** [Isolated Browser QA #43](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38835312029) executou Auth/Edge/Chromium/Postgres descartável; B2B HTTP 201 e recibo canônico, retry sem duplicação, tracking HTTP 200, pedido visível no histórico de atacado e oculto no varejo, sem destinos externos inesperados, com mensagens WhatsApp não enviadas: PASS **nesses critérios específicos**. O workflow global terminou FAIL na etapa independente seguinte: `Expected exactly two local orders` (pode ser erro de consulta ou contagem; não inferir causa).
- **Diagnóstico:** mudança posterior à revisão #43 adicionou no auditor `assert_local_wholesale_order.mjs` log restrito a `db_error_code` e `result_count` para separar erro de consulta de erro de integridade. Nova execução [Isolated Browser QA](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38835842365) iniciada; seu resultado deve ser conferido antes de promover o gate. Testes sem execução final não recebem PASS.
- **Quality:** Quality da revisão `9c30d80` PASS; commits subsequentes necessitam evidência de Quality específica.
- **Hosted read-only (15/10):** 20 migrations, incluindo 000019/000020; 6 pedidos, 520 produtos, 0 faixas atacado; RLS de `wholesale_tiers` ativa, `anon SELECT=false`, política `wholesale_tiers_select_public` ausente. Oito Edge Functions ativas; nenhuma `estimate-delivery`. Security Advisor: alerta preexistente `auth_leaked_password_protection` desativada. A [Issue #7](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/issues/7) foi atualizada com as evidências atuais e permanece aberta por aceite funcional pendente.
- **Próximos gates:** resolver auditoria local de duas transações; concluir sessão concorrente durante checkout, PDF local e matriz B2B restante; registrar evidência por HEAD; revisar diff, rollback/forward-fix e pedir autorização específica de merge/publicação. Google segue explicitamente desligado.

## Homologação integrada B2B — 16/10/2026

- **VERIFIED / PASS para o commit `f540b7387952fbe62f43bd26845789241eabca8e`:** [Isolated Browser QA #52](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38967546293) SUCCESS, com Auth/Edge Functions/Chromium reais e PostgreSQL descartável no CI; [Quality #167](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38967546403) SUCCESS. O SHA é do último commit de código verificado nesta bateria; qualquer alteração posterior exige distinguir nova revisão de resultados anteriores.
- **Diagnóstico concluído:** [QA #49](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38836083657) mostrou erro `42501`, não divergência na contagem de pedidos, porque `scripts/qa-browser/assert_local_wholesale_order.mjs` tentava `SELECT` em `orders` via PostgREST/`service_role` sem concessão SQL. Este bloqueio corresponde à política restritiva já adotada; nenhuma RLS ou GRANT deve ser ampliada para satisfazer auditoria.
- **Correção mínima:** substituído o auditor JavaScript pelo `scripts/qa-browser/assert_local_wholesale_order.sh`, que usa `docker exec psql` somente no banco da QA descartável. Preflight fail-closed exige GitHub Actions, flags de fixture, `QA_SUPABASE_URL=http://127.0.0.1:54321`, ausência de tokens Hosted e exatamente um container `supabase_db_*`. Arquivo antigo removido; workflow atualizado. Consultas não incluem PII nem identificadores individuais nos logs.
- **Matriz coberta nesta execução:** seis estados de acesso B2B (anônimo, pendente, suspenso, rejeitado, aprovado A e aprovado B), alternância PF/PJ, campos configurados, um pedido PJ varejo confirmado, popup WhatsApp fechado/retry/rascunho modificado recusado, pedido B2B HTTP 201 com 5 unidades a R$20 e total autoritativo de R$100, reabertura do popup sem segunda submissão, listagem B2B HTTP 200, pedido presente na aba Atacado e ausente na aba Varejo. Auditoria SQL isolada confirmou **exatamente 2 pedidos**, um varejo/um atacado no tenant A, ambos pendentes, atacado ligado a comprador aprovado, nenhum pedido no tenant B. **Nenhuma mensagem WhatsApp externa enviada.**
- **Status do gate:** estes cenários passaram no runtime local/CI, mas **PR #6 permanece BLOCKED para merge/release**. Ainda não houve E2E determinístico de troca de identidade enquanto `submit-order-checkout` está in-flight, validação de PDF privado no runtime QA, cobertura integral de ocultação/persistência dos demais campos e auditoria final do diff/autorizações. Não converter testes isolados ou observações de UI em aceite total da matriz B2B-01–13.
- **Produção preservada:** PR não integrado à main; sem Cloudflare deploy, migrations Hosted, criação de pedidos de produção ou ativação Google Routes. Migrations Hosted 000019/000020 já aplicadas e congeladas; não reaplicar. O aviso preexistente de leaked password protection permanece separado deste gate.

## Continuação — 16/10/2026: corrida de sessão em checkout

- Implementado teste de navegador em `scripts/qa-browser/test_checkout_session_race_browser.py`: pedido B2B autenticado passa por Edge HTTP 201 real em Supabase descartável; resposta é deliberadamente retida em `fetch` no browser, logout real ocorre em segunda aba compartilhando Auth, só então entrega-se a resposta à UI. Asserções exigem ausência de recibo obsoleto, preço/estado B2B aprovado, segundo POST e navegação externa. `scripts/qa-browser/assert_local_checkout_race.sh` verifica no Postgres local três pedidos fictícios esperados (1 varejo + 2 atacado), todos pertencentes ao tenant A, atacado vinculado a comprador aprovado. Ambos integrados a `.github/workflows/qa-isolated.yml` e novo Python compilado na pipeline Quality.
- **VALIDAÇÃO PENDENTE / BLOQUEADO:** [Quality #173](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38969502648) e [Isolated Browser QA #58](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38969502661) tiveram conclusão `failure`, inclusive após tentativa de rerun; GitHub API retornou jobs sem `steps` e download de logs como `404 BlobNotFound`. A origem do erro **não foi determinada**. Não marcar o teste de corrida como PASS, nem atribuir falha de segurança ao software sem evidência.
- O HEAD de código desta rodada é `2bb3b6fbc69a4a209ea3a20a605103bc8982512a`, anterior a este registro documental. A última bateria integrada **aprovada** continua sendo [QA #52](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38967546293) em `f540b738` (checkout B2B, tracking, auditoria SQL de dois pedidos). A verificação da corrida não recebeu aceite.
- **Progresso incremental 16/10 (HEAD a047e967):** teste de race reforçado em `8a5503e` para aguardar a UI processar a resposta atrasada e verificar ausência de dados do comprador/recibo; em `a047e967`, checkout B2B valida URL assinada local, bytes de PDF e nega acesso público quando `documentUrl` é emitido. Se o documento estiver ausente, registra explicitamente `NOT EVALUATED` (sem expor URL/token em log). Sem alteração na aplicação, Edge, RLS, banco ou produção.
- **CI desta revisão:** [Quality #174](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38972282184) e [Isolated Browser QA #59](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38972282022) terminaram em failure com **zero steps**, incluindo ausência de `Set up job`; consulta de steps ao job PASS anterior #52 retorna 22 steps. Novos testes não chegaram a executar. Causa exata de infraestrutura/conta ainda INDETERMINADA; não remover o gate nem repetir testes sem informação nova. GitHub Status geral de 16/10 não informa incidente global; verificar permissões/billing/runner ou encaminhar run IDs ao GitHub Support.
- **PDF privado:** inspecionado `submit-order-checkout/index.ts`, que gera `generateOrderPdf`, tenta salvar em `order-documents` privado e assinar URL; recibo local da QA #52 tinha `documentUrl=null`. PDF end-to-end continua NOT EVALUATED até runtime local emitir documento válido. Não ampliar acesso Storage sem diagnóstico e teste isolado.
- Escopo preservado: sem merge, deploy, escrita em Hosted, ativação Google ou envio de mensagens. Próxima ação: recuperar detalhes do CI ou executar o teste na infraestrutura descartável, corrigir somente falha reproduzida e inspecionar Storage/PDF em runtime antes de pedir aprovação de release.

## Checkpoint atual — 16/10/2026: PDF privado e checkout concorrente aprovados em QA

- **Código validado SHA `9e412dd6`:** [Quality SUCCESS](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38974680072) e [Isolated Browser QA SUCCESS](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38974679950). GitHub Actions runner recuperado. Apenas Supabase local descartável; nenhuma escrita Hosted, nenhum deploy.
- **Corrida in-flight PASS:** Edge HTTP 201 registrado sob comprador autorizado, logout real em segunda aba antes da entrega da resposta, nenhum recibo/PII obsoleto, sem segundo envio; auditoria SQL local confirmou 3 pedidos sintéticos (1 varejo + 2 B2B) no tenant A e total canônico.
- **PDF privado PASS:** storage `order-documents` privado com 2 PDFs persistidos; URL assinada acessível (HTTP 200, bytes `%PDF-`), URL pública sem token negada. Diagnóstico limitado a contagens, sem expor signed URLs ou PII. Anteriormente os objetos eram gravados mas a origem interna Docker impedia exposição da URL ao navegador.
- **Correção:** `submit-order-checkout/index.ts` agora usa `PUBLIC_SUPABASE_URL` opcional **server-side**, somente em QA loopback nesta rodada, validando HTTPS/127.0.0.1, caminho exato do objeto e token. Hosted mantém `SUPABASE_URL` padrão. Registrado em `docs/CURRENT_ARCHITECTURE.md` e gate do PR #6.
- **Próximo passo:** revisar diff/release checklist e fechar subcasos restantes da matriz B2B-01–13; **PR #6 continua OPEN/BLOCKED para merge e Cloudflare deploy**, exigindo autorização separada. Google Routes desativado. Evidências anteriores de `NOT EVALUATED` foram superadas **apenas** para os cenários comprovados aqui.

## Checkpoint incremental — 16/10/2026: revisão PR6, matriz B2B, replay de autorização

- **PR #6 OPEN, sem merge/deploy/Hosted write:** diff completo auditado por arquivo e superfície crítica; 71 arquivos na baseline, ampliados nesta rodada. Registro de liberação/rollback: `docs/qa/PR6_RELEASE_AND_ROLLBACK_20261016.md`; matriz de cobertura: `docs/qa/CHECKOUT_B2B_E2E_VALIDATION.md`.
- **Qualidade comprovada antes do teste adversarial:** SHA `e6057c50054a34cbdaeb3146779ff29b5535072e` [Quality #38978436776](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38978436776) e [Browser QA #38978436835](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38978436835) SUCCESS: navegador PJ varejo/tracking HTTP 200, WhatsApp B2B textual interceptado sem envio, PDF privado via Signed URL, troca de sessão in-flight e auditoria local, comprador B de outro tenant negado, revogação de A negada catálogo/checkout com 403.
- **Risco identificado:** a função SQL da migration congelada 000018 faz fast-path de idempotência sem autorização por comprador; teste novo com chave de A sob JWT de B [QA #38978866418](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38978866418) FAIL na etapa de replay. Não inferir resposta HTTP exata nem incidente em Hosted.
- **Correção só em QA:** migration forward-only 000023, wrapper RPC com status aprovado, dono da idempotência e lock transacional; versão legada em `private` sem EXECUTE para service_role. ADR 015 e Security Register atualizados. Proteção efetiva **AGUARDANDO QA ISOLADA**.
- **Validação pendente:** CI do último HEAD com migration 000023 e teste de replay B→A, mantendo checkouts comuns, SQL grants/RLS e pedido count; não repetir análise integral. O último workflow foi CANCELLED por pushes subsequentes no PR (concurrency), não é FAIL de aplicação; aguardar novo CI do HEAD documental final.
- **Gate de release:** NÃO aplicar 000023 por `supabase db push` indiscriminado; Google 000021/22 pendente Hosted e fora de escopo. Necessária aprovação específica de migração seletiva, merge e Cloudflare deploy; checklist de rollback é planejamento, sem drill realizado.

## Checkpoint QA final — 16/10/2026

- **Code SHA `744c8017` / QA real:** [Quality #38979475405](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38979475405) SUCCESS; [Isolated Browser QA #38979869345](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38979869345) SUCCESS com migration forward-only 000023, checkout varejo + 2 atacado fictícios, PDF privado, WhatsApp textual sem envio, rastreamento PJ, troca de sessão e replay de B contra chave de A negado. Auditoria SQL verificou acesso privado do legado e privilégios mínimos no wrapper.
- **STATUS:** PARCIAL / AGUARDANDO APROVAÇÃO; não declarar B2B-01–13 integral pois B2B-04/05/06/07/09/10 e PF completo ainda têm cobertura parcial; rollback drill não executado. Próxima ação: concluir casos residuais e avaliar plano de migration seletiva 000023 SEM aplicar Google 000021/22. `main`, Cloudflare e Supabase Hosted intactos; PR #6 OPEN, sem merge/deploy/Google.

## Continuidade — 16/10/2026: mínimos, forja e replay B2B em QA

- **Code SHA `52ac5708`, ambos CI SUCCESS:** [Quality #38982456344](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38982456344), [Isolated Browser QA #38982456364](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38982456364). Reutilizada a infraestrutura descartável já aprovada; sem Hosted.
- **Novas provas HTTP/SQL:** comprador A aprovado repete idempotency_key e recebe o mesmo pedido oficial (201, mesmo ID e total), B tenta a chave de A e recebe 403; quantidade 4 inferior ao mínimo 5 recusada (400); mínimo loja elevado temporariamente a R$120 torna 5×R$20 inválido (400) e foi restaurado; payload com `buyerUserId/subtotal/total/wholesalePrice` rejeitado; `email/city` obrigatórios ausentes rejeitados (400). Nenhuma nova inserção não prevista; revogação e cross-tenant continuam PASS, PDF privado/WhatsApp textual/checkout race regressão PASS.
- **Estado:** PARCIAL. Ainda B2B-04/05 UI em revisão final, matriz browser de campos dinâmicos B2B-06/07, spoof alternativo B2B-09, pedido PF persistido B2B-13, alguns races de navegador, ensaio rollback e gate release seletivo 000023 (Google desligado). Continuar sem merge, deploy, `db push`, Google Routes ou escrita Hosted.

## Checkpoint vigente — QA PF, mínimos visuais e transação reversível

- **SHA de código `ae39e666` VALIDADO:** [Quality #38991112379](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38991112379) SUCCESS; [Isolated Browser QA #38991112403](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38991112403) SUCCESS. Apenas Supabase loopback e dados sintéticos. Nenhuma alteração de aplicação, Hosted, Cloudflare ou Google.
- **Novas provas Chromium:** quantidade atacadista 5 não reduz a 4; carrinho R$100 com mínimo R$120 bloqueado, valor restaurado; matriz de campos obrigatórios/opcionais/ocultos conferida inclusive transição PJ→PF.
- **Pedido PF real:** Edge HTTP 201, `trackingToken` presente, rastreamento HTTP 200 e recibo local; auditoria SQL independente exigiu 4 pedidos: dois varejo (PJ/PF) + dois B2B, nenhuma escrita no tenant B, snapshot PF sem empresa/notes, hash de token com 64 caracteres.
- **Ensaio local restrito:** transação alterando mínimo comercial e executando `ROLLBACK`, sem perda dos quatro pedidos. NÃO atesta rollback do deploy Cloudflare, Edge, migration 000023 ou restore de backup Hosted; permanecem NOT EVALUATED.
- **Cobertura final:** B2B-04/05 agora PASS para configurações comerciais testadas em UI/Edge; B2B-06/07 PASS para fixture configurada, mas permutações de campos não exaustivas; B2B-09 quatro manipulações negadas, forjas alternativas/tenant ainda parciais; B2B-13 PF/PJ persistidos PASS. RACE-01–04 históricos não integralmente repetidos; sessão checkout in-flight PASS. Matriz e gate em `docs/qa/CHECKOUT_B2B_E2E_VALIDATION.md` e `docs/qa/PR6_RELEASE_AND_ROLLBACK_20261016.md`.
- **Próximo bloco:** revisão das variantes restantes de payload e race, plano de migração **seletiva** 000023 que não inclua migrations Google 000021/22, backup/restauração e smoke de deploy autorizados. **Gate release BLOCKED:** PR #6 OPEN; sem merge, `db push`, deploy, migração Hosted nem ativação paga.

## Checkpoint incremental — 19/10/2026: variantes adversariais e migração seletiva

- **Código de QA alterado:** `scripts/qa-browser/test_revoked_wholesale_buyer_api.py` agora executa nove variantes negativas (quantidade, preços/buyer em itens, variante, tenantSlug e idempotência), tentativa de cross-tenant A→B e replay aprovado com extras não autorizativos sem criar pedido. Esses casos exigem resultado **CI no SHA atual**; não assumir PASS a partir de código escrito.
- **Documento não executável:** `docs/qa/PR6_SELECTIVE_MIGRATION_000023_RUNBOOK_20261019.md`, com preflight de versão/objetos/grants, backup, procedure somente 000023, auditoria e reconciliação posterior do histórico mediante autorização separada. `supabase db push` / `migration up --linked` / `--include-all` bloqueados para branch que ainda contém Google 20261011. A implantação seletiva ainda NÃO FOI EXECUTADA.
- **Próxima ação:** verificar Quality e Browser QA no HEAD consolidado, corrigir somente falha reproduzida; manter PR #6 aberto. Nenhum Hosted, Cloudflare, produção, migração real, Google pago ou merge autorizado. Pré-requisitos de backup/restore e smoke release permanecem NOT EVALUATED.

## Checkpoint de 19/10/2026 — payload adversarial e runbook seletivo

- **SHA `73ed4cc9` aprovado:** [Quality #39322939847](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39322939847) e [Browser QA #39322939786](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39322939786), SUCCESS. Nove variantes inválidas rejeitadas; comprador A não cria pedido no tenant B; extras sem autoridade não alteram recibo; revogação e replay idempotente seguros; 4 pedidos fictícios auditados; sem PII ou WhatsApp transmitidos.
- **Runbook novo:** `docs/qa/PR6_SELECTIVE_MIGRATION_000023_RUNBOOK_20261019.md`. A migration 000023 **NÃO** foi aplicada ao Hosted. Exige backup, preflight read-only, autorização de escrita seletiva e reconciliação verdadeira do histórico. Google 000021/22 fica fora; `db push` indiscriminado bloqueado.
- **Próximo passo:** variantes restantes de RACE-01–04, recuperação de backup em staging autorizado, separação de Google do caminho de publicação. PR #6 OPEN, sem merge, deploy, Hosted write ou ativação de custo.

## Checkpoint vigente — 19/10/2026: RACE-01–04 homologados

- **SHA `45340696` e CI:** [Quality #39337384524](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39337384524) e [Browser QA #39337384495](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39337384495) SUCCESS. RACE-01/02/03/04 PASS no Chromium com Auth/Edge locais; RACE-04 suspendeu um comprador sintético, negou modal e preservou carrinho varejista, restaurando a fixture. Nenhuma mudança na autorização ou frontend de produção.
- **Regressão completa:** varejo PJ/PF e B2B, PDF assinado privado, tracking HTTP 200, revogação/tenant, 4 pedidos fictícios e rollback local de configuração PASS. Uma falha isolada pós-tracking PJ não reproduziu na reexecução instrumentada; não afirmar causa funcional sem evidência.
- **Pendente operacional:** ensaio real de restauração de backup em staging autorizado e RTO/RPO, rollback Edge/Cloudflare, aplicação seletiva e auditada da migration 000023 sem Google 000021/22, reconciliação do histórico e aprovação de migration/merge/deploy separadas. PR #6 OPEN/BLOCKED, nenhuma escrita Hosted/deploy/ativação de custo.

## Checkpoint vigente — 19/10/2026: recuperação lógica descartável PASS

- **Code SHA `fa964f99`:** [Quality #39342161192](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39342161192) e [Isolated Browser QA #39342161033](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39342161033) SUCCESS; `LOCAL-RESTORE PASS`. Após a regressão B2B e 4 pedidos fictícios, snapshot lógico `public/private/auth/extensions` recuperado em banco temporário do mesmo contêiner, com digests de orders/customers/settings/auth.users e flag RLS coincidentes; banco original preservado.
- **Limite:** `pg_restore --no-owner --no-acl` e schemas selecionados não exercitam ownership/grants de destino, Storage físico, Realtime, backup real Hosted, RTO/RPO ou rollback Cloudflare/Edge. Documentado em `docs/qa/PR6_RECOVERY_EVIDENCE_20261019.md`. A migration `000023` continua NÃO aplicada em Hosted.
- **Próximo gate:** ensaio de recuperação completo em staging separado e autorizado, incluindo roles/grants/RLS efetivo, Storage, prazo e responsáveis; aprovação distinta para migration seletiva 000023 sem Google 000021/22, merge e deploy. PR #6 OPEN/BLOCKED e produção intocada.

## Checkpoint atual — 19/10/2026: CI safety guard + restore PASS

- **Code SHA `b02025b3`:** [Quality #39344083695](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39344083695) e [Isolated Browser QA #39344083699](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39344083699) SUCCESS. Teste offline `scripts/qa-browser/test_release_safety.py` executa 3 controles fail-closed: proibição de comandos explícitos de deploy e migração Hosted nos workflows, UI de Google desligada na QA e inventário pendente de migrations Google e 000023. Todos PASS.
- **Restore repetido PASS:** `scripts/qa-browser/drill_local_backup_restore.sh` confirmou cópia lógica `public/private/auth/extensions` em banco temporário, quatro pedidos fictícios e digests Auth/tenant consistentes; banco original preservado. RACE-01–04, revogação B2B, PDF privado, tracking e checkout PF/PJ/B2B também passaram.
- **Não confundir com recuperação Hosted:** clone não valida ownership/ACL de destino, Storage físico, Realtime, PITR, RTO/RPO ou rollback Cloudflare/Edge. Cloudflare dashboard e Supabase Integration fora da cobertura do teste offline. Documentação detalhada: `docs/qa/PR6_RECOVERY_EVIDENCE_20261019.md` e runbook seletivo 000023.
- **Status:** PR #6 OPEN/BLOCKED; nenhuma migration, `db push`, merge, deploy ou alteração Hosted realizada. Próxima dependência operacional: staging autorizado com restore compatível + análise de integrações externas e aprovação específica para migration seletiva 000023 sem Google 000021/22.


## Checkpoint staging autorizado — 21/10/2026

- **Autorização explícita:** preparar staging isolado para recuperação do banco e migration 000023, mantendo Supabase de produção intocado. Não inclui migration em Hosted, merge/deploy ou custos Google.
- Implementados `.github/workflows/qa-staging-recovery.yml` e `scripts/qa-browser/drill_staging_migration_000023.sh`: runner Docker/Supabase local descartável com fonte pré-000023; dump `public/private/auth/extensions`, restore para banco novo no **mesmo contêiner** e aplicação somente do SQL versionado 000023 à cópia.
- **Evidência executada:** [Isolated Staging Recovery #1](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39629280389), log `STAGING-000023 PASS`: funções public/private conforme esperado; wrapper público EXECUTE somente para service_role, função privada sem EXECUTE service_role; contagens/digests de dados e flag RLS preservados; fonte de QA não alterada. [Quality #262](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39629280034) SUCCESS.
- Limites: restore `--no-owner --no-acl`, sem teste de recovery integral Hosted/Storage físico/Realtime/PITR/RTO/RPO, sem simulação de ownership/grants de todos os objetos. Não afirmar aprovação de desastre de produção ou execução de migration Hosted.
- Evidência detalhada: `docs/qa/PR6_STAGING_000023_EVIDENCE_20261021.md`. Próxima decisão: eventual staging Hosted separado ou autorização para execução seletiva da 000023 **somente após** preflight/backup e aprovação adicional. Não executar `db push` que inclua migrations Google.
