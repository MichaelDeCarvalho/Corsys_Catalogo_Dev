/**
 * Serviço de Acompanhamento Seguro de Pedidos pelo Cliente (Customer Order Tracking V1)
 *
 * ARQUITETURA DE ACESSO:
 * 1. Retail Anônimo:
 *    - Rastreamento seguro via token criptográfico de 256 bits (64 hex lowercase).
 *    - Armazenamento no cliente isolado por tenant (chave: corsys_order_tracking_v1:<slug>).
 *    - Registro local contém exclusivamente { orderNumber, trackingToken, createdAt } (Zero PII e sem tenantSlug interno).
 *    - Invocação da Edge Function 'track-order-by-token' que valida o hash SHA-256 no backend.
 *    - ZERO consulta exposta por CPF, e-mail, telefone ou order_number desprotegido.
 *
 * 2. Atacado (B2B) Autenticado:
 *    - Listagem autenticada dos pedidos do próprio comprador logado.
 *    - Invocação da Edge Function 'list-my-customer-orders' que valida o token JWT e consulta buyer_user_id.
 *    - Suporte a paginação segura (limit/offset).
 */

import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';
import { PaymentMethod } from '../types';

export interface CustomerTrackedOrderItem {
  productId: string;
  productName: string;
  productSku: string;
  productImage: string;
  unitPrice: number;
  quantity: number;
  unit: string;
  totalPrice: number;
  selectedVariant?: string | null;
}

export type TrackedOrderStatus = 'pending' | 'approved' | 'preparing' | 'dispatched' | 'delivered' | 'cancelled';

export interface CustomerTrackedOrder {
  orderNumber: string;
  status: TrackedOrderStatus;
  shoppingMode: 'retail' | 'wholesale';
  deliveryMethod: string;
  paymentMethod: PaymentMethod;
  items: CustomerTrackedOrderItem[];
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerOrderListResult {
  orders: CustomerTrackedOrder[];
  total: number;
  limit: number;
  offset: number;
}

export interface StoredRetailOrderTracking {
  orderNumber: string;
  trackingToken: string;
  createdAt: string;
}

const LEGACY_STORAGE_KEY = 'corsys_customer_retail_orders_v1';
const HEX_64_REGEX = /^[a-f0-9]{64}$/i;
const VALID_STATUSES = new Set(['pending', 'approved', 'preparing', 'dispatched', 'delivered', 'cancelled']);

function getTenantStorageKey(tenantSlug: string): string {
  const normalized = (tenantSlug || '').trim().toLowerCase();
  return `corsys_order_tracking_v1:${normalized}`;
}

/**
 * Validador em runtime fail-closed para objetos CustomerTrackedOrder.
 * Rejeita objetos malformados ou que contenham tipos inválidos.
 */
export function validateCustomerTrackedOrder(raw: unknown): CustomerTrackedOrder {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Formato de pedido inválido.');
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.orderNumber !== 'string' || !obj.orderNumber.trim()) {
    throw new Error('Número de pedido inválido.');
  }

  if (typeof obj.status !== 'string' || !VALID_STATUSES.has(obj.status)) {
    throw new Error('Status de pedido inválido.');
  }

  if (obj.shoppingMode !== 'retail' && obj.shoppingMode !== 'wholesale') {
    throw new Error('Modalidade de compra inválida.');
  }

  if (typeof obj.deliveryMethod !== 'string') {
    throw new Error('Método de entrega inválido.');
  }

  if (typeof obj.paymentMethod !== 'string') {
    throw new Error('Forma de pagamento inválida.');
  }

  if (!Array.isArray(obj.items)) {
    throw new Error('Lista de itens inválida.');
  }

  const items: CustomerTrackedOrderItem[] = obj.items.map((it: unknown) => {
    if (!it || typeof it !== 'object') {
      throw new Error('Item de pedido malformado.');
    }
    const itemObj = it as Record<string, unknown>;
    return {
      productId: String(itemObj.productId || ''),
      productName: String(itemObj.productName || ''),
      productSku: String(itemObj.productSku || ''),
      productImage: String(itemObj.productImage || ''),
      unitPrice: typeof itemObj.unitPrice === 'number' ? itemObj.unitPrice : 0,
      quantity: typeof itemObj.quantity === 'number' ? itemObj.quantity : 1,
      unit: String(itemObj.unit || 'un'),
      totalPrice: typeof itemObj.totalPrice === 'number' ? itemObj.totalPrice : 0,
      selectedVariant: typeof itemObj.selectedVariant === 'string' ? itemObj.selectedVariant : null,
    };
  });

