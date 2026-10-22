import React, { useState, useEffect, useCallback } from 'react';
import { 
  Building2, 
  Search, 
  Filter, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Clock, 
  RefreshCw, 
  Loader2, 
  Eye, 
  Mail, 
  Phone, 
  MapPin, 
  ShieldCheck, 
  UserCheck, 
  UserX,
  Calendar,
  X,
  AlertCircle
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { WholesaleCustomer, WholesaleCustomerStatus } from '../../types';
import { 
  fetchAdminWholesaleCustomers, 
  manageAdminWholesaleCustomer, 
  formatCnpj 
} from '../../services/wholesaleService';
import { isValidUuid } from '../../services/adminCatalogService';
import { fetchTenantPublicSettings } from '../../services/catalogService';

export const WholesaleCustomerManager: React.FC = () => {
  const { authTenant, authTenantId, isPlatformAdmin } = useAuth();
  const { showToast } = useApp();

  const [customers, setCustomers] = useState<WholesaleCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTenantId, setActiveTenantId] = useState<string>('');

  // Filtros
  const [filterStatus, setFilterStatus] = useState<'all' | WholesaleCustomerStatus>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Modal de Detalhes
  const [selectedCustomer, setSelectedCustomer] = useState<WholesaleCustomer | null>(null);
  const [actionProcessing, setActionProcessing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Resolução do Tenant ID com mesma garantia de isolamento do catálogo
  const resolveTargetTenantId = useCallback(async (): Promise<string> => {
    if (!isPlatformAdmin) {
      if (authTenantId && isValidUuid(authTenantId)) {
        return authTenantId;
      }
      if (authTenant?.id && isValidUuid(authTenant.id)) {
        return authTenant.id;
      }
      throw new Error('Contexto administrativo inválido: tenant_id do Supabase não resolvido.');
    }

    if (authTenantId && isValidUuid(authTenantId)) {
      return authTenantId;
    }
    if (authTenant?.id && isValidUuid(authTenant.id)) {
      return authTenant.id;
    }

    const publicSlug = (import.meta as any).env?.VITE_PUBLIC_TENANT_SLUG || 'corsys-catalogo-demo';
    const settings = await fetchTenantPublicSettings(publicSlug);
    if (!settings?.tenantId || !isValidUuid(settings.tenantId)) {
      throw new Error('Contexto administrativo inválido: tenant_id não encontrado para a loja.');
    }
    return settings.tenantId;
  }, [authTenantId, authTenant, isPlatformAdmin]);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resolvedId = await resolveTargetTenantId();
      setActiveTenantId(resolvedId);
      const data = await fetchAdminWholesaleCustomers(resolvedId);
      setCustomers(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao carregar clientes atacadistas.';
      console.error('[WholesaleCustomerManager] Erro:', err);
      setError(msg);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, [resolveTargetTenantId]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  // Ação administrativa
  const handleAction = async (action: 'approve' | 'reject' | 'suspend' | 'reactivate') => {
    if (!selectedCustomer) return;

    setActionProcessing(true);
    setActionError(null);
    try {
      const res = await manageAdminWholesaleCustomer(selectedCustomer.id, action);
      showToast(res.message);
      // Atualiza localmente e recarrega
      setSelectedCustomer(null);
      await loadCustomers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao executar ação.';
      setActionError(msg);
    } finally {
      setActionProcessing(false);
    }
  };

  // Filtragem
  const filteredCustomers = customers.filter(c => {
    const matchesStatus = filterStatus === 'all' || c.status === filterStatus;
    const searchLower = searchTerm.toLowerCase().trim();
    const matchesSearch = 
      !searchLower ||
      c.legalName.toLowerCase().includes(searchLower) ||
      (c.tradeName && c.tradeName.toLowerCase().includes(searchLower)) ||
      c.cnpj.includes(searchLower.replace(/\D/g, '')) ||
      c.contactName.toLowerCase().includes(searchLower) ||
      c.email.toLowerCase().includes(searchLower);

    return matchesStatus && matchesSearch;
  });

  const countPending = customers.filter(c => c.status === 'pending').length;
  const countApproved = customers.filter(c => c.status === 'approved').length;
  const countRejected = customers.filter(c => c.status === 'rejected').length;
  const countSuspended = customers.filter(c => c.status === 'suspended').length;

  const renderStatusBadge = (status: WholesaleCustomerStatus) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Aprovado
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 animate-pulse">
            <Clock className="w-3.5 h-3.5" />
            Pendente
          </span>
        );
      case 'suspended':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300">
            <AlertTriangle className="w-3.5 h-3.5" />
            Suspenso
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3.5 h-3.5" />
            Rejeitado
          </span>
        );
    }
  };

  return (
    <div className="space-y-6" id="wholesale-customer-manager">
      {/* Header & Overview */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 text-amber-800 text-xs font-bold mb-2">
            <Building2 className="w-3.5 h-3.5" />
            Gestão Comercial B2B
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">
            Clientes Atacadistas
          </h2>
          <p className="text-slate-500 text-xs">
            Aprovação e controle de acesso para compradores com CNPJ. Somente empresas aprovadas visualizam preços de atacado.
          </p>
        </div>

        <button
          onClick={loadCustomers}
          disabled={loading}
          className="self-start sm:self-auto inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar Lista
        </button>
      </div>

      {/* KPI Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div 
          onClick={() => setFilterStatus('pending')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            filterStatus === 'pending' 
              ? 'bg-amber-50/80 border-amber-300 ring-2 ring-amber-500/20' 
              : 'bg-white border-slate-200/70 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-amber-700 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Pendentes</span>
            <Clock className="w-4 h-4" />
          </div>
          <div className="text-2xl font-black text-slate-900">{countPending}</div>
          <span className="text-[10px] text-slate-400">Aguardando análise</span>
        </div>

        <div 
          onClick={() => setFilterStatus('approved')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            filterStatus === 'approved' 
              ? 'bg-emerald-50/80 border-emerald-300 ring-2 ring-emerald-500/20' 
              : 'bg-white border-slate-200/70 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-emerald-700 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Aprovados</span>
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div className="text-2xl font-black text-slate-900">{countApproved}</div>
          <span className="text-[10px] text-slate-400">Acesso liberado</span>
        </div>

        <div 
          onClick={() => setFilterStatus('suspended')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            filterStatus === 'suspended' 
              ? 'bg-slate-100 border-slate-400 ring-2 ring-slate-500/20' 
              : 'bg-white border-slate-200/70 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-slate-700 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Suspensos</span>
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="text-2xl font-black text-slate-900">{countSuspended}</div>
          <span className="text-[10px] text-slate-400">Acesso bloqueado</span>
        </div>

        <div 
          onClick={() => setFilterStatus('rejected')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            filterStatus === 'rejected' 
              ? 'bg-rose-50/80 border-rose-300 ring-2 ring-rose-500/20' 
              : 'bg-white border-slate-200/70 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-rose-700 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Rejeitados</span>
            <XCircle className="w-4 h-4" />
          </div>
          <div className="text-2xl font-black text-slate-900">{countRejected}</div>
          <span className="text-[10px] text-slate-400">Não autorizados</span>
        </div>
      </div>

      {/* Filters & Search Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
        {/* Search */}
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por Empresa, CNPJ, Responsável ou E-mail..."
            className="w-full pl-9 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          <button
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              filterStatus === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Todos ({customers.length})
          </button>
          <button
            onClick={() => setFilterStatus('pending')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              filterStatus === 'pending'
                ? 'bg-amber-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Pendentes ({countPending})
          </button>
          <button
            onClick={() => setFilterStatus('approved')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              filterStatus === 'approved'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Aprovados ({countApproved})
          </button>
          <button
            onClick={() => setFilterStatus('suspended')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              filterStatus === 'suspended'
                ? 'bg-slate-700 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Suspensos ({countSuspended})
          </button>
          <button
            onClick={() => setFilterStatus('rejected')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              filterStatus === 'rejected'
                ? 'bg-rose-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Rejeitados ({countRejected})
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
            <p className="text-sm font-medium">Carregando solicitações atacadistas do Supabase...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-600 space-y-2">
            <AlertCircle className="w-8 h-8 mx-auto" />
            <p className="text-sm font-bold">Falha ao consultar clientes atacadistas</p>
            <p className="text-xs text-rose-500 max-w-md mx-auto">{error}</p>
          </div>
        ) : filteredCustomers.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <Building2 className="w-12 h-12 mx-auto text-slate-300" />
            <p className="text-sm font-bold text-slate-700">Nenhum cliente atacadista encontrado</p>
            <p className="text-xs text-slate-400">
              {filterStatus !== 'all' || searchTerm 
                ? 'Tente ajustar os filtros ou termo de busca.' 
                : 'Quando novas empresas solicitarem cadastro pelo catálogo, elas aparecerão aqui para aprovação.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 uppercase font-semibold text-[10px] tracking-wider">
                <tr>
                  <th className="py-3.5 px-4">Empresa / Razão Social</th>
                  <th className="py-3.5 px-4">CNPJ</th>
                  <th className="py-3.5 px-4">Responsável</th>
                  <th className="py-3.5 px-4">Contato</th>
                  <th className="py-3.5 px-4">Data Solicitação</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCustomers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900">{c.legalName}</div>
                      {c.tradeName && (
                        <div className="text-[11px] text-slate-500 font-normal">
                          {c.tradeName}
                        </div>
                      )}
                      {(c.city || c.state) && (
                        <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3" />
                          {[c.city, c.state].filter(Boolean).join(' - ')}
                        </div>
                      )}
                    </td>

                    <td className="py-3.5 px-4 font-mono font-medium text-slate-700">
                      {formatCnpj(c.cnpj)}
                    </td>

                    <td className="py-3.5 px-4 text-slate-800 font-medium">
                      {c.contactName}
                    </td>

                    <td className="py-3.5 px-4 space-y-0.5">
                      <div className="flex items-center gap-1 text-slate-600">
                        <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate max-w-[160px]">{c.email}</span>
                      </div>
                      <div className="flex items-center gap-1 text-slate-600 font-mono text-[11px]">
                        <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                        <span>{c.phone}</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                      {new Date(c.createdAt).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                      })}
                    </td>

                    <td className="py-3.5 px-4">
                      {renderStatusBadge(c.status)}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => {
                          setSelectedCustomer(c);
                          setActionError(null);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de Detalhes da Solicitação B2B */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div 
            className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-100 relative overflow-hidden max-h-[92vh] flex flex-col"
            id="wholesale-customer-detail-modal"
          >
            <button
              onClick={() => setSelectedCustomer(null)}
              className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header */}
            <div className="flex items-center gap-3 mb-5 shrink-0">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                <Building2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">
                  Detalhes do Cliente Atacadista
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                  {renderStatusBadge(selectedCustomer.status)}
                  <span className="text-xs text-slate-400 font-mono">
                    ID: {selectedCustomer.id.slice(0, 8)}...
                  </span>
                </div>
              </div>
            </div>

            {/* Action Feedback */}
            {actionError && (
              <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2 shrink-0">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{actionError}</span>
              </div>
            )}

            {/* Content Details */}
            <div className="space-y-4 overflow-y-auto pr-1 text-xs">
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                    Razão Social
                  </span>
                  <div className="font-bold text-slate-900 text-sm">
                    {selectedCustomer.legalName}
                  </div>
                </div>

                {selectedCustomer.tradeName && (
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                      Nome Fantasia
                    </span>
                    <div className="font-medium text-slate-700">
                      {selectedCustomer.tradeName}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-200/60">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                      CNPJ
                    </span>
                    <div className="font-mono font-bold text-slate-900">
                      {formatCnpj(selectedCustomer.cnpj)}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                      Localização
                    </span>
                    <div className="text-slate-800">
                      {[selectedCustomer.city, selectedCustomer.state].filter(Boolean).join(' - ') || 'Não informada'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Contato do Comprador */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Responsável pelo Acesso
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] text-slate-400 block">Nome</span>
                    <span className="font-bold text-slate-900">{selectedCustomer.contactName}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Telefone/WhatsApp</span>
                    <span className="font-mono text-slate-800">{selectedCustomer.phone}</span>
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">E-mail Comercial (Login)</span>
                  <span className="font-mono text-slate-800 break-all">{selectedCustomer.email}</span>
                </div>
              </div>

              {/* Metadados */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span>Data da Solicitação:</span>
                <span className="font-medium text-slate-700">
                  {new Date(selectedCustomer.createdAt).toLocaleString('pt-BR')}
                </span>
              </div>
            </div>

            {/* Action Buttons conforme o estado */}
            <div className="pt-5 border-t border-slate-100 mt-4 space-y-2 shrink-0">
              {selectedCustomer.status === 'pending' && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleAction('approve')}
                    disabled={actionProcessing}
                    className="py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {actionProcessing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <UserCheck className="w-4 h-4" />
                    )}
                    Aprovar Empresa
                  </button>

                  <button
                    onClick={() => handleAction('reject')}
                    disabled={actionProcessing}
                    className="py-3 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <UserX className="w-4 h-4" />
                    Rejeitar Solicitação
                  </button>
                </div>
              )}

              {selectedCustomer.status === 'approved' && (
                <button
                  onClick={() => handleAction('suspend')}
                  disabled={actionProcessing}
                  className="w-full py-3 px-4 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <AlertTriangle className="w-4 h-4" />
                  Suspender Acesso Atacadista
                </button>
              )}

              {selectedCustomer.status === 'suspended' && (
                <button
                  onClick={() => handleAction('reactivate')}
                  disabled={actionProcessing}
                  className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <UserCheck className="w-4 h-4" />
                  Reativar Acesso Atacadista
                </button>
              )}

              {selectedCustomer.status === 'rejected' && (
                <button
                  onClick={() => handleAction('approve')}
                  disabled={actionProcessing}
                  className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <UserCheck className="w-4 h-4" />
                  Reavaliar e Aprovar Empresa
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
