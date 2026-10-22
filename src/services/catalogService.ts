/**
 * Serviço oficial de catálogo e configurações públicas via Supabase.
 * 
 * DIRETRIZES DA ETAPA 5B:
 * 1. Supabase é a fonte oficial da verdade comercial para o Storefront público.
 * 2. Consulta de produtos é realizada EXCLUSIVAMENTE via VIEW pública 'public.catalog_products'.
 * 3. Projeção estrita e explícita de colunas (sem cost_price).
 * 4. Adapter único e determinístico para conversão snake_case -> camelCase.
 * 5. Não há fallback silencioso para dados mock caso ocorra falha no Supabase.
 */

import { parseCheckoutFields } from '../config/checkoutFields';
import { getPublicCatalogClient, isSupabaseConfigured } from '../lib/supabase';
import { TenantPublicSettings, Product } from '../types';

export interface RawTenantPublicSettingsRow {
  tenant_id: string;
  slug: string;
  public_name: string;
  whatsapp_number: string;
  logo_url: string | null;
  banner_url: string | null;
  primary_color: string;
  accent_color: string;
  min_order_value: number | string;
  wholesale_min_order_value: number | string | null;
  allow_b2b_mode: boolean;
  hide_prices_without_login: boolean;
  checkout_fields: unknown;
  delivery_methods: string[] | Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface RawCatalogProductRow {
  id: string;
  tenant_id: string;
  name: string;
  sku: string;
  barcode: string | null;
  category: string;
  subcategory: string | null;
  brand: string | null;
  description: string | null;
  technical_specs: Record<string, unknown> | null;
  price: number | string;
  promotional_price: number | string | null;
  min_order_quantity: number | string;
  stock: number | string;
  unit: string | null;
  images: string[] | null;
  featured: boolean | null;
  is_new: boolean | null;
  sort_order: number | string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Adapter: converte registro snake_case de tenant_public_settings para TenantPublicSettings tipado.
 */
export function adaptTenantPublicSettings(row: RawTenantPublicSettingsRow): TenantPublicSettings {
  let deliveryMethods: string[] = [];
  if (Array.isArray(row.delivery_methods)) {
    deliveryMethods = row.delivery_methods.map(String);
  } else if (typeof row.delivery_methods === 'object' && row.delivery_methods !== null) {
    deliveryMethods = Object.keys(row.delivery_methods).filter(k => Boolean((row.delivery_methods as Record<string, unknown>)[k]));
  }

  return {
    tenantId: row.tenant_id,
    slug: row.slug,
    publicName: row.public_name || 'Catálogo Oficial',
    whatsappNumber: row.whatsapp_number || '',
    logoUrl: row.logo_url || null,
    bannerUrl: row.banner_url || null,
    primaryColor: row.primary_color || '#0F172A',
    accentColor: row.accent_color || '#FF5A00',
    minOrderValue: typeof row.min_order_value === 'number' ? row.min_order_value : Number(row.min_order_value) || 0,
    wholesaleMinOrderValue: row.wholesale_min_order_value !== null && row.wholesale_min_order_value !== undefined 
      ? (typeof row.wholesale_min_order_value === 'number' ? row.wholesale_min_order_value : Number(row.wholesale_min_order_value) || 0)
      : null,
    allowB2bMode: Boolean(row.allow_b2b_mode),
    hidePricesWithoutLogin: Boolean(row.hide_prices_without_login),
    checkoutFields: parseCheckoutFields(row.checkout_fields),
    deliveryMethods,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Adapter: converte registro snake_case da view catalog_products para Product tipado.
 * Nota de Segurança: A view pública 'public.catalog_products' expõe apenas preços de varejo.
 * Preços atacadistas NUNCA são inferidos da view pública e entram no Product somente via RPC get_wholesale_catalog.
 */
export function adaptCatalogProduct(row: RawCatalogProductRow): Product {
  const price = typeof row.price === 'number' ? row.price : Number(row.price) || 0;
  const promotionalPrice = row.promotional_price !== null && row.promotional_price !== undefined
    ? (typeof row.promotional_price === 'number' ? row.promotional_price : Number(row.promotional_price))
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
    category: row.category || 'Geral',
    subcategory: row.subcategory || null,
    brand: row.brand || null,
    description: row.description || '',
    technicalSpecs: row.technical_specs || {},
    costPrice: null, // Propositalmente nulo: cost_price NUNCA é lido ou exposto pelo storefront
    price,
    promotionalPrice,
    wholesalePrice: null,
    wholesaleEnabled: false,
    wholesaleMinQuantity: null,
    wholesaleTiers: [], // Sem tiers artificiais na fonte oficial
    minOrderQuantity,
    stock,
    unit: row.unit || 'un',
    images: Array.isArray(row.images) ? row.images.filter(Boolean) : [],
    featured: Boolean(row.featured),
    isNew: Boolean(row.is_new),
    active: true, // View catalog_products filtra apenas ativos (active = true AND deleted_at IS NULL)
    sortOrder,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Consulta as configurações públicas do tenant pelo slug canônico.
 */
export async function fetchTenantPublicSettings(slug: string): Promise<TenantPublicSettings> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no ambiente.');
  }

  const { data, error } = await getPublicCatalogClient()
    .from('tenant_public_settings')
    .select('tenant_id, slug, public_name, whatsapp_number, logo_url, banner_url, primary_color, accent_color, min_order_value, wholesale_min_order_value, allow_b2b_mode, hide_prices_without_login, delivery_methods, checkout_fields, created_at, updated_at')
    .eq('slug', slug);

  if (error) {
    throw new Error(`Falha ao consultar configurações públicas da loja (${slug}): ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error(`Configuração pública não encontrada para o slug "${slug}".`);
  }

  if (data.length > 1) {
    throw new Error(`Erro de integridade: múltiplas configurações encontradas para o slug "${slug}".`);
  }

  return adaptTenantPublicSettings(data[0] as RawTenantPublicSettingsRow);
}

/**
 * Consulta o catálogo público de produtos de um tenant através da VIEW catalog_products.
 */
export async function fetchCatalogProducts(tenantId: string): Promise<Product[]> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no ambiente.');
  }

  const { data, error } = await getPublicCatalogClient()
    .from('catalog_products')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`Falha ao carregar produtos do catálogo público: ${error.message}`);
  }

  return (data || []).map(row => adaptCatalogProduct(row as RawCatalogProductRow));
}

/**
 * Carrega simultaneamente as configurações públicas e o catálogo real para o Storefront.
 */
export async function loadStorefrontData(slug: string): Promise<{
  settings: TenantPublicSettings;
  products: Product[];
}> {
  const settings = await fetchTenantPublicSettings(slug);
  const products = await fetchCatalogProducts(settings.tenantId);
  return { settings, products };
}
