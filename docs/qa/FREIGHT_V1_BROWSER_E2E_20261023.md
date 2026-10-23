# Frete V1 — E2E navegador → cotação simulada → checkout real local → banco → WhatsApp

**Data:** 23/10/2026. **Status:** PREPARADO / **NOT EVALUATED** até executar o novo job do GitHub Actions e examinar seus logs. Não é prova do Google Routes real.

## Escopo estrito

- Branch de desenvolvimento `fix/frete-v1-release-readiness`, com isolamento de `GITHUB_ACTIONS`, flags explícitas, hosts loopback, dados exclusivamente sintéticos, nenhum segredo real.
- Reutilização do workflow `.github/workflows/qa-isolated.yml`, acrescentando o job **Freight Checkout Browser E2E (offline)** disponível **somente** por `workflow_dispatch` na branch de frete. Job anterior da PR #6 é preservado e será `skipped`.
- Scripts novos:
  - `scripts/qa-browser/seed_local_freight.mjs`: loja sintética; modalidade própria `entrega`, origem QA, tarifa de R$ 2,50/km, habilitada somente na base local.
  - `scripts/qa-browser/test_freight_checkout_browser.py`: Chromium com Playwright, API estimativa interceptada e respondida por mock HMAC sintético **somente no navegador**; Edge **submit-order-checkout** real, PostgreSQL local real, validação de endereço alterado e mensagem WhatsApp capturada sem conexão externa.
  - `scripts/qa-browser/assert_local_freight_order.sh`: consulta PostgreSQL independente confirmando **um** pedido, subtotal R$ 30, frete R$ 12,50 e total R$ 42,50, isolado no tenant QA.
- API `estimate-delivery` **não é invocada** neste teste: a resposta simulada representa apenas os dados de `computeRoutes` que a função geraria, com distância sintética de 5000 metros. O HMAC real é verificado pela Edge de checkout contra segredo **fictício** instalado apenas no Supabase local.
- Nenhuma API externa Google/WhatsApp é chamada, nenhum deploy ou DDL Hosted é executado, nenhuma pessoa real participa.

## Critério de aprovação

1. Povoamento da loja e parâmetros com registros exclusivamente fictícios.
2. Vite em `--mode homologation`, variável Google UI habilitada apenas para localhost, Supabase local não vinculado.
3. Cotação não requisitada durante digitação e carrinho não avança sem cotação.
4. Entrega própria selecionada; botão de cálculo emite resposta sintética com HMAC SHA-256, vínculo de tenant, endereços, modalidade, distância, tarifa e validade.
5. Alterar número do endereço invalida quote anterior; recálculo obrigatório.
6. Carrinho exibe distância/tarifa/frete e total R$ 42,50.
7. Edge real processa `quoteToken`, verifica segredo e dados comerciais do tenant, responde **201** com frete R$ 12,50 e total R$ 42,50.
8. PostgreSQL comprova um pedido do tenant correto, com subtotal/frete/total e sem duplicação.
9. Mensagem do WhatsApp é gerada exclusivamente com o recibo, mantém número fictício e valores corretos; interceptada sem conexão real.
10. Runner remove Supabase descartável no final. Logs mostram apenas resultados agregados, não token nem documentos/URLs privadas.

**IMPORTANTE:** um eventual PASS não valida cálculo real do Google, autenticação do Cloud Console, cotas financeiras externas, infraestrutura Hosted, deploy nem entrega física. Não liberar produção com base apenas neste teste.

## Execução pelo responsável

GitHub Actions → **Isolated Browser QA** → **Run workflow** → branch `fix/frete-v1-release-readiness` → **Run workflow**. Inspecionar job **Freight Checkout Browser E2E (offline)**. Aguardar conclusão antes de registrar `PASS`. Se vermelho, localizar o primeiro step que falhou e corrigir somente o defeito observável; não executar `db push` nem alterar produção.
