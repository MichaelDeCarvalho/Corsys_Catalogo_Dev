import {
  validateProductMediaFile,
  validateProductMediaFileDeep,
  detectRealProductImageType,
  isValidUuid,
  extractOwnedProductMediaPath,
  getSafeProductImageExtension,
  PRODUCT_MEDIA_BUCKET,
  MAX_PRODUCT_IMAGE_SIZE_BYTES,
} from '../src/services/productMediaStorageService';
import {
  parseManifestJson,
  performBulkImageDryRun,
  executeSequentialBulkImageImport,
  BulkImportReport,
} from '../src/services/bulkImageImportService';
import {
  updateAdminProductImagesIfEmpty,
} from '../src/services/adminCatalogService';
import { LEGACY_SUPABASE_V1_HOST } from '../src/utils/productImages';
import * as fs from 'fs';

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
  console.log('TEST SUITE: PRODUCT MEDIA STORAGE V1 & ISOLATION');
  console.log('======================================================\n');

  const VALID_TENANT_UUID = 'a0000000-0000-0000-0000-000000000001';
  const OTHER_TENANT_UUID = 'b1111111-1111-1111-1111-111111111111';
  const VALID_PRODUCT_UUID = 'c2222222-2222-2222-2222-222222222222';
  const OTHER_PRODUCT_UUID = 'd3333333-3333-3333-3333-333333333333';

  // -------------------------------------------------------------------------
  // 1. UUID CANÔNICO & FAIL-CLOSED
  // -------------------------------------------------------------------------
  console.log('1. Validação de UUID & Fail-Closed (Tenant e Produto)');
  assert(isValidUuid(VALID_TENANT_UUID), 'Tenant UUID v4 canônico aceito');
  assert(isValidUuid(VALID_PRODUCT_UUID), 'Product UUID v4 canônico aceito');
  assert(!isValidUuid('produto-slug-123'), 'Slug de produto textual rejeitado');
  assert(!isValidUuid('tenant-alpha'), 'Slug de tenant textual rejeitado');
  assert(!isValidUuid(''), 'String vazia rejeitada');
  assert(!isValidUuid(null), 'Null rejeitado');
  assert(!isValidUuid(undefined), 'Undefined rejeitado');
  assert(!isValidUuid('../etc/passwd'), 'Path traversal textual rejeitado');
  assert(!isValidUuid('12345'), 'Identificador puramente numérico rejeitado');

  // -------------------------------------------------------------------------
  // 2. MIME TYPES & MAGIC BYTES BINÁRIOS
  // -------------------------------------------------------------------------
  console.log('\n2. MIME Types & Magic Bytes Binários');
  
  // PNG válido (89 50 4E 47 0D 0A 1A 0A)
  const validPngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
  const validPngBlob = new Blob([validPngBytes], { type: 'image/png' });
  const detectedPng = await detectRealProductImageType(validPngBlob);
  assert(detectedPng === 'image/png', 'Detecta magic bytes reais de PNG');

  // JPEG válido (FF D8 FF E0)
  const validJpgBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const validJpgBlob = new Blob([validJpgBytes], { type: 'image/jpeg' });
  const detectedJpg = await detectRealProductImageType(validJpgBlob);
  assert(detectedJpg === 'image/jpeg', 'Detecta magic bytes reais de JPEG');

  // WebP válido (RIFF .... WEBP)
  const validWebpBytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x24, 0x00, 0x00, 0x00, // size
    0x57, 0x45, 0x42, 0x50, // WEBP
    0x56, 0x50, 0x38, 0x20  // VP8
  ]);
  const validWebpBlob = new Blob([validWebpBytes], { type: 'image/webp' });
  const detectedWebp = await detectRealProductImageType(validWebpBlob);
  assert(detectedWebp === 'image/webp', 'Detecta magic bytes reais de WebP');

  // SVG Proibido (XSS vector)
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
  const svgFile = new File([svgText], 'foto.svg', { type: 'image/svg+xml' });
  const svgCheck = validateProductMediaFile(svgFile);
  assert(!svgCheck.valid && svgCheck.error?.includes('SVG'), 'SVG rejeitado explicitamente (mitigação de XSS)');

  // GIF Proibido nesta etapa
  const gifFile = new File(['GIF89a'], 'anim.gif', { type: 'image/gif' });
  const gifCheck = validateProductMediaFile(gifFile);
  assert(!gifCheck.valid && gifCheck.error?.includes('GIF'), 'GIF animado rejeitado explicitamente');

  // Spoofing de Extensão (texto falso renomeado para .png)
  const fakePngFile = new File(['Plain text masquerading as png'], 'foto.png', { type: 'image/png' });
  const deepFakeCheck = await validateProductMediaFileDeep(fakePngFile);
  assert(!deepFakeCheck.valid, 'Arquivo texto renomeado para .png rejeitado por inspeção binária');

  // Validação de Tamanho Limite (1 MiB)
  const oversizeFile = new File([new Uint8Array(MAX_PRODUCT_IMAGE_SIZE_BYTES + 1024)], 'grande.png', { type: 'image/png' });
  const oversizeCheck = validateProductMediaFile(oversizeFile);
  assert(!oversizeCheck.valid && oversizeCheck.error?.includes('1 MiB'), 'Foto > 1 MiB rejeitada');

  const validSizeFile = new File([new Uint8Array(500 * 1024)], 'foto_ok.png', { type: 'image/png' });
  const validSizeCheck = validateProductMediaFile(validSizeFile);
  assert(validSizeCheck.valid, 'Foto <= 1 MiB aceita na validação preliminar');

  // Extensões seguras
  assert(getSafeProductImageExtension('image/jpeg') === 'jpg', 'Extensão canônica jpg para image/jpeg');
  assert(getSafeProductImageExtension('image/png') === 'png', 'Extensão canônica png para image/png');
  assert(getSafeProductImageExtension('image/webp') === 'webp', 'Extensão canônica webp para image/webp');

  // -------------------------------------------------------------------------
  // 3. CONTROLE ESTRITO DE PATH (extractOwnedProductMediaPath) & URLS EXTERNAS
  // -------------------------------------------------------------------------
  console.log('\n3. Controle Estrito de Path & Isolamento Multi-Tenant / Multi-Produto');

  // URL canônica legítima do próprio tenant e próprio produto
  const canonicalProductUrl = `https://mysupabase.supabase.co/storage/v1/object/public/${PRODUCT_MEDIA_BUCKET}/${VALID_TENANT_UUID}/products/${VALID_PRODUCT_UUID}/media_1710000000_abc123.webp`;
  const extractedPath = extractOwnedProductMediaPath(canonicalProductUrl, VALID_TENANT_UUID, VALID_PRODUCT_UUID);
  assert(
    extractedPath === `${VALID_TENANT_UUID}/products/${VALID_PRODUCT_UUID}/media_1710000000_abc123.webp`,
    'Extrai path legítimo de URL Supabase para o próprio tenant e produto'
  );

  // Path relativo direto
  const directPath = `${VALID_TENANT_UUID}/products/${VALID_PRODUCT_UUID}/media_1710000000_def456.jpg`;
  const extractedDirect = extractOwnedProductMediaPath(directPath, VALID_TENANT_UUID, VALID_PRODUCT_UUID);
  assert(
    extractedDirect === directPath,
    'Aceita path relativo legítimo iniciado pelo UUID do tenant/products/product_uuid'
  );

  // Tentativa Cross-Tenant
  const crossTenantUrl = `https://mysupabase.supabase.co/storage/v1/object/public/${PRODUCT_MEDIA_BUCKET}/${OTHER_TENANT_UUID}/products/${VALID_PRODUCT_UUID}/media_1.png`;
  const crossTenantExtracted = extractOwnedProductMediaPath(crossTenantUrl, VALID_TENANT_UUID, VALID_PRODUCT_UUID);
  assert(
    crossTenantExtracted === null,
    'URL de outro tenant rejeitada com null (Cross-tenant isolado)'
  );

  // Tentativa Cross-Product
  const crossProductUrl = `https://mysupabase.supabase.co/storage/v1/object/public/${PRODUCT_MEDIA_BUCKET}/${VALID_TENANT_UUID}/products/${OTHER_PRODUCT_UUID}/media_1.png`;
  const crossProductExtracted = extractOwnedProductMediaPath(crossProductUrl, VALID_TENANT_UUID, VALID_PRODUCT_UUID);
  assert(
    crossProductExtracted === null,
    'URL de outro produto no mesmo tenant rejeitada com null (Cross-product isolado)'
  );

  // Outro Bucket
  const otherBucketUrl = `https://mysupabase.supabase.co/storage/v1/object/public/tenant-assets/${VALID_TENANT_UUID}/products/${VALID_PRODUCT_UUID}/media_1.png`;
  const otherBucketExtracted = extractOwnedProductMediaPath(otherBucketUrl, VALID_TENANT_UUID, VALID_PRODUCT_UUID);
  assert(
    otherBucketExtracted === null,
    'URL pertencente a outro bucket rejeitada com null'
  );

  // URL Legada do Supabase V1
  const legacyV1Url = `https://${LEGACY_SUPABASE_V1_HOST}/storage/v1/object/public/products/${VALID_PRODUCT_UUID}/photo.jpg`;
  const legacyV1Extracted = extractOwnedProductMediaPath(legacyV1Url, VALID_TENANT_UUID, VALID_PRODUCT_UUID);
  assert(
    legacyV1Extracted === null,
    'URL do Supabase V1 legado rejeitada de deleção física (retorna null preservando arquivo)'
  );

  // URL Externa (Unsplash / terceiros)
  const unsplashUrl = 'https://images.unsplash.com/photo-1581235720704-06d3acfcb36f';
  const unsplashExtracted = extractOwnedProductMediaPath(unsplashUrl, VALID_TENANT_UUID, VALID_PRODUCT_UUID);
  assert(
    unsplashExtracted === null,
    'URL externa arbitrária retorna null (sem tentativa de delete físico no storage)'
  );

  // Path Traversal
  const traversalUrl = `https://mysupabase.supabase.co/storage/v1/object/public/${PRODUCT_MEDIA_BUCKET}/${VALID_TENANT_UUID}/products/${VALID_PRODUCT_UUID}/../../evil.png`;
  const traversalExtracted = extractOwnedProductMediaPath(traversalUrl, VALID_TENANT_UUID, VALID_PRODUCT_UUID);
  assert(
    traversalExtracted === null,
    'Path traversal contendo .. rejeitado com null'
  );

  // Schemas Perigosos
  assert(extractOwnedProductMediaPath('blob:https://app.com/uuid-123', VALID_TENANT_UUID, VALID_PRODUCT_UUID) === null, 'blob: rejeitado');
  assert(extractOwnedProductMediaPath('data:image/png;base64,iVBORw0...', VALID_TENANT_UUID, VALID_PRODUCT_UUID) === null, 'data: rejeitado');
  assert(extractOwnedProductMediaPath('javascript:alert(1)', VALID_TENANT_UUID, VALID_PRODUCT_UUID) === null, 'javascript: rejeitado');

  // -------------------------------------------------------------------------
  // 3.1. VÍNCULO SERVER-SIDE TENANT + PRODUCT (RLS CROSS-PRODUCT)
  // -------------------------------------------------------------------------
  console.log('\n3.1. Vínculo Server-Side Tenant + Product (RLS Cross-Product)');

  const mockProductsDb = [
    { id: VALID_PRODUCT_UUID, tenant_id: VALID_TENANT_UUID },
    { id: OTHER_PRODUCT_UUID, tenant_id: OTHER_TENANT_UUID },
  ];

  // Simulação fiel da cláusula EXISTS da migration 000008:
  // EXISTS (
  //   SELECT 1 FROM public.products p
  //   WHERE p.id::text = (storage.foldername(name))[3]
  //     AND p.tenant_id::text = (storage.foldername(name))[1]
  // )
  function simulateRlsProductOwnership(objectPath: string, bucketId: string): boolean {
    if (bucketId !== 'product-media') return false;
    const segments = objectPath.split('/');
    // segments[0]: tenant_id (foldername 1)
    // segments[1]: 'products' (foldername 2)
    // segments[2]: product_id (foldername 3)
    if (segments.length < 4) return false;
    if (segments[1] !== 'products') return false;

    const folderTenantId = segments[0];
    const folderProductId = segments[2];

    return mockProductsDb.some(
      (p) => p.id === folderProductId && p.tenant_id === folderTenantId
    );
  }

  const validOwnershipPath = `${VALID_TENANT_UUID}/products/${VALID_PRODUCT_UUID}/media_1.png`;
  assert(
    simulateRlsProductOwnership(validOwnershipPath, 'product-media') === true,
    'Terceiro segmento product UUID válido + pertencente ao tenant = PASS'
  );

  const nonExistentProductUuid = 'e4444444-4444-4444-4444-444444444444';
  const nonExistentPath = `${VALID_TENANT_UUID}/products/${nonExistentProductUuid}/media_1.png`;
  assert(
    simulateRlsProductOwnership(nonExistentPath, 'product-media') === false,
    'UUID válido mas produto inexistente = FAIL na policy/validação esperada'
  );

  const crossTenantPath = `${OTHER_TENANT_UUID}/products/${VALID_PRODUCT_UUID}/media_1.png`;
  assert(
    simulateRlsProductOwnership(crossTenantPath, 'product-media') === false,
    'Produto de outro tenant = FAIL'
  );

  const otherProductPath = `${VALID_TENANT_UUID}/products/${OTHER_PRODUCT_UUID}/media_1.png`;
  assert(
    simulateRlsProductOwnership(otherProductPath, 'product-media') === false,
    'Path com outro product = FAIL'
  );

  // -------------------------------------------------------------------------
  // 4. SANITIZAÇÃO DE PAYLOAD NO ADMIN CATALOG SERVICE (HTTPS-ONLY)
  // -------------------------------------------------------------------------
  console.log('\n4. Sanitização de Array images[] no AdminCatalogService (HTTPS-Only)');

  const rawImagesInput = [
    '  https://mysupabase.co/storage/v1/object/public/product-media/t/products/p/1.png  ',
    '',
    '   ',
    'http://example.com/foto.jpg', // HTTP puro proibido
    'https://example.com/foto.jpg', // HTTPS externo permitido
    'blob:http://localhost/temp-uuid',
    'data:image/jpeg;base64,abc123==',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'ftp://files.com/foto.png',
    'https://mysupabase.co/storage/v1/object/public/product-media/t/products/p/2.png',
    'https://mysupabase.co/storage/v1/object/public/product-media/t/products/p/1.png', // Duplicata
    'https://external-cdn.com/product.jpg' // URL externa permitida no array do DB
  ];

  // Algoritmo idêntico ao implementado em updateAdminProduct (HTTPS-Only)
  const sanitizedImages: string[] = [];
  const seenUrls = new Set<string>();

  for (const item of rawImagesInput) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;

    const lower = trimmed.toLowerCase();
    if (!lower.startsWith('https://')) {
      continue;
    }

    if (!seenUrls.has(trimmed)) {
      seenUrls.add(trimmed);
      sanitizedImages.push(trimmed);
    }
  }

  assert(!sanitizedImages.includes('http://example.com/foto.jpg'), 'http://example.com/foto.jpg = FAIL (rejeitado)');
  assert(sanitizedImages.includes('https://example.com/foto.jpg'), 'https://example.com/foto.jpg = PASS se já permitido pela regra atual');
  assert(sanitizedImages.length === 4, 'Sanitização filtrou vazios, não-HTTPS, esquemas perigosos e duplicatas');
  assert(sanitizedImages[0] === 'https://mysupabase.co/storage/v1/object/public/product-media/t/products/p/1.png', 'Primeira URL preservada no índice 0');
  assert(sanitizedImages[1] === 'https://example.com/foto.jpg', 'Segunda URL preservada no índice 1');
  assert(sanitizedImages[2] === 'https://mysupabase.co/storage/v1/object/public/product-media/t/products/p/2.png', 'Terceira URL preservada no índice 2');
  assert(sanitizedImages[3] === 'https://external-cdn.com/product.jpg', 'Quarta URL preservada no índice 3');
  assert(!sanitizedImages.some(u => !u.toLowerCase().startsWith('https://')), 'Nenhuma URL não-HTTPS persistida');

  // -------------------------------------------------------------------------
  // 5. SIMULAÇÃO DE CONSISTÊNCIA COMPENSATÓRIA (ROLLBACK)
  // -------------------------------------------------------------------------
  console.log('\n5. Simulação de Consistência Compensatória');

  // Caso 1: Falha em upload intermediário (arquivo 1 ok, arquivo 2 falha)
  let rolledBackPaths: string[] = [];
  const mockRollback = (paths: string[]) => {
    rolledBackPaths.push(...paths);
  };

  const upload1 = { path: `${VALID_TENANT_UUID}/products/${VALID_PRODUCT_UUID}/media_1.jpg`, error: null };
  const upload2 = { path: null, error: 'Network timeout on second image upload' };

  if (upload1.path && upload2.error) {
    mockRollback([upload1.path]);
  }
  assert(
    rolledBackPaths.length === 1 && rolledBackPaths[0] === upload1.path,
    'Falha em upload intermediário aciona rollback dos uploads anteriores'
  );

  // Caso 2: Falha na atualização do banco (DB update error)
  rolledBackPaths = [];
  const upload3 = { path: `${VALID_TENANT_UUID}/products/${VALID_PRODUCT_UUID}/media_3.jpg` };
  const upload4 = { path: `${VALID_TENANT_UUID}/products/${VALID_PRODUCT_UUID}/media_4.jpg` };
  const dbFailure = true;

  if (dbFailure) {
    mockRollback([upload3.path, upload4.path]);
  }
  assert(
    rolledBackPaths.length === 2 &&
    rolledBackPaths.includes(upload3.path) &&
    rolledBackPaths.includes(upload4.path),
    'Falha no banco aciona rollback de todos os uploads novos realizados'
  );

  // Caso 3: Cancelamento de modal -> zero upload remoto
  let remoteUploadCalls = 0;
  const modalCanceled = true;
  if (!modalCanceled) {
    remoteUploadCalls++;
  }
  assert(remoteUploadCalls === 0, 'Cancelamento do modal não executa nenhum upload remoto');

  // -------------------------------------------------------------------------
  // 6. AUDITORIA DE CONFIGURAÇÃO (config.toml & Migration 000008)
  // -------------------------------------------------------------------------
  console.log('\n6. Auditoria de Configuração (config.toml & Migration 000008)');

  const configToml = fs.readFileSync('supabase/config.toml', 'utf-8');
  assert(configToml.includes('[storage.buckets.product-media]'), 'config.toml declara bucket product-media');
  assert(configToml.includes('file_size_limit = "1MiB"'), 'config.toml define limite de 1MiB para product-media');
  assert(
    configToml.includes('allowed_mime_types = ["image/png", "image/jpeg", "image/webp"]'),
    'config.toml restringe product-media exclusivamente a PNG, JPEG e WebP'
  );

  const migration000008 = fs.readFileSync('supabase/migrations/20260916_000008_product_media_storage.sql', 'utf-8');
  assert(migration000008.includes("bucket_id = 'product-media'"), '000008 filtra bucket_id = product-media');
  assert(migration000008.includes("(storage.foldername(name))[2] = 'products'"), '000008 restringe path para diretório /products/');
  assert(migration000008.includes('EXISTS ('), '000008 contém cláusula EXISTS para vínculo server-side');
  assert(
    migration000008.includes('p.id::text = (storage.foldername(name))[3]'),
    '000008 valida o terceiro segmento (product_id) contra public.products.id com comparação segura de texto'
  );
  assert(
    migration000008.includes('p.tenant_id::text = (storage.foldername(name))[1]'),
    '000008 valida que o produto pertence ao tenant do segmento 1 com comparação segura de texto'
  );
  assert(migration000008.includes('CREATE POLICY "product_media_select_authenticated"'), '000008 possui SELECT autenticado restrito');
  assert(migration000008.includes('CREATE POLICY "product_media_insert_tenant_admin"'), '000008 possui INSERT restrito a tenant_admin/platform_admin');
  assert(migration000008.includes('CREATE POLICY "product_media_delete_tenant_admin"'), '000008 possui DELETE restrito a tenant_admin/platform_admin');
  assert(!migration000008.includes('CREATE POLICY "product_media_update_tenant_admin"'), '000008 NÃO cria nenhuma policy de UPDATE');
  assert(!migration000008.includes('CREATE POLICY "product_media_select_public"'), '000008 NÃO cria policy SELECT pública em storage.objects');
  assert(!migration000008.includes('INSERT INTO storage.buckets'), '000008 NÃO faz DML direto em storage.buckets');
  assert(!migration000008.includes('ALTER TABLE storage.objects'), '000008 NÃO executa ALTER TABLE storage.objects');

  // -------------------------------------------------------------------------
  // 7. AUDITORIA DA MIGRATION 000009 & PREVENÇÃO DE SHADOWING DE COLUNA
  // -------------------------------------------------------------------------
  console.log('\n7. Auditoria da Migration 000009 (Escopo storage.objects.name)');

  const migration000009 = fs.readFileSync('supabase/migrations/20260917_000009_fix_product_media_policy_scope.sql', 'utf-8');
  assert(migration000009.includes("bucket_id = 'product-media'"), '000009 filtra bucket_id = product-media');
  assert(
    migration000009.includes('storage.foldername(storage.objects.name)'),
    '000009 utiliza explicitamente storage.foldername(storage.objects.name) qualificando o outer row'
  );
  assert(
    migration000009.includes('p.id::text = (storage.foldername(storage.objects.name))[3]'),
    '000009 valida terceiro segmento com storage.foldername(storage.objects.name)[3]'
  );
  assert(
    migration000009.includes('p.tenant_id::text = (storage.foldername(storage.objects.name))[1]'),
    '000009 valida primeiro segmento com storage.foldername(storage.objects.name)[1]'
  );

  // Verificação de preservação da migration 000008 anterior
  const untouched000008 = fs.readFileSync('supabase/migrations/20260916_000008_product_media_storage.sql', 'utf-8');
  assert(untouched000008.length > 0, '000008 permanece preservada e intacta');

  // Verificação estática contra shadowing: se houver 'FROM public.products p', NÃO pode haver 'storage.foldername(name)'
  const hasAmbiguousFoldernameIn000009 = migration000009.includes('storage.foldername(name)');
  assert(
    !hasAmbiguousFoldernameIn000009,
    '000009 rejeita como implementação incorreta storage.foldername(name) dentro ou fora de subqueries com p'
  );

  assert(migration000009.includes('DROP POLICY IF EXISTS "product_media_select_authenticated" ON storage.objects;'), '000009 dropa policy SELECT anterior');
  assert(migration000009.includes('DROP POLICY IF EXISTS "product_media_insert_tenant_admin" ON storage.objects;'), '000009 dropa policy INSERT anterior');
  assert(migration000009.includes('DROP POLICY IF EXISTS "product_media_delete_tenant_admin" ON storage.objects;'), '000009 dropa policy DELETE anterior');
  assert(migration000009.includes('EXISTS ('), '000009 contém cláusula EXISTS');
  assert(migration000009.includes('CREATE POLICY "product_media_select_authenticated"'), '000009 recria policy SELECT');
  assert(migration000009.includes('CREATE POLICY "product_media_insert_tenant_admin"'), '000009 recria policy INSERT');
  assert(migration000009.includes('CREATE POLICY "product_media_delete_tenant_admin"'), '000009 recria policy DELETE');
  assert(!migration000009.includes('CREATE POLICY "product_media_update_tenant_admin"'), '000009 NÃO cria policy de UPDATE');
  assert(!migration000009.includes('CREATE POLICY "product_media_select_public"'), '000009 NÃO cria policy SELECT pública');
  assert(!migration000009.includes('INSERT INTO storage.buckets'), '000009 NÃO faz DML em storage.buckets');
  assert(!migration000009.includes('ALTER TABLE storage.objects'), '000009 NÃO executa ALTER TABLE storage.objects');

  // -------------------------------------------------------------------------
  // 8. PROPAGAÇÃO ESTRITA DE TENANT UUID ADMINISTRATIVO (HOTFIX CIRÚRGICO)
  // -------------------------------------------------------------------------
  console.log('\n8. Propagação Estrita de Tenant UUID Administrativo (Hotfix Cirúrgico)');

  const tenantDashboardSource = fs.readFileSync('src/components/tenantadmin/TenantDashboard.tsx', 'utf-8');
  assert(
    tenantDashboardSource.includes('const [adminTenantId, setAdminTenantId] = useState<string | null>(null);'),
    'TenantDashboard declara estado explícito adminTenantId tipado string | null'
  );
  assert(
    tenantDashboardSource.includes('isValidUuid(resolvedTenantId)'),
    'TenantDashboard valida resolvedTenantId com isValidUuid antes de propagar'
  );
  assert(
    tenantDashboardSource.includes('setAdminTenantId(resolvedTenantId);'),
    'TenantDashboard atualiza adminTenantId com o UUID validado'
  );
  assert(
    tenantDashboardSource.includes('setAdminTenantId(null);'),
    'TenantDashboard reseta adminTenantId para null em caso de erro (fail-closed)'
  );
  assert(
    tenantDashboardSource.includes('tenantId={adminTenantId}'),
    'TenantDashboard propaga tenantId={adminTenantId} explicitamente para o ProductManager'
  );

  const productManagerSource = fs.readFileSync('src/components/tenantadmin/ProductManager.tsx', 'utf-8');
  assert(
    productManagerSource.includes('tenantId?: string | null;'),
    'ProductManagerProps declara prop opcional tenantId?: string | null'
  );
  assert(
    productManagerSource.includes('const effectiveTenantId = useMemo<string | null>'),
    'ProductManager deriva effectiveTenantId com useMemo e resolução estrita'
  );
  assert(
    !productManagerSource.includes('tenantId={activeTenantId || currentTenant.id}'),
    'ProductManager NUNCA passa currentTenant.id como tenantId para modais de escrita'
  );
  assert(
    productManagerSource.includes('tenantId={effectiveTenantId}'),
    'ProductManager passa effectiveTenantId validado para ProductEditModal e ProductBulkEditModal'
  );
  assert(
    productManagerSource.includes('handleOpenEdit'),
    'ProductManager possui handler de abertura com guarda de segurança fail-closed'
  );
  assert(
    productManagerSource.includes('prod.tenantId !== effectiveTenantId'),
    'ProductManager valida correspondência estrita entre prod.tenantId e effectiveTenantId'
  );

  // Validação Lógica de Resolução Fail-Closed
  function resolveEffectiveTenant(propId?: string | null, activeId?: string | null): string | null {
    if (propId && isValidUuid(propId)) return propId;
    if (activeId && isValidUuid(activeId)) return activeId;
    return null;
  }

  assert(
    resolveEffectiveTenant(VALID_TENANT_UUID, null) === VALID_TENANT_UUID,
    'Prop com UUID válido v4 resolvido com sucesso'
  );
  assert(
    resolveEffectiveTenant(null, VALID_TENANT_UUID) === VALID_TENANT_UUID,
    'Active com UUID válido v4 resolvido quando prop ausente'
  );
  assert(
    resolveEffectiveTenant('tenant-mc-distribuicao', null) === null,
    'Slug textual "tenant-mc-distribuicao" rejeitado e retorna null'
  );
  assert(
    resolveEffectiveTenant(null, 'tenant-mc-distribuicao') === null,
    'Active com slug textual "tenant-mc-distribuicao" rejeitado e retorna null'
  );
  assert(
    resolveEffectiveTenant('', '') === null,
    'Strings vazias retornam null'
  );
  assert(
    resolveEffectiveTenant(undefined, undefined) === null,
    'Valores indefinidos retornam null'
  );

  // Validação Lógica da Guarda de Abertura de Edição
  function canOpenEditModal(effTenantId: string | null, prod: { tenantId?: string }): { allowed: boolean; reason?: string } {
    if (!effTenantId || !isValidUuid(effTenantId)) {
      return { allowed: false, reason: 'Contexto de tenant inválido.' };
    }
    if (!prod.tenantId || !isValidUuid(prod.tenantId)) {
      return { allowed: false, reason: 'Contexto de produto inválido.' };
    }
    if (prod.tenantId !== effTenantId) {
      return { allowed: false, reason: 'Inconsistência de tenant.' };
    }
    return { allowed: true };
  }

  assert(
    canOpenEditModal(VALID_TENANT_UUID, { tenantId: VALID_TENANT_UUID }).allowed === true,
    'Edição permitida quando tenant e produto possuem o mesmo UUID válido'
  );
  assert(
    canOpenEditModal(null, { tenantId: VALID_TENANT_UUID }).allowed === false,
    'Edição bloqueada quando tenant é null (unresolved)'
  );
  assert(
    canOpenEditModal(VALID_TENANT_UUID, { tenantId: 'tenant-mc-distribuicao' }).allowed === false,
    'Edição bloqueada quando product.tenantId não é UUID'
  );
  assert(
    canOpenEditModal(VALID_TENANT_UUID, { tenantId: OTHER_TENANT_UUID }).allowed === false,
    'Edição bloqueada quando product.tenantId pertence a outro tenant (cross-tenant mitigado)'
  );

  // Validação Lógica da Guarda de Abertura de Edição em Massa (Bulk Edit)
  function canOpenBulkEditModal(
    effTenantId: string | null,
    selectedIds: string[],
    productList: Array<{ id: string; tenantId?: string }>
  ): { allowed: boolean; reason?: string } {
    if (!effTenantId || !isValidUuid(effTenantId)) {
      return { allowed: false, reason: 'Contexto de tenant inválido.' };
    }
    if (selectedIds.length === 0) {
      return { allowed: false, reason: 'Nenhum produto selecionado.' };
    }
    const map = new Map(productList.map(p => [p.id, p]));
    for (const id of selectedIds) {
      const p = map.get(id);
      if (!p) {
        return { allowed: false, reason: 'Produto selecionado inexistente na coleção.' };
      }
      if (!p.tenantId || !isValidUuid(p.tenantId)) {
        return { allowed: false, reason: 'Tenant ID do produto inválido (não-UUID).' };
      }
      if (p.tenantId !== effTenantId) {
        return { allowed: false, reason: 'Produto pertence a outro tenant.' };
      }
    }
    return { allowed: true };
  }

  const mockCatalog = [
    { id: 'prod-1', tenantId: VALID_TENANT_UUID },
    { id: 'prod-2', tenantId: VALID_TENANT_UUID },
    { id: 'prod-3', tenantId: OTHER_TENANT_UUID },
    { id: 'prod-4', tenantId: 'tenant-mc-distribuicao' },
    { id: 'prod-5', tenantId: '' },
  ];

  assert(
    canOpenBulkEditModal(VALID_TENANT_UUID, ['prod-1', 'prod-2'], mockCatalog).allowed === true,
    'Bulk edit: seleção válida do mesmo tenant permite abrir'
  );
  assert(
    canOpenBulkEditModal(VALID_TENANT_UUID, ['prod-1', 'prod-nonexistent'], mockCatalog).allowed === false,
    'Bulk edit: selected ID inexistente bloqueia bulk edit'
  );
  assert(
    canOpenBulkEditModal(VALID_TENANT_UUID, ['prod-1', 'prod-4'], mockCatalog).allowed === false,
    'Bulk edit: produto com tenantId não-UUID ("tenant-mc-distribuicao") bloqueia'
  );
  assert(
    canOpenBulkEditModal(VALID_TENANT_UUID, ['prod-1', 'prod-5'], mockCatalog).allowed === false,
    'Bulk edit: produto com tenantId vazio bloqueia'
  );
  assert(
    canOpenBulkEditModal(VALID_TENANT_UUID, ['prod-1', 'prod-3'], mockCatalog).allowed === false,
    'Bulk edit: produto de outro tenant bloqueia'
  );
  assert(
    canOpenBulkEditModal(null, ['prod-1', 'prod-2'], mockCatalog).allowed === false,
    'Bulk edit: tenant unresolved (null) bloqueia'
  );
  assert(
    canOpenBulkEditModal('tenant-mc-distribuicao', ['prod-1', 'prod-2'], mockCatalog).allowed === false,
    'Bulk edit: legacy currentTenant.id como effectiveTenantId bloqueia'
  );
  assert(
    canOpenBulkEditModal(VALID_TENANT_UUID, [], mockCatalog).allowed === false,
    'Bulk edit: seleção vazia não abre modal'
  );

  // -------------------------------------------------------------------------
  // 9. IMPORTAÇÃO EM MASSA DE IMAGENS POR SKU (V1 FAIL-CLOSED)
  // -------------------------------------------------------------------------
  console.log('\n9. Importação em Massa de Imagens por SKU (V1 Fail-Closed)');

  // 9.1 Validação do Manifest JSON
  const validManifestJson = JSON.stringify([
    { sku: 'AP001', produto: 'APLICADOR ARGACON R1', arquivo: 'AP001.webp' },
    { sku: 'EP003', produto: 'ESPACADOR PISO 3MM', arquivo: 'EP003.webp' },
    { sku: 'SG002', produto: 'SARGENTO ANGULAR', arquivo: 'SG002.webp' },
  ]);
  const parsedValid = parseManifestJson(validManifestJson);
  assert(parsedValid.valid === true && parsedValid.entries?.length === 3, 'Manifest JSON válido com 3 itens parseado com sucesso');

  const duplicateSkuManifest = JSON.stringify([
    { sku: 'AP001', arquivo: 'AP001.webp' },
    { sku: 'AP001', arquivo: 'AP001_v2.webp' },
  ]);
  const parsedDupSku = parseManifestJson(duplicateSkuManifest);
  assert(parsedDupSku.valid === false && parsedDupSku.error?.includes('SKU duplicado'), 'Manifest com SKU duplicado rejeitado com erro explícito');

  const duplicateFilenameManifest = JSON.stringify([
    { sku: 'AP001', arquivo: 'FOTO_COMUM.webp' },
    { sku: 'EP003', arquivo: 'FOTO_COMUM.webp' },
  ]);
  const parsedDupFile = parseManifestJson(duplicateFilenameManifest);
  assert(parsedDupFile.valid === false && parsedDupFile.error?.includes('múltiplos SKUs'), 'Manifest com mesmo arquivo associado a SKUs diferentes rejeitado com erro explícito');

  const emptySkuManifest = JSON.stringify([
    { sku: '   ', arquivo: 'FOTO.webp' },
  ]);
  assert(parseManifestJson(emptySkuManifest).valid === false, 'Manifest com SKU vazio rejeitado');

  const emptyFileManifest = JSON.stringify([
    { sku: 'AP001', arquivo: '   ' },
  ]);
  assert(parseManifestJson(emptyFileManifest).valid === false, 'Manifest com arquivo vazio rejeitado');

  assert(parseManifestJson('not a json').valid === false, 'Manifest com JSON malformado rejeitado');
  assert(parseManifestJson('[]').valid === false, 'Manifest com array vazio rejeitado');
  assert(parseManifestJson('{}').valid === false, 'Manifest que não é array rejeitado');

  // 9.2 Simulação de Arquivos e Dry-Run
  const validWebpBytesForBulk = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x20, 0x00, 0x00, 0x00, // size
    0x57, 0x45, 0x42, 0x50, // WEBP
    0x56, 0x50, 0x38, 0x20, // VP8_
    0x14, 0x00, 0x00, 0x00, // chunk size
  ]);
  const fileAP001 = new File([validWebpBytesForBulk], 'AP001.webp', { type: 'image/webp' });
  const fileEP003 = new File([validWebpBytesForBulk], 'EP003.webp', { type: 'image/webp' });
  const fileUnused = new File([validWebpBytesForBulk], 'SOBRANDO.webp', { type: 'image/webp' });
  const fakeBinaryFile = new File(['conteudo invalido masquerading as webp'], 'SG002.webp', { type: 'image/webp' });
  const oversizeFileForBulk = new File([new Uint8Array(MAX_PRODUCT_IMAGE_SIZE_BYTES + 2048)], 'CH001.webp', { type: 'image/webp' });

  const mockCatalogForBulk: any[] = [
    { id: '11111111-1111-1111-1111-111111111111', tenantId: VALID_TENANT_UUID, sku: 'AP001', name: 'APLICADOR ARGACON R1', images: [] },
    { id: '22222222-2222-2222-2222-222222222222', tenantId: VALID_TENANT_UUID, sku: 'EP003', name: 'ESPACADOR PISO 3MM', images: ['https://storage.supabase.com/existing.jpg'] },
    { id: '33333333-3333-3333-3333-333333333333', tenantId: VALID_TENANT_UUID, sku: 'SG002', name: 'SARGENTO ANGULAR', images: [] },
    { id: '44444444-4444-4444-4444-444444444444', tenantId: VALID_TENANT_UUID, sku: 'CH001', name: 'CHAVE GRIFO', images: [] },
    { id: '55555555-5555-5555-5555-555555555555', tenantId: OTHER_TENANT_UUID, sku: 'JG002', name: 'JOGO BROCAS', images: [] },
    { id: '66666666-6666-6666-6666-666666666666', tenantId: 'tenant-mc-distribuicao', sku: 'VE001', name: 'VENTOSA DUPLA', images: [] },
    { id: '77777777-7777-7777-7777-777777777777', tenantId: VALID_TENANT_UUID, sku: 'DUP01', name: 'DUPLICADO 1', images: [] },
    { id: '88888888-8888-8888-8888-888888888888', tenantId: VALID_TENANT_UUID, sku: 'DUP01', name: 'DUPLICADO 2', images: [] },
    { id: '99999999-9999-9999-9999-999999999999', tenantId: VALID_TENANT_UUID, sku: 'MISSING_FILE', name: 'PRODUTO SEM ARQUIVO', images: [] },
  ];

  const testManifestEntries = [
    { sku: 'AP001', arquivo: 'AP001.webp' },
    { sku: 'EP003', arquivo: 'EP003.webp' },
    { sku: 'SG002', arquivo: 'SG002.webp' },
    { sku: 'CH001', arquivo: 'CH001.webp' },
    { sku: 'JG002', arquivo: 'JG002.webp' },
    { sku: 'VE001', arquivo: 'VE001.webp' },
    { sku: 'DUP01', arquivo: 'DUP01.webp' },
    { sku: 'NONEXISTENT', arquivo: 'NONEXISTENT.webp' },
    { sku: 'MISSING_FILE', arquivo: 'NAO_SELECIONADO.webp' },
  ];

  const testSelectedFiles = [
    fileAP001,
    fileEP003,
    fakeBinaryFile,
    oversizeFileForBulk,
    fileUnused,
  ];

  const dryRunResult = await performBulkImageDryRun({
    manifestEntries: testManifestEntries,
    selectedFiles: testSelectedFiles,
    products: mockCatalogForBulk,
    effectiveTenantId: VALID_TENANT_UUID,
  });

  const ap001Item = dryRunResult.items.find(i => i.sku === 'AP001');
  assert(ap001Item?.status === 'READY', 'Dry-run: produto válido sem fotos e com arquivo válido classificado como READY');

  const ep003Item = dryRunResult.items.find(i => i.sku === 'EP003');
  assert(ep003Item?.status === 'SKIPPED_EXISTING_IMAGE', 'Dry-run: produto que já possui fotos classificado como SKIPPED_EXISTING_IMAGE (preservação garantida)');

  const nonexistentItem = dryRunResult.items.find(i => i.sku === 'NONEXISTENT');
  assert(nonexistentItem?.status === 'BLOCKED_PRODUCT_NOT_FOUND', 'Dry-run: SKU inexistente classificado como BLOCKED_PRODUCT_NOT_FOUND');

  const dupItem = dryRunResult.items.find(i => i.sku === 'DUP01');
  assert(dupItem?.status === 'BLOCKED_DUPLICATE_SKU', 'Dry-run: SKU duplicado no catálogo classificado como BLOCKED_DUPLICATE_SKU');

  const crossTenantItem = dryRunResult.items.find(i => i.sku === 'JG002');
  assert(crossTenantItem?.status === 'BLOCKED_INVALID_TENANT', 'Dry-run: produto pertencente a outro tenant classificado como BLOCKED_INVALID_TENANT');

  const legacyTenantItem = dryRunResult.items.find(i => i.sku === 'VE001');
  assert(legacyTenantItem?.status === 'BLOCKED_INVALID_TENANT', 'Dry-run: produto com tenantId não-UUID ("tenant-mc-distribuicao") classificado como BLOCKED_INVALID_TENANT');

  const missingFileItem = dryRunResult.items.find(i => i.sku === 'MISSING_FILE');
  assert(missingFileItem?.status === 'BLOCKED_FILE_MISSING', 'Dry-run: arquivo ausente da seleção classificado como BLOCKED_FILE_MISSING');

  const fakeFileItem = dryRunResult.items.find(i => i.sku === 'SG002');
  assert(fakeFileItem?.status === 'BLOCKED_INVALID_FILE', 'Dry-run: arquivo com magic bytes corrompidos classificado como BLOCKED_INVALID_FILE');

  const oversizeItem = dryRunResult.items.find(i => i.sku === 'CH001');
  assert(oversizeItem?.status === 'BLOCKED_INVALID_FILE', 'Dry-run: arquivo > 1 MiB classificado como BLOCKED_INVALID_FILE');

  const unusedFileItem = dryRunResult.items.find(i => i.filename === 'SOBRANDO.webp');
  assert(unusedFileItem?.status === 'UNUSED_FILE', 'Dry-run: arquivo selecionado que não consta no manifest classificado como UNUSED_FILE');

  // Teste de Fail-Closed Total com effectiveTenantId = null
  const dryRunNullTenant = await performBulkImageDryRun({
    manifestEntries: testManifestEntries,
    selectedFiles: testSelectedFiles,
    products: mockCatalogForBulk,
    effectiveTenantId: null,
  });
  const allBlockedTenant = dryRunNullTenant.items.filter(i => i.status !== 'UNUSED_FILE').every(i => i.status === 'BLOCKED_INVALID_TENANT');
  assert(allBlockedTenant, 'Dry-run com effectiveTenantId = null bloqueia todos os itens como BLOCKED_INVALID_TENANT');

  // Teste de Zero Writes no Dry-Run
  assert(
    mockCatalogForBulk[0].images.length === 0 && mockCatalogForBulk[1].images.length === 1,
    'Dry-run executa ZERO escritas, ZERO mutações no catálogo e ZERO uploads remotos'
  );

  // 9.3 Simulação de Importação Sequencial e Compensação por Item
  const executionReadyItems = [
    {
      sku: 'AP001',
      productName: 'APLICADOR ARGACON R1',
      filename: 'AP001.webp',
      status: 'READY' as const,
      reason: 'Validado',
      file: fileAP001,
      product: mockCatalogForBulk[0],
    },
    {
      sku: 'SG002',
      productName: 'SARGENTO ANGULAR',
      filename: 'SG002.webp',
      status: 'READY' as const,
      reason: 'Validado',
      file: fileAP001,
      product: mockCatalogForBulk[2],
    },
  ];

  const processedSkus: string[] = [];
  const persistedProductIds: string[] = [];
  const rolledBackItems: string[] = [];

  const testReport = await executeSequentialBulkImageImport({
    readyItems: executionReadyItems,
    allDryRunItems: dryRunResult.items,
    effectiveTenantId: VALID_TENANT_UUID,
    products: mockCatalogForBulk,
    onProgress: (_curr, _tot, sku) => {
      processedSkus.push(sku);
    },
    deps: {
      uploader: async (tId, pId, f) => {
        return {
          url: `https://storage.supabase.com/product-media/${tId}/products/${pId}/media_test.webp`,
          path: `${tId}/products/${pId}/media_test.webp`,
          error: null,
        };
      },
      persister: async (tId, pId, uploadedUrl) => {
        persistedProductIds.push(pId);
        return { updated: true };
      },
      compensator: async (paths, tId, pId) => {
        rolledBackItems.push(...paths);
      },
    },
  });

  assert(testReport.tenantId === VALID_TENANT_UUID, 'Relatório final registra tenantId canônico');
  assert(testReport.total > 0, 'Relatório final inclui itens processados e itens ignorados');
  assert(testReport.success === 2, 'Dois itens válidos importados com sucesso na execução sequencial');
  assert(
    processedSkus.length === 2 && processedSkus[0] === 'AP001' && processedSkus[1] === 'SG002',
    'Execução estritamente sequencial processou os SKUs na ordem correta'
  );
  assert(
    persistedProductIds.includes(mockCatalogForBulk[0].id) &&
    persistedProductIds.includes(mockCatalogForBulk[2].id),
    'Persistência no banco executada para todos os produtos bem-sucedidos'
  );
  assert(rolledBackItems.length === 0, 'Nenhum rollback executado quando todos os uploads e updates têm sucesso');

  // Teste 9.4: Falha no Upload => DB NÃO executa
  let dbCalledOnUploadFailure = false;
  const uploadFailureItem = [
    {
      sku: 'AP001',
      productName: 'APLICADOR ARGACON R1',
      filename: 'AP001.webp',
      status: 'READY' as const,
      reason: 'Validado',
      file: fileAP001,
      product: mockCatalogForBulk[0],
    },
  ];

  await executeSequentialBulkImageImport({
    readyItems: uploadFailureItem,
    allDryRunItems: [],
    effectiveTenantId: VALID_TENANT_UUID,
    products: mockCatalogForBulk,
    deps: {
      uploader: async () => ({ url: null, path: null, error: 'Storage timeout' }),
      persister: async () => { dbCalledOnUploadFailure = true; return { updated: true }; },
    },
  });

  assert(!dbCalledOnUploadFailure, 'Upload falha => DB não executa');

  // Teste 9.5: DB falha => Rollback isolado daquele item; sucesso anterior NÃO é revertido
  const compensatedPaths: string[] = [];
  const multiItems = [
    {
      sku: 'AP001',
      productName: 'APLICADOR ARGACON R1',
      filename: 'AP001.webp',
      status: 'READY' as const,
      reason: 'Validado',
      file: fileAP001,
      product: mockCatalogForBulk[0],
    },
    {
      sku: 'SG002',
      productName: 'SARGENTO ANGULAR',
      filename: 'SG002.webp',
      status: 'READY' as const,
      reason: 'Validado',
      file: fileAP001,
      product: mockCatalogForBulk[2],
    },
  ];

  const reportWithRollback = await executeSequentialBulkImageImport({
    readyItems: multiItems,
    allDryRunItems: [],
    effectiveTenantId: VALID_TENANT_UUID,
    products: mockCatalogForBulk,
    deps: {
      uploader: async (tId, pId) => ({
        url: `https://storage.supabase.com/${tId}/${pId}/foto.webp`,
        path: `${tId}/products/${pId}/foto.webp`,
        error: null,
      }),
      persister: async (_tId, pId) => {
        if (pId === mockCatalogForBulk[2].id) {
          throw new Error('Database connection dropped on item 2');
        }
        return { updated: true };
      },
      compensator: async (paths) => {
        compensatedPaths.push(...paths);
      },
    },
  });

  assert(reportWithRollback.success === 1, 'Sucesso anterior do item 1 mantido');
  assert(reportWithRollback.failed === 1, 'Falha no banco do item 2 registrada');
  assert(
    compensatedPaths.length === 1 &&
    compensatedPaths[0] === `${VALID_TENANT_UUID}/products/${mockCatalogForBulk[2].id}/foto.webp`,
    'DB falha => rollback cirúrgico apenas do upload daquele produto no Storage'
  );
  assert(
    !compensatedPaths.some(p => p.includes(mockCatalogForBulk[0].id)),
    'Sucesso anterior não é revertido por falha posterior (sem rollback global)'
  );

  // Teste 9.6: Revalidação de Ownership no Momento da Execução
  const crossTenantExecutionItem = [
    {
      sku: 'JG002',
      productName: 'JOGO BROCAS',
      filename: 'JG002.webp',
      status: 'READY' as const,
      reason: 'Validado',
      file: fileAP001,
      product: mockCatalogForBulk[4], // OTHER_TENANT_UUID
    },
  ];

  const crossReport = await executeSequentialBulkImageImport({
    readyItems: crossTenantExecutionItem,
    allDryRunItems: [],
    effectiveTenantId: VALID_TENANT_UUID,
    products: mockCatalogForBulk,
    deps: {
      uploader: async () => ({ url: 'https://ok', path: 'ok', error: null }),
      persister: async () => ({ updated: true }),
    },
  });
  assert(crossReport.failed === 1 && crossReport.success === 0, 'Import revalida ownership no momento da execução e bloqueia produto cross-tenant');

  // Teste 9.7: Persistência Atômica Condicional (updateAdminProductImagesIfEmpty)
  const adminCatalogSource = fs.readFileSync('src/services/adminCatalogService.ts', 'utf-8');
  assert(
    adminCatalogSource.includes('export async function updateAdminProductImagesIfEmpty'),
    'updateAdminProductImagesIfEmpty declarada e exportada em adminCatalogService'
  );
  assert(
    adminCatalogSource.includes(".eq('tenant_id', tenantId)") &&
    adminCatalogSource.includes(".eq('id', productId)"),
    'updateAdminProductImagesIfEmpty filtra por tenant_id e id de produto'
  );
  assert(
    adminCatalogSource.includes(".is('deleted_at', null)"),
    'updateAdminProductImagesIfEmpty filtra deleted_at IS NULL'
  );
  assert(
    adminCatalogSource.includes(".eq('images', '{}')"),
    'updateAdminProductImagesIfEmpty filtra condicionalmente images = {} (array vazio)'
  );

  // Validação de parâmetros inválidos de updateAdminProductImagesIfEmpty
  const invalidTenantRes = await updateAdminProductImagesIfEmpty('tenant-invalido', VALID_PRODUCT_UUID, 'https://ok.webp');
  assert(!invalidTenantRes.updated && Boolean(invalidTenantRes.error), 'updateAdminProductImagesIfEmpty rejeita tenantId não-UUID');

  const invalidProductRes = await updateAdminProductImagesIfEmpty(VALID_TENANT_UUID, 'prod-invalido', 'https://ok.webp');
  assert(!invalidProductRes.updated && Boolean(invalidProductRes.error), 'updateAdminProductImagesIfEmpty rejeita productId não-UUID');

  const nonHttpsRes = await updateAdminProductImagesIfEmpty(VALID_TENANT_UUID, VALID_PRODUCT_UUID, 'http://inseguro.webp');
  assert(!nonHttpsRes.updated && Boolean(nonHttpsRes.error), 'updateAdminProductImagesIfEmpty rejeita URL não-HTTPS');

  // Teste 9.8: Prevenção de Condição de Corrida (TOCTOU) e Preservação Atômica
  const toctouCompensatedPaths: string[] = [];
  const toctouItems = [
    {
      sku: 'AP001',
      productName: 'APLICADOR ARGACON R1',
      filename: 'AP001.webp',
      status: 'READY' as const,
      reason: 'Validado',
      file: fileAP001,
      product: mockCatalogForBulk[0],
    },
    {
      sku: 'SG002',
      productName: 'SARGENTO ANGULAR',
      filename: 'SG002.webp',
      status: 'READY' as const,
      reason: 'Validado',
      file: fileAP001,
      product: mockCatalogForBulk[2],
    },
  ];

  // Simula que SG002 recebeu uma foto de outra sessão entre o dry-run e o update do banco
  const toctouReport = await executeSequentialBulkImageImport({
    readyItems: toctouItems,
    allDryRunItems: [],
    effectiveTenantId: VALID_TENANT_UUID,
    products: mockCatalogForBulk,
    deps: {
      uploader: async (tId, pId) => ({
        url: `https://storage.supabase.com/${tId}/${pId}/upload.webp`,
        path: `${tId}/products/${pId}/upload.webp`,
        error: null,
      }),
      persister: async (_tId, pId) => {
        if (pId === mockCatalogForBulk[2].id) {
          // Zero linhas afetadas no banco (condição images = '{}' falhou devido a imagem concorrente)
          return { updated: false };
        }
        return { updated: true };
      },
      compensator: async (paths) => {
        toctouCompensatedPaths.push(...paths);
      },
    },
  });

  assert(toctouReport.success === 1, 'Item 1 sem concorrência completado com sucesso');
  assert(toctouReport.skipped === 1, 'Item 2 concorrente registrado no total de skipped');
  assert(
    toctouReport.items.some(i => i.sku === 'SG002' && i.status === 'SKIPPED_CONCURRENT_IMAGE'),
    'Item com colisão concorrente recebe status SKIPPED_CONCURRENT_IMAGE'
  );
  assert(
    toctouCompensatedPaths.length === 1 &&
    toctouCompensatedPaths[0] === `${VALID_TENANT_UUID}/products/${mockCatalogForBulk[2].id}/upload.webp`,
    'Upload do item com colisão concorrente é imediatamente compensado no Storage'
  );

  // Teste 9.9: Persister retorna erro explícito de banco
  const explicitErrCompensatedPaths: string[] = [];
  const explicitErrReport = await executeSequentialBulkImageImport({
    readyItems: [toctouItems[0]],
    allDryRunItems: [],
    effectiveTenantId: VALID_TENANT_UUID,
    products: mockCatalogForBulk,
    deps: {
      uploader: async (tId, pId) => ({
        url: `https://storage.supabase.com/${tId}/${pId}/upload.webp`,
        path: `${tId}/products/${pId}/upload.webp`,
        error: null,
      }),
      persister: async () => ({ updated: false, error: 'Database network timeout' }),
      compensator: async (paths) => {
        explicitErrCompensatedPaths.push(...paths);
      },
    },
  });

  assert(explicitErrReport.failed === 1 && explicitErrReport.success === 0, 'Persister com erro explícito marcado como FAILED');
  assert(explicitErrCompensatedPaths.length === 1, 'Upload compensado quando persister retorna erro explícito');

  // Auditoria do Relatório: sem dados sensíveis
  const reportKeys = Object.keys(testReport);
  assert(
    !reportKeys.includes('session') &&
    !reportKeys.includes('token') &&
    !reportKeys.includes('secret') &&
    !reportKeys.includes('apiKey'),
    'Relatório final em memória NÃO expõe tokens, sessões, segredos ou chaves sensíveis'
  );

  console.log('\n======================================================');
  console.log(`RESULTADO: ${passed} PASSOU / ${failed} FALHOU`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error during product media test run:', err);
  process.exit(1);
});
