import React, { useState } from 'react';
import { 
  X, 
  Save, 
  Loader2, 
  AlertCircle, 
  Layers, 
  CheckSquare,
  Tag,
  ToggleLeft
} from 'lucide-react';
import { bulkUpdateAdminProducts, AdminProductUpdatePayload } from '../../services/adminCatalogService';

interface ProductBulkEditModalProps {
  selectedProductIds: string[];
  tenantId: string;
  categories: string[];
  onClose: () => void;
  onSuccess: () => void;
}

export const ProductBulkEditModal: React.FC<ProductBulkEditModalProps> = ({
  selectedProductIds,
  tenantId,
  categories,
  onClose,
  onSuccess,
}) => {
  // Category choice
  const [changeCategory, setChangeCategory] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(categories[0] || 'Geral');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isCustomCategory, setIsCustomCategory] = useState(false);

  // Status choice
  const [statusAction, setStatusAction] = useState<'keep' | 'activate' | 'deactivate'>('keep');

  // Wholesale choice
  const [wholesaleAction, setWholesaleAction] = useState<'keep' | 'enable' | 'disable'>('keep');
  const [defaultWholesaleMinQty, setDefaultWholesaleMinQty] = useState<string>('1');

  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const updates: AdminProductUpdatePayload = {};
    let hasAnyUpdate = false;

    if (changeCategory) {
      const cat = isCustomCategory ? newCategoryName.trim() : selectedCategory;
      if (!cat) {
        setErrorMessage('Informe um nome válido para a categoria.');
        return;
      }
      updates.category = cat;
      hasAnyUpdate = true;
    }

    if (statusAction === 'activate') {
      updates.active = true;
      hasAnyUpdate = true;
    } else if (statusAction === 'deactivate') {
      updates.active = false;
      hasAnyUpdate = true;
    }

    if (wholesaleAction === 'enable') {
      const minQty = parseInt(defaultWholesaleMinQty, 10);
      if (isNaN(minQty) || minQty < 1) {
        setErrorMessage('Informe uma quantidade mínima de atacado válida (>= 1).');
        return;
      }
      updates.wholesaleEnabled = true;
      updates.wholesaleMinQuantity = minQty;
      hasAnyUpdate = true;
    } else if (wholesaleAction === 'disable') {
      updates.wholesaleEnabled = false;
      updates.wholesaleMinQuantity = null;
      hasAnyUpdate = true;
    }

    if (!hasAnyUpdate) {
      setErrorMessage('Selecione pelo menos um campo para alterar em massa.');
      return;
    }

    setSaving(true);
    try {
      await bulkUpdateAdminProducts(tenantId, selectedProductIds, updates);
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao atualizar produtos em massa.';
      console.error('[ProductBulkEditModal] Erro:', err);
      setErrorMessage(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div 
        className="fixed inset-0" 
        onClick={saving ? undefined : onClose} 
        aria-hidden="true" 
      />

      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl p-6 sm:p-7 z-10 border border-slate-100">
        
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700">
              <CheckSquare className="w-3 h-3" />
              {selectedProductIds.length} produto(s) selecionado(s)
            </div>
            <h3 className="text-lg font-bold text-slate-900 mt-1.5 font-['Outfit']">
              Edição em Massa
            </h3>
            <p className="text-xs text-slate-500">
              As alterações selecionadas serão aplicadas a todos os itens marcados.
            </p>
          </div>

          <button
            onClick={onClose}
            disabled={saving}
            className="p-1 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mt-4 p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <strong>Erro:</strong> {errorMessage}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4 text-xs">
          
          {/* Alterar Categoria */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="font-bold text-slate-800 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-blue-600" />
                Alterar Categoria
              </span>
              <input
                type="checkbox"
                checked={changeCategory}
                onChange={(e) => setChangeCategory(e.target.checked)}
                disabled={saving}
                className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
              />
            </label>

            {changeCategory && (
              <div className="pt-2 border-t border-slate-200/60">
                {!isCustomCategory ? (
                  <div className="flex gap-2">
                    <select
                      value={selectedCategory}
                      onChange={(e) => {
                        if (e.target.value === '__new__') {
                          setIsCustomCategory(true);
                        } else {
                          setSelectedCategory(e.target.value);
                        }
                      }}
                      disabled={saving}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer"
                    >
                      {categories.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                      <option value="__new__">+ Digitar nova categoria...</option>
                    </select>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Nome da nova categoria"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      disabled={saving}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setIsCustomCategory(false)}
                      className="px-2 text-slate-500 hover:text-slate-700 font-medium"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Alterar Status */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
            <span className="font-bold text-slate-800 flex items-center gap-1.5">
              <ToggleLeft className="w-3.5 h-3.5 text-blue-600" />
              Status de Publicação
            </span>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => setStatusAction('keep')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  statusAction === 'keep'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                Manter atual
              </button>
              <button
                type="button"
                onClick={() => setStatusAction('activate')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  statusAction === 'activate'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                Ativar todos
              </button>
              <button
                type="button"
                onClick={() => setStatusAction('deactivate')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  statusAction === 'deactivate'
                    ? 'bg-slate-600 text-white shadow-xs'
                    : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                Pausar / Desativar
              </button>
            </div>
          </div>

          {/* Participação no Atacado */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
            <span className="font-bold text-slate-800 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-blue-600" />
              Participação no Atacado
            </span>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => setWholesaleAction('keep')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  wholesaleAction === 'keep'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                Manter atual
              </button>
              <button
                type="button"
                onClick={() => setWholesaleAction('enable')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  wholesaleAction === 'enable'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                Habilitar Atacado
              </button>
              <button
                type="button"
                onClick={() => setWholesaleAction('disable')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  wholesaleAction === 'disable'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                Desabilitar Atacado
              </button>
            </div>

            {wholesaleAction === 'enable' && (
              <div className="pt-2">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Quantidade mínima de atacado padrão para os itens selecionados:
                </label>
                <input
                  type="number"
                  min="1"
                  value={defaultWholesaleMinQty}
                  onChange={(e) => setDefaultWholesaleMinQty(e.target.value)}
                  className="w-32 px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm hover:shadow-md transition-all cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Aplicando alterações...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Aplicar aos {selectedProductIds.length} produtos
                </>
              )}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
