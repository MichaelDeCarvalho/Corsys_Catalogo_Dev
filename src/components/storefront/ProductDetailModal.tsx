import React, { useState, useEffect } from 'react';
import { 
  X, 
  ShoppingCart, 
  Check, 
  MessageSquare,
  Layers,
  AlertCircle,
  Package,
  FileText,
  ShieldCheck
} from 'lucide-react';
import { Product, TenantPublicSettings } from '../../types';
import { CatalogDisplayItem, ProductVariantItem } from '../../services/variantCatalogService';
import { useApp } from '../../context/AppContext';
import { getSafeProductImage, handleProductImageError, isLegacyV1Url } from '../../utils/productImages';
import { DigitQuantityInput } from './DigitQuantityInput';

export interface ProductDetailModalProps {
  item?: CatalogDisplayItem | null;
  product?: Product | null;
  groupItem?: Extract<CatalogDisplayItem, { type: 'variant-group' }> | null;
  initialSku?: string;
  settings?: TenantPublicSettings | null;
  onClose: () => void;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  item,
  product,
  groupItem,
  initialSku,
  settings,
  onClose,
}) => {
  const { currentTenant, addToCart, setIsCartOpen, shoppingMode, requestShoppingModeChange } = useApp();

  // Determina o modo de operação do modal: simples ou grupo de variações
  const resolvedGroup: Extract<CatalogDisplayItem, { type: 'variant-group' }> | null = 
    groupItem || (item && item.type === 'variant-group' ? item : null);

  const resolvedSingleProduct: Product | null = 
    (!resolvedGroup ? (product || (item && item.type === 'single' ? item.product : null)) : null);

  const isGroupMode = !!resolvedGroup;

  // Estado da variante selecionada (no modo família)
  const [selectedVariant, setSelectedVariant] = useState<ProductVariantItem | null>(() => {
    if (!resolvedGroup) return null;
    if (initialSku) {
      const match = resolvedGroup.variants.find(v => v.product.sku === initialSku);
      if (match) return match;
    }
    return null;
  });

  // Atualiza a variante se o initialSku mudar
  useEffect(() => {
    if (resolvedGroup && initialSku) {
      const match = resolvedGroup.variants.find(v => v.product.sku === initialSku);
      if (match) {
        setSelectedVariant(match);
      }
    } else if (resolvedGroup && !initialSku) {
      setSelectedVariant(null);
    }
  }, [resolvedGroup, initialSku]);

  // Produto ativo para cálculos comerciais e adição ao carrinho
  const activeProduct: Product | null = isGroupMode 
    ? (selectedVariant ? selectedVariant.product : null)
    : resolvedSingleProduct;

  // Regras de Atacado / Varejo
  const isWholesaleMode = shoppingMode === 'wholesale';
  const isWholesaleItem = activeProduct 
    ? Boolean(activeProduct.wholesaleEnabled ?? (activeProduct.wholesalePrice !== null && (activeProduct.wholesalePrice ?? 0) > 0))
    : false;

  const wholesaleMinQty = (activeProduct?.wholesaleMinQuantity && activeProduct.wholesaleMinQuantity > 0)
    ? activeProduct.wholesaleMinQuantity
    : 1;

  const effectiveMinQty = (isWholesaleMode && isWholesaleItem)
    ? wholesaleMinQty
    : (activeProduct?.minOrderQuantity || 1);

  const isOutOfStock = activeProduct ? activeProduct.stock <= 0 : false;
  const isStockInsufficientForWholesale = isWholesaleMode && isWholesaleItem && activeProduct && activeProduct.stock > 0 && activeProduct.stock < effectiveMinQty;
  const isItemUnavailableInWholesale = isWholesaleMode && activeProduct && !isWholesaleItem;

  // Estado de quantidade com inicialização pelo mínimo (no atacado inicia no mínimo do SKU)
  const [quantity, setQuantity] = useState<number>(() => {
    if (activeProduct) {
      return (isWholesaleMode && isWholesaleItem) ? wholesaleMinQty : (activeProduct.minOrderQuantity || 1);
    }
    return 1;
  });

  // Atualiza a quantidade padrão quando a variante mudar ou modalidade mudar
  useEffect(() => {
    if (activeProduct) {
      const minQty = (isWholesaleMode && isWholesaleItem) ? wholesaleMinQty : (activeProduct.minOrderQuantity || 1);
      // Se estoque for insuficiente para o mínimo no atacado, nunca reduz para o estoque
      if (isWholesaleMode && isWholesaleItem && activeProduct.stock < minQty) {
        setQuantity(minQty);
        return;
      }
      const maxStock = activeProduct.stock > 0 ? activeProduct.stock : 1;
      setQuantity(prev => {
        if (prev < minQty) return minQty;
        if (prev > maxStock && activeProduct.stock > 0) return maxStock;
        return prev;
      });
    }
  }, [activeProduct, isWholesaleMode, isWholesaleItem, wholesaleMinQty]);

  // Imagens reais válidas para navegação de galeria (preparado para Storage V2)
  const allImages = (activeProduct?.images && activeProduct.images.length > 0)
    ? activeProduct.images
    : (resolvedGroup?.images || []);

  const validGalleryImages = allImages.filter(
    img => img && typeof img === 'string' && !isLegacyV1Url(img) && !img.includes('unsplash.com')
  );

  const [selectedImageIdx, setSelectedImageIdx] = useState<number>(0);
  const [isAdded, setIsAdded] = useState<boolean>(false);

  // Fecha com a tecla ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!resolvedGroup && !resolvedSingleProduct) {
    return null;
  }

  // Identificadores e metadados reais
  const storeName = settings?.publicName || currentTenant?.name || 'Corsys.Catálogo';
  const whatsappNumber = settings?.whatsappNumber || currentTenant?.customization?.whatsappNumber || '';

  const productName = isGroupMode ? resolvedGroup!.displayName : resolvedSingleProduct!.name;
  const categoryName = isGroupMode ? resolvedGroup!.category : resolvedSingleProduct!.category;
  const brandName = isGroupMode ? resolvedGroup!.brand : resolvedSingleProduct!.brand;

  // Formatação de preços e estoques
  const formatPrice = (val: number) => val.toFixed(2).replace('.', ',');

  // Preço unitário real da seleção respeitando a modalidade
  const currentUnitPrice = activeProduct 
    ? (isWholesaleMode && isWholesaleItem && activeProduct.wholesalePrice !== null && activeProduct.wholesalePrice !== undefined
        ? activeProduct.wholesalePrice
        : (activeProduct.promotionalPrice || activeProduct.price))
    : 0;

  const currentWholesalePrice = activeProduct?.wholesalePrice ?? null;
  const hasWholesale = currentWholesalePrice !== null && currentWholesalePrice > 0;
  const totalPrice = currentUnitPrice * quantity;

  // Determina se a compra pode ser executada
  const canAddToCart = isGroupMode
    ? (selectedVariant !== null && !isOutOfStock && !isStockInsufficientForWholesale && !isItemUnavailableInWholesale && quantity >= effectiveMinQty)
    : (!isOutOfStock && !isStockInsufficientForWholesale && !isItemUnavailableInWholesale && quantity >= effectiveMinQty);

  const currentUnit = activeProduct 
    ? activeProduct.unit 
    : (isGroupMode ? resolvedGroup!.primaryUnit : 'un');

  const currentStock = activeProduct 
    ? activeProduct.stock 
    : (isGroupMode ? resolvedGroup!.totalStock : 0);

  // Descrição real
  const realDescription = activeProduct?.description || (!isGroupMode ? resolvedSingleProduct?.description : undefined);

  // Executa adição segura ao pedido/carrinho
  const handleAddToCart = () => {
    if (!canAddToCart || !activeProduct) return;

    addToCart(activeProduct, quantity);
    setIsAdded(true);

    setTimeout(() => {
      setIsAdded(false);
      onClose();
      setIsCartOpen(true);
    }, 600);
  };

  // Contato direto via WhatsApp com número real e mensagem contextualizada
  const handleDirectWhatsApp = () => {
    if (!whatsappNumber) return;
    const cleanPhone = whatsappNumber.replace(/\D/g, '');

    let text = '';
    if (isGroupMode && selectedVariant) {
      text = `Olá! Gostaria de tirar uma dúvida sobre o produto: *${productName} - ${selectedVariant.label}* (Código SKU: ${selectedVariant.product.sku}) do catálogo ${storeName}.`;
    } else if (isGroupMode) {
      text = `Olá! Gostaria de informações sobre o produto: *${productName}* do catálogo ${storeName}.`;
    } else {
      text = `Olá! Gostaria de tirar uma dúvida sobre o produto: *${productName}* (Código SKU: ${resolvedSingleProduct!.sku}) do catálogo ${storeName}.`;
    }

    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/75 backdrop-blur-xs overflow-y-auto"
      onClick={onClose}
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-[#E2E8F0] my-auto flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        {/* Top Header Bar */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-sm z-20">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-800 bg-slate-100 px-3 py-1 rounded-full border border-slate-200 uppercase tracking-wider">
              {categoryName}
            </span>
            {isGroupMode && (
              <span className="text-xs bg-amber-50 text-amber-900 border border-amber-200 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                <Layers className="w-3 h-3 text-[#FF5A00]" />
                Família de Variações ({resolvedGroup!.variants.length} opções)
              </span>
            )}
            <span className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-600" />
              Catálogo Oficial
            </span>
          </div>

          <button 
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
            title="Fechar detalhe (ESC)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: Desktop 2 Columns (approx 45% / 55%) | Mobile: 1 Column */}
        <div className="p-5 sm:p-6 md:p-8 grid grid-cols-1 md:grid-cols-12 gap-6 sm:gap-8 items-start">
          
          {/* =================================================== */}
          {/* COLUNA ESQUERDA (~45% - md:col-span-5)              */}
          {/* =================================================== */}
          <div className="md:col-span-5 space-y-4">
            
            {/* Imagem Principal Grande */}
            <div className="aspect-square w-full rounded-2xl overflow-hidden bg-slate-100 border border-[#E2E8F0] shadow-xs relative">
              <img
                src={getSafeProductImage(
                  validGalleryImages[selectedImageIdx] || (allImages[0] || null), 
                  categoryName
                )}
                alt={productName}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
                onError={(e) => handleProductImageError(e, categoryName)}
              />

              {/* Badge de SKU na imagem */}
              <div className="absolute bottom-3 right-3 bg-black/75 backdrop-blur-xs text-white text-[11px] px-2.5 py-1 rounded-lg font-mono font-bold shadow-xs">
                {activeProduct ? `SKU: ${activeProduct.sku}` : `${resolvedGroup?.variants.length || 0} opções`}
              </div>
            </div>

            {/* Miniaturas Futuras (Renderizadas somente se houver > 1 imagem real válida) */}
            {validGalleryImages.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {validGalleryImages.map((img, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedImageIdx(idx)}
                    className={`w-16 h-16 rounded-xl overflow-hidden border-2 transition-all cursor-pointer shrink-0 ${
                      selectedImageIdx === idx 
                        ? 'border-[#FF5A00] shadow-xs ring-2 ring-[#FF5A00]/30' 
                        : 'border-[#E2E8F0] opacity-60 hover:opacity-100'
                    }`}
                  >
                    <img 
                      src={getSafeProductImage(img, categoryName)} 
                      alt="" 
                      className="w-full h-full object-cover"
                      onError={(e) => handleProductImageError(e, categoryName)}
                    />
                  </button>
                ))}
              </div>
            )}

            {/* Descrição Real (Apenas quando preenchida no banco) */}
            {realDescription && realDescription.trim() !== '' && (
              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                <div className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-slate-500" />
                  Descrição do Produto
                </div>
                <div className="text-xs text-slate-600 leading-relaxed max-h-40 overflow-y-auto whitespace-pre-line bg-slate-50 p-3 rounded-xl border border-slate-200">
                  {realDescription}
                </div>
              </div>
            )}

            {/* Seção Informações do Produto (sempre com dados reais) */}
            <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 text-xs text-slate-700 space-y-2">
              <div className="font-bold text-slate-800 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-[#FF5A00]" />
                Informações do Produto
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                <div>
                  <span className="text-slate-500 block">Código:</span>
                  <strong className="font-mono text-slate-900">
                    {activeProduct ? activeProduct.sku : 'Selecione uma variação'}
                  </strong>
                </div>

                <div>
                  <span className="text-slate-500 block">Categoria:</span>
                  <strong className="text-slate-900">{categoryName}</strong>
                </div>

                <div>
                  <span className="text-slate-500 block">Unidade:</span>
                  <strong className="text-slate-900">{currentUnit}</strong>
                </div>

                <div>
                  <span className="text-slate-500 block">Estoque:</span>
                  <strong className={currentStock > 0 ? 'text-emerald-700 font-bold' : 'text-rose-600 font-bold'}>
                    {currentStock > 0 ? `${currentStock} ${currentUnit}` : 'Esgotado'}
                  </strong>
                </div>

                {brandName && (
                  <div className="col-span-2">
                    <span className="text-slate-500 block">Marca:</span>
                    <strong className="text-slate-900">{brandName}</strong>
                  </div>
                )}

                {isGroupMode && selectedVariant && (
                  <div className="col-span-2">
                    <span className="text-slate-500 block">Variação Selecionada:</span>
                    <strong className="text-[#FF5A00] font-bold">
                      {selectedVariant.label} ({selectedVariant.product.sku})
                    </strong>
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-slate-200 text-[10px] text-slate-500">
                Origem verificada pelo catálogo <strong>{storeName}</strong>.
              </div>
            </div>

          </div>

          {/* =================================================== */}
          {/* COLUNA DIREITA (~55% - md:col-span-7)               */}
          {/* =================================================== */}
          <div className="md:col-span-7 flex flex-col justify-between space-y-5">
            
            {/* 1. Nome, Marca e Código SKU */}
            <div className="space-y-2">
              <h2 className="text-xl sm:text-2xl font-black text-[#0F172A] leading-snug tracking-tight font-['Outfit']">
                {productName}
              </h2>

              <div className="flex items-center gap-3 text-xs flex-wrap">
                <div className="flex items-center gap-1.5 font-mono bg-slate-100 text-slate-800 px-2.5 py-1 rounded-lg border border-slate-200">
                  <span className="text-slate-500 font-sans font-medium">Código:</span>
                  <strong className="font-bold">
                    {activeProduct ? activeProduct.sku : (isGroupMode ? 'Selecione abaixo' : '—')}
                  </strong>
                </div>

                {brandName && (
                  <div className="text-slate-600">
                    Marca: <strong className="text-slate-900">{brandName}</strong>
                  </div>
                )}
              </div>
            </div>

            {/* 2. Variações em Botões (somente para Grupos de Variação) */}
            {isGroupMode && resolvedGroup && (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-[#0F172A] uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-[#FF5A00]" />
                    Selecione {resolvedGroup.variantType}:
                  </span>
                  <span className="text-[11px] text-slate-500 font-medium">
                    {resolvedGroup.variants.length} opções disponíveis
                  </span>
                </div>

                {/* Grade de Botões de Variação */}
                <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto p-1 bg-slate-50/70 rounded-2xl border border-slate-200">
                  {resolvedGroup.variants.map((v) => {
                    const isSelected = selectedVariant?.product.id === v.product.id;
                    const isVariantOutOfStock = v.product.stock <= 0;

                    return (
                      <button
                        key={v.product.id}
                        type="button"
                        onClick={() => {
                          setSelectedVariant(v);
                          if (v.product.stock > 0 && quantity > v.product.stock) {
                            setQuantity(v.product.stock);
                          }
                        }}
                        className={`px-3 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer border flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-[#0F172A] text-white border-[#0F172A] shadow-md ring-2 ring-[#FF5A00]'
                            : isVariantOutOfStock
                            ? 'bg-slate-100 text-slate-400 border-slate-200 hover:border-slate-300'
                            : 'bg-white text-slate-800 border-slate-300 hover:border-slate-500 hover:bg-slate-50 shadow-2xs'
                        }`}
                        title={`${v.label} - SKU: ${v.product.sku} - R$ ${formatPrice(v.product.promotionalPrice || v.product.price)}`}
                      >
                        <span>{v.label}</span>
                        {isVariantOutOfStock ? (
                          <span className="text-[9px] font-normal text-rose-500 uppercase px-1 rounded bg-rose-50">Esgotado</span>
                        ) : isSelected ? (
                          <Check className="w-3.5 h-3.5 text-[#FF5A00]" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                {/* Alerta caso nenhuma variante esteja selecionada */}
                {!selectedVariant && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-xl border border-amber-200">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Selecione uma das opções acima para visualizar o código SKU e o preço real.</span>
                  </div>
                )}
              </div>
            )}

            {/* 3. Bloco de Preço Comercial e Estoque Real */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-[#E2E8F0] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-500 uppercase tracking-wider">
                  {isGroupMode && !selectedVariant ? 'Preço Comercial' : 'Preço Varejo'}
                </span>

                {isGroupMode && !selectedVariant ? (
                  <span className="font-semibold text-slate-600 text-[11px]">
                    Estoque total: {resolvedGroup!.totalStock} {resolvedGroup!.primaryUnit}
                  </span>
                ) : isOutOfStock ? (
                  <span className="text-rose-600 font-extrabold text-xs px-2 py-0.5 bg-rose-50 rounded border border-rose-200">
                    Esgotado
                  </span>
                ) : (
                  <span className="text-emerald-700 font-bold text-xs flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    Disponível: {currentStock} {currentUnit}
                  </span>
                )}
              </div>

              {/* Preço de Varejo / Atacado */}
              <div className="flex items-baseline gap-2 flex-wrap">
                {isGroupMode && !selectedVariant ? (
                  <>
                    <span className="text-sm font-semibold text-slate-500">A partir de</span>
                    <span className="text-3xl font-extrabold text-[#0F172A] font-['Outfit']">
                      R$ {formatPrice(resolvedGroup!.minPrice)}
                    </span>
                    <span className="text-xs text-slate-400 font-medium">/{resolvedGroup!.primaryUnit}</span>
                  </>
                ) : (
                  <>
                    <span className="text-3xl font-extrabold text-[#0F172A] font-['Outfit']">
                      R$ {formatPrice(currentUnitPrice)}
                    </span>
                    <span className="text-xs text-slate-400 font-medium">/{currentUnit}</span>

                    {isWholesaleMode && isWholesaleItem ? (
                      <span className="text-xs bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded-full ml-1 border border-blue-200">
                        Preço Atacado (Mín. {wholesaleMinQty} {currentUnit})
                      </span>
                    ) : null}

                    {activeProduct?.promotionalPrice && !isWholesaleMode && (
                      <span className="text-sm text-slate-400 line-through">
                        R$ {formatPrice(activeProduct.price)}
                      </span>
                    )}

                    {isWholesaleMode && isWholesaleItem && (
                      <span className="text-xs text-slate-500 line-through ml-1">
                        Varejo: R$ {formatPrice(activeProduct?.promotionalPrice || activeProduct?.price || 0)}
                      </span>
                    )}
                  </>
                )}
              </div>

              {/* Aviso se opção mais econômica está sem estoque */}
              {isGroupMode && !selectedVariant && resolvedGroup!.cheapestVariantOutOfStock && (
                <div className="flex items-center gap-1.5 text-xs text-amber-700 font-medium pt-1">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>A opção de menor valor está temporariamente esgotada.</span>
                </div>
              )}

              {/* Chamada para Atacado (B2B) quando visualizando em modo Varejo (sem revelar preço restrito) */}
              {!isWholesaleMode && hasWholesale && (
                <div className="pt-2 mt-1 border-t border-slate-200 text-xs text-slate-700 flex items-center justify-between">
                  <span className="font-semibold text-slate-800 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                    Condições no Atacado (B2B):
                  </span>
                  <span className="text-[11px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                    Acesso Exclusivo com CNPJ Aprovado
                  </span>
                </div>
              )}

              {/* Alerta caso esteja em modo atacado mas o produto NÃO participe */}
              {isItemUnavailableInWholesale && (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mt-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Disponível apenas no <strong>Varejo</strong> (não habilitado para atacado).</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => requestShoppingModeChange('retail')}
                    className="px-3 py-1.5 bg-[#0F172A] hover:bg-slate-800 text-white rounded-lg text-xs font-bold shrink-0 transition-colors cursor-pointer text-center"
                  >
                    Mudar para Varejo
                  </button>
                </div>
              )}

              {/* Alerta se o estoque for menor que o mínimo de atacado */}
              {isStockInsufficientForWholesale && (
                <div className="p-3 bg-red-50 rounded-xl border border-red-200 text-red-800 text-xs flex items-center gap-2 mt-2">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>
                    Estoque insuficiente para o mínimo de atacado (disponível: <strong>{activeProduct?.stock} {currentUnit}</strong>, mínimo: <strong>{effectiveMinQty} {currentUnit}</strong>).
                  </span>
                </div>
              )}
            </div>

            {/* 4. Controle de Quantidade e Subtotal */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-bold text-slate-800 block">
                    Quantidade ({currentUnit}):
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {isOutOfStock 
                      ? 'Indisponível para pedido' 
                      : isStockInsufficientForWholesale
                      ? 'Estoque insuficiente para o mínimo de atacado'
                      : isItemUnavailableInWholesale
                      ? 'Não disponível no atacado'
                      : (isGroupMode && !selectedVariant ? 'Selecione uma opção' : `Mínimo de ${effectiveMinQty} ${currentUnit}`)}
                  </span>
                </div>

                <DigitQuantityInput
                  quantity={quantity}
                  stock={isGroupMode && !selectedVariant ? undefined : currentStock}
                  min={effectiveMinQty}
                  disabled={(isGroupMode && !selectedVariant) || isOutOfStock || isStockInsufficientForWholesale || isItemUnavailableInWholesale}
                  size="lg"
                  onUpdate={(qty) => setQuantity(qty)}
                />
              </div>

              {/* Subtotal deste item quando ativo */}
              {activeProduct && !isOutOfStock && !isStockInsufficientForWholesale && !isItemUnavailableInWholesale && (
                <div className="flex items-center justify-between text-xs bg-slate-50 px-4 py-2.5 rounded-xl border border-[#E2E8F0]">
                  <span className="text-slate-600 font-medium">Subtotal deste item ({quantity} {currentUnit}):</span>
                  <span className="text-base font-extrabold text-[#0F172A] font-['Outfit']">
                    R$ {formatPrice(totalPrice)}
                  </span>
                </div>
              )}
            </div>

            {/* 5. CTAs: Adicionar ao Pedido e WhatsApp */}
            <div className="space-y-2.5 pt-2 border-t border-slate-100">
              
              {/* Botão Principal com a cor oficial #FF5A00 */}
              <button
                type="button"
                onClick={handleAddToCart}
                disabled={!canAddToCart}
                className={`w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition-all ${
                  !canAddToCart
                    ? 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed shadow-none'
                    : isAdded
                    ? 'bg-emerald-600 text-white shadow-emerald-600/30 cursor-pointer'
                    : 'bg-[#FF5A00] hover:bg-[#D94E00] text-white shadow-[#FF5A00]/25 cursor-pointer active:scale-98'
                }`}
                id="btn-modal-add-cart"
              >
                {isAdded ? (
                  <>
                    <Check className="w-5 h-5 text-white" />
                    <span>Adicionado ao Pedido!</span>
                  </>
                ) : isGroupMode && !selectedVariant ? (
                  <>
                    <Layers className="w-4 h-4 text-slate-400" />
                    <span>Selecione uma variação</span>
                  </>
                ) : isOutOfStock ? (
                  <>
                    <AlertCircle className="w-4 h-4 text-slate-400" />
                    <span>Produto Esgotado</span>
                  </>
                ) : isItemUnavailableInWholesale ? (
                  <>
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                    <span>Disponível apenas no Varejo</span>
                  </>
                ) : isStockInsufficientForWholesale ? (
                  <>
                    <AlertCircle className="w-4 h-4 text-red-500" />
                    <span>Estoque insuficiente para o mínimo de atacado</span>
                  </>
                ) : (
                  <>
                    <ShoppingCart className="w-4 h-4" />
                    <span>Adicionar {quantity} {currentUnit} ao Pedido</span>
                  </>
                )}
              </button>

              {/* Botão WhatsApp com número real de tenant_public_settings */}
              {whatsappNumber && (
                <button
                  type="button"
                  onClick={handleDirectWhatsApp}
                  className="w-full py-2.5 rounded-xl border border-emerald-300 hover:bg-emerald-50 text-emerald-800 font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <MessageSquare className="w-4 h-4 text-[#16A34A]" />
                  <span>Comprar / Pedir pelo WhatsApp</span>
                </button>
              )}

            </div>

          </div>

        </div>

      </div>
    </div>
  );
};
