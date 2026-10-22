import { Product } from '../types';
import { PRODUCT_VARIANT_GROUPS, ProductVariantGroupConfig } from '../config/productVariantGroups';

export interface ProductVariantItem {
  product: Product;
  label: string;
}

export type CatalogDisplayItem =
  | {
      type: 'single';
      product: Product;
    }
  | {
      type: 'variant-group';
      groupId: string;
      displayName: string;
      variantType: string;
      category: string;
      brand?: string;
      images: string[];
      variants: ProductVariantItem[];
      minPrice: number;
      cheapestVariantOutOfStock: boolean;
      totalStock: number;
      hasWholesale: boolean;
      primaryUnit: string;
    };

/**
 * Remove acentos de uma string para comparações insensíveis a acentuação.
 */
function removeAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Extração determinística da label de variante baseada no nome oficial do Product.
 * Caso a extração seja ambígua, preserva o nome completo oficial como fallback seguro.
 */
export function extractVariantLabel(
  group: ProductVariantGroupConfig,
  product: Product
): string {
  const fullName = product.name.trim();
  const sku = product.sku.trim();
  const groupName = group.displayName;
  const variantType = group.variantType;

  // 1. Casos com especificação estrita e sem ambiguidade
  if (sku === 'BR046') return '60MM (Desbaste / Acabamento)';
  if (sku === 'BR047') return '9-48MM #50';
  if (sku === 'BR048') return '9-48MM #120';
  if (sku === 'BR049') return '9-48MM #80';
  if (sku === 'SR013') return '53MM VERMELHO';
  if (sku === 'BO010') return '#39/0';
  if (sku === 'BO011') return '#43/4';

  // 2. Grupo FLAP K (G46): Grão #40, Grão #60, Grão #80, Grão #100, Grão #120
  if (group.groupId === 'G46' || fullName.toUpperCase().includes('FLAP')) {
    const m = fullName.match(/#\s*(\d+)/i) || fullName.match(/GRÃO\s*#?\s*(\d+)/i);
    if (m) return `Grão #${m[1]}`;
  }

  // 3. Padrão " - #..." ou " - ..." comum em lixas, botas e massas plásticas
  const dashMatch = fullName.match(/-\s*#?\s*(.+)$/i);
  if (dashMatch) {
    let part = dashMatch[1].trim();

    // Se for cor (Massa Plástica, PU, etc.), remover o '#' prefixo se existir
    if (variantType === 'cor' || variantType === 'cor/peso') {
      part = part.replace(/^#\s*/, '').trim();
    }

    // Se for Serra Copo ou medidas com #, normalizar sem '#'
    if (groupName === 'SERRA COPO' || variantType === 'diâmetro') {
      part = part.replace(/^#\s*/, '').trim();
    }

    // Se for grão de lixa (ex: #50, #100), manter o formato com # se for número puro
    if (variantType === 'grão' && /^\d+$/.test(part)) {
      part = `#${part}`;
    }

    if (part.length > 0) {
      return part;
    }
  }

  // 4. Se tiver número de grão explícito no texto (ex: #50 ou GRÃO #50)
  if (variantType === 'grão') {
    const hashNumMatch = fullName.match(/#\s*(\d+)/);
    if (hashNumMatch) {
      return `#${hashNumMatch[1]}`;
    }
    const graoMatch = fullName.match(/GRÃO\s*#?\s*(\d+)/i);
    if (graoMatch) {
      return `#${graoMatch[1]}`;
    }
  }

  // 5. Padrão de remoção de prefixo do nome do grupo
  const normFull = removeAccents(fullName.toUpperCase());
  const normGroup = removeAccents(groupName.toUpperCase());

  if (normFull.startsWith(normGroup)) {
    let stripped = fullName.slice(groupName.length).trim();
    stripped = stripped.replace(/^[-–—#\s/]+/, '').trim();
    if (stripped.length > 0) {
      return stripped;
    }
  }

  // 6. Remoção de tokens iniciais comuns (ex: BROCA CERAMICA/PORCELANATO 6MM -> 6MM)
  const groupWords = normGroup.split(/[\s/]+/).filter(w => w.length > 1);
  let prefixMatchLen = 0;
  let accumulated = '';
  for (const word of groupWords) {
    const candidate = accumulated ? `${accumulated} ${word}` : word;
    if (normFull.startsWith(candidate)) {
      accumulated = candidate;
      prefixMatchLen = accumulated.length;
    }
  }

  if (prefixMatchLen > 0) {
    let remainder = fullName.slice(prefixMatchLen).trim();
    remainder = remainder.replace(/^[-–—#\s/]+/, '').trim();
    if (remainder.length > 0) {
      return remainder;
    }
  }

  // Fallback seguro: se não for possível extrair deterministicamente, retorna o nome oficial
  return fullName;
}

/**
 * Extrai o primeiro valor numérico de uma label para permitir ordenação semântica correta.
 * Suporta inteiros, decimais (com vírgula ou ponto) e frações simples (ex: 1/4).
 */
function extractPrimaryNumber(str: string): number | null {
  const fracMatch = str.match(/(\d+)\/(\d+)/);
  if (fracMatch) {
    const num = parseFloat(fracMatch[1]);
    const den = parseFloat(fracMatch[2]);
    if (den !== 0) return num / den;
  }

  const match = str.match(/#?\s*(\d+([,.]\d+)?)/);
  if (match) {
    return parseFloat(match[1].replace(',', '.'));
  }
  return null;
}

/**
 * Ordenação semântica das variações (ex: #50, #100, #200 ... ou 6MM, 8MM, 10MM, 100MM).
 */
export function sortVariantItems(variants: ProductVariantItem[]): ProductVariantItem[] {
  return [...variants].sort((a, b) => {
    const numA = extractPrimaryNumber(a.label);
    const numB = extractPrimaryNumber(b.label);

    if (numA !== null && numB !== null && numA !== numB) {
      return numA - numB;
    }

    return a.label.localeCompare(b.label, 'pt-BR', { numeric: true, sensitivity: 'base' });
  });
}

/**
 * Validação e construção da lista de exibição do catálogo (CatalogDisplayItem[]).
 *
 * Regras:
 * - Grupos com 2+ SKUs reais no catálogo viram 'variant-group'.
 * - Grupos que resultem em apenas 1 SKU real no catálogo degradam para 'single'.
 * - SKUs fora do mapa permanecem como 'single'.
 * - Nenhum SKU de grupo é duplicado como 'single'.
 * - Preço 'A partir de' é o menor 'price' real entre variantes ativas.
 */
export function buildCatalogDisplayItems(products: Product[]): {
  displayItems: CatalogDisplayItem[];
  stats: {
    totalSkus: number;
    totalCards: number;
    groupedSkus: number;
    singleCards: number;
    groupCards: number;
  };
} {
  const catalogSkuMap = new Map<string, Product>();
  for (const p of products) {
    catalogSkuMap.set(p.sku.trim(), p);
  }

  // Função pura durante render: nenhum efeito colateral ou console.warn por SKU.
  // SKUs ausentes permanecem ignorados de forma fail-safe no loop abaixo.

  const groupedSkusSet = new Set<string>();
  const displayItems: CatalogDisplayItem[] = [];
  let groupCardsCount = 0;
  let groupedSkusCount = 0;

  // Processa cada grupo aprovado
  for (const group of PRODUCT_VARIANT_GROUPS) {
    const matchedProducts: Product[] = [];
    for (const sku of group.skus) {
      const p = catalogSkuMap.get(sku);
      if (p) {
        matchedProducts.push(p);
      }
    }

    // Se o grupo não tiver membros no catálogo, ignora
    if (matchedProducts.length === 0) {
      continue;
    }

    // Se tiver apenas 1 SKU real no catálogo, renderiza como produto simples (sem grupo artificial)
    if (matchedProducts.length === 1) {
      const singleProduct = matchedProducts[0];
      groupedSkusSet.add(singleProduct.sku);
      displayItems.push({
        type: 'single',
        product: singleProduct,
      });
      continue;
    }

    // Grupo válido com 2+ variantes reais
    for (const p of matchedProducts) {
      groupedSkusSet.add(p.sku);
    }
    groupedSkusCount += matchedProducts.length;
    groupCardsCount += 1;

    // Constrói variantes com labels e aplica ordenação semântica
    const variantItems: ProductVariantItem[] = matchedProducts.map(p => ({
      product: p,
      label: extractVariantLabel(group, p),
    }));
    const sortedVariants = sortVariantItems(variantItems);

    // Identifica menor preço real entre variantes ativas
    const activeVariants = sortedVariants.filter(v => v.product.active);
    const candidateVariants = activeVariants.length > 0 ? activeVariants : sortedVariants;
    
    // Menor preço de varejo real (promotionalPrice || price)
    let minPrice = Infinity;
    let cheapestVariant: Product | null = null;
    let totalStock = 0;
    let hasWholesale = false;

    for (const v of candidateVariants) {
      const p = v.product;
      const unitPrice = p.promotionalPrice || p.price;
      if (unitPrice < minPrice) {
        minPrice = unitPrice;
        cheapestVariant = p;
      }
      totalStock += p.stock;
      if (p.wholesalePrice !== null && p.wholesalePrice > 0) {
        hasWholesale = true;
      }
    }

    const firstProduct = sortedVariants[0].product;
    const category = firstProduct.category;
    const brand = firstProduct.brand;
    const representativeVariant = sortedVariants.find(
      variant => Array.isArray(variant.product.images) && variant.product.images.length > 0
    );
    const images = representativeVariant ? representativeVariant.product.images : [];
    const primaryUnit = firstProduct.unit || 'un';

    displayItems.push({
      type: 'variant-group',
      groupId: group.groupId,
      displayName: group.displayName,
      variantType: group.variantType,
      category,
      brand,
      images,
      variants: sortedVariants,
      minPrice: minPrice === Infinity ? 0 : minPrice,
      cheapestVariantOutOfStock: cheapestVariant ? cheapestVariant.stock <= 0 : false,
      totalStock,
      hasWholesale,
      primaryUnit,
    });
  }

  // Processa todos os produtos simples que não pertencem a grupos com 2+ itens
  let singleCardsCount = 0;
  for (const product of products) {
    if (!groupedSkusSet.has(product.sku)) {
      displayItems.push({
        type: 'single',
        product,
      });
      singleCardsCount += 1;
    }
  }

  return {
    displayItems,
    stats: {
      totalSkus: products.length,
      totalCards: displayItems.length,
      groupedSkus: groupedSkusCount,
      singleCards: singleCardsCount,
      groupCards: groupCardsCount,
    },
  };
}

/**
 * Avalia se um CatalogDisplayItem corresponde a uma pesquisa textual.
 * Busca em:
 * - displayName do grupo
 * - nome completo de cada Product
 * - SKU de cada Product
 * - label de cada variante
 * - categoria
 * - marca
 *
 * Retorna se houve correspondência e quais SKUs específicos foram combinados.
 */
export function matchesDisplayItemSearch(
  item: CatalogDisplayItem,
  searchTerm: string
): { matches: boolean; matchedSkus: string[] } {
  const term = searchTerm.toLowerCase().trim();
  if (!term) {
    return { matches: true, matchedSkus: [] };
  }

  if (item.type === 'single') {
    const p = item.product;
    const matches =
      p.name.toLowerCase().includes(term) ||
      p.sku.toLowerCase().includes(term) ||
      (p.brand && p.brand.toLowerCase().includes(term)) ||
      (p.category && p.category.toLowerCase().includes(term));
    return { matches, matchedSkus: matches ? [p.sku] : [] };
  }

  // Variant Group
  const matchedSkus: string[] = [];
  const groupMatches =
    item.displayName.toLowerCase().includes(term) ||
    (item.category && item.category.toLowerCase().includes(term)) ||
    (item.brand && item.brand.toLowerCase().includes(term));

  for (const v of item.variants) {
    const p = v.product;
    const variantMatches =
      p.sku.toLowerCase().includes(term) ||
      p.name.toLowerCase().includes(term) ||
      v.label.toLowerCase().includes(term) ||
      (p.brand && p.brand.toLowerCase().includes(term));

    if (variantMatches) {
      matchedSkus.push(p.sku);
    }
  }

  const matches = groupMatches || matchedSkus.length > 0;
  return { matches, matchedSkus };
}
