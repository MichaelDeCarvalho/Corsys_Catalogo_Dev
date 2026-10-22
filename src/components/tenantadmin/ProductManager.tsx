import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Search, 
  Eye, 
  Star, 
  Package, 
  Download, 
  X, 
  AlertCircle, 
  RefreshCw, 
  Loader2, 
  Info, 
  Layers, 
  Tag, 
  DollarSign, 
  UploadCloud, 
  Check,
  Edit3,
  Trash2,
  SlidersHorizontal,
  CheckSquare
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { Product } from '../../types';
import { 
  fetchAdminProducts, 
  isValidUuid, 
  bulkUpdateAdminProducts, 
  bulkSoftDeleteAdminProducts 
} from '../../services/adminCatalogService';
import { fetchTenantPublicSettings } from '../../services/catalogService';
import { getSafeProductImage, handleProductImageError } from '../../utils/productImages';
import { ProductEditModal } from './ProductEditModal';
import { ProductBulkEditModal } from './ProductBulkEditModal';
import { ProductBulkImageImportModal } from './ProductBulkImageImportModal';

export interface ProductManagerProps {
  products?: Product[];
  tenantId?: string | null;
  loading?: boolean;
  error?: string | null;
  onReload?: () => void;
}

export const ITEMS_PER_PAGE = 40;

