# PR #6 — Gate de homologação e publicação (2026-10-14)

## Gate atualizado — 16/10/2026, após recuperação de GitHub Actions

**Veredito: checkout integrado, corrida de sessão e PDF privado na QA isolada APROVADOS; MERGE/RELEASE AINDA BLOQUEADOS por aceite final e autorização de publicação.**

- **Revisão testada:** `9e412dd6b084a0da232b5af5fb37362f27868c28`. [Quality](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38974680072): SUCCESS; [Isolated Browser QA](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38974679950): SUCCESS. Os problemas anteriores de runner sem etapas foram resolvidos.
- **Corrida de identidade in-flight:** Chromium enviou pedido B2B HTTP 201 ao Supabase descartável, reteve a resposta, encerrou sessão em outra aba e liberou a resposta; nenhum recibo/PII da identidade anterior foi apresentado, zero segundo POST. Auditoria SQL: exatamente 3 pedidos fictícios (1 varejo + 2 atacado), tenant A, comprador atacadista aprovado, total canônico de R$100 e nenhum pedido tenant B.
- **PDF privado end-to-end:** teste comprovou Signed URL local HTTP 200, bytes `%PDF-`, acesso público sem assinatura negado. Diagnóstico independente: bucket `order-documents` privado, 2 objetos persistidos e zero avisos de geração/upload/assinatura.
- **Correção mínima:** `submit-order-checkout` separa origem pública de URL assinada de `SUPABASE_URL` interno do Docker usando `PUBLIC_SUPABASE_URL` server-side opcional, nunca derivado do cliente; preserva HTTPS/loopback, caminho exato do objeto canônico e token. Em produção permanece fallback para `SUPABASE_URL`; nenhuma configuração Hosted foi alterada.
- **Ainda exigido antes de publicação:** revisão final do diff PR #6 e matriz funcional B2B remanescente, checklist de rollback e aprovação humana específica. Migrations Google/estimativa seguem fora do escopo; não executar `db push`, merge nem Cloudflare deploy sem autorização distinta.

---

## Estado vigente — 16/10/2026 (supersede notas históricas onde houver conflito)

**Veredito: QA INTEGRADA B2B PARCIALMENTE APROVADA; RELEASE AINDA BLOQUEADO.**

