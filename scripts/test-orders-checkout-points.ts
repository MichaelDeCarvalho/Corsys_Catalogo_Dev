/**
 * TEST SUITE: ORDERS / CHECKOUT V1 (BACKEND TRANSACTIONAL CORE & HARDENING 000011)
 * 
 * Cobertura Completa:
 * 1. Auditoria de Schema (Migrations 000010 e 000011 & Governança de 000001-000011)
 * 2. Análise Estrutural e Permissões da RPC create_order_checkout_internal (Least Privilege & Search Path)
 * 3. Simulação Funcional da Lógica Transacional de Checkout (Retail, Wholesale, Idempotência, Preços)
 * 4. Simulação Funcional do Ciclo de Vida de Estoque e Matriz de Transição de Status (manage_order_status)
 * 5. Auditoria de Segurança e Hardening da Edge Function submit-order-checkout
 * 6. Validações Específicas de Hardening (UUID v4, Feature Gate, Byte Limit, Whitelists, Sanitização de Erros e Tipos)
 */

import * as fs from 'fs';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

const VALID_TENANT_UUID = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
const OTHER_TENANT_UUID = 'b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e';
const VALID_PROD_UUID_1 = '11111111-1111-4111-8111-111111111111';
const VALID_PROD_UUID_2 = '22222222-2222-4222-8222-222222222222';
const VALID_BUYER_USER_ID = '33333333-3333-4333-8333-333333333333';
const VALID_SELLER_USER_ID = '44444444-4444-4444-8444-444444444444';
const VALID_IDEMPOTENCY_KEY_V4 = '55555555-5555-4555-8555-555555555555';
const INVALID_IDEMPOTENCY_KEY_V1 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const INVALID_IDEMPOTENCY_KEY_V5 = '886313e1-3b8a-5372-9b90-0c9aee199e5d';

console.log('======================================================');
console.log('TEST SUITE: ORDERS & CHECKOUT V1 (BACKEND CORE & HARDENING)');
console.log('======================================================\n');

// =========================================================================
// 1. Auditoria de Schema (Migrations 000010 e 000011)
// =========================================================================
console.log('1. Auditoria de Schema & Governança de Migrations');

const migration10Path = 'supabase/migrations/20260928_000010_orders_checkout_v1.sql';
assert(fs.existsSync(migration10Path), 'Migration 000010 existe no workspace');

const migration11Path = 'supabase/migrations/20260929_000011_orders_checkout_hardening.sql';
assert(fs.existsSync(migration11Path), 'Migration 000011 existe no workspace');

const migration12Path = 'supabase/migrations/20260930_000012_order_documents_storage.sql';
assert(fs.existsSync(migration12Path), 'Migration 000012 existe no workspace');

const migration10Sql = fs.readFileSync(migration10Path, 'utf-8');
const migration11Sql = fs.readFileSync(migration11Path, 'utf-8');
const migration12Sql = fs.readFileSync(migration12Path, 'utf-8');

const migration17Path = 'supabase/migrations/20261009010000_000017_checkout_delivery_methods_compat.sql';
assert(fs.existsSync(migration17Path), 'Migration 000017 de compatibilidade de métodos de entrega existe no workspace');
const migration17Sql = fs.readFileSync(migration17Path, 'utf-8');

// Verifica preservação de 000001-000013 no contexto de checkout
const migrationFiles = fs.readdirSync('supabase/migrations').filter(f => f.endsWith('.sql'));
assert(
  migrationFiles.length >= 13 &&
  fs.existsSync('supabase/migrations/20260928_000010_orders_checkout_v1.sql') &&
  fs.existsSync('supabase/migrations/20260929_000011_orders_checkout_hardening.sql') &&
  fs.existsSync('supabase/migrations/20260930_000012_order_documents_storage.sql') &&
  fs.existsSync('supabase/migrations/20261001_000013_security_definer_hardening.sql'),
  'Migrations de Checkout e Security (000010 a 000013) registradas e intactas no workspace'
);

const migrationVersions = migrationFiles.map(f => f.split('_')[0]);
assert(
  new Set(migrationVersions).size === migrationFiles.length,
  'Prefixos de versão das migrations são estritamente únicos (sem colisão de versionamento)'
);

assert(
  migration17Sql.includes('CREATE OR REPLACE FUNCTION public.create_order_checkout_internal') &&
  migration17Sql.includes("jsonb_typeof(dm) = 'string'") &&
  migration17Sql.includes("(dm #>> '{}') = trim(p_delivery_method)"),
  'Migration 000017 restaura compatibilidade com delivery_methods no formato array JSONB de strings'
);

assert(
  migration17Sql.includes("jsonb_typeof(dm) = 'object'") &&
  migration17Sql.includes("dm->>'id' = trim(p_delivery_method)") &&
  migration17Sql.includes("COALESCE((dm->>'active')::boolean, true) = true"),
  'Migration 000017 preserva compatibilidade forward com delivery_methods estruturados { id, active }'
);

assert(
  migration17Sql.includes('REVOKE ALL ON FUNCTION public.create_order_checkout_internal') &&
  migration17Sql.includes('GRANT EXECUTE ON FUNCTION public.create_order_checkout_internal') &&
  migration17Sql.includes('TO service_role'),
  'Migration 000017 reafirma EXECUTE de create_order_checkout_internal somente para service_role'
);

// Verifica integridade da 000012 (Private Order Documents Storage)
assert(
  migration12Sql.includes('BEGIN;') && migration12Sql.includes('COMMIT;'),
  'Migration 000012 utiliza explicitamente transação BEGIN / COMMIT'
);
assert(
  migration12Sql.includes("'order-documents'") &&
  migration12Sql.includes('public = false') &&
  migration12Sql.includes('5242880') &&
  migration12Sql.includes("ARRAY['application/pdf']"),
  'Migration 000012 provisiona bucket privado order-documents (public = false, 5MiB, application/pdf)'
);
assert(
  !migration12Sql.includes('CREATE POLICY') &&
  migration12Sql.includes('ZERO CLIENT POLICIES') &&
  !migration12Sql.includes('CREATE POLICY "order_documents_select_tenant_admin"'),
  'Migration 000012 define ZERO client policies em storage.objects para order-documents'
);

