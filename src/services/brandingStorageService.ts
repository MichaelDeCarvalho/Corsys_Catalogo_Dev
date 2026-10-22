import { supabase, isSupabaseConfigured } from '../lib/supabase';

export const BRANDING_STORAGE_BUCKET = 'tenant-assets';

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_BANNER_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

export interface UploadResult {
  url: string | null;
  path: string | null;
  error: string | null;
}

export interface RemoveResult {
  success: boolean;
  error: string | null;
}

/**
 * Inspeciona os magic bytes dos primeiros bytes do arquivo para identificar
 * o formato binário real, bloqueando arquivos renomeados (ex: .txt ou .svg renomeado para .png).
 */
export async function detectRealImageType(file: File | Blob): Promise<string | null> {
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
 * Validação síncrona preliminar do arquivo (MIME declarado e tamanho).
 */
export function validateBrandingFile(file: File, kind: 'logo' | 'banner'): FileValidationResult {
  if (!file) {
    return { valid: false, error: 'Nenhum arquivo foi selecionado.' };
  }

  // Bloqueio explícito de SVG (segurança contra vetores de script/XSS embutido)
  const lowerName = file.name ? file.name.toLowerCase() : '';
  if (file.type === 'image/svg+xml' || lowerName.endsWith('.svg')) {
    return {
      valid: false,
      error: 'Formato SVG não é permitido nesta etapa. Selecione PNG, JPEG ou WebP.',
    };
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: 'Formato inválido. Selecione uma imagem PNG, JPEG ou WebP.',
    };
  }

  const maxSize = kind === 'logo' ? MAX_LOGO_SIZE_BYTES : MAX_BANNER_SIZE_BYTES;
  const maxMb = kind === 'logo' ? '2 MB' : '5 MB';

  if (file.size > maxSize) {
    return {
      valid: false,
      error: `Tamanho excessivo. O arquivo de ${kind === 'logo' ? 'logomarca' : 'banner'} deve ter no máximo ${maxMb}.`,
    };
  }

  return { valid: true };
}

/**
 * Validação profunda assíncrona (MIME declarado + assinatura binária de magic bytes).
 */
export async function validateBrandingFileDeep(file: File, kind: 'logo' | 'banner'): Promise<FileValidationResult> {
  const syncCheck = validateBrandingFile(file, kind);
  if (!syncCheck.valid) {
    return syncCheck;
  }

  const realMime = await detectRealImageType(file);
  if (!realMime || !ALLOWED_IMAGE_TYPES.includes(realMime)) {
    return {
      valid: false,
      error: 'Conteúdo binário incompatível. O arquivo não é uma imagem JPEG, PNG ou WebP válida.',
    };
  }

  return { valid: true };
}

/**
 * Extrai a extensão segura a partir do MIME type.
 */
