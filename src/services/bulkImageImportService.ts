import { Product } from '../types';
import { 
  isValidUuid, 
  validateProductMediaFileDeep, 
  uploadProductMediaImage, 
  rollbackProductMediaUploads 
} from './productMediaStorageService';
import { updateAdminProductImagesIfEmpty } from './adminCatalogService';

export interface ManifestEntry {
  sku: string;
  produto?: string;
  arquivo: string;
  [key: string]: unknown;
}

export type DryRunItemStatus =
  | 'READY'
  | 'SKIPPED_EXISTING_IMAGE'
  | 'BLOCKED_INVALID_TENANT'
  | 'BLOCKED_PRODUCT_NOT_FOUND'
  | 'BLOCKED_DUPLICATE_SKU'
  | 'BLOCKED_FILE_MISSING'
  | 'BLOCKED_INVALID_FILE'
  | 'UNUSED_FILE';

export interface DryRunItem {
  sku: string;
  productName: string;
  filename: string;
  status: DryRunItemStatus;
  reason: string;
  file?: File;
  product?: Product;
}

export interface DryRunSummary {
  total: number;
  ready: number;
  skippedExisting: number;
  blocked: number;
  unused: number;
}

export interface BulkImportReportItem {
  sku: string;
  productId?: string;
  filename: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'SKIPPED_CONCURRENT_IMAGE';
  error?: string;
}

export interface BulkImportReport {
  tenantId: string;
  startedAt: string;
  finishedAt: string;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  items: BulkImportReportItem[];
}

/**
 * Faz o parse e a validação estrita do manifest.json.
 */
export function parseManifestJson(jsonString: string): {
  valid: boolean;
  entries?: ManifestEntry[];
  error?: string;
} {
  if (!jsonString || !jsonString.trim()) {
    return { valid: false, error: 'O conteúdo do manifest.json está vazio.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'JSON malformado';
    return { valid: false, error: `Erro ao interpretar manifest.json: ${msg}` };
  }

  if (!Array.isArray(parsed)) {
    return { valid: false, error: 'O manifest.json deve ser uma lista (array) de objetos com sku e arquivo.' };
  }

  if (parsed.length === 0) {
    return { valid: false, error: 'O manifest.json não contém nenhum item para importação.' };
  }

  const entries: ManifestEntry[] = [];
  const seenSkus = new Set<string>();
  const filenameToSkuMap = new Map<string, string>();

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (!item || typeof item !== 'object') {
      return { valid: false, error: `Item na posição ${i + 1} do manifest não é um objeto válido.` };
    }

    const rawSku = (item as Record<string, unknown>).sku;
    const rawArquivo = (item as Record<string, unknown>).arquivo;
    const rawProduto = (item as Record<string, unknown>).produto;

    if (typeof rawSku !== 'string' || !rawSku.trim()) {
      return { valid: false, error: `Item na posição ${i + 1} possui SKU ausente ou vazio.` };
    }

    if (typeof rawArquivo !== 'string' || !rawArquivo.trim()) {
      return { valid: false, error: `Item com SKU "${rawSku}" possui nome de arquivo ausente ou vazio.` };
    }

    const sku = rawSku.trim().toUpperCase();
    const arquivo = rawArquivo.trim();

    if (seenSkus.has(sku)) {
      return { valid: false, error: `SKU duplicado encontrado no manifest.json: "${sku}". Cada SKU deve ser único no lote.` };
    }
    seenSkus.add(sku);

    const lowerFilename = arquivo.toLowerCase();
    const existingMappedSku = filenameToSkuMap.get(lowerFilename);
    if (existingMappedSku && existingMappedSku !== sku) {
      return {
        valid: false,
        error: `O arquivo "${arquivo}" foi associado a múltiplos SKUs diferentes no manifest ("${existingMappedSku}" e "${sku}"). Cada arquivo deve pertencer a no máximo um SKU.`
      };
    }
    filenameToSkuMap.set(lowerFilename, sku);

    entries.push({
      ...(item as Record<string, unknown>),
      sku,
      arquivo,
      produto: typeof rawProduto === 'string' ? rawProduto.trim() : undefined,
    });
  }

  return { valid: true, entries };
}

/**
 * Executa o DRY-RUN em memória com ZERO escritas, ZERO uploads e ZERO mutações.
 */
