import { FunctionsHttpError, FunctionsFetchError, FunctionsRelayError } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';
import { PaymentMethod } from '../types';
import { normalizeBrazilianDocument, isValidCPF, isValidCNPJ } from '../utils/brDocument';

export type CheckoutShoppingMode = 'retail' | 'wholesale';

export interface CheckoutItemInput {
  productId: string;
  quantity: number;
  selectedVariant?: string | null;
}

export interface CheckoutCustomerInput {
  name?: string;
  document?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  type?: 'PF' | 'PJ';
}

export interface CheckoutShippingAddressInput {
  street: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

export interface SubmitOrderCheckoutDraft {
  tenantSlug: string;
  shoppingMode: CheckoutShoppingMode;
  items: CheckoutItemInput[];
  customer?: CheckoutCustomerInput;
  shippingAddress: CheckoutShippingAddressInput;
  paymentMethod: PaymentMethod;
  deliveryMethod: string;
  notes?: string;
  sellerCode?: string;
}

export interface CheckoutOrderItemReceipt {
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

export interface CheckoutOrderReceipt {
  id: string;
  orderNumber: string;
  shoppingMode: CheckoutShoppingMode;
  deliveryMethod: string;
  items: CheckoutOrderItemReceipt[];
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  status: 'pending';
  paymentMethod: PaymentMethod;
  createdAt: string;
  documentUrl?: string | null;
  documentExpiresAt?: string | null;
}

export class OrderCheckoutError extends Error {
  status?: number;
  kind?: string;

  constructor(message: string, options?: { status?: number; kind?: string }) {
    super(message);
    this.name = 'OrderCheckoutError';
    this.status = options?.status;
    this.kind = options?.kind;
  }
}

// In-memory fallback para idempotência se sessionStorage estiver desabilitado ou indisponível
const inMemoryAttemptStore = new Map<string, { fingerprintHash: string; idempotencyKey: string; createdAt: number }>();

const ATTEMPT_STORAGE_PREFIX = 'corsys_checkout_attempt_v1';
const ATTEMPT_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas

export function getAttemptStorageKey(tenantSlug: string): string {
  return `${ATTEMPT_STORAGE_PREFIX}:${(tenantSlug || '').trim().toLowerCase()}`;
}

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateStoredAttempt(
  parsed: unknown
): { fingerprintHash: string; idempotencyKey: string; createdAt: number } | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.fingerprintHash !== 'string' ||
    !SHA256_HEX_REGEX.test(obj.fingerprintHash)
  ) {
    return null;
  }
  if (
    typeof obj.idempotencyKey !== 'string' ||
    !UUID_V4_REGEX.test(obj.idempotencyKey)
  ) {
    return null;
  }
  const now = Date.now();
  if (
    typeof obj.createdAt !== 'number' ||
    !Number.isFinite(obj.createdAt) ||
    obj.createdAt <= 0 ||
    obj.createdAt > now ||
    now - obj.createdAt > ATTEMPT_TTL_MS
  ) {
    return null;
  }

  return {
    fingerprintHash: obj.fingerprintHash,
    idempotencyKey: obj.idempotencyKey,
    createdAt: obj.createdAt
  };
}

export function readStoredAttempt(tenantSlug: string): { fingerprintHash: string; idempotencyKey: string; createdAt: number } | null {
  const key = getAttemptStorageKey(tenantSlug);
  let parsedFromSession: unknown = null;
  let hasRawSession = false;

  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const raw = window.sessionStorage.getItem(key);
      if (raw !== null) {
        hasRawSession = true;
        try {
          parsedFromSession = JSON.parse(raw);
        } catch {
          parsedFromSession = null;
        }
      }
    }
  } catch {
    // sessionStorage inacessível, cai no fallback de memória
  }

  if (hasRawSession) {
    const valid = validateStoredAttempt(parsedFromSession);
    if (valid) {
      return valid;
    }
    // Se registro for inválido: remover sessionStorage e fallback inválido
    clearStoredAttempt(tenantSlug);
    return null;
  }

  const rawMemory = inMemoryAttemptStore.get(key);
  if (rawMemory) {
    const validMemory = validateStoredAttempt(rawMemory);
    if (validMemory) {
      return validMemory;
    }
    inMemoryAttemptStore.delete(key);
    return null;
  }

  return null;
}

