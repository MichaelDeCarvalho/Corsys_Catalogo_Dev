/**
 * Serviço administrativo oficial de catálogo via Supabase.
 * 
 * DIRETRIZES:
 * 1. Utilizado por gestores e administradores no Painel da Loja.
 * 2. Consulta a tabela 'public.products' protegida por RLS e filtrada pelo tenant_id.
 * 3. Preserva valores reais e tipos estritos do catálogo.
 * 4. Não oculta produtos com stock = 0.
 * 5. Não faz merge com dados mock e não utiliza fallback silencioso para INITIAL_PRODUCTS.
 * 6. Suporta updateAdminProduct com strict allowlist e validações de atacado.
 * 7. Suporta ações em massa (ativar, desativar, excluir soft-delete, editar em massa).
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Product } from '../types';

export interface RawAdminProductRow {
  id: string;
  tenant_id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  subcategory: string | null;
  brand: string | null;
  description: string | null;
  technical_specs: Record<string, unknown> | null;
  cost_price?: number | string | null;
  price: number | string;
  promotional_price: number | string | null;
  wholesale_price: number | string | null;
  wholesale_enabled?: boolean | null;
  wholesale_min_quantity?: number | string | null;
  min_order_quantity: number | string;
  stock: number | string;
  unit: string | null;
  images: string[] | null;
  featured: boolean | null;
  is_new: boolean | null;
  active: boolean;
  sort_order: number | string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AdminProductUpdatePayload {
  name?: string;
  category?: string;
  subcategory?: string | null;
  brand?: string | null;
  description?: string | null;
  price?: number;
  promotionalPrice?: number | null;
  wholesalePrice?: number | null;
  wholesaleEnabled?: boolean;
  wholesaleMinQuantity?: number | null;
  costPrice?: number | null;
  stock?: number;
  active?: boolean;
  unit?: string;
  images?: string[];
  deletedAt?: string | null;
}

/**
 * Adapter: converte registro snake_case da tabela products para Product tipado no contexto administrativo.
 */
export function adaptAdminProduct(row: RawAdminProductRow): Product {
  const price = typeof row.price === 'number' ? row.price : Number(row.price) || 0;
  
  const promotionalPrice = row.promotional_price !== null && row.promotional_price !== undefined
    ? (typeof row.promotional_price === 'number' ? row.promotional_price : Number(row.promotional_price))
    : null;
    
  const rawWholesalePrice = row.wholesale_price !== null && row.wholesale_price !== undefined
    ? (typeof row.wholesale_price === 'number' ? row.wholesale_price : Number(row.wholesale_price))
    : null;

  // Bootstrap rule: se wholesale_enabled estiver gravado, usa ele. Caso contrário, se wholesale_price > 0 -> true
  let wholesaleEnabled = false;
  if (row.wholesale_enabled !== undefined && row.wholesale_enabled !== null) {
    wholesaleEnabled = Boolean(row.wholesale_enabled);
  } else {
    wholesaleEnabled = Boolean(rawWholesalePrice !== null && rawWholesalePrice > 0);
  }

  let wholesaleMinQuantity: number | null = null;
  if (wholesaleEnabled) {
    if (row.wholesale_min_quantity !== undefined && row.wholesale_min_quantity !== null) {
      wholesaleMinQuantity = typeof row.wholesale_min_quantity === 'number'
        ? row.wholesale_min_quantity
        : Number(row.wholesale_min_quantity) || 1;
    } else {
      wholesaleMinQuantity = 1;
    }
  }

  const costPrice = row.cost_price !== null && row.cost_price !== undefined
    ? (typeof row.cost_price === 'number' ? row.cost_price : Number(row.cost_price))
    : null;

  const stock = typeof row.stock === 'number' ? row.stock : Number(row.stock) || 0;
  const minOrderQuantity = typeof row.min_order_quantity === 'number' ? row.min_order_quantity : Number(row.min_order_quantity) || 1;
  const sortOrder = typeof row.sort_order === 'number' ? row.sort_order : Number(row.sort_order) || 0;

  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode || null,
    category: row.category,
    subcategory: row.subcategory || null,
    brand: row.brand || null,
    description: row.description || '',
    technicalSpecs: row.technical_specs || {},
    costPrice,
    price,
    promotionalPrice,
    wholesalePrice: wholesaleEnabled ? rawWholesalePrice : null,
    wholesaleEnabled,
    wholesaleMinQuantity,
    wholesaleTiers: [], // Compatibilidade estrita de tipagem (Product)
    minOrderQuantity,
    stock,
    unit: row.unit || 'un',
    images: Array.isArray(row.images) ? row.images.filter(Boolean) : [],
    featured: Boolean(row.featured),
    isNew: Boolean(row.is_new),
    active: Boolean(row.active),
    sortOrder,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Validação defensiva de UUID
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID_REGEX.test(id.trim());
}

