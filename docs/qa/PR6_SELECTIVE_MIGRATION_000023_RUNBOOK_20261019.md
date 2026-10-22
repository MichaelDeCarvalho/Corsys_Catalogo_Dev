# PR #6 — Runbook de migração seletiva 000023 (19/10/2026)

**Estado:** PREPARADO PARA REVISÃO, **NÃO AUTORIZADO**. Este runbook não concede permissão para executar comandos contra o Supabase Hosted, alterar histórico ou mesclar/publicar código. Requer revisão humana, responsável DBA, backup e janelas específicas.

## Escopo e riscos

A única migration pretendida é:
`supabase/migrations/20261016000000_000023_checkout_idempotency_buyer_guard.sql`.

Ela instala proteção de idempotência por comprador atacadista: move a função antiga `public.create_order_checkout_internal(...)` ao schema `private`, remove permissão direta de papéis API e recria wrapper `public` com aprovação atual, comparação de comprador/modalidade e lock por tenant/chave. **É DDL transacional, não rollback automático.** Exige permissão suficiente para ALTER FUNCTION, CREATE FUNCTION, REVOKE e GRANT. Não editar/reaplicar migrations 000018–000020.

**Exclusões absolutas:** `20261011032224_google_routes_usage_limits.sql` e `20261011035235_google_routes_burst_protection.sql`, função `estimate-delivery`, API paga Google e flags de habilitação. Elas permanecem pendentes Hosted segundo último handoff. **NÃO** executar `supabase db push`, `supabase migration up --linked` nem `--include-all` com a pasta completa do PR: o CLI compara todo o diretório local com `supabase_migrations.schema_migrations` e poderia instalar Google involuntariamente. <https://supabase.com/docs/guides/deployment/database-migrations>

## Gate de backup após ensaio local — 19/10/2026

