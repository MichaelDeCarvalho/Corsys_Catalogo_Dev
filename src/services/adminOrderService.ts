/**
 * Serviço administrativo oficial de gestão de pedidos via Supabase.
 *
 * DIRETRIZES:
 * 1. Utilizado exclusivamente por gestores e administradores no Painel da Loja.
 * 2. Consulta a tabela 'public.orders' protegida por RLS e filtrada pelo tenant_id.
 * 3. Preserva valores reais e tipos estritos dos pedidos registrados no banco.
 * 4. Não faz merge com dados simulados e não utiliza fallback em memória.
 * 5. Validação Fail-Closed rigorosa de todos os campos antes de expor à interface.
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Order, OrderItem, OrderStatus, PaymentMethod } from '../types';

export interface RawAdminOrderRow {
  id: string;
  tenant_id: string;
  order_number: string;
  seller_id: string | null;
  seller_code: string | null;
  customer: unknown;
  shipping_address: unknown;
  items: unknown;
  subtotal: number | string;
  discount: number | string;
  shipping_fee: number | string;
  total: number | string;
  status: string;
  payment_method: string;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
  shopping_mode?: string | null;
  delivery_method?: string | null;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID_REGEX.test(id.trim());
}

export const ALLOWED_ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'approved',
  'preparing',
  'dispatched',
  'delivered',
  'cancelled'
];

export const ALLOWED_PAYMENT_METHODS: PaymentMethod[] = [
  'pix',
  'boleto',
  'credit_card',
  'cash_on_delivery'
];

export const ALLOWED_SOURCES = ['sales_rep', 'whatsapp', 'web_checkout'] as const;

/**
 * Adapter Fail-Closed: converte registro snake_case da tabela public.orders para Order tipado.
 * Rejeita explicitamente registros incompletos, malformados ou corrompidos sem mascarar dados.
 */