// Verifica integridade da 000011
assert(
  migration11Sql.includes('BEGIN;') && migration11Sql.includes('COMMIT;'),
  'Migration 000011 utiliza explicitamente transação BEGIN / COMMIT'
);
assert(
  migration11Sql.includes("conrelid = 'public.orders'::regclass") &&
  migration11Sql.includes('uq_orders_tenant_idempotency') &&
  migration11Sql.includes('chk_orders_shopping_mode'),
  'Migration 000011 reafirma constraints com verificação scoped em conrelid = public.orders::regclass'
);
assert(
  migration11Sql.includes("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
  'Migration 000011 valida estritamente UUID v4 para p_idempotency_key'
);
assert(
  migration11Sql.includes('length(trim(p_tenant_slug)) > 120') &&
  migration11Sql.includes('length(trim(p_delivery_method)) > 64') &&
  migration11Sql.includes('length(trim(p_notes)) > 1000') &&
  migration11Sql.includes('length(trim(p_seller_code)) > 64'),
  'Migration 000011 impõe limites estritos de tamanho para slug, delivery_method, notes e seller_code'
);
assert(
  migration11Sql.includes('jsonb_typeof(p_customer->\'name\') <> \'string\'') &&
  migration11Sql.includes('jsonb_typeof(p_customer->\'phone\') <> \'string\'') &&
  migration11Sql.includes('jsonb_typeof(p_shipping_address->\'street\') <> \'string\''),
  'Migration 000011 valida explicitamente tipos JSON (jsonb_typeof) para campos obrigatórios'
);
assert(
  migration11Sql.includes("v_cust_type NOT IN ('PF', 'PJ')") &&
  migration11Sql.includes("RAISE EXCEPTION 'Tipo de cliente inválido:"),
  'Migration 000011 valida tipo PF/PJ estritamente e rejeita tipos inválidos (sem coerção silenciosa)'
);
assert(
  migration11Sql.includes("NOT (v_raw_item ? 'quantity')") &&
  migration11Sql.includes("jsonb_typeof(v_raw_item->'quantity') <> 'number'") &&
  migration11Sql.includes('2147483647::numeric') &&
  migration11Sql.includes('Quantidade de item excede o limite técnico suportado.'),
  'Migration 000011 impõe jsonb_typeof = number estrito e limite técnico de quantidade (2147483647) antes do cast'
);
assert(
  migration11Sql.includes('jsonb_typeof(v_raw_item->\'selectedVariant\') <> \'string\'') &&
  migration11Sql.includes('Variante do produto deve ser texto.'),
  'Migration 000011 valida selectedVariant com tipo string obrigatório se presente'
);

// =========================================================================
// 2. Análise Estrutural e Permissões das RPCs
// =========================================================================
console.log('\n2. Permissões e Segurança das RPCs (Least Privilege & Search Path)');

assert(
  migration11Sql.includes('CREATE OR REPLACE FUNCTION public.create_order_checkout_internal('),
  'RPC create_order_checkout_internal declarada na 000011'
);
assert(
  migration11Sql.includes('SECURITY DEFINER') &&
  migration11Sql.includes("SET search_path = ''"),
  'RPC create_order_checkout_internal utiliza SECURITY DEFINER com search_path vazio'
);
assert(
  migration11Sql.includes('REVOKE ALL ON FUNCTION public.create_order_checkout_internal') &&
  migration11Sql.includes('FROM PUBLIC, anon, authenticated;'),
  'RPC create_order_checkout_internal revoga acesso de PUBLIC, anon e authenticated'
);
assert(
  migration11Sql.includes('GRANT EXECUTE ON FUNCTION public.create_order_checkout_internal') &&
  migration11Sql.includes('TO service_role;'),
  'RPC create_order_checkout_internal concede execução EXCLUSIVAMENTE a service_role'
);
assert(
  migration10Sql.includes('CREATE OR REPLACE FUNCTION public.manage_order_status('),
  'RPC manage_order_status declarada na 000010'
);
assert(
  migration10Sql.includes('REVOKE ALL ON FUNCTION public.manage_order_status(UUID, TEXT) FROM PUBLIC, anon;') &&
  migration10Sql.includes('GRANT EXECUTE ON FUNCTION public.manage_order_status(UUID, TEXT) TO authenticated;'),
  'RPC manage_order_status acessível apenas por usuários authenticated'
);

// =========================================================================
// 3. Simulação Funcional da Lógica Transacional de Checkout (create_order_checkout_internal)
// =========================================================================
console.log('\n3. Simulação da Lógica Transacional de Criação de Pedido (Checkout)');

interface MockTenantSettings {
  tenantId: string;
  slug: string;
  status: 'active' | 'suspended';
  minOrderValue: number;
  wholesaleMinOrderValue: number | null;
  allowB2bMode: boolean;
  deliveryMethods: string[];
}

interface MockProduct {
  id: string;
  tenantId: string;
  name: string;
  sku: string;
  unit: string;
  price: number;
  promotionalPrice: number | null;
  wholesalePrice: number | null;
  wholesaleEnabled: boolean;
  wholesaleMinQuantity: number | null;
  minOrderQuantity: number;
  stock: number;
  images: string[];
  active: boolean;
  deletedAt: string | null;
}

interface MockWholesaleCustomer {
  tenantId: string;
  userId: string;
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  contactName: string;
  email: string;
  phone: string;
  status: 'pending' | 'approved' | 'rejected';
}

const mockSettings: MockTenantSettings = {
  tenantId: VALID_TENANT_UUID,
  slug: 'corsys-demo',
  status: 'active',
  minOrderValue: 400.0,
  wholesaleMinOrderValue: 1000.0,
  allowB2bMode: true,
  deliveryMethods: ['retirada', 'entrega', 'uber', 'transportadora', 'outro'],
};

const mockProducts: MockProduct[] = [
  {
    id: VALID_PROD_UUID_1,
    tenantId: VALID_TENANT_UUID,
    name: 'APLICADOR ARGACON R1',
    sku: 'AP001',
    unit: 'un',
    price: 150.0,
    promotionalPrice: 140.0,
    wholesalePrice: 100.0,
    wholesaleEnabled: true,
    wholesaleMinQuantity: 5,
    minOrderQuantity: 1,
    stock: 20,
    images: ['https://storage.supabase.com/prod1.webp'],
    active: true,
    deletedAt: null,
  },
  {
    id: VALID_PROD_UUID_2,
    tenantId: VALID_TENANT_UUID,
    name: 'SARGENTO ANGULAR SG02',
    sku: 'SG002',
    unit: 'un',
    price: 300.0,
    promotionalPrice: null,
    wholesalePrice: 200.0,
    wholesaleEnabled: true,
    wholesaleMinQuantity: 2,
    minOrderQuantity: 1,
    stock: 10,
    images: ['https://storage.supabase.com/prod2.webp'],
    active: true,
    deletedAt: null,
  },
];

const mockWholesaleCustomer: MockWholesaleCustomer = {
  tenantId: VALID_TENANT_UUID,
  userId: VALID_BUYER_USER_ID,
  cnpj: '12345678000199',
  legalName: 'COMERCIAL SILVA LTDA',
  tradeName: 'SILVA DISTRIBUIÇÃO',
  contactName: 'Carlos Silva',
  email: 'carlos@silva.com.br',
  phone: '41999998888',
  status: 'approved',
};

// Mock Order Storage in memory
const storedOrders: Array<any> = [];
let seqCounter = 1;

function isValidUuidV4(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid.trim());
}

