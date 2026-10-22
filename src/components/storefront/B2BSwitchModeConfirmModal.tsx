import React from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { useWholesaleAccess } from '../../context/WholesaleAccessContext';

export const B2BSwitchModeConfirmModal: React.FC = () => {
  const { 
    isSwitchModeDialogOpen, 
    targetPendingMode, 
    confirmSwitchPurchaseMode, 
    cancelSwitchPurchaseMode 
  } = useWholesaleAccess();

  if (!isSwitchModeDialogOpen || !targetPendingMode) return null;

  const isSwitchingToWholesale = targetPendingMode === 'wholesale';
  const targetName = isSwitchingToWholesale ? 'Atacado' : 'Varejo';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div 
        className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl border border-slate-100 relative overflow-hidden"
        id="b2b-switch-mode-modal"
      >
        <button
          onClick={cancelSwitchPurchaseMode}
          className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          title="Fechar"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center justify-center mb-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7" />
          </div>
        </div>

        <div className="text-center space-y-2 mb-6">
          <h3 className="text-xl font-black text-slate-900 tracking-tight">
            Alternar para {targetName}?
          </h3>
          <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
            Para evitar mistura de preços e regras comerciais entre Varejo e Atacado, o carrinho será esvaziado ao trocar de modalidade.
          </p>
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={confirmSwitchPurchaseMode}
            className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs sm:text-sm transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
            id="btn-confirm-clear-and-switch"
          >
            <Trash2 className="w-4 h-4 text-slate-950" />
            <span>Limpar carrinho e mudar para {targetName}</span>
          </button>

          <button
            type="button"
            onClick={cancelSwitchPurchaseMode}
            className="w-full py-2.5 px-4 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 font-bold text-xs transition-colors cursor-pointer"
            id="btn-cancel-switch"
          >
            <span>Cancelar</span>
          </button>
        </div>
      </div>
    </div>
  );
};
