import React, { useState } from 'react';
import { 
  Users, 
  UserPlus, 
  ShieldCheck, 
  Copy, 
  Check, 
  Key, 
  Lock, 
  Percent, 
  Link as LinkIcon, 
  Share2, 
  Edit3, 
  Trash2, 
  UserCheck,
  CheckCircle2,
  XCircle,
  Eye,
  Sliders
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { TenantUser, UserRole } from '../../types';

export const TeamAccessManager: React.FC = () => {
  const { 
    currentTenant, 
    currentTenantUsers, 
    addUser, 
    updateUser, 
    deleteUser, 
    showToast 
  } = useApp();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'sales_rep' as UserRole,
    sellerCode: '',
    commissionRate: 5,
    permissions: {
      canEditProducts: false,
      canViewCostPrice: false,
      canManageOrders: true,
      canAccessSettings: false,
      canManageTeam: false,
      canExportData: false
    }
  });

  const handleRoleChange = (role: UserRole) => {
    let perms = {
      canEditProducts: false,
      canViewCostPrice: false,
      canManageOrders: false,
      canAccessSettings: false,
      canManageTeam: false,
      canExportData: false
    };

    if (role === 'tenant_admin') {
      perms = {
        canEditProducts: true,
        canViewCostPrice: true,
        canManageOrders: true,
        canAccessSettings: true,
        canManageTeam: true,
        canExportData: true
      };
    } else if (role === 'sales_rep') {
      perms = {
        canEditProducts: false,
        canViewCostPrice: false,
        canManageOrders: true,
        canAccessSettings: false,
        canManageTeam: false,
        canExportData: false
      };
    } else if (role === 'stock_manager') {
      perms = {
        canEditProducts: true,
        canViewCostPrice: false,
        canManageOrders: true,
        canAccessSettings: false,
        canManageTeam: false,
        canExportData: false
      };
    }

    setFormData(prev => ({
      ...prev,
      role,
      permissions: perms,
      sellerCode: role === 'sales_rep' ? (prev.sellerCode || prev.name.slice(0, 4).toUpperCase() + '10') : ''
    }));
  };

  const handleSaveUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.email.trim()) {
      showToast('Nome e e-mail são obrigatórios');
      return;
    }

    addUser({
      tenantId: currentTenant.id,
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      role: formData.role,
      sellerCode: formData.role === 'sales_rep' ? formData.sellerCode : undefined,
      commissionRate: formData.role === 'sales_rep' ? Number(formData.commissionRate) : undefined,
      permissions: formData.permissions,
      status: 'active'
    });

    setIsAddModalOpen(false);
  };

  const copySellerLink = (code: string) => {
    const link = `https://${currentTenant.customization.customDomain || `app.com/${currentTenant.slug}`}?rep=${code}`;
    navigator.clipboard.writeText(link);
    setCopiedCode(code);
    showToast(`Link de vendas copiado: ${link}`);
    setTimeout(() => setCopiedCode(null), 3000);
  };

  return (
    <div className="space-y-6">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-['Outfit'] flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            Controle de Acesso, Equipe & Vendedores
          </h2>
          <p className="text-xs text-slate-500">
            Defina quem tem permissão para editar preços, ver relatórios ou criar links exclusivos de vendas com comissão
          </p>
        </div>

        <button
          onClick={() => {
            setFormData({
              name: '',
              email: '',
              phone: '',
              role: 'sales_rep',
              sellerCode: 'REP' + Math.floor(10 + Math.random() * 90),
              commissionRate: 5,
              permissions: {
                canEditProducts: false,
                canViewCostPrice: false,
                canManageOrders: true,
                canAccessSettings: false,
                canManageTeam: false,
                canExportData: false
              }
            });
            setIsAddModalOpen(true);
          }}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 shadow-md shadow-blue-600/20 cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          Convidar Usuário / Vendedor
        </button>
      </div>

      {/* Role Explanations Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-900 mb-1">
            <ShieldCheck className="w-4 h-4 text-blue-600" />
            Administrador da Loja
          </div>
          <p className="text-[11px] text-slate-500">
            Acesso total: gerencia equipe, configurações financeiras, margens de custo, identidade visual e exportações.
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-900 mb-1">
            <Share2 className="w-4 h-4 text-indigo-600" />
            Vendedor / Representante Comercial
          </div>
          <p className="text-[11px] text-slate-500">
            Possui link de catálogo rastreável próprio. Todos os pedidos gerados via seu link gravam seu código e calculam sua comissão.
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-900 mb-1">
            <Sliders className="w-4 h-4 text-emerald-600" />
            Operador de Estoque / Expedição
          </div>
          <p className="text-[11px] text-slate-500">
            Pode atualizar quantidade de produtos em estoque e mudar status de separação de pedidos. Não vê preços de custo nem altera dados da empresa.
          </p>
        </div>

      </div>

      {/* Users Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 bg-slate-50/50 border-b border-slate-100 font-bold text-xs text-slate-800">
          Membros da Equipe em {currentTenant.name} ({currentTenantUsers.length})
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-3.5 px-4 sm:px-6">Nome / E-mail</th>
                <th className="py-3.5 px-4">Função (Role)</th>
                <th className="py-3.5 px-4">Link de Vendedor / Código</th>
                <th className="py-3.5 px-4">Permissões Específicas</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {currentTenantUsers.map(user => (
                <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3.5 px-4 sm:px-6">
                    <div className="font-bold text-slate-900 text-xs">{user.name}</div>
                    <div className="text-[11px] text-slate-400">{user.email}</div>
                    {user.phone && <div className="text-[10px] text-slate-500 font-mono">{user.phone}</div>}
                  </td>

                  <td className="py-3.5 px-4">
                    <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold ${
                      user.role === 'tenant_admin'
                        ? 'bg-blue-100 text-blue-800'
                        : user.role === 'sales_rep'
                        ? 'bg-indigo-100 text-indigo-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}>
                      {user.role === 'tenant_admin' ? 'Administrador' : user.role === 'sales_rep' ? 'Representante / Vendedor' : 'Estoquista'}
                    </span>
                  </td>

                  <td className="py-3.5 px-4">
                    {user.role === 'sales_rep' && user.sellerCode ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-indigo-700">
                          <span>{user.sellerCode}</span>
                          <span className="text-[10px] text-slate-400 font-normal">({user.commissionRate}% comissão)</span>
                        </div>
                        <button
                          onClick={() => copySellerLink(user.sellerCode!)}
                          className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                        >
                          {copiedCode === user.sellerCode ? (
                            <><Check className="w-3 h-3 text-emerald-600" /> Copiado!</>
                          ) : (
                            <><Copy className="w-3 h-3" /> Copiar Link do Vendedor</>
                          )}
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-400 text-[11px]">—</span>
                    )}
                  </td>

                  <td className="py-3.5 px-4">
                    <div className="flex flex-wrap gap-1 max-w-xs">
                      {user.permissions.canEditProducts && (
                        <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[9px] font-medium">Produtos</span>
                      )}
                      {user.permissions.canViewCostPrice && (
                        <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-[9px] font-medium">Ver Custo</span>
                      )}
                      {user.permissions.canManageOrders && (
                        <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded text-[9px] font-medium">Gerenciar Pedidos</span>
                      )}
                      {user.permissions.canManageTeam && (
                        <span className="bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded text-[9px] font-medium">Gerenciar Equipe</span>
                      )}
                    </div>
                  </td>

                  <td className="py-3.5 px-4">
                    <span className="inline-flex items-center gap-1 text-emerald-600 text-[11px] font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Ativo
                    </span>
                  </td>

                  <td className="py-3.5 px-4 text-right">
                    {currentTenantUsers.length > 1 && user.role !== 'tenant_admin' && (
                      <button
                        onClick={() => {
                          if (confirm(`Remover acesso de ${user.name}?`)) {
                            deleteUser(user.id);
                          }
                        }}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                        title="Remover Acesso"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add User Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200">
            
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 font-['Outfit']">Adicionar Novo Membro</h3>
                  <p className="text-xs text-slate-500">Configure o nível de acesso e código de comissão</p>
                </div>
              </div>
              <button 
                onClick={() => setIsAddModalOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-slate-200 text-slate-500 flex items-center justify-center"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ex: Roberto Silva"
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    E-mail de Login *
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                    placeholder="usuario@loja.com.br"
                    className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    WhatsApp / Telefone
                  </label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="11999998888"
                    className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Cargo / Nível de Acesso
                </label>
                <select
                  value={formData.role}
                  onChange={e => handleRoleChange(e.target.value as UserRole)}
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium text-slate-900 cursor-pointer"
                >
                  <option value="sales_rep">Vendedor / Representante Comercial (Link com Comissão)</option>
                  <option value="stock_manager">Operador de Estoque / Expedição</option>
                  <option value="tenant_admin">Administrador Geral da Loja</option>
                </select>
              </div>

              {formData.role === 'sales_rep' && (
                <div className="p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-3">
                  <div className="text-xs font-bold text-indigo-900">Configurações de Representação Comercial</div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Código do Vendedor</label>
                      <input
                        type="text"
                        value={formData.sellerCode}
                        onChange={e => setFormData({ ...formData, sellerCode: e.target.value.toUpperCase() })}
                        placeholder="CARLOS10"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-mono font-bold uppercase text-indigo-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Comissão (%)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={formData.commissionRate}
                        onChange={e => setFormData({ ...formData, commissionRate: Number(e.target.value) })}
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
                >
                  Salvar Usuário
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

    </div>
  );
};
