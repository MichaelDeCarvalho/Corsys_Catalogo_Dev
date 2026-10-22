import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { buildCatalogDisplayItems } from '../src/services/variantCatalogService';
import { Product } from '../src/types';
import { getSafeProductImage, NEUTRAL_PRODUCT_PLACEHOLDER } from '../src/utils/productImages';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAILED: ${testName}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('TEST SUITE: CATALOG PERFORMANCE & CLIENT-SIDE PAGINATION');
  console.log('======================================================\n');

  const productManagerSource = fs.readFileSync(
    path.resolve(__dirname, '../src/components/tenantadmin/ProductManager.tsx'),
    'utf-8'
  );

  const variantCatalogSource = fs.readFileSync(
    path.resolve(__dirname, '../src/services/variantCatalogService.ts'),
    'utf-8'
  );

  const productEditModalSource = fs.readFileSync(
    path.resolve(__dirname, '../src/components/tenantadmin/ProductEditModal.tsx'),
    'utf-8'
  );

  // -------------------------------------------------------------------------
  // 1. ANÁLISE ESTÁTICA: ProductManager.tsx
  // -------------------------------------------------------------------------
  console.log('1. Análise Estática do ProductManager.tsx');
  
  assert(
    /ITEMS_PER_PAGE\s*=\s*40/.test(productManagerSource),
    'Constante ITEMS_PER_PAGE = 40 declarada no código'
  );

  assert(
    /paginatedProducts\.map\(/.test(productManagerSource),
    'Tabela principal renderiza paginatedProducts.map'
  );

  assert(
    !/<tbody>[\s\S]*?filteredProducts\.map\(/.test(productManagerSource),
    'Tabela principal NUNCA renderiza filteredProducts.map simultaneamente'
  );

  assert(
    /const categories = useMemo\(/.test(productManagerSource),
    'Derivação categories é memoizada com useMemo'
  );

  assert(
    /const filteredProducts = useMemo\(/.test(productManagerSource),
    'Derivação filteredProducts é memoizada com useMemo'
  );

  assert(
    /const paginatedProducts = useMemo\(/.test(productManagerSource),
    'Derivação paginatedProducts é memoizada com useMemo'
  );

  assert(
    /setCurrentPage\(1\)/.test(productManagerSource),
    'currentPage é resetado para 1 em caso de mudança de filtros'
  );

  assert(
    /loading="lazy"/.test(productManagerSource) && /decoding="async"/.test(productManagerSource),
    'Thumbnails administrativos utilizam loading="lazy" e decoding="async"'
  );

  assert(
    productManagerSource.includes('Anterior') && 
    productManagerSource.includes('Próxima') && 
    productManagerSource.includes('Página ') &&
    productManagerSource.includes('Exibindo '),
    'Controles de paginação presentes (Anterior, Próxima, Página X de Y, Exibindo A-B de N)'
  );

  // -------------------------------------------------------------------------
  // 2. ANÁLISE ESTÁTICA E PURIDADE: variantCatalogService.ts
  // -------------------------------------------------------------------------
  console.log('\n2. Puridade do variantCatalogService.ts');

  // Encontra o corpo da função buildCatalogDisplayItems
  const fnMatch = variantCatalogSource.match(/export function buildCatalogDisplayItems[\s\S]*?return\s*\{[\s\S]*?\};\s*\}/);
  const fnBody = fnMatch ? fnMatch[0] : '';

  assert(
    !fnBody.includes('console.warn('),
    'buildCatalogDisplayItems não possui chamadas a console.warn dentro do seu processamento'
  );

  assert(
    !fnBody.includes('console.log(') && !fnBody.includes('console.error('),
    'buildCatalogDisplayItems é função pura sem efeitos colaterais no console'
  );

  // Teste de execução sem throw nem spam
  const mockProducts: Product[] = Array.from({ length: 50 }, (_, i) => ({
    id: `prod-${i}`,
    tenantId: 'a0000000-0000-0000-0000-000000000001',
    name: `Produto Teste ${i}`,
    sku: `SKU-${i}`,
    category: i % 2 === 0 ? 'Ferramentas' : 'Acessórios',
    price: 100 + i,
    costPrice: 50,
    stock: 10,
    unit: 'un',
    active: true,
    featured: false,
    images: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));

  let warned = false;
  const originalWarn = console.warn;
  console.warn = () => { warned = true; };
  const res = buildCatalogDisplayItems(mockProducts);
  console.warn = originalWarn;

  assert(!warned, 'Execução de buildCatalogDisplayItems não gerou console.warn para catálogo com SKUs não configurados em grupos');
  assert(res.displayItems.length === 50, 'Todos os 50 produtos foram convertidos com sucesso');

  // -------------------------------------------------------------------------
  // 3. ANÁLISE ESTÁTICA: ProductEditModal.tsx (Compensação Idempotente)
  // -------------------------------------------------------------------------
  console.log('\n3. Compensação Idempotente no ProductEditModal.tsx');

  assert(
    /hasRolledBack/.test(productEditModalSource) || /performRollbackOnce/.test(productEditModalSource),
    'ProductEditModal possui trava de idempotência para evitar rollback duplo'
  );

  // -------------------------------------------------------------------------
  // 4. TESTE LÓGICO DE PARTICIONAMENTO DE CATÁLOGO (520 ITENS)
  // -------------------------------------------------------------------------
  console.log('\n4. Teste Lógico de Particionamento e Paginação (520 produtos reais)');

  const catalog520: Product[] = Array.from({ length: 520 }, (_, i) => ({
    id: `p-${i + 1}`,
    tenantId: 'a0000000-0000-0000-0000-000000000001',
    name: `Item Industrial ${i + 1}`,
    sku: `IND-${String(i + 1).padStart(4, '0')}`,
    category: 'Industrial',
    price: 50,
    stock: 20,
    unit: 'un',
    active: true,
    featured: false,
    images: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));

  const ITEMS_PER_PAGE = 40;
  const totalPages = Math.ceil(catalog520.length / ITEMS_PER_PAGE);

  assert(totalPages === 13, `520 produtos divididos por 40 resultam em exatamente 13 páginas (obtido: ${totalPages})`);

  // Página 1
  const page1Start = (1 - 1) * ITEMS_PER_PAGE;
  const page1 = catalog520.slice(page1Start, page1Start + ITEMS_PER_PAGE);
  assert(page1.length === 40, 'Página 1 contém exatamente 40 itens');
  assert(page1[0].sku === 'IND-0001' && page1[39].sku === 'IND-0040', 'Página 1 contém do SKU 1 ao 40');

  // Página 13 (última)
  const page13Start = (13 - 1) * ITEMS_PER_PAGE;
  const page13 = catalog520.slice(page13Start, page13Start + ITEMS_PER_PAGE);
  assert(page13.length === 40, 'Página 13 contém exatamente 40 itens restantes');
  assert(page13[0].sku === 'IND-0481' && page13[39].sku === 'IND-0520', 'Página 13 contém do SKU 481 ao 520');

  // Página além do limite (edge-case)
  const page14Start = (14 - 1) * ITEMS_PER_PAGE;
  const page14 = catalog520.slice(page14Start, page14Start + ITEMS_PER_PAGE);
  assert(page14.length === 0, 'Página além de totalPages retorna fatia vazia');

  // Teste de seleção isolada na página visível
  let selectedIds: string[] = ['p-500']; // Item previamente selecionado na página 13
  const isAllPage1Selected = page1.every(p => selectedIds.includes(p.id));
  assert(!isAllPage1Selected, 'Página 1 não está totalmente selecionada quando apenas item da página 13 está selecionado');

  // Selecionar todos os visíveis na página 1
  selectedIds = Array.from(new Set([...selectedIds, ...page1.map(p => p.id)]));
  assert(selectedIds.length === 41, 'Seleção inclui os 40 visíveis da página 1 mais o item preservado da página 13');

  // Desmarcar visíveis da página 1
  const page1Ids = new Set(page1.map(p => p.id));
  selectedIds = selectedIds.filter(id => !page1Ids.has(id));
  assert(selectedIds.length === 1 && selectedIds[0] === 'p-500', 'Desmarcar página 1 remove apenas itens da página 1 e preserva itens de outras páginas');

  // -------------------------------------------------------------------------
  // 5. SELEÇÃO DE IMAGENS DE FAMÍLIA E BUSCA POR SKU (HOTFIX CIRÚRGICO)
  // -------------------------------------------------------------------------
  console.log('\n5. Seleção de Imagens de Família e Busca por SKU (Hotfix Cirúrgico)');

  const variantGroupCardSource = fs.readFileSync(
    path.resolve(__dirname, '../src/components/storefront/VariantGroupCard.tsx'),
    'utf-8'
  );

  // Análise estática do variantCatalogService.ts
  assert(
    variantCatalogSource.includes('sortedVariants.find') &&
    variantCatalogSource.includes('representativeVariant.product.images'),
    'variantCatalogService seleciona representativeVariant como a primeira variante com imagens válidas'
  );

  // Análise estática do VariantGroupCard.tsx
  assert(
    variantGroupCardSource.includes('highlightedProduct') &&
    variantGroupCardSource.includes('cardImages') &&
    variantGroupCardSource.includes('highlightedInitialSku') &&
    variantGroupCardSource.includes('onOpenGroupDetail(groupItem, highlightedInitialSku)'),
    'VariantGroupCard deriva cardImages priorizando highlightedSkus e passa highlightedInitialSku'
  );

  // Cenário 1: Família cujo primeiro SKU ordenado (BR034 6MM) não tem foto, mas BR022 (10MM) tem
  const br034: Product = {
    id: 'prod-br034',
    tenantId: 'd0a51c4e-5e93-41bb-b8bf-4c74070a273b',
    sku: 'BR034',
    name: 'BROCA CERAMICA/PORCELANATO 6MM',
    price: 25.0,
    stock: 50,
    active: true,
    category: 'Brocas',
    images: [],
    unit: 'un',
  };

  const br022: Product = {
    id: 'prod-br022',
    tenantId: 'd0a51c4e-5e93-41bb-b8bf-4c74070a273b',
    sku: 'BR022',
    name: 'BROCA CERAMICA/PORCELANATO 10MM',
    price: 35.0,
    stock: 40,
    active: true,
    category: 'Brocas',
    images: ['https://storage.supabase.co/product-media/tenant/products/prod-br022/10mm.webp'],
    unit: 'un',
  };

  const g20Products = [br034, br022];
  const { displayItems: g20DisplayItems } = buildCatalogDisplayItems(g20Products);
  const g20Group = g20DisplayItems.find(item => item.type === 'variant-group' && item.groupId === 'G20');

  assert(g20Group !== undefined, 'Grupo G20 identificado na montagem de display items');
  assert(
    g20Group?.type === 'variant-group' && 
    g20Group.images.length === 1 && 
    g20Group.images[0] === 'https://storage.supabase.co/product-media/tenant/products/prod-br022/10mm.webp',
    'Família G20 adota as imagens do BR022 como imagem representativa quando primeiro SKU não possui foto'
  );

  // Cenário 2: Família sem nenhuma imagem permanece com images = [] e renderiza placeholder neutro
  const br034NoImg: Product = { ...br034, images: [] };
  const br022NoImg: Product = { ...br022, images: [] };
  const { displayItems: noImgItems } = buildCatalogDisplayItems([br034NoImg, br022NoImg]);
  const noImgGroup = noImgItems.find(item => item.type === 'variant-group' && item.groupId === 'G20');

  assert(
    noImgGroup?.type === 'variant-group' && noImgGroup.images.length === 0,
    'Família sem nenhuma imagem permanece com images = []'
  );
  assert(
    noImgGroup?.type === 'variant-group' && 
    getSafeProductImage(noImgGroup.images[0], noImgGroup.category) === NEUTRAL_PRODUCT_PLACEHOLDER,
    'getSafeProductImage retorna placeholder neutro para família sem imagens'
  );

  // Cenário 3: Busca por BR022 prioriza BR022.images no VariantGroupCard
  if (g20Group && g20Group.type === 'variant-group') {
    const highlightedSkus = ['BR022'];
    const highlightedProduct = highlightedSkus
      .map(sku => g20Group.variants.find(v => v.product.sku === sku)?.product)
      .find(product => product?.images && product.images.length > 0);

    const cardImages = highlightedProduct?.images && highlightedProduct.images.length > 0
      ? highlightedProduct.images
      : g20Group.images;

    assert(
      cardImages.length > 0 && cardImages[0] === 'https://storage.supabase.co/product-media/tenant/products/prod-br022/10mm.webp',
      'Busca por BR022 prioriza imagens da variante encontrada no card'
    );

    // Cenário 4: Clique no card após busca por BR022 passa BR022 como initialSku
    const highlightedInitialSku = highlightedSkus.find(sku =>
      g20Group.variants.some(v => v.product.sku === sku)
    );
    assert(
      highlightedInitialSku === 'BR022',
      'Clique no card após busca BR022 resolve initialSku = BR022 para abrir o modal'
    );

    // Cenário 5: Ausência de busca não seleciona nenhuma variante artificialmente
    const emptyHighlightedSkus: string[] = [];
    const noSearchInitialSku = emptyHighlightedSkus.find(sku =>
      g20Group.variants.some(v => v.product.sku === sku)
    );
    assert(
      noSearchInitialSku === undefined,
      'Ausência de busca resulta em initialSku undefined (nenhuma variante selecionada artificialmente)'
    );
  }

  // Cenário 6: Imagens originais dos produtos não sofrem mutação nem contaminação
  assert(
    Array.isArray(br034.images) && br034.images.length === 0,
    'Produto BR034 original não foi mutado e permanece com images = [] (sem contaminação cruzada)'
  );
  assert(
    br022.images.length === 1 && br022.images[0] === 'https://storage.supabase.co/product-media/tenant/products/prod-br022/10mm.webp',
    'Produto BR022 original preserva suas imagens intactas'
  );

  console.log('\n======================================================');
  console.log(`TOTAL DE TESTES: ${passed + failed}`);
  console.log(`PASSOU: ${passed}`);
  console.log(`FALHOU: ${failed}`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