export async function performBulkImageDryRun(params: {
  manifestEntries: ManifestEntry[];
  selectedFiles: File[];
  products: Product[];
  effectiveTenantId: string | null;
}): Promise<{
  items: DryRunItem[];
  summary: DryRunSummary;
}> {
  const { manifestEntries, selectedFiles, products, effectiveTenantId } = params;

  const isTenantValid = Boolean(effectiveTenantId && isValidUuid(effectiveTenantId));
  const items: DryRunItem[] = [];

  // Mapear arquivos selecionados por nome (case-insensitive para tolerância a maiúsculas na extensão)
  const fileMap = new Map<string, File>();
  for (const f of selectedFiles) {
    fileMap.set(f.name.toLowerCase(), f);
  }

  // Mapear produtos por SKU normalizado
  const skuToProductsMap = new Map<string, Product[]>();
  for (const p of products) {
    const k = p.sku.trim().toUpperCase();
    const list = skuToProductsMap.get(k) || [];
    list.push(p);
    skuToProductsMap.set(k, list);
  }

  const matchedFileNames = new Set<string>();

  for (const entry of manifestEntries) {
    const matchedFile = fileMap.get(entry.arquivo.toLowerCase());
    if (matchedFile) {
      matchedFileNames.add(matchedFile.name.toLowerCase());
    }

    // 1. Validação de Tenant
    if (!isTenantValid) {
      items.push({
        sku: entry.sku,
        productName: entry.produto || '—',
        filename: entry.arquivo,
        status: 'BLOCKED_INVALID_TENANT',
        reason: 'Contexto de tenant administrativo inválido (UUID ausente ou não canônico).',
        file: matchedFile,
      });
      continue;
    }

    // 2. Busca e unicidade do produto por SKU
    const matchedProducts = skuToProductsMap.get(entry.sku) || [];
    if (matchedProducts.length === 0) {
      items.push({
        sku: entry.sku,
        productName: entry.produto || '—',
        filename: entry.arquivo,
        status: 'BLOCKED_PRODUCT_NOT_FOUND',
        reason: `SKU "${entry.sku}" não encontrado no catálogo cadastrado no Supabase deste tenant.`,
        file: matchedFile,
      });
      continue;
    }

    if (matchedProducts.length > 1) {
      items.push({
        sku: entry.sku,
        productName: entry.produto || matchedProducts[0].name,
        filename: entry.arquivo,
        status: 'BLOCKED_DUPLICATE_SKU',
        reason: `Múltiplos produtos (${matchedProducts.length}) encontrados no catálogo com o mesmo SKU "${entry.sku}". Ambiguidade bloqueada por segurança.`,
        file: matchedFile,
      });
      continue;
    }

    const product = matchedProducts[0];

    // 3. Validação de Tenant Ownership do Produto
    if (!product.tenantId || !isValidUuid(product.tenantId) || product.tenantId !== effectiveTenantId) {
      items.push({
        sku: entry.sku,
        productName: product.name,
        filename: entry.arquivo,
        status: 'BLOCKED_INVALID_TENANT',
        reason: 'O produto correspondente possui tenant_id divergente ou inválido (mitigação cross-tenant).',
        file: matchedFile,
        product,
      });
      continue;
    }

    // 4. Regra de Preservação: se já possui imagem, ignorar
    if (Array.isArray(product.images) && product.images.length > 0) {
      items.push({
        sku: entry.sku,
        productName: product.name,
        filename: entry.arquivo,
        status: 'SKIPPED_EXISTING_IMAGE',
        reason: `Produto já possui ${product.images.length} foto(s) cadastrada(s). Preservado conforme regra da V1.`,
        file: matchedFile,
        product,
      });
      continue;
    }

    // 5. Presença do Arquivo
    if (!matchedFile) {
      items.push({
        sku: entry.sku,
        productName: product.name,
        filename: entry.arquivo,
        status: 'BLOCKED_FILE_MISSING',
        reason: `Arquivo "${entry.arquivo}" especificado no manifest não foi incluído na seleção de arquivos.`,
        product,
      });
      continue;
    }

    // 6. Validação Profunda do Arquivo (MIME declarado + magic bytes binários + tamanho <= 1 MiB)
    const fileValidation = await validateProductMediaFileDeep(matchedFile);
    if (!fileValidation.valid) {
      items.push({
        sku: entry.sku,
        productName: product.name,
        filename: entry.arquivo,
        status: 'BLOCKED_INVALID_FILE',
        reason: fileValidation.error || 'Arquivo de imagem inválido ou fora dos padrões permitidos.',
        file: matchedFile,
        product,
      });
      continue;
    }

    // 7. Tudo válido: READY
    items.push({
      sku: entry.sku,
      productName: product.name,
      filename: entry.arquivo,
      status: 'READY',
      reason: 'Validado com sucesso. Pronto para upload e vinculação.',
      file: matchedFile,
      product,
    });
  }

  // 8. Arquivos na seleção que não constam no manifest
  for (const f of selectedFiles) {
    if (!matchedFileNames.has(f.name.toLowerCase())) {
      items.push({
        sku: '—',
        productName: '—',
        filename: f.name,
        status: 'UNUSED_FILE',
        reason: 'Arquivo presente na seleção de imagens, mas não referenciado no manifest.json. Não será processado.',
        file: f,
      });
    }
  }

  // Resumo estatístico
  const summary: DryRunSummary = {
    total: items.length,
    ready: items.filter(i => i.status === 'READY').length,
    skippedExisting: items.filter(i => i.status === 'SKIPPED_EXISTING_IMAGE').length,
    blocked: items.filter(i => i.status.startsWith('BLOCKED_')).length,
    unused: items.filter(i => i.status === 'UNUSED_FILE').length,
  };

  return { items, summary };
}