export function adaptAdminOrder(row: RawAdminOrderRow): Order {
  if (!row || typeof row !== 'object') {
    throw new Error('Registro de pedido inválido: payload nulo ou não é um objeto.');
  }

  // 1. Validação de Identificadores (UUID)
  if (!isValidUuid(row.id)) {
    throw new Error(`Registro de pedido inválido: id "${row.id}" não é um UUID válido.`);
  }

  if (!isValidUuid(row.tenant_id)) {
    throw new Error(`Registro de pedido inválido: tenant_id "${row.tenant_id}" não é um UUID válido.`);
  }

  // 2. Validação de Número do Pedido
  if (typeof row.order_number !== 'string' || !row.order_number.trim()) {
    throw new Error(`Registro de pedido inválido: order_number ausente ou vazio.`);
  }
  const orderNumber = row.order_number.trim();

  // 3. Validação de Cliente (JSONB)
  if (!row.customer || typeof row.customer !== 'object' || Array.isArray(row.customer)) {
    throw new Error(`Registro de pedido ${orderNumber} inválido: dados de customer ausentes ou malformados.`);
  }
  const rawCustomer = row.customer as Record<string, unknown>;
  const customerName = typeof rawCustomer.name === 'string' ? rawCustomer.name.trim() : '';
  const customerPhone = typeof rawCustomer.phone === 'string' ? rawCustomer.phone.trim() : '';

  if (!customerName) {
    throw new Error(`Registro de pedido ${orderNumber} inválido: nome do cliente ausente.`);
  }
  if (!customerPhone) {
    throw new Error(`Registro de pedido ${orderNumber} inválido: telefone do cliente ausente.`);
  }

  const customerEmail = typeof rawCustomer.email === 'string' && rawCustomer.email.trim()
    ? rawCustomer.email.trim()
    : undefined;
  const customerType: 'PF' | 'PJ' = rawCustomer.type === 'PJ' ? 'PJ' : 'PF';
  const customerDocument = typeof rawCustomer.document === 'string' && rawCustomer.document.trim()
    ? rawCustomer.document.trim()
    : undefined;
  const customerCompanyName = typeof rawCustomer.companyName === 'string' && rawCustomer.companyName.trim()
    ? rawCustomer.companyName.trim()
    : (typeof rawCustomer.company_name === 'string' && rawCustomer.company_name.trim() ? rawCustomer.company_name.trim() : undefined);

  // 4. Validação de Endereço de Entrega (JSONB)
  if (!row.shipping_address || typeof row.shipping_address !== 'object' || Array.isArray(row.shipping_address)) {
    throw new Error(`Registro de pedido ${orderNumber} inválido: dados de shipping_address ausentes ou malformados.`);
  }
  const rawAddress = row.shipping_address as Record<string, unknown>;
  const street = typeof rawAddress.street === 'string' ? rawAddress.street.trim() : '';
  if (!street) {
    throw new Error(`Registro de pedido ${orderNumber} inválido: rua de entrega ausente.`);
  }

  const addressNumber = typeof rawAddress.number === 'string' && rawAddress.number.trim()
    ? rawAddress.number.trim()
    : (typeof rawAddress.number === 'number' && Number.isFinite(rawAddress.number) ? String(rawAddress.number) : undefined);
  const complement = typeof rawAddress.complement === 'string' && rawAddress.complement.trim()
    ? rawAddress.complement.trim()
    : undefined;
  const neighborhood = typeof rawAddress.neighborhood === 'string' && rawAddress.neighborhood.trim()
    ? rawAddress.neighborhood.trim()
    : undefined;
  const city = typeof rawAddress.city === 'string' && rawAddress.city.trim()
    ? rawAddress.city.trim()
    : undefined;
  const state = typeof rawAddress.state === 'string' && rawAddress.state.trim()
    ? rawAddress.state.trim()
    : undefined;
  const zipCode = typeof rawAddress.zipCode === 'string' && rawAddress.zipCode.trim()
    ? rawAddress.zipCode.trim()
    : (typeof rawAddress.cep === 'string' && rawAddress.cep.trim() ? rawAddress.cep.trim() : undefined);

  // 5. Validação de Itens (JSONB Array)
  if (!Array.isArray(row.items) || row.items.length === 0) {
    throw new Error(`Registro de pedido ${orderNumber} inválido: lista de itens vazia ou inválida.`);
  }

  const items: OrderItem[] = row.items.map((rawItem: unknown, idx: number) => {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      throw new Error(`Item ${idx} no pedido ${orderNumber} inválido.`);
    }
    const it = rawItem as Record<string, unknown>;

    const productId = typeof it.productId === 'string'
      ? it.productId.trim()
      : (typeof it.product_id === 'string' ? it.product_id.trim() : '');

    if (!isValidUuid(productId)) {
      throw new Error(`Item ${idx} no pedido ${orderNumber} possui productId inválido.`);
    }

    const productName = typeof it.productName === 'string'
      ? it.productName.trim()
      : (typeof it.name === 'string' ? it.name.trim() : '');
    if (!productName) {
      throw new Error(`Item ${idx} no pedido ${orderNumber} possui productName ausente.`);
    }

    const productSku = typeof it.productSku === 'string'
      ? it.productSku.trim()
      : (typeof it.sku === 'string' ? it.sku.trim() : '');
    if (!productSku) {
      throw new Error(`Item ${idx} no pedido ${orderNumber} possui productSku ausente.`);
    }

    const productImage = typeof it.productImage === 'string'
      ? it.productImage.trim()
      : (typeof it.image === 'string' ? it.image.trim() : '');

    const unitPrice = typeof it.unitPrice === 'number'
      ? it.unitPrice
      : Number(it.unitPrice ?? it.unit_price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error(`Item ${idx} no pedido ${orderNumber} possui unitPrice inválido: ${unitPrice}`);
    }

    const quantity = typeof it.quantity === 'number' ? it.quantity : Number(it.quantity);
    if (!Number.isFinite(quantity) || quantity < 1 || !Number.isInteger(quantity)) {
      throw new Error(`Item ${idx} no pedido ${orderNumber} possui quantity inválido: ${quantity}`);
    }

    const unit = typeof it.unit === 'string' && it.unit.trim() ? it.unit.trim() : 'un';

    const totalPrice = typeof it.totalPrice === 'number'
      ? it.totalPrice
      : Number(it.totalPrice ?? it.total_price);
    if (!Number.isFinite(totalPrice) || totalPrice < 0) {
      throw new Error(`Item ${idx} no pedido ${orderNumber} possui totalPrice inválido: ${totalPrice}`);
    }

    const selectedVariant = typeof it.selectedVariant === 'string' && it.selectedVariant.trim()
      ? it.selectedVariant.trim()
      : (typeof it.selected_variant === 'string' && it.selected_variant.trim() ? it.selected_variant.trim() : undefined);

    return {
      productId,
      productName,
      productSku,
      productImage,
      unitPrice,
      quantity,
      unit,
      totalPrice,
      selectedVariant
    };
  });

  // 6. Validação de Valores Financeiros Finitos
  const subtotal = typeof row.subtotal === 'number' ? row.subtotal : Number(row.subtotal);
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    throw new Error(`Registro de pedido ${orderNumber} possui subtotal inválido: ${row.subtotal}`);
  }

  const discount = typeof row.discount === 'number' ? row.discount : Number(row.discount ?? 0);
  if (!Number.isFinite(discount) || discount < 0) {
    throw new Error(`Registro de pedido ${orderNumber} possui discount inválido: ${row.discount}`);
  }

  const shippingFee = typeof row.shipping_fee === 'number' ? row.shipping_fee : Number(row.shipping_fee ?? 0);
  if (!Number.isFinite(shippingFee) || shippingFee < 0) {
    throw new Error(`Registro de pedido ${orderNumber} possui shipping_fee inválido: ${row.shipping_fee}`);
  }

  const total = typeof row.total === 'number' ? row.total : Number(row.total);
  if (!Number.isFinite(total) || total < 0) {
    throw new Error(`Registro de pedido ${orderNumber} possui total inválido: ${row.total}`);
  }

  // 7. Validação de Status Permitido
  if (!ALLOWED_ORDER_STATUSES.includes(row.status as OrderStatus)) {
    throw new Error(`Status de pedido não permitido no pedido ${orderNumber}: "${row.status}"`);
  }
  const status = row.status as OrderStatus;

  // 8. Validação de Forma de Pagamento Permitida
  if (!ALLOWED_PAYMENT_METHODS.includes(row.payment_method as PaymentMethod)) {
    throw new Error(`Forma de pagamento não permitida no pedido ${orderNumber}: "${row.payment_method}"`);
  }
  const paymentMethod = row.payment_method as PaymentMethod;

  // 9. Validação de Datas
  if (!row.created_at || isNaN(Date.parse(row.created_at))) {
    throw new Error(`Data created_at inválida no pedido ${orderNumber}: "${row.created_at}"`);
  }
  if (!row.updated_at || isNaN(Date.parse(row.updated_at))) {
    throw new Error(`Data updated_at inválida no pedido ${orderNumber}: "${row.updated_at}"`);
  }

  // 10. Resolução de Metadados Opcionais
  const sellerId = row.seller_id && isValidUuid(row.seller_id) ? row.seller_id : undefined;
  const sellerCode = typeof row.seller_code === 'string' && row.seller_code.trim() ? row.seller_code.trim() : undefined;
  const notes = typeof row.notes === 'string' && row.notes.trim() ? row.notes.trim() : undefined;
  const source = (ALLOWED_SOURCES as readonly string[]).includes(row.source)
    ? (row.source as Order['source'])
    : 'web_checkout';

  const shoppingMode = row.shopping_mode === 'wholesale'
    ? 'wholesale'
    : (row.shopping_mode === 'retail' ? 'retail' : undefined);

  const deliveryMethod = typeof row.delivery_method === 'string' && row.delivery_method.trim()
    ? row.delivery_method.trim()
    : undefined;

  return {
    id: row.id,
    orderNumber,
    tenantId: row.tenant_id,
    sellerId,
    sellerCode,
    customer: {
      name: customerName,
      phone: customerPhone,
      email: customerEmail,
      type: customerType,
      document: customerDocument,
      companyName: customerCompanyName
    },
    shippingAddress: {
      street,
      number: addressNumber,
      complement,
      neighborhood,
      city,
      state,
      zipCode
    },
    items,
    subtotal,
    discount,
    shippingFee,
    total,
    status,
    paymentMethod,
    notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source,
    shoppingMode,
    deliveryMethod
  };
}

