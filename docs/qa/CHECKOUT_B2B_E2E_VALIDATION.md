# Checkout B2B — plano de homologação E2E (navegador + Supabase isolado)

**Data de preparação:** 2026-10-08

**Baseline:** `main` após Item 4 (ADR 012, migration `20261009020000_000018_checkout_field_settings.sql`).
**Situação:** `NOT EVALUATED` para execução de navegador; este documento é um **roteiro**, não prova de PASS.

**Evidência adicional em 2026-10-09:** `scripts/test-wholesale-context.mjs` monta o provider real com React DOM/jsdom, mocks explícitos de Auth/App/rede e cliques no DOM. Sete casos PASS após correção de troca direta de identidade (baseline 5 PASS / 2 FAIL). Isto é teste de componente, não execução B2B-01–13 ou RACE-01–04 com Supabase real. Veja o início de `SESSION_HANDOFF.md` para ambiente, release e recuperação parcial do escopo 5/6.

## RACE-01–04 completos em Chromium — 19/10/2026

**SHA de código `45340696`:** [Quality #39337384524](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39337384524) e [Browser QA #39337384495](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39337384495) SUCCESS com Supabase descartável. **RACE-01**: aprovação atrasada após logout não reabre atacado; **RACE-02**: resposta de catálogo de A atrasada após login de B não expõe preços A; **RACE-03**: catálogo vazio com uma chamada real e sem refetch loop; **RACE-04**: comprador suspenso no Postgres local antes da confirmação de modalidade permanece em varejo e preserva o carrinho, e a fixture aprovada é restaurada ao final. Todas as quatro situações **PASS** no mesmo workflow.

Regressões PF/PJ, checkout retail e B2B, tracking token HTTP 200, PDF privado, revogação, 4 pedidos sintéticos e mini-rollback SQL local também PASS. Uma falha anterior após tracking PJ não se repetiu na execução completa com marcadores sanitizados. **Gate ainda BLOCKED:** recuperação de backup em staging, rollback Cloudflare/Edge, implantação seletiva de 000023, reconciliação do histórico e autorização separada para merge/deploy **NOT EVALUATED**.

---

## Evidência validada — 19/10/2026

**SHA de código/QA `73ed4cc91aae8cf85c35120279dd8e364c2ad7bf`:** [Quality #39322939847](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39322939847) e [Browser QA #39322939786](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39322939786) **SUCCESS**. Nove variantes inválidas rejeitadas, tentativa cross-tenant negada e extras sem autoridade ignorados sem alterar recibo autoritativo. Revogação 403 e replay aprovado preservados; exatamente quatro pedidos sintéticos, zero no tenant B. Cenários PF/PJ, PDF privado, sessão concorrente e rollback transacional local também PASS.

**Escopo ainda parcial:** permutações adicionais RACE-01–04 e configurações dinâmicas, restore de backup e rollback de Edge/Cloudflare não testados no Hosted. Migração seletiva 000023 apenas planejada; PR OPEN/BLOCKED.

---

## Cobertura adversarial incremental — 19/10/2026

**Novos casos adicionados, ainda NOT EVALUATED nesta revisão:** nove entradas inválidas e/ou com autoridade forjada no gateway (campos financeiros/buyer dentro do item, quantidade com tipo ou limite indevido, variante malformada, tenantSlug inválido e chave de idempotência inválida). Um comprador legítimo A tenta abrir atacado no tenant B; uma repetição legítima de chave antiga com campos extras de tenant/buyer deve retornar apenas o pedido autoritativo anterior. Auditoria existente continua exigindo quatro pedidos fictícios, e não deve haver quinto pedido por manipulação. Nenhum dado real ou WhatsApp.

As versões Google Routes 20261011* não devem ser instaladas para levar 000023 ao Hosted. Plano somente documental em `docs/qa/PR6_SELECTIVE_MIGRATION_000023_RUNBOOK_20261019.md`. CI novo será necessário para mudar os casos acima de NOT EVALUATED para PASS. O gate de merge/deploy segue BLOCKED.

---

## Evidência vigente — QA integrada final (16/10/2026, horário do projeto)

**SHA de código testado:** `ae39e666e890367cee866d98b23db3a85054f253`. [Quality #38991112379](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38991112379) **SUCCESS** e [Isolated Browser QA #38991112403](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38991112403) **SUCCESS**, usando apenas Supabase local descartável e fixtures sem dados reais.

- **B2B-04:** controle de quantidade atacadista não permite reduzir cinco unidades para quatro no Chromium; Edge independente recusa quantidade quatro (HTTP 400).
- **B2B-05:** com valor mínimo local elevado de R$100 para R$120, carrinho de R$100 avisa o mínimo e desabilita avançar, sem POST; Edge recusa o mesmo total (HTTP 400); fixture restaurada.
- **B2B-06/07:** browser verifica campos visíveis/obrigatórios/opcionais na configuração sintética, exclusão de `notes` e aplicabilidade PJ→PF; Edge recusa e-mail/cidade obrigatórios ausentes; snapshots PJ/PF e campos ocultos inspecionados no banco. Não foram testadas todas as combinações possíveis de configuração.
- **B2B-09/10/12:** campos forjados `buyerUserId`, `subtotal`, `total` e `wholesalePrice` recusados; comprador aprovado faz replay idempotente com o mesmo pedido e total; buyer B e usuário revogado recebem negação, RLS e grants inspecionados.
- **B2B-13:** pedidos **PJ e PF realmente persistidos** em PostgreSQL local; PF HTTP 201, rastreamento via token HTTP 200; PDF privado, WhatsApp interceptado sem envio, e corrida de logout mantêm PASS.
- **Auditoria independente:** total exato de quatro pedidos fictícios (2 varejo — PJ/PF — e 2 B2B), sem pedido no tenant B; `tracking_token_hash` do PF de 64 caracteres; campos ocultos não persistidos.
- **Rollout/rollback:** transação de configuração fictícia revertida e valores preservados, PASS **somente para DML local**. Restore de backup, rollback de Edge/Cloudflare e implantação seletiva da migration 000023 **NOT EVALUATED**.

**Gate de produção: BLOCKED/PARCIAL**, não por falha desta bateria, mas porque faltam homologação de variantes e alguns testes de race ainda não integralmente reproduzidos, ensaio real de recuperação e aprovação humana separada de migration Hosted, merge e deploy. Google Routes continua desativado. Notas abaixo são histórico de revisões anteriores e não substituem este checkpoint.

---

## Evidência incremental atual — 16/10/2026, PR #6

**GATE: PARCIAL — NÃO LIBERADO PARA MERGE.** E2E isolado com Auth/Edge/Chromium/Postgres fictícios [QA #38978436835](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38978436835) e [Quality #38978436776](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38978436776) PASS no SHA `e6057c50054a34cbdaeb3146779ff29b5535072e`. Este resultado é anterior à migration de segurança 000023 e **não a aprova**. A [QA de replay adversarial #38978866418](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38978866418) FAIL na etapa de replay entre tenants; a causa está sob correção em QA e nenhum dado Hosted foi alterado.

| Caso | Cobertura observada nesta revisão | Situação |
| --- | --- | --- |
| B2B-01/02 | Chromium Auth anônimo, pendente, suspenso, rejeitado; catálogo atacado negado | PASS para estados exercitados |
| B2B-03 | Comprador A aprovado, R$20/un, catálogo privado | PASS |
| B2B-04/05 | Quantidade mínima 5 e mínimo financeiro; testes locais de UI/API documentados em 10–11/10, não todos os subcasos adversariais na revisão atual | PARCIAL |
| B2B-06 | Campo oculto `notes` não aparece no browser nem persiste; validação pura de campos opcionais, mas não todos os campos em browser | PARCIAL |
| B2B-07 | Obrigatoriedade real de `companyName`, `email`, `city` na UI; snapshot PJ persistido e regras no SQL; demais regras opcionais não percorridas em browser | PARCIAL |
| B2B-08 | Pedido de 5×R$20 com HTTP 201, pending e auditoria SQL local de comprador A | PASS |
| B2B-09 | Whitelist no gateway e validação SQL; forja de todos os campos não reexecutada no browser da revisão mais recente | PARCIAL |
| B2B-10 | HTTP real: o comprador A aprovado repete a mesma chave e recebe HTTP 201 com o **mesmo ID** e total canônico, sem pedido novo; comprador B com a chave de A recebe 403; revogação A continua negada | PASS no backend local |
| B2B-11 | Mensagem textual `wa.me` efetivamente construída, interceptada em memória, recibo/itens/total oficiais, zero mensagens enviadas e zero PDF na mensagem | PASS do contrato, **não** envio |
| B2B-12 | Buyer B do tenant B negado no catálogo; comprador A revogado negado no catálogo/checkout; replay da chave de A por B bloqueado sob migration 000023, SQL/grants auditados | PASS para casos negativos executados |
| B2B-13 | PF/PJ alternância, pedido PJ real, tracking HTTP 200 e filtro varejo/atacado isolado, sem envio WhatsApp | PASS para jornada PJ; pedido PF persistido não testado |
| RACE-01–04 | Cenários anteriores de status/catálogo/modal Auth documentados em 10–11/10; adicional de resposta real HTTP 201 atrasada no checkout após logout + auditoria SQL PASS no CI atual | PARCIAL no conjunto histórico; checkout in-flight PASS |

**Validação adicional em 16/10/2026 — código SHA `52ac5708fc62120392034e7be0cb701a51e0f837`:** [Quality #38982456344](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38982456344) **SUCCESS** e [Isolated Browser QA #38982456364](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38982456364) **SUCCESS**. No passo local Auth/Edge/SQL, sem novas inserções fora dos três pedidos fictícios esperados: **B2B-04** quantidade 4 rejeitada (produto exige 5, HTTP 400); **B2B-05** total de R$100 rejeitado com mínimo da loja temporariamente ajustado para R$120 em Postgres descartável e restaurado (HTTP 400); **B2B-09** quatro campos de autoridade/valor manipulados (`buyerUserId`, `subtotal`, `total`, `wholesalePrice`) rejeitados (HTTP 400); **B2B-07** email/cidade obrigatórios removidos do payload rejeitados (HTTP 400); **B2B-10** replay do comprador aprovado mesmo ID e total (201), replay cruzado negado (403); **B2B-12** tenant distinto e comprador revogado negados (403). Logs mostram somente marcadores PASS sem PII ou tokens.

**Cobertura ainda PARCIAL:** B2B-04/05 faltam repetir manipulações no *navegador* no mesmo SHA; B2B-06/07 matriz total de campos configuráveis no browser e snapshot; B2B-09 forjas alternativas de identidade/tenant e política de dados adicionais; B2B-13 pedido varejo PF persistido (jornada PJ já testada); cenários RACE-01–04 consolidados de execução antiga não todos repetidos na revisão final. Sem confirmação de restore/drill ou autorização para publicação. O status global continua **PARCIAL, bloqueado para merge/deploy**.

**Atualização observada no código SHA 744c8017:** [Quality #38979475405](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38979475405) SUCCESS e [Browser QA #38979869345](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38979869345) SUCCESS no último HEAD documental (mesmo código). A migração 000023 passou no Supabase local; replay cruzado, revogação e contratos positivos PASS. **Ainda necessários:** subcasos não exercitados em navegador, ensaio de rollback/aceite funcional e autorizações separadas de migração seletiva/merge/deploy. Não inferir aceite integral de testes puramente unitários ou scripts não executados.

---

## 1. Pré-condições obrigatórias (fail-closed)

- [ ] Ambiente Supabase **isolado da produção** disponível, autorizado e com custo aprovado quando aplicável. Branching do Supabase pode depender de plano pago; não provisionar implicitamente.
- [ ] Schema com migrations 000001–000018 e Edge Functions pertinentes, incluindo `submit-order-checkout`, `get-wholesale-catalog`, `submit-wholesale-application` e `manage-wholesale-customer`.
- [ ] Frontend apontando **exclusivamente** ao ambiente isolado, com variáveis públicas adequadas: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_PUBLIC_TENANT_SLUG`. Nunca usar `service_role` no browser nem copiar segredos para CI ou documentação.
- [ ] Dois tenants fictícios distintos (A e B), lojas com regras comerciais independentes, entregas ativas e produtos fictícios com estoque e regras de mínimo B2B.
- [ ] Usuário Auth de teste com `wholesale_customers.status = 'approved'` e `wholesale_customers.user_id` vinculado **no tenant A**. Segundo usuário pendente/bloqueado e usuário ligado ao tenant B para cenários negativos.
- [ ] Ambiente de mensageria neutro. **Não enviar** mensagem real de WhatsApp, e-mail transacional ou pedido comercial durante o teste.
- [ ] Registrar contagem prévia de pedidos **apenas no ambiente isolado**, para confrontar a geração de recibos.

Não executar o happy path B2B com credenciais de um cliente real, nem criar cliente aprovado artificialmente em produção. Se qualquer pré-condição faltar, registrar `BLOCKED`, sem inferir `PASS`.

## 2. Casos de teste do navegador

| ID | Cenário | Resultado esperado |
| --- | --- | --- |
| B2B-01 | Usuário não autenticado tenta abrir a modalidade atacado | Não obtém catálogo/preço privado nem conclui pedido |
| B2B-02 | Usuário autenticado com solicitação pendente ou bloqueada tenta comprar atacado | Acesso e checkout negados |
| B2B-03 | Comprador aprovado do tenant A autentica, seleciona atacado e abre catálogo | Modo atacado liberado; preços somente dos produtos autorizados da loja A |
| B2B-04 | Produto exige quantidade mínima atacadista; informar valor abaixo do mínimo | Interface impede avanço; servidor rejeita tentativa manipulada |
| B2B-05 | Pedido abaixo de `wholesale_min_order_value` | Bloqueio antes da rede e no backend |
| B2B-06 | Checkout com campos opcionais ocultos na política de A | UI omite campos; nenhum valor oculto é persistido no snapshot |
| B2B-07 | Campo opcional configurado como visível/obrigatório (ex.: `email`) | Validação obrigatória respeitada na UI e no servidor |
| B2B-08 | Comprador B2B aprovado conclui o carrinho fictício, revisa e clica CTA | Um pedido `wholesale` em `pending`, com total calculado no banco e recibo válido |
| B2B-09 | Tentar enviar nome, CNPJ, razão social, userId, tenantId ou preço forjados no body | Gateway rejeita campos de autoridade proibidos ou banco ignora identidade comercial fornecida e usa `wholesale_customers` aprovado |
| B2B-10 | Repetir a mesma tentativa com a mesma `idempotency_key` | Retorno do mesmo pedido; sem criação duplicada |
| B2B-11 | Verificar aba do WhatsApp gerada após receipt validado | Mensagem **textual**, itens e valores do recibo oficial; não contém URL de PDF; não clicar em enviar |
| B2B-12 | Sessão do comprador A tenta catálogo/pedido de B; aprovação revogada no backend durante a sessão | Negação server-side, sem vazamento de preços privados/PII; não basta bloquear só na UI |
| B2B-13 | Varejo da mesma loja continua operacional com política padrão | Regressão de PF/PJ, recibo, tracking e filtros preservados |

O teste deve registrar explicitamente resposta de rede HTTP, ausência de dados sensíveis, identificador sintético do pedido (somente no ambiente isolado) e evidência visual **sem PII**. Não salvar JWT, cookies, senhas, PDFs privados, URLs assinadas ou dados de cliente nos artefatos.

### Cenários adicionais — ciclo de sessão B2B (RACE-01 a RACE-04)

| ID | Operação concorrente em navegador QA | Resultado esperado |
| --- | --- | --- |
| RACE-01 | Iniciar consulta de status aprovada e deslogar antes da resposta | Modalidade volta a varejo; resultado atrasado não restaura aprovação nem dados comerciais |
| RACE-02 | Iniciar carregamento de preços do comprador A, alternar para B e só então receber resposta de A | Nenhum preço ou identidade privada de A aparece na sessão de B; pedido de B continua sujeito ao backend |
| RACE-03 | Catálogo B2B aprovado com **zero** produtos atacadistas acessíveis | Sem loop de requisições após resposta vazia; aplicação mantém estado vazio coerente |
| RACE-04 | Abrir modal de confirmação para atacado com carrinho; alterar sessão/revogar acesso antes da confirmação | Confirmar não ativa atacado nem limpa o carrinho por uma aprovação obsoleta |

Registrar pedidos de rede e resultado visual sanitizados, nunca tokens. Testes unitários de versão/Promise ou CI **não** substituem estes quatro testes de navegador.

## 3. Evidências de aceitação

Para cada caso: `PASS` / `FAIL` / `BLOCKED` / `NOT EVALUATED`, data, revisão GitHub testada, ambiente, navegador, pré-condições e resultado observado. Prints sanitizados opcionais; evidência de uma asserção não substitui execução completa do fluxo.

No banco isolado, validar: `shopping_mode='wholesale'`, `buyer_user_id` correto para A, identidade comercial derivada do cadastro aprovado, preço e total oficiais, `status='pending'`, estoque só movimentado quando aplicável ao ciclo de status; garantir que tenant B não lê o pedido de A.

Na finalização, executar o `bun run check` no commit testado e testes SQL transacionais da pasta `supabase/tests/database/` no **ambiente isolado**. Asserções sintéticas no banco principal existentes no histórico não equivalem a happy path autenticado via navegador.

## 4. Baseline verificado em 2026-10-08 (somente leitura)

- Hosted Supabase `vlpwtdqqnecdvccxyodp`: 18 migrations aplicadas, última `20261009020000`; 8 Edge Functions `ACTIVE`.
- Contagem de `public.orders`: 6; `tenant_public_settings`: 1 política válida de 1.
- Cadastros `wholesale_customers` aprovados com `user_id IS NOT NULL`: **0**. Sem identidade autenticável de teste aprovada no conjunto atual.
- RPCs `create_order_checkout_internal` e `get_wholesale_catalog_internal`: `anon_execute=false`, `authenticated_execute=false`, `service_execute=true`.
- Supabase `list_branches` mostrou somente `main` (nenhum Preview dedicado disponível).
- Security Advisor: somente aviso preexistente `auth_leaked_password_protection` desabilitada.
- Esses resultados **não** provam o E2E do navegador. Nenhum pedido foi criado e nenhuma política foi alterada por esta verificação.

## 5. Critério de fechamento

Somente marcar a pendência **B2B E2E CLOSED / RUNTIME PASS** após executar B2B-01–13 no navegador contra ambiente isolado com evidências, confirmar `bun run check`, verificar isolamento de tenant e anexar registro sanitizado em `docs/SESSION_HANDOFF.md`. A validação do Supabase Preview exige ambiente realmente provisionado e testado, não basta criar branch GitHub.

**Itens 5/6:** especificação funcional não consta nas fontes versionadas inspecionadas (`docs/SESSION_HANDOFF.md`, `docs/PROJECT_CONTEXT.md`, `docs/CURRENT_ARCHITECTURE.md` e ADR 012). Não desenvolver sob rótulos 5/6 até haver escopo e critérios de aceitação identificáveis.


Atualização final deste registro: 18 testes de API local PASS; pedido do navegador PED-20261010-000006 confirmado no banco (wholesale/pending/R). Cobertura consolidada PARTIAL, com limites por caso em docs/qa/LOCAL_RUNTIME_20261010.md. RACE com fronteiras reais de navegador e alguns subcasos UI/retail/tracking permanecem pendentes. Inspeção da aba externa WhatsApp foi bloqueada pela revisão automática; nenhum envio efetuado. Sem merge/deploy de produção.


## 6. Matriz reconciliada para pré-release — 2026-10-14

**Status global: PARTIAL / NÃO LIBERADO PARA MERGE.** Evidências abaixo são das execuções locais de **10–11/10/2026** documentadas em `docs/qa/LOCAL_RUNTIME_20261010.md` e `docs/SESSION_HANDOFF.md`. **Não são uma nova execução E2E em 14/10.** O ambiente anterior era Supabase local isolado com Auth/Edge reais, não Preview Hosted. CI de componente é uma camada distinta.

| ID | Evidência documentada | Faltante para aceite integral |
| --- | --- | --- |
| B2B-01 | Anônimo negado no percurso local/API | Reteste na revisão final |
| B2B-02 | Pendente bloqueado na UI; backend nega | Bloqueado/suspenso no navegador e reteste final |
| B2B-03 | Aprovado A com preço R$20 no navegador | Reteste na revisão final |
| B2B-04 | Quantidade mínima 5 na UI e backend | Reteste na revisão final |
| B2B-05 | Mínimo R$500 demonstrado na UI/API | Reteste na revisão final |
| B2B-06 | Parcial: e-mail oculto na UI e dados de backend testados | Demais campos ocultos e snapshot do percurso integral |
| B2B-07 | Parcial: e-mail visível/obrigatório validado UI/backend | Demais campos obrigatórios |
| B2B-08 | Pedido fictício de R$100, atacado/pending confirmado no banco QA | Reteste na revisão final |
| B2B-09 | Forja de identidade/preço negada no HTTP local | Revalidar tenant A/B no head final |
| B2B-10 | Idempotência PASS no HTTP Auth real local | Reteste final |
| B2B-11 | Parcial: mensagem textual sem PDF gerada | Aba externa de atacado não validada; não enviar mensagem |
| B2B-12 | Isolamento A/B/revogação no HTTP + RACE navegador | Cobrir jornada final completa após troca de sessão |
| B2B-13 | Parcial: PF e recibo/tracking reais em QA; PJ até revisão | PJ completo, filtros e tracking em navegador QA |
| RACE-01 | PASS: status RPC atrasado 20s + logout sem reabrir aprovação | Reavaliar se lógica mudar |
| RACE-02 | PASS: catálogo A atrasado 45s + logout/login B, sem preço A | Troca direta A→B só tem teste de componente |
| RACE-03 | PASS observado por 20s: uma chamada com catálogo vazio | Janela observada finita |
| RACE-04 | PASS depois de correção: revogação com modal aberto preserva carrinho | Backend continua sendo controle contra TOCTOU |

**Regressão incremental de 14/10:** seis casos adicionais de componente no `scripts/test-wholesale-context.mjs`: pending/suspended/rejected, falha na revalidação, confirmação duplicada e revogação com catálogo já carregado. CI Quality #59 (https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38656900813) SUCCESS em `de6109d`. O cálculo Google na UI exige `VITE_GOOGLE_ROUTES_UI_ENABLED === 'true'`; sem opt-in fica oculto. Quality #62 (https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38657056819) SUCCESS em `a44e7a6`. **Nenhum navegador com Auth real foi executado nesta rodada.**

**Hosted somente leitura (14/10):** 20 migrations, versões 000019/000020 alinhadas; 6 pedidos, 520 produtos; `anon` sem SELECT em `wholesale_tiers`; 1 configuração privada de entrega, `estimateEnabled=false`. Migrations de Google Routes/Edge Function de estimativa ainda não aplicadas/publicadas. Não criar comprador ou pedidos artificiais em Hosted.

**Gate de conclusão:** reexecutar os subcasos pendentes em browser QA contra Supabase local isolado atualizado, registrar HTTP/estado final e evidência sanitizada; depois reavaliar issue #4 e decisão de release. Não declarar a matriz integral PASS com CI de componente.


## 7. Retomada browser QA automatizável — 2026-10-14/15

**GATE: BLOCKED para conclusão E2E nesta sessão.** A estação Windows/WSL da validação de 10–11/10 não está montada neste runtime; não há checkout local do repositório, Supabase CLI/serviços Docker ou Auth fixtures da QA anterior. Chromium e Python Playwright estão presentes, mas **isso não cria o aplicativo nem o backend isolado**. A sessão atual pode consultar GitHub privado e Supabase **Hosted produção**; este último não deve receber dados de teste. Nenhum cenário de navegador com backend real foi executado aqui. Não contar esse bloqueio como FAIL de código ou como PASS de E2E.

Criado no PR #6: `scripts/qa-browser/test_b2b_access_browser.py`, roteiro automatizado read-only para Chromium via Python Playwright. Testa B2B-01 anônimo e B2B-02 nas três contas fictícias distintas (`pending`, `suspended` e `rejected`) por login visual/consulta de status/negativa de atacado. O script **recusa** URLs que não sejam localhost/127.0.0.1/::1, aborta qualquer requisição HTTP(S) externa antes de prosseguir, não cria pedidos, não navega ao WhatsApp e não publica credenciais no log. Por desenho, **não cobre** os subcasos restantes B2B-03–13 nem RACE-01–04. O passo adicional no Quality apenas verifica sintaxe Python; **não** executa a QA Browser sem fixtures.

### Execução reproduzível na estação QA isolada anterior

1. Recuperar a branch atual do PR #6 na estação Windows/WSL; inicializar **somente** Supabase local e os dois tenants/usuários fictícios conforme `docs/qa/LOCAL_RUNTIME_20261010.md`, sem vincular o projeto Hosted. Conferir Postgres 17, funções de Auth e as migrations locais conforme requisitos do checkout; mudanças específicas de Google podem ficar desativadas para a bateria B2B.
2. Iniciar o frontend Vite apontado exclusivamente à URL local do Supabase. Conferir no navegador a ausência de chamadas a `*.supabase.co` e outras origens externas. Sem serviço local/fixtures, registrar BLOCKED; não alterar URL para produção para fazer o teste passar.
3. Instalar Playwright Python e Chromium na estação QA se ainda não existentes (`python -m pip install playwright`; `python -m playwright install chromium`). Definir as variáveis de ambiente somente na sessão local, nunca commitar credenciais ou colocá-las em issues:
   - `QA_BASE_URL=http://127.0.0.1:3000` (ou a porta Vite local efetiva)
   - `QA_SUPABASE_URL=http://127.0.0.1:54321`
   - `QA_B2B_PENDING_EMAIL` / `QA_B2B_PENDING_PASSWORD`
   - `QA_B2B_SUSPENDED_EMAIL` / `QA_B2B_SUSPENDED_PASSWORD`
   - `QA_B2B_REJECTED_EMAIL` / `QA_B2B_REJECTED_PASSWORD`
   - Opcional: `QA_CHROMIUM_EXECUTABLE` apontando ao Chromium da estação.
4. Executar `python scripts/qa-browser/test_b2b_access_browser.py`. Registrar somente PASS/FAIL/BLOCKED e revisão de HEAD (não salvar URLs de pedidos, JWT, senhas, screenshot com PII ou tokens). O teste nunca deve ser redirecionado para Cloudflare ou Hosted. Se uma fixture não existir ou qualquer URL não for local, ele falha fechado (BLOCKED).
5. Concluir manualmente/em navegador QA os subcasos B2B-06/07, 11, 12, 13 ainda incompletos; conferir criação de pedido apenas com fixture local e aceitação explícita de abertura da URL WhatsApp sintética, sem envio. Registrar observação de requests/DB e controle de isolamento por tenant. Atualizar a matriz e somente então reconsiderar o gate para merge.

**Importante:** não inserir scripts Playwright de login Auth com credenciais em CI público e não publicar a instância QA Docker no domínio produtivo. Este roteiro sozinho **não** fecha a matriz B2B.


## 8. Continuação de QA — PF/PJ somente leitura (2026-10-14)

Esta sessão **não reativou** o backend Supabase QA local (as portas 3000/5173/54321 estão indisponíveis). O Chromium instalado pôde iniciar, porém o navegador foi bloqueado com `ERR_BLOCKED_BY_ADMINISTRATOR` ao navegar inclusive para um servidor temporário em `127.0.0.1`. Não substituir por produção ou forçar o bloqueio. Nenhum teste E2E Auth/Edge de B2B-01–13 foi executado nesta sessão; permanecem os PASS históricos de 10–11/10 no ambiente/revisão anteriores.

Foi adicionado `scripts/qa-browser/test_retail_identity_browser.py`, um teste Chromium **sem envio de pedido**: visita frontend/Supabase estritamente loopback, usa produto fictício disponível na vitrine, entra no checkout de varejo, alterna PF→PJ→PF, valida campos CPF/CNPJ/razão social e afirma que não houve `submit-order-checkout`, consulta privada B2B ou request a origin externo. O script reutiliza o guard de rede do runner B2B. Este subcaso cobrirá **apenas a UI de B2B-13**, não o pedido PJ, rastreamento, filtros ou o fluxo geral. Depende de produto/estoque, política default da loja e mínimo de varejo compatível em QA; se pré-condição falhar, marcar BLOCKED em vez de alterar a produção.

O pipeline Quality verifica `python3 -m py_compile` de ambos os scripts, mas **não** inicia um navegador nem provê banco/usuários. Para executar na estação QA anterior, configurar `QA_BASE_URL` e `QA_SUPABASE_URL` exclusivamente localhost, iniciar frontend+Supabase isolados com fixtures fictícias e usar:

```bash
python scripts/qa-browser/test_retail_identity_browser.py
python scripts/qa-browser/test_b2b_access_browser.py
```

O segundo script exige `QA_B2B_PENDING_*`, `QA_B2B_SUSPENDED_*` e `QA_B2B_REJECTED_*` fornecidos **somente na sessão privada** do ambiente QA, nunca em CI/repositório. Para ambos, registrar resultado efetivo, HEAD testado e evidências sanitizadas. Sem execução real, o status global continua **PARTIAL / BLOCKED**, e o PR #6 permanece sem autorização de merge.


## 9. Execução seletiva e contrato de segurança do runner — 2026-10-14

A execução padrão de `test_b2b_access_browser.py` continua cobrindo os quatro cenários (`anon,pending,suspended,rejected`), com fixtures obrigatórias para as três identidades. Para executar apenas um subconjunto na estação QA isolada, usar `QA_B2B_CASES` com nomes separados por vírgula. Exemplo: `QA_B2B_CASES=anon` não exige login nem senhas; `QA_B2B_CASES=pending,suspended` exige somente as duas contas sintéticas correspondentes. Valores desconhecidos, lista vazia e duplicatas falham fechado. **Executar somente um subconjunto não altera o status dos casos não executados: permanecem NOT EVALUATED.**

Os dois runners recusam URLs de frontend/backend fora das origens HTTP(S) loopback explícitas. A sessão Playwright bloqueia Service Workers e intercepta HTTP(S) e WebSockets para impedir conexões *diretas* a origens que não sejam as duas origens QA configuradas. Requer Playwright Python **1.48+** para interceptação de WebSockets. Os testes de contrato em `scripts/qa-browser/test_browser_preflight.py` validam seleção, preflight de origem e interceptação de HTTP/WebSocket sem executar navegador, usar credenciais ou tocar em rede. O Quality executa esses testes Python stdlib após `bun run check`.

**Limitação importante:** o interceptador Playwright não equivale a firewall de rede/namespace. A própria documentação Playwright informa que redirecionamentos podem ser seguidos após a primeira requisição roteada. Portanto a QA efetiva precisa também permanecer em ambiente de rede isolado de produção (sem secrets/URL Hosted), e a execução do browser com Auth real continua sendo uma etapa separada. Referências: https://playwright.dev/python/docs/network e https://playwright.dev/python/docs/api/class-browsercontext .

**Escopo da evidência:** sucesso de `python3 -m unittest discover -s scripts/qa-browser -p 'test_browser_preflight.py' -v` comprova regras dos runners em objetos sintéticos, **não** B2B-01–13, login real, RLS, checkout ou tracking de navegador. Nenhuma autorização implícita de merge ou deploy.


## 10. Revisão PF/PJ e matriz de campos — 2026-10-14

- **Correção funcional na branch QA:** a mudança de comprador varejo PJ→PF limpa o CNPJ anterior, a razão social mantida em memória e os respectivos erros de validação; a mudança PF→PJ limpa CPF anterior. Reescolher o mesmo tipo conserva o documento já digitado. Mudança localizada em `src/components/storefront/CartDrawer.tsx`; regressão estrutural `81s` em `scripts/test-orders-frontend-integration-points.ts`.
- **Quality #98 SUCCESS** na revisão estável pós-remoção de harness React DOM experimental e **Quality #100 SUCCESS** incluindo limpeza da razão social PF. **Quality #101 SUCCESS** ([run](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38671426663), commit `96833a92e0ab94d90341a460f9d27f38ea2cbfa6`) com `bun run check`: 40 validações de regras de ocultação/obrigatoriedade para 10 campos opcionais em `scripts/test-checkout-fields.ts` (varejo PJ e atacado B2B, incluindo ausência de required em campos inaplicáveis), 14/14 React DOM sintéticos B2B e 5/5 testes de preflight Python.
- **Limite exato da evidência:** regras `parseCheckoutFields`, `checkoutRequiredErrors` e `projectCheckoutValues` verificadas em testes puros; alternância PF/PJ e cleanup de razão social garantidos somente por regressão estrutural de wiring do componente. **Não houve novo teste de navegação/checkout persistido com navegador e Supabase Auth local**, nem foi verificada a matriz completa de campos dinâmicos no DOM. O teste experimental `test-retail-document-switch.mjs` foi removido por execução de CI inconclusiva; não contá-lo como PASS.
- **Gate B2B-06/07** continua PARTIAL no nível E2E: visitar checkout com configurações de campos reais alteradas na instância local isolada e verificar visibilidade, validação inline e projeção/persistência. **Gate B2B-13** continua PARTIAL: alternância PF/PJ, pedido PJ fictício, filtros e tracking em navegador. Não usar Supabase Hosted para fixtures ou pedidos de teste, não fazer merge/deploy e manter Google Routes desativado.


## 11. Recibo vinculado ao pedido original após popup fechado — 2026-10-14

- **Falha de consistência identificada por revisão do fluxo:** após `submitOrderCheckout` criar o pedido, se a aba neutra do WhatsApp fosse fechada, `createdOrder` era preservado sem vinculação ao conteúdo do `draft`. Em nova tentativa, dados/carrinho/usuário podiam estar diferentes e o mesmo recibo seria reutilizado para handoff. **Não há evidência de exploração nem de ocorrência em produção**; código era alcançável a partir do ramo `if (prepWindow.closed)`.
- **Mitigação na branch:** `CartDrawer` guarda em memória somente o SHA-256 da intenção associada ao recibo, por `computeOrderFingerprint(draft, user?.id || 'anonymous')`. Uma nova tentativa reutiliza `createdOrder` apenas quando o hash canônico permanece igual; alterações de usuário, tenant, modalidade, itens, dados de contato, endereço ou pagamento impedem a reutilização, com mensagem de erro e sem redirecionar a janela para WhatsApp. `resetCheckoutLifecycle` apaga o vínculo. A Edge Function permanece a fonte autoritativa do recibo e da idempotência.
- **Verificação executada:** [Quality #107](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38672256780) **SUCCESS**, incluindo asserção estrutural `67c` e casos criptográficos com variação de usuário/tenant/endereço/pagamento/contato/itens/modalidade; 14/14 DOM sintético de autorização, 40 regras de campos e 5/5 preflight Python. **Não** houve browser com popup, Auth real nem pedido real nesta rodada.
- **Gate ainda pendente:** caso de aba fechada/retry com mesmo `draft`, alteração do `draft` entre tentativas e troca de login durante a criação do pedido devem ser cobertos no navegador QA isolado. O hash no frontend **não substitui** autorização no servidor ou isolamento entre sessões em toda a aplicação. Sem merge/deploy/Google Routes até conclusão de aceite.


## 12. Execução de navegador solicitada — pré-flight 2026-10-14

- **Autorização:** o usuário solicitou executar com navegador real e Supabase local isolado os casos restantes B2B, popup WhatsApp fechado, retry sem duplicidade, edição de draft e troca de usuário durante request. Escopo não inclui banco Hosted, merge, deploy Cloudflare, Google Routes ou contatos comerciais reais.
- **Pré-flight realmente executado nesta sessão:** checkout local do repositório não montado; `bun`, Docker e Supabase CLI não encontrados. Portas loopback `3000`, `5173`, `54321` e `54322` sem serviço. Chromium abriu, mas `Page.goto(data:text/html,...)` falhou com `net::ERR_BLOCKED_BY_ADMINISTRATOR`. A estação QA anterior (Windows/WSL + Rancher Desktop) não está acessível. Por isso, **nenhum E2E com navegador/Supabase Auth real foi executado**.
- **Entregue no PR:** `scripts/qa-browser/test_retail_identity_browser.py` agora digita CNPJ e razão social fictícios, troca PJ→PF, comprova campos invisíveis/vazios, volta a PJ comprovando não retenção, digita CPF fictício e repete PF→PJ→PF comprovando CPF vazio. Não cria pedido, não navega ao WhatsApp nem toca em produção. [Quality #111](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38672959324) **SUCCESS** no commit `05ac5b59`, validando sintaxe e suite de testes; **não** executa o browser.
- **Não entregue/NOT EVALUATED:** tentativa de acrescentar um novo runner para o fechamento/retry do popup não pôde ser gravada pelo conector. Os casos de WhatsApp, criação PJ, troca de sessão durante pedido, filtros, B2B-06/07 integrais e B2B-02 bloqueado permanecem para execução real, não receber status PASS por testes de hash/componente.
- **Retomada segura:** na estação QA anterior, usar a branch atual do PR #6, o Supabase local isolado e os fixtures sintéticos **sem vínculo Hosted** descritos em `docs/qa/LOCAL_RUNTIME_20261010.md`. Apontar `QA_BASE_URL` e `QA_SUPABASE_URL` estritamente para loopback; `QA_B2B_CASES=anon` permite a primeira checagem sem senha. Após disponibilizar identidades fictícias, executar os demais casos selecionados e o teste PF/PJ, guardar só resultados sanitizados. O fluxo WhatsApp deve usar apenas pedido/contato fictício, **sem envio de mensagem**, e testes de sessão pendente devem conferir o banco QA, não mexer no Hosted.
- **Gate:** PR #6 permanece OPEN, homologação B2B total **PARTIAL/BLOCKED**. Não aprovar publicação por Quality PASS.


## 13. Ambiente CI isolado e E2E Auth/browser reais — 2026-10-15

- **Bloqueio Windows/WSL superado para subcasos automatizados:** `.github/workflows/qa-isolated.yml` inicia Supabase local no runner Ubuntu com Docker e rede bind loopback, copia o projeto, substitui **apenas no filesystem descartável da execução** o catálogo oficial (migration 000002) por **2 tenants, 2 produtos QA**, aplica configurações pós-migration somente via overlay SQL temporário, e cria 5 usuários fictícios via Auth local. Não faz `supabase link` nem acessa Hosted; migration Google removida só na cópia local; nenhum pedido gerado nesses testes.
- **Verificado por execução real:** [Isolated Browser QA #10](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38676386325) **SUCCESS**. Log de Chrome/Playwright + Supabase local: `anon`, `pending`, `suspended`, `rejected`, `approved_a`, `approved_b` PASS. A aprovado na loja A exibiu catálogo/preço B2B R$20; comprador B aprovado somente no tenant B recebeu `not_registered` na loja A, sem catálogo privado. `test_retail_identity_browser.py` também PASS em formulário PF→PJ→PF sem manter CPF/CNPJ/razão social. São E2E **reais de browser+Auth/Edge local**, diferentemente de `py_compile`/jsdom.
- **Nova proteção em homologação:** `CartDrawer` guarda identidade de usuário + loja, limpa formulário/recibo em troca de identidade e rejeita resposta tardia de confirmação. Regressão estrutural `67d` incluída; [Quality #127](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38676812485) **SUCCESS** no código. A reexecução de browser dessa alteração depende do Isolated Browser QA #12; teste específico de troca de sessão durante `await` **ainda NÃO foi executado**.
- **Restante da matriz NÃO HOMOLOGADO integralmente:** B2B-06/07 todas as regras de campos no navegador e banco, B2B-11 popup de saída fechado/reaberto/retry e interceptação sem envio, B2B-13 pedido varejo PJ completo/recibo/tracking/filtros, B2B-12 troca de identidade durante envio, e outros subcasos autenticados pós-submit. O pedido original de runner adicional para criação de pedido fictício local foi bloqueado pelo conector; **nenhum runner de submissão foi criado nem executado**. Não interpretar estes casos como PASS.
- **Isolamento de testes:** arquivos substituídos em CI não são versionados como migrations produtivas; QA se baseia em dados fictícios, não autentica com clientes reais, não usa chaves ou requests Google/WhatsApp e não publica frontend. GitHub Actions de repositório privado consome minutos da cota do proprietário; manter timeout máximo de 20 min e evitar execuções repetidas desnecessárias.


## 14. E2E transacional de checkout e handoff WhatsApp — 2026-10-15

- **EVIDÊNCIA REAL:** [Isolated Browser QA #37](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38831184711) **SUCCESS** no commit de implementação `c62c65bb8ecff269f807224cfd7f3ec24114a13d`. [Quality #152](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38831184718) **SUCCESS**. Runtime: Chromium real + Vite + Edge Function + Auth/PostgreSQL de Supabase local **descartável**, dois tenants/produtos QA e usuários fictícios. Nenhuma chamada WhatsApp/Google ou banco Hosted.
- **Caso transacional aprovado em navegador:** `scripts/qa-browser/test_checkout_transaction_browser.py` enviou um único pedido fictício de **varejo PJ** pela função `submit-order-checkout`, obteve **HTTP 201** e recibo canônico, fechou `about:blank` após `window.open`, verificou banner `Pedido registrado`, clicou novamente com o mesmo draft **sem segunda chamada ao submit**, editou o contato e verificou bloqueio `stale-receipt` sem reenviar, restaurou o contato original e capturou somente em memória a URL `https://wa.me/...` destinada a número **fictício**. Foram comprovados domínio, número sintético, número do pedido, nome do produto e total, sem CNPJ completo. **Não foi aberta conversa externa nem enviada mensagem.**
- **Persistência independente:** `scripts/qa-browser/assert_local_order.sh` validou via `docker exec ... psql` no banco local a existência de **exatamente 1** pedido, tenant correto, `shopping_mode=retail`, `status=pending`, `total>0`, itens JSON e hash de token de tracking. PASS. A tentativa inicial de inspeção usando PostgREST + `service_role` retornou `42501`, restrição válida que foi preservada; **nenhum GRANT/RLS ampliado**.
- **Correção descoberta pela QA real:** a primeira execução persistiu o pedido mas frontend rejeitou `documentUrl` da resposta. `supabase/functions/submit-order-checkout/index.ts` agora normaliza URL assinada do Storage para a origem oficial `SUPABASE_URL` permitida, validando caminho de bucket privado; o recibo pode carregar `documentUrl=null` se o documento não estiver disponível. O teste passou sem exigir URL de PDF. **Ainda não é evidência de geração/download de PDF**.
- **Outros PASS preservados no #37:** seis cenários browser B2B (`anon,pending,suspended,rejected,approved_a,approved_b`), isolamento entre tenants, checkout atacado até review sem submit, PF/PJ sem ressuscitar documento/razão social e regras de campos opcionais/obrigatórios no navegador.
- **PENDENTE para matriz completa e liberação de release:** corrida de **troca de identidade DURANTE** a resposta de `submit-order-checkout` (há proteção e regressão estrutural, mas não teste E2E controlado); rastreamento/filtros end-to-end de pedido PJ; submissão de pedido **B2B aprovado** no backend e sua listagem; teste real de documento PDF quando disponível. Handoff `wa.me` é um **link com texto pré-preenchido**, não envio automático verificável; o comprador precisa confirmar manualmente no WhatsApp. Publicação/merge e Google Routes continuam fora do escopo autorizado.