  const subtotal = typeof obj.subtotal === 'number' && Number.isFinite(obj.subtotal) ? obj.subtotal : 0;
  const discount = typeof obj.discount === 'number' && Number.isFinite(obj.discount) ? obj.discount : 0;
  const shippingFee = typeof obj.shippingFee === 'number' && Number.isFinite(obj.shippingFee) ? obj.shippingFee : 0;
  const total = typeof obj.total === 'number' && Number.isFinite(obj.total) ? obj.total : 0;

  if (typeof obj.createdAt !== 'string' || isNaN(Date.parse(obj.createdAt))) {
    throw new Error('Data de criação inválida.');
  }

  const updatedAt = typeof obj.updatedAt === 'string' && !isNaN(Date.parse(obj.updatedAt))
    ? obj.updatedAt
    : obj.createdAt;

  return {
    orderNumber: obj.orderNumber.trim(),
    status: obj.status as TrackedOrderStatus,
    shoppingMode: obj.shoppingMode,
    deliveryMethod: obj.deliveryMethod,
    paymentMethod: obj.paymentMethod as PaymentMethod,
    items,
    subtotal,
    discount,
    shippingFee,
    total,
    createdAt: obj.createdAt,
    updatedAt,
  };
}

/**
 * Migração client-side segura e sob demanda da chave global legada
 */
function migrateLegacyStorageIfNeeded(tenantSlug: string): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    const rawLegacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!rawLegacy) return;

    const parsed = JSON.parse(rawLegacy);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      return;
    }

    const normalizedTarget = tenantSlug.trim().toLowerCase();
    const forThisTenant: StoredRetailOrderTracking[] = [];
    const remainingOthers: unknown[] = [];

    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof item.tenantSlug === 'string' &&
        item.tenantSlug.trim().toLowerCase() === normalizedTarget &&
        typeof item.orderNumber === 'string' &&
        item.orderNumber.trim() &&
        typeof item.trackingToken === 'string' &&
        HEX_64_REGEX.test(item.trackingToken.trim()) &&
        typeof item.createdAt === 'string' &&
        !isNaN(Date.parse(item.createdAt))
      ) {
        forThisTenant.push({
          orderNumber: item.orderNumber.trim(),
          trackingToken: item.trackingToken.trim().toLowerCase(),
          createdAt: item.createdAt,
        });
      } else {
        remainingOthers.push(item);
      }
    }

    if (forThisTenant.length > 0) {
      const storageKey = getTenantStorageKey(tenantSlug);
      const existingRaw = window.localStorage.getItem(storageKey);
      let currentItems: StoredRetailOrderTracking[] = [];
      if (existingRaw) {
        try {
          const parsedExisting = JSON.parse(existingRaw);
          if (Array.isArray(parsedExisting)) {
            currentItems = parsedExisting;
          }
        } catch {
          currentItems = [];
        }
      }

      const existingNumbers = new Set(currentItems.map(i => i.orderNumber));
      const newItemsToAdd = forThisTenant.filter(i => !existingNumbers.has(i.orderNumber));
      const combined = [...currentItems, ...newItemsToAdd].slice(0, 50);
      window.localStorage.setItem(storageKey, JSON.stringify(combined));
    }

    if (remainingOthers.length === 0) {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } else {
      window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(remainingOthers));
    }
  } catch {
    // Fail-safe em caso de erro de parsing no storage
  }
}

/**
 * Lê pedidos de varejo salvos localmente para o tenant especificado
 */
export function getStoredRetailTrackings(tenantSlug: string): StoredRetailOrderTracking[] {
  if (typeof window === 'undefined' || !window.localStorage || !tenantSlug) {
    return [];
  }

  // Executa migração sob demanda da chave legada se existir
  migrateLegacyStorageIfNeeded(tenantSlug);

  try {
    const storageKey = getTenantStorageKey(tenantSlug);
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const seenOrderNumbers = new Set<string>();
    const validTrackings: StoredRetailOrderTracking[] = [];

    for (const item of parsed) {
      if (
        item &&
        typeof item.orderNumber === 'string' &&
        item.orderNumber.trim() &&
        typeof item.trackingToken === 'string' &&
        HEX_64_REGEX.test(item.trackingToken.trim()) &&
        typeof item.createdAt === 'string' &&
        !isNaN(Date.parse(item.createdAt))
      ) {
        const orderNum = item.orderNumber.trim();
        if (!seenOrderNumbers.has(orderNum)) {
          seenOrderNumbers.add(orderNum);
          validTrackings.push({
            orderNumber: orderNum,
            trackingToken: item.trackingToken.trim().toLowerCase(),
            createdAt: item.createdAt,
          });
        }
      }
    }

    return validTrackings.slice(0, 50);
  } catch {
    return [];
  }
}

/**
 * Salva novo par { orderNumber, trackingToken, createdAt } de varejo isolado por tenant
 */