/**
 * Consulta a lista oficial de pedidos de um tenant a partir do Supabase (public.orders).
 *
 * REQUISITOS:
 * - Supabase devidamente configurado.
 * - tenantId validado rigorosamente como UUID v4.
 * - Filtro explícito: tenant_id = tenantId.
 * - Autorização server-side garantida por RLS (orders_select_tenant_admin / platform_admin).
 * - Ordenação: created_at DESC (pedidos mais recentes no topo).
 * - Zero fallback para mock e zero leitura de cache local de navegador.
 */
export async function fetchAdminOrders(tenantId: string): Promise<Order[]> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Verifique as credenciais no ambiente.');
  }

  if (!tenantId || !isValidUuid(tenantId)) {
    throw new Error('Contexto administrativo inválido: tenant_id real do Supabase não foi resolvido.');
  }

  const { data, error } = await supabase
    .from('orders')
    .select(`
      id,
      tenant_id,
      order_number,
      seller_id,
      seller_code,
      customer,
      shipping_address,
      items,
      subtotal,
      discount,
      shipping_fee,
      total,
      status,
      payment_method,
      notes,
      source,
      created_at,
      updated_at,
      shopping_mode,
      delivery_method
    `)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[adminOrderService] Erro ao consultar public.orders:', error);
    throw new Error(`Falha ao consultar pedidos administrativos: ${error.message}`);
  }

  if (!data || !Array.isArray(data)) {
    return [];
  }

  return (data as RawAdminOrderRow[]).map(adaptAdminOrder);
}

