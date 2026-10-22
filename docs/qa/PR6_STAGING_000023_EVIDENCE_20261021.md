# PR #6 — Staging isolado / recuperação e migration 000023 (21/10/2026)

**Status:** PASS para o ensaio de **restauração lógica sintética e aplicação seletiva**; recuperação integral da plataforma Supabase Hosted: **NOT EVALUATED**. O Supabase produtivo não foi usado.

## Ambiente e método

- PR #6, branch `qa/b2b-checkout-e2e-readiness-20261008`; workflow `.github/workflows/qa-staging-recovery.yml`, run [#1](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39629280389).
- GitHub Actions em runner Ubuntu descartável, Supabase CLI + Docker local isolado, banco de origem na instância local e banco de destino `corsys_stage_000023` criado **separadamente no mesmo contêiner PostgreSQL**. **Não se trata de projeto Supabase Hosted de staging**.
- `scripts/qa-browser/prepare_isolated_stack.py` substitui **somente no runner** a carga de catálogo por dois tenants/produtos fictícios e exclui temporariamente migrations Google da aplicação local.
- Migration `20261016000000_000023_checkout_idempotency_buyer_guard.sql` é retirada temporariamente do diretório antes de inicializar o Supabase local. A fonte fica comprovadamente em estado **pré-000023**.
- `scripts/qa-browser/drill_staging_migration_000023.sh` executa `pg_dump` custom dos schemas `public`, `private`, `auth`, `extensions`, `pg_restore --no-owner --no-acl` transacional em banco de destino e então executa **somente** o SQL integral da `000023` no destino.
- Os dados/digests de tenants, produtos e usuários Auth, a contagem de pedidos e a flag RLS de `public.orders` são comparados entre origem, destino restaurado e destino pós-migration; o banco de origem é revalidado no final.
- Pós-migration, verifica assinatura das funções `public` e `private` e privilégios de execução: `anon=false`, `authenticated=false`, `service_role=true` para wrapper público; `service_role=false` para função privada.
- Cleanup automático destrói apenas a cópia criada e o arquivo de backup **dentro do runner**, sem exportar dump nem gerar artefato com dados.

## Evidência observada

Log do run #1: `STAGING-000023 PASS: synthetic logical recovery, selective migration, wrapper ACL, data digests, source isolation`.

Quality no commit de criação do workflow [#262](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/39629280034): **SUCCESS**.

## Limites e riscos remanescentes

1. **Não reproduz recuperação integral Hosted**: o dump/restauração omite `owner` e `ACL` originais; verifica os grants do wrapper após migration, mas não ownership nem grants de todos os objetos restaurados.
2. **Não cobre** Storage físico, Realtime, PITR, disponibilidade de backups oficiais, RTO/RPO medidos sob incidente, credenciais/integrações/URLs produtivas.
3. Testa o caminho de migração seletiva em staging sintético; **não comprova que a 000023 foi aplicada ou registrada no Supabase de produção**.
4. As migrations Google de 20261011 continuam **fora do escopo aprovado**. Não usar `supabase db push` indiscriminado; nunca marcar artificialmente migrations como aplicadas.
5. Este ensaio não autoriza merge, Cloudflare deploy, escrita Hosted ou habilitação da API paga Google.

**Gate:** staging local sintético PASS; antes de qualquer mudança produtiva, revisão final de pré-condições, respaldo de backup/recuperação Hosted e **nova autorização explícita** para aplicar a 000023 e eventual reconciliação do histórico.
