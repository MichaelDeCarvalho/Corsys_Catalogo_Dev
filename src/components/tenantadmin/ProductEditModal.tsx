import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Save, 
  Loader2, 
  AlertCircle, 
  Lock,
  Layers,
  Image as ImageIcon,
  Upload,
  Star,
  Trash2,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { Product } from '../../types';
import { updateAdminProduct, AdminProductUpdatePayload } from '../../services/adminCatalogService';
import { 
  validateProductMediaFile, 
  validateProductMediaFileDeep,
  uploadProductMediaImage, 
  rollbackProductMediaUploads, 
  removeProductMediaImage 
} from '../../services/productMediaStorageService';

interface ProductEditModalProps {
  product: Product;
  tenantId: string;
  categories: string[];
  onClose: () => void;
  onSuccess: (updatedProduct: Product) => void;
}

interface ProductImageItem {
  id: string;
  kind: 'existing' | 'new';
  url: string; // URL remota para imagens existentes, ou blob objectURL para novas (preview local)
  file?: File;
}

export const ProductEditModal: React.FC<ProductEditModalProps> = ({
  product,
  tenantId,
  categories,
  onClose,
  onSuccess,
}) => {
  // Form fields
  const [name, setName] = useState(product.name);
  const [category, setCategory] = useState(product.category);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [price, setPrice] = useState<string>(String(product.price));
  const [stock, setStock] = useState<string>(String(product.stock));
  const [active, setActive] = useState<boolean>(product.active);

  // Seção Atacado
  const [wholesaleEnabled, setWholesaleEnabled] = useState<boolean>(
    Boolean(product.wholesaleEnabled ?? (product.wholesalePrice !== null && (product.wholesalePrice ?? 0) > 0))
  );
  const [wholesalePrice, setWholesalePrice] = useState<string>(
    product.wholesalePrice !== null && product.wholesalePrice !== undefined
      ? String(product.wholesalePrice)
      : ''
  );
  const [wholesaleMinQuantity, setWholesaleMinQuantity] = useState<string>(
    product.wholesaleMinQuantity !== null && product.wholesaleMinQuantity !== undefined
      ? String(product.wholesaleMinQuantity)
      : '1'
  );

  // Seção Imagens do Produto (Storage V1 com consistência compensatória)
  const [images, setImages] = useState<ProductImageItem[]>(() => {
    const initial = product.images || [];
    return initial.map((url, idx) => ({
      id: `existing-${idx}-${url}`,
      kind: 'existing',
      url,
    }));
  });
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());

  // Limpeza estrita de ObjectURLs para prevenir vazamento de memória e blob URLs órfãs
  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      });
      objectUrlsRef.current.clear();
    };
  }, []);

  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Regra de UX: se desmarcar "Participa do atacado", limpa e desabilita preço e quantidade mínima
  const handleToggleWholesale = (enabled: boolean) => {
    setWholesaleEnabled(enabled);
    if (!enabled) {
      setWholesalePrice('');
      setWholesaleMinQuantity('');
    } else {
      if (!wholesalePrice || Number(wholesalePrice) <= 0) {
        const currentPriceNum = parseFloat(price) || product.price;
        const suggested = currentPriceNum > 0 ? (currentPriceNum * 0.9).toFixed(2) : '';
        setWholesalePrice(suggested);
      }
      if (!wholesaleMinQuantity || Number(wholesaleMinQuantity) < 1) {
        setWholesaleMinQuantity('1');
      }
    }
  };

  // Manipulação de Arquivos de Imagem (Apenas Preview Local - Upload somente ao Salvar)
  const handleSelectFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImageError(null);
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newItems: ProductImageItem[] = [];
    const errors: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const validation = validateProductMediaFile(file);
      if (!validation.valid) {
        errors.push(`${file.name}: ${validation.error}`);
        continue;
      }

      const previewUrl = URL.createObjectURL(file);
      objectUrlsRef.current.add(previewUrl);
      newItems.push({
        id: `new-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 8)}`,
        kind: 'new',
        url: previewUrl,
        file,
      });
    }

    if (errors.length > 0) {
      setImageError(errors.join(' | '));
    }

    if (newItems.length > 0) {
      setImages((prev) => [...prev, ...newItems]);
    }

    // Reseta o input para permitir selecionar o mesmo arquivo novamente se o usuário quiser
    e.target.value = '';
  };

  const handleRemoveImage = (indexToRemove: number) => {
    setImageError(null);
    setImages((prev) => {
      const item = prev[indexToRemove];
      if (item && item.kind === 'new') {
        try {
          URL.revokeObjectURL(item.url);
          objectUrlsRef.current.delete(item.url);
        } catch {}
      }
      return prev.filter((_, idx) => idx !== indexToRemove);
    });
  };

  const handleSetMainImage = (index: number) => {
    if (index === 0) return;
    setImages((prev) => {
      const item = prev[index];
      const rest = prev.filter((_, idx) => idx !== index);
      return [item, ...rest];
    });
  };

  const handleMoveImage = (index: number, direction: 'up' | 'down') => {
    setImages((prev) => {
      const targetIdx = direction === 'up' ? index - 1 : index + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIdx];
      next[targetIdx] = temp;
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setImageError(null);

    // Validações básicas de formulário
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMessage('O nome do produto é obrigatório.');
      return;
    }

    const finalCategory = isCustomCategory ? newCategoryInput.trim() : category;
    if (!finalCategory) {
      setErrorMessage('A categoria do produto é obrigatória.');
      return;
    }

    const parsedPrice = parseFloat(price.replace(',', '.'));
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      setErrorMessage('Informe um preço de venda válido (maior ou igual a zero).');
      return;
    }

    const parsedStock = parseInt(stock, 10);
    if (isNaN(parsedStock) || parsedStock < 0) {
      setErrorMessage('Informe um estoque válido (número inteiro maior ou igual a zero).');
      return;
    }

    // Validação da Seção Atacado
    let finalWholesalePrice: number | null = null;
    let finalWholesaleMinQuantity: number | null = null;

    if (wholesaleEnabled) {
      const parsedWholesalePrice = parseFloat(wholesalePrice.replace(',', '.'));
      if (isNaN(parsedWholesalePrice) || parsedWholesalePrice <= 0) {
        setErrorMessage('Para produtos participantes do atacado, o preço de atacado deve ser maior que zero.');
        return;
      }
      const parsedMinQty = parseInt(wholesaleMinQuantity, 10);
      if (isNaN(parsedMinQty) || parsedMinQty < 1) {
        setErrorMessage('Para produtos participantes do atacado, a quantidade mínima deve ser de pelo menos 1 unidade.');
        return;
      }

      finalWholesalePrice = parsedWholesalePrice;
      finalWholesaleMinQuantity = parsedMinQty;
    }

    setSaving(true);
    const uploadedPathsForRollback: string[] = [];
    let hasRolledBack = false;

    const performRollbackOnce = async () => {
      if (hasRolledBack || uploadedPathsForRollback.length === 0) return;
      hasRolledBack = true;
      await rollbackProductMediaUploads([...uploadedPathsForRollback], tenantId, product.id);
    };

    try {
      // 1. Validação profunda dos arquivos novos antes de iniciar qualquer envio
      for (const item of images) {
        if (item.kind === 'new' && item.file) {
          const deepVal = await validateProductMediaFileDeep(item.file);
          if (!deepVal.valid) {
            throw new Error(`${item.file.name}: ${deepVal.error || 'Arquivo inválido.'}`);
          }
        }
      }

      // 2. Upload de novos arquivos (com rastreamento de caminhos para rollback em caso de falha)
      const uploadedMap = new Map<string, string>(); // itemId -> publicUrl
      for (const item of images) {
        if (item.kind === 'new' && item.file) {
          const uploadRes = await uploadProductMediaImage(tenantId, product.id, item.file);
          if (uploadRes.error || !uploadRes.url) {
            throw new Error(uploadRes.error || `Falha no envio da foto "${item.file.name}".`);
          }
          uploadedMap.set(item.id, uploadRes.url);
          if (uploadRes.path) {
            uploadedPathsForRollback.push(uploadRes.path);
          }
        }
      }

      // 3. Monta o array determinístico final de images[] na ordem definida pelo operador
      const finalImages: string[] = [];
      for (const item of images) {
        if (item.kind === 'existing') {
          finalImages.push(item.url);
        } else {
          const uploadedUrl = uploadedMap.get(item.id);
          if (uploadedUrl) {
            finalImages.push(uploadedUrl);
          }
        }
      }

      // 4. Monta o payload de atualização de public.products
      const payload: AdminProductUpdatePayload = {
        name: trimmedName,
        category: finalCategory,
        price: parsedPrice,
        stock: parsedStock,
        active,
        wholesaleEnabled,
        wholesalePrice: finalWholesalePrice,
        wholesaleMinQuantity: finalWholesaleMinQuantity,
        images: finalImages,
      };

      // 5. Atualiza o banco via AdminCatalogService
      let updated: Product;
      try {
        updated = await updateAdminProduct(tenantId, product.id, payload);
      } catch (dbErr) {
        // Se o banco falhou, executa rollback de todos os uploads novos anteriores
        console.warn('[ProductEditModal] Falha ao persistir no DB. Executando rollback compensatório de mídias:', dbErr);
        await performRollbackOnce();
        throw dbErr;
      }

      // 6. Banco confirmou: somente agora remove mídias antigas que foram excluídas do produto
      const originalImages = product.images || [];
      const removedImages = originalImages.filter((origUrl) => !finalImages.includes(origUrl));
      for (const removedUrl of removedImages) {
        // Safe delete: ignora URLs externas ou V1 legadas; remove apenas mídias do bucket 'product-media' pertencentes a este produto
        await removeProductMediaImage(tenantId, product.id, removedUrl);
      }

      // Limpa os ObjectURLs temporários
      objectUrlsRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      });
      objectUrlsRef.current.clear();

      onSuccess(updated);
    } catch (err: unknown) {
      await performRollbackOnce();
      const msg = err instanceof Error ? err.message : 'Falha ao salvar produto no Supabase.';
      console.error('[ProductEditModal] Erro ao salvar:', err);
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

      <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl p-6 sm:p-8 max-h-[92vh] overflow-y-auto z-10 border border-slate-100 flex flex-col justify-between">
        
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-blue-50 text-blue-700">
                SKU: {product.sku}
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {active ? 'Ativo' : 'Inativo / Pausado'}
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 mt-2 font-['Outfit']">
              Editar Produto
            </h3>
            <p className="text-xs text-slate-500">
              Atualização direta na tabela <code className="font-mono text-[11px] bg-slate-100 px-1 py-0.5 rounded">public.products</code> do Supabase
            </p>
          </div>

          <button
            onClick={onClose}
            disabled={saving}
            className="p-1 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mt-4 p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <strong>Erro ao salvar:</strong> {errorMessage}
            </div>
          </div>
        )}

        {/* Form Body */}
        <form id="product-edit-form" onSubmit={handleSubmit} className="mt-4 space-y-5">
          
          {/* Nome */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Nome do Produto <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              required
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
          </div>

          {/* SKU (Read-Only) & Categoria */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
                <Lock className="w-3 h-3 text-slate-400" />
                SKU (Identificador único - somente leitura)
              </label>
              <input
                type="text"
                value={product.sku}
                disabled
                className="w-full px-3.5 py-2.5 bg-slate-100 border border-slate-300 rounded-xl text-xs text-slate-600 font-mono cursor-not-allowed font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Categoria <span className="text-red-500">*</span>
              </label>
              {!isCustomCategory ? (
                <div className="flex gap-2">
                  <select
                    value={category}
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        setIsCustomCategory(true);
                      } else {
                        setCategory(e.target.value);
                      }
                    }}
                    disabled={saving}
                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-medium focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer"
                  >
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                    <option value="__new__">+ Nova categoria...</option>
                  </select>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Nome da nova categoria"
                    value={newCategoryInput}
                    onChange={(e) => setNewCategoryInput(e.target.value)}
                    disabled={saving}
                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-medium placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setIsCustomCategory(false)}
                    className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-800"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Preço de Varejo & Estoque */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Preço de Venda / Varejo (R$) <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-xs text-slate-500 font-bold">R$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  disabled={saving}
                  required
                  className="w-full pl-9 pr-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Estoque Atual ({product.unit}) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="1"
                min="0"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                disabled={saving}
                required
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          {/* Status Ativo / Inativo */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
            <div>
              <span className="text-xs font-bold text-slate-800 block">Status de Publicação</span>
              <span className="text-[11px] text-slate-500 block">
                {active ? 'Produto disponível no catálogo da loja' : 'Produto pausado (não visível para clientes)'}
              </span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                disabled={saving}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>

          {/* SEÇÃO IMAGENS DO PRODUTO (STORAGE V1) */}
          <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-200 space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-slate-900">
                  Fotos do Produto ({images.length})
                </span>
              </div>

              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleSelectFiles}
                  disabled={saving}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5 text-blue-600" />
                  Adicionar Fotos
                </button>
              </div>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Formatos aceitos: <strong>PNG, JPEG, WebP</strong> (máx. 1 MiB por foto). 
              A foto na primeira posição é o destaque principal no catálogo.
              O envio remoto ao bucket ocorre somente ao salvar o produto.
            </p>

            {imageError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{imageError}</span>
              </div>
            )}

            {/* Grid de Imagens */}
            {images.length === 0 ? (
              <div className="p-6 text-center border border-dashed border-slate-200 rounded-xl bg-white">
                <ImageIcon className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs font-medium text-slate-500">
                  Nenhuma foto cadastrada para este produto.
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  O catálogo exibirá o placeholder neutro até que uma foto seja enviada.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
                {images.map((item, idx) => {
                  const isMain = idx === 0;
                  return (
                    <div 
                      key={item.id}
                      className={`relative group bg-white rounded-xl border p-2 flex flex-col justify-between transition-all ${
                        isMain ? 'border-blue-400 ring-2 ring-blue-100 shadow-xs' : 'border-slate-200'
                      }`}
                    >
                      {/* Thumbnail */}
                      <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-slate-100 mb-2">
                        <img 
                          src={item.url} 
                          alt={`Foto ${idx + 1}`}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            // Se falhar visualmente no preview, marca fallback
                            e.currentTarget.style.opacity = '0.5';
                          }}
                        />

                        {/* Badges */}
                        <div className="absolute top-1.5 left-1.5 flex flex-col gap-1">
                          {isMain && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-600 text-white flex items-center gap-1 shadow-xs">
                              <Star className="w-2.5 h-2.5 fill-current" />
                              Destaque
                            </span>
                          )}
                          {item.kind === 'new' && (
                            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-500 text-white shadow-xs">
                              Nova
                            </span>
                          )}
                        </div>

                        {/* Order indicator */}
                        <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-mono font-bold">
                          #{idx + 1}
                        </span>
                      </div>

                      {/* Controls */}
                      <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-100 text-slate-500">
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => handleMoveImage(idx, 'up')}
                            disabled={idx === 0 || saving}
                            title="Mover para cima"
                            className="p-1 rounded hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveImage(idx, 'down')}
                            disabled={idx === images.length - 1 || saving}
                            title="Mover para baixo"
                            className="p-1 rounded hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {!isMain && (
                          <button
                            type="button"
                            onClick={() => handleSetMainImage(idx)}
                            disabled={saving}
                            title="Definir como foto principal"
                            className="text-[10px] font-bold text-blue-600 hover:text-blue-800 px-1.5 py-0.5 rounded hover:bg-blue-50 transition-colors"
                          >
                            Principal
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleRemoveImage(idx)}
                          disabled={saving}
                          title="Remover foto"
                          className="p-1 rounded text-red-500 hover:text-red-700 hover:bg-red-50 transition-colors disabled:opacity-30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SEÇÃO ATACADO */}
          <div className="p-4 rounded-2xl bg-blue-50/50 border border-blue-100 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-slate-900">Configurações de Atacado</span>
              </div>
              
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={wholesaleEnabled}
                  onChange={(e) => handleToggleWholesale(e.target.checked)}
                  disabled={saving}
                  className="w-4 h-4 text-blue-600 rounded-md border-slate-300 focus:ring-blue-500 cursor-pointer"
                />
                <span className="text-xs font-bold text-blue-900">
                  Participa do atacado
                </span>
              </label>
            </div>

            <p className="text-[11px] text-slate-600 leading-relaxed">
              {wholesaleEnabled
                ? 'Quando habilitado, os clientes na modalidade Atacado poderão adquirir este item pelo preço diferenciado, respeitando a quantidade mínima estipulada.'
                : 'Item exclusivo para venda em varejo. Na modalidade Atacado, ele será exibido com aviso "Somente varejo".'}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div>
                <label className={`block text-xs font-bold mb-1 ${wholesaleEnabled ? 'text-slate-700' : 'text-slate-400'}`}>
                  Preço Atacado (R$) {wholesaleEnabled && <span className="text-red-500">*</span>}
                </label>
                <div className="relative">
                  <span className={`absolute left-3 top-2.5 text-xs font-bold ${wholesaleEnabled ? 'text-slate-400' : 'text-slate-300'}`}>
                    R$
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={wholesalePrice}
                    onChange={(e) => setWholesalePrice(e.target.value)}
                    disabled={!wholesaleEnabled || saving}
                    placeholder={wholesaleEnabled ? 'Ex: 45.00' : 'Desabilitado'}
                    className={`w-full pl-9 pr-3.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                      wholesaleEnabled
                        ? 'bg-white border border-slate-300 text-blue-700 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                        : 'bg-slate-100 border border-slate-300 text-slate-400 cursor-not-allowed'
                    }`}
                  />
                </div>
              </div>

              <div>
                <label className={`block text-xs font-bold mb-1 ${wholesaleEnabled ? 'text-slate-700' : 'text-slate-500'}`}>
                  Quantidade Mínima de Atacado {wholesaleEnabled && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  value={wholesaleMinQuantity}
                  onChange={(e) => setWholesaleMinQuantity(e.target.value)}
                  disabled={!wholesaleEnabled || saving}
                  placeholder={wholesaleEnabled ? 'Ex: 5' : 'Desabilitado'}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    wholesaleEnabled
                      ? 'bg-white border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                      : 'bg-slate-100 border border-slate-300 text-slate-400 cursor-not-allowed'
                  }`}
                />
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm hover:shadow-md transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Salvando no Supabase...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Salvar Alterações
                </>
              )}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