export function writeStoredAttempt(tenantSlug: string, attempt: { fingerprintHash: string; idempotencyKey: string; createdAt: number }): void {
  const key = getAttemptStorageKey(tenantSlug);
  inMemoryAttemptStore.set(key, attempt);
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(key, JSON.stringify(attempt));
    }
  } catch {
    // sessionStorage indisponível: mantém no Map em memória
  }
}

export function clearStoredAttempt(tenantSlug: string): void {
  const key = getAttemptStorageKey(tenantSlug);
  inMemoryAttemptStore.delete(key);
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // silencioso
  }
}

/**
 * Constrói de forma pura, síncrona e testável o payload exato a ser submetido à Edge Function.
 * - Validações de integridade estritas e fail-closed
 * - Normalização estritamente por Whitelist de campos
 * - NENHUM dado ou cálculo de autoridade financeira é permitido aqui
 * - Wholesale: se email/phone vazios, customer: {} é SEMPRE enviado como objeto; client-side commercial identity NUNCA é enviada
 * - Retail: customer, name e phone são estritamente obrigatórios
 */
export function buildCheckoutRequestBody(
  draft: SubmitOrderCheckoutDraft,
  idempotencyKey: string
): Record<string, unknown> {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw new OrderCheckoutError('Dados do pedido inválidos.', { status: 400 });
  }

  if (typeof draft.tenantSlug !== 'string' || !draft.tenantSlug.trim()) {
    throw new OrderCheckoutError('Configurações da loja ainda não estão disponíveis.', { status: 400 });
  }
  const cleanTenantSlug = draft.tenantSlug.trim();

  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    throw new OrderCheckoutError('Chave de idempotência inválida.', { status: 400 });
  }
  const cleanIdempotencyKey = idempotencyKey.trim();

  if (draft.shoppingMode !== 'retail' && draft.shoppingMode !== 'wholesale') {
    throw new OrderCheckoutError('Modalidade de compra inválida.', { status: 400 });
  }

  if (!Array.isArray(draft.items) || draft.items.length === 0) {
    throw new OrderCheckoutError('Carrinho vazio. Adicione itens antes de enviar o pedido.', { status: 400 });
  }

  if (draft.items.length > 200) {
    throw new OrderCheckoutError('O pedido excede o limite máximo permitido de 200 itens.', { status: 400 });
  }

  const seenProductIds = new Set<string>();
  const normalizedItems: Array<{ productId: string; quantity: number; selectedVariant: string | null }> = [];

  for (const it of draft.items) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) {
      throw new OrderCheckoutError('Item inválido no carrinho.', { status: 400 });
    }

    if (typeof it.productId !== 'string') {
      throw new OrderCheckoutError('ID do produto inválido no carrinho.', { status: 400 });
    }
    const cleanId = it.productId.trim();
    if (!cleanId) {
      throw new OrderCheckoutError('ID do produto inválido no carrinho.', { status: 400 });
    }
    if (seenProductIds.has(cleanId)) {
      throw new OrderCheckoutError(`Item duplicado encontrado no carrinho para o produto ID "${cleanId}".`, { status: 400 });
    }
    seenProductIds.add(cleanId);

    if (
      typeof it.quantity !== 'number' ||
      !Number.isInteger(it.quantity) ||
      it.quantity < 1 ||
      it.quantity > 2147483647
    ) {
      throw new OrderCheckoutError('Quantidade de item deve ser um número inteiro positivo.', { status: 400 });
    }

    let cleanVariant: string | null = null;
    if (it.selectedVariant !== undefined && it.selectedVariant !== null) {
      if (typeof it.selectedVariant !== 'string') {
        throw new OrderCheckoutError('Variante do produto deve ser texto.', { status: 400 });
      }
      const trimmed = it.selectedVariant.trim();
      if (trimmed.length > 160) {
        throw new OrderCheckoutError('Variante do produto excede o limite máximo de 160 caracteres.', { status: 400 });
      }
      cleanVariant = trimmed.length > 0 ? trimmed : null;
    }

    normalizedItems.push({
      productId: cleanId,
      quantity: it.quantity,
      selectedVariant: cleanVariant
    });
  }

  let normalizedCustomer: Record<string, unknown>;

  if (draft.shoppingMode === 'retail') {
    if (!draft.customer || typeof draft.customer !== 'object' || Array.isArray(draft.customer)) {
      throw new OrderCheckoutError('Dados do cliente são obrigatórios no varejo.', { status: 400 });
    }
    if (typeof draft.customer.name !== 'string' || !draft.customer.name.trim()) {
      throw new OrderCheckoutError('Nome do comprador é obrigatório.', { status: 400 });
    }
    if (typeof draft.customer.phone !== 'string' || !draft.customer.phone.trim()) {
      throw new OrderCheckoutError('Telefone do comprador é obrigatório.', { status: 400 });
    }

    const name = draft.customer.name.trim();
    const phone = draft.customer.phone.trim();

    let email: string | undefined = undefined;
    if (draft.customer.email !== undefined && draft.customer.email !== null) {
      if (typeof draft.customer.email !== 'string') {
        throw new OrderCheckoutError('E-mail do comprador deve ser texto.', { status: 400 });
      }
      const trimmedEmail = draft.customer.email.trim();
      if (trimmedEmail) email = trimmedEmail;
    }

    let type: 'PF' | 'PJ' = 'PF';
    if (draft.customer.type !== undefined && draft.customer.type !== null) {
      if (typeof draft.customer.type !== 'string') {
        throw new OrderCheckoutError('Tipo de cliente deve ser texto.', { status: 400 });
      }
      const normalizedType = draft.customer.type.trim().toUpperCase();
      if (normalizedType && normalizedType !== 'PF' && normalizedType !== 'PJ') {
        throw new OrderCheckoutError("Tipo de cliente inválido (deve ser 'PF' ou 'PJ').", { status: 400 });
      }
      if (normalizedType === 'PJ') type = 'PJ';
    }

    if (typeof draft.customer.document !== 'string' || !draft.customer.document.trim()) {
      throw new OrderCheckoutError(
        type === 'PF' ? 'CPF do comprador é obrigatório.' : 'CNPJ do comprador é obrigatório.',
        { status: 400 }
      );
    }
    const cleanDoc = normalizeBrazilianDocument(draft.customer.document);
    if (type === 'PF') {
      if (!isValidCPF(cleanDoc)) {
        throw new OrderCheckoutError('CPF do comprador inválido.', { status: 400 });
      }
    } else {
      if (!isValidCNPJ(cleanDoc)) {
        throw new OrderCheckoutError('CNPJ do comprador inválido.', { status: 400 });
      }
    }

    let companyName: string | undefined = undefined;
    if (draft.customer.companyName !== undefined && draft.customer.companyName !== null) {
      if (typeof draft.customer.companyName !== 'string') {
        throw new OrderCheckoutError('Razão social deve ser texto.', { status: 400 });
      }
      const trimmedCompany = draft.customer.companyName.trim();
      if (trimmedCompany) companyName = trimmedCompany;
    }

    normalizedCustomer = {
      name,
      phone,
      ...(email ? { email } : {}),
      document: cleanDoc,
      ...(companyName ? { companyName } : {}),
      type
    };
  } else {
    // Wholesale:
    // customer deve SEMPRE ser enviado como objeto;
    // se email e phone estiverem vazios, enviar: customer: {}
    // nunca omitir customer;
    // nunca enviar identidade comercial client-side (name, document, companyName, type, buyerUserId).
    normalizedCustomer = {};
    if (draft.customer && typeof draft.customer === 'object' && !Array.isArray(draft.customer)) {
      if (draft.customer.email !== undefined && draft.customer.email !== null) {
        if (typeof draft.customer.email !== 'string') {
          throw new OrderCheckoutError('E-mail operacional deve ser texto.', { status: 400 });
        }
        const trimmedEmail = draft.customer.email.trim();
        if (trimmedEmail) normalizedCustomer.email = trimmedEmail;
      }
      if (draft.customer.phone !== undefined && draft.customer.phone !== null) {
        if (typeof draft.customer.phone !== 'string') {
          throw new OrderCheckoutError('Telefone operacional deve ser texto.', { status: 400 });
        }
        const trimmedPhone = draft.customer.phone.trim();
        if (trimmedPhone) normalizedCustomer.phone = trimmedPhone;
      }
    }
  }

  if (!draft.shippingAddress || !draft.shippingAddress.street || typeof draft.shippingAddress !== 'object' || Array.isArray(draft.shippingAddress)) {
    throw new OrderCheckoutError('Endereço de entrega é obrigatório.', { status: 400 });
  }
  if (typeof draft.shippingAddress.street !== 'string' || !draft.shippingAddress.street.trim()) {
    throw new OrderCheckoutError('Endereço (rua/logradouro) é obrigatório.', { status: 400 });
  }

  const normalizedShippingAddress: Record<string, unknown> = {
    street: draft.shippingAddress.street.trim()
  };
  if (draft.shippingAddress.number !== undefined && draft.shippingAddress.number !== null) {
    if (typeof draft.shippingAddress.number !== 'string') {
      throw new OrderCheckoutError('Número de endereço deve ser texto.', { status: 400 });
    }
    const cleanNumber = draft.shippingAddress.number.trim();
    if (cleanNumber) normalizedShippingAddress.number = cleanNumber;
  }
  if (draft.shippingAddress.complement !== undefined && draft.shippingAddress.complement !== null) {
    if (typeof draft.shippingAddress.complement !== 'string') {
      throw new OrderCheckoutError('Complemento de endereço deve ser texto.', { status: 400 });
    }
    const cleanComp = draft.shippingAddress.complement.trim();
    if (cleanComp) normalizedShippingAddress.complement = cleanComp;
  }
  if (draft.shippingAddress.neighborhood !== undefined && draft.shippingAddress.neighborhood !== null) {
    if (typeof draft.shippingAddress.neighborhood !== 'string') {
      throw new OrderCheckoutError('Bairro deve ser texto.', { status: 400 });
    }
    const cleanNeigh = draft.shippingAddress.neighborhood.trim();
    if (cleanNeigh) normalizedShippingAddress.neighborhood = cleanNeigh;
  }
  if (draft.shippingAddress.city !== undefined && draft.shippingAddress.city !== null) {
    if (typeof draft.shippingAddress.city !== 'string') {
      throw new OrderCheckoutError('Cidade deve ser texto.', { status: 400 });
    }
    const cleanCity = draft.shippingAddress.city.trim();
    if (cleanCity) normalizedShippingAddress.city = cleanCity;
  }
  if (draft.shippingAddress.state !== undefined && draft.shippingAddress.state !== null) {
    if (typeof draft.shippingAddress.state !== 'string') {
      throw new OrderCheckoutError('Estado deve ser texto.', { status: 400 });
    }
    const cleanState = draft.shippingAddress.state.trim();
    if (cleanState) normalizedShippingAddress.state = cleanState;
  }
  if (draft.shippingAddress.zipCode !== undefined && draft.shippingAddress.zipCode !== null) {
    if (typeof draft.shippingAddress.zipCode !== 'string') {
      throw new OrderCheckoutError('CEP deve ser texto.', { status: 400 });
    }
    const cleanZip = draft.shippingAddress.zipCode.trim();
    if (cleanZip) normalizedShippingAddress.zipCode = cleanZip;
  }

  const validPaymentMethods: PaymentMethod[] = ['pix', 'boleto', 'credit_card', 'cash_on_delivery'];
  if (!validPaymentMethods.includes(draft.paymentMethod)) {
    throw new OrderCheckoutError('Forma de pagamento selecionada inválida.', { status: 400 });
  }

  if (typeof draft.deliveryMethod !== 'string') {
    throw new OrderCheckoutError('Método de entrega deve ser informado.', { status: 400 });
  }
  const cleanDeliveryMethod = draft.deliveryMethod.trim();
  if (!cleanDeliveryMethod) {
    throw new OrderCheckoutError('Método de entrega deve ser informado.', { status: 400 });
  }

  let notes: string | undefined = undefined;
  if (draft.notes !== undefined && draft.notes !== null) {
    if (typeof draft.notes !== 'string') {
      throw new OrderCheckoutError('Observações devem ser texto.', { status: 400 });
    }
    const cleanNotes = draft.notes.trim();
    if (cleanNotes) notes = cleanNotes;
  }

  let sellerCode: string | undefined = undefined;
  if (draft.sellerCode !== undefined && draft.sellerCode !== null) {
    if (typeof draft.sellerCode !== 'string') {
      throw new OrderCheckoutError('Código do vendedor deve ser texto.', { status: 400 });
    }
    const cleanCode = draft.sellerCode.trim();
    if (cleanCode) sellerCode = cleanCode;
  }

  const requestBody: Record<string, unknown> = {
    tenantSlug: cleanTenantSlug,
    idempotencyKey: cleanIdempotencyKey,
    shoppingMode: draft.shoppingMode,
    items: normalizedItems,
    customer: normalizedCustomer,
    shippingAddress: normalizedShippingAddress,
    paymentMethod: draft.paymentMethod,
    deliveryMethod: cleanDeliveryMethod,
    notes,
    sellerCode
  };

  return requestBody;
}