/**
 * Consulta a lista de produtos administrativos de um tenant a partir do Supabase.
 * Implementa estratégia resiliente que tenta primeiramente a projeção completa em public.products,
 * e se houver restrição de permissão em cost_price para usuários sem sessão autenticada no preview,
 * consulta as colunas públicas sem cost_price ou a view oficial catalog_products.
 */
export async function fetchAdminProducts(tenantId: string): Promise<Product[]> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Verifique as credenciais no ambiente.');
  }

  if (!tenantId || !isValidUuid(tenantId)) {
    throw new Error('Contexto administrativo inválido: tenant_id real do Supabase não foi resolvido.');
  }

  // 1. Tenta consulta direta em public.products
  let productsData: RawAdminProductRow[] | null = null;
  let productsError: any = null;

  try {
    const res = await supabase
      .from('products')
      .select('id, tenant_id, sku, barcode, name, category, subcategory, brand, description, technical_specs, cost_price, price, promotional_price, wholesale_price, wholesale_enabled, wholesale_min_quantity, min_order_quantity, stock, unit, images, featured, is_new, active, sort_order, created_at, updated_at, deleted_at')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    if (!res.error && res.data) {
      productsData = res.data as RawAdminProductRow[];
    } else {
      productsError = res.error;
    }
  } catch (err: any) {
    productsError = err;
  }

  // 2. Fallback caso colunas wholesale_enabled/cost_price não existam ainda ou role anon seja usado no preview
  if (productsError || !productsData) {
    try {
      const fallbackRes = await supabase
        .from('products')
        .select('id, tenant_id, sku, barcode, name, category, subcategory, brand, description, technical_specs, price, promotional_price, wholesale_price, min_order_quantity, stock, unit, images, featured, is_new, active, sort_order, created_at, updated_at, deleted_at')
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .order('category', { ascending: true })
        .order('name', { ascending: true });

      if (!fallbackRes.error && fallbackRes.data) {
        productsData = fallbackRes.data as unknown as RawAdminProductRow[];
        productsError = null;
      }
    } catch {
      // continua para tentar view
    }
  }

  // 3. Fallback adicional via catalog_products se public.products direto falhar por RLS no browser preview
  if (productsError || !productsData) {
    const viewRes = await supabase
      .from('catalog_products')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    if (!viewRes.error && viewRes.data) {
      productsData = viewRes.data as unknown as RawAdminProductRow[];
      productsError = null;
    }
  }

  if (productsError && !productsData) {
    throw new Error(`Falha ao carregar catálogo administrativo do Supabase: [${productsError.code || 'AUTH'}] ${productsError.message}`);
  }

  return (productsData || []).map(row => adaptAdminProduct(row));
}

/**
 * Atualiza um produto individualmente no banco via Supabase (com strict allowlist).
 * Não permite alterar id, tenant_id, created_at nem sku.
 */
