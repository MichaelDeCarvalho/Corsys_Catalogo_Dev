import React from 'react';
import { Lock, Building2, UserCheck, ArrowRight, X, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useWholesaleAccess } from '../../context/WholesaleAccessContext';

export const B2BGateModal: React.FC = () => {
  const { openLoginModal } = useAuth();
  const { 
    isB2BGateModalOpen, 
    closeB2BGateModal, 
    openB2BRegisterModal,
    wholesaleStatus 
  } = useWholesaleAccess();

  if (!isB2BGateModalOpen) return null;

  const handleAlreadyHaveAccess = () => {
    closeB2BGateModal();
    openLoginModal('storefront');
  };

  const handleRequestRegistration = () => {
    openB2BRegisterModal();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div 
        className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl border border-slate-100 relative overflow-hidden"
        id="b2b-gate-modal"
      >
        {/* Close Button */}
        <button
          onClick={closeB2BGateModal}
          className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          id="btn-close-b2b-gate"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Icon */}
        <div className="flex items-center justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shadow-inner">
            <Lock className="w-8 h-8" />
          </div>
        </div>

        {/* Text */}
        <div className="text-center space-y-2 mb-8">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">
            <Building2 className="w-3.5 h-3.5" />
            Portal Atacadista B2B
          </div>
          <h3 className="text-2xl font-black text-slate-900 tracking-tight">
            Comprar no Atacado
          </h3>
          <p className="text-slate-600 text-sm leading-relaxed max-w-sm mx-auto">
            Preços e condições comerciais exclusivas para empresas cadastradas e aprovadas pela nossa equipe.
          </p>
        </div>

        {/* Details list */}
        <div className="bg-slate-50 rounded-2xl p-4 mb-6 border border-slate-100 space-y-2.5 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Exclusivo para portadores de CNPJ ativo</span>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Pedido mínimo de atacado definido pela loja</span>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Tabelas de preços e quantidades mínimas por SKU</span>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={handleAlreadyHaveAccess}
            className="w-full py-3.5 px-4 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-all flex items-center justify-center gap-2 shadow-sm"
            id="btn-b2b-already-have-access"
          >
            <UserCheck className="w-4 h-4" />
            Já tenho acesso
          </button>

          <button
            onClick={handleRequestRegistration}
            className="w-full py-3.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-sm transition-all flex items-center justify-center gap-2 shadow-sm"
            id="btn-b2b-request-registration"
          >
            <Building2 className="w-4 h-4" />
            Solicitar cadastro atacadista
            <ArrowRight className="w-4 h-4 ml-1" />
          </button>
        </div>
      </div>
    </div>
  );
};
