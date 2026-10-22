# PR #6 — Revisão do diff, gate de release e rollback (16/10/2026)

**Estado:** PREPARADO PARA HOMOLOGAÇÃO FINAL / BLOQUEADO PARA MERGE E DEPLOY.
**Escopo auditado:** diff de `main` até `qa/b2b-checkout-e2e-readiness-20261008`, 71 arquivos, com alterações em frontend, Auth B2B, Edge, RLS, migrations, QA, CI, documentação e Google Routes. Conferir novamente a lista, HEAD e os checks antes de qualquer publicação.
**Ambiente de prova:** GitHub Actions com Supabase local descartável, dois tenants e contas/pedidos fictícios; não é staging Hosted nem produção.
**Última baseline integrada aprovada antes da ampliação B2B-11/13:** SHA `2051cfe42ec418dfef33ee674b97f81b06e1520d`, Quality #38975306992 PASS, Isolated Browser QA #38975306909 PASS. Alterações posteriores exigem novos checks por SHA.

## Gate automático de publicação e regressão final — 19/10/2026

**Código SHA `b02025b3c639a9c9c54edca24121ef12277c2c46`:** [Quality #39344083695](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39344083695) e [Isolated Browser QA #39344083699](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39344083699) SUCCESS, incluindo `LOCAL-RESTORE PASS`, RACE-01–04, 4 pedidos fictícios, isolamento de tenant e checkout PF/PJ/B2B.

`scripts/qa-browser/test_release_safety.py` foi adicionado ao Quality e executou 3 verificações PASS: os workflows versionados não contêm comandos explícitos de deploy/migration Hosted, Google Routes permanece desativado na QA, e as migrations Google pendentes e `000023` continuam inventariadas com bloqueio documental para `db push` indiscriminado.

**Limites:** o guard é estático e cobre os workflows locais; não verifica automatismos do painel Cloudflare, Supabase GitHub Integration ou alterações externas. Restauro de roles/grants/Storage, RTO/RPO, backup real e rollback Edge/Cloudflare seguem NOT EVALUATED. **PR #6 ainda BLOQUEADO** para merge, migration Hosted e deploy.

---

## Evidência atual de restore local — 19/10/2026

**Code SHA `fa964f99`:** [Quality #39342161192](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39342161192) e [Isolated Browser QA #39342161033](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39342161033) SUCCESS. O drill `scripts/qa-browser/drill_local_backup_restore.sh` executou `pg_dump` e restaurou os schemas `public/private/auth/extensions` em segundo banco temporário; comparou contagem e digests dos **4 pedidos fictícios**, `wholesale_customers`, `tenant_public_settings`, `auth.users` e flag RLS, confirmou assinatura RPC e privilégios mínimos da origem e não modificou o banco original. Evidência detalhada: `docs/qa/PR6_RECOVERY_EVIDENCE_20261019.md`.

**Limite do PASS:** cópia lógica restaurada com `--no-owner --no-acl`; portanto **owners/grants de destino, Storage físico, Realtime, backups Hosted, RTO/RPO e recuperação Edge/Cloudflare NÃO estão aprovados**. Requer ensaio autorizado em staging e checklist de autorização específica antes de migrar `000023`. PR segue bloqueado para merge/deploy.

---

## Status de concorrência validado — 19/10/2026

[Quality #39337384524](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39337384524) e [Browser QA #39337384495](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39337384495) SUCCESS no código `45340696`. RACE-01–04 aprovados em Chromium/Auth/Edge/Postgres descartáveis (aprovação e catálogo atrasados, catálogo vazio sem loop e revogação com modal aberto sem perda do carrinho). Checkouts PF/PJ/atacado, PDF privado e auditoria dos quatro pedidos fictícios também PASS.

**Não liberar merge/deploy:** migration Hosted 000023 não foi executada; backups/restore staging, RTO/RPO, rollback Cloudflare/Edge e smoke de produção continuam pendentes. Google Routes 000021/22 permanece excluído; não executar `db push` indiscriminado.

---

## Confirmação de QA adversarial — 19/10/2026

No commit `73ed4cc9`, [Quality #39322939847](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39322939847) e [Browser QA #39322939786](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39322939786) SUCCESS. Nove variantes adversariais negadas, isolamento A→B confirmado, replay canônico preservado, quatro pedidos sintéticos auditados. **Não é autorização de produção**. A migration 000023 e seu runbook seletivo continuam sem execução no Hosted; backups/restores e rollback real não avaliados.

---

## Preflight seletivo 000023 e cobertura adversarial — 19/10/2026

- **Runbook novo:** `docs/qa/PR6_SELECTIVE_MIGRATION_000023_RUNBOOK_20261019.md`. Executar exclusivamente com autorização de banco separada, backup/restauração verificáveis e conferência read-only de grants, versões e dependências; `db push` em branch com migrations Google pendentes permanece proibido.
- **Testes adicionais propostos para a revisão vigente:** falsificação dentro de itens (unitPrice, discount, buyer_user_id), quantidade negativa/fracionária/string, variante com tipo inválido, tenantSlug não textual e idempotencyKey sem UUID v4. A também tenta comprar do tenant B; extras não autorizativos `tenantId`/`buyer_id` precisam ser ignorados sem modificar pedido anterior. **Status: NOT EVALUATED até CI do commit novo**.
- **Limite:** não considerar o ensaio local de ROLLBACK como prova de restore/rollback de Hosted, Edge ou Cloudflare. PR não liberado para merge; eventual implantação seletiva requer impedir que migrations Google sejam disparadas por integração/deploy.

---

## QA ampliada de release — validação em 16/10/2026

O código `ae39e666` passou [Quality #38991112379](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38991112379) e [Browser QA #38991112403](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38991112403), com migration 000023 somente em Supabase descartável. A revisão comprovou mínimo de quantidade no carrinho e SQL, mínimo financeiro R$120 bloqueando carrinho de R$100 e Edge, aplicação da configuração de campos e PF/PJ, persistência do PF com tracking HTTP 200, PDF privado, sem vazamento entre tenants e sem envio WhatsApp.

**Mini-drill executado:** `scripts/qa-browser/drill_local_settings_rollback.sh` alterou a configuração local de atacado dentro de uma transação, reverteu-a com `ROLLBACK` e conferiu valor inicial e os quatro pedidos fictícios. **Isso NÃO comprova** restauração de backup, reversão de migration Hosted, Cloudflare ou Edge. O checklist de rollback de produção permanece **NOT EVALUATED**.

**Restrições obrigatórias inalteradas:** PR #6 continua aberto; a migration 000023 não foi aplicada ao Hosted. Google Routes 000021/000022 não deve ser aplicado nem habilitado. Não executar `supabase db push` indiscriminado. Merge, migration seletiva e deploy demandam autorizações distintas e aprovação humana após smoke/rollback plan.

---

## Achado crítico da revisão do diff — 16/10/2026

**GATE BLOQUEADO POR AUTORIZAÇÃO B2B / REPLAY DE IDEMPOTÊNCIA.** A RPC original de 000018 retorna pedidos já existentes antes de validar o comprador em tentativas de replay. O teste adversarial de chave de A reutilizada pelo comprador B, introduzido em `cee84b7`, falhou em [QA #38978866418](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38978866418); essa execução não registrou o status HTTP exato e **não prova ocorrência em Hosted**. É um risco de autorização que precisa ser fechado antes de qualquer publicação.

**Remediação em branch de QA, NÃO APLICADA NO HOSTED:** migration forward-only `20261016000000_000023_checkout_idempotency_buyer_guard.sql`, ADR 015 e Security Register. A implementação antiga da RPC é movida a `private` com EXECUTE revogado aos papéis de API; o wrapper `public` valida tenant e comprador ativo inclusive no replay, compara dono/modalidade e serializa pela chave antes de delegar. Auditorias SQL e teste negativo serão executados em Supabase descartável. Até confirmar CI completo no SHA exato, estado **NOT EVALUATED**, nunca PASS.

**Dependência de release:** 000023 sucede migrations de Google Routes `20261011*` ainda não aplicadas em produção. Não executar `supabase db push` para instalar 000023, pois isso pode aplicar as migrations pagas fora do escopo. Para eventual implantação posterior, exigir aprovação separada de migration, plano seletivo supervisionado, backup e validação de privilégios/compatibilidade.

---

## Validação de segurança concluída na QA isolada — 16/10/2026

A migration 000023, o wrapper RPC e os grants passaram em [Isolated Browser QA #38979869345](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38979869345); [Quality #38979475405](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38979475405) SUCCESS no SHA de código `744c8017` (documentos posteriores não alteram lógica). Comprador B de outro tenant não consegue consultar catálogo A nem reutilizar a chave de pedido A; comprador A após revogação recebe HTTP 403 no catálogo/checkout; Postgres preserva três pedidos locais, sem duplicação. PDF privado, WhatsApp textual interceptado e checkout concorrente também PASS. **Somente QA descartável**, sem verificação Hosted dessa mudança.

A nova barreira foi validada em teste, mas **o gate de produção segue BLOQUEADO** até revisão final dos subcasos parciais, estratégia seletiva da migration 000023 (sem Google), backup/recuperação e autorização humana para migration, merge e Cloudflare deploy.

---

## Revisão por fronteira de risco

| Superfície | Diff / controle observado | Condição de aceite |
| --- | --- | --- |
| Autenticação B2B e troca A→B | `WholesaleAccessContext` usa geração por usuário, invalida respostas antigas e revalida autorização antes da mudança de modo; `CartDrawer` descarta recibo de sessão obsoleta | Auth real e revogação/tenant negativo no backend; nenhuma PII ou preço de A exposto a B |
| Checkout e valores | `submit-order-checkout` mantém cálculo server-side por RPC; idempotência e fingerprint do recibo; QA confirma total autoritativo e contagem independente no Postgres local | Um pedido por chave, sem preço/tenant/usuário escolhidos pelo cliente |
| PDF e Storage | Bucket `order-documents` privado; Signed URL do objeto exato via `PUBLIC_SUPABASE_URL` server-side opcional, HTTPS ou loopback aprovado | Signed URL recuperável; URL pública sem token negada; nenhuma URL/token em logs |
| Catálogo e RLS | `getPublicCatalogClient` usa anon sem persistir sessão; migration 000020 restringe wholesale tiers | Revalidar privilégio `anon` e isolamento A/B; migration já aplicada em Hosted não deve ser reexecutada |
| Configuração de entrega | Migration 000019 e formulário de admin; preços/tarifas persistidos no banco com validação server-side | Verificar configuração existente e compatibilidade; migration já aplicada e congelada |
| Rotas Google e custos | Dois arquivos de migration, `estimate-delivery`, `_shared/googleRoutes` e UI foram incluídos no diff mas a função/DB não foram ativadas no Hosted; feature gate duplo | **Fora do release permitido:** não aplicar as migrations, não publicar a função, não habilitar `GOOGLE_ROUTES_ENABLED`, nem `VITE_GOOGLE_ROUTES_UI_ENABLED=true`; exigir gate próprio de custos e aprovação |
| GitHub e Cloudflare | Workflow Quality com `contents: read`; Browser QA isolada vinculada ao PR #6; `wrangler.jsonc` com previews | `main` pode iniciar deploy automaticamente; merge e publicação dependem de autorização expressa |
| Testes e documentos | 71 arquivos, incluindo runner Chromium, SQL read-only e testes unitários | Não inferir PASS a partir de script presente; cada caso deve referenciar run/commit/ambiente |

## Checklist de pré-release (somente leitura; não executar publicação)

- [x] Revisão do inventário completo do diff de 71 arquivos e inspeção de contratos críticos de auth, RLS, checkout, PDF, Google, CI e deploy.
- [x] Evidência histórica de Quality e Browser QA no SHA `2051cfe` (confirmação por job).
- [ ] **Obrigatório:** Quality e Isolated Browser QA PASS no HEAD final após ampliação dos testes, com logs sanitizados e banco fictício.
- [ ] **Obrigatório:** registrar B2B-01–13 e RACE-01–04 por subcaso, sem transformar testes parciais em aprovação integral.
- [ ] **Obrigatório:** revisão manual de comportamento com Auth real contra revogação/tenant cruzado e dos campos configuráveis ocultos no snapshot, se não cobertos por automação integral.
- [ ] **Obrigatório:** confirmar que nenhuma migration ou função Google foi aplicada/publicada por engano; `GOOGLE_ROUTES_ENABLED` ausente/falso no servidor e `VITE_GOOGLE_ROUTES_UI_ENABLED` ausente/falso no build.
- [ ] **Obrigatório:** conferir migrations 000019/000020 **já aplicadas** e compatibilidade/backup; não executar `supabase db push` indiscriminadamente.
- [ ] **Obrigatório:** verificar estado de `CHECKOUT_ENABLED` e `PUBLIC_SUPABASE_URL` com pessoal autorizado, sem exibir valores secretos.
- [ ] **Obrigatório:** validar plano de recuperação do frontend e banco com pessoa responsável, histórico de artefatos/backup e acesso para restaurar.
- [ ] **Obrigatório:** aprovação explícita para merge em `main` e para deploy Cloudflare (etapas separadas).

## Plano de implantação futura — AGUARDANDO AUTORIZAÇÃO

1. Congelar commit SHA do PR, verificar ausência de divergências com `main`, registrar runs completos de Quality e QA.
2. Capturar estado de migrations e políticas de produção **somente leitura**, confirmar backup/restore disponível e responsável pelo recovery; não migrar automaticamente.
3. Confirmar flags de Google desligadas e `estimate-delivery` não publicada, separar migrations Google ainda pendentes de qualquer operação de banco autorizada. Não habilitar nova API paga.
4. Preparar ponto de recuperação de Cloudflare: anotar deployment/commit atualmente ativo e método documentado de promover versão anterior. Não executar ainda.
5. Com autorização específica, revisar/mesclar PR; analisar o acionamento automático do pipeline de produção **antes** do merge. Após deploy autorizado, smoke test de assets/SPA, login, catálogo, modalidades, pedido/tracking e PDF sem dados sintéticos Hosted.
6. Registrar aprovação, evidências e plano de monitoramento. Qualquer falha crítica bloqueia o release.

## Rollback e resposta a falhas

- **Frontend Cloudflare:** voltar à última revisão/deployment de produção previamente validado, usando o mecanismo de recuperação disponível e confirmado no momento do release. Não assumir acesso ou comando de rollback sem verificação prévia.
- **Edge Functions:** manter versão anterior preservada e rollback somente mediante plano autorizado; o endpoint `estimate-delivery` não deve ser publicado nesta entrega.
- **Banco/RLS:** migrations 000019/000020 foram aplicadas e são forward-only; **não desfazer nem reexecutar** cegamente. Se surgir regressão, bloquear tráfego afetado conforme controles existentes, preservar evidências, avaliar correção forward-only e backup com operador responsável. Google migrations não fazem parte da implantação.
- **Pedidos e dados:** não apagar pedidos reais, não alterar idempotency keys nem criar pedidos artificiais para diagnosticar Hosted. Distinguir remediação de auditoria.
- **Segurança:** em exposição de PII, bypass de tenant, segredo ou preço indevido, interromper release e seguir procedimento de incidente, revogando acesso apenas mediante autorização adequada.
- **Recuperação validada?** **NOT EVALUATED:** este documento especifica o procedimento; nenhum rollback real ou drill foi executado.

**Veredito atual:** AGUARDANDO HOMOLOGAÇÃO FINAL; o PR deve permanecer OPEN, sem merge, escrita Hosted, deploy Cloudflare ou ativação de custos Google.
