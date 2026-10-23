# Fase A — Frete Google: build de homologação isolada (23/10/2026)

**Estado:** IMPLEMENTADO na branch, verificação CI direcionada **PENDENTE**. Não é produção, deploy ou liberação de uso pago.

## Objetivo

Permitir o fluxo de UI `Painel do lojista → origem e tarifas → carrinho → endereço confirmado → cálculo de distância → cotação HMAC → pedido → recibo → WhatsApp` em ambiente **exclusivamente local**, sem abrir a flag na build Cloudflare/produção. Testes com Routes usam `fetcher` sintético no adapter, sem faturamento. A execução real Google→Edge→checkout permanece **NOT EVALUATED** até existir ambiente isolado com API/chave e teto de custo explicitamente autorizados.

## Correções direcionadas

- `vite.config.ts`: `VITE_GOOGLE_ROUTES_UI_ENABLED=true` só compila quando simultaneamente:
  - `vite build --mode homologation`;
  - `VITE_CORSYS_HOMOLOGATION_APPROVED=true`;
  - `VITE_SUPABASE_URL=http://127.0.0.1:54321` ou `http://localhost:54321`.
- Em qualquer outro cenário, inclusive `vite build` padrão de produção, permanece `RELEASE_BLOCKED_GOOGLE_ROUTES`. Não alterar guard de produção para testar.
- `supabase/config.toml`: `[functions.estimate-delivery] verify_jwt=false` — cotação pública sem sessão, mas com validação de loja/método, origem permitida no navegador, HMAC exclusivo server-side, limites e cota SQL. **CORS não é autenticação**. Não publicar função por esta alteração.
- `AutomaticDeliveryEstimate.tsx`: exige token, distância/tarifa/centavos válidos e `expiresAt` explícito/valendo; nenhum fallback fictício. Falha orienta recálculo, não frete zero.
- `CartDrawer.tsx`: verifica expiração antes de revisão e imediatamente antes de abrir WhatsApp/submeter; o backend continua autoridade final.

## Testes mínimos — sem repetir toda a suíte 238

Workflow existente: `.github/workflows/qa-staging-recovery.yml`, disparo manual na branch `fix/frete-v1-release-readiness`.
Job novo `Freight QA build guard (offline)`:
1. Bun 1.4.2 + dependências congeladas.
2. `bun scripts/test-freight-local-homologation.ts`: quatro builds; bloqueio de produção, bloqueio para Supabase remoto, bloqueio sem autorização QA, aprovação apenas build local. Também verifica registro Edge, quota e expiração no contrato.
3. `bun scripts/test-google-routing.ts`: adapter Google com resposta sintética / falha de quota / nenhuma chamada paga.
4. `bun scripts/test-freight-security-homologation.ts`: criptografia HMAC e anti-adulteração local.
5. `bun run lint`: compilação de tipos.
**A execução manual do workflow também iniciará o job SQL 000023→000024 (já aprovado antes)**; isso não reexecuta a suíte de 238 testes. O job `recovery` original da PR #6 será skipped.

## Quando houver ambiente local e autorização para consulta paga

O operador configura em ambiente **privado e isolado**, nunca no GitHub:
- Supabase local não vinculado ao Hosted, com migrations e dados exclusivamente sintéticos.
- Endereço de origem comercial e método de entrega habilitado por tenant; tarifa R$/km salva.
- Edge secreta `DELIVERY_QUOTE_HMAC_SECRET` aleatória e independente, `GOOGLE_ROUTES_API_KEY` restrita, `ROUTING_ALLOWED_ORIGINS` contendo exclusivamente a origem local usada pelo navegador e `GOOGLE_ROUTES_ENABLED=true` **somente depois da autorização de gastos**.
- O projeto Google Cloud tem orçamento/quotas próprias e escopo Routes API restrito. Antes de habilitar, confirmar a possibilidade de proteger a credencial no ambiente escolhido.
- Frontend usa chave **pública local**, nunca `service_role` ou secret Google. O Google não é chamado a cada tecla digitada, somente depois que o cliente confirma o endereço e clica calcular.

Na homologação funcional ponta-a-ponta, validar o recibo oficial do servidor: subtotal, frete e total persistidos e texto WhatsApp, incluindo bloqueios de token expirado, endereço diferente, tenant, modalidade, tarifa e falha do Google. Não afirmar PASS antes dos logs.

## Restrição de release

A habilitação real fora do `localhost` exige decisão posterior (endpoint staging separado, faturamento autorizado, isolamento de dados, chaves secretas, backups proporcionais). **Não** mudar `VITE_SUPABASE_URL` para Hosted e contornar o guard. As migrations `000023`, `000024` e quota Google continuam não aplicadas em Hosted. Proibidos: `supabase db push --linked`, merge e Cloudflare deploy sem aprovação específica.
