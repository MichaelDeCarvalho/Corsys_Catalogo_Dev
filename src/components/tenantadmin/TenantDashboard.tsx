import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Building2, 
  Package, 
  ShoppingCart, 
  Users, 
  Settings, 
  ExternalLink, 
  Share2, 
  TrendingUp, 
  DollarSign, 
  Eye, 
  Check, 
  Sparkles,
  QrCode,
  Globe
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { ProductManager } from './ProductManager';
import { OrderManager } from './OrderManager';
import { TeamAccessManager } from './TeamAccessManager';
import { CheckoutFieldSettings } from './CheckoutFieldSettings';
import { DeliverySettings } from './DeliverySettings';
import { StoreSettings } from './StoreSettings';
import { WholesaleCustomerManager } from './WholesaleCustomerManager';
import { fetchAdminProducts, isValidUuid } from '../../services/adminCatalogService';
import { fetchAdminOrders } from '../../services/adminOrderService';
import { fetchTenantPublicSettings } from '../../services/catalogService';
import { Product, Order } from '../../types';

export const TenantDashboard: React.FC = () => {
  const { currentTenant, setViewMode, showToast } = useApp();
  const { authTenant, authTenantId, isPlatformAdmin } = useAuth();

  const [activeTab, setActiveTab] = useState<'products' | 'orders' | 'wholesale_customers' | 'team' | 'settings'>('products');
  const [copiedLink, setCopiedLink] = useState(false);

  // Estado dos produtos administrativos carregados do Supabase
  const [adminProducts, setAdminProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState<boolean>(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [adminTenantId, setAdminTenantId] = useState<string | null>(null);

  // Estado dos pedidos administrativos reais carregados do Supabase (public.orders)
  const [adminOrders, setAdminOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState<boolean>(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  // Timestamp de guarda anti-duplicação de refresh (focus + visibilitychange concorrentes)
  const lastRefreshAtRef = useRef<number>(0);

  /**
   * Resolução segura de Tenant UUID Administrativo:
   * 1. tenant_admin: exclusivamente authTenantId (ou authTenant.id) de tenant_users.
   *    Se ausente: FAIL CLOSED com erro explícito de contexto.
   * 2. platform_admin: autorização global. Se não possuir tenant_users, resolve contexto
   *    administrativo de navegação via PUBLIC_TENANT_SLUG -> tenant_public_settings -> tenant_id UUID.
   *    RLS em public.products continua sendo a autoridade de autorização.
   * NUNCA utiliza currentTenant.id, "tenant-mc-distribuicao", localStorage ou UUID hardcoded.
   */
  const resolveTargetTenantId = useCallback(async (): Promise<string> => {
    if (!isPlatformAdmin) {
      if (authTenantId && isValidUuid(authTenantId)) {
        return authTenantId;
      }
      if (authTenant?.id && isValidUuid(authTenant.id)) {
        return authTenant.id;
      }
      throw new Error('Contexto administrativo inválido: tenant_id real do Supabase não foi resolvido para este administrador.');
    }

    // Platform admin: verifica se possui vínculo explícito ou resolve contexto temporário via slug canônico
    if (authTenantId && isValidUuid(authTenantId)) {
      return authTenantId;
    }
    if (authTenant?.id && isValidUuid(authTenant.id)) {
      return authTenant.id;
    }

    const publicSlug = (import.meta as any).env?.VITE_PUBLIC_TENANT_SLUG || 'corsys-catalogo-demo';
    const settings = await fetchTenantPublicSettings(publicSlug);
    if (!settings?.tenantId || !isValidUuid(settings.tenantId)) {
      throw new Error('Contexto administrativo inválido: tenant_id real do Supabase não foi resolvido pelo slug público.');
    }
    return settings.tenantId;
  }, [authTenantId, authTenant, isPlatformAdmin]);

  const loadAdminProducts = useCallback(async () => {
    setProductsLoading(true);
    setProductsError(null);
    try {
      const resolvedTenantId = await resolveTargetTenantId();
      if (!isValidUuid(resolvedTenantId)) {
        throw new Error('Identificador de tenant resolvido não é um UUID v4 válido.');
      }
      setAdminTenantId(resolvedTenantId);
      const data = await fetchAdminProducts(resolvedTenantId);
      setAdminProducts(data);
    } catch (err: unknown) {
      setAdminTenantId(null);
      const msg = err instanceof Error ? err.message : 'Falha ao carregar catálogo administrativo do Supabase.';
      console.error('[TenantDashboard] Erro ao carregar produtos:', err);
      setProductsError(msg);
      setAdminProducts([]);
    } finally {
      setProductsLoading(false);
    }
  }, [resolveTargetTenantId]);

  const loadAdminOrders = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const resolvedTenantId = await resolveTargetTenantId();
      if (!isValidUuid(resolvedTenantId)) {
        throw new Error('Identificador de tenant resolvido não é um UUID v4 válido.');
      }
      const data = await fetchAdminOrders(resolvedTenantId);
      setAdminOrders(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao carregar pedidos administrativos do Supabase.';
      console.error('[TenantDashboard] Erro ao carregar pedidos:', err);
      setOrdersError(msg);
      setAdminOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  }, [resolveTargetTenantId]);

  /**
   * Recarga unificada de dados administrativos (pedidos e catálogo/estoque).
   * Utiliza throttle de 800ms para evitar requisições duplicadas.
   */
  const refreshAdminData = useCallback(async () => {
    const now = Date.now();
    if (now - lastRefreshAtRef.current < 800) {
      return;
    }
    lastRefreshAtRef.current = now;
    await Promise.all([
      loadAdminProducts(),
      loadAdminOrders()
    ]);
  }, [loadAdminProducts, loadAdminOrders]);

  /**
   * Callback disparado após alteração autoritativa de status de pedido.
   * Recarrega concorrentemente pedidos e estoque para manter dados frescos.
   */
  const handleOrderStatusChanged = useCallback(async () => {
    await Promise.all([
      loadAdminOrders(),
      loadAdminProducts()
    ]);
  }, [loadAdminOrders, loadAdminProducts]);

  useEffect(() => {
    loadAdminProducts();
    loadAdminOrders();
  }, [loadAdminProducts, loadAdminOrders]);

  /**
   * Auto-refresh por foco da janela e mudança de visibilidade da aba.
   * Mantém o estoque e pedidos atualizados mesmo com alterações em outras abas.
   */
  useEffect(() => {
    const handleFocus = () => {
      refreshAdminData();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshAdminData();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshAdminData]);

  const displayTenantName = authTenant?.name || currentTenant.name;
  const displayTenantSlug = authTenant?.slug || currentTenant.slug;
  const displayTenantPlan = (authTenant?.plan || currentTenant.plan).toUpperCase();

  // Stats calculadas EXCLUSIVAMENTE a partir dos dados reais do Supabase (public.orders)
  const totalRevenue = adminOrders.reduce((sum, o) => sum + o.total, 0);
  const pendingOrders = adminOrders.filter(o => o.status === 'pending').length;
  const activeProductsCount = adminProducts.filter(p => p.active).length;

  const handleCopyPublicLink = () => {
    const domain = authTenant?.custom_domain || currentTenant.customization.customDomain || `app.com/${displayTenantSlug}`;
    const url = `https://${domain}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    showToast(`Link do catálogo copiado: ${url}`);
    setTimeout(() => setCopiedLink(false), 3000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      
      {/* Store Banner & Summary */}
      <div 
        className="relative overflow-hidden rounded-3xl p-6 sm:p-8 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6"
        style={{ 
          background: `linear-gradient(135deg, ${currentTenant.customization.primaryColor || '#0284c7'} 0%, #0f172a 100%)` 
        }}
      >
        <div className="relative z-10 flex items-start sm:items-center gap-4">
          <img
            src={currentTenant.customization.logoUrl || 'https://images.unsplash.com/photo-1578575437130-527eed3abbec?w=200'}
            alt={displayTenantName}
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover border-2 border-white/30 shadow-md bg-white shrink-0"
            referrerPolicy="no-referrer"
          />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="bg-white/20 backdrop-blur-md text-white text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full border border-white/20">
                Plano {displayTenantPlan}
              </span>
              <span className="text-white/70 text-xs font-mono">
                /{displayTenantSlug}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold font-['Outfit'] mt-1 text-white">
              {displayTenantName}
            </h1>
            <p className="text-xs sm:text-sm text-white/80 max-w-xl line-clamp-1">
              {currentTenant.customization.segment || 'Distribuidora & Comércio Atacadista'}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="relative z-10 flex items-center gap-2.5 flex-wrap">
          <button
            onClick={handleCopyPublicLink}
            className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold backdrop-blur-md border border-white/20 flex items-center gap-2 transition-all cursor-pointer"
          >
            {copiedLink ? <Check className="w-4 h-4 text-emerald-300" /> : <Share2 className="w-4 h-4" />}
            {copiedLink ? 'Link Copiado!' : 'Copiar Link Catálogo'}
          </button>

          <button
            onClick={() => setViewMode('storefront')}
            className="px-5 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 text-xs font-bold shadow-lg flex items-center gap-2 transition-all cursor-pointer"
            id="open-catalog-from-admin"
          >
            <ExternalLink className="w-4 h-4 text-blue-600" />
            Abrir Catálogo Público
          </button>
        </div>
      </div>

      {/* Quick Store KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Faturamento Total</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-2 font-['Outfit']">
            {ordersLoading ? (
              <span className="inline-block w-24 h-6 bg-slate-100 rounded animate-pulse" />
            ) : (
              `R$ ${totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
            )}
          </div>
          <div className="text-[11px] text-emerald-600 font-medium mt-0.5">
            {ordersLoading ? 'Carregando pedidos...' : `${adminOrders.length} pedidos no total`}
          </div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Produtos Ativos</span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-2 font-['Outfit']">
            {productsLoading ? (
              <span className="inline-block w-8 h-6 bg-slate-100 rounded animate-pulse" />
            ) : (
              activeProductsCount
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {productsLoading ? 'Carregando catálogo...' : `${adminProducts.length} itens no total`}
          </div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Novos Pedidos</span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
              <ShoppingCart className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-2 font-['Outfit']">
            {ordersLoading ? (
              <span className="inline-block w-12 h-6 bg-slate-100 rounded animate-pulse" />
            ) : (
              pendingOrders
            )}
          </div>
          <div className="text-[11px] text-amber-600 font-semibold mt-0.5">
            {ordersLoading ? 'Carregando pedidos...' : 'Aguardando aprovação'}
          </div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Visitas no Mês</span>
            <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
              <Eye className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-2 font-['Outfit']">
            {currentTenant.stats?.monthVisits || 1250}
          </div>
          <div className="text-[11px] text-indigo-600 font-medium mt-0.5">
            Acessos ao link público
          </div>
        </div>

      </div>

      {/* Main Tab Navigation */}
      <div className="flex border-b border-slate-200 gap-2 sm:gap-6 text-xs sm:text-sm font-semibold overflow-x-auto">
        
        <button
          onClick={() => setActiveTab('products')}
          className={`pb-3 transition-colors border-b-2 flex items-center gap-2 shrink-0 cursor-pointer ${
            activeTab === 'products'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
          id="tab-tenant-products"
        >
          <Package className="w-4 h-4" />
          Produtos & Estoque ({productsLoading ? '...' : adminProducts.length})
        </button>

        <button
          onClick={() => setActiveTab('orders')}
          className={`pb-3 transition-colors border-b-2 flex items-center gap-2 shrink-0 cursor-pointer ${
            activeTab === 'orders'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
          id="tab-tenant-orders"
        >
          <ShoppingCart className="w-4 h-4" />
          Pedidos & Vendas ({ordersLoading ? '...' : adminOrders.length})
          {pendingOrders > 0 && (
            <span className="w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-extrabold flex items-center justify-center">
              {pendingOrders}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('wholesale_customers')}
          className={`pb-3 transition-colors border-b-2 flex items-center gap-2 shrink-0 cursor-pointer ${
            activeTab === 'wholesale_customers'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
          id="tab-tenant-wholesale-customers"
        >
          <Building2 className="w-4 h-4" />
          Clientes Atacadistas (B2B)
        </button>

        <button
          onClick={() => setActiveTab('team')}
          className={`pb-3 transition-colors border-b-2 flex items-center gap-2 shrink-0 cursor-pointer ${
            activeTab === 'team'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
          id="tab-tenant-team"
        >
          <Users className="w-4 h-4" />
          Controle de Acessos & Vendedores
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`pb-3 transition-colors border-b-2 flex items-center gap-2 shrink-0 cursor-pointer ${
            activeTab === 'settings'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
          id="tab-tenant-settings"
        >
          <Settings className="w-4 h-4" />
          Personalização & Contatos
        </button>

      </div>

      {/* Tab Contents */}
      <div>
        {activeTab === 'products' && (
          <ProductManager 
            products={adminProducts}
            tenantId={adminTenantId}
            loading={productsLoading}
            error={productsError}
            onReload={loadAdminProducts}
          />
        )}
        {activeTab === 'orders' && (
          <OrderManager 
            orders={adminOrders}
            loading={ordersLoading}
            error={ordersError}
            onReload={loadAdminOrders}
            onStatusChanged={handleOrderStatusChanged}
          />
        )}
        {activeTab === 'wholesale_customers' && <WholesaleCustomerManager />}
        {activeTab === 'team' && <TeamAccessManager />}
        {activeTab === 'settings' && <React.Fragment key={adminTenantId}><CheckoutFieldSettings tenantId={adminTenantId} /><DeliverySettings tenantId={adminTenantId} /><StoreSettings /></React.Fragment>}
      </div>

    </div>
  );
};
