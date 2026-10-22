import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Package, 
  Clock, 
  CheckCircle2, 
  Truck, 
  AlertCircle, 
  ArrowLeft, 
  RefreshCw,
  ShoppingBag,
  Calendar,
  CreditCard
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { PUBLIC_TENANT_SLUG } from '../../config/tenant';
import { fetchTenantPublicSettings } from '../../services/catalogService';
import { useAuth } from '../../context/AuthContext';
import { 
  CustomerTrackedOrder, 
  getStoredRetailTrackings, 
  trackOrderByToken, 
  listMyCustomerOrders 
} from '../../services/customerTrackingService';

const formatCurrency = (val: number): string => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
};

const STATUS_LABELS: Record<string, { label: string; color: string; icon: React.FC<{ className?: string }> }> = {
  pending: { label: 'Aguardando Aprovação', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20', icon: Clock },
  approved: { label: 'Pedido Confirmado', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20', icon: CheckCircle2 },
  preparing: { label: 'Em Separação', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20', icon: Package },
  dispatched: { label: 'Enviado / Em Trânsito', color: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20', icon: Truck },
  delivered: { label: 'Entregue', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: CheckCircle2 },
  cancelled: { label: 'Cancelado', color: 'bg-rose-500/10 text-rose-400 border-rose-500/20', icon: AlertCircle },
};

export const CustomerOrderTrackingView: React.FC = () => {
  const { setViewMode } = useApp();
  const { session } = useAuth();

  const [activeTab, setActiveTab] = useState<'b2b' | 'retail'>(session ? 'b2b' : 'retail');
  const [b2bOrders, setB2bOrders] = useState<CustomerTrackedOrder[]>([]);
  const [retailOrders, setRetailOrders] = useState<CustomerTrackedOrder[]>([]);
  const [publicStoreName, setPublicStoreName] = useState<string | null>(null);
  const [selectedOrderNumber, setSelectedOrderNumber] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const identity = session?.user.id ?? null;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const requestGeneration = useRef(0);
  const [ordersIdentity, setOrdersIdentity] = useState<string | null>(null);

  // A marca exibida deve pertencer ao slug público oficial, nunca ao tenant mock do AppContext.
  useEffect(() => {
    let active = true;
    fetchTenantPublicSettings(PUBLIC_TENANT_SLUG)
      .then(settings => { if (active) setPublicStoreName(settings.publicName); })
      .catch(() => { if (active) setPublicStoreName(null); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    requestGeneration.current++;
    setB2bOrders([]); setOrdersIdentity(null); setSelectedOrderNumber(null);
    setErrorMsg(null); setIsLoading(false);
    return () => { requestGeneration.current++; };
  }, [identity]);

  // Sincronização e privacidade de sessão (Logout Privacy)
  useEffect(() => {
    if (!session) {
      setB2bOrders([]);
      setActiveTab('retail');
      setSelectedOrderNumber((current) => {
        // Se o pedido selecionado for atacado, desseleciona
        const currentSelected = b2bOrders.find((o) => o.orderNumber === current);
        return currentSelected ? null : current;
      });
    } else {
      setActiveTab('b2b');
    }
  }, [session]);

  const loadB2bOrders = useCallback(async () => {
    if (!session) return;
    const buyer = session.user.id;
    const generation = ++requestGeneration.current;
    const isCurrent = () => identityRef.current === buyer && requestGeneration.current === generation;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await listMyCustomerOrders(PUBLIC_TENANT_SLUG);
      if (!isCurrent()) return;
      setB2bOrders(res.orders);
      setOrdersIdentity(buyer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao carregar pedidos.';
      if (isCurrent()) setErrorMsg(msg);
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [session]);

  const loadStoredRetailOrders = useCallback(async () => {
    const trackings = getStoredRetailTrackings(PUBLIC_TENANT_SLUG);
    if (trackings.length === 0) {
      setRetailOrders([]);
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    // O tracking usa o mesmo slug público canônico do Storefront/Checkout.
    // Não usar currentTenant.slug aqui: ele pertence ao estado legado/mock do AppContext.
    const results = await Promise.allSettled(
      trackings.map((item) => trackOrderByToken(PUBLIC_TENANT_SLUG, item.trackingToken))
    );

    const fetched: CustomerTrackedOrder[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        fetched.push(r.value);
      }
    }

    setRetailOrders(fetched);
    setIsLoading(false);
  }, []);

  // Carrega pedidos B2B se autenticado
  useEffect(() => {
    if (session && activeTab === 'b2b') {
      loadB2bOrders();
    }
  }, [session, activeTab, loadB2bOrders]);

  // Carrega pedidos de varejo salvos localmente
  useEffect(() => {
    if (activeTab === 'retail') {
      loadStoredRetailOrders();
    }
  }, [activeTab, loadStoredRetailOrders]);

  const visibleB2bOrders = ordersIdentity === identity ? b2bOrders : [];
  const currentList = activeTab === 'b2b' ? visibleB2bOrders : retailOrders;
  const selectedOrder = currentList.find((o) => o.orderNumber === selectedOrderNumber) || null;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-800 gap-4">
        <div>
          <button
            onClick={() => setViewMode('storefront')}
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white mb-2 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Voltar ao Catálogo
          </button>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Package className="w-6 h-6 text-[#FF5A00]" />
            Acompanhar Meus Pedidos
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Consulte o status e histórico de pedidos em <span className="text-slate-200 font-semibold">{publicStoreName || 'sua loja'}</span>.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-xl self-start sm:self-auto">
          {session && (
            <button
              onClick={() => { setActiveTab('b2b'); setSelectedOrderNumber(null); setErrorMsg(null); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === 'b2b' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Atacado B2B ({visibleB2bOrders.length})
            </button>
          )}
          <button
            onClick={() => { setActiveTab('retail'); setSelectedOrderNumber(null); setErrorMsg(null); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'retail' ? 'bg-[#FF5A00] text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Pedidos Recentes de Varejo ({retailOrders.length})
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left / List Column */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                {activeTab === 'b2b' ? 'Histórico de Atacado' : 'Pedidos Neste Navegador'}
              </h2>
              <button
                onClick={activeTab === 'b2b' ? loadB2bOrders : loadStoredRetailOrders}
                disabled={isLoading}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
                title="Atualizar lista"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {isLoading && (
              <div className="py-8 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-[#FF5A00]" />
                Carregando pedidos...
              </div>
            )}

            {!isLoading && activeTab === 'b2b' && visibleB2bOrders.length === 0 && (
              <div className="py-8 text-center text-xs text-slate-400">
                Nenhum pedido de atacado registrado ainda.
              </div>
            )}

            {!isLoading && activeTab === 'retail' && retailOrders.length === 0 && (
              <div className="py-8 px-2 text-center text-xs text-slate-400 space-y-2">
                <Package className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="font-medium text-slate-300">
                  Seus novos pedidos feitos neste navegador aparecerão aqui.
                </p>
                <p className="text-[11px] text-slate-500">
                  Para pedidos sem conta, o acompanhamento fica vinculado a este navegador.
                </p>
              </div>
            )}

            {!isLoading && (
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {currentList.map((ord) => {
                  const statusConf = STATUS_LABELS[ord.status] || STATUS_LABELS.pending;
                  const isSelected = selectedOrderNumber === ord.orderNumber;
                  return (
                    <button
                      key={ord.orderNumber}
                      onClick={() => setSelectedOrderNumber(ord.orderNumber)}
                      className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${
                        isSelected 
                          ? 'bg-slate-800 border-[#FF5A00] shadow-sm' 
                          : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-850 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-white">#{ord.orderNumber}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusConf.color}`}>
                          {statusConf.label}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-2 text-[11px] text-slate-400">
                        <span>{new Date(ord.createdAt).toLocaleDateString('pt-BR')}</span>
                        <span className="font-semibold text-slate-200">{formatCurrency(ord.total)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right / Detail Column */}
        <div className="lg:col-span-2">
          {errorMsg && (
            <div className="mb-4 p-3 bg-red-950/40 border border-red-800/60 rounded-xl text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {selectedOrder ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
              {/* Order Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-white">Pedido #{selectedOrder.orderNumber}</span>
                    <span className="text-[10px] uppercase font-bold px-2 py-0.5 bg-slate-800 text-slate-300 rounded border border-slate-700">
                      {selectedOrder.shoppingMode === 'wholesale' ? 'Atacado' : 'Varejo'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5" />
                    Registrado em {new Date(selectedOrder.createdAt).toLocaleString('pt-BR')}
                  </p>
                </div>

                {/* Status Badge */}
                <div>
                  {(() => {
                    const statusConf = STATUS_LABELS[selectedOrder.status] || STATUS_LABELS.pending;
                    const StatusIcon = statusConf.icon;
                    return (
                      <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold ${statusConf.color}`}>
                        <StatusIcon className="w-4 h-4" />
                        {statusConf.label}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Items List */}
              <div>
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
                  Itens do Pedido ({selectedOrder.items.length})
                </h3>
                <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden bg-slate-950/50">
                  {selectedOrder.items.map((it, idx) => (
                    <div key={`${it.productId}-${idx}`} className="p-3 flex items-center justify-between text-xs gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {it.productImage && (
                          <img 
                            src={it.productImage} 
                            alt={it.productName} 
                            className="w-10 h-10 object-cover rounded-lg bg-slate-800 shrink-0" 
                          />
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-white truncate">{it.productName}</p>
                          <p className="text-[11px] text-slate-400">
                            SKU: {it.productSku} {it.selectedVariant ? `• ${it.selectedVariant}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold text-slate-200">
                          {it.quantity} {it.unit} × {formatCurrency(it.unitPrice)}
                        </p>
                        <p className="font-bold text-white text-[11px]">{formatCurrency(it.totalPrice)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Financial Totals */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>Subtotal</span>
                  <span>{formatCurrency(selectedOrder.subtotal)}</span>
                </div>
                {selectedOrder.discount > 0 && (
                  <div className="flex justify-between text-emerald-400">
                    <span>Desconto</span>
                    <span>-{formatCurrency(selectedOrder.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-400">
                  <span>Frete</span>
                  <span>{selectedOrder.shippingFee > 0 ? formatCurrency(selectedOrder.shippingFee) : 'A combinar'}</span>
                </div>
                <div className="pt-2 border-t border-slate-800 flex justify-between font-bold text-sm text-white">
                  <span>Total</span>
                  <span className="text-[#FF5A00]">{formatCurrency(selectedOrder.total)}</span>
                </div>
              </div>

              {/* Delivery and Payment Details (Zero PII / Sem Endereço) */}
              <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-4 text-xs space-y-2">
                <div className="flex items-center gap-1.5 font-bold text-slate-300">
                  <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
                  Detalhes de Entrega e Pagamento
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-400 pt-1">
                  <div>
                    <span className="text-slate-500">Forma de Pagamento: </span>
                    <span className="text-slate-300 uppercase font-semibold">{selectedOrder.paymentMethod}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Método de Entrega: </span>
                    <span className="text-slate-300 font-semibold">{selectedOrder.deliveryMethod}</span>
                  </div>
                </div>
              </div>

            </div>
          ) : (
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 flex flex-col items-center justify-center">
              <ShoppingBag className="w-12 h-12 text-slate-700 mb-3" />
              <h3 className="font-semibold text-slate-300 text-sm">Nenhum pedido selecionado</h3>
              <p className="text-xs text-slate-500 max-w-sm mt-1">
                Selecione um pedido na lista ao lado para visualizar os detalhes.
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
