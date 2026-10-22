# ADR 006: Geração Server-Side de Documento de Pedido (PDF) e Handoff de CTA Único para WhatsApp

## Status
**ACEITO** (2026-09-30)

## Contexto
O Checkout V1.1 implementou com sucesso o fluxo de validação transacional e autoridade estrita de preços no servidor com a Edge Function `submit-order-checkout`. No entanto, a experiência do comprador no fluxo V1.1 envolvia etapas adicionais após a revisão (`review` -> "Confirmar pedido" -> tela intermediária "Pedido recebido" -> "Enviar pedido pelo WhatsApp").

Além disso, a integração com o WhatsApp via protocolo universal `https://wa.me/` possui limitações técnicas determinísticas:
1. O protocolo `wa.me/?text=...` não permite anexar arquivos binários locais diretamente pelo navegador;
2. Enviar textos longos com centenas de itens por URL quebra limites de tamanho de query string e polui a conversa do vendedor;
3. O navegador bloqueia chamadas assíncronas a `window.open` quando disparadas após longos tempos de espera de rede (`await`).

## Decisão de Arquitetura

1. **CTA Único na Etapa de Revisão (Single WhatsApp CTA):**
   - Elimina-se a tela intermediária de "Pedido recebido" no fluxo normal do carrinho.
   - O botão final da etapa `review` torna-se **"Enviar pedido pelo WhatsApp"**.
   - O clique executa atomicamente: revalidação fail-closed dos dados locais e do WhatsApp da loja, pré-abertura neutra de aba para prevenção de popup blocker, submissão da transação ao backend, criação do pedido `pending`, geração do PDF oficial server-side, obtenção de signed URL e redirecionamento da conversa no WhatsApp.

2. **Geração Server-Side do Documento de Pedido (PDF):**
   - O PDF é gerado exclusivamente no backend (Supabase Edge Function / Deno) utilizando a biblioteca `pdf-lib` com versão explicitamente fixada (`npm:pdf-lib@1.17.9`).
   - O gerador de PDF consome **exclusivamente** os dados recalculados e validados pelo banco (`orderResult`), snapshots de cliente canônicos e branding oficial consultado de `tenant_public_settings`.
   - Nenhum dado ou cálculo financeiro do frontend é aceito na composição do documento.

3. **Armazenamento Privado e Menor Privilégio (Bucket `order-documents`):**
   - O bucket `order-documents` é provisionado como **estritamente privado** (`public = false`, limite de 5 MiB, MIME restrito a `application/pdf`).
   - Nenhuma policy de leitura ou escrita pública/anon é concedida.
   - Uploads e assinaturas ocorrem exclusivamente via `service_role` na Edge Function.
   - O path de armazenamento é canônico e determinístico: `<tenant_uuid>/orders/<order_uuid>/pedido-<order_number>.pdf`.
   - Tentativas com retry de idempotência realizam upsert no mesmo path, impedindo duplicação de arquivos.

4. **Acesso por Signed URL Temporária (7 Dias):**
   - A Edge Function gera uma URL assinada (`createSignedUrl`) com validade de 604.800 segundos (7 dias).
   - O cliente recebe exclusivamente `documentUrl` (HTTPS) e `documentExpiresAt` (ISO Date), sem expor chaves, paths internos ou dados de infraestrutura.

5. **Mensagem Curta no WhatsApp com Link Oficial:**
   - Quando o PDF é gerado, a mensagem do WhatsApp é concisa e profissional: identifica o pedido, comprador, totais, forma de pagamento e o link para o PDF assinado.
   - PII sensível (CPF/CNPJ completo, endereço completo, e-mail) é omitida da mensagem de texto, permanecendo protegida dentro do documento PDF privado e no banco de dados.

6. **Degradação Graciosa (Graceful Fallback):**
   - A criação do pedido no banco de dados é a prioridade máxima. Se a geração do PDF, o upload no Storage ou a assinatura da URL falharem, o pedido **NÃO é cancelado** e a requisição **NÃO falha**.
   - O backend retorna o recibo com `documentUrl: null`.
   - O frontend detecta a ausência do documento e gera uma mensagem de WhatsApp textual compacta alternativa contendo os itens e totais do recibo oficial.

7. **Neutralidade de Pagamento e Status:**
   - O pedido permanece com status `pending`.
   - Os textos do PDF e do WhatsApp deixam explícito que o pagamento **ainda não foi realizado** e que disponibilidade, frete e cobrança dependem de confirmação da loja.
   - A integração futura com gateways de pagamento (PSP/Stripe/Mercado Pago) será tratada em um ADR separado.

8. **Wording Não-Enganoso no Frontend:**
   - O sistema nunca afirma *"Pedido enviado com sucesso"* ao usuário, pois o webapp não tem como confirmar se o comprador enviou a mensagem na janela do WhatsApp.
   - O toast informa: *"Pedido #... registrado. Conclua o envio na conversa do WhatsApp."*

## Consequências

- **Positivas:**
  - Fluxo de compra muito mais fluido, reduzindo abandono ao eliminar etapas intermediárias redundantes.
  - Orçamentos e pedidos com apresentação gráfica de alto nível profissional para o comprador e o lojista.
  - Menor consumo de caracteres no WhatsApp e zero truncamento de URL.
  - Mitigação robusta de bloqueio de pop-ups em browsers modernos.
  - Risco zero de vazamento de autoridade financeira ou manipulação de preços pelo browser.
- **Negativas / Desafios:**
  - A geração de PDF consome tempo de CPU e memória na Edge Function; mitigado pelo limite de tamanho de logo, ausência de imagens de produto nesta versão e timeout de fetch de logo.
  - Links assinados expiram em 7 dias; após esse período, consultas pelo lojista devem ser realizadas através do painel autenticado.