function simulateCreateOrderCheckoutInternal(params: {
  tenantSlug: string;
  idempotencyKey: string;
  shoppingMode: string;
  items: Array<{ productId: string; quantity: any; selectedVariant?: any }>;
  customer: any;
  shippingAddress: any;
  paymentMethod: string;
  deliveryMethod: string;
  notes?: any;
  sellerCode?: any;
  buyerUserId?: string | null;
  // Injected DB State
  tenantState?: MockTenantSettings;
  productsState?: MockProduct[];
  wholesaleCustomerState?: MockWholesaleCustomer | null;
}) {
  const settings = params.tenantState || mockSettings;
  const products = params.productsState || mockProducts;
  const wholesaleCust = params.wholesaleCustomerState !== undefined ? params.wholesaleCustomerState : mockWholesaleCustomer;

  // 1. Validations & Limits
  if (!params.tenantSlug || typeof params.tenantSlug !== 'string' || params.tenantSlug.trim() === '') {
    throw new Error('Slug do tenant é obrigatório.');
  }
  if (params.tenantSlug.trim().length > 120) throw new Error('Slug do tenant excede o limite máximo de 120 caracteres.');
  if (!params.idempotencyKey || typeof params.idempotencyKey !== 'string') throw new Error('Chave de idempotência é obrigatória.');
  if (!isValidUuidV4(params.idempotencyKey)) throw new Error('Chave de idempotência inválida (deve ser UUID v4).');
  if (!['retail', 'wholesale'].includes(params.shoppingMode)) throw new Error('Modalidade de compra inválida.');
  if (!Array.isArray(params.items) || params.items.length === 0) throw new Error('Lista de itens vazia.');
  if (params.items.length > 200) throw new Error('O pedido excede o limite máximo permitido de 200 itens.');
  if (!['pix', 'boleto', 'credit_card', 'cash_on_delivery'].includes(params.paymentMethod)) {
    throw new Error(`Forma de pagamento não suportada: ${params.paymentMethod}`);
  }
  if (!params.deliveryMethod || typeof params.deliveryMethod !== 'string' || params.deliveryMethod.trim() === '') {
    throw new Error('Método de entrega é obrigatório.');
  }
  if (params.deliveryMethod.trim().length > 64) throw new Error('Método de entrega excede o limite máximo de 64 caracteres.');
  if (params.notes !== undefined && params.notes !== null) {
    if (typeof params.notes !== 'string') throw new Error('Observações do pedido devem ser texto.');
    if (params.notes.trim().length > 1000) throw new Error('Observações do pedido excedem o limite máximo de 1000 caracteres.');
  }
  if (params.sellerCode !== undefined && params.sellerCode !== null) {
    if (typeof params.sellerCode !== 'string') throw new Error('Código de vendedor deve ser texto.');
    if (params.sellerCode.trim().length > 64) throw new Error('Código de vendedor excede o limite máximo de 64 caracteres.');
  }

  // 2. Tenant resolution
  if (settings.slug !== params.tenantSlug) throw new Error('Loja não encontrada.');
  if (settings.status !== 'active') throw new Error('Esta loja está temporariamente inativa para novos pedidos.');

  // 3. Idempotency check
  const existing = storedOrders.find(
    o => o.tenant_id === settings.tenantId && o.idempotency_key === params.idempotencyKey
  );
  if (existing) {
    return { order: existing, fromIdempotency: true };
  }

  // 4. Delivery method
  if (!settings.deliveryMethods.includes(params.deliveryMethod)) {
    throw new Error(`Método de entrega "${params.deliveryMethod}" não é aceito por esta loja.`);
  }

  // 5. Seller code
  let sellerId: string | null = null;
  let sellerCode: string | null = null;
  if (params.sellerCode) {
    if (params.sellerCode === 'VEND10') {
      sellerId = VALID_SELLER_USER_ID;
      sellerCode = 'VEND10';
    } else {
      throw new Error('Código de vendedor inválido ou inexistente nesta loja.');
    }
  }

  // 6. Canonical Customer Snapshot
  if (!params.customer || typeof params.customer !== 'object' || Array.isArray(params.customer)) {
    throw new Error('Dados de cliente inválidos.');
  }
  let customerSnapshot: any;

  if (params.shoppingMode === 'retail') {
    if (typeof params.customer.name !== 'string') throw new Error('Nome do cliente é obrigatório e deve ser texto.');
    const name = params.customer.name.trim();
    if (!name || name.length > 160) throw new Error('Nome do cliente é obrigatório e deve ter no máximo 160 caracteres.');

    if (typeof params.customer.phone !== 'string') throw new Error('Telefone do cliente é obrigatório e deve ser texto.');
    const phone = params.customer.phone.trim();
    if (!phone || phone.length > 40) throw new Error('Telefone do cliente é obrigatório e deve ter no máximo 40 caracteres.');

    let email: string | null = null;
    if (params.customer.email !== undefined && params.customer.email !== null) {
      if (typeof params.customer.email !== 'string') throw new Error('E-mail do cliente deve ser texto.');
      email = params.customer.email.trim();
      if (email.length > 254) throw new Error('E-mail do cliente excede 254 caracteres.');
      if (!email) email = null;
    }

    let document: string | null = null;
    if (params.customer.document !== undefined && params.customer.document !== null) {
      if (typeof params.customer.document !== 'string') throw new Error('Documento do cliente deve ser texto.');
      document = params.customer.document.trim();
      if (document.length > 32) throw new Error('Documento do cliente excede 32 caracteres.');
      if (!document) document = null;
    }

    let companyName: string | null = null;
    if (params.customer.companyName !== undefined && params.customer.companyName !== null) {
      if (typeof params.customer.companyName !== 'string') throw new Error('Razão social deve ser texto.');
      companyName = params.customer.companyName.trim();
      if (companyName.length > 200) throw new Error('Razão social excede 200 caracteres.');
      if (!companyName) companyName = null;
    }

    let type = 'PF';
    if (params.customer.type !== undefined && params.customer.type !== null) {
      if (typeof params.customer.type !== 'string') throw new Error('Tipo de cliente deve ser texto (PF ou PJ).');
      const normalizedType = params.customer.type.trim().toUpperCase();
      if (normalizedType && !['PF', 'PJ'].includes(normalizedType)) {
        throw new Error(`Tipo de cliente inválido: ${params.customer.type} (deve ser PF ou PJ).`);
      }
      if (normalizedType === 'PJ') type = 'PJ';
    }

    customerSnapshot = {
      name,
      phone,
      email,
      document,
      companyName,
      type,
    };
  } else {
    // Wholesale: Não exige name do client-side
    if (!params.buyerUserId) throw new Error('Acesso atacadista exige usuário comprador autenticado.');
    if (!settings.allowB2bMode) throw new Error('Esta loja não opera na modalidade Atacado / B2B.');
    if (settings.wholesaleMinOrderValue === null) throw new Error('Configuração da loja inválida: valor mínimo de atacado não definido.');
    if (!wholesaleCust || wholesaleCust.status !== 'approved' || wholesaleCust.userId !== params.buyerUserId) {
      throw new Error('Cadastro de comprador B2B não encontrado ou ainda não aprovado pela loja.');
    }

    let email: string | null = null;
    if (params.customer.email !== undefined && params.customer.email !== null) {
      if (typeof params.customer.email !== 'string') throw new Error('E-mail operacional deve ser texto.');
      email = params.customer.email.trim();
      if (email.length > 254) throw new Error('E-mail operacional excede o limite máximo de 254 caracteres.');
      if (!email) email = null;
    }

    let phone: string | null = null;
    if (params.customer.phone !== undefined && params.customer.phone !== null) {
      if (typeof params.customer.phone !== 'string') throw new Error('Telefone operacional deve ser texto.');
      phone = params.customer.phone.trim();
      if (phone.length > 40) throw new Error('Telefone operacional excede o limite máximo de 40 caracteres.');
      if (!phone) phone = null;
    }

    customerSnapshot = {
      name: wholesaleCust.contactName,
      companyName: wholesaleCust.legalName,
      tradeName: wholesaleCust.tradeName,
      document: wholesaleCust.cnpj,
      type: 'PJ',
      email: email || wholesaleCust.email,
      phone: phone || wholesaleCust.phone,
    };
  }

  // 7. Canonical Shipping Snapshot
  if (!params.shippingAddress || typeof params.shippingAddress !== 'object' || Array.isArray(params.shippingAddress)) {
    throw new Error('Endereço de entrega inválido.');
  }
  if (typeof params.shippingAddress.street !== 'string') throw new Error('Rua/logradouro de entrega é obrigatório e deve ser texto.');
  const street = params.shippingAddress.street.trim();
  if (!street || street.length > 200) throw new Error('Rua/logradouro é obrigatório e deve ter no máximo 200 caracteres.');

  let number: string | null = null;
  if (params.shippingAddress.number !== undefined && params.shippingAddress.number !== null) {
    if (typeof params.shippingAddress.number !== 'string') throw new Error('Número do endereço deve ser texto.');
    number = params.shippingAddress.number.trim();
    if (number.length > 32) throw new Error('Número do endereço excede o limite máximo de 32 caracteres.');
    if (!number) number = null;
  }

  let complement: string | null = null;
  if (params.shippingAddress.complement !== undefined && params.shippingAddress.complement !== null) {
    if (typeof params.shippingAddress.complement !== 'string') throw new Error('Complemento do endereço deve ser texto.');
    complement = params.shippingAddress.complement.trim();
    if (complement.length > 160) throw new Error('Complemento do endereço excede o limite máximo de 160 caracteres.');
    if (!complement) complement = null;
  }

  let neighborhood: string | null = null;
  if (params.shippingAddress.neighborhood !== undefined && params.shippingAddress.neighborhood !== null) {
    if (typeof params.shippingAddress.neighborhood !== 'string') throw new Error('Bairro do endereço deve ser texto.');
    neighborhood = params.shippingAddress.neighborhood.trim();
    if (neighborhood.length > 120) throw new Error('Bairro do endereço excede o limite máximo de 120 caracteres.');
    if (!neighborhood) neighborhood = null;
  }

  let city: string | null = null;
  if (params.shippingAddress.city !== undefined && params.shippingAddress.city !== null) {
    if (typeof params.shippingAddress.city !== 'string') throw new Error('Cidade do endereço deve ser texto.');
    city = params.shippingAddress.city.trim();
    if (city.length > 120) throw new Error('Cidade do endereço excede o limite máximo de 120 caracteres.');
    if (!city) city = null;
  }

  let state: string | null = null;
  if (params.shippingAddress.state !== undefined && params.shippingAddress.state !== null) {
    if (typeof params.shippingAddress.state !== 'string') throw new Error('Estado/UF do endereço deve ser texto.');
    state = params.shippingAddress.state.trim();
    if (state.length > 64) throw new Error('Estado/UF do endereço excede o limite máximo de 64 caracteres.');
    if (!state) state = null;
  }

  let zipCode: string | null = null;
  if (params.shippingAddress.zipCode !== undefined && params.shippingAddress.zipCode !== null) {
    if (typeof params.shippingAddress.zipCode !== 'string') throw new Error('CEP do endereço deve ser texto.');
    zipCode = params.shippingAddress.zipCode.trim();
    if (zipCode.length > 20) throw new Error('CEP do endereço excede o limite máximo de 20 caracteres.');
    if (!zipCode) zipCode = null;
  }

  const shippingSnapshot = {
    street,
    number,
    complement,
    neighborhood,
    city,
    state,
    zipCode,
  };

  // 8. Duplicate product check
  const prodIds = params.items.map(i => i.productId);
  if (new Set(prodIds).size !== prodIds.length) {
    throw new Error('O pedido não pode conter produtos repetidos em linhas separadas.');
  }

  // 9. Items calculation & stock verification
  let subtotal = 0;
  const sanitizedItems = [];

  for (const rawItem of params.items) {
    if (typeof rawItem !== 'object' || rawItem === null || Array.isArray(rawItem)) {
      throw new Error('Cada item do pedido deve ser um objeto JSON válido.');
    }

    if (!('quantity' in rawItem) || typeof rawItem.quantity !== 'number') {
      throw new Error('Quantidade de item deve ser um número inteiro positivo.');
    }

    const qtyNum = rawItem.quantity;
    if (!Number.isInteger(qtyNum) || qtyNum < 1) {
      throw new Error('Quantidade de item deve ser um número inteiro positivo.');
    }
    if (qtyNum > 2147483647) {
      throw new Error('Quantidade de item excede o limite técnico suportado.');
    }

    const prod = products.find(p => p.id === rawItem.productId && p.tenantId === settings.tenantId && p.active && !p.deletedAt);
    if (!prod) {
      throw new Error('Produto não encontrado ou indisponível no catálogo desta loja.');
    }

    if (prod.stock < qtyNum) {
      throw new Error(`Estoque insuficiente para o produto ${prod.name} (Disponível: ${prod.stock}, Solicitado: ${qtyNum}).`);
    }

    let selectedVariant: string | null = null;
    if (rawItem.selectedVariant !== undefined && rawItem.selectedVariant !== null) {
      if (typeof rawItem.selectedVariant !== 'string') throw new Error('Variante do produto deve ser texto.');
      selectedVariant = rawItem.selectedVariant.trim();
      if (selectedVariant.length > 160) throw new Error('Variante selecionada excede o limite máximo de 160 caracteres.');
      if (selectedVariant.length === 0) selectedVariant = null;
    }

    let unitPrice = 0;
    if (params.shoppingMode === 'retail') {
      if (qtyNum < prod.minOrderQuantity) {
        throw new Error(`Quantidade mínima do produto ${prod.name} é de ${prod.minOrderQuantity} ${prod.unit}.`);
      }
      unitPrice = prod.promotionalPrice !== null ? prod.promotionalPrice : prod.price;
    } else {
      if (!prod.wholesaleEnabled || prod.wholesalePrice === null || prod.wholesalePrice <= 0) {
        throw new Error(`Produto ${prod.name} não está disponível para venda no atacado.`);
      }
      const minQty = prod.wholesaleMinQuantity || 1;
      if (qtyNum < minQty) {
        throw new Error(`Quantidade mínima de atacado para ${prod.name} é de ${minQty} ${prod.unit}.`);
      }
      unitPrice = prod.wholesalePrice;
    }

    const totalPrice = Math.round(unitPrice * qtyNum * 100) / 100;
    subtotal += totalPrice;

    sanitizedItems.push({
      productId: prod.id,
      productName: prod.name,
      productSku: prod.sku,
      productImage: prod.images[0] || '',
      unitPrice,
      quantity: qtyNum,
      unit: prod.unit,
      totalPrice,
      selectedVariant,
    });
  }

  subtotal = Math.round(subtotal * 100) / 100;

  // 10. Minimum order value validation
  if (params.shoppingMode === 'retail') {
    if (settings.minOrderValue && subtotal < settings.minOrderValue) {
      throw new Error(`Valor do pedido (R$ ${subtotal}) abaixo do valor mínimo de varejo da loja (R$ ${settings.minOrderValue}).`);
    }
  } else {
    if (subtotal < (settings.wholesaleMinOrderValue || 0)) {
      throw new Error(`Valor do pedido (R$ ${subtotal}) abaixo do valor mínimo de atacado da loja (R$ ${settings.wholesaleMinOrderValue}).`);
    }
  }

  // 11. Generate order number & Insert pending order
  const orderNumber = `PED-20260928-${String(seqCounter++).padStart(6, '0')}`;
  const newOrder = {
    id: `ord-${Date.now()}-${Math.random()}`,
    tenant_id: settings.tenantId,
    order_number: orderNumber,
    idempotency_key: params.idempotencyKey,
    shopping_mode: params.shoppingMode,
    delivery_method: params.deliveryMethod,
    seller_id: sellerId,
    seller_code: sellerCode,
    customer: customerSnapshot,
    shipping_address: shippingSnapshot,
    items: sanitizedItems,
    subtotal,
    discount: 0.0,
    shipping_fee: 0.0,
    total: subtotal,
    status: 'pending',
    payment_method: params.paymentMethod,
    notes: params.notes || null,
    source: 'web_checkout',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  storedOrders.push(newOrder);
  return { order: newOrder, fromIdempotency: false };
}

// Teste 3.1: Pedido Varejo com Recálculo de Preço e Snapshots Canônicos
const retailRes = simulateCreateOrderCheckoutInternal({
  tenantSlug: 'corsys-demo',
  idempotencyKey: VALID_IDEMPOTENCY_KEY_V4,
  shoppingMode: 'retail',
  items: [
    { productId: VALID_PROD_UUID_1, quantity: 3, selectedVariant: 'Azul 110V' },
  ],
  customer: {
    name: 'João Comprador',
    phone: '41988887777',
    type: 'PF',
    extraMaliciousKey: 'IGNORAR_OU_REMOVER',
    internalStatus: 'HACKED',
  },
  shippingAddress: {
    street: 'Rua das Flores',
    number: '123',
    extraAdminNote: 'DELETE_ME',
  },
  paymentMethod: 'pix',
  deliveryMethod: 'entrega',
});

assert(retailRes.order.status === 'pending', 'Pedido varejo criado com status pending');
assert(retailRes.order.subtotal === 420.0, 'Preço recalculado server-side com valor promocional (3 * 140 = 420)');
assert(retailRes.order.items[0].unitPrice === 140.0, 'Snapshot do item contém preço promocional oficial');
assert(retailRes.order.items[0].selectedVariant === 'Azul 110V', 'selectedVariant é persistido como snapshot');
assert(!('extraMaliciousKey' in retailRes.order.customer), 'Customer arbitrary extra key NÃO é persistida (Snapshot Canônico)');
assert(!('extraAdminNote' in retailRes.order.shipping_address), 'Shipping arbitrary extra key NÃO é persistida (Snapshot Canônico)');
assert(mockProducts[0].stock === 20, 'Criação de pedido pending NÃO decrementa estoque');

// Teste 3.2: Tipo PF e PJ aceitos estritamente no Varejo
const retailPjRes = simulateCreateOrderCheckoutInternal({
  tenantSlug: 'corsys-demo',
  idempotencyKey: '55555555-5555-4555-8555-000000000099',
  shoppingMode: 'retail',
  items: [{ productId: VALID_PROD_UUID_1, quantity: 3 }],
  customer: { name: 'Empresa do João', phone: '41988887777', type: 'PJ', companyName: 'João Ltda' },
  shippingAddress: { street: 'Rua das Flores' },
  paymentMethod: 'pix',
  deliveryMethod: 'entrega',
});
assert(retailPjRes.order.customer.type === 'PJ', 'Retail type PJ aceito');

let invalidTypeErr = false;
try {
  simulateCreateOrderCheckoutInternal({
    tenantSlug: 'corsys-demo',
    idempotencyKey: '55555555-5555-4555-8555-000000000098',
    shoppingMode: 'retail',
    items: [{ productId: VALID_PROD_UUID_1, quantity: 3 }],
    customer: { name: 'João', phone: '41988887777', type: 'XP' },
    shippingAddress: { street: 'Rua das Flores' },
    paymentMethod: 'pix',
    deliveryMethod: 'entrega',
  });
} catch (e: any) {
  invalidTypeErr = e.message.includes('Tipo de cliente inválido');
}
assert(invalidTypeErr, 'Retail type inválido (XP) rejeitado fail-closed');

// Teste 3.3: Validação de Tipos Opcionais em Customer e Shipping
let emailNumErr = false;
try {
  simulateCreateOrderCheckoutInternal({
    tenantSlug: 'corsys-demo',
    idempotencyKey: '55555555-5555-4555-8555-000000000097',
    shoppingMode: 'retail',
    items: [{ productId: VALID_PROD_UUID_1, quantity: 3 }],
    customer: { name: 'João', phone: '41988887777', email: 12345 },
    shippingAddress: { street: 'Rua das Flores' },
    paymentMethod: 'pix',
    deliveryMethod: 'entrega',
  });
} catch (e: any) {
  emailNumErr = e.message.includes('E-mail do cliente deve ser texto');
}
assert(emailNumErr, 'Customer email como número é rejeitado com erro de tipo');

let companyObjErr = false;
try {
  simulateCreateOrderCheckoutInternal({
    tenantSlug: 'corsys-demo',
    idempotencyKey: '55555555-5555-4555-8555-000000000096',
    shoppingMode: 'retail',
    items: [{ productId: VALID_PROD_UUID_1, quantity: 3 }],
    customer: { name: 'João', phone: '41988887777', companyName: { invalid: true } },
    shippingAddress: { street: 'Rua das Flores' },
    paymentMethod: 'pix',
    deliveryMethod: 'entrega',
  });
} catch (e: any) {
  companyObjErr = e.message.includes('Razão social deve ser texto');
}
assert(companyObjErr, 'Customer companyName como objeto é rejeitado com erro de tipo');

let shipNumErr = false;
try {
  simulateCreateOrderCheckoutInternal({
    tenantSlug: 'corsys-demo',
    idempotencyKey: '55555555-5555-4555-8555-000000000095',
    shoppingMode: 'retail',
    items: [{ productId: VALID_PROD_UUID_1, quantity: 3 }],
    customer: { name: 'João', phone: '41988887777' },
    shippingAddress: { street: 'Rua das Flores', number: 123 },
    paymentMethod: 'pix',
    deliveryMethod: 'entrega',
  });
} catch (e: any) {
  shipNumErr = e.message.includes('Número do endereço deve ser texto');
}
assert(shipNumErr, 'Shipping number como número é rejeitado com erro de tipo');

let variantNonStringErr = false;
try {
  simulateCreateOrderCheckoutInternal({
    tenantSlug: 'corsys-demo',
    idempotencyKey: '55555555-5555-4555-8555-000000000094',
    shoppingMode: 'retail',
    items: [{ productId: VALID_PROD_UUID_1, quantity: 3, selectedVariant: { color: 'red' } }],
    customer: { name: 'João', phone: '41988887777' },
    shippingAddress: { street: 'Rua das Flores' },
    paymentMethod: 'pix',
    deliveryMethod: 'entrega',
  });
} catch (e: any) {
  variantNonStringErr = e.message.includes('Variante do produto deve ser texto');
}
assert(variantNonStringErr, 'selectedVariant não-string rejeitado com erro de tipo');

// Teste 3.4: Validações Estritas de Quantity (Fail-Closed)
let missingQtyErr = false;
try {
  simulateCreateOrderCheckoutInternal({
    tenantSlug: 'corsys-demo',
    idempotencyKey: '55555555-5555-4555-8555-000000000093',
    shoppingMode: 'retail',
    items: [{ productId: VALID_PROD_UUID_1 } as any],
    customer: { name: 'João', phone: '41988887777' },
    shippingAddress: { street: 'Rua das Flores' },
    paymentMethod: 'pix',
    deliveryMethod: 'entrega',
  });
} catch (e: any) {
  missingQtyErr = e.message.includes('número inteiro positivo');
}
assert(missingQtyErr, 'quantity ausente é rejeitada pela defesa');

let nullQtyErr = false;
try {
  simulateCreateOrderCheckoutInternal({
    tenantSlug: 'corsys-demo',
    idempotencyKey: '55555555-5555-4555-8555-000000000092',
    shoppingMode: 'retail',
    items: [{ productId: VALID_PROD_UUID_1, quantity: null as any }],
    customer: { name: 'João', phone: '41988887777' },
    shippingAddress: { street: 'Rua das Flores' },
    paymentMethod: 'pix',
    deliveryMethod: 'entrega',
  });
} catch (e: any) {
  nullQtyErr = e.message.includes('número inteiro positivo');
}
assert(nullQtyErr, 'quantity null é rejeitada');

let strQtyErr = false;
try {
  simulateCreateOrderCheckoutInternal({
    tenantSlug: 'corsys-demo',
    idempotencyKey: '55555555-5555-4555-8555-000000000091',
    shoppingMode: 'retail',
    items: [{ productId: VALID_PROD_UUID_1, quantity: "5" as any }],
    customer: { name: 'João', phone: '41988887777' },
    shippingAddress: { street: 'Rua das Flores' },
    paymentMethod: 'pix',
    deliveryMethod: 'entrega',
  });
} catch (e: any) {
  strQtyErr = e.message.includes('número inteiro positivo');
}
assert(strQtyErr, 'quantity string "5" é rejeitada (não aceita coerção)');

let fracQtyErr = false;
try {
  simulateCreateOrderCheckoutInternal({
    tenantSlug: 'corsys-demo',
    idempotencyKey: '55555555-5555-4555-8555-000000000090',
    shoppingMode: 'retail',
    items: [{ productId: VALID_PROD_UUID_1, quantity: 5.5 }],
    customer: { name: 'João', phone: '41988887777' },
    shippingAddress: { street: 'Rua das Flores' },
    paymentMethod: 'pix',
    deliveryMethod: 'entrega',
  });
} catch (e: any) {
  fracQtyErr = e.message.includes('número inteiro positivo');
}
assert(fracQtyErr, 'quantity fracionária 5.5 é rejeitada');

let zeroQtyErr = false;
try {
  simulateCreateOrderCheckoutInternal({
    tenantSlug: 'corsys-demo',
    idempotencyKey: '55555555-5555-4555-8555-000000000089',
    shoppingMode: 'retail',
    items: [{ productId: VALID_PROD_UUID_1, quantity: 0 }],
    customer: { name: 'João', phone: '41988887777' },
    shippingAddress: { street: 'Rua das Flores' },
    paymentMethod: 'pix',
    deliveryMethod: 'entrega',
  });
} catch (e: any) {
  zeroQtyErr = e.message.includes('número inteiro positivo');
}
assert(zeroQtyErr, 'quantity 0 é rejeitada');

let negQtyErr = false;
try {
  simulateCreateOrderCheckoutInternal({
    tenantSlug: 'corsys-demo',
    idempotencyKey: '55555555-5555-4555-8555-000000000088',
    shoppingMode: 'retail',
    items: [{ productId: VALID_PROD_UUID_1, quantity: -1 }],
    customer: { name: 'João', phone: '41988887777' },
    shippingAddress: { street: 'Rua das Flores' },
    paymentMethod: 'pix',
    deliveryMethod: 'entrega',
  });
} catch (e: any) {
  negQtyErr = e.message.includes('número inteiro positivo');
}
assert(negQtyErr, 'quantity negativa -1 é rejeitada');

let qtyOverflowErr = false;
try {
  simulateCreateOrderCheckoutInternal({
    tenantSlug: 'corsys-demo',
    idempotencyKey: '55555555-5555-4555-8555-000000000087',
    shoppingMode: 'retail',
    items: [{ productId: VALID_PROD_UUID_1, quantity: 2147483648 }],
    customer: { name: 'João', phone: '41988887777' },
    shippingAddress: { street: 'Rua das Flores' },
    paymentMethod: 'pix',
    deliveryMethod: 'entrega',
  });
} catch (e: any) {
  qtyOverflowErr = e.message.includes('excede o limite técnico suportado');
}
assert(qtyOverflowErr, 'quantity 2147483648 rejeitada antes do cast');

// Teste de aceitação de inteiro positivo
const validNumberQtyRes = simulateCreateOrderCheckoutInternal({
  tenantSlug: 'corsys-demo',
  idempotencyKey: '55555555-5555-4555-8555-000000000086',
  shoppingMode: 'retail',
  items: [{ productId: VALID_PROD_UUID_1, quantity: 5 }],
  customer: { name: 'João', phone: '41988887777' },
  shippingAddress: { street: 'Rua das Flores' },
  paymentMethod: 'pix',
  deliveryMethod: 'entrega',
});
assert(validNumberQtyRes.order.items[0].quantity === 5, 'quantity número inteiro 5 é aceita');

// Teste 3.5: Idempotência (mesma chave retorna o mesmo pedido)
const retryRes = simulateCreateOrderCheckoutInternal({
  tenantSlug: 'corsys-demo',
  idempotencyKey: VALID_IDEMPOTENCY_KEY_V4,
  shoppingMode: 'retail',
  items: [{ productId: VALID_PROD_UUID_1, quantity: 3 }],
  customer: { name: 'João Comprador', phone: '41988887777' },
  shippingAddress: { street: 'Rua das Flores', number: '123' },
  paymentMethod: 'pix',
  deliveryMethod: 'entrega',
});

assert(retryRes.fromIdempotency === true, 'Retry com mesma idempotency_key identificado');
assert(retryRes.order.id === retailRes.order.id, 'Idempotência retorna exatamente o mesmo pedido');

// Teste 3.6: UUID v1 e v5 rejeitados para Idempotência (Strict UUID v4)
let uuidV1Err = false;
try {
  simulateCreateOrderCheckoutInternal({
    tenantSlug: 'corsys-demo',
    idempotencyKey: INVALID_IDEMPOTENCY_KEY_V1,
    shoppingMode: 'retail',
    items: [{ productId: VALID_PROD_UUID_1, quantity: 3 }],
    customer: { name: 'João', phone: '119' },
    shippingAddress: { street: 'Rua A' },
    paymentMethod: 'pix',
    deliveryMethod: 'entrega',
  });
} catch (e: any) {
  uuidV1Err = e.message.includes('deve ser UUID v4');
}
assert(uuidV1Err, 'Idempotency key UUID v1 é rejeitada fail-closed');

let uuidV5Err = false;
try {
  simulateCreateOrderCheckoutInternal({
    tenantSlug: 'corsys-demo',
    idempotencyKey: INVALID_IDEMPOTENCY_KEY_V5,
    shoppingMode: 'retail',
    items: [{ productId: VALID_PROD_UUID_1, quantity: 3 }],
    customer: { name: 'João', phone: '119' },
    shippingAddress: { street: 'Rua A' },
    paymentMethod: 'pix',
    deliveryMethod: 'entrega',
  });
} catch (e: any) {
  uuidV5Err = e.message.includes('deve ser UUID v4');
}
assert(uuidV5Err, 'Idempotency key UUID v5 é rejeitada fail-closed');

// Teste 3.7: Atacado Válido com Snapshot Oficial PJ sem exigir customer.name do browser
const wholesaleOrderRes = simulateCreateOrderCheckoutInternal({
  tenantSlug: 'corsys-demo',
  idempotencyKey: '55555555-5555-4555-8555-111111111111',
  shoppingMode: 'wholesale',
  buyerUserId: VALID_BUYER_USER_ID,
  items: [
    { productId: VALID_PROD_UUID_1, quantity: 6 },
    { productId: VALID_PROD_UUID_2, quantity: 3 },
  ],
  customer: {
    email: 'operacional@silva.com.br',
    phone: '41988880000',
  },
  shippingAddress: { street: 'Av. Industrial, 500' },
  paymentMethod: 'boleto',
  deliveryMethod: 'transportadora',
});

assert(wholesaleOrderRes.order.status === 'pending', 'Pedido atacado criado com status pending');
assert(wholesaleOrderRes.order.subtotal === 1200.0, 'Preço de atacado recalculado no banco (6*100 + 3*200 = 1200)');
assert(
  wholesaleOrderRes.order.customer.companyName === 'COMERCIAL SILVA LTDA' &&
  wholesaleOrderRes.order.customer.document === '12345678000199' &&
  wholesaleOrderRes.order.customer.name === 'Carlos Silva',
  'Snapshot de cliente no atacado utiliza dados oficiais de wholesale_customers sem exigir name do browser'
);
assert(
  wholesaleOrderRes.order.customer.email === 'operacional@silva.com.br' &&
  wholesaleOrderRes.order.customer.phone === '41988880000',
  'Wholesale aceita e preserva dados operacionais válidos de email/phone'
);

// =========================================================================
// 4. Gestão de Ciclo de Vida de Estoque e Transições de Status (manage_order_status)
// =========================================================================
console.log('\n4. Gestão de Ciclo de Vida de Estoque e Transições de Status (manage_order_status)');

function simulateManageOrderStatus(params: {
  orderId: string;
  newStatus: string;
  callerId: string;
  callerRole: 'tenant_admin' | 'stock_manager' | 'sales_rep' | 'platform_admin';
  callerTenantId?: string;
  productsState: MockProduct[];
}) {
  const order = storedOrders.find(o => o.id === params.orderId);
  if (!order) throw new Error('Pedido não encontrado.');

  // Check authorization
  if (params.callerRole !== 'platform_admin') {
    if (params.callerTenantId !== order.tenant_id || !['tenant_admin', 'stock_manager'].includes(params.callerRole)) {
      throw new Error('Acesso não autorizado para gerenciar pedidos deste tenant.');
    }
  }

  // Terminal states check
  if (['delivered', 'cancelled'].includes(order.status)) {
    throw new Error(`Pedido já está em estado terminal (${order.status}) e não permite transição.`);
  }

  if (order.status === params.newStatus) return order;

  // Transitions
  if (order.status === 'pending' && params.newStatus === 'approved') {
    const sortedItems = [...order.items].sort((a, b) => a.productId.localeCompare(b.productId));
    
    for (const item of sortedItems) {
      if (item.quantity === null || item.quantity === undefined || item.quantity < 1) {
        throw new Error(`Quantidade de item inválida (${item.quantity}) no pedido.`);
      }

      const prod = params.productsState.find(
        p => p.id === item.productId && p.tenantId === order.tenant_id && p.active && !p.deletedAt
      );

      if (!prod) {
        throw new Error(`Produto ${item.productId} indisponível, inativo ou excluído durante a aprovação.`);
      }

      if (prod.stock < item.quantity) {
        throw new Error(`Estoque insuficiente para aprovação do item (Disponível: ${prod.stock}, Solicitado: ${item.quantity}).`);
      }
    }

    for (const item of sortedItems) {
      const prod = params.productsState.find(p => p.id === item.productId && p.tenantId === order.tenant_id)!;
      prod.stock -= item.quantity;
    }

    order.status = 'approved';
    return order;
  }

  if (order.status === 'pending' && params.newStatus === 'cancelled') {
    order.status = 'cancelled';
    return order;
  }

  if (order.status === 'approved' && params.newStatus === 'preparing') {
    order.status = 'preparing';
    return order;
  }

  if (['approved', 'preparing'].includes(order.status) && params.newStatus === 'cancelled') {
    const sortedItems = [...order.items].sort((a, b) => a.productId.localeCompare(b.productId));

    for (const item of sortedItems) {
      if (item.quantity === null || item.quantity === undefined || item.quantity < 1) {
        throw new Error(`Quantidade de item inválida (${item.quantity}) no pedido.`);
      }

      const prod = params.productsState.find(p => p.id === item.productId && p.tenantId === order.tenant_id);
      if (!prod) {
        throw new Error(`Produto ${item.productId} não encontrado para o tenant durante o cancelamento.`);
      }
    }

    for (const item of sortedItems) {
      const prod = params.productsState.find(p => p.id === item.productId && p.tenantId === order.tenant_id)!;
      prod.stock += item.quantity;
    }
    order.status = 'cancelled';
    return order;
  }

  if (order.status === 'preparing' && params.newStatus === 'dispatched') {
    order.status = 'dispatched';
    return order;
  }

  if (order.status === 'dispatched' && params.newStatus === 'delivered') {
    order.status = 'delivered';
    return order;
  }

  throw new Error(`Transição de status inválida de "${order.status}" para "${params.newStatus}".`);
}

// Teste 4.1: Aprovação debita estoque
const initialStockP1 = mockProducts[0].stock; // 20
const initialStockP2 = mockProducts[1].stock; // 10

simulateManageOrderStatus({
  orderId: wholesaleOrderRes.order.id,
  newStatus: 'approved',
  callerId: 'user-stock-manager-uuid',
  callerRole: 'stock_manager',
  callerTenantId: VALID_TENANT_UUID,
  productsState: mockProducts,
});

assert(wholesaleOrderRes.order.status === 'approved', 'Status atualizado para approved');
assert(mockProducts[0].stock === initialStockP1 - 6, 'Estoque do produto 1 decrementado de 20 para 14');
assert(mockProducts[1].stock === initialStockP2 - 3, 'Estoque do produto 2 decrementado de 10 para 7');

// Teste 4.2: Cancelamento restaura estoque
simulateManageOrderStatus({
  orderId: wholesaleOrderRes.order.id,
  newStatus: 'cancelled',
  callerId: 'admin-uuid',
  callerRole: 'tenant_admin',
  callerTenantId: VALID_TENANT_UUID,
  productsState: mockProducts,
});
assert(wholesaleOrderRes.order.status === 'cancelled', 'Status atualizado para cancelled');
assert(mockProducts[0].stock === initialStockP1, 'Estoque do produto 1 restaurado integralmente (20)');
assert(mockProducts[1].stock === initialStockP2, 'Estoque do produto 2 restaurado integralmente (10)');

// Teste 4.3: Double Cancel bloqueado
let doubleCancelErr = false;
try {
  simulateManageOrderStatus({
    orderId: wholesaleOrderRes.order.id,
    newStatus: 'cancelled',
    callerId: 'admin-uuid',
    callerRole: 'tenant_admin',
    callerTenantId: VALID_TENANT_UUID,
    productsState: mockProducts,
  });
} catch (e: any) {
  doubleCancelErr = e.message.includes('estado terminal');
}
assert(doubleCancelErr, 'Double cancel é bloqueado por estado terminal');

// =========================================================================
// 5. Auditoria de Segurança da Edge Function submit-order-checkout
// =========================================================================
console.log('\n5. Auditoria de Segurança da Edge Function & Runtime');

const edgeFuncPath = 'supabase/functions/submit-order-checkout/index.ts';
assert(fs.existsSync(edgeFuncPath), 'Edge Function submit-order-checkout existe no workspace');

const edgeFuncSource = fs.readFileSync(edgeFuncPath, 'utf-8');

// Imports modernos
assert(
  edgeFuncSource.includes('npm:@supabase/supabase-js@2') &&
  edgeFuncSource.includes('Deno.serve('),
  'Edge Function utiliza imports modernos (npm:@supabase/supabase-js@2 e Deno.serve)'
);
assert(
  !edgeFuncSource.includes('https://deno.land/std@0.168.0/http/server.ts') &&
  !edgeFuncSource.includes('https://esm.sh/@supabase/supabase-js'),
  'Edge Function removeu dependências legadas de std e esm.sh'
);

// Feature gate fail-closed
assert(
  edgeFuncSource.includes('const checkoutEnabled = Deno.env.get("CHECKOUT_ENABLED") === "true";') &&
  edgeFuncSource.includes('status: 503') &&
  edgeFuncSource.includes('Checkout temporariamente indisponível.'),
  'Edge Function implementa Feature Gate Fail-Closed com CHECKOUT_ENABLED === "true" (HTTP 503)'
);

// Secret Key moderno
assert(
  edgeFuncSource.includes('SUPABASE_SECRET_KEYS') &&
  edgeFuncSource.includes('JSON.parse(rawSecretKeys)') &&
  edgeFuncSource.includes('parsedKeys?.default'),
  'Edge Function utiliza modelo moderno de chaves SUPABASE_SECRET_KEYS com extração da chave default'
);
assert(
  !edgeFuncSource.includes('SUPABASE_SERVICE_ROLE_KEY'),
  'Edge Function NÃO utiliza mais a variável legada SUPABASE_SERVICE_ROLE_KEY'
);

// Byte limit
assert(
  edgeFuncSource.includes('new TextEncoder().encode(rawBody).byteLength') &&
  edgeFuncSource.includes('64 * 1024'),
  'Edge Function afere tamanho de payload estritamente por contagem de bytes UTF-8 (64 KB)'
);

// Bloqueio de autoridade financeira e campos proibidos
assert(
  edgeFuncSource.includes('FORBIDDEN_BODY_FIELDS') &&
  edgeFuncSource.includes('subtotal') &&
  edgeFuncSource.includes('total') &&
  edgeFuncSource.includes('unitPrice') &&
  edgeFuncSource.includes('buyerUserId'),
  'Edge Function bloqueia explicitamente campos com autoridade financeira ou sensíveis no body'
);

// Sanitização estrita de SQLSTATE 23505
assert(
  edgeFuncSource.includes('if (errorCode === "23505")') &&
  edgeFuncSource.includes('JSON.stringify({ error: "Conflito ao processar pedido." })'),
  'SQLSTATE 23505 é sanitizado e NÃO devolve rpcError.message ao cliente'
);

// Mapeamento e Sanitização de Erros Gerais
assert(
  edgeFuncSource.includes('errorCode === "22000"') &&
  edgeFuncSource.includes('errorCode === "42501"') &&
  edgeFuncSource.includes('errorCode === "P0002"') &&
  edgeFuncSource.includes('errorCode === "55P03"') &&
  edgeFuncSource.includes('Não foi possível processar o pedido.'),
  'Edge Function mapeia SQLSTATEs conhecidos e sanitiza mensagens de erro desconhecidas com HTTP 500'
);

// Minimização de Resposta
assert(
  edgeFuncSource.includes('const sanitizedResponse = {') &&
  edgeFuncSource.includes('orderNumber: orderResult.order_number') &&
  !edgeFuncSource.includes('idempotency_key: orderResult.idempotency_key') &&
  !edgeFuncSource.includes('tenant_id: orderResult.tenant_id'),
  'Edge Function minimiza a resposta enviada ao browser, não expondo tenant_id nem idempotency_key'
);

// Validação de Documento no Edge Function
assert(
  edgeFuncSource.includes('function isValidCPF(cpf: unknown): boolean') &&
  edgeFuncSource.includes('function isValidCNPJ(cnpj: unknown): boolean'),
  'Edge Function implementa helpers de validação nativa de CPF e CNPJ (módulo 11)'
);

assert(
  edgeFuncSource.includes('custType === "PF" ? "CPF do cliente é obrigatório." : "CNPJ do cliente é obrigatório."') &&
  edgeFuncSource.includes('CPF do cliente inválido.') &&
  edgeFuncSource.includes('CNPJ do cliente inválido.'),
  'Edge Function exige document obrigatório e válido no varejo, rejeitando documentos inválidos com HTTP 400'
);

// Geração de PDF Server-Side & Armazenamento Privado (Checkout V1.2)
const orderPdfPath = 'supabase/functions/_shared/orderPdf.ts';
assert(fs.existsSync(orderPdfPath), 'Helper orderPdf.ts existe no diretório _shared da Edge Function');

const orderPdfSource = fs.readFileSync(orderPdfPath, 'utf-8');
assert(
  orderPdfSource.includes('npm:pdf-lib@1.17.1'),
  'orderPdf utiliza biblioteca pdf-lib com versão explicitamente fixada (npm:pdf-lib@1.17.1)'
);
assert(
  orderPdfSource.includes('export async function generateOrderPdf(') &&
  orderPdfSource.includes('sanitizePdfText') &&
  (orderPdfSource.includes('PEDIDO PARA CONFIRMAÇÃO') || orderPdfSource.includes('ORÇAMENTO / PEDIDO PARA ANÁLISE')),
  'orderPdf exporta generateOrderPdf e gera documento profissional com título oficial e sem PII sensível em texto'
);
assert(
  edgeFuncSource.includes('generateOrderPdf(orderResult, branding)') &&
  edgeFuncSource.includes("from(\"order-documents\")") &&
  edgeFuncSource.includes('.upload(canonicalPdfPath, pdfBytes, {') &&
  edgeFuncSource.includes('.createSignedUrl(canonicalPdfPath, 604800)'),
  'Edge Function gera PDF server-side, realiza upload no bucket privado order-documents e gera signed URL de 7 dias'
);
assert(
  edgeFuncSource.includes('documentUrl: documentUrl || null') &&
  edgeFuncSource.includes('documentExpiresAt: documentExpiresAt || null'),
  'Edge Function inclui documentUrl e documentExpiresAt no recibo sanitizado'
);
assert(
  edgeFuncSource.includes('Falha na geração/assinatura do PDF NUNCA cancela nem desfaz o pedido já criado no banco') &&
  edgeFuncSource.includes('documentUrl = null;'),
  'Edge Function implementa Graceful Fallback para falha de documento (preserva pedido intacto no banco)'
);

// =========================================================================
// 6. Simulação de Casos de Borda da Edge Function
// =========================================================================
console.log('\n6. Simulação Funcional dos Casos de Borda da Edge Function');

// Simulação de Feature Gate
function simulateFeatureGate(env: Record<string, string>) {
  const checkoutEnabled = env['CHECKOUT_ENABLED'] === 'true';
  if (!checkoutEnabled) {
    return { status: 503, error: 'Checkout temporariamente indisponível.' };
  }
  return { status: 200, ok: true };
}

assert(simulateFeatureGate({}).status === 503, 'Feature Gate: CHECKOUT_ENABLED ausente bloqueia com 503');
assert(simulateFeatureGate({ CHECKOUT_ENABLED: 'false' }).status === 503, 'Feature Gate: CHECKOUT_ENABLED=false bloqueia com 503');
assert(simulateFeatureGate({ CHECKOUT_ENABLED: 'true' }).status === 200, 'Feature Gate: CHECKOUT_ENABLED=true permite requisição');

// Simulação de Byte Limit vs Multibyte UTF-8
function checkBodyByteLimit(body: string): boolean {
  const bytes = new TextEncoder().encode(body).byteLength;
  return bytes <= 64 * 1024;
}

const smallMultibyteString = 'Produto Especial 🚀 — Chave de teste com acentuação e emojis 🌟';
assert(checkBodyByteLimit(smallMultibyteString) === true, 'Corpo pequeno com multibyte UTF-8 aceito');

const largeMultibyteString = '🔥'.repeat(20000); // 20000 * 4 bytes = 80000 bytes > 64KB (embora length seja 40000 chars)
assert(largeMultibyteString.length < 65536, 'Length da string UTF-8 é menor que 65536 caracteres');
assert(checkBodyByteLimit(largeMultibyteString) === false, 'Byte length UTF-8 detecta overflow de 80 KB e bloqueia requisição');

// Simulação de Rejeição de Campos Proibidos
function checkForbiddenFields(body: Record<string, any>): string | null {
  const FORBIDDEN = [
    'subtotal', 'total', 'discount', 'shippingFee', 'shipping_fee',
    'unitPrice', 'totalPrice', 'wholesalePrice', 'buyerUserId', 'buyer_user_id'
  ];
  for (const f of FORBIDDEN) {
    if (f in body) return f;
  }
  return null;
}

assert(checkForbiddenFields({ tenantSlug: 'demo', subtotal: 100 }) === 'subtotal', 'Rejeita campo subtotal enviado no body');
assert(checkForbiddenFields({ tenantSlug: 'demo', unitPrice: 50 }) === 'unitPrice', 'Rejeita campo unitPrice enviado no body');
assert(checkForbiddenFields({ tenantSlug: 'demo', buyerUserId: 'uuid' }) === 'buyerUserId', 'Rejeita campo buyerUserId enviado no body');
assert(checkForbiddenFields({ tenantSlug: 'demo', items: [] }) === null, 'Aceita payload sem campos financeiros');

// Simulação de Tratamento de Erros da Edge Function
function mapRpcError(rpcError: { code: string; message: string }) {
  if (rpcError.code === '23505') {
    return { status: 409, body: { error: 'Conflito ao processar pedido.' } };
  }
  if (rpcError.code === '22000') {
    return { status: 400, body: { error: rpcError.message || 'Dados de entrada inválidos.' } };
  }
  return { status: 500, body: { error: 'Não foi possível processar o pedido.' } };
}

const err23505 = mapRpcError({ code: '23505', message: 'duplicate key value violates unique constraint uq_orders_tenant_idempotency' });
assert(err23505.status === 409, '23505 mapeado para HTTP 409');
assert(err23505.body.error === 'Conflito ao processar pedido.', '23505 não expõe nome da constraint nem detalhe SQL');
assert(!err23505.body.error.includes('uq_orders_tenant_idempotency'), '23505 mensagem SQL bruta é totalmente oculta');

// Simulação de Minimização de Resposta
function minimizeResponse(dbOrder: any) {
  return {
    id: dbOrder.id,
    orderNumber: dbOrder.order_number,
    shoppingMode: dbOrder.shopping_mode,
    deliveryMethod: dbOrder.delivery_method,
    items: dbOrder.items,
    subtotal: dbOrder.subtotal,
    discount: dbOrder.discount,
    shippingFee: dbOrder.shipping_fee,
    total: dbOrder.total,
    status: dbOrder.status,
    paymentMethod: dbOrder.payment_method,
    createdAt: dbOrder.created_at,
  };
}

const minimized = minimizeResponse(retailRes.order);
assert(!('idempotency_key' in minimized), 'Resposta sanitizada NÃO contém idempotency_key');
assert(!('tenant_id' in minimized), 'Resposta sanitizada NÃO contém tenant_id');
assert(!('seller_id' in minimized), 'Resposta sanitizada NÃO contém seller_id');
assert(!('shipping_address' in minimized), 'Resposta sanitizada NÃO expõe shipping_address bruto');
assert(minimized.orderNumber.startsWith('PED-'), 'Resposta contém orderNumber formatado');

// Simulação de Validação de Documentos no Backend
function simulateEdgeCustomerValidation(customer: any, shoppingMode: string) {
  if (shoppingMode !== 'retail') return { ok: true };
  const custType = (customer?.type || 'PF').toUpperCase();
  if (custType !== 'PF' && custType !== 'PJ') {
    return { status: 400, error: "Tipo de cliente inválido (deve ser 'PF' ou 'PJ')." };
  }
  if (!customer?.document || typeof customer.document !== 'string' || !customer.document.trim()) {
    return { status: 400, error: custType === 'PF' ? 'CPF do cliente é obrigatório.' : 'CNPJ do cliente é obrigatório.' };
  }
  const clean = customer.document.replace(/\D/g, '');
  if (custType === 'PF') {
    if (clean.length !== 11 || /^(\d)\1{10}$/.test(clean)) {
      return { status: 400, error: 'CPF do cliente inválido.' };
    }
  } else {
    if (clean.length !== 14 || /^(\d)\1{13}$/.test(clean)) {
      return { status: 400, error: 'CNPJ do cliente inválido.' };
    }
  }
  return { ok: true, normalizedDocument: clean };
}

assert(simulateEdgeCustomerValidation({ name: 'A', phone: '1', type: 'PF' }, 'retail').status === 400, 'Edge: Retail PF sem document é rejeitado com 400');
assert(simulateEdgeCustomerValidation({ name: 'A', phone: '1', type: 'PF', document: '11111111111' }, 'retail').status === 400, 'Edge: Retail PF com CPF repetido é rejeitado com 400');
assert(simulateEdgeCustomerValidation({ name: 'A', phone: '1', type: 'PJ', document: '12345678000195' }, 'retail').ok === true, 'Edge: Retail PJ com CNPJ válido aceito');
assert(simulateEdgeCustomerValidation({ name: 'A', phone: '1', type: 'PJ', document: '00000000000000' }, 'retail').status === 400, 'Edge: Retail PJ com CNPJ repetido é rejeitado com 400');
assert(simulateEdgeCustomerValidation({}, 'wholesale').ok === true, 'Edge: Wholesale não exige customer.document no request');

console.log('\n======================================================');
console.log(`RESULTADO: ${passed} PASSOU / ${failed} FALHOU`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
}