export async function updateAdminProduct(
  tenantId: string,
  productId: string,
  updates: AdminProductUpdatePayload
): Promise<Product> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado.');
  }

  if (!isValidUuid(tenantId) || !isValidUuid(productId)) {
    throw new Error('Identificadores inválidos para atualização de produto.');
  }

  // Validação das regras de atacado
  if (updates.wholesaleEnabled) {
    if (updates.wholesalePrice === undefined || updates.wholesalePrice === null || updates.wholesalePrice <= 0) {
      throw new Error('Para produtos que participam do atacado, o Preço de Atacado deve ser maior que zero.');
    }
    if (updates.wholesaleMinQuantity === undefined || updates.wholesaleMinQuantity === null || updates.wholesaleMinQuantity < 1) {
      throw new Error('A quantidade mínima de atacado deve ser maior ou igual a 1.');
    }
  }

  // Construção do payload com strict allowlist
  const dbPayload: Record<string, any> = {
    updated_at: new Date().toISOString()
  };

  if (updates.name !== undefined) dbPayload.name = updates.name.trim();
  if (updates.category !== undefined) dbPayload.category = updates.category.trim();
  if (updates.subcategory !== undefined) dbPayload.subcategory = updates.subcategory ? updates.subcategory.trim() : null;
  if (updates.brand !== undefined) dbPayload.brand = updates.brand ? updates.brand.trim() : null;
  if (updates.description !== undefined) dbPayload.description = updates.description ? updates.description.trim() : null;
  if (updates.price !== undefined) dbPayload.price = Number(updates.price);
  if (updates.promotionalPrice !== undefined) dbPayload.promotional_price = updates.promotionalPrice !== null ? Number(updates.promotionalPrice) : null;
  if (updates.costPrice !== undefined) dbPayload.cost_price = updates.costPrice !== null ? Number(updates.costPrice) : null;
  if (updates.stock !== undefined) dbPayload.stock = Math.max(0, Math.floor(Number(updates.stock)));
  if (updates.active !== undefined) dbPayload.active = Boolean(updates.active);
  if (updates.unit !== undefined) dbPayload.unit = updates.unit;
  if (updates.deletedAt !== undefined) dbPayload.deleted_at = updates.deletedAt;

  // Sanitização estrita de imagens: aceita apenas URLs https:// (rejeita http://, blob:, data:, javascript:, file: e qualquer não HTTPS; trim, sem duplicatas, mantém ordem)
  if (updates.images !== undefined) {
    if (Array.isArray(updates.images)) {
      const sanitizedImages: string[] = [];
      const seenUrls = new Set<string>();

      for (const item of updates.images) {
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

      dbPayload.images = sanitizedImages;
    }
  }

  // Regras estritas de atacado no banco
  if (updates.wholesaleEnabled !== undefined) {
    dbPayload.wholesale_enabled = Boolean(updates.wholesaleEnabled);
    if (updates.wholesaleEnabled) {
      dbPayload.wholesale_price = Number(updates.wholesalePrice);
      dbPayload.wholesale_min_quantity = Math.max(1, Math.floor(Number(updates.wholesaleMinQuantity) || 1));
    } else {
      dbPayload.wholesale_price = null;
      dbPayload.wholesale_min_quantity = null;
    }
  } else if (updates.wholesalePrice !== undefined) {
    dbPayload.wholesale_price = updates.wholesalePrice !== null ? Number(updates.wholesalePrice) : null;
  }

  // Executa update no Supabase
  const { data, error } = await supabase
    .from('products')
    .update(dbPayload)
    .eq('tenant_id', tenantId)
    .eq('id', productId)
    .select();

  if (error) {
    // Se falhar porque a coluna wholesale_enabled não existe na tabela remota ainda, tenta sem ela
    if (error.message && error.message.includes('wholesale_enabled')) {
      delete dbPayload.wholesale_enabled;
      delete dbPayload.wholesale_min_quantity;
      const retry = await supabase
        .from('products')
        .update(dbPayload)
        .eq('tenant_id', tenantId)
        .eq('id', productId)
        .select();
      if (retry.error) {
        throw new Error(`Falha ao persistir no Supabase: ${retry.error.message}`);
      }
      if (retry.data && retry.data.length > 0) {
        return adaptAdminProduct(retry.data[0] as RawAdminProductRow);
      }
    }
    throw new Error(`Falha ao persistir alterações no Supabase: [${error.code || 'ERR'}] ${error.message}`);
  }

  if (data && data.length > 0) {
    return adaptAdminProduct(data[0] as RawAdminProductRow);
  }

  throw new Error('Nenhum registro atualizado. Verifique se o produto pertence a este tenant.');
}

/**
 * Atualiza condicionalmente as imagens de um produto apenas se ele ainda não possuir nenhuma foto cadastrada.
 * Operação atômica projetada para eliminar janelas TOCTOU durante importações em lote.
 * 
 * Regras:
 * - Valida tenantId e productId como UUIDs válidos.
 * - Valida uploadedUrl como URL HTTPS válida.
 * - Atualiza exclusivamente onde:
 *     tenant_id = tenantId
 *     id = productId
 *     deleted_at IS NULL
 *     images = ARRAY[]::text[] (filtro PostgREST: images = '{}')
 * - Retorna { updated: true, product } em caso de sucesso.
 * - Se nenhuma linha for atualizada, assume alteração concorrente / imagem já existente e retorna { updated: false }.
 */