export async function computeOrderFingerprint(
  draft: SubmitOrderCheckoutDraft,
  actorMarker: string
): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle || typeof crypto.subtle.digest !== 'function') {
    throw new OrderCheckoutError('Ambiente incompatível para processamento criptográfico seguro de pedidos.');
  }

  // Canonicaliza através do buildCheckoutRequestBody com chave determinística de cálculo
  const canonicalBody = buildCheckoutRequestBody(draft, '00000000-0000-4000-8000-000000000000');

  // Ordenação determinística de cópia dos itens por productId + selectedVariant
  const sortedItems = [...(canonicalBody.items as Array<{ productId: string; quantity: number; selectedVariant: string | null }>)]
    .sort((a, b) => {
      const keyA = `${a.productId}:${a.selectedVariant || ''}`;
      const keyB = `${b.productId}:${b.selectedVariant || ''}`;
      return keyA.localeCompare(keyB);
    });

  const canonicalObj = {
    tenantSlug: (canonicalBody.tenantSlug as string).toLowerCase(),
    shoppingMode: canonicalBody.shoppingMode,
    actor: actorMarker,
    items: sortedItems,
    customer: canonicalBody.customer,
    shippingAddress: canonicalBody.shippingAddress,
    paymentMethod: canonicalBody.paymentMethod,
    deliveryMethod: canonicalBody.deliveryMethod,
    notes: canonicalBody.notes,
    sellerCode: canonicalBody.sellerCode
  };

  const jsonStr = JSON.stringify(canonicalObj);
  const encoder = new TextEncoder();
  const data = encoder.encode(jsonStr);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function validateReceipt(raw: unknown): CheckoutOrderReceipt {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new OrderCheckoutError('Resposta inválida do serviço de pedidos.');
  }

  const payload = raw as Record<string, unknown>;
  if (payload.success !== true || !payload.order || typeof payload.order !== 'object' || Array.isArray(payload.order)) {
    throw new OrderCheckoutError('Resposta inválida do serviço de pedidos.');
  }

  const ord = payload.order as Record<string, unknown>;

  if (typeof ord.id !== 'string' || !ord.id.trim()) {
    throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: ID ausente.');
  }
  if (typeof ord.orderNumber !== 'string' || !ord.orderNumber.trim()) {
    throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Número do pedido ausente.');
  }
  if (ord.shoppingMode !== 'retail' && ord.shoppingMode !== 'wholesale') {
    throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Modalidade inválida.');
  }
  if (typeof ord.deliveryMethod !== 'string' || !ord.deliveryMethod.trim()) {
    throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Método de entrega ausente.');
  }
  if (!Array.isArray(ord.items) || ord.items.length === 0) {
    throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Itens ausentes.');
  }
  if (typeof ord.subtotal !== 'number' || !Number.isFinite(ord.subtotal) || ord.subtotal < 0) {
    throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Subtotal inválido.');
  }
  if (typeof ord.discount !== 'number' || !Number.isFinite(ord.discount) || ord.discount < 0) {
    throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Desconto inválido.');
  }
  if (typeof ord.shippingFee !== 'number' || !Number.isFinite(ord.shippingFee) || ord.shippingFee < 0) {
    throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Taxa de frete inválida.');
  }
  if (typeof ord.total !== 'number' || !Number.isFinite(ord.total) || ord.total < 0) {
    throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Total inválido.');
  }
  if (ord.status !== 'pending') {
    throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Status diferente de pending.');
  }
  const validPaymentMethods: PaymentMethod[] = ['pix', 'boleto', 'credit_card', 'cash_on_delivery'];
  if (!validPaymentMethods.includes(ord.paymentMethod as PaymentMethod)) {
    throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Forma de pagamento inválida.');
  }
  if (typeof ord.createdAt !== 'string' || !ord.createdAt.trim() || Number.isNaN(Date.parse(ord.createdAt))) {
    throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Data de criação inválida.');
  }

  const validatedItems: CheckoutOrderItemReceipt[] = [];
  for (const it of ord.items) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) {
      throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Item malformado.');
    }
    const itemObj = it as Record<string, unknown>;
    if (
      typeof itemObj.productId !== 'string' || !itemObj.productId.trim() ||
      typeof itemObj.productName !== 'string' || !itemObj.productName.trim() ||
      typeof itemObj.productSku !== 'string' || !itemObj.productSku.trim() ||
      typeof itemObj.unit !== 'string' || !itemObj.unit.trim()
    ) {
      throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Dados do produto ausentes.');
    }
    if (typeof itemObj.productImage !== 'string') {
      throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Imagem do produto inválida.');
    }
    if (typeof itemObj.unitPrice !== 'number' || !Number.isFinite(itemObj.unitPrice) || itemObj.unitPrice < 0) {
      throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Preço unitário inválido.');
    }
    if (
      typeof itemObj.quantity !== 'number' ||
      !Number.isInteger(itemObj.quantity) ||
      itemObj.quantity < 1 ||
      itemObj.quantity > 2147483647
    ) {
      throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Quantidade inválida.');
    }
    if (typeof itemObj.totalPrice !== 'number' || !Number.isFinite(itemObj.totalPrice) || itemObj.totalPrice < 0) {
      throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Preço total do item inválido.');
    }

    let itemVariant: string | null | undefined = undefined;
    if (itemObj.selectedVariant !== undefined) {
      if (itemObj.selectedVariant === null) {
        itemVariant = null;
      } else if (typeof itemObj.selectedVariant === 'string') {
        itemVariant = itemObj.selectedVariant;
      } else {
        throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Variante do produto inválida.');
      }
    }

    validatedItems.push({
      productId: itemObj.productId,
      productName: itemObj.productName,
      productSku: itemObj.productSku,
      productImage: itemObj.productImage,
      unitPrice: itemObj.unitPrice,
      quantity: itemObj.quantity,
      unit: itemObj.unit,
      totalPrice: itemObj.totalPrice,
      selectedVariant: itemVariant
    });
  }

  let validatedDocumentUrl: string | null = null;
  if (ord.documentUrl !== undefined && ord.documentUrl !== null) {
    if (typeof ord.documentUrl !== 'string' || !ord.documentUrl.startsWith('https://') || ord.documentUrl.length > 2048) {
      throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: URL do documento inválida.');
    }
    validatedDocumentUrl = ord.documentUrl;
  }

  let validatedDocumentExpiresAt: string | null = null;
  if (ord.documentExpiresAt !== undefined && ord.documentExpiresAt !== null) {
    if (typeof ord.documentExpiresAt !== 'string' || isNaN(Date.parse(ord.documentExpiresAt))) {
      throw new OrderCheckoutError('Resposta inválida do serviço de pedidos: Data de expiração do documento inválida.');
    }
    validatedDocumentExpiresAt = ord.documentExpiresAt;
  }

  return {
    id: ord.id,
    orderNumber: ord.orderNumber,
    shoppingMode: ord.shoppingMode,
    deliveryMethod: ord.deliveryMethod,
    items: validatedItems,
    subtotal: ord.subtotal,
    discount: ord.discount,
    shippingFee: ord.shippingFee,
    total: ord.total,
    status: 'pending',
    paymentMethod: ord.paymentMethod as PaymentMethod,
    createdAt: ord.createdAt,
    documentUrl: validatedDocumentUrl,
    documentExpiresAt: validatedDocumentExpiresAt
  };
}