- **CI código:** [Quality #167](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38967546403) SUCCESS no commit `f540b738`.
- **CI browser:** [Isolated Browser QA #52](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38967546293) SUCCESS no mesmo commit. Login B2B approved A, pedido real em banco QA local HTTP 201 com 5×R$20 = R$100, pedido pendente, retry sem novo POST, tracking HTTP 200 e alternância Atacado/Varejo PASS. Auditoria Postgres local confirmou 2 pedidos fictícios (varejo + atacado), ambos tenant A, cliente atacadista autorizado, zero pedidos tenant B. WhatsApp jamais recebeu mensagem.
- **Segurança preservada:** a auditoria anterior via PostgREST falhou com SQLSTATE `42501` por `orders` restrita até mesmo ao papel usado na leitura REST. Correção foi exclusivamente no test runner (`assert_local_wholesale_order.sh` usando `psql` no container descartável), nunca `GRANT`/RLS/migration. A rotina JavaScript rejeitada foi excluída. Este gate não habilita `service_role` a ler `orders` via REST.
- **Hosted:** migrations `000019` e `000020` previamente aplicadas e congeladas, proteção da tabela `wholesale_tiers` reconciliada; não executar `db push` que inclua Google. Endpoint `estimate-delivery` e Google Routes continuam desativados em produção.
- **Pendentes obrigatórios antes de merge:** cenário de troca de sessão durante envio in-flight (incluindo ausência de recibo cruzado), PDF privado local, subcasos restantes da matriz B2B-01–13/política de campos e revisão de segurança/rollback do diff completo. Quality e QA acima valem para `f540b738`, não constituem verificação automática de revisões documentais posteriores.
- **Publicação:** continua exigindo autorização distinta e explícita para merge em `main` e Cloudflare; ativação Google Routes requer gate independente de credenciais, quotas e custos. Nenhum deploy executado.

---


## Estado vigente após migrations e QA incremental — 14/10/2026

**Veredito: PREPARADO EM QA / BLOQUEADO PARA MERGE.** Esta seção substitui o estado factual do registro histórico abaixo (que permanece para rastreabilidade); itens não executados não podem ser marcados PASS.

- **Supabase produção VERIFICADO:** migrations 000019/000020 aplicadas mediante autorizações específicas, depois alinhadas ao histórico Git: versões `20261009030000` e `20261010000000`. Existem **20 migrations**, 1 configuração de entrega (`estimateEnabled=false`), 6 pedidos e 520 produtos preservados; `anon` sem SELECT em `wholesale_tiers` e política pública removida. 8 Edge Functions ACTIVE, nenhuma `estimate-delivery` publicada. Não reaplicar 000019/000020.
- **Google fora do release autorizado:** migrations `20261011032224_google_routes_usage_limits.sql` e `20261011035235_google_routes_burst_protection.sql` **ainda não aplicadas**, contador SQL ausente em produção. Não usar `supabase db push` indiscriminadamente: a pasta da branch inclui também essas duas migrations Google fora do escopo aprovado. Sem publicar `estimate-delivery`, sem inserir chave, sem chamar Google, sem ativar `GOOGLE_ROUTES_ENABLED`.
- **Guard duplo na branch:** interface somente mostra estimativa se `import.meta.env.VITE_GOOGLE_ROUTES_UI_ENABLED === 'true'`, desativado por padrão no build; endpoint exige independentemente `GOOGLE_ROUTES_ENABLED === 'true'` no servidor, que não foi configurado em produção. A flag `VITE_*` é pública e **não é limite de segurança**: jamais colocar API key em `VITE_*`. Para release sem Google, confirmar que a flag do build está ausente ou diferente de `true` e que a configuração da loja permanece desativada.
- **CI:** [Quality #59](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38656900813) SUCCESS na regressão B2B ampliada (6 casos novos); [Quality #62](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38657056819) SUCCESS na revisão com gate da UI Google. Revisar também o CI do HEAD final após commits documentais. Não confundir CI com browser E2E.
- **Homologação B2B:** há evidência local real Auth/Edge para o happy path e RACE-01–04, mas casos B2B-02 suspenso no navegador, B2B-06/07 para todos os campos, B2B-11 aba externa de atacado, B2B-12 jornada final e B2B-13 PJ/tracking/filtros ainda incompletos. Matriz reconciliada na seção 6 de `docs/qa/CHECKOUT_B2B_E2E_VALIDATION.md`. **NÃO declarar aceite final.**

### Procedimento de publicação futura (não executado)

1. Executar apenas QA isolada com tenants/identidades fictícios e concluir os subcasos pendentes; rodar `bun run check` no HEAD exato e revisar diff PR #6/CI. Atualizar evidências sanitizadas.
2. Conferir backup/recovery e estado de migrations 000019/000020 **já aplicadas** e fechar pendências de integridade, RLS e operação do checkout. Não provisionar o Google e não executar `db push` que inclua 21/22 sem autorização nova.
3. Planejar release separado: com o Google desligado, a entrega pode apresentar apenas métodos/tarifas comerciais, sem cálculo automático. Confirmar build com `VITE_GOOGLE_ROUTES_UI_ENABLED` ausente ou falso, e verificar ausência de deployment de `estimate-delivery`.
4. **Solicitar autorização explícita de merge e publicação Cloudflare**, pois merge no `main` pode acionar deploy automático. Preparar rollback do frontend para a revisão publicada anterior e plano forward-fix de banco (não reverter migrations 19/20 automaticamente).
5. Somente após autorização e implantação futura: verificar rota SPA, sessão/catálogo, checkout varejo e B2B, recibo/tracking, log sanitizado e invariantes de produção; não criar pedidos artificiais no Hosted. Revisar Issue #7 sobre controle de preços e Issue #4 sobre E2E.
6. Google Routes exige **outra decisão**, incluindo restrição/identidade da chave, riscos de abuso externo às cotas de banco, teto de custo e monitoramento; não inferir aceite a partir desta preparação.

---

## Registro histórico da revisão inicial (superado pelas alterações acima)



**Revisão de base (QA):** `7020c992eee261746ef000e0bd1021ed696c26f1` — inclui correção do nome da loja no acompanhamento. **Produção:** GitHub `main` permanece na baseline `d29a5a2` na consulta deste documento; não foi realizado merge/deploy.

## Evidências verificadas nesta revisão

- Quality #53 / run [38654073837](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38654073837) em `7020c99`: **SUCCESS**. Log: `bun run check`, TypeScript, Vite build, regressões, testes do provider React DOM (8 PASS), validação de fronteira de chave Google e `Tracking React DOM PASS: canonical tenant display ...`. Esse CI não é um E2E autenticado.
- Supabase Hosted `vlpwtdqqnecdvccxyodp`, consulta **somente leitura**: 18 migrations (última `20261009020000`), 8 Edge Functions ACTIVE e 6 pedidos preservados. `tenant_delivery_settings` e `private.google_routes_usage` ainda não existem na produção.
- Valores atuais `delivery_methods`: `retirada`, `entrega`, `uber`, `transportadora`, `outro`, compatíveis com a allowlist proposta na migration 000019.
- **Privacidade B2B / prioridade alta:** tabela `public.wholesale_tiers` tem hoje `anon` com `SELECT` concedido, política `wholesale_tiers_select_public` presente e RLS ativa. **0 registros** observados no momento da leitura, portanto **nenhuma exposição de linha existente foi constatada**. Entretanto, futuros preços por faixa ficariam acessíveis sem a correção 000020. Migration versionada: `20261010000000_000020_product_rls_and_private_wholesale_tiers.sql`.
- Os testes locais reais documentados no `SESSION_HANDOFF` até 2026-10-11 incluem 18 testes HTTP com Auth e Supabase isolado, testes RACE-01–04 de navegador, criação/recibo/tracking de varejo e regressões React DOM. **Matriz B2B completa = PARTIAL**, não `PASS` de release.

## Ordem proposta de entrega (não executada)

1. **Gate funcional:** fechar matriz B2B-01–13 e RACE-01–04 no ambiente isolado. No histórico, subcasos de usuário bloqueado, tentativa completa B2B pelo CTA, verificação integrada em navegador e testes finais entre tenants ainda precisam ser reconciliados com as evidências. Sem fixtures/dados reais de produção.
2. **Gate de segurança/custos Google:** confirmar política final de cobrança, cota real do projeto Google e restrições efetivas da credencial. O endpoint de estimativa é público por desenho do varejo; `Origin`/CORS não é autenticação. Os contadores locais `10/60s`, `250/dia`, `7500/mês` não limitam chamadas diretas com uma chave vazada nem garantem gasto máximo. A chave usada em QA não possuía restrição IP, por decisão registrada anteriormente. Manter `GOOGLE_ROUTES_ENABLED` desativado se os riscos/custos não forem aceitos expressamente para produção.
3. **Gate de banco:** validar backup/restore, bloqueios, RLS e compatibilidade e aplicar migrations forward-only, **em sequência ordenada**, após autorização de mudança em produção: `000019_delivery_settings` → `000020_product_rls_and_private_wholesale_tiers` → `google_routes_usage_limits` → `google_routes_burst_protection`. Entre cada etapa, verificar migrations aplicadas, grants/policies e invariantes de pedidos. Não editar migrations já aplicadas. Definir plano de recuperação por forward-fix; evitar rollback destrutivo de schema/negócio.
4. **Gate de integração:** publicar Edge Function `estimate-delivery` e configurar somente variáveis server-side aprovadas (sem `service_role` no browser). Manter a flag Google desativada até aprovação específica de ativação. Conferir negação `anon` à tabela `wholesale_tiers` em ambiente final e direitos de admin/tenant.
5. **Gate de release:** revisar diffs do PR #6 (inclui alterações B2B, tracking, delivery e 4 migrations), aprovar merge de `main` ciente de que Cloudflare publica a revisão, validar Cloudflare pós-publicação (rota, assets, console, checkout varejo, B2B, erros). Observar gasto/erros se Google for ativado; desabilitar flag imediatamente se houver anomalia.

## Decisões que dependem de autorização

- **Alteração do Supabase de produção e merge/deploy:** autorização de janela de publicação e plano de rollback/forward-fix, separados da aprovação de testes.
- **Google Routes em produção:** aceite consciente de risco financeiro/abuso e política de restrição/identidade ou decisão de manter desativado. Não deduzir aprovação de custos a partir de testes locais.
- **Itens 5/6:** há implementação correspondente a entrega/Google Routes na branch, mas o mapeamento exato do planejamento inicial e critérios comerciais finais ainda exigem reconciliação. Issue #5.
- **E2E incompleto:** caso não seja possível completar cenário específico no ambiente isolado, registrar `BLOCKED`, não promover para `PASS` automaticamente.

**Regra:** este documento é um plano de release e evidência read-only; não autoriza deploy, mudanças Hosted, ativação de cobrança nem criação de chaves. Seguir `docs/RELEASE_CHECKLIST.md`, `docs/qa/GOOGLE_MAPS_ACTIVATION.md` e `docs/SESSION_HANDOFF.md`.


### Ajuste de gate — recibo e retry do WhatsApp (14/10/2026)

- Bloqueio de reutilização indevida de `createdOrder` após popup WhatsApp fechado: o mesmo SHA-256 do `draft` e comprador precisa ser confirmado na tentativa seguinte. [Quality #107](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38672256780) passou nos testes existentes/novos de fingerprint. A regressão estrutural não é E2E.
- Antes do merge, validar no navegador QA isolado um pedido fictício cujo popup foi fechado **após** o receipt; tentar abrir com o mesmo draft, depois editar dados e confirmar que não redireciona recibo anterior; testar mudança de sessão durante request sem revelar dados do outro comprador. Não reutilizar ambiente de produção.


### Atualização do gate: transação local + handoff aprovado (15/10/2026)

- [Isolated Browser QA #37](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38831184711) **SUCCESS** no commit `c62c65b`, Quality #152 SUCCESS. O pedido fictício PJ **foi persistido**, com HTTP 201, recibo validado, popup fechado e retry sem segundo pedido, alteração do draft recusada, retorno ao draft original gerou `wa.me` sintético com pedido/produto/total e sem CNPJ completo. Consulta direta ao Postgres QA confirmou **1** pedido no tenant correto. Nenhum WhatsApp real foi enviado; entrega efetiva exige ação manual do comprador.
- Migrations Google continuam sem publicação, `GOOGLE_ROUTES_ENABLED` desativado; `000019`/`000020` já existentes no Hosted. Release **não está implicitamente autorizado**. Ainda pendente corrida durante submit, pedido B2B persistido/listado, tracking/filtros e documento PDF local. Revisar o risco restante antes de pedir aceite para merge/deploy Cloudflare.
