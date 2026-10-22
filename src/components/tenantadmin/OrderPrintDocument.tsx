import React from 'react';
import { Order, OrderStatus, PaymentMethod } from '../../types';

export interface OrderPrintDocumentProps {
  order: Order;
  storeName: string;
}

const formatCurrency = (value: number): string => {
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
};

const formatDate = (dateStr: string): string => {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
};

const formatStatus = (status: OrderStatus): string => {
  switch (status) {
    case 'pending': return 'Pendente / Aguardando';
    case 'approved': return 'Aprovado';
    case 'preparing': return 'Em Separação';
    case 'dispatched': return 'Despachado / Em Transporte';
    case 'delivered': return 'Entregue / Concluído';
    case 'cancelled': return 'Cancelado';
    default: return status;
  }
};

const formatPaymentMethod = (method: PaymentMethod): string => {
  switch (method) {
    case 'pix': return 'PIX';
    case 'boleto': return 'Boleto Bancário';
    case 'credit_card': return 'Cartão de Crédito';
    case 'cash_on_delivery': return 'Pagamento na Entrega';
    default: return method;
  }
};

export const OrderPrintDocument: React.FC<OrderPrintDocumentProps> = ({ order, storeName }) => {
  const addressParts: string[] = [];
  if (order.shippingAddress.street) {
    let streetLine = order.shippingAddress.street;
    if (order.shippingAddress.number) streetLine += `, ${order.shippingAddress.number}`;
    if (order.shippingAddress.complement) streetLine += ` - ${order.shippingAddress.complement}`;
    addressParts.push(streetLine);
  }
  if (order.shippingAddress.neighborhood) {
    addressParts.push(`Bairro: ${order.shippingAddress.neighborhood}`);
  }
  const cityState = [order.shippingAddress.city, order.shippingAddress.state].filter(Boolean).join(' - ');
  if (cityState) {
    addressParts.push(cityState);
  }
  if (order.shippingAddress.zipCode) {
    addressParts.push(`CEP: ${order.shippingAddress.zipCode}`);
  }

  return (
    <div className="w-full bg-white text-slate-900 font-sans p-6 text-xs leading-relaxed">
      {/* Header com Loja, Pedido e Data */}
      <div className="border-b-2 border-slate-900 pb-4 mb-4 flex justify-between items-start print-avoid-break">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">{storeName}</h1>
          <div className="text-sm font-bold text-slate-800 mt-1">Comprovante de Pedido #{order.orderNumber}</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-slate-500">Data de Emissão:</div>
          <div className="font-semibold text-slate-800">{formatDate(order.createdAt)}</div>
          <div className="mt-1">
            <span className="inline-block px-2 py-0.5 rounded border border-slate-300 font-bold text-[10px] uppercase">
              Status: {formatStatus(order.status)}
            </span>
          </div>
        </div>
      </div>

      {/* Dados do Cliente e Entrega */}
      <div className="grid grid-cols-2 gap-4 pb-4 mb-4 border-b border-slate-200 print-avoid-break">
        <div>
          <div className="font-bold text-slate-900 uppercase text-[10px] tracking-wider mb-1">Cliente</div>
          <div className="font-bold text-sm text-slate-900">{order.customer.name}</div>
          {order.customer.companyName && (
            <div className="text-slate-700">{order.customer.companyName}</div>
          )}
          {order.customer.document && (
            <div className="text-slate-600 font-mono text-[11px]">Doc: {order.customer.document}</div>
          )}
          <div className="text-slate-700 mt-0.5">Telefone: {order.customer.phone}</div>
          {order.customer.email && (
            <div className="text-slate-600 text-[11px]">Email: {order.customer.email}</div>
          )}
        </div>

        <div>
          <div className="font-bold text-slate-900 uppercase text-[10px] tracking-wider mb-1">Endereço de Entrega</div>
          {addressParts.length > 0 ? (
            addressParts.map((line, idx) => (
              <div key={idx} className="text-slate-700">{line}</div>
            ))
          ) : (
            <div className="text-slate-500 italic">Endereço não informado</div>
          )}
          {order.deliveryMethod && (
            <div className="font-semibold text-slate-800 mt-1">Método de Entrega: {order.deliveryMethod}</div>
          )}
        </div>
      </div>

      {/* Tabela de Itens */}
      <div className="mb-4">
        <div className="font-bold text-slate-900 uppercase text-[10px] tracking-wider mb-2">Itens do Pedido</div>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-300 text-[10px] uppercase font-bold text-slate-600">
              <th className="py-1.5 pr-2">SKU</th>
              <th className="py-1.5 px-2">Descrição / Produto</th>
              <th className="py-1.5 px-2 text-center">Qtd</th>
              <th className="py-1.5 px-2 text-right">Unitário</th>
              <th className="py-1.5 pl-2 text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {order.items.map((item, idx) => (
              <tr key={idx} className="print-avoid-break">
                <td className="py-2 pr-2 font-mono text-[10px] text-slate-500 align-top">
                  {item.productSku || '-'}
                </td>
                <td className="py-2 px-2 align-top">
                  <div className="font-bold text-slate-900">{item.productName}</div>
                  {item.selectedVariant && (
                    <div className="text-[10px] text-slate-600">Variante: {item.selectedVariant}</div>
                  )}
                </td>
                <td className="py-2 px-2 text-center font-medium text-slate-800 align-top whitespace-nowrap">
                  {item.quantity} {item.unit || 'un'}
                </td>
                <td className="py-2 px-2 text-right font-medium text-slate-800 align-top whitespace-nowrap">
                  {formatCurrency(item.unitPrice)}
                </td>
                <td className="py-2 pl-2 text-right font-bold text-slate-900 align-top whitespace-nowrap">
                  {formatCurrency(item.totalPrice)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Observações quando houver */}
      {order.notes && (
        <div className="mb-4 p-3 bg-slate-50 rounded border border-slate-200 print-avoid-break">
          <div className="font-bold text-slate-800 text-[10px] uppercase tracking-wider mb-0.5">Observações:</div>
          <div className="text-slate-700">{order.notes}</div>
        </div>
      )}

      {/* Totais e Pagamento */}
      <div className="border-t border-slate-300 pt-3 flex justify-between items-start print-avoid-break">
        <div className="space-y-1">
          <div>
            <span className="text-[11px] text-slate-500">Forma de Pagamento: </span>
            <span className="font-bold text-slate-800">{formatPaymentMethod(order.paymentMethod)}</span>
          </div>
          {order.sellerCode && (
            <div>
              <span className="text-[11px] text-slate-500">Código do Vendedor: </span>
              <span className="font-mono text-slate-800">{order.sellerCode}</span>
            </div>
          )}
        </div>

        <div className="w-56 space-y-1 text-right">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal:</span>
            <span>{formatCurrency(order.subtotal)}</span>
          </div>
          {order.discount > 0 && (
            <div className="flex justify-between text-slate-700">
              <span>Desconto:</span>
              <span>- {formatCurrency(order.discount)}</span>
            </div>
          )}
          <div className="flex justify-between text-slate-600">
            <span>Frete:</span>
            <span>
              {order.shippingFee === 0 ? 'Grátis / A Combinar' : formatCurrency(order.shippingFee)}
            </span>
          </div>
          <div className="flex justify-between text-sm font-extrabold text-slate-900 pt-1 border-t border-slate-200">
            <span>Total:</span>
            <span>{formatCurrency(order.total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