export async function submitOrderCheckout(draft: SubmitOrderCheckoutDraft): Promise<CheckoutOrderReceipt> {
  if (!isSupabaseConfigured()) {
    throw new OrderCheckoutError('Conexão com o Supabase não está configurada.', { status: 503 });
  }

  const client = getSupabaseClient();

  // 1. Autenticação e Sessão
  const { data: sessionData } = await client.auth.getSession();
  const session = sessionData?.session;

  if (draft.shoppingMode === 'wholesale') {
    if (!session || !session.access_token || !session.user?.id) {
      throw new OrderCheckoutError('Sua sessão expirou ou não é válida para pedidos no atacado.', { status: 401, kind: 'unauthorized' });
    }
  }

  // 2. Fingerprint e Idempotência Robusta (sem persistência de PII)
  const actorMarker = session?.user?.id || 'anonymous';
  const fingerprintHash = await computeOrderFingerprint(draft, actorMarker);

  const cleanTenantSlug = (draft.tenantSlug || '').trim().toLowerCase();
  const stored = readStoredAttempt(cleanTenantSlug);
  let idempotencyKey: string;

  if (
    stored &&
    stored.fingerprintHash === fingerprintHash &&
    Date.now() - stored.createdAt < ATTEMPT_TTL_MS
  ) {
    idempotencyKey = stored.idempotencyKey;
  } else {
    if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
      throw new OrderCheckoutError('Ambiente incompatível para geração segura de identificador de pedido.');
    }
    idempotencyKey = crypto.randomUUID();
    writeStoredAttempt(cleanTenantSlug, {
      fingerprintHash,
      idempotencyKey,
      createdAt: Date.now()
    });
  }

  // 3. Montagem do payload estritamente por Whitelist através do helper puro testável
  const requestBody = buildCheckoutRequestBody(draft, idempotencyKey);

  // 4. Invocação oficial da Edge Function via Supabase Client
  const headers: Record<string, string> = {};
  if (draft.shoppingMode === 'wholesale' && session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  let result: { data: unknown; error: unknown };
  try {
    result = await client.functions.invoke('submit-order-checkout', {
      body: requestBody,
      headers
    });
  } catch (err: unknown) {
    if (err instanceof FunctionsHttpError || err instanceof FunctionsFetchError || err instanceof FunctionsRelayError) {
      result = { data: null, error: err };
    } else {
      throw new OrderCheckoutError('Não foi possível conectar ao serviço de pedidos.', { kind: 'network' });
    }
  }

  // 5. Tratamento de Erros da Edge Function
  if (result.error) {
    const error = result.error;

    if (error instanceof FunctionsHttpError) {
      const status = error.context.status;
      let errorBody: Record<string, unknown> | null = null;
      try {
        if (typeof (error.context as any)?.clone === 'function') {
          errorBody = await (error.context as any).clone().json();
        } else if (typeof (error.context as any)?.json === 'function') {
          errorBody = await (error.context as any).json();
        }
      } catch {
        // Falha no parse JSON de corpo de erro
      }

      if (status === 503) {
        throw new OrderCheckoutError('Checkout temporariamente indisponível. Tente novamente mais tarde.', { status: 503 });
      }
      if (status === 401) {
        throw new OrderCheckoutError('Sua sessão expirou ou não é válida para pedidos no atacado.', { status: 401, kind: 'unauthorized' });
      }
      if (status === 400 || status === 403 || status === 404 || status === 409) {
        const errorMsg =
          errorBody && (errorBody.error || errorBody.message)
            ? String(errorBody.error || errorBody.message)
            : 'Não foi possível processar o pedido.';
        throw new OrderCheckoutError(errorMsg, { status });
      }

      throw new OrderCheckoutError('Não foi possível processar o pedido.', { status });
    }

    if (error instanceof FunctionsFetchError) {
      throw new OrderCheckoutError('Não foi possível conectar ao serviço de pedidos.', { kind: 'fetch' });
    }

    if (error instanceof FunctionsRelayError) {
      throw new OrderCheckoutError('Serviço de pedidos temporariamente indisponível.', { kind: 'relay' });
    }

    throw new OrderCheckoutError('Não foi possível processar o pedido.');
  }

  // 6. Validação em Tempo de Execução do Recibo de Resposta
  const receipt = validateReceipt(result.data);

  // 7. Sucesso real validado: limpa a tentativa armazenada
  clearStoredAttempt(cleanTenantSlug);

  return receipt;
}
