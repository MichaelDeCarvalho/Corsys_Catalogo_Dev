# ADR 010: Handoff de WhatsApp 100% Textual com Produtos e Valores Autoritativos do Servidor

## Status
**ACEITO** (2026-10-07) — *Substitui parcialmente o Item 5 do ADR 006*.

## Contexto
O ADR 006 introduziu o fluxo de Single WhatsApp CTA e determinou que a mensagem do WhatsApp incluísse um link para o documento PDF assinado (`documentUrl`), bifurcando o comportamento entre a presença do link de PDF e um fallback textual de contingência.

Na prática operacional de atendimento via WhatsApp, identificou-se que o envio de links externos de PDF gera fricção para o lojista e para o cliente (necessidade de download externo, dependência de expiração de signed URLs temporárias e menor clareza imediata na conversa).

Dessa forma, foi estabelecido que o handoff final para o WhatsApp deve enviar **sempre e exclusivamente uma mensagem textual completa com a lista de produtos, quantidades, variantes, SKU e totais financeiros**, eliminando a bifurcação de mensagens e removendo o link de PDF da conversa do WhatsApp.

## Decisão de Arquitetura

1. **Mensagem Textual Única e Universal no WhatsApp:**
   - Elimina-se a bifurcação baseada em `receipt.documentUrl`.
   - Independentemente de `receipt.documentUrl` existir ou ser nulo, a mensagem de WhatsApp é sempre formatada de forma textual completa e determinística.

2. **Autoridade Estrita do Servidor (Zero Leitura do Cart Local):**
   - O helper puro `buildOrderWhatsAppMessage` (`src/utils/orderWhatsAppMessage.ts`) constrói a mensagem consumindo **exclusivamente** os dados validados do servidor presentes em `CheckoutOrderReceipt` (`orderNumber`, `items`, `subtotal`, `discount`, `shippingFee`, `total`, `paymentMethod`, `deliveryMethod`).
   - Preços unitários, totais por linha e subtotais do carrinho local nunca são utilizados na montagem da mensagem.

3. **Formatação e Detalhamento de Itens:**
   - Cada item do pedido exibe: quantidade, nome do produto, SKU, variante selecionada (somente se não vazia), unidade de medida, preço unitário e valor total da linha.
   - Totais incluem: subtotal, desconto (apenas se maior que zero), frete (exibindo "A combinar / Calculado pela loja" quando zero, sem utilizar a palavra "Grátis") e total geral.

4. **Privacidade e Minimização de Dados (PII):**
   - A mensagem de texto do WhatsApp não inclui dados sensíveis desnecessários, como CPF, CNPJ, endereço residencial completo, e-mail do comprador ou identificadores internos de banco (UUIDs, tenant_id, idempotency_key).
   - A identificação do cliente utiliza `customerDisplay` (nome no varejo ou razão social / nome fantasia no atacado).

5. **Isolamento e Preservação do PDF Server-Side:**
   - O backend (`submit-order-checkout`, `orderPdf.ts`, `generate-admin-order-pdf`) e o bucket privado `order-documents` permanecem 100% intactos e ativos.
   - O PDF continua sendo gerado server-side e armazenado de forma privada para auditoria, histórico e geração de comprovantes no painel administrativo (`OrderManager` / `generateAdminOrderPdf`).
   - Esta decisão substitui **apenas** o canal de entrega da mensagem no WhatsApp definido no Item 5 do ADR 006, sem invalidar a infraestrutura de PDF.

6. **Wording e Neutralidade Financeira:**
   - A mensagem explicita com clareza: *"Pagamento ainda não realizado."* e orienta o cliente a aguardar as instruções/link de pagamento e a confirmação de disponibilidade e frete pela loja no WhatsApp.

## Consequências

- **Positivas:**
  - O vendedor visualiza instantaneamente os produtos e valores do pedido diretamente na mensagem do WhatsApp sem precisar abrir ou baixar arquivos externos.
  - O comprador tem clareza imediata sobre o que foi registrado no sistema.
  - Eliminação de complexidade no frontend (fim da bifurcação condicional).
  - Preservação da infraestrutura de PDF server-side para uso administrativo e conformidade fiscal/operacional.