export interface BulkImportExecutionDependencies {
  uploader?: (
    tenantId: string,
    productId: string,
    file: File
  ) => Promise<{ url: string | null; path: string | null; error: string | null }>;
  persister?: (
    tenantId: string,
    productId: string,
    uploadedUrl: string
  ) => Promise<{ updated: boolean; product?: Product; error?: string }>;
  compensator?: (
    uploadedPaths: string[],
    tenantId: string,
    productId: string
  ) => Promise<void>;
}

/**
 * Executa a importação sequencial rigorosa (item a item) dos itens com status 'READY'.
 * Revalida o estado e ownership de cada produto antes do upload.
 * Utiliza persistência atômica condicional (updateAdminProductImagesIfEmpty) para eliminar
 * janelas TOCTOU: se outra sessão adicionar foto concorrentemente, o upload é revertido
 * e o produto existente é preservado com status SKIPPED_CONCURRENT_IMAGE.
 * Em caso de falha no update do banco, aciona compensação (rollback) apenas do upload daquele item.
 */
export async function executeSequentialBulkImageImport(params: {
  readyItems: DryRunItem[];
  allDryRunItems: DryRunItem[];
  effectiveTenantId: string;
  products: Product[];
  onProgress?: (current: number, total: number, currentSku: string) => void;
  deps?: BulkImportExecutionDependencies;
}): Promise<BulkImportReport> {
  const { readyItems, allDryRunItems, effectiveTenantId, products, onProgress, deps } = params;

  const uploader = deps?.uploader || uploadProductMediaImage;
  const persister = deps?.persister || updateAdminProductImagesIfEmpty;
  const compensator = deps?.compensator || rollbackProductMediaUploads;

  const startedAt = new Date().toISOString();
  const reportItems: BulkImportReportItem[] = [];

  // Registrar inicialmente os itens que já haviam sido ignorados no dry-run
  for (const item of allDryRunItems) {
    if (item.status === 'SKIPPED_EXISTING_IMAGE') {
      reportItems.push({
        sku: item.sku,
        productId: item.product?.id,
        filename: item.filename,
        status: 'SKIPPED',
        error: item.reason,
      });
    }
  }

  const total = readyItems.length;

  for (let index = 0; index < total; index++) {
    const item = readyItems[index];
    if (onProgress) {
      onProgress(index + 1, total, item.sku);
    }

    if (!item.file || !item.product) {
      reportItems.push({
        sku: item.sku,
        productId: item.product?.id,
        filename: item.filename,
        status: 'FAILED',
        error: 'Arquivo ou produto ausente na execução.',
      });
      continue;
    }

    // 1. Re-localizar o produto a partir da lista administrativa real
    const currentProduct = products.find(p => p.id === item.product!.id);
    if (!currentProduct) {
      reportItems.push({
        sku: item.sku,
        productId: item.product.id,
        filename: item.filename,
        status: 'FAILED',
        error: 'Produto não encontrado na lista administrativa real durante o ciclo de execução.',
      });
      continue;
    }

    // 2. Re-validar tenant ownership do produto
    if (
      !currentProduct.tenantId ||
      !isValidUuid(currentProduct.tenantId) ||
      currentProduct.tenantId !== effectiveTenantId
    ) {
      reportItems.push({
        sku: item.sku,
        productId: currentProduct.id,
        filename: item.filename,
        status: 'FAILED',
        error: 'Contexto de tenant do produto inválido ou divergente durante o ciclo de execução.',
      });
      continue;
    }

    // 3. Confirmar novamente que o produto ainda não possui foto cadastrada
    if (Array.isArray(currentProduct.images) && currentProduct.images.length > 0) {
      reportItems.push({
        sku: item.sku,
        productId: currentProduct.id,
        filename: item.filename,
        status: 'SKIPPED',
        error: 'O produto já possui fotos cadastradas no banco.',
      });
      continue;
    }

    // 4. Executar upload da imagem no Storage
    const uploadResult = await uploader(
      effectiveTenantId,
      currentProduct.id,
      item.file
    );

    if (uploadResult.error || !uploadResult.url || !uploadResult.path) {
      reportItems.push({
        sku: item.sku,
        productId: currentProduct.id,
        filename: item.filename,
        status: 'FAILED',
        error: uploadResult.error || 'Falha no upload para o Storage.',
      });
      continue;
    }

    const uploadedUrl = uploadResult.url;
    const uploadedPath = uploadResult.path;

    // 5. Persistir no banco de dados via persistência atômica condicional (updateAdminProductImagesIfEmpty)
    try {
      const persistResult = await persister(
        effectiveTenantId,
        currentProduct.id,
        uploadedUrl
      );

      if (persistResult?.updated) {
        reportItems.push({
          sku: item.sku,
          productId: currentProduct.id,
          filename: item.filename,
          status: 'SUCCESS',
        });
      } else if (persistResult?.error) {
        // Erro no banco de dados retornado
        try {
          await compensator([uploadedPath], effectiveTenantId, currentProduct.id);
        } catch (rollbackErr) {
          console.warn('[BulkImageImporter] Falha no rollback após erro no banco:', rollbackErr);
        }

        reportItems.push({
          sku: item.sku,
          productId: currentProduct.id,
          filename: item.filename,
          status: 'FAILED',
          error: `${persistResult.error} (Upload compensado no Storage).`,
        });
      } else {
        // updated === false sem erro: alteração concorrente / imagem adicionada entre dry-run e persistência
        try {
          await compensator([uploadedPath], effectiveTenantId, currentProduct.id);
        } catch (rollbackErr) {
          console.warn('[BulkImageImporter] Falha no rollback de concorrência:', rollbackErr);
        }

        reportItems.push({
          sku: item.sku,
          productId: currentProduct.id,
          filename: item.filename,
          status: 'SKIPPED_CONCURRENT_IMAGE',
          error: 'SKIPPED_CONCURRENT_IMAGE: Foto adicionada concorrentemente por outra sessão. Imagem existente preservada e upload compensado no Storage.',
        });
      }
    } catch (dbErr: unknown) {
      const errMsg = dbErr instanceof Error ? dbErr.message : 'Falha ao persistir foto no banco de dados';

      // 6. Compensação cirúrgica: rollback somente do upload deste produto
      try {
        await compensator([uploadedPath], effectiveTenantId, currentProduct.id);
      } catch (rollbackErr) {
        console.warn('[BulkImageImporter] Falha não impeditiva no rollback:', rollbackErr);
      }

      reportItems.push({
        sku: item.sku,
        productId: currentProduct.id,
        filename: item.filename,
        status: 'FAILED',
        error: `${errMsg} (Upload compensado no Storage).`,
      });
    }
  }

  const finishedAt = new Date().toISOString();
  const successCount = reportItems.filter(i => i.status === 'SUCCESS').length;
  const failedCount = reportItems.filter(i => i.status === 'FAILED').length;
  const skippedCount = reportItems.filter(
    i => i.status === 'SKIPPED' || i.status === 'SKIPPED_CONCURRENT_IMAGE'
  ).length;

  return {
    tenantId: effectiveTenantId,
    startedAt,
    finishedAt,
    total: reportItems.length,
    success: successCount,
    failed: failedCount,
    skipped: skippedCount,
    items: reportItems,
  };
}
