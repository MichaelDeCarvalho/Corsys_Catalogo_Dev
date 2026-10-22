import React, { useState } from 'react';
import { 
  Building2, 
  Users, 
  TrendingUp, 
  DollarSign, 
  ShoppingCart, 
  ExternalLink, 
  Plus, 
  Search, 
  ShieldCheck, 
  Database, 
  Mail, 
  Server, 
  CheckCircle2, 
  AlertTriangle,
  MoreVertical,
  Edit2,
  Trash2,
  Lock,
  Zap,
  Globe
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { SAAS_PLANS } from '../../data/initialData';
import { PlanType } from '../../types';

export const SuperAdminDashboard: React.FC<{ onOpenNewTenant?: () => void }> = ({ onOpenNewTenant }) => {
  const { 
    tenants, 
    setCurrentTenantId, 
    setViewMode, 
    updateTenant, 
    deleteTenant, 
    showToast 
  } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPlanFilter, setSelectedPlanFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'tenants' | 'plans' | 'infrastructure'>('tenants');

  // Metrics calculation
  const totalTenants = tenants.length;
  const activeTenants = tenants.filter(t => t.status === 'active').length;
  
  // Calculate MRR based on tenant plans
  const totalMRR = tenants.reduce((sum, t) => {
    const plan = SAAS_PLANS.find(p => p.id === t.plan);
    return sum + (plan ? plan.priceMonthly : 0);
  }, 0);

  const totalPlatformOrders = tenants.reduce((sum, t) => sum + (t.stats?.totalOrders || 0), 0);
  const totalPlatformGMV = tenants.reduce((sum, t) => sum + (t.stats?.totalRevenue || 0), 0);

  const filteredTenants = tenants.filter(t => {
    const matchesSearch = t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.slug.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.ownerEmail.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesPlan = selectedPlanFilter === 'all' || t.plan === selectedPlanFilter;
    return matchesSearch && matchesPlan;
  });

  const handleAccessStoreAdmin = (tenantId: string) => {
    setCurrentTenantId(tenantId);
    setViewMode('tenant_admin');
    showToast('Acessando painel administrativo da empresa selecionada');
  };

  const handleAccessPublicCatalog = (tenantId: string) => {
    setCurrentTenantId(tenantId);
    setViewMode('storefront');
  };

  const handlePlanChange = (tenantId: string, newPlan: PlanType) => {
    updateTenant(tenantId, { plan: newPlan });
  };

  const handleStatusToggle = (tenantId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'active' ? 'suspended' : 'active';
    updateTenant(tenantId, { status: nextStatus as any });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      
      {/* Super Admin Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 rounded-2xl text-white shadow-xl border border-indigo-900/50">
        <div>
          <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold uppercase tracking-wider mb-1">
            <ShieldCheck className="w-4 h-4" />
            Painel Master SaaS • Gestão de Clientes & Revenda
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold font-['Outfit'] text-white">
            Super Administrador da Plataforma
          </h1>
          <p className="text-sm text-slate-300 mt-1 max-w-2xl">
            Monitore todas as empresas clientes (ex: MC Distribuição, Boutiques, Lojas parceiras), assinaturas, limites de produtos e infraestrutura Supabase/Resend.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setViewMode('blueprint_guide')}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 border border-slate-700 flex items-center gap-2 transition-all cursor-pointer"
          >
            <Database className="w-4 h-4 text-emerald-400" />
            Scripts SQL & RLS
          </button>
          <button
            onClick={onOpenNewTenant}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white shadow-lg shadow-blue-600/30 flex items-center gap-2 transition-all cursor-pointer"
            id="superadmin-new-tenant-btn"
          >
            <Plus className="w-4 h-4" />
            Cadastrar Novo Lojista
          </button>
        </div>
      </div>

      {/* SaaS Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">MRR (Receita Recorrente)</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 mt-2 font-['Outfit']">
            R$ {totalMRR.toFixed(2).replace('.', ',')}
          </div>
          <div className="text-xs text-emerald-600 font-medium flex items-center gap-1 mt-1">
            <TrendingUp className="w-3.5 h-3.5" />
            Receita mensal dos planos ativos
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Empresas / Lojas Ativas</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 mt-2 font-['Outfit']">
            {activeTenants} <span className="text-sm font-normal text-slate-600">/ {totalTenants}</span>
          </div>
          <div className="text-xs text-slate-600 mt-1">
            Multi-tenants provisionados
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Pedidos Totais Processados</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
              <ShoppingCart className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 mt-2 font-['Outfit']">
            {totalPlatformOrders}
          </div>
          <div className="text-xs text-indigo-600 font-medium mt-1">
            Via WhatsApp e Web Checkout
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">GMV (Volume Vendido)</span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 mt-2 font-['Outfit']">
            R$ {totalPlatformGMV.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-600 mt-1">
            Transacionado pelas empresas
          </div>
        </div>

      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-6 text-sm font-semibold">
        <button
          onClick={() => setActiveTab('tenants')}
          className={`pb-3 transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === 'tenants'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Empresas Cadastradas ({filteredTenants.length})
        </button>

        <button
          onClick={() => setActiveTab('plans')}
          className={`pb-3 transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === 'plans'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <DollarSign className="w-4 h-4" />
          Planos de Revenda & Limites
        </button>

        <button
          onClick={() => setActiveTab('infrastructure')}
          className={`pb-3 transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === 'infrastructure'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Server className="w-4 h-4" />
          Status dos Serviços (Supabase / Resend / Netlify)
        </button>
      </div>

      {/* Tab 1: Tenants List */}
      {activeTab === 'tenants' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          
          {/* Filter Bar */}
          <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
            
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por empresa, slug ou e-mail..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">Filtrar Plano:</span>
              <select
                value={selectedPlanFilter}
                onChange={e => setSelectedPlanFilter(e.target.value)}
                className="text-xs px-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              >
                <option value="all">Todos os Planos</option>
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>

          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3.5 px-4 sm:px-6">Empresa / Subdomínio</th>
                  <th className="py-3.5 px-4">Responsável</th>
                  <th className="py-3.5 px-4">Plano SaaS</th>
                  <th className="py-3.5 px-4">Produtos / Pedidos</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Ações Rápidas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTenants.map((t) => {
                  const planObj = SAAS_PLANS.find(p => p.id === t.plan);
                  return (
                    <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-4 px-4 sm:px-6">
                        <div className="flex items-center gap-3">
                          <div 
                            className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shadow-sm shrink-0"
                            style={{ backgroundColor: t.customization.primaryColor || '#0284c7' }}
                          >
                            {t.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                              {t.name}
                              {t.slug === 'mc-distribuicao' && (
                                <span className="bg-blue-100 text-blue-800 text-[10px] px-1.5 py-0.5 rounded font-semibold">
                                  Flagship Original
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                              <Globe className="w-3 h-3 text-slate-400" />
                              app.com/{t.slug}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-4 px-4">
                        <div className="font-medium text-slate-900">{t.ownerName}</div>
                        <div className="text-[11px] text-slate-400">{t.ownerEmail}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{t.ownerPhone}</div>
                      </td>

                      <td className="py-4 px-4">
                        <select
                          value={t.plan}
                          onChange={e => handlePlanChange(t.id, e.target.value as PlanType)}
                          className="font-bold text-xs px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-blue-700 cursor-pointer"
                        >
                          <option value="starter">Starter (R$ 79,90)</option>
                          <option value="pro">Pro (R$ 189,90)</option>
                          <option value="enterprise">Enterprise (R$ 399,90)</option>
                        </select>
                      </td>

                      <td className="py-4 px-4">
                        <div className="font-medium text-slate-900">
                          {t.stats.totalProducts} produtos
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {t.stats.totalOrders} pedidos realizados
                        </div>
                        <div className="text-[11px] font-semibold text-emerald-600">
                          R$ {t.stats.totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </div>
                      </td>

                      <td className="py-4 px-4">
                        <button
                          onClick={() => handleStatusToggle(t.id, t.status)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold cursor-pointer transition-colors ${
                            t.status === 'active'
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'bg-red-50 text-red-700 hover:bg-red-100'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${t.status === 'active' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                          {t.status === 'active' ? 'Ativo' : 'Suspenso'}
                        </button>
                      </td>

                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleAccessStoreAdmin(t.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 font-bold text-xs flex items-center gap-1 transition-colors"
                            title="Entrar no Painel da Loja"
                          >
                            <Building2 className="w-3.5 h-3.5" />
                            Painel
                          </button>

                          <button
                            onClick={() => handleAccessPublicCatalog(t.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 font-bold text-xs flex items-center gap-1 transition-colors"
                            title="Visualizar Catálogo Público"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Catálogo
                          </button>

                          {tenants.length > 1 && (
                            <button
                              onClick={() => {
                                if (confirm(`Deseja realmente excluir o tenant ${t.name}?`)) {
                                  deleteTenant(t.id);
                                }
                              }}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                              title="Remover Empresa"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

        </div>
      )}

      {/* Tab 2: SaaS Plans */}
      {activeTab === 'plans' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {SAAS_PLANS.map((plan) => (
            <div key={plan.id} className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-sm text-slate-900 uppercase tracking-wider">{plan.name}</span>
                  {plan.id === 'pro' && (
                    <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                      Mais Popular
                    </span>
                  )}
                </div>

                <div className="mt-4">
                  <span className="text-3xl font-extrabold text-slate-900 font-['Outfit']">
                    R$ {plan.priceMonthly.toFixed(2).replace('.', ',')}
                  </span>
                  <span className="text-xs text-slate-500"> / mês por empresa</span>
                </div>

                <div className="mt-4 space-y-2 text-xs text-slate-600">
                  <div className="font-semibold text-slate-900">Capacidade do Plano:</div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>Até <strong>{plan.maxProducts}</strong> produtos no catálogo</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>Até <strong>{plan.maxUsers}</strong> usuários/vendedores</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>Até <strong>{plan.maxMonthlyOrders}</strong> pedidos mensais</span>
                  </div>
                  {plan.customDomainAllowed && (
                    <div className="flex items-center gap-2 text-blue-600 font-medium">
                      <Globe className="w-4 h-4 shrink-0" />
                      <span>Domínio próprio (catalogo.loja.com.br)</span>
                    </div>
                  )}
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 space-y-2">
                  <div className="font-semibold text-xs text-slate-900">Recursos Inclusos:</div>
                  {plan.features.map((feat, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-[11px] text-slate-600">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 pt-4">
                <div className="text-[11px] text-center text-slate-400">
                  {tenants.filter(t => t.plan === plan.id).length} empresas assinando este plano
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab 3: Infrastructure Health */}
      {activeTab === 'infrastructure' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
                <Database className="w-5 h-5 text-emerald-600" />
                <span>Supabase PostgreSQL + RLS</span>
              </div>
              <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-3.5 h-3.5" /> Conectado
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Row Level Security ativo garantindo que cada lojista veja estritamente seus dados através do <code className="text-slate-800 font-mono font-bold">tenant_id</code>.
            </p>
            <div className="space-y-1.5 text-xs text-slate-600 bg-slate-50 p-3 rounded-xl font-mono">
              <div>Schema: <strong>public</strong></div>
              <div>Políticas RLS: <strong>14 ativas</strong></div>
              <div>Tabelas: <strong>tenants, products, orders, users</strong></div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
                <Mail className="w-5 h-5 text-blue-600" />
                <span>Resend Email Transacional</span>
              </div>
              <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-3.5 h-3.5" /> Pronto
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Envio de confirmações de pedidos para clientes e notificações de vendas para o WhatsApp/E-mail do lojista.
            </p>
            <div className="space-y-1.5 text-xs text-slate-600 bg-slate-50 p-3 rounded-xl font-mono">
              <div>Remetente Master: <strong>pedidos@omnicatalogo.com.br</strong></div>
              <div>DKIM/SPF: <strong>Verificado</strong></div>
              <div>Taxa de Entrega: <strong>99.8%</strong></div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
                <Globe className="w-5 h-5 text-purple-600" />
                <span>Netlify Wildcard / Subdomínios</span>
              </div>
              <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-3.5 h-3.5" /> Ativo
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Roteamento automático de subdomínios (*.seucatalogo.com) e domínios personalizados para os catálogos dos clientes.
            </p>
            <div className="space-y-1.5 text-xs text-slate-600 bg-slate-50 p-3 rounded-xl font-mono">
              <div>SSL Wildcard: <strong>Let's Encrypt Ativo</strong></div>
              <div>Edge Redirects: <strong>Habilitado</strong></div>
              <div>Build CI/CD: <strong>GitHub Main</strong></div>
            </div>
          </div>

        </div>
      )}

    </div>
  );
};
