import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { LEGACY_SUPABASE_V1_HOST } from '../utils/productImages';

export const PRODUCT_MEDIA_BUCKET = 'product-media';

export const ALLOWED_PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_PRODUCT_IMAGE_SIZE_BYTES = 1 * 1024 * 1024; // 1 MiB

export interface ProductMediaValidationResult {
  valid: boolean;
  error?: string;
}

export interface ProductMediaUploadResult {
  url: string | null;
  path: string | null;
  error: string | null;
}

export interface ProductMediaRemoveResult {
  success: boolean;
  error: string | null;
}

/**
 * Regex canônica para validação estrita de UUID v4.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valida se uma string é um UUID válido.
 */
export function isValidUuid(id: string | null | undefined): boolean {
  if (!id) return false;
  return UUID_REGEX.test(id.trim());
}

/**
 * Sanitiza identificadores UUID para compor caminhos de Storage com segurança.
 * Remove caracteres de controle e previne injeção de diretórios.
 */
export function sanitizeUuidPathSegment(segment: string): string {
  if (!segment) return '';
  return segment.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Inspeciona os primeiros bytes do arquivo para verificar o formato binário real (magic bytes),
 * bloqueando executáveis ou scripts renomeados com extensões de imagem.
 */
export async function detectRealProductImageType(file: File | Blob): Promise<string | null> {
  try {
    const slice = file.slice(0, 16);
    const buffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    if (bytes.length < 4) return null;

    // JPEG: FF D8 FF
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
      return 'image/jpeg';
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4E &&
      bytes[3] === 0x47
    ) {
      return 'image/png';
    }

    // WebP: RIFF [4 bytes] WEBP
    // bytes 0-3: 52 49 46 46 ("RIFF")
    // bytes 8-11: 57 45 42 50 ("WEBP")
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes.length >= 12 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return 'image/webp';
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Validação preliminar síncrona do arquivo (tamanho, formato declarado e bloqueio de vetores XSS).
 */
export function validateProductMediaFile(file: File): ProductMediaValidationResult {
  if (!file) {
    return { valid: false, error: 'Nenhum arquivo foi selecionado.' };
  }

  const lowerName = file.name ? file.name.toLowerCase() : '';

  // Bloqueio explícito de SVG e GIF
  if (file.type === 'image/svg+xml' || lowerName.endsWith('.svg')) {
    return {
      valid: false,
      error: 'Formato SVG não é permitido para fotos de produtos por diretriz de segurança (risco XSS). Use PNG, JPEG ou WebP.',
    };
  }

  if (file.type === 'image/gif' || lowerName.endsWith('.gif')) {
    return {
      valid: false,
      error: 'Formato GIF animado não é suportado nesta etapa. Selecione PNG, JPEG ou WebP.',
    };
  }

  if (!ALLOWED_PRODUCT_IMAGE_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: 'Formato inválido. As fotos do produto devem ser PNG, JPEG ou WebP.',
    };
  }

  if (file.size > MAX_PRODUCT_IMAGE_SIZE_BYTES) {
    return {
      valid: false,
      error: 'Tamanho excessivo. Cada foto do produto deve ter no máximo 1 MiB.',
    };
  }

  return { valid: true };
}

/**
 * Validação assíncrona profunda (MIME declarado + magic bytes binários).
 */
export async function validateProductMediaFileDeep(file: File): Promise<ProductMediaValidationResult> {
  const syncCheck = validateProductMediaFile(file);
  if (!syncCheck.valid) {
    return syncCheck;
  }

  const realMime = await detectRealProductImageType(file);
  if (!realMime || !ALLOWED_PRODUCT_IMAGE_TYPES.includes(realMime)) {
    return {
      valid: false,
      error: 'Conteúdo binário incompatível. O arquivo não é uma imagem JPEG, PNG ou WebP válida.',
    };
  }

  return { valid: true };
}

/**
 * Retorna a extensão canônica a partir do MIME type.
 */
export function getSafeProductImageExtension(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}

/**
 * Gera um sufixo randômico único seguro.
 */
function generateRandomSuffix(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return Math.random().toString(36).substring(2, 14);
}

/**
 * Envia uma foto de produto para o bucket 'product-media'.
 * Path canônico obrigatório:
 * <tenant_uuid>/products/<product_uuid>/media_<timestamp>_<random>.<ext>
 * 
 * Regras:
 * - Validação estrita de UUID para tenant e produto (Fail-Closed).
 * - Upload com upsert: false (versionamento determinístico).
 * - Gera URL pública a partir do bucket configurado.
 */
export async function uploadProductMediaImage(
  tenantId: string,
  productId: string,
  file: File
): Promise<ProductMediaUploadResult> {
  const validation = await validateProductMediaFileDeep(file);
  if (!validation.valid) {
    return { url: null, path: null, error: validation.error || 'Arquivo inválido.' };
  }

  const cleanTenant = sanitizeUuidPathSegment(tenantId).toLowerCase();
  const cleanProduct = sanitizeUuidPathSegment(productId).toLowerCase();

  if (!isValidUuid(cleanTenant)) {
    return {
      url: null,
      path: null,
      error: 'Identificador de tenant inválido (UUID v4 obrigatório). Upload bloqueado.',
    };
  }

  if (!isValidUuid(cleanProduct)) {
    return {
      url: null,
      path: null,
      error: 'Identificador de produto inválido (UUID v4 obrigatório). Upload bloqueado.',
    };
  }

  if (!isSupabaseConfigured()) {
    // Modo local / preview sem conexão remota
    const localUrl = URL.createObjectURL(file);
    const mockPath = `${cleanTenant}/products/${cleanProduct}/media_${Date.now()}_local.${getSafeProductImageExtension(file.type)}`;
    return {
      url: localUrl,
      path: mockPath,
      error: null,
    };
  }

  try {
    const ext = getSafeProductImageExtension(file.type);
    const timestamp = Date.now();
    const suffix = generateRandomSuffix();
    const filePath = `${cleanTenant}/products/${cleanProduct}/media_${timestamp}_${suffix}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(PRODUCT_MEDIA_BUCKET)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false, // Menor privilégio: arquivos versionados por timestamp/id, nunca sobrescrever
        contentType: file.type,
      });

    if (uploadError) {
      console.warn('[ProductMediaStorage] Erro no upload da foto do produto:', uploadError.message);
      return {
        url: null,
        path: null,
        error: `Falha no envio da imagem para o Storage: ${uploadError.message}`,
      };
    }

    const { data: publicUrlData } = supabase.storage
      .from(PRODUCT_MEDIA_BUCKET)
      .getPublicUrl(filePath);

    if (!publicUrlData?.publicUrl) {
      return {
        url: null,
        path: filePath,
        error: 'Não foi possível gerar a URL pública da imagem.',
      };
    }

    return {
      url: publicUrlData.publicUrl,
      path: filePath,
      error: null,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro inesperado durante o upload.';
    console.error('[ProductMediaStorage] Exceção no upload:', err);
    return {
      url: null,
      path: null,
      error: msg,
    };
  }
}

/**
 * Extrai e valida de forma rigorosa o path relativo de uma imagem pertencente ao bucket
 * 'product-media' sob o diretório exclusivo do tenant e do produto (<tenantUuid>/products/<productUuid>/...).
 * 
 * Critérios Fail-Closed de Segurança:
 * 1. String não vazia.
 * 2. tenantUuid e productUuid devem ser UUIDs canônicos válidos.
 * 3. Rejeita schemas perigosos: blob:, data:, javascript:.
 * 4. Rejeita sequências de path traversal (.. ou \).
 * 5. URLs externas (Unsplash, domínios de terceiros), URLs do Supabase V1 legado ou URLs de outro bucket retornam null.
 * 6. URLs de outro tenant ou de outro produto retornam null (mitigação cross-tenant e cross-product).
 */
export function extractOwnedProductMediaPath(
  urlOrPath: string | null | undefined,
  tenantUuid: string,
  productUuid: string
): string | null {
  if (!urlOrPath || !tenantUuid || !productUuid) return null;

  const cleanTenant = tenantUuid.trim().toLowerCase();
  const cleanProduct = productUuid.trim().toLowerCase();

  if (!isValidUuid(cleanTenant) || !isValidUuid(cleanProduct)) {
    return null;
  }

  const rawInput = urlOrPath.trim();

  // Rejeita schemas perigosos imediatamente
  const lowerInput = rawInput.toLowerCase();
  if (
    lowerInput.startsWith('blob:') ||
    lowerInput.startsWith('data:') ||
    lowerInput.startsWith('javascript:')
  ) {
    return null;
  }

  // Rejeita tentativas de path traversal
  if (rawInput.includes('..') || rawInput.includes('\\')) {
    return null;
  }

  try {
    let relativePath = rawInput;

    if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
      const parsedUrl = new URL(relativePath);

      // Rejeita explicitamente host legado V1 e hosts de terceiros sem o bucket correto
      if (parsedUrl.hostname === LEGACY_SUPABASE_V1_HOST) {
        return null;
      }

      const bucketMarker = `/${PRODUCT_MEDIA_BUCKET}/`;
      const markerIndex = parsedUrl.pathname.indexOf(bucketMarker);
      if (markerIndex === -1) {
        return null; // URL externa ou pertencente a outro bucket
      }

      relativePath = parsedUrl.pathname.substring(markerIndex + bucketMarker.length);
    } else {
      if (relativePath.startsWith(`${PRODUCT_MEDIA_BUCKET}/`)) {
        relativePath = relativePath.substring(PRODUCT_MEDIA_BUCKET.length + 1);
      }
    }

    // Decodifica componentes de URI e descarta query strings / hashes
    relativePath = decodeURIComponent(relativePath.split('?')[0].split('#')[0]);

    while (relativePath.startsWith('/')) {
      relativePath = relativePath.substring(1);
    }

    // Namespace estrito esperado: <cleanTenant>/products/<cleanProduct>/
    const expectedPrefix = `${cleanTenant}/products/${cleanProduct}/`;
    if (!relativePath.toLowerCase().startsWith(expectedPrefix)) {
      return null; // Pertence a outro tenant ou outro produto
    }

    // Re-checa path traversal após decodificação
    if (relativePath.includes('..') || relativePath.includes('\\')) {
      return null;
    }

    return relativePath;
  } catch {
    return null;
  }
}

/**
 * Remove do Storage uma lista de arquivos recém-enviados em caso de falha em etapa posterior
 * (consistência compensatória client-side).
 */
export async function rollbackProductMediaUploads(
  uploadedPathsOrUrls: string[],
  tenantUuid: string,
  productUuid: string
): Promise<void> {
  if (!uploadedPathsOrUrls.length || !isSupabaseConfigured()) return;

  const validPaths: string[] = [];
  for (const item of uploadedPathsOrUrls) {
    const p = extractOwnedProductMediaPath(item, tenantUuid, productUuid);
    if (p) validPaths.push(p);
  }

  if (!validPaths.length) return;

  try {
    await supabase.storage
      .from(PRODUCT_MEDIA_BUCKET)
      .remove(validPaths);
  } catch (err) {
    console.warn('[ProductMediaStorage] Falha não impeditiva no rollback compensatório de mídias:', err);
  }
}

/**
 * Remove do Storage uma imagem antiga de produto que foi desvinculada pelo operador.
 * Se a URL for externa ou do Supabase V1 legado, ignora silenciosamente a deleção física no Storage.
 */
export async function removeProductMediaImage(
  tenantUuid: string,
  productUuid: string,
  currentUrlOrPath?: string | null
): Promise<ProductMediaRemoveResult> {
  if (!currentUrlOrPath || !isSupabaseConfigured()) {
    return { success: true, error: null };
  }

  const ownedPath = extractOwnedProductMediaPath(currentUrlOrPath, tenantUuid, productUuid);
  if (!ownedPath) {
    // Imagem externa ou V1 legada: não há objeto correspondente no bucket 'product-media'.
    return { success: true, error: null };
  }

  try {
    const { error } = await supabase.storage
      .from(PRODUCT_MEDIA_BUCKET)
      .remove([ownedPath]);

    if (error) {
      console.warn('[ProductMediaStorage] Aviso ao remover imagem do storage:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro ao remover imagem do storage.';
    console.warn('[ProductMediaStorage] Falha não impeditiva na remoção de imagem:', err);
    return { success: false, error: msg };
  }
}
