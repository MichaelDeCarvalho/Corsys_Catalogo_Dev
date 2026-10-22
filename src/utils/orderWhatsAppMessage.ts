import type { CheckoutOrderReceipt } from '../services/orderService';

export interface BuildOrderWhatsAppMessageInput {
  receipt: CheckoutOrderReceipt;
  customerDisplay: string;
  paymentMethodLabel: string;
  deliveryMethodLabel: string;
}

function formatBrlCurrency(value: number): string {
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}

/**
 * Constrói a mensagem textual autoritativa do pedido para o handoff de WhatsApp.
 * 
 * Regras:
 * - Depende EXCLUSIVAMENTE dos dados autoritativos do servidor (CheckoutOrderReceipt).
 * - Não utiliza cart local nem dados não validados.
 * - Não inclui links de PDF nem termos de falha de PDF.
 * - Não inclui dados sensíveis desnecessários (CPF/CNPJ, endereços completos, etc).
 */
export function buildOrderWhatsAppMessage(
  input: BuildOrderWhatsAppMessageInput
): string {
  const { receipt, customerDisplay, paymentMethodLabel, deliveryMethodLabel } = input;

  const itemsList = receipt.items
    .map((item) => {
      const variantLine =
        typeof item.selectedVariant === 'string' && item.selectedVariant.trim() !== ''
          ? `\n  Variante: ${item.selectedVariant.trim()}`
          : '';

      const unitText = item.unit && item.unit.trim() !== '' ? item.unit.trim() : 'UN';

      return `• *${item.quantity}x ${item.productName}*
  SKU: ${item.productSku}${variantLine}
  Unidade: ${unitText}
  Unitário: ${formatBrlCurrency(item.unitPrice)}
  Total: ${formatBrlCurrency(item.totalPrice)}`;
    })
    .join('\n\n');

  const discountLine =
    typeof receipt.discount === 'number' && receipt.discount > 0
      ? `\n🏷️ *Desconto:* ${formatBrlCurrency(receipt.discount)}`
      : '';

  const shippingText =
    receipt.shippingFee > 0
      ? formatBrlCurrency(receipt.shippingFee)
      : 'A combinar / Calculado pela loja';

  return `Olá! Gostaria de enviar o pedido *${receipt.orderNumber}*.

*Cliente:* ${customerDisplay}

📦 *ITENS DO PEDIDO:*

${itemsList}

💵 *Subtotal:* ${formatBrlCurrency(receipt.subtotal)}${discountLine}
🚚 *Frete:* ${shippingText}
💰 *Total:* ${formatBrlCurrency(receipt.total)}
💳 *Forma de Pagamento Pretendida:* ${paymentMethodLabel}
🚚 *Método de Entrega:* ${deliveryMethodLabel}

_Pagamento ainda não realizado._
_Aguardo as instruções/link de pagamento e a confirmação de disponibilidade/frete por este WhatsApp._`;
}