export const ProductManager: React.FC<ProductManagerProps> = ({
  products: propProducts,
  tenantId: propTenantId,
  loading: propLoading,
  error: propError,
  onReload: propOnReload,
}) => {
  const { currentTenant, showToast } = useApp();
  const { authTenant, authTenantId, isPlatformAdmin } = useAuth();

  // Estado interno caso não seja fornecido via props
  const [internalProducts, setInternalProducts] = useState<Product[]>([]);
  const [internalLoading, setInternalLoading] = useState<boolean>(true);
  const [internalError, setInternalError] = useState<string | null>(null);
  const [activeTenantId, setActiveTenantId] = useState<string>('');

  // Resolução fail-closed do Tenant UUID administrativo real para escritas no Supabase:
  // 1. propTenantId (se for UUID válido)
  // 2. activeTenantId (se for UUID válido, caso os produtos sejam carregados internamente)
  // 3. null (FAIL CLOSED: bloqueia edições caso o UUID não seja resolvido)
  // NUNCA aceita currentTenant.id, "tenant-mc-distribuicao", slug, localStorage ou IDs mock.
  const effectiveTenantId = useMemo<string | null>(() => {
    if (propTenantId && isValidUuid(propTenantId)) {
      return propTenantId;
    }
    if (activeTenantId && isValidUuid(activeTenantId)) {
      return activeTenantId;
    }
    return null;
  }, [propTenantId, activeTenantId]);

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

  const loadInternalProducts = useCallback(async () => {
    setInternalLoading(true);
    setInternalError(null);
    try {
      const resolvedTenantId = await resolveTargetTenantId();
      setActiveTenantId(resolvedTenantId);
      const data = await fetchAdminProducts(resolvedTenantId);
      setInternalProducts(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao carregar catálogo administrativo do Supabase.';
      console.error('[ProductManager] Erro ao carregar produtos:', err);
      setInternalError(msg);
      setInternalProducts([]);
    } finally {
      setInternalLoading(false);
    }
  }, [resolveTargetTenantId]);

  useEffect(() => {
    if (propProducts === undefined) {
      loadInternalProducts();
    }
  }, [propProducts, loadInternalProducts]);

  // Decisão entre props ou estado interno
  const products = propProducts !== undefined ? propProducts : internalProducts;
  const loading = propLoading !== undefined ? propLoading : internalLoading;
  const error = propError !== undefined ? propError : internalError;
  const handleReload = propOnReload || loadInternalProducts;

  // Estados locais de UI
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [activeTab, setActiveTab] = useState<'list' | 'bulk_images'>('list');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Estados de Seleção e Edição Real
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState<boolean>(false);
  const [isBulkImageImportOpen, setIsBulkImageImportOpen] = useState<boolean>(false);
  const [isBulkProcessing, setIsBulkProcessing] = useState<boolean>(false);

  // Categorias únicas derivadas dinamicamente dos produtos reais do Supabase (memoizadas)
  const categories = useMemo(() => {
    return Array.from(new Set(products.map(p => p.category))).filter(Boolean).sort();
  }, [products]);

  // Contagem por categoria calculada em passagem única (evita products.filter por opção)
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of products) {
      if (p.category) {
        counts[p.category] = (counts[p.category] || 0) + 1;
      }
    }
    return counts;
  }, [products]);

  // Filtragem estrita dos produtos (memoizada)
  const filteredProducts = useMemo(() => {
    const searchLower = searchTerm.toLowerCase().trim();
    return products.filter(p => {
      const matchesSearch = 
        !searchLower ||
        p.name.toLowerCase().includes(searchLower) ||
        p.sku.toLowerCase().includes(searchLower) ||
        (p.brand && p.brand.toLowerCase().includes(searchLower)) ||
        p.category.toLowerCase().includes(searchLower);
      const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [products, searchTerm, categoryFilter]);

  // Total de páginas derivado dos produtos filtrados
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / ITEMS_PER_PAGE));

  // Reset da página atual ao alterar busca ou categoria
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, categoryFilter]);

  // Ajuste defensivo se totalPages diminuir
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // Produtos paginados da página ativa (máximo 40 linhas)
  const paginatedProducts = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredProducts.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredProducts, currentPage]);

  // Funções de Seleção de Produtos (operam sobre paginatedProducts para visíveis)
  const toggleSelect = (id: string) => {
    setSelectedProductIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const isAllVisibleSelected = 
    paginatedProducts.length > 0 && 
    paginatedProducts.every(p => selectedProductIds.includes(p.id));

  const isSomeVisibleSelected = 
    paginatedProducts.some(p => selectedProductIds.includes(p.id)) && !isAllVisibleSelected;

  const toggleSelectAllVisible = () => {
    if (isAllVisibleSelected) {
      const visibleIds = new Set(paginatedProducts.map(p => p.id));
      setSelectedProductIds(prev => prev.filter(id => !visibleIds.has(id)));
    } else {
      const newIds = new Set([...selectedProductIds, ...paginatedProducts.map(p => p.id)]);
      setSelectedProductIds(Array.from(newIds));
    }
  };

  // Abertura Segura de Edição Individual (Fail-Closed)
  const handleOpenEdit = (prod: Product) => {
    if (!effectiveTenantId || !isValidUuid(effectiveTenantId)) {
      showToast('Contexto de tenant inválido. A edição foi bloqueada por segurança.');
      return;
    }
    if (!prod.tenantId || !isValidUuid(prod.tenantId)) {
      showToast('Contexto de tenant inválido. A edição foi bloqueada por segurança.');
      return;
    }
    if (prod.tenantId !== effectiveTenantId) {
      showToast('Contexto de tenant inválido. A edição foi bloqueada por segurança.');
      return;
    }
    setEditingProduct(prod);
  };

  // Abertura Segura de Edição em Massa (Fail-Closed)
  const handleOpenBulkEdit = () => {
    if (!effectiveTenantId || !isValidUuid(effectiveTenantId)) {
      showToast('Contexto de tenant inválido. A edição em massa foi bloqueada por segurança.');
      return;
    }

    if (selectedProductIds.length === 0) {
      return;
    }

    const productMap = new Map<string, Product>(products.map(p => [p.id, p]));
    const hasInvalidSelection = selectedProductIds.some(id => {
      const product = productMap.get(id);
      return (
        !product ||
        !product.tenantId ||
        !isValidUuid(product.tenantId) ||
        product.tenantId !== effectiveTenantId
      );
    });

    if (hasInvalidSelection) {
      showToast('Seleção inválida ou contendo produtos de outro tenant. A edição em massa foi bloqueada por segurança.');
      return;
    }

    setIsBulkEditOpen(true);
  };

  // Abertura Segura de Importação em Massa de Imagens (Fail-Closed)
  const handleOpenBulkImageImport = () => {
    if (!effectiveTenantId || !isValidUuid(effectiveTenantId)) {
      showToast('Contexto de tenant inválido. A importação em massa foi bloqueada por segurança.');
      return;
    }
    setIsBulkImageImportOpen(true);
  };

  // Funções de Ações em Massa
  const handleBulkStatusChange = async (active: boolean) => {
    if (selectedProductIds.length === 0) return;
    setIsBulkProcessing(true);
    try {
      const resolvedTenantId = (effectiveTenantId && isValidUuid(effectiveTenantId))
        ? effectiveTenantId
        : await resolveTargetTenantId();
      if (!isValidUuid(resolvedTenantId)) {
        throw new Error('Identificador de tenant inválido para atualização em massa.');
      }
      await bulkUpdateAdminProducts(resolvedTenantId, selectedProductIds, { active });
      showToast(`${selectedProductIds.length} produtos ${active ? 'ativados' : 'pausados'} com sucesso no Supabase!`);
      setSelectedProductIds([]);
      handleReload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao atualizar produtos em massa.';
      showToast(`Erro: ${msg}`);
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedProductIds.length === 0) return;
    const confirmed = window.confirm(`Deseja realmente desativar/excluir os ${selectedProductIds.length} produtos selecionados do catálogo?`);
    if (!confirmed) return;

    setIsBulkProcessing(true);
    try {
      const resolvedTenantId = (effectiveTenantId && isValidUuid(effectiveTenantId))
        ? effectiveTenantId
        : await resolveTargetTenantId();
      if (!isValidUuid(resolvedTenantId)) {
        throw new Error('Identificador de tenant inválido para exclusão em massa.');
      }
      await bulkSoftDeleteAdminProducts(resolvedTenantId, selectedProductIds);
      showToast(`${selectedProductIds.length} produtos desativados/excluídos com sucesso!`);
      setSelectedProductIds([]);
      handleReload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao excluir produtos em massa.';
      showToast(`Erro: ${msg}`);
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const handleIndividualEditSuccess = (updatedProduct: Product) => {
    setInternalProducts(prev => prev.map(p => p.id === updatedProduct.id ? updatedProduct : p));
    setEditingProduct(null);
    showToast(`Produto "${updatedProduct.name}" atualizado com sucesso no Supabase!`);
    handleReload();
  };

  const handleBulkEditSuccess = () => {
    setIsBulkEditOpen(false);
    setSelectedProductIds([]);
    showToast('Produtos atualizados com sucesso no Supabase!');
    handleReload();
  };

  const handleExportCSV = () => {
    if (products.length === 0) {
      showToast('Nenhum produto disponível para exportação.');
      return;
    }

    const headers = 'ID,Nome,SKU,Código de Barras,Categoria,Subcategoria,Marca,Preco_Custo,Preco_Varejo,Preco_Atacado,Estoque,Unidade,Ativo\n';
    const rows = products.map(p => 
      `"${p.id}","${p.name.replace(/"/g, '""')}","${p.sku}","${p.barcode || ''}","${p.category}","${p.subcategory || ''}","${(p.brand || '').replace(/"/g, '""')}",${p.costPrice ?? ''},${p.price},${p.wholesalePrice ?? ''},${p.stock},"${p.unit}",${p.active ? 'Sim' : 'Não'}`
    ).join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `catalogo_administrativo_${authTenant?.slug || currentTenant.slug}_${products.length}_itens.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Planilha com ${products.length} produtos exportada com sucesso!`);
  };

  return (
    <div className="space-y-6">
      
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-['Outfit'] flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-600" />
            Catálogo & Gestão de Estoque
          </h2>
          <p className="text-xs text-slate-500">
            Visualização administrativa oficial dos produtos registrados no Supabase ({authTenant?.name || currentTenant.name})
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenBulkImageImport}
            disabled={loading || products.length === 0}
            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-xs font-bold text-white flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Importar fotos em lote por SKU com manifest.json"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            Importar Fotos em Massa
          </button>

          <button
            onClick={handleExportCSV}
            disabled={loading || products.length === 0}
            className="px-3.5 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            title="Exportar catálogo em CSV/Excel"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar CSV ({products.length})
          </button>

          <button
            onClick={handleReload}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Recarregar dados do Supabase"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('list')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
            activeTab === 'list'
              ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Package className="w-4 h-4" />
          Produtos ({loading ? '...' : products.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('bulk_images')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
            activeTab === 'bulk_images'
              ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <UploadCloud className="w-4 h-4" />
          Importar Imagens
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
            activeTab === 'bulk_images' ? 'bg-blue-500 text-white' : 'bg-emerald-100 text-emerald-800'
          }`}>
            V1 Ativa
          </span>
        </button>
      </div>

      {/* Error Banner with Retry (Strict Fail-Closed - No Mock Fallback) */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-red-900">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold">Falha ao carregar catálogo administrativo do Supabase</h3>
                <p className="text-xs text-red-800 mt-1 leading-relaxed">
                  {error}
                </p>
                <p className="text-[11px] text-red-700 mt-2 font-medium">
                  Em conformidade com as diretrizes de integridade, nenhum catálogo simulado ou mock legado é exibido como fallback.
                </p>
              </div>
            </div>
            <button
              onClick={handleReload}
              className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-2 shrink-0 shadow-xs cursor-pointer transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Tentar Novamente
            </button>
          </div>
        </div>
      )}

      {activeTab === 'bulk_images' ? (
        /* Painel Arquitetural: Importação de Imagens em Massa */
        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 text-blue-950 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <UploadCloud className="w-6 h-6 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold">Importação em Massa por SKU (V1)</h3>
                <p className="text-xs text-blue-800 mt-1 leading-relaxed">
                  Selecione o arquivo <code className="font-mono bg-blue-100 px-1 py-0.5 rounded text-[11px]">manifest.json</code> e os arquivos de imagem para executar o dry-run com validação estrita antes do envio para o bucket <code className="font-mono bg-blue-100 px-1 py-0.5 rounded text-[11px]">product-media</code>.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleOpenBulkImageImport}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 shrink-0 shadow-sm shadow-blue-600/20 transition-all cursor-pointer"
            >
              <UploadCloud className="w-4 h-4" />
              Abrir Importador em Massa
            </button>
          </div>

          {/* Guidelines and SKU association specs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
              <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm">1</div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Associação Estrita por SKU</h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                As imagens devem ser nomeadas com o código SKU exato do produto (ex: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-[11px]">BR021.jpg</code> ou <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-[11px]">AL003.webp</code>).
              </p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-sm">2</div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Formatos e Otimização</h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                Formatos aceitos futuramente: JPG/JPEG, PNG e WebP. Resolução recomendada de 800x800px a 1200x1200px.
              </p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
              <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold text-sm">3</div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Supabase Storage V2</h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                Bucket dedicado <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-[11px]">product-images</code> com isolamento por tenant será provisionado em etapa posterior.
              </p>
            </div>
          </div>

          {/* Reference SKU table for batch preparation */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Referência de SKUs para Lote de Imagens ({products.length} itens no Supabase)</h4>
                <p className="text-xs text-slate-500">Utilize os códigos abaixo para preparar os arquivos de imagem com nomenclatura correspondente</p>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 sticky top-0 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-4">SKU</th>
                    <th className="py-2.5 px-4">Nome do Produto</th>
                    <th className="py-2.5 px-4">Categoria</th>
                    <th className="py-2.5 px-4">Nome Sugerido do Arquivo</th>
                    <th className="py-2.5 px-4 text-center">Status no Banco</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50/60">
                      <td className="py-2 px-4 font-mono font-bold text-blue-700">{p.sku}</td>
                      <td className="py-2 px-4 font-medium text-slate-800 line-clamp-1">{p.name}</td>
                      <td className="py-2 px-4 text-slate-500">{p.category}</td>
                      <td className="py-2 px-4 font-mono text-[11px] text-slate-600">{p.sku.toLowerCase()}.[jpg|png|webp]</td>
                      <td className="py-2 px-4 text-center">
                        <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium">
                          images = [] (Aguardando Storage V2)
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Filter and Search Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#475569] pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar por nome, SKU, marca, categoria..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{ color: '#0F172A', backgroundColor: '#FFFFFF' }}
                className="w-full pl-9 pr-9 py-2 rounded-xl border border-[#E2E8F0] text-xs font-medium text-[#0F172A] placeholder-[#475569] bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  title="Limpar busca"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium">Categoria:</span>
                <select
                  value={categoryFilter}
                  onChange={e => setCategoryFilter(e.target.value)}
                  className="text-xs px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 focus:outline-none font-medium cursor-pointer"
                >
                  <option value="all">Todas as categorias ({products.length})</option>
                  {categories.map(cat => {
                    const catCount = categoryCounts[cat] || 0;
                    return (
                      <option key={cat} value={cat}>{cat} ({catCount})</option>
                    );
                  })}
                </select>
              </div>

              {(searchTerm || categoryFilter !== 'all') && (
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setCategoryFilter('all');
                  }}
                  className="text-xs text-blue-600 hover:text-blue-700 font-semibold underline cursor-pointer"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          </div>

          {/* Counter info */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-500 px-1">
            <span>
              Exibindo <strong className="text-slate-900 font-bold">{filteredProducts.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredProducts.length)}</strong> de <strong className="text-slate-900 font-bold">{filteredProducts.length}</strong> produtos
              {filteredProducts.length !== products.length && ` (${products.length} no total)`}
            </span>
            {categoryFilter !== 'all' && (
              <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md font-medium self-start sm:self-auto">
                Filtrado por: {categoryFilter}
              </span>
            )}
          </div>

          {/* Bulk Actions Floating/Sticky Toolbar */}
          {selectedProductIds.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-900 text-white rounded-2xl shadow-xl border border-slate-800 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 rounded-lg bg-blue-600 font-mono text-xs font-bold">
                  {selectedProductIds.length} selecionado(s)
                </span>
                <span className="text-xs text-slate-300 hidden sm:inline">
                  Ações em massa no Supabase:
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleBulkStatusChange(true)}
                  disabled={isBulkProcessing}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                  title="Ativar produtos selecionados"
                >
                  <Check className="w-3.5 h-3.5" /> Ativar
                </button>

                <button
                  type="button"
                  onClick={() => handleBulkStatusChange(false)}
                  disabled={isBulkProcessing}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                  title="Pausar produtos selecionados"
                >
                  Pausar
                </button>

                <button
                  type="button"
                  onClick={handleOpenBulkEdit}
                  disabled={isBulkProcessing}
                  className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                  title="Editar categoria, status ou atacado em massa"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" /> Editar em Massa
                </button>

                <button
                  type="button"
                  onClick={handleBulkDelete}
                  disabled={isBulkProcessing}
                  className="px-3 py-1.5 rounded-xl bg-red-600/80 hover:bg-red-600 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                  title="Excluir/desativar produtos selecionados"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Excluir
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedProductIds([])}
                  disabled={isBulkProcessing}
                  className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                  title="Desmarcar todos"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Products Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-3.5 px-3 sm:px-4 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={isAllVisibleSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = isSomeVisibleSelected;
                        }}
                        onChange={toggleSelectAllVisible}
                        disabled={loading || paginatedProducts.length === 0}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                        title="Selecionar todos os produtos visíveis nesta página"
                      />
                    </th>
                    <th className="py-3.5 px-4 sm:px-6">Produto</th>
                    <th className="py-3.5 px-4">SKU / Categoria</th>
                    <th className="py-3.5 px-4">Preço Custo</th>
                    <th className="py-3.5 px-4">Preço Varejo</th>
                    <th className="py-3.5 px-4">Preço Atacado</th>
                    <th className="py-3.5 px-4">Estoque</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="py-16 text-center text-slate-400">
                        <div className="flex flex-col items-center justify-center gap-3">
                          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                          <p className="text-xs font-semibold text-slate-600">Carregando catálogo do Supabase...</p>
                          <p className="text-[11px] text-slate-400">Consultando registros reais com isolamento por tenant</p>
                        </div>
                      </td>
                    </tr>
                  ) : filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Package className="w-8 h-8 text-slate-300" />
                          <p className="text-xs font-semibold text-slate-600">Nenhum produto encontrado</p>
                          <p className="text-[11px] text-slate-400">Tente ajustar os termos da pesquisa ou o filtro de categorias</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedProducts.map((prod) => (
                      <tr 
                        key={prod.id} 
                        className={`hover:bg-slate-50/80 transition-colors ${!prod.active ? 'opacity-60 bg-slate-50/40' : ''}`}
                      >
                        <td className="py-3.5 px-3 sm:px-4 text-center">
                          <input
                            type="checkbox"
                            checked={selectedProductIds.includes(prod.id)}
                            onChange={() => toggleSelect(prod.id)}
                            className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                          />
                        </td>
                        
                        <td className="py-3.5 px-4 sm:px-6">
                          <div className="flex items-center gap-3">
                            <img
                              src={getSafeProductImage(prod.images?.[0], prod.category)}
                              alt={prod.name}
                              loading="lazy"
                              decoding="async"
                              className="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0 bg-slate-50"
                              referrerPolicy="no-referrer"
                              onError={(e) => handleProductImageError(e, prod.category)}
                            />
                            <div>
                              <div className="font-bold text-slate-900 text-sm line-clamp-1 flex items-center gap-1.5">
                                {prod.name}
                                {prod.featured && (
                                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500 shrink-0" />
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 line-clamp-1">{prod.brand || authTenant?.name || currentTenant.name}</div>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-mono text-[11px] font-semibold text-slate-800">{prod.sku}</div>
                          <span className="inline-block mt-0.5 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium">
                            {prod.category}
                          </span>
                        </td>

                        {/* Preço de Custo (Exclusivo para Tenant Admin / Gestão) */}
                        <td className="py-3.5 px-4">
                          {prod.costPrice !== null && prod.costPrice !== undefined ? (
                            <div className="font-semibold text-slate-700 text-xs">
                              R$ {prod.costPrice.toFixed(2).replace('.', ',')}
                            </div>
                          ) : (
                            <span className="text-slate-400 font-normal">—</span>
                          )}
                        </td>

                        {/* Preço de Varejo */}
                        <td className="py-3.5 px-4">
                          {prod.promotionalPrice ? (
                            <div>
                              <span className="text-xs font-bold text-emerald-600">
                                R$ {prod.promotionalPrice.toFixed(2).replace('.', ',')}
                              </span>
                              <span className="block text-[10px] text-slate-400 line-through">
                                R$ {prod.price.toFixed(2).replace('.', ',')}
                              </span>
                            </div>
                          ) : (
                            <div className="font-bold text-slate-900 text-xs">
                              R$ {prod.price.toFixed(2).replace('.', ',')}
                            </div>
                          )}
                          <span className="text-[10px] text-slate-400">/{prod.unit}</span>
                        </td>

                        {/* Preço de Atacado (Preço simples importado do banco oficial) */}
                        <td className="py-3.5 px-4">
                          {prod.wholesalePrice !== null && prod.wholesalePrice !== undefined ? (
                            <div>
                              <div className="text-xs font-semibold text-blue-700">
                                R$ {prod.wholesalePrice.toFixed(2).replace('.', ',')}
                              </div>
                              {prod.wholesaleMinQuantity && (
                                <span className="text-[10px] text-blue-600 font-medium block">
                                  Mín. {prod.wholesaleMinQuantity} {prod.unit}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 font-normal">—</span>
                          )}
                        </td>

                        {/* Estoque (Itens com stock=0 permanecem visíveis) */}
                        <td className="py-3.5 px-4">
                          <div className={`font-bold text-xs ${prod.stock === 0 ? 'text-red-600' : prod.stock <= 5 ? 'text-amber-600' : 'text-slate-800'}`}>
                            {prod.stock} {prod.unit}
                          </div>
                          {prod.stock === 0 ? (
                            <span className="text-[10px] text-red-600 font-semibold flex items-center gap-0.5 mt-0.5">
                              <AlertCircle className="w-2.5 h-2.5" /> Esgotado
                            </span>
                          ) : prod.stock <= 5 ? (
                            <span className="text-[10px] text-amber-600 font-semibold flex items-center gap-0.5 mt-0.5">
                              <AlertCircle className="w-2.5 h-2.5" /> Baixo estoque
                            </span>
                          ) : null}
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-4">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold ${
                            prod.active
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-500'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${prod.active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                            {prod.active ? 'Ativo' : 'Pausado'}
                          </span>
                        </td>

                        {/* Ações: Edição Real e Visualização */}
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleOpenEdit(prod)}
                              className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors inline-flex items-center gap-1 text-xs font-bold cursor-pointer"
                              title="Editar Produto e Atacado"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Editar</span>
                            </button>

                            <button
                              onClick={() => setSelectedProduct(prod)}
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors inline-flex items-center text-xs cursor-pointer"
                              title="Visualizar Detalhes"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          </div>
                        </td>

                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Controles de Paginação */}
            {filteredProducts.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 sm:px-6 py-3.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-600">
                <div>
                  Exibindo <strong className="text-slate-900 font-bold">{(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredProducts.length)}</strong> de <strong className="text-slate-900 font-bold">{filteredProducts.length}</strong> produtos
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage <= 1 || loading}
                    className="px-3.5 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  >
                    Anterior
                  </button>
                  
                  <span className="text-xs font-semibold text-slate-700 px-2">
                    Página {currentPage} de {totalPages}
                  </span>

                  <button
                    type="button"
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage >= totalPages || loading}
                    className="px-3.5 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Modal de Detalhes do Produto (Modo Leitura Seguro) */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div 
            className="fixed inset-0" 
            onClick={() => setSelectedProduct(null)} 
            aria-hidden="true" 
          />

          <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl p-6 sm:p-8 max-h-[90vh] overflow-y-auto space-y-6 z-10 border border-slate-100">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-blue-50 text-blue-700">
                    SKU: {selectedProduct.sku}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                    {selectedProduct.category}
                  </span>
                  {selectedProduct.featured && (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 flex items-center gap-1">
                      <Star className="w-3 h-3 fill-amber-400 text-amber-500" /> Destaque
                    </span>
                  )}
                </div>
                <h3 className="text-lg font-bold text-slate-900 mt-2 font-['Outfit']">
                  {selectedProduct.name}
                </h3>
                <p className="text-xs text-slate-500">
                  ID: <code className="font-mono text-[11px]">{selectedProduct.id}</code>
                </p>
              </div>

              <button
                onClick={() => setSelectedProduct(null)}
                className="p-1 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Aviso de Modo Leitura */}
            <div className="p-3.5 rounded-2xl bg-blue-50 border border-blue-100 text-blue-900 text-xs flex items-start gap-2.5">
              <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <strong>Modo Leitura Administrativo:</strong> Os dados exibidos abaixo são recuperados diretamente da tabela <code className="bg-blue-100/70 px-1 py-0.5 rounded font-mono text-[11px]">public.products</code> do Supabase. Conforme a arquitetura da Etapa 5C, as operações de escrita (criação, edição e exclusão de produtos) serão liberadas na próxima fase.
              </div>
            </div>

            {/* Specs Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Preço de Custo</span>
                <span className="text-sm font-bold text-slate-900 mt-0.5 block">
                  {selectedProduct.costPrice !== null && selectedProduct.costPrice !== undefined
                    ? `R$ ${selectedProduct.costPrice.toFixed(2).replace('.', ',')}`
                    : '—'}
                </span>
              </div>

              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Preço Varejo</span>
                <span className="text-sm font-bold text-emerald-600 mt-0.5 block">
                  R$ {selectedProduct.price.toFixed(2).replace('.', ',')}
                </span>
              </div>

              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Preço Atacado</span>
                <span className="text-sm font-bold text-blue-600 mt-0.5 block">
                  {selectedProduct.wholesalePrice !== null && selectedProduct.wholesalePrice !== undefined
                    ? `R$ ${selectedProduct.wholesalePrice.toFixed(2).replace('.', ',')}`
                    : '—'}
                </span>
              </div>

              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Estoque Atual</span>
                <span className={`text-sm font-bold mt-0.5 block ${selectedProduct.stock === 0 ? 'text-red-600' : 'text-slate-900'}`}>
                  {selectedProduct.stock} {selectedProduct.unit}
                </span>
              </div>
            </div>

            {/* Product Details Sections */}
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="border border-slate-100 p-3.5 rounded-2xl">
                  <span className="text-slate-400 font-medium block text-[11px]">Código de Barras (EAN):</span>
                  <span className="font-mono font-bold text-slate-800 text-xs mt-0.5 block">
                    {selectedProduct.barcode || 'Não informado'}
                  </span>
                </div>

                <div className="border border-slate-100 p-3.5 rounded-2xl">
                  <span className="text-slate-400 font-medium block text-[11px]">Marca:</span>
                  <span className="font-semibold text-slate-800 text-xs mt-0.5 block">
                    {selectedProduct.brand || '—'}
                  </span>
                </div>
              </div>

              {selectedProduct.description && (
                <div className="border border-slate-100 p-3.5 rounded-2xl">
                  <span className="text-slate-400 font-medium block text-[11px] mb-1">Descrição:</span>
                  <p className="text-slate-700 leading-relaxed">{selectedProduct.description}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100">
              <button
                onClick={() => setSelectedProduct(null)}
                className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer transition-colors"
              >
                Fechar Detalhes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edição Individual Real */}
      {editingProduct && effectiveTenantId && (
        <ProductEditModal
          product={editingProduct}
          tenantId={effectiveTenantId}
          categories={categories}
          onClose={() => setEditingProduct(null)}
          onSuccess={handleIndividualEditSuccess}
        />
      )}

      {/* Modal de Edição em Massa Real */}
      {isBulkEditOpen && effectiveTenantId && (
        <ProductBulkEditModal
          selectedProductIds={selectedProductIds}
          tenantId={effectiveTenantId}
          categories={categories}
          onClose={() => setIsBulkEditOpen(false)}
          onSuccess={handleBulkEditSuccess}
        />
      )}

      {/* Modal de Importação em Massa de Imagens por SKU */}
      {isBulkImageImportOpen && effectiveTenantId && (
        <ProductBulkImageImportModal
          products={products}
          effectiveTenantId={effectiveTenantId}
          onClose={() => setIsBulkImageImportOpen(false)}
          onReload={handleReload}
          showToast={showToast}
        />
      )}

    </div>
  );
};