O CI do código `fa964f99` passou no [Browser QA #39342161033](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39342161033) com dump/restore lógico de dados sintéticos e preservação do banco original, conforme `docs/qa/PR6_RECOVERY_EVIDENCE_20261019.md`. O restore local **não** reproduziu ownership/grants e não incluiu Storage físico/Realtime; **não satisfaz** o pré-requisito deste runbook para aplicar a migration em Hosted. Antes de qualquer autorização de escrita, exigir staging recuperável, recuperação de ACL/roles, Storage e RTO/RPO reais.

---

## Aprovações e preflight (somente leitura)

- [ ] Autorização separada e registrada para **migração de banco Hosted 000023**, explicitando ambiente/projeto, janela, executor, contingência e custo. Autorizações de QA **não valem**.
- [ ] Confirmar backup/restauração praticáveis, responsável por restaurar e último estado saudável; simular no ambiente de staging restaurado antes do Hosted. Plano de rollback de aplicação/Edge e flags fechado.
- [ ] Conferir SHA do SQL e seu diff contra o artefato homologado; exigir inexistência de alteração não revisada na 000023.
- [ ] Confirmar por leitura no Hosted que versões 000018, 000019 e 000020 constam em `supabase_migrations.schema_migrations` e objetos/políticas correspondem; 000023 **não** consta. Se ocorrer divergência, **PARAR**, não ajustar tracking por suposição.
- [ ] Confirmar por leitura que migrations Google de 20261011 não estão marcadas/efetivas; se estiverem, **PARAR** e reconciliar antes de qualquer publicação.
- [ ] Verificar schema `private` existente, `public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)` presente, `private.create_order_checkout_internal(...)` ausente e grants atuais; investigar dependências de `public` antes de mover a função.
- [ ] Confirmar tráfego de checkout controlável e comportamento esperado de novas chamadas durante DDL; bloquear release se houver alteração imprevista de privilégios, filas ou clientes.

Consultas de referência **read-only** (executar somente com conexão autenticada selecionada explicitamente e aprovação de leitura adequada; não registrar credenciais):

```sql
SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version IN (
  '20261009020000', '20261009030000', '20261010000000',
  '20261011032224', '20261011035235', '20261016000000'
)
ORDER BY version;

SELECT
  to_regprocedure('public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)') AS checkout_public,
  to_regprocedure('private.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)') AS checkout_private;

SELECT
  has_function_privilege('anon', 'public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)', 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', 'public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)', 'EXECUTE') AS user_execute,
  has_function_privilege('service_role', 'public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)', 'EXECUTE') AS service_execute;
```

A consulta a privilégios pressupõe existência da função pública (pré-requisito anterior). A estrutura exata da tabela de migrations e suas versões deve ser confirmada, não presumida; `supabase migration list` documenta reconciliação de histórico. <https://supabase.com/docs/reference/cli/supabase-migration-list>

## Procedimento autorizado FUTURO (não executar nesta etapa)

1. Congelar commit/testes e observar ambiente, backup, aprovações e funções em uso. **Se faltou qualquer preflight: abortar.**
2. Em sessão administrativa supervisionada conectada **ao projeto explicitamente aprovado**, executar **somente** o conteúdo integral da migration 000023 revisada, de forma transacional como escrita (`BEGIN` e `COMMIT` já estão no SQL). Nunca copiar a pasta inteira, nem executar a pasta Google. Não combinar com DDL extra.
3. Verificar imediatamente por leitura: função antiga somente em `private` e sem EXECUTE para `PUBLIC/anon/authenticated/service_role`; wrapper `public` executável somente por `service_role`; tenant/buyer guard preservado, migrations Google ausentes; pedidos e contagens inalterados.
4. Fazer smoke test negativo e positivo **sem criar pedido real artificial**: em staging de backup, testar replay autorizado/cruzado e revogação; em Hosted, apenas observabilidade permitida e fluxo legitimamente autorizado. Se anomalia: conter exposição e proceder ao plano de remediação forward-only.
5. **Atenção: histórico Supabase.** Aplicação SQL manual **não** significa automaticamente registro na tabela `supabase_migrations.schema_migrations`. Segundo documentação oficial, `supabase migration repair --status applied 20261016000000` modifica **apenas** o histórico, **não** executa SQL. Essa ação só deve ser considerada mediante autorização própria **de escrita no histórico** e depois de confirmar que todos os efeitos da 000023 foram realmente aplicados. Nunca marcar 000021/000022 como aplicadas se não foram. Não executar repair para ocultar divergências. <https://supabase.com/docs/guides/deployment/database-migrations>
6. Antes de futuro merge/deploy, revisar o mecanismo de migrations automáticas (Supabase GitHub Integration, deploy workflows, branch pipeline). Se executar `db push`/aplicar *todas* as pendentes, o PR **continua impedido de merge** mesmo depois de 000023 manual. Desacoplar Google em PR/branch separado ou instalar trava verificada contra publicação.
7. Registrar em ADR, Security Register e handoff: SHA da migration, evidência do banco, histórico e aprovação, efeitos de recovery, incidentes e próxima ação. Sem registrar tokens/senhas.

## Abort/rollback e escopo de confiança

- **Falha antes de COMMIT**: transação pode reverter DDL; verificar estado do banco antes de repetir.
- **Falha após COMMIT**: não improvisar `DROP FUNCTION`, desfazer 000018, mudar grants em produção sem revisão ou apagar pedidos. Conter acesso no gateway, coletar evidência e aprovar uma correção forward-only que respeite a identidade dos objetos e dependências.
- **Backup/restore**: ensaio com snapshot isolado, RTO/RPO e responsáveis deve ser feito separadamente; o mini-drill de UPDATE/ROLLBACK local provou apenas reversão de configuração fictícia, **não** recuperação de dados Hosted.
- **Deploy Cloudflare/Edge**: também exige autorização distinta. Não há merge automático autorizado, nem possibilidade de considerar a QA local como smoke em produção.

**Decisão do gate:** 000023 apta para análise de implantação **somente após preflight**, sem permissão de execução. Google fora de escopo.