export async function updateAdminProductImagesIfEmpty(
  tenantId: string,
  productId: string,
  uploadedUrl: string
): Promise<{
  updated: boolean;
  product?: Product;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { updated: false, error: 'Supabase não configurado.' };
  }

  if (!isValidUuid(tenantId) || !isValidUuid(productId)) {
    return { updated: false, error: 'Identificadores inválidos (UUID esperado).' };
  }

  if (
    !uploadedUrl ||
    typeof uploadedUrl !== 'string' ||
    !uploadedUrl.trim().toLowerCase().startsWith('https://')
  ) {
    return { updated: false, error: 'URL da imagem deve ser um link HTTPS válido.' };
  }

  const cleanUrl = uploadedUrl.trim();
  const dbPayload = {
    images: [cleanUrl],
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('products')
    .update(dbPayload)
    .eq('tenant_id', tenantId)
    .eq('id', productId)
    .is('deleted_at', null)
    .eq('images', '{}')
    .select();

  if (error) {
    return {
      updated: false,
      error: `[${error.code || 'ERR'}] ${error.message}`
    };
  }

  if (data && data.length > 0) {
    return {
      updated: true,
      product: adaptAdminProduct(data[0] as RawAdminProductRow)
    };
  }

  return {
    updated: false
  };
}

/**
 * Atualiza múltiplos produtos em massa no banco de dados via Supabase.
 */
export async function bulkUpdateAdminProducts(
  tenantId: string,
  productIds: string[],
  updates: Partial<AdminProductUpdatePayload>
): Promise<{ count: number }> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado.');
  }

  if (!isValidUuid(tenantId) || !productIds.length) {
    throw new Error('Identificadores inválidos para atualização em massa.');
  }

  const validIds = productIds.filter(isValidUuid);
  if (validIds.length === 0) {
    throw new Error('Nenhum ID de produto válido fornecido.');
  }

  const dbPayload: Record<string, any> = {
    updated_at: new Date().toISOString()
  };

  if (updates.active !== undefined) dbPayload.active = Boolean(updates.active);
  if (updates.category !== undefined) dbPayload.category = updates.category.trim();
  if (updates.deletedAt !== undefined) dbPayload.deleted_at = updates.deletedAt;
  if (updates.wholesaleEnabled !== undefined) {
    dbPayload.wholesale_enabled = Boolean(updates.wholesaleEnabled);
    if (!updates.wholesaleEnabled) {
      dbPayload.wholesale_price = null;
      dbPayload.wholesale_min_quantity = null;
    } else if (updates.wholesaleMinQuantity !== undefined) {
      dbPayload.wholesale_min_quantity = Math.max(1, Math.floor(Number(updates.wholesaleMinQuantity) || 1));
    }
  }

  const { data, error } = await supabase
    .from('products')
    .update(dbPayload)
    .eq('tenant_id', tenantId)
    .in('id', validIds)
    .select('id');

  if (error) {
    // Tratamento defensivo caso coluna não exista ainda
    if (error.message && error.message.includes('wholesale_enabled')) {
      delete dbPayload.wholesale_enabled;
      delete dbPayload.wholesale_min_quantity;
      const retry = await supabase
        .from('products')
        .update(dbPayload)
        .eq('tenant_id', tenantId)
        .in('id', validIds)
        .select('id');
      if (retry.error) {
        throw new Error(`Falha na atualização em massa no Supabase: ${retry.error.message}`);
      }
      return { count: retry.data?.length || validIds.length };
    }
    throw new Error(`Falha na atualização em massa no Supabase: ${error.message}`);
  }

  return { count: data?.length || validIds.length };
}

/**
 * Exclusão lógica em massa (soft delete: active = false e deleted_at = now()).
 */
export async function bulkSoftDeleteAdminProducts(
  tenantId: string,
  productIds: string[]
): Promise<{ count: number }> {
  return bulkUpdateAdminProducts(tenantId, productIds, {
    active: false,
    deletedAt: new Date().toISOString()
  });
}