export function storeRetailOrderTracking(tenantSlug: string, item: StoredRetailOrderTracking): void {
  if (typeof window === 'undefined' || !window.localStorage || !tenantSlug || !item) {
    return;
  }

  if (
    typeof item.orderNumber !== 'string' ||
    !item.orderNumber.trim() ||
    typeof item.trackingToken !== 'string' ||
    !HEX_64_REGEX.test(item.trackingToken.trim()) ||
    typeof item.createdAt !== 'string' ||
    isNaN(Date.parse(item.createdAt))
  ) {
    return;
  }

  try {
    const storageKey = getTenantStorageKey(tenantSlug);
    const current = getStoredRetailTrackings(tenantSlug);
    const filtered = current.filter(t => t.orderNumber !== item.orderNumber.trim());
    const cleanItem: StoredRetailOrderTracking = {
      orderNumber: item.orderNumber.trim(),
      trackingToken: item.trackingToken.trim().toLowerCase(),
      createdAt: item.createdAt,
    };
    const updated = [cleanItem, ...filtered].slice(0, 50);
    window.localStorage.setItem(storageKey, JSON.stringify(updated));
  } catch {
    // Silencioso em caso de restrição de storage
  }
}

/**
 * Remove rastreamento local de um pedido para o tenant especificado
 */
export function removeStoredRetailTracking(tenantSlug: string, orderNumber: string): void {
  if (typeof window === 'undefined' || !window.localStorage || !tenantSlug || !orderNumber) {
    return;
  }
  try {
    const storageKey = getTenantStorageKey(tenantSlug);
    const current = getStoredRetailTrackings(tenantSlug);
    const updated = current.filter(t => t.orderNumber !== orderNumber.trim());
    window.localStorage.setItem(storageKey, JSON.stringify(updated));
  } catch {
    // Silencioso
  }
}

/**
 * Consulta pedido seguro por token de varejo via Edge Function 'track-order-by-token'
 */
export async function trackOrderByToken(tenantSlug: string, trackingToken: string): Promise<CustomerTrackedOrder> {
  if (!isSupabaseConfigured()) {
    throw new Error('Serviço de rastreamento temporariamente indisponível.');
  }

  const cleanToken = trackingToken.trim().toLowerCase();
  if (!HEX_64_REGEX.test(cleanToken)) {
    throw new Error('Token de rastreamento inválido (deve possuir 64 caracteres hexadecimais).');
  }

  const cleanSlug = tenantSlug.trim();
  if (!cleanSlug) {
    throw new Error('Identificador da loja inválido.');
  }

  const client = getSupabaseClient();
  const { data, error } = await client.functions.invoke('track-order-by-token', {
    body: {
      tenantSlug: cleanSlug,
      trackingToken: cleanToken,
    },
  });

  if (error) {
    const message = error.message || 'Não foi possível localizar o pedido.';
    throw new Error(message);
  }

  if (!data?.success || !data?.order) {
    throw new Error(data?.error || 'Pedido não encontrado.');
  }

  // Validação estrita em runtime (fail-closed)
  return validateCustomerTrackedOrder(data.order);
}

/**
 * Lista pedidos do comprador B2B autenticado via Edge Function 'list-my-customer-orders'
 */
export async function listMyCustomerOrders(
  tenantSlug: string,
  pagination?: { limit?: number; offset?: number }
): Promise<CustomerOrderListResult> {
  if (!isSupabaseConfigured()) {
    throw new Error('Serviço de histórico de pedidos temporariamente indisponível.');
  }

  const cleanSlug = tenantSlug.trim();
  if (!cleanSlug) {
    throw new Error('Identificador da loja inválido.');
  }

  const client = getSupabaseClient();
  const { data: sessionData } = await client.auth.getSession();
  const session = sessionData?.session;

  if (!session || !session.access_token) {
    throw new Error('Faça login para visualizar seus pedidos de atacado.');
  }

  const { data, error } = await client.functions.invoke('list-my-customer-orders', {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
    body: {
      tenantSlug: cleanSlug,
      limit: pagination?.limit ?? 20,
      offset: pagination?.offset ?? 0,
    },
  });

  if (error) {
    const message = error.message || 'Erro ao carregar histórico de pedidos.';
    throw new Error(message);
  }

  if (!data?.success) {
    throw new Error(data?.error || 'Erro ao carregar histórico de pedidos.');
  }

  const rawOrders = Array.isArray(data.orders) ? data.orders : [];
  const validatedOrders: CustomerTrackedOrder[] = [];

  for (const rawOrder of rawOrders) {
    try {
      validatedOrders.push(validateCustomerTrackedOrder(rawOrder));
    } catch {
      // Rejeita pedido malformado
    }
  }

  return {
    orders: validatedOrders,
    total: typeof data.total === 'number' ? data.total : validatedOrders.length,
    limit: data.limit || 20,
    offset: data.offset || 0,
  };
}
