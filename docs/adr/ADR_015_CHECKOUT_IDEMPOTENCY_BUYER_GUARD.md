# ADR 015 — Idempotência não é autorização de checkout B2B

- **Data:** 2026-10-16
- **Estado:** aceita tecnicamente e validada na QA descartável; **não publicada**, pendente de autorização seletiva de migration e release.
- **Migração:** `20261016000000_000023_checkout_idempotency_buyer_guard.sql` (forward-only).

## Contexto e problema

A função `public.create_order_checkout_internal` introduzida pela migration 000018 (já aplicada e congelada no Hosted) possui fast-path de idempotência: encontra pedido por `tenant_id + idempotency_key` e retorna o registro antes de verificar `p_buyer_user_id` e aprovação B2B. A Edge Function autentica o Bearer e deriva `p_buyer_user_id` do JWT, mas não bloqueia esse fast-path. Um token de idempotência não deve autorizar outra pessoa a ler recibos ou PDFs privados.

A QA negativa acrescentada ao PR em `cee84b7` falhou em [Isolated Browser QA](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38978866418) na etapa de replay entre tenants. O script não imprime resposta HTTP/recibo na falha; essa execução, isoladamente, não demonstra qual status foi recebido. O alcance potencial decorre do fluxo SQL revisado; não afirmar exploração ou incidência em Hosted.

## Decisão

Manter a migration original 000018 **intacta**. Em migration **nova e transacional**:

1. Transferir a função existente para o schema não exposto `private`, preservando sua identidade interna/implementação; revogar execução do legado dos papéis de API.
2. Criar wrapper `public.create_order_checkout_internal` com a mesma assinatura/defaults, `SECURITY DEFINER` e `search_path=''`, executável apenas por `service_role` como antes.
3. Resolver tenant ativo pelo identificador oficial; para atacado, exigir usuário autenticado derivado pelo gateway, tenant com B2B ativo e cadastro `wholesale_customers` atualmente aprovado, **mesmo em replay**.
4. Serializar tentativas pelo par `tenant_id + idempotency_key` com lock transacional consultivo antes de verificar pedido existente. Rejeitar (`42501`) mudança de modalidade ou acesso de outro comprador a pedido B2B já registrado.
5. Delegar cálculos, persistência e integridade à implementação original em `private`; não duplicar a lógica financeira.

## Consequências e testes obrigatórios

- **Segurança:** replay do mesmo pedido pelo comprador aprovado mantém idempotência; comprador revogado, diferente ou de outro tenant recebe negativa. Nenhum privilégio extra de leitura de `orders` por PostgREST.
- **Concorrência:** lock serializa a chave antes do fast-path, evitando bypass de corrida entre compradores. Colisões de hash apenas serializam tentativas extras.
- **Compatibilidade:** API pública e formato JSON preservados, mas mover a função altera localização do objeto antigo; validar todas as dependências, grants, SQL tests e PostgREST no Supabase descartável.
- **Reversão:** forward-fix; **não reverter** 000018, apagar pedidos ou executar rollback DDL automático em produção. Preparar migração corretiva separada se ocorrer regressão.
- **Release:** migrations Google `20261011*` ainda não aplicadas em Hosted antecedem cronologicamente 000023; por isso **não usar `supabase db push` indiscriminadamente**. Criar roteiro explícito de migração seletiva, backup e aprovação antes de qualquer execução Hosted.
- **Evidência:** teste `scripts/qa-browser/test_revoked_wholesale_buyer_api.py` exige negativa HTTP 403 para replay da chave da loja A pelo usuário B; a auditoria SQL confirma que o legado privado não é executável pelo papel `service_role` e que o wrapper nega `anon/authenticated`. Quality e Browser QA devem estar PASS no SHA exato.

**Evidência de validação:** [Quality #38979475405](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38979475405) e [Browser QA #38979869345](https://github.com/MichaelDeCarvalho/Corsys_Catalogo/actions/runs/38979869345) SUCCESS no código testado. Replays cruzados, revogação, grants da função privada e checkouts legítimos PASS no Supabase local.

**Sem permissão implícita de merge, deploy, DB Hosted ou ativação de Google Routes.**
