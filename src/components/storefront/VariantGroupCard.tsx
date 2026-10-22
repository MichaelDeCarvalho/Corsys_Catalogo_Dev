import React, { useState } from 'react';
import { 
  Layers, 
  ChevronDown, 
  ChevronUp, 
  ShoppingCart, 
  Check, 
  AlertCircle,
  Eye
} from 'lucide-react';
import { Product } from '../../types';
import { CatalogDisplayItem, ProductVariantItem } from '../../services/variantCatalogService';
import { getSafeProductImage, handleProductImageError } from '../../utils/productImages';
import { DigitQuantityInput } from './DigitQuantityInput';
import { useApp } from '../../context/AppContext';

interface VariantGroupCardProps {
  groupItem: Extract<CatalogDisplayItem, { type: 'variant-group' }>;
  highlightedSkus?: string[];
  onAddToCart: (product: Product, quantity: number) => void;
  onSelectProduct?: (product: Product) => void;
  onOpenGroupDetail: (groupItem: Extract<CatalogDisplayItem, { type: 'variant-group' }>, initialSku?: string) => void;
}

export const VariantGroupCard: React.FC<VariantGroupCardProps> = ({
  groupItem,
  highlightedSkus = [],
  onAddToCart,
  onSelectProduct,
  onOpenGroupDetail,
}) => {
  const { shoppingMode } = useApp();
  const isWholesaleMode = shoppingMode === 'wholesale';
  const cardRef = React.useRef<HTMLDivElement>(null);

  // Se houver busca direcionada a um SKU deste grupo, expande automaticamente
  const hasMatchedSearch = highlightedSkus.length > 0;
  const [isExpanded, setIsExpanded] = useState<boolean>(hasMatchedSearch);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [addedVariants, setAddedVariants] = useState<Record<string, boolean>>({});

  // Quando houver highlightedSkus decorrentes de busca específica por SKU,
  // prioriza visualmente a foto do produto encontrado (se houver)
  const highlightedProduct = highlightedSkus
    .map(sku => groupItem.variants.find(v => v.product.sku === sku)?.product)
    .find(product => product?.images && product.images.length > 0);

  const cardImages = highlightedProduct?.images && highlightedProduct.images.length > 0
    ? highlightedProduct.images
    : groupItem.images;

  // Quando a busca tiver encontrado um SKU específico, passa esse SKU como initialSku ao abrir o detalhe
  const highlightedInitialSku = highlightedSkus.find(sku =>
    groupItem.variants.some(v => v.product.sku === sku)
  );

  const handleOpenDetail = () => {
    onOpenGroupDetail(groupItem, highlightedInitialSku);
  };

  const displayMinPrice = React.useMemo(() => {
    if (isWholesaleMode) {
      const wholesalePrices = groupItem.variants
        .filter(v => Boolean(v.product.wholesaleEnabled ?? (v.product.wholesalePrice !== null && (v.product.wholesalePrice ?? 0) > 0)))
        .map(v => v.product.wholesalePrice || v.product.price);
      if (wholesalePrices.length > 0) {
        return Math.min(...wholesalePrices);
      }
    }
    return groupItem.minPrice;
  }, [isWholesaleMode, groupItem]);

  // Sincroniza abertura automática quando a busca mudar
  React.useEffect(() => {
    if (hasMatchedSearch) {
      setIsExpanded(true);
    }
  }, [hasMatchedSearch]);

  // Click Outside e tecla ESC para fechar a lista rápida de variações
  React.useEffect(() => {
    if (!isExpanded) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (cardRef.current && !cardRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsExpanded(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isExpanded]);

  const handleQtyChange = (productId: string, val: number) => {
    setQuantities(prev => ({
      ...prev,
      [productId]: val,
    }));
  };

  const handleAdd = (variant: ProductVariantItem) => {
    const prod = variant.product;
    const isWholesaleVariant = Boolean(prod.wholesaleEnabled ?? (prod.wholesalePrice !== null && (prod.wholesalePrice ?? 0) > 0));
    const variantMin = isWholesaleMode && isWholesaleVariant
      ? (prod.wholesaleMinQuantity && prod.wholesaleMinQuantity > 0 ? prod.wholesaleMinQuantity : 1)
      : (prod.minOrderQuantity || 1);
    if (prod.stock <= 0 || (isWholesaleMode && isWholesaleVariant && prod.stock < variantMin)) {
      return;
    }
    const qty = quantities[variant.product.id] || variantMin;
    onAddToCart(variant.product, qty);

    // Feedback visual temporário de adição
    setAddedVariants(prev => ({ ...prev, [variant.product.id]: true }));
    setTimeout(() => {
      setAddedVariants(prev => ({ ...prev, [variant.product.id]: false }));
    }, 1200);
  };

  const formatPrice = (val: number) => val.toFixed(2).replace('.', ',');

  return (
    <div 
      ref={cardRef}
      className="bg-white rounded-2xl border border-[#E2E8F0] shadow-xs hover:shadow-md transition-all overflow-hidden flex flex-col justify-between group"
    >
      <div>
        {/* Container da Imagem com Badges Informativos - Clicável para abrir Detalhe da Família */}
        <div 
          onClick={handleOpenDetail}
          className="relative aspect-4/3 bg-slate-100 overflow-hidden cursor-pointer group/img"
          title={`Clique para ver detalhes de ${groupItem.displayName}`}
        >
          <img
            src={getSafeProductImage(cardImages[0], groupItem.category)}
            alt={groupItem.displayName}
            className="w-full h-full object-cover group-hover/img:scale-105 transition-transform duration-300"
            referrerPolicy="no-referrer"
            onError={(e) => handleProductImageError(e, groupItem.category)}
          />

          {/* Badges Superiores */}
          <div className="absolute top-2.5 left-2.5 flex flex-col gap-1.5 z-10">
            <span className="bg-[#0F172A] text-[#FF5A00] text-[10px] font-extrabold px-2.5 py-1 rounded-md shadow-xs flex items-center gap-1 border border-slate-700">
              <Layers className="w-3 h-3 text-[#FF5A00]" />
              {groupItem.variants.length} opções
            </span>
            {isWholesaleMode && (
              groupItem.hasWholesale ? (
                <span className="bg-amber-500 text-slate-950 text-[10px] font-black px-2 py-0.5 rounded-md shadow-xs border border-amber-400">
                  Atacado B2B
                </span>
              ) : (
                <span className="bg-slate-800/90 text-slate-200 text-[10px] font-extrabold px-2 py-0.5 rounded-md shadow-xs">
                  Somente Varejo
                </span>
              )
            )}
          </div>

          <div className="absolute bottom-2.5 right-2.5 bg-black/75 backdrop-blur-xs text-white text-[10px] px-2 py-0.5 rounded-md font-mono">
            {groupItem.variants.length} variações ({groupItem.variantType})
          </div>
        </div>

        {/* Informações Principais do Grupo */}
        <div className="p-4 space-y-2">
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-bold text-slate-500 uppercase tracking-wider">
              {groupItem.category}
            </span>
            <span
              className={`font-semibold ${
                groupItem.totalStock > 0 ? 'text-emerald-700' : 'text-slate-400'
              }`}
            >
              Estoque total: {groupItem.totalStock} {groupItem.primaryUnit}
            </span>
          </div>

          <h3 
            onClick={handleOpenDetail}
            className="font-bold text-slate-900 text-base leading-snug tracking-tight hover:text-[#FF5A00] transition-colors cursor-pointer"
            title={`Ver detalhes de ${groupItem.displayName}`}
          >
            {groupItem.displayName}
          </h3>

          {groupItem.brand && (
            <p className="text-[11px] text-slate-500">
              Marca: <strong className="text-slate-700">{groupItem.brand}</strong>
            </p>
          )}

          {/* Bloco de Preço Comercial "A partir de" */}
          <div className="pt-2 border-t border-slate-100">
            <div className="text-[11px] text-slate-500 font-medium flex items-center justify-between">
              <span>A partir de</span>
              {isWholesaleMode && (
                <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                  Preço de Atacado
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-extrabold text-[#0F172A]">
                R$ {formatPrice(displayMinPrice)}
              </span>
              <span className="text-[11px] text-slate-400">/{groupItem.primaryUnit}</span>
            </div>

            {/* Aviso se a variante de menor preço estiver esgotada */}
            {groupItem.cheapestVariantOutOfStock && (
              <div className="flex items-center gap-1 text-[11px] text-amber-700 font-semibold mt-1 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                <AlertCircle className="w-3 h-3 text-amber-600 shrink-0" />
                <span>Opção mais econômica temporariamente sem estoque</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Controle de Expansão das Variações */}
      <div className="p-4 pt-0 space-y-3">
        <button
          type="button"
          onClick={() => setIsExpanded(prev => !prev)}
          className={`w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-between transition-all cursor-pointer border ${
            isExpanded
              ? 'bg-slate-100 text-slate-800 border-slate-300'
              : 'bg-slate-50 hover:bg-slate-100 text-[#0F172A] border-slate-200 hover:border-slate-300'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-[#FF5A00]" />
            <span>{isExpanded ? 'Ocultar Variações' : `Variações (${groupItem.variants.length})`}</span>
          </span>
          <span className="flex items-center gap-1 text-[11px] text-slate-600 font-medium">
            <span>{isExpanded ? 'Fechar' : 'Ver opções'}</span>
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </button>

        {/* Lista Expandida de Variantes Reais */}
        {isExpanded && (
          <div className="border border-slate-200 rounded-xl bg-slate-50/70 divide-y divide-slate-200 overflow-hidden text-xs">
            <div className="p-2.5 bg-slate-100/90 text-slate-600 text-[11px] font-bold flex items-center justify-between">
              <span>Opções Disponíveis ({groupItem.variantType})</span>
              <span className="text-[10px] text-slate-500 font-normal">Preço e Estoque Reais</span>
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-slate-200/80">
              {groupItem.variants.map((v) => {
                const prod = v.product;
                const isMatched = highlightedSkus.includes(prod.sku);
                const isOutOfStock = prod.stock <= 0;
                
                const isWholesaleVariant = Boolean(prod.wholesaleEnabled ?? (prod.wholesalePrice !== null && (prod.wholesalePrice ?? 0) > 0));
                const variantMin = isWholesaleMode && isWholesaleVariant
                  ? (prod.wholesaleMinQuantity && prod.wholesaleMinQuantity > 0 ? prod.wholesaleMinQuantity : 1)
                  : (prod.minOrderQuantity || 1);

                const isStockBelowMin = isWholesaleMode && isWholesaleVariant && prod.stock > 0 && prod.stock < variantMin;
                const isUnavailableInWholesale = isWholesaleMode && !isWholesaleVariant;

                const currentQty = quantities[prod.id] || variantMin;
                const unitPrice = isWholesaleMode && isWholesaleVariant && prod.wholesalePrice !== null && prod.wholesalePrice !== undefined
                  ? prod.wholesalePrice
                  : (prod.promotionalPrice || prod.price);

                const wasAdded = addedVariants[prod.id];
                const isActionDisabled = isOutOfStock || isStockBelowMin || isUnavailableInWholesale;

                return (
                  <div
                    key={prod.id}
                    className={`p-3 transition-colors ${
                      isMatched
                        ? 'bg-amber-50/90 border-l-4 border-l-[#FF5A00]'
                        : 'hover:bg-white'
                    }`}
                  >
                    {/* Linha 1: Label, SKU e Ação de Detalhes */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-[#0F172A] text-sm">
                          {v.label}
                        </span>
                        <span className="font-mono text-[10px] bg-slate-200/80 text-slate-700 px-1.5 py-0.5 rounded font-bold">
                          {prod.sku}
                        </span>
                        {isMatched && (
                          <span className="text-[9px] bg-[#FF5A00] text-white px-1.5 py-0.5 rounded-full font-bold">
                            Encontrado na busca
                          </span>
                        )}
                        {isWholesaleMode && isWholesaleVariant && (
                          <span className="text-[9px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-bold">
                            Mín: {variantMin} un
                          </span>
                        )}
                        {isUnavailableInWholesale && (
                          <span className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold">
                            Apenas Varejo
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setIsExpanded(false);
                          onOpenGroupDetail(groupItem, prod.sku);
                        }}
                        className="text-slate-400 hover:text-slate-700 p-1 rounded transition-colors cursor-pointer"
                        title="Ver detalhes desta variante"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Linha 2: Preços e Estoque Real */}
                    <div className="flex items-baseline justify-between gap-2 mt-1 text-[11px]">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className={`font-extrabold text-xs ${isWholesaleMode && isWholesaleVariant ? 'text-amber-600 font-black' : 'text-slate-900'}`}>
                          R$ {formatPrice(unitPrice)}
                        </span>
                        {isWholesaleMode && isWholesaleVariant && (
                          <span className="text-slate-400 text-[10px] line-through">
                            Varejo: R$ {formatPrice(prod.promotionalPrice || prod.price)}
                          </span>
                        )}
                      </div>

                      <span
                        className={`text-[10px] font-semibold ${
                          isOutOfStock ? 'text-rose-600 font-bold' : isStockBelowMin ? 'text-rose-600 font-bold' : 'text-slate-500'
                        }`}
                      >
                        {isOutOfStock ? 'Esgotado' : isStockBelowMin ? 'Estoque insuficiente para o mínimo de atacado' : `Estoque: ${prod.stock} ${prod.unit}`}
                      </span>
                    </div>

                    {/* Linha 3: Controle de Quantidade e Botão Adicionar */}
                    <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-100">
                      <DigitQuantityInput
                        quantity={currentQty}
                        stock={prod.stock}
                        min={variantMin}
                        disabled={isActionDisabled}
                        size="sm"
                        onUpdate={(qty) => handleQtyChange(prod.id, qty)}
                      />

                      <button
                        type="button"
                        onClick={() => handleAdd(v)}
                        disabled={isActionDisabled}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs ${
                          wasAdded
                            ? 'bg-emerald-600 text-white'
                            : isActionDisabled
                            ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            : 'bg-[#FF5A00] hover:bg-[#D94E00] text-white active:scale-95'
                        }`}
                      >
                        {wasAdded ? (
                          <>
                            <Check className="w-3 h-3" />
                            <span>Adicionado!</span>
                          </>
                        ) : isOutOfStock ? (
                          <span>Indisponível</span>
                        ) : isUnavailableInWholesale ? (
                          <span>Apenas Varejo</span>
                        ) : isStockBelowMin ? (
                          <span>Estoque insuficiente para atacado</span>
                        ) : (
                          <>
                            <ShoppingCart className="w-3 h-3" />
                            <span>Adicionar</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
