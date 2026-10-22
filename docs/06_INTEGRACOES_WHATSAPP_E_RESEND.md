# 💬 06. Integrações Externas (WhatsApp & Resend API)

A plataforma OmniCatálogo utiliza uma arquitetura híbrida de conversão: **envio instantâneo para o WhatsApp do vendedor** combinado com **registro de pedido e e-mails transacionais automáticos via Resend**.

---

## 1. Algoritmo de Pedido Formatado no WhatsApp

Ao clicar em **"Finalizar Pedido pelo WhatsApp"**, o carrinho compila os dados do comprador, os itens selecionados com respectivos SKUs e quantidades, e formata uma mensagem padronizada compatível com a API `https://wa.me/`:

### 1.1 Exemplo de Mensagem Gerada para o Vendedor
```
📦 NOVO PEDIDO #PED-2025-0842
Empresa: MC Distribuição

👤 DADOS DO CLIENTE:
Nome: Carlos Mendes
Empresa / Razão Social: Marmoraria Arte Real Ltda
CNPJ/CPF: 23.888.999/0001-44
Telefone: (11) 98111-2233
Cidade/UF: Santo André - SP
Endereço: Av. dos Estados, 3400 - Galpão B

🛒 ITENS DO PEDIDO:
• 10x [FL004] FLAP 115MM (T29) GRÃO #40 (K) - R$ 83,00
• 20x [SR001] SERRA ALMA SILENCIOSA OURO 350MM - R$ 6.800,00
• 4x [CU010] CUBA GOURMET 50X40 C/ ACESSÓRIOS - R$ 920,00

💰 RESUMO FINANCEIRO:
Subtotal: R$ 7.803,00
Frete: Grátis (Acima de R$ 1.000,00)
TOTAL: R$ 7.803,00

Forma de Pagamento: PIX
Chave PIX da Loja: 34.567.890/0001-12 (CNPJ)

📝 OBSERVAÇÕES:
Entregar na doca de carga das 08h às 12h.
```

---

## 2. Integração com Resend API (E-mails Transacionais)

O **Resend** é a solução oficial para disparos de confirmação de compra, alertas de novos pedidos e faturamento.

### 2.1 Código de Disparo em TypeScript

```typescript
import { Resend } from 'resend';

// Inicialização segura
let resendClient: Resend | null = null;
function getResend(): Resend {
  if (!resendClient) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY não configurada.');
    resendClient = new Resend(key);
  }
  return resendClient;
}

export async function sendOrderConfirmation({ tenant, order }: { tenant: any; order: any }) {
  const resend = getResend();
  const sender = tenant.customization.resendSenderEmail || 'pedidos@omnicatalogo.com.br';

  // 1. E-mail para o Comprador
  await resend.emails.send({
    from: `${tenant.name} <${sender}>`,
    to: order.customer.email,
    subject: `✅ Pedido Confirmado #${order.orderNumber} - ${tenant.name}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: ${tenant.customization.primaryColor || '#0284c7'}; margin-top: 0;">Pedido Recebido com Sucesso!</h2>
        <p>Olá <strong>${order.customer.name}</strong>, recebemos sua solicitação de compra sob o número <strong>#${order.orderNumber}</strong>.</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <thead>
            <tr style="background: #f8fafc; text-align: left;">
              <th style="padding: 10px; border-bottom: 2px solid #cbd5e1;">Item</th>
              <th style="padding: 10px; border-bottom: 2px solid #cbd5e1; text-align: center;">Qtd</th>
              <th style="padding: 10px; border-bottom: 2px solid #cbd5e1; text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${order.items.map((i: any) => `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px;">${i.productName} <br><small style="color: #64748b;">SKU: ${i.productSku}</small></td>
                <td style="padding: 10px; text-align: center;">${i.quantity}</td>
                <td style="padding: 10px; text-align: right;">R$ ${i.totalPrice.toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin-top: 20px;">
          <p style="margin: 0; font-size: 16px; font-weight: bold;">Valor Total: R$ ${order.total.toFixed(2)}</p>
          <p style="margin: 8px 0 0; color: #475467; font-size: 14px;">Chave PIX para pagamento: <code>${tenant.customization.pixKey}</code></p>
        </div>

        <p style="font-size: 12px; color: #94a3b8; margin-top: 24px; text-align: center;">
          ${tenant.name} • Atendimento via WhatsApp: ${tenant.customization.whatsappNumber}
        </p>
      </div>
    `
  });

  // 2. Alerta para a Central de Vendas da Loja
  await resend.emails.send({
    from: `Sistema OmniCatálogo <sistema@omnicatalogo.com.br>`,
    to: tenant.ownerEmail,
    subject: `🚨 Novo Pedido #${order.orderNumber} Recebido - R$ ${order.total.toFixed(2)}`,
    html: `<p>Um novo pedido foi emitido pelo catálogo por <strong>${order.customer.name}</strong> (${order.customer.phone}). Acesse o painel para aprovar a expedição.</p>`
  });
}
```
