import React, { useState } from 'react';
import { 
  ShoppingCart, 
  Search, 
  Filter, 
  CheckCircle, 
  Clock, 
  Truck, 
  PackageCheck, 
  XCircle, 
  MessageSquare, 
  Printer, 
  ExternalLink, 
  User, 
  MapPin, 
  Calendar,
  DollarSign,
  ChevronRight,
  Eye,
  FileText
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Order, OrderStatus } from '../../types';
import { getSafeProductImage, handleProductImageError } from '../../utils/productImages';

export const OrderManager: React.FC = () => {
  const { 
    currentTenant, 
    currentTenantOrders, 
    updateOrderStatus, 
    showToast 
  } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [viewLayout, setViewLayout] = useState<'kanban' | 'list'>('kanban');

  const filteredOrders = currentTenantOrders.filter(order => {
    const matchesSearch = 
      order.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (order.customer.companyName && order.customer.companyName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      order.customer.phone.includes(searchTerm);
    
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: OrderStatus) => {
    switch (status) {
      case 'pending':
        return <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"><Clock className="w-3 h-3" /> Aguardando</span>;
      case 'approved':
        return <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Aprovado</span>;
      case 'preparing':
        return <span className="bg-purple-100 text-purple-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"><PackageCheck className="w-3 h-3" /> Em Separação</span>;
      case 'dispatched':
        return <span className="bg-cyan-100 text-cyan-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"><Truck className="w-3 h-3" /> Em Transporte</span>;
      case 'delivered':
        return <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Concluído</span>;
      case 'cancelled':
        return <span className="bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"><XCircle className="w-3 h-3" /> Cancelado</span>;
    }
  };

  const handleSendWhatsAppUpdate = (order: Order) => {
    const phone = order.customer.phone.replace(/\D/g, '');
    const cleanPhone = phone.startsWith('55') ? phone : `55${phone}`;
    
    let statusText = '';
    if (order.status === 'approved') statusText = 'foi *aprovado e confirmado*!';
    else if (order.status === 'preparing') statusText = 'está *em separação no nosso estoque*.';
    else if (order.status === 'dispatched') statusText = 'já *saiu para entrega*! 🚚';
    else if (order.status === 'delivered') statusText = 'foi *entregue com sucesso*! Agradecemos pela preferência.';
    else statusText = 'está *em análise* pela nossa equipe.';

    const message = `Olá, *${order.customer.name}*! 👋\n\nAqui é da equipe *${currentTenant.name}*.\n\nInformamos que seu pedido *#${order.orderNumber}* no valor de *R$ ${order.total.toFixed(2).replace('.', ',')}* ${statusText}\n\nQualquer dúvida estamos à disposição!`;

    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  const handlePrintSlip = (order: Order) => {
    window.print();
  };

  const kanbanColumns: { id: OrderStatus; title: string; color: string }[] = [
    { id: 'pending', title: 'Novos / Pendentes', color: 'border-amber-400' },
    { id: 'approved', title: 'Aprovados', color: 'border-blue-500' },
    { id: 'preparing', title: 'Em Separação', color: 'border-purple-500' },
    { id: 'dispatched', title: 'Despachados / Rota', color: 'border-cyan-500' },
    { id: 'delivered', title: 'Concluídos', color: 'border-emerald-500' }
  ];

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-['Outfit'] flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-blue-600" />
            Central de Pedidos & Vendas
          </h2>
          <p className="text-xs text-slate-500">
            Acompanhe pedidos recebidos pelo catálogo digital, WhatsApp e representantes de {currentTenant.name}
          </p>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
          <button
            onClick={() => setViewLayout('kanban')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              viewLayout === 'kanban' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Kanban Visual
          </button>
          <button
            onClick={() => setViewLayout('list')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              viewLayout === 'list' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tabela / Lista
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por nº pedido, cliente ou telefone..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-white border border-slate-300 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-700 font-bold">Status:</span>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="text-xs px-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium cursor-pointer"
          >
            <option value="all">Todos ({currentTenantOrders.length})</option>
            <option value="pending">Pendentes</option>
            <option value="approved">Aprovados</option>
            <option value="preparing">Em Separação</option>
            <option value="dispatched">Despachados</option>
            <option value="delivered">Concluídos</option>
            <option value="cancelled">Cancelados</option>
          </select>
        </div>
      </div>

      {/* Kanban Layout */}
      {viewLayout === 'kanban' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 overflow-x-auto pb-4">
          {kanbanColumns.map(col => {
            const colOrders = filteredOrders.filter(o => o.status === col.id);
            const colTotal = colOrders.reduce((sum, o) => sum + o.total, 0);

            return (
              <div key={col.id} className="bg-slate-100/70 rounded-2xl p-3 border border-slate-200 min-w-[240px] flex flex-col justify-between">
                <div>
                  <div className={`flex items-center justify-between pb-2 border-b-2 ${col.color} mb-3`}>
                    <span className="font-bold text-xs text-slate-800">{col.title}</span>
                    <span className="text-[11px] font-extrabold bg-white px-2 py-0.5 rounded-full border border-slate-200 text-slate-700">
                      {colOrders.length}
                    </span>
                  </div>

                  <div className="space-y-3 max-h-[600px] overflow-y-auto">
                    {colOrders.map(order => (
                      <div
                        key={order.id}
                        onClick={() => setSelectedOrder(order)}
                        className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs hover:shadow-md transition-all cursor-pointer space-y-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-bold text-blue-700">{order.orderNumber}</span>
                          <span className="text-[10px] text-slate-400">
                            {new Date(order.createdAt).toLocaleDateString('pt-BR')}
                          </span>
                        </div>

                        <div>
                          <div className="font-bold text-xs text-slate-900 line-clamp-1">{order.customer.name}</div>
                          {order.customer.companyName && (
                            <div className="text-[10px] text-slate-500 line-clamp-1">{order.customer.companyName}</div>
                          )}
                        </div>

                        <div className="text-[11px] text-slate-600 bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                          <span>{order.items.length} {order.items.length === 1 ? 'item' : 'itens'}</span>
                          <span className="mx-1">•</span>
                          <strong className="text-slate-900">R$ {order.total.toFixed(2).replace('.', ',')}</strong>
                        </div>

                        {order.sellerCode && (
                          <div className="text-[10px] text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded font-medium">
                            Vendedor: {order.sellerCode}
                          </div>
                        )}

                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                          <span className="text-[10px] text-slate-400 capitalize">{order.paymentMethod}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSendWhatsAppUpdate(order);
                            }}
                            className="text-emerald-600 hover:text-emerald-700 p-1 rounded hover:bg-emerald-50"
                            title="Notificar no WhatsApp"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-3 mt-3 border-t border-slate-200 text-right text-[11px] text-slate-500">
                  Subtotal: <strong className="text-slate-800">R$ {colTotal.toFixed(2).replace('.', ',')}</strong>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table Layout */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3.5 px-4 sm:px-6">Nº Pedido</th>
                  <th className="py-3.5 px-4">Cliente / Contato</th>
                  <th className="py-3.5 px-4">Data</th>
                  <th className="py-3.5 px-4">Itens</th>
                  <th className="py-3.5 px-4">Valor Total</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map(order => (
                  <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4 sm:px-6">
                      <div className="font-mono font-bold text-blue-700 text-xs">{order.orderNumber}</div>
                      <span className="text-[10px] text-slate-400 capitalize">{order.source.replace('_', ' ')}</span>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900 text-xs">{order.customer.name}</div>
                      <div className="text-[11px] text-slate-500">{order.customer.phone}</div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="text-slate-700 text-xs">
                        {new Date(order.createdAt).toLocaleDateString('pt-BR')}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {new Date(order.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-800 text-xs">
                        {order.items.reduce((s, i) => s + i.quantity, 0)} produtos
                      </div>
                      <div className="text-[10px] text-slate-400">{order.items.length} itens distintos</div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900 text-xs">
                        R$ {order.total.toFixed(2).replace('.', ',')}
                      </div>
                      <span className="text-[10px] text-slate-500 uppercase">{order.paymentMethod}</span>
                    </td>

                    <td className="py-3.5 px-4">
                      <select
                        value={order.status}
                        onChange={e => updateOrderStatus(order.id, e.target.value as OrderStatus)}
                        className="text-xs font-bold px-2 py-1 rounded-lg border border-slate-300 bg-white"
                      >
                        <option value="pending">Pendente</option>
                        <option value="approved">Aprovado</option>
                        <option value="preparing">Em Separação</option>
                        <option value="dispatched">Despachado</option>
                        <option value="delivered">Entregue</option>
                        <option value="cancelled">Cancelado</option>
                      </select>
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setSelectedOrder(order)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 font-bold text-xs flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" /> Detalhes
                        </button>
                        <button
                          onClick={() => handleSendWhatsAppUpdate(order)}
                          className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700"
                          title="Enviar WhatsApp"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200">
            
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 rounded-t-2xl">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-blue-700">{selectedOrder.orderNumber}</span>
                  {getStatusBadge(selectedOrder.status)}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Realizado em {new Date(selectedOrder.createdAt).toLocaleString('pt-BR')}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSendWhatsAppUpdate(selectedOrder)}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> Notificar WhatsApp
                </button>
                <button
                  onClick={() => setSelectedOrder(null)}
                  className="w-8 h-8 rounded-full hover:bg-slate-200 text-slate-500 flex items-center justify-center"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              
              {/* Customer & Delivery Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <div className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-blue-600" />
                    Dados do Comprador
                  </div>
                  <div className="text-xs font-bold text-slate-900">{selectedOrder.customer.name}</div>
                  {selectedOrder.customer.companyName && (
                    <div className="text-xs text-slate-600">{selectedOrder.customer.companyName}</div>
                  )}
                  {selectedOrder.customer.document && (
                    <div className="text-[11px] text-slate-500 font-mono">Doc: {selectedOrder.customer.document}</div>
                  )}
                  <div className="text-[11px] text-slate-600 mt-1">Tel: {selectedOrder.customer.phone}</div>
                  <div className="text-[11px] text-slate-600">Email: {selectedOrder.customer.email}</div>
                </div>

                <div>
                  <div className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-blue-600" />
                    Endereço de Entrega
                  </div>
                  <div className="text-xs text-slate-800">
                    {selectedOrder.shippingAddress.street}, {selectedOrder.shippingAddress.number}
                    {selectedOrder.shippingAddress.complement ? ` - ${selectedOrder.shippingAddress.complement}` : ''}
                  </div>
                  <div className="text-xs text-slate-600">
                    {selectedOrder.shippingAddress.neighborhood}
                  </div>
                  <div className="text-xs text-slate-600">
                    {selectedOrder.shippingAddress.city} - {selectedOrder.shippingAddress.state}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    CEP: {selectedOrder.shippingAddress.zipCode}
                  </div>
                </div>
              </div>

              {/* Items List */}
              <div>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
                  Itens Solicitados
                </div>
                <div className="space-y-2 border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                  {selectedOrder.items.map((item, idx) => (
                    <div key={idx} className="p-3 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-3">
                        <img
                          src={getSafeProductImage(item.productImage)}
                          alt={item.productName}
                          className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0"
                          onError={(e) => handleProductImageError(e)}
                        />
                        <div>
                          <div className="font-bold text-slate-900">{item.productName}</div>
                          <div className="text-[10px] text-slate-400 font-mono">SKU: {item.productSku}</div>
                          {item.selectedVariant && (
                            <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.2 rounded font-medium">
                              {item.selectedVariant}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="font-bold text-slate-900">
                          {item.quantity} {item.unit} x R$ {item.unitPrice.toFixed(2).replace('.', ',')}
                        </div>
                        <div className="text-xs font-extrabold text-blue-700">
                          = R$ {item.totalPrice.toFixed(2).replace('.', ',')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Total Calculation */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal:</span>
                  <span>R$ {selectedOrder.subtotal.toFixed(2).replace('.', ',')}</span>
                </div>
                {selectedOrder.discount > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Desconto Aplicado:</span>
                    <span>- R$ {selectedOrder.discount.toFixed(2).replace('.', ',')}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-600">
                  <span>Frete / Entrega:</span>
                  <span>
                    {selectedOrder.shippingFee === 0 
                      ? <strong className="text-emerald-600">Grátis</strong> 
                      : `R$ ${selectedOrder.shippingFee.toFixed(2).replace('.', ',')}`}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-extrabold text-slate-900 pt-2 border-t border-slate-200">
                  <span>Valor Total:</span>
                  <span className="text-blue-700">R$ {selectedOrder.total.toFixed(2).replace('.', ',')}</span>
                </div>
              </div>

              {/* Status Change Selector */}
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-700">Alterar Status:</span>
                  <select
                    value={selectedOrder.status}
                    onChange={e => {
                      const newSt = e.target.value as OrderStatus;
                      updateOrderStatus(selectedOrder.id, newSt);
                      setSelectedOrder({ ...selectedOrder, status: newSt });
                    }}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-blue-700"
                  >
                    <option value="pending">Pendente</option>
                    <option value="approved">Aprovado</option>
                    <option value="preparing">Em Separação</option>
                    <option value="dispatched">Despachado</option>
                    <option value="delivered">Concluído / Entregue</option>
                    <option value="cancelled">Cancelado</option>
                  </select>
                </div>

                <button
                  onClick={() => setSelectedOrder(null)}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
                >
                  Fechar
                </button>
              </div>

            </div>

          </div>
        </div>
      )}

    </div>
  );
};
