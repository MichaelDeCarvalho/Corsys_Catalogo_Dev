# ADR 016 — Frete automático por distância como cotação vinculada ao pedido

- **Data:** 2026-10-22
- **Status:** PROPOSTO / implementação em branch de desenvolvimento; **não autorizado em produção**
- **Contexto:** o Corsys.Catálogo V1 exige frete pela rota rodoviária calculada no backend Google Routes, multiplicado pela tarifa por km configurada por cada loja. A estimativa advisory-only anterior não integrava o pedido; o primeiro sync AI Studio incluía fallbacks inseguros e replicação da função financeira.

## Decisão

1. Endereços de origem e destino são normalizados; o quoteToken assinado com HMAC-SHA-256 vincula tenant, modalidade, origem, destino, distância em metros, tarifa vigente, frete em centavos e expiração de 30 minutos. O segredo exclusivo `DELIVERY_QUOTE_HMAC_SECRET` (mínimo 32 caracteres) é obrigatório, nunca embutido no código.
2. A Edge `estimate-delivery` permanece inoperante sem `GOOGLE_ROUTES_ENABLED=true`, chave real server-side, origem/loja/método válidos e quota persistente reservada antes de cada requisição paga. Limiter em memória é auxiliar. Sem modo sintético executável.
3. O checkout valida HMAC via WebCrypto, todos os vínculos e o cálculo em centavos, consulta configurações comerciais atuais e rejeita divergências. Entrega própria, Moto e Carro exigem cotação; retirada tem frete zero; métodos legados não calculados preservam negociação comercial à parte.
4. A migration **000024 ainda não aplicada** acrescenta nova assinatura pública com `p_shipping_fee` obrigatório, mantendo a assinatura antiga e delegando a precificação/cadastro à função original congelada (000018/000023); somente service_role pode chamar a nova RPC. Atualização do frete e total ocorre na mesma transação.
5. CORS utiliza `ROUTING_ALLOWED_ORIGINS` como proteção de navegador, nunca como autenticação; gasto é limitado em escala global pelas duas migrations de reserva. Frontend continua desabilitado por guard de build até homologação e liberação operacional.

## Consequências e riscos

- Quotas: limites globais atualmente 10 tentativas/60 segundos, 250/dia, 7500/mês (horário de Los Angeles); Cloud Console precisa de restrições/quotas próprias.
- As duas migrations de quota dependem do schema privado e antecedem 000023/000024 em ordem temporal. Nunca executar `db push` indiscriminado contra Hosted.
- O SQL 000024 foi corrigido antes de qualquer aplicação Hosted; testes PostgreSQL de schema, overload/RPC, grants, corrida/idem e replay permanecem **NOT EVALUATED** até execução isolada.
- Não há deploy, merge, custos Google, chaves configuradas ou autorização para DDL. Antes de liberar: backup recuperável inclusive Storage/Auth, ensaio de restauração, SQL isolado, CI, smoke tests, aprovação de custos e autorização explícita separada.

## Alternativas rejeitadas

- Distância sintética ou fallback fixo de HMAC em runtime: risco financeiro/assinaturas previsíveis.
- Quota por instância como única barreira: insuficiente em Edge distribuída.
- Reescrever todas as regras originais de checkout na 000024: criaria divergência com políticas B2B/RLS validadas.
