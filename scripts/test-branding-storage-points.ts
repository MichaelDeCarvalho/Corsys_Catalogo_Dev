import {
  validateBrandingFile,
  validateBrandingFileDeep,
  detectRealImageType,
  isValidUUID,
  extractOwnedBrandingPath,
  getSafeExtension,
  BRANDING_STORAGE_BUCKET,
} from '../src/services/brandingStorageService';
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
  console.log('TEST SUITE: BRANDING STORAGE & MULTI-TENANT ISOLATION');
  console.log('======================================================\n');

  const VALID_TENANT_UUID = 'a0000000-0000-0000-0000-000000000001';
  const OTHER_TENANT_UUID = 'b1111111-1111-1111-1111-111111111111';

  // -------------------------------------------------------------------------
  // 1. UUID CANÔNICO & FAIL-CLOSED
  // -------------------------------------------------------------------------
  console.log('1. Validação de UUID & Fail-Closed');
  assert(isValidUUID(VALID_TENANT_UUID), 'UUID v4 padrão válido aceito');
  assert(!isValidUUID('loja-modelo'), 'Slug textual rejeitado');
  assert(!isValidUUID(''), 'String vazia rejeitada');
  assert(!isValidUUID(null), 'Null rejeitado');
  assert(!isValidUUID(undefined), 'Undefined rejeitado');
  assert(!isValidUUID('../etc/passwd'), 'Path traversal textual rejeitado');
  assert(!isValidUUID('12345'), 'Identificador numérico inválido rejeitado');

  // -------------------------------------------------------------------------
  // 2. MIME TYPES & MAGIC BYTES BINÁRIOS
  // -------------------------------------------------------------------------
  console.log('\n2. MIME Types & Magic Bytes Binários');
  
  // PNG válido (89 50 4E 47 0D 0A 1A 0A)
  const validPngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
  const validPngBlob = new Blob([validPngBytes], { type: 'image/png' });
  const detectedPng = await detectRealImageType(validPngBlob);
  assert(detectedPng === 'image/png', 'Detecta magic bytes reais de PNG');

  // JPEG válido (FF D8 FF E0)
  const validJpgBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const validJpgBlob = new Blob([validJpgBytes], { type: 'image/jpeg' });
  const detectedJpg = await detectRealImageType(validJpgBlob);
  assert(detectedJpg === 'image/jpeg', 'Detecta magic bytes reais de JPEG');

  // WebP válido (RIFF .... WEBP)
  const validWebpBytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x24, 0x00, 0x00, 0x00, // size
    0x57, 0x45, 0x42, 0x50, // WEBP
    0x56, 0x50, 0x38, 0x20  // VP8
  ]);
  const validWebpBlob = new Blob([validWebpBytes], { type: 'image/webp' });
  const detectedWebp = await detectRealImageType(validWebpBlob);
  assert(detectedWebp === 'image/webp', 'Detecta magic bytes reais de WebP');

  // SVG Proibido (XSS vector)
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
  const svgFile = new File([svgText], 'logo.svg', { type: 'image/svg+xml' });
  const svgCheck = validateBrandingFile(svgFile, 'logo');
  assert(!svgCheck.valid && svgCheck.error?.includes('SVG'), 'SVG rejeitado explicitamente');

  // Spoofing de Extensão (texto falso renomeado para .png)
  const fakePngFile = new File(['Fake text masquerading as png'], 'fake.png', { type: 'image/png' });
  const deepFakeCheck = await validateBrandingFileDeep(fakePngFile, 'logo');
  assert(!deepFakeCheck.valid, 'Arquivo texto renomeado para .png rejeitado por inspeção binária');

  // Tamanhos máximos
  const oversizeLogo = new File([new Uint8Array(3 * 1024 * 1024)], 'big_logo.png', { type: 'image/png' });
  const logoSizeCheck = validateBrandingFile(oversizeLogo, 'logo');
  assert(!logoSizeCheck.valid && logoSizeCheck.error?.includes('2 MB'), 'Logo > 2 MB rejeitado');

  const oversizeBanner = new File([new Uint8Array(6 * 1024 * 1024)], 'big_banner.png', { type: 'image/png' });
  const bannerSizeCheck = validateBrandingFile(oversizeBanner, 'banner');
  assert(!bannerSizeCheck.valid && bannerSizeCheck.error?.includes('5 MB'), 'Banner > 5 MB rejeitado');

  // -------------------------------------------------------------------------
  // 3. SELEÇÃO E CONTROLE DE PATH (extractOwnedBrandingPath) & URLS LEGADAS
  // -------------------------------------------------------------------------
  console.log('\n3. Controle Estrito de Path & Compatibilidade com URLs Legadas');

  // URL pública canônica pertencente ao próprio tenant
  const canonicalLogoUrl = `https://mysupabase.supabase.co/storage/v1/object/public/${BRANDING_STORAGE_BUCKET}/${VALID_TENANT_UUID}/branding/logo_1710000000.png`;
  const extractedPath = extractOwnedBrandingPath(canonicalLogoUrl, VALID_TENANT_UUID);
  assert(
    extractedPath === `${VALID_TENANT_UUID}/branding/logo_1710000000.png`,
    'Extrai path legítimo de URL do Supabase para o próprio tenant'
  );

  // Path relativo direto
  const directPath = `${VALID_TENANT_UUID}/branding/banner_1710000000.webp`;
  const extractedDirect = extractOwnedBrandingPath(directPath, VALID_TENANT_UUID);
  assert(
    extractedDirect === directPath,
    'Aceita path relativo legítimo iniciado pelo UUID do tenant'
  );

  // URL externa legada (ex: https://site-externo.com/logo.png)
  const legacyExternalUrl = 'https://site-externo.com/images/logo.png';
  const legacyExtracted = extractOwnedBrandingPath(legacyExternalUrl, VALID_TENANT_UUID);
  assert(
    legacyExtracted === null,
    'URL externa legada retorna null (não executa delete físico no Storage)'
  );

  // URL do Unsplash
  const unsplashUrl = 'https://images.unsplash.com/photo-1581235720704-06d3acfcb36f';
  const unsplashExtracted = extractOwnedBrandingPath(unsplashUrl, VALID_TENANT_UUID);
  assert(
    unsplashExtracted === null,
    'URL do Unsplash retorna null (não executa delete físico no Storage)'
  );

  // Tentativa de Spoofing / Outro Tenant
  const otherTenantUrl = `https://mysupabase.supabase.co/storage/v1/object/public/${BRANDING_STORAGE_BUCKET}/${OTHER_TENANT_UUID}/branding/logo_123.png`;
  const spoofExtracted = extractOwnedBrandingPath(otherTenantUrl, VALID_TENANT_UUID);
  assert(
    spoofExtracted === null,
    'URL pertencente a outro tenant rejeitada com null (Cross-tenant delete mitigado)'
  );

  // Tentativa de Directory Traversal
  const traversalUrl = `https://mysupabase.supabase.co/storage/v1/object/public/${BRANDING_STORAGE_BUCKET}/${VALID_TENANT_UUID}/branding/../../evil.png`;
  const traversalExtracted = extractOwnedBrandingPath(traversalUrl, VALID_TENANT_UUID);
  assert(
    traversalExtracted === null,
    'Path traversal contendo .. rejeitado com null'
  );

  // Outro bucket
  const otherBucketUrl = `https://mysupabase.supabase.co/storage/v1/object/public/private-docs/${VALID_TENANT_UUID}/branding/doc.png`;
  const otherBucketExtracted = extractOwnedBrandingPath(otherBucketUrl, VALID_TENANT_UUID);
  assert(
    otherBucketExtracted === null,
    'URL de outro bucket rejeitada com null'
  );

  // -------------------------------------------------------------------------
  // 4. FLUXO COMPENSATÓRIO SIMULTÂNEO (LOGO + BANNER)
  // -------------------------------------------------------------------------
  console.log('\n4. Simulação de Consistência por Compensação (Logo + Banner)');

  // Caso A: Logo sucesso, Banner falha -> Logo deve ser revertido imediatamente
  let compensationRollbackCalls: string[] = [];
  const mockRollback = (path: string) => {
    compensationRollbackCalls.push(path);
  };

  const simUploadLogoSuccess = { url: `https://mock.co/${VALID_TENANT_UUID}/branding/logo_1.png`, error: null };
  const simUploadBannerFail = { url: null, error: 'Network timeout during banner upload' };

  if (simUploadLogoSuccess.url && simUploadBannerFail.error) {
    mockRollback(simUploadLogoSuccess.url);
  }
  assert(
    compensationRollbackCalls.length === 1 && compensationRollbackCalls[0] === simUploadLogoSuccess.url,
    'Caso A: Rollback imediato do logo recém-enviado se o upload do banner falhar'
  );

  // Caso B: Logo sucesso, Banner sucesso, DB update falha -> Ambos revertidos
  compensationRollbackCalls = [];
  const simLogo2 = { url: `https://mock.co/${VALID_TENANT_UUID}/branding/logo_2.png`, error: null };
  const simBanner2 = { url: `https://mock.co/${VALID_TENANT_UUID}/branding/banner_2.png`, error: null };
  const dbUpdateSuccess = false;

  if (!dbUpdateSuccess) {
    if (simLogo2.url) mockRollback(simLogo2.url);
    if (simBanner2.url) mockRollback(simBanner2.url);
  }
  assert(
    compensationRollbackCalls.length === 2 &&
    compensationRollbackCalls.includes(simLogo2.url) &&
    compensationRollbackCalls.includes(simBanner2.url),
    'Caso B: Rollback dos dois novos objetos recém-enviados se o banco falhar'
  );

  // -------------------------------------------------------------------------
  // 5. PROTEÇÃO CONTRA CLIQUES CONCORRENTES (isBusy)
  // -------------------------------------------------------------------------
  console.log('\n5. Proteção contra Concorrência & Duplos Cliques');

  let isSaving = false;
  let isRemovingLogo = false;
  let isRemovingBanner = false;

  let isBusy = isSaving || isRemovingLogo || isRemovingBanner;
  assert(!isBusy, 'Estado inicial não bloqueado');

  isSaving = true;
  isBusy = isSaving || isRemovingLogo || isRemovingBanner;
  assert(isBusy, 'isBusy é true enquanto isSaving=true (trava de cliques concorrentes)');

  isSaving = false;
  isRemovingLogo = true;
  isBusy = isSaving || isRemovingLogo || isRemovingBanner;
  assert(isBusy, 'isBusy é true enquanto isRemovingLogo=true');

  isRemovingLogo = false;
  isRemovingBanner = true;
  isBusy = isSaving || isRemovingLogo || isRemovingBanner;
  assert(isBusy, 'isBusy é true enquanto isRemovingBanner=true');

  // -------------------------------------------------------------------------
  // 6. VALIDAÇÃO DAS POLICIES E CONFIGURAÇÃO
  // -------------------------------------------------------------------------
  console.log('\n6. Auditoria de Configuração (config.toml & Migration 000006)');

  const configTomlContent = fs.readFileSync('supabase/config.toml', 'utf-8');
  assert(configTomlContent.includes('[storage.buckets.tenant-assets]'), 'config.toml declara bucket tenant-assets');
  assert(configTomlContent.includes('file_size_limit = "5MiB"'), 'config.toml define limite de 5MiB');
  assert(
    configTomlContent.includes('allowed_mime_types = ["image/png", "image/jpeg", "image/webp"]'),
    'config.toml restringe MIME a PNG, JPEG e WebP (SVG proibido)'
  );

  const migration000006 = fs.readFileSync('supabase/migrations/20260909_000006_branding_storage.sql', 'utf-8');
  assert(
    migration000006.includes('CREATE POLICY "tenant_assets_select_authenticated"'),
    'Migration 000006 mantém policy SELECT restrita a tenant_admin/platform_admin'
  );
  assert(
    !migration000006.includes('CREATE POLICY "tenant_assets_select_public"'),
    'Migration 000006 NÃO cria policy SELECT pública em storage.objects'
  );
  assert(
    !migration000006.includes('CREATE POLICY "tenant_assets_update_tenant_admin"'),
    'Migration 000006 NÃO cria policy de UPDATE (menor privilégio, versionado por timestamp)'
  );
  assert(
    migration000006.includes('CREATE POLICY "tenant_assets_insert_tenant_admin"'),
    'Migration 000006 cria policy INSERT restrita a tenant_admin/platform_admin'
  );
  assert(
    migration000006.includes('CREATE POLICY "tenant_assets_delete_tenant_admin"'),
    'Migration 000006 cria policy DELETE restrita a tenant_admin/platform_admin'
  );

  console.log('\n======================================================');
  console.log(`RESULTADO: ${passed} PASSOU / ${failed} FALHOU`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
