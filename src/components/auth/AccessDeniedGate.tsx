import React from 'react';
import { ShieldAlert, Lock, ArrowLeft, LogIn, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useApp, AppViewMode } from '../../context/AppContext';

interface AccessDeniedGateProps {
  requiredRole: 'platform_admin' | 'tenant_admin';
  tenantName?: string;
}

export const AccessDeniedGate: React.FC<AccessDeniedGateProps> = ({ requiredRole, tenantName }) => {
  const { session, user, openLoginModal, signOut } = useAuth();
  const { setViewMode } = useApp();

  const isMaster = requiredRole === 'platform_admin';

  return (
    <div className="max-w-2xl mx-auto px-4 py-16 sm:py-24 text-center">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 sm:p-12 shadow-2xl space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto shadow-inner">
          {session ? <ShieldAlert className="w-8 h-8" /> : <Lock className="w-8 h-8" />}
        </div>

        <div className="space-y-2">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white font-['Outfit']">
            {isMaster ? 'Painel Master Protegido' : 'Painel da Loja Protegido'}
          </h2>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            {!session ? (
              isMaster 
                ? 'Este ambiente requer autenticação com conta de Administrador Global da Plataforma (Platform Admin).'
                : `Este ambiente requer autenticação com privilégios de Administrador da loja ${tenantName || 'ativa'}.`
            ) : (
              isMaster
                ? `A conta ${user?.email} está autenticada, mas não possui privilégios em public.platform_admins.`
                : `A conta ${user?.email} está autenticada, mas não é administradora (tenant_admin) da loja ${tenantName || 'selecionada'}.`
            )}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
          {!session ? (
            <button
              onClick={() => openLoginModal(isMaster ? 'superadmin' : 'tenant_admin')}
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs transition-all shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>Entrar com Credenciais</span>
            </button>
          ) : (
            <button
              onClick={signOut}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Trocar de Conta (Sair)</span>
            </button>
          )}

          <button
            onClick={() => setViewMode('storefront')}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 font-medium text-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Voltar ao Catálogo Público</span>
          </button>
        </div>
      </div>
    </div>
  );
};