export function getSafeExtension(mimeType: string): string {
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
 * Regex para validação canônica de UUID v4.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valida se uma string é um UUID válido.
 */
export function isValidUUID(id: string | null | undefined): boolean {
  if (!id) return false;
  return UUID_REGEX.test(id.trim());
}

/**
 * Sanitiza o tenantId para uso seguro no caminho de Storage.
 * Impede path traversal (.., /, backslashes e caracteres de controle).
 */
export function sanitizeTenantPath(tenantId: string): string {
  if (!tenantId) return '';
  return tenantId.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Envia logomarca ou banner para o bucket do Supabase Storage.
 * Retorna a URL pública gerada ou o erro correspondente.
 * Exige estritamente UUID real do tenant (Fail-Closed).
 */
export async function uploadTenantBranding(
  tenantId: string,
  file: File,
  kind: 'logo' | 'banner'
): Promise<UploadResult> {
  const validation = await validateBrandingFileDeep(file, kind);
  if (!validation.valid) {
    return { url: null, path: null, error: validation.error || 'Arquivo inválido.' };
  }

  // Validação estrita de UUID - Fail Closed obrigatório
  const cleanTenant = sanitizeTenantPath(tenantId).toLowerCase();
  if (!isValidUUID(cleanTenant)) {
    return {
      url: null,
      path: null,
      error: 'Identificador do tenant inválido ou não autenticado (UUID obrigatório). Upload bloqueado.',
    };
  }

  if (!isSupabaseConfigured()) {
    // Modo local / offline preview com Object URL temporária
    const previewUrl = URL.createObjectURL(file);
    return {
      url: previewUrl,
      path: `${cleanTenant}/branding/${kind}-${Date.now()}`,
      error: null,
    };
  }

  try {
    const ext = getSafeExtension(file.type);
    const timestamp = Date.now();
    // Path seguro gerado exclusivamente pela aplicação no formato obrigatório:
    // <tenant_uuid>/branding/<kind>_<version>.<ext>
    const filePath = `${cleanTenant}/branding/${kind}_${timestamp}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(BRANDING_STORAGE_BUCKET)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false, // Menor privilégio: arquivos versionados por timestamp, nunca sobrescrever
        contentType: file.type,
      });

    if (uploadError) {
      console.warn(`[BrandingStorage] Erro no upload de ${kind}:`, uploadError.message);
      return {
        url: null,
        path: null,
        error: `Falha no envio da imagem para o Storage: ${uploadError.message}`,
      };
    }

    const { data: publicUrlData } = supabase.storage
      .from(BRANDING_STORAGE_BUCKET)
      .getPublicUrl(filePath);

    if (!publicUrlData?.publicUrl) {
      return {
        url: null,
        path: filePath,
        error: 'Não foi possível gerar o link público da imagem.',
      };
    }

    return {
      url: publicUrlData.publicUrl,
      path: filePath,
      error: null,
    };
  } catch (err: any) {
    console.error(`[BrandingStorage] Exceção durante upload de ${kind}:`, err);
    return {
      url: null,
      path: null,
      error: err?.message || 'Erro inesperado durante o upload.',
    };
  }
}

/**
 * Extrai e valida de forma estrita o path relativo de um asset pertencente ao bucket
 * 'tenant-assets' e exclusivamente sob o diretório do próprio tenant autenticado (<tenantUuid>/branding/...).
 * 
 * Regras Fail-Closed (Segurança e Compatibilidade com URLs Legadas):
 * 1. Deve ser string válida e não vazia.
 * 2. Deve pertencer ao bucket 'tenant-assets'.
 * 3. Deve iniciar obrigatoriamente pelo UUID canônico do tenant autenticado: `${tenantUuid.toLowerCase()}/branding/`.
 * 4. URLs externas antigas (ex: 'https://site-externo.com/logo.png', 'https://images.unsplash.com/...'),
 *    URLs de outros buckets ou URLs de outros tenants retornam null, impedindo qualquer chamada indevida a storage.remove.
 */
export function extractOwnedBrandingPath(
  urlOrPath: string | null | undefined,
  tenantUuid: string
): string | null {
  if (!urlOrPath || !tenantUuid) return null;
  const cleanTenant = tenantUuid.trim().toLowerCase();
  if (!isValidUUID(cleanTenant)) return null;

  try {
    let relativePath = urlOrPath.trim();

    // Se for URL HTTP/HTTPS
    if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
      const parsedUrl = new URL(relativePath);
      // Verifica se contém o padrão de storage do Supabase para o bucket 'tenant-assets'
      const bucketMarker = `/${BRANDING_STORAGE_BUCKET}/`;
      const markerIndex = parsedUrl.pathname.indexOf(bucketMarker);
      if (markerIndex === -1) {
        // É URL externa ou legada (ex: site-externo.com/logo.png) -> Retorna null (Fail Closed seguro)
        return null;
      }
      relativePath = parsedUrl.pathname.substring(markerIndex + bucketMarker.length);
    } else {
      // Se for path relativo direto ou contiver o nome do bucket no início
      if (relativePath.startsWith(`${BRANDING_STORAGE_BUCKET}/`)) {
        relativePath = relativePath.substring(BRANDING_STORAGE_BUCKET.length + 1);
      }
    }

    // Decodifica URI e remove query strings ou hashes
    relativePath = decodeURIComponent(relativePath.split('?')[0].split('#')[0]);

    // Limpeza defensiva de barras iniciais
    while (relativePath.startsWith('/')) {
      relativePath = relativePath.substring(1);
    }

    // Validação estrita de propriedade do Tenant e namespace:
    // Deve começar obrigatoriamente com: <cleanTenant>/branding/
    const expectedPrefix = `${cleanTenant}/branding/`;
    if (!relativePath.toLowerCase().startsWith(expectedPrefix)) {
      return null;
    }

    // Não pode conter path traversal
    if (relativePath.includes('..') || relativePath.includes('\\')) {
      return null;
    }

    return relativePath;
  } catch {
    return null;
  }
}

/**
 * Remove um arquivo recém-enviado do Storage para compensação/rollback caso
 * a gravação subsequente no banco falhe (consistência por compensação).
 * Exige obrigatoriamente tenantUuid e validação estrita via extractOwnedBrandingPath (Fail-Closed).
 */
export async function rollbackUploadedFile(
  filePathOrUrl: string | null,
  tenantUuid: string
): Promise<void> {
  if (!filePathOrUrl || !tenantUuid || !isSupabaseConfigured()) return;
  try {
    const targetPath = extractOwnedBrandingPath(filePathOrUrl, tenantUuid);
    if (targetPath) {
      await supabase.storage
        .from(BRANDING_STORAGE_BUCKET)
        .remove([targetPath]);
    }
  } catch (err) {
    console.warn('[BrandingStorage] Falha não impeditiva no rollback compensatório de arquivo:', err);
  }
}

/**
 * Remove a imagem anterior do Storage quando substituída ou deletada.
 * Valida rigorosamente se o asset pertence ao bucket e ao tenant antes de qualquer deleção.
 */
export async function removeTenantBranding(
  tenantId: string,
  _kind: 'logo' | 'banner',
  currentUrl?: string | null
): Promise<RemoveResult> {
  if (!currentUrl || !isSupabaseConfigured()) {
    return { success: true, error: null };
  }

  // Validação estrita de posse do asset pelo tenant (Fail Closed contra deleção indevida ou URL externa legada)
  const ownedPath = extractOwnedBrandingPath(currentUrl, tenantId);
  if (!ownedPath) {
    // Se não for um path comprovadamente pertencente ao tenant-assets deste tenant
    // (ex: URL externa legada ou path de outro bucket), ignora a deleção física no Storage sem erro.
    return { success: true, error: null };
  }

  try {
    const { error } = await supabase.storage
      .from(BRANDING_STORAGE_BUCKET)
      .remove([ownedPath]);

    if (error) {
      console.warn('[BrandingStorage] Aviso ao remover arquivo antigo do Storage:', error.message);
      return { success: false, error: error.message };
    }
    return { success: true, error: null };
  } catch (err: any) {
    console.warn('[BrandingStorage] Falha não impeditiva ao remover arquivo:', err);
    return { success: false, error: err?.message || 'Erro ao remover arquivo do Storage.' };
  }
}

/**
 * Persiste as URLs de branding na tabela `public.tenant_public_settings`.
 * OBS: Não envia updated_at no payload pois o trigger trg_tenant_public_settings_updated_at
 * já o gerencia automaticamente no PostgreSQL e a concessão colunar GRANT UPDATE
 * não inclui updated_at para authenticated.
 */
export async function updateTenantBrandingSettings(
  tenantId: string,
  updates: { logoUrl?: string | null; bannerUrl?: string | null }
): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { success: true, error: null };
  }

  try {
    const payload: Record<string, any> = {};

    if (updates.logoUrl !== undefined) {
      payload.logo_url = updates.logoUrl;
    }
    if (updates.bannerUrl !== undefined) {
      payload.banner_url = updates.bannerUrl;
    }

    if (Object.keys(payload).length === 0) {
      return { success: true, error: null };
    }

    const { error } = await supabase
      .from('tenant_public_settings')
      .update(payload)
      .eq('tenant_id', tenantId);

    if (error) {
      console.warn('[BrandingStorage] Erro ao sincronizar tenant_public_settings:', error.message);
      return {
        success: false,
        error: `Erro ao salvar configurações no banco: ${error.message}`,
      };
    }

    return { success: true, error: null };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Erro ao sincronizar dados com o Supabase.',
    };
  }
}
