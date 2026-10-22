## Gate autorizado de preparação — 21/10/2026 (Supabase Free; sem escrita Hosted)

**Autorização recebida:** preparar a implantação seletiva da `000023` no projeto `vlpwtdqqnecdvccxyodp`, condicionada à confirmação de backup recuperável e com Google Routes desligado. **Não autoriza contornar a condição, `db push` indiscriminado, merge ou deploy.**

### Evidência confirmada nesta revisão

- Projeto `Corsys_Catalogo` ACTIVE_HEALTHY, organização no plano **free**; backups diários automáticos não são fornecidos para Free, conforme documentação oficial [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups). **Nenhum backup Hosted recuperável foi identificado/inspecionado.**
- Banco Hosted somente leitura: **20 migrations**, incluindo 000018/19/20; `000023` e as duas Google **ausentes**. `public.create_order_checkout_internal` presente e `private.create_order_checkout_internal` ausente; papel `service_role` tem EXECUTE na função pública, `anon` e `authenticated` não têm. Dependências estáticas registradas: 0; isso não descarta dependências dinâmicas.
- Snapshot de contagem: **520 produtos, 6 pedidos, 2 usuários Auth, 105 objetos Storage**, 0 compradores atacadistas aprovados. O dado dos objetos Storage é **metadado**, não cópia dos arquivos.
- PR #6 HEAD `62895fa97c3d92060e22cf7d9102fa0218494ce8`: GitHub Actions **Quality, Isolated Browser QA e Isolated Staging Recovery 000023 = SUCCESS**. O arquivo SQL 000023 é o já testado, não modificado neste checkpoint.
- Branch `hold/google-routes-after-pr6-20261021` preserva o código Google, ausente da candidata ao release. Não reintroduzir dependências pagas.

### Recuperação obrigatória ANTES da execução de 000023

1. Gerar **backup lógico verificável** do Hosted em ambiente operacional confiável, usando os recursos oficiais da CLI Supabase para exportar **roles, schema e dados**, com armazenamento privado criptografado e controle de acesso; não enviar credenciais, SQL contendo dados pessoais ou dumps ao GitHub/ChatGPT. Instruções oficiais: [Restore a Platform Project to Self-Hosted](https://supabase.com/docs/guides/self-hosting/restore-from-platform) e [Database Backups](https://supabase.com/docs/guides/platform/backups).
2. Exportar **separadamente todos os arquivos reais** dos buckets Supabase Storage (atualmente 105 registros em `storage.objects`), manter inventário e validar a capacidade de restauração; o dump SQL **não** copia os arquivos binários. [Download Objects](https://supabase.com/docs/guides/storage/management/download-objects).
3. Restaurar o backup lógico numa instância descartável compatível, validar dados, Auth, RLS, owner/ACL/grants, integridade e consultas/autorização críticas; verificar separadamente restauração de ao menos os objetos Storage críticos. Registrar responsável, destino privado, horário, retenção, janela aceita de perda (RPO), duração medida (RTO) e procedimentos de contingência. Não reverter ou recriar o banco produtivo como ensaio.
4. Confirmar integrações automáticas Supabase/Cloudflare e plano de contenção/rollback **antes de tocar produção**. Exigir aprovação específica do executor, janela e plano de recuperação. Somente então revalidar o preflight Hosted, executar **a migration SQL exata** 000023 de forma seletiva e transacional por procedimento aprovado, validar grants/objetos/contagens e reconciliar histórico **somente se comprovado**. Google permanece excluído.

**Conclusão do gate: BLOQUEADO PARA DDL HOSTED** por falta de evidência de backup/restauração; nenhuma migration aplicada, nenhuma credencial consultada, nenhum dado alterado. A autorização de preparação já está registrada; não confundir com autorização para eliminar os pré-requisitos.

---

## Checkpoint — isolamento do Google no release PR #6 (21/10/2026)

Para impedir aplicação acidental de migrations pagas na publicação do checkout, as migrations de uso/rajada Google, a Edge Function `estimate-delivery`, seu registro em `supabase/config.toml` e dois testes SQL dependentes foram retirados **desta branch**. O snapshot completo pré-separação foi preservado na branch `hold/google-routes-after-pr6-20261021`, SHA `277ff2169726a1daecef72de487fdf3944345912`. O código compartilhado/UI de estimativa continua inativo por padrão, sem endpoint instalado por este PR. `scripts/qa-browser/test_release_safety.py` agora **falha** se qualquer arquivo pago excluído reaparecer. Esta separação reduz risco de deploy acidental, mas **não comprova** estado do painel Cloudflare/Supabase Integration.

Read-back Hosted somente leitura na conta e projeto `vlpwtdqqnecdvccxyodp` em 21/10: migrations 000018/19/20 presentes; 000023 e migrations Google ausentes. `public.create_order_checkout_internal` existe com EXECUTE apenas service_role, `private.create_order_checkout_internal` ausente, `private` schema presente, dependências de catálogo da função: 0 (não exclui referências dinâmicas). `wholesale_tiers` sem SELECT anon nem política pública. 520 produtos e 6 pedidos preservados. Nenhuma escrita efetuada. Isto é um **preflight pontual**, não autorização nem prova de recuperação Hosted. Confirmar novamente imediatamente antes de qualquer execução.

**Ainda BLOQUEADO para release:** comprovação de backup/restauração Hosted (ACL/ownership/Storage/Realtime/PITR e RTO/RPO), revisão de integrações automáticas, aprovação separada da migration 000023 e autorização distinta para merge/deploy. Não fazer `db push` sem reconciliação; remover SQL Google da branch não substitui preflight de migrations/histórico. O ensaio isolado `STAGING-000023 PASS` (21/10) não restaura integralmente um projeto Supabase Hosted.

---

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