/**
 * Atualiza o status do pedido de forma transacional e segura no servidor.
 * Execução delegada estritamente para a Edge Function manage-order-status e RPC manage_order_status_internal.
 */
export async function updateAdminOrderStatus(
  orderId: string,
  newStatus: OrderStatus
): Promise<{ id: string; orderNumber: string; status: OrderStatus; updatedAt: string }> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Verifique as credenciais no ambiente.');
  }

  if (!orderId || !isValidUuid(orderId)) {
    throw new Error('Identificador de pedido inválido.');
  }

  if (!ALLOWED_ORDER_STATUSES.includes(newStatus)) {
    throw new Error(`Status de pedido inválido: "${newStatus}".`);
  }

  const { data, error } = await supabase.functions.invoke('manage-order-status', {
    body: { orderId, newStatus }
  });

  if (error) {
    console.error('[adminOrderService] Erro ao atualizar status via Edge Function:', error);
    let errorMsg = error.message;
    if (error && typeof error === 'object' && 'context' in error) {
      try {
        const ctx = error.context as Response;
        if (ctx && typeof ctx.json === 'function') {
          const body = await ctx.json();
          if (body?.error) errorMsg = body.error;
        }
      } catch {
        // ignora
      }
    }
    throw new Error(errorMsg || 'Falha ao atualizar status do pedido.');
  }

  if (!data?.success || !data?.order) {
    throw new Error(data?.error || 'Resposta inválida do servidor ao atualizar status.');
  }

  return {
    id: data.order.id,
    orderNumber: data.order.order_number,
    status: data.order.status as OrderStatus,
    updatedAt: data.order.updated_at
  };
}

/**
 * Solicita a geração/obtenção da Signed URL do PDF oficial do pedido a partir
 * do bucket privado 'order-documents' via Edge Function dedicada generate-admin-order-pdf.
 */
export async function generateAdminOrderPdf(
  orderId: string
): Promise<{ documentUrl: string; orderNumber: string; expiresIn: number }> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Verifique as credenciais no ambiente.');
  }

  if (!orderId || !isValidUuid(orderId)) {
    throw new Error('Identificador de pedido inválido.');
  }

  const { data, error } = await supabase.functions.invoke('generate-admin-order-pdf', {
    body: { orderId }
  });

  if (error) {
    console.error('[adminOrderService] Erro ao obter PDF via Edge Function:', error);
    let errorMsg = error.message;
    if (error && typeof error === 'object' && 'context' in error) {
      try {
        const ctx = error.context as Response;
        if (ctx && typeof ctx.json === 'function') {
          const body = await ctx.json();
          if (body?.error) errorMsg = body.error;
        }
      } catch {
        // ignora
      }
    }
    throw new Error(errorMsg || 'Falha ao gerar documento PDF do pedido.');
  }

  if (!data?.success || !data?.documentUrl || typeof data.documentUrl !== 'string') {
    throw new Error(data?.error || 'Documento PDF não retornado pelo servidor.');
  }

  return {
    documentUrl: data.documentUrl,
    orderNumber: typeof data.orderNumber === 'string' ? data.orderNumber : '',
    expiresIn: typeof data.expiresIn === 'number' ? data.expiresIn : 600
  };
}

// Alias para compatibilidade
export const getOrderPdfDocument = generateAdminOrderPdf;

