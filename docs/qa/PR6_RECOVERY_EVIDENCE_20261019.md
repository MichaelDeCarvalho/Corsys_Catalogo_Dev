# PR #6 — Evidência e cobertura de recuperação (19/10/2026)

**Status do ensaio local:** PASS. **Status de recuperação da produção:** NOT EVALUATED / RELEASE BLOCKED.

## Evidência auditável

- **Código aprovado:** `fa964f9918757ebfd89c03c505707bc43ea190ac`.
- **Quality:** [#39342161192](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39342161192) — SUCCESS.
- **Isolated Browser QA:** [#39342161033](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39342161033) — SUCCESS, incluindo `LOCAL-RESTORE PASS`.
- **Automação:** `scripts/qa-browser/drill_local_backup_restore.sh` executada **após** todos os checkouts de teste e auditorias. Banco de origem: Supabase local descartável em `127.0.0.1:54321`; restauração em um **segundo banco temporário** dentro do mesmo contêiner. O dump não foi exportado como artefato, exibido em logs ou enviado ao Hosted.
- **Falhas anteriores diagnosticadas:** a primeira versão usou uma coluna `id` inexistente na configuração do tenant; outra tentou restaurar ownership `supabase_admin` sem capacidade de `SET ROLE`. O teste final limita o escopo aos schemas selecionados e usa `--no-owner --no-acl`; tentativas anteriores falhas NÃO constituem validação de recuperação.

## Matriz de cobertura

| Controle | Evidência final | Estado |
| --- | --- | --- |
| Backup lógico local | `pg_dump` custom dentro do contêiner de QA, schemas `public`, `private`, `auth` e `extensions` | PASS |
| Restore em destino distinto | `pg_restore` transacional para banco temporário isolado, sem tocar em `postgres` | PASS |
| Pedidos | Contagem exata de 4 pedidos fictícios + digest do conteúdo canônico comparado entre origem e cópia | PASS |
| Tenant e comprador | Digests de `wholesale_customers`, `tenant_public_settings` e `auth.users` coincidentes | PASS |
| Isolamento RLS de pedidos | Flag `relrowsecurity` no objeto `public.orders` conferida após restore | PASS para flag; **não prova políticas, grants ou execução sob papéis distintos** |
| Função de checkout | Existência da assinatura pública conferida e grants da origem exigidos como `anon=false`, `authenticated=false`, `service_role=true` | PASS na origem; **ACL na cópia não validada** |
| Banco original | Digest final novamente comparado à origem antes do dump | PASS, original preservado |
| Ownership/ACL completos | `--no-owner --no-acl` intencional para contornar papéis administrativos do ambiente temporário | NOT EVALUATED |
| Storage físico, Realtime, usuários externos e automações | Fora do dump/restore executado | NOT EVALUATED |
| Backup real de Hosted, recuperação point-in-time e histórico de migrations | Nenhuma interação de escrita com o Hosted | NOT EVALUATED |
| RTO/RPO, indisponibilidade e rollback Cloudflare/Edge | Nenhuma simulação autorizada em staging ou produção | NOT EVALUATED |

## Gate obrigatório para staging e release

- [ ] Identificar um staging **separado e autorizado**, sem conexão com a produção nem dados pessoais, ou uma cópia pseudonimizada com controles próprios.
- [ ] Selecionar um backup cuja integridade, retenção e disponibilidade tenham sido verificadas por operador autorizado. Não gerar dump de Hosted por conveniência.
- [ ] Executar restore em banco novo com papéis administrativos e extensões compatíveis e auditar `owners`, `GRANT/REVOKE`, políticas RLS (inclusive `USING/WITH CHECK`) e função `000023` através dos papéis `anon`, `authenticated` e `service_role`.
- [ ] Conferir efetivamente Storage privado (bucket, políticas, objeto, Signed URL e acesso público negado), Auth e integrações externas usando apenas fixtures de staging.
- [ ] Medir RTO/RPO e registrar custo operacional, responsáveis, tempo de recuperação e critérios objetivos de abandono/abort.
- [ ] Aprovar procedimento seletivo de `000023` separado das migrations Google, sem `db push` indiscriminado. Não marcar migrations pendentes artificialmente como aplicadas.
- [ ] Confirmar estado da publicação atual e procedimento de retorno na Cloudflare e Edge Functions, com autorização distinta.
- [ ] Realizar revisão e aceite funcional/operacional antes de qualquer merge ou deploy.

**Conclusão:** backup/restore **de dados lógicos sintéticos** em CI aprovado; **não** declarar desastre/recuperação de plataforma validada nem usar o resultado para autorizar release. PR #6 permanece aberto.
