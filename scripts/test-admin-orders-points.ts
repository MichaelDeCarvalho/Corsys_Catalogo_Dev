/**
 * ============================================================================
 * TEST SUITE: ADMIN ORDERS V1 (READ-ONLY REAL ORDERS & SUPABASE RLS INTEGRATION)
 * Arquivo: scripts/test-admin-orders-points.ts
 * ============================================================================
 */

import * as fs from 'fs';
import * as path from 'path';
import { 
  RawAdminOrderRow, 
  adaptAdminOrder, 
  isValidUuid, 
  ALLOWED_ORDER_STATUSES, 
  ALLOWED_PAYMENT_METHODS 
} from '../src/services/adminOrderService';
import { Order, OrderStatus, PaymentMethod } from '../src/types';

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, description: string) {
  if (condition) {
    console.log(`  ✓ ${description}`);
    passCount++;
  } else {
    console.error(`  ✗ FAIL: ${description}`);
    failCount++;
  }
}

console.log('======================================================');
console.log('TEST SUITE: ADMIN ORDERS V1 (READ-ONLY)');
console.log('======================================================');

// =========================================================================
// 1. ESTRUTURA E CONTRATO DO ADMIN ORDER SERVICE
// =========================================================================
console.log('\n1. Arquitetura e Contrato do AdminOrderService (Read-Only)');

const servicePath = 'src/services/adminOrderService.ts';
assert(fs.existsSync(servicePath), 'adminOrderService.ts existe no workspace');

const serviceContent = fs.readFileSync(servicePath, 'utf-8');

assert(
  serviceContent.includes('export interface RawAdminOrderRow'),
  'Declara interface tipada RawAdminOrderRow'
);

assert(
  serviceContent.includes('export function adaptAdminOrder('),
  'Exporta função adaptAdminOrder para transformação fail-closed'
);

assert(
  serviceContent.includes('export async function fetchAdminOrders('),
  'Exporta função fetchAdminOrders para consulta oficial ao Supabase'
);

assert(
  serviceContent.includes(".from('orders')") || serviceContent.includes('.from("orders")'),
  'Consulta estritamente a tabela public.orders'
);

assert(
  serviceContent.includes(".eq('tenant_id', tenantId)") || serviceContent.includes('.eq("tenant_id", tenantId)'),
  'fetchAdminOrders filtra explicitamente por tenant_id = tenantId'
);

assert(
  serviceContent.includes(".order('created_at', { ascending: false })") || serviceContent.includes('.order("created_at", { ascending: false })'),
  'fetchAdminOrders ordena deterministicamente por created_at DESC'
);

assert(
  !serviceContent.includes('localStorage') && !serviceContent.includes('INITIAL_ORDERS'),
  'adminOrderService possui zero localStorage e zero INITIAL_ORDERS'
);

assert(
  !serviceContent.includes(".update(") && !serviceContent.includes('.update('),
  'Nenhuma chamada .from("orders").update() em adminOrderService (read-only)'
);

assert(
  !serviceContent.includes(".delete(") && !serviceContent.includes('.delete('),
  'Nenhuma chamada .from("orders").delete() em adminOrderService (read-only)'
);

// =========================================================================
// 2. VALIDAÇÃO FAIL-CLOSED DO ADAPTER (ADAPTADMINORDER)
// =========================================================================
console.log('\n2. Auditoria e Validação Fail-Closed do Adapter adaptAdminOrder');

const validMockRow: RawAdminOrderRow = {
  id: 'a0000000-0000-4000-a000-000000000001',
  tenant_id: 'b0000000-0000-4000-a000-000000000002',
  order_number: 'PED-20261001-000003',
  seller_id: null,
  seller_code: null,
  customer: {
    name: 'Distribuidora Central Ltda',
    document: '12.345.678/0001-90',
    email: 'compras@distribuidora.com.br',
    phone: '11999998888',
    companyName: 'Central Atacado',
    type: 'PJ'
  },
  shipping_address: {
    street: 'Av. Industrial',
    number: '1500',
    complement: 'Galpão 4',
    neighborhood: 'Distrito Industrial',
    city: 'São Paulo',
    state: 'SP',
    zipCode: '01001-000'
  },
  items: [
    {
      productId: 'c0000000-0000-4000-a000-000000000003',
      productName: 'BROCA CERAMICA/PORCELANATO 100MM',
      productSku: 'BR021',
      productImage: 'https://images.corsys.com/br021.webp',
      unitPrice: 122.13,
      quantity: 10,
      unit: 'un',
      totalPrice: 1221.30,
      selectedVariant: '100MM'
    }
  ],
  subtotal: 1221.30,
  discount: 0.00,
  shipping_fee: 0.00,
  total: 1221.30,
  status: 'pending',
  payment_method: 'pix',
  notes: 'Entrega preferencial pela manhã',
  source: 'web_checkout',
  created_at: '2026-10-01T12:00:00.000Z',
  updated_at: '2026-10-01T12:00:00.000Z',
  shopping_mode: 'wholesale',
  delivery_method: 'Transportadora'
};

// Caso 2.1: Adaptação bem-sucedida
const adapted = adaptAdminOrder(validMockRow);
assert(adapted.id === validMockRow.id, 'Adapter preserva ID UUID');
assert(adapted.orderNumber === 'PED-20261001-000003', 'Adapter preserva orderNumber');
assert(adapted.customer.name === 'Distribuidora Central Ltda', 'Adapter projeta customer.name');
assert(adapted.customer.type === 'PJ', 'Adapter projeta customer.type PJ');
assert(adapted.items.length === 1, 'Adapter projeta lista de itens');
assert(adapted.items[0].productSku === 'BR021', 'Adapter projeta SKU do item');
assert(adapted.shoppingMode === 'wholesale', 'Adapter projeta shoppingMode atacado');
assert(adapted.deliveryMethod === 'Transportadora', 'Adapter projeta deliveryMethod');
assert(adapted.total === 1221.30, 'Adapter projeta total financeiro');

// Caso 2.2: Fail-closed para ID UUID inválido
let threwUuid = false;
try {
  adaptAdminOrder({ ...validMockRow, id: 'invalid-id' });
} catch {
  threwUuid = true;
}
assert(threwUuid, 'Rejeita id que não seja UUID válido');

// Caso 2.3: Fail-closed para tenant_id inválido
let threwTenant = false;
try {
  adaptAdminOrder({ ...validMockRow, tenant_id: 'invalid-tenant' });
} catch {
  threwTenant = true;
}
assert(threwTenant, 'Rejeita tenant_id que não seja UUID válido');

// Caso 2.4: Fail-closed para order_number vazio
let threwOrderNum = false;
try {
  adaptAdminOrder({ ...validMockRow, order_number: '   ' });
} catch {
  threwOrderNum = true;
}
assert(threwOrderNum, 'Rejeita order_number vazio ou apenas espaços');

// Caso 2.5: Fail-closed para customer ausente ou incompleto
let threwCust = false;
try {
  adaptAdminOrder({ ...validMockRow, customer: null });
} catch {
  threwCust = true;
}
assert(threwCust, 'Rejeita customer nulo');

let threwCustPhone = false;
try {
  adaptAdminOrder({ ...validMockRow, customer: { name: 'João' } });
} catch {
  threwCustPhone = true;
}
assert(threwCustPhone, 'Rejeita customer sem telefone');

// Caso 2.6: Fail-closed para endereço de entrega inválido
let threwAddr = false;
try {
  adaptAdminOrder({ ...validMockRow, shipping_address: { street: '' } });
} catch {
  threwAddr = true;
}
assert(threwAddr, 'Rejeita shipping_address com rua vazia');

// Caso 2.7: Fail-closed para lista de itens vazia
let threwItems = false;
try {
  adaptAdminOrder({ ...validMockRow, items: [] });
} catch {
  threwItems = true;
}
assert(threwItems, 'Rejeita pedido com array de itens vazio');

// Caso 2.8: Fail-closed para item com productId inválido
let threwItemProd = false;
try {
  adaptAdminOrder({
    ...validMockRow,
    items: [{ ...validMockRow.items[0], productId: 'invalid-prod' }]
  });
} catch {
  threwItemProd = true;
}
assert(threwItemProd, 'Rejeita item com productId que não seja UUID');

// Caso 2.9: Fail-closed para valores financeiros negativos ou não-finitos
let threwNegativeTotal = false;
try {
  adaptAdminOrder({ ...validMockRow, total: -10 });
} catch {
  threwNegativeTotal = true;
}
assert(threwNegativeTotal, 'Rejeita total financeiro negativo');

let threwNanTotal = false;
try {
  adaptAdminOrder({ ...validMockRow, total: 'abc' });
} catch {
  threwNanTotal = true;
}
assert(threwNanTotal, 'Rejeita total financeiro não numérico / NaN');

// Caso 2.10: Fail-closed para status não permitido
let threwStatus = false;
try {
  adaptAdminOrder({ ...validMockRow, status: 'arbitrary_status' });
} catch {
  threwStatus = true;
}
assert(threwStatus, 'Rejeita status não homologado');

// Caso 2.11: Fail-closed para forma de pagamento não permitida
let threwPayment = false;
try {
  adaptAdminOrder({ ...validMockRow, payment_method: 'crypto' });
} catch {
  threwPayment = true;
}
assert(threwPayment, 'Rejeita forma de pagamento não homologada');

// Caso 2.12: Fail-closed para data inválida
let threwDate = false;
try {
  adaptAdminOrder({ ...validMockRow, created_at: 'invalid-date' });
} catch {
  threwDate = true;
}
assert(threwDate, 'Rejeita created_at com formato de data inválido');

// =========================================================================
// 2B. VALIDAÇÃO DO CONTRATO REAL (CAMPOS OPCIONAIS E SEM PII)
// =========================================================================
console.log('\n2B. Validação do Contrato Real (Campos Opcionais V1 & Sem PII)');

// Caso 2B.1 (PASS): street preenchida, number vazio, neighborhood vazio, state vazio, demais opcionais ausentes, email opcional ausente ou vazio
const realMinimalRowWithEmptyStrings: RawAdminOrderRow = {
  ...validMockRow,
  id: 'b1111111-1111-4000-a000-111111111111',
  order_number: 'PED-20261002-000004',
  customer: {
    name: 'Mercado Central V1',
    phone: '11977776666',
    type: 'PJ',
    email: '' // email vazio opcional
  },
  shipping_address: {
    street: 'Rua das Flores',
    number: '', // vazio
    neighborhood: '', // vazio
    state: '' // vazio
  }
};

const adaptedMinimalEmpty = adaptAdminOrder(realMinimalRowWithEmptyStrings);
assert(adaptedMinimalEmpty.shippingAddress.street === 'Rua das Flores', 'PASS: street preenchida adaptada');
assert(adaptedMinimalEmpty.shippingAddress.number === undefined, 'PASS: number vazio resulta em undefined sem inventar dados');
assert(adaptedMinimalEmpty.shippingAddress.neighborhood === undefined, 'PASS: neighborhood vazio resulta em undefined');
assert(adaptedMinimalEmpty.shippingAddress.state === undefined, 'PASS: state vazio resulta em undefined');
assert(adaptedMinimalEmpty.shippingAddress.city === undefined, 'PASS: city ausente resulta em undefined');
assert(adaptedMinimalEmpty.shippingAddress.zipCode === undefined, 'PASS: zipCode ausente resulta em undefined');
assert(adaptedMinimalEmpty.shippingAddress.complement === undefined, 'PASS: complement ausente resulta em undefined');
assert(adaptedMinimalEmpty.customer.email === undefined, 'PASS: email vazio resulta em undefined');

// Caso 2B.2 (PASS): apenas street no shipping_address e email ausente no customer
const realMinimalRowAbsentFields: RawAdminOrderRow = {
  ...validMockRow,
  id: 'b2222222-2222-4000-a000-222222222222',
  order_number: 'PED-20261002-000005',
  customer: {
    name: 'Consumidor Varejo',
    phone: '11988889999',
    type: 'PF'
  },
  shipping_address: {
    street: 'Av. Paulista'
  }
};
const adaptedAbsentFields = adaptAdminOrder(realMinimalRowAbsentFields);
assert(adaptedAbsentFields.shippingAddress.street === 'Av. Paulista', 'PASS: shipping_address com apenas street adaptado com sucesso');
assert(adaptedAbsentFields.customer.email === undefined, 'PASS: email ausente no customer é permitido');
assert(adaptedAbsentFields.customer.document === undefined, 'PASS: document ausente no customer é permitido');
assert(adaptedAbsentFields.customer.companyName === undefined, 'PASS: companyName ausente no customer é permitido');

// Caso 2B.3 (FAIL): customer sem name
let threwCustomerNoName = false;
try {
  adaptAdminOrder({
    ...validMockRow,
    customer: { phone: '11988889999', type: 'PF' }
  });
} catch {
  threwCustomerNoName = true;
}
assert(threwCustomerNoName, 'FAIL: Rejeita customer sem name (ou name vazio)');

// Caso 2B.4 (FAIL): customer sem phone
let threwCustomerNoPhone = false;
try {
  adaptAdminOrder({
    ...validMockRow,
    customer: { name: 'Cliente Teste', type: 'PF' }
  });
} catch {
  threwCustomerNoPhone = true;
}
assert(threwCustomerNoPhone, 'FAIL: Rejeita customer sem phone (ou phone vazio)');

// Caso 2B.5 (FAIL): shipping sem street
let threwShippingNoStreet = false;
try {
  adaptAdminOrder({
    ...validMockRow,
    shipping_address: { number: '100', city: 'São Paulo' }
  });
} catch {
  threwShippingNoStreet = true;
}
assert(threwShippingNoStreet, 'FAIL: Rejeita shipping_address sem street (ou street vazia)');

// Caso 2B.6 (FAIL): customer não-objeto (string, número, array)
let threwCustomerNonObject = false;
try {
  adaptAdminOrder({
    ...validMockRow,
    customer: 'Cliente String Invalida'
  });
} catch {
  threwCustomerNonObject = true;
}
assert(threwCustomerNonObject, 'FAIL: Rejeita customer que não seja objeto');

let threwCustomerArray = false;
try {
  adaptAdminOrder({
    ...validMockRow,
    customer: ['nome', 'telefone']
  });
} catch {
  threwCustomerArray = true;
}
assert(threwCustomerArray, 'FAIL: Rejeita customer como array');

// Caso 2B.7 (FAIL): shipping_address não-objeto (string, número, array)
let threwShippingNonObject = false;
try {
  adaptAdminOrder({
    ...validMockRow,
    shipping_address: 'Rua Qualquer, 100'
  });
} catch {
  threwShippingNonObject = true;
}
assert(threwShippingNonObject, 'FAIL: Rejeita shipping_address que não seja objeto');

let threwShippingArray = false;
try {
  adaptAdminOrder({
    ...validMockRow,
    shipping_address: ['Rua Qualquer', '100']
  });
} catch {
  threwShippingArray = true;
}
assert(threwShippingArray, 'FAIL: Rejeita shipping_address como array');

// =========================================================================
// 3. INTEGRAÇÃO NO TENANTDASHBOARD.TSX (ÚNICO SOURCE OF TRUTH)
// =========================================================================
console.log('\n3. Auditoria de Integração no TenantDashboard (Source of Truth)');

const dashboardPath = 'src/components/tenantadmin/TenantDashboard.tsx';
const dashboardContent = fs.readFileSync(dashboardPath, 'utf-8');

assert(
  dashboardContent.includes("from '../../services/adminOrderService'") ||
  dashboardContent.includes('from "../../services/adminOrderService"'),
  'TenantDashboard importa de adminOrderService'
);

assert(
  dashboardContent.includes('fetchAdminOrders'),
  'TenantDashboard invoca fetchAdminOrders para pedidos reais'
);

assert(
  dashboardContent.includes('const [adminOrders, setAdminOrders] = useState<Order[]>'),
  'TenantDashboard gerencia estado tipado adminOrders como source of truth'
);

assert(
  dashboardContent.includes('loadAdminOrders = useCallback'),
  'TenantDashboard possui loader dedicado loadAdminOrders'
);

assert(
  !dashboardContent.includes('currentTenantOrders.reduce'),
  'currentTenantOrders NÃO alimenta cálculo de faturamento (KPIs)'
);

assert(
  !dashboardContent.includes('currentTenantOrders.length'),
  'currentTenantOrders NÃO alimenta contagem total de pedidos'
);

assert(
  !dashboardContent.includes('currentTenantOrders.filter'),
  'currentTenantOrders NÃO alimenta contagem de pedidos pendentes'
);

assert(
  dashboardContent.includes('adminOrders.reduce((sum, o) => sum + o.total, 0)'),
  'TenantDashboard calcula totalRevenue exclusivamente de adminOrders'
);

assert(
  dashboardContent.includes("adminOrders.filter(o => o.status === 'pending').length"),
  'TenantDashboard calcula pendingOrders exclusivamente de adminOrders'
);

assert(
  dashboardContent.includes('orders={adminOrders}'),
  'TenantDashboard injeta adminOrders diretamente como prop de OrderManager'
);

assert(
  !dashboardContent.includes('orders={currentTenantOrders}'),
  'currentTenantOrders NÃO alimenta OrderManager'
);

assert(
  !dashboardContent.includes('onUpdateOrderStatus'),
  'Nenhuma prop onUpdateOrderStatus repassada pelo TenantDashboard'
);

// =========================================================================
// 4. INTEGRAÇÃO NO ORDERMANAGER.TSX (ESTRITAMENTE PROPS-DRIVEN & READ-ONLY)
// =========================================================================
console.log('\n4. Auditoria de Integração no OrderManager (Props-Driven & Read-Only)');

const orderManagerPath = 'src/components/tenantadmin/OrderManager.tsx';
const orderManagerContent = fs.readFileSync(orderManagerPath, 'utf-8');

assert(
  orderManagerContent.includes('export interface OrderManagerProps'),
  'OrderManager exporta OrderManagerProps'
);

assert(
  orderManagerContent.includes('orders: Order[];'),
  'OrderManagerProps define prop obrigatória orders'
);

assert(
  !orderManagerContent.includes('fetchAdminOrders'),
  'OrderManager NÃO importa fetchAdminOrders (zero segundo fluxo de consulta)'
);

assert(
  !orderManagerContent.includes('supabase') && !orderManagerContent.includes('getSupabaseClient'),
  'OrderManager NÃO faz consulta Supabase direta'
);

assert(
  !orderManagerContent.includes('currentTenantOrders'),
  'OrderManager NÃO consome currentTenantOrders de useApp'
);

assert(
  !orderManagerContent.includes('updateOrderStatus'),
  'OrderManager NÃO consome updateOrderStatus de useApp'
);

assert(
  !orderManagerContent.includes('onUpdateOrderStatus'),
  'Nenhuma prop onUpdateOrderStatus em OrderManager'
);

assert(
  !orderManagerContent.includes('setAdminOrders'),
  'Nenhum setAdminOrders para alteração em memória de status'
);

assert(
  !orderManagerContent.includes('value={order.status}') &&
  !orderManagerContent.includes('value={selectedOrder.status}'),
  'Nenhum elemento <select> para alteração de status do pedido (read-only estrito)'
);

assert(
  orderManagerContent.includes('getStatusBadge(order.status)'),
  'Status na tabela é exibido como badge oficial'
);

assert(
  orderManagerContent.includes('getStatusBadge(selectedOrder.status)'),
  'Status no modal de detalhes é exibido como badge oficial'
);

assert(
  orderManagerContent.includes('handleUpdateStatus') &&
  orderManagerContent.includes('updateAdminOrderStatus'),
  'OrderManager integra mutação de status server-side via updateAdminOrderStatus'
);

assert(
  orderManagerContent.includes('handleGeneratePdf') &&
  (orderManagerContent.includes('generateAdminOrderPdf') || orderManagerContent.includes('getOrderPdfDocument')),
  'OrderManager integra geração de PDF administrativo via generateAdminOrderPdf'
);

assert(
  (orderManagerContent.includes('id="order-print-root"') || orderManagerContent.includes('id="printable-order-slip"')) &&
  orderManagerContent.includes('handlePrintSlip'),
  'OrderManager isola comprovante para impressão via #order-print-root'
);

assert(
  orderManagerContent.includes('no-print'),
  'OrderManager marca botões de controle e modal com classe no-print'
);

assert(
  !orderManagerContent.includes('.from(\'orders\').update') && !orderManagerContent.includes('.from("orders").update'),
  'Zero chamada .from("orders").update() em OrderManager (delegação exclusiva para Edge Function)'
);

assert(
  !orderManagerContent.includes('.from(\'orders\').delete') && !orderManagerContent.includes('.from("orders").delete'),
  'Zero chamada .from("orders").delete() em OrderManager (zero hard delete)'
);

assert(
  !orderManagerContent.includes('INITIAL_ORDERS'),
  'Zero referência a INITIAL_ORDERS em OrderManager'
);

assert(
  !orderManagerContent.includes('localStorage'),
  'Zero leitura de localStorage em OrderManager'
);

// =========================================================================
// 5. ISOLAMENTO DE PEDIDOS MOCK (PED-2025-0841 & PED-2025-0842)
// =========================================================================
console.log('\n5. Isolamento de Pedidos Mock Fora do Fluxo Administrativo');

assert(
  !dashboardContent.includes('PED-2025-0841') && !dashboardContent.includes('PED-2025-0842'),
  'Pedidos mock PED-2025-0841 e PED-2025-0842 NÃO alimentam o TenantDashboard'
);

assert(
  !orderManagerContent.includes('PED-2025-0841') && !orderManagerContent.includes('PED-2025-0842'),
  'Pedidos mock PED-2025-0841 e PED-2025-0842 NÃO alimentam o OrderManager'
);

assert(
  !serviceContent.includes('PED-2025-0841') && !serviceContent.includes('PED-2025-0842'),
  'Pedidos mock PED-2025-0841 e PED-2025-0842 NÃO alimentam o adminOrderService'
);

const appContextPath = 'src/context/AppContext.tsx';
const appContextContent = fs.readFileSync(appContextPath, 'utf-8');
assert(
  appContextContent.includes('LEGACY DEMO ORDER STATE — NOT AUTHORITATIVE FOR ADMIN ORDERS'),
  'AppContext documenta explicitamente que o estado de orders legado não é autoritativo para o admin'
);

// =========================================================================
// 6. GOVERNANÇA DE MIGRATIONS & EDGE FUNCTION (ADMIN ORDERS V2)
// =========================================================================
console.log('\n6. Governança de Migrations & Edge Function V2');

const migrationFiles = fs.readdirSync('supabase/migrations').filter(f => f.endsWith('.sql'));
assert(
  Array.from({ length: 18 }, (_, i) => String(i + 1).padStart(6, '0'))
    .every(version => migrationFiles.some(file => file.includes(`_${version}_`))),
  'Baseline de migrations até 000018 preservada; migrations posteriores são permitidas'
);

const migration14Path = 'supabase/migrations/20261005170000_000014_admin_order_management.sql';
assert(
  fs.existsSync(migration14Path),
  'Migration 000014 (20261005170000_000014_admin_order_management.sql) existe no workspace'
);

const migration15Path = 'supabase/migrations/20261008_000015_customer_order_tracking.sql';
assert(
  fs.existsSync(migration15Path),
  'Migration 000015 (20261008_000015_customer_order_tracking.sql) existe no workspace'
);

const migration16Path = 'supabase/migrations/20261009000000_000016_customer_order_tracking_hardening.sql';
assert(
  fs.existsSync(migration16Path),
  'Migration 000016 (20261009000000_000016_customer_order_tracking_hardening.sql) existe no workspace'
);

const migration17Path = 'supabase/migrations/20261009010000_000017_checkout_delivery_methods_compat.sql';
assert(
  fs.existsSync(migration17Path),
  'Migration 000017 (20261009010000_000017_checkout_delivery_methods_compat.sql) existe no workspace'
);

const migrationVersions = migrationFiles.map(f => f.split('_')[0]);
assert(
  new Set(migrationVersions).size === migrationFiles.length,
  'Prefixos de versão das migrations são estritamente únicos (sem colisão de versionamento)'
);

const migration14Content = fs.readFileSync(migration14Path, 'utf-8');
assert(
  migration14Content.includes('CREATE OR REPLACE FUNCTION public.manage_order_status_internal') &&
  migration14Content.includes('p_actor_user_id UUID'),
  'Migration 000014 cria RPC manage_order_status_internal com p_actor_user_id'
);

assert(
  migration14Content.includes('SECURITY DEFINER') &&
  migration14Content.includes("SET search_path = ''"),
  'manage_order_status_internal utiliza SECURITY DEFINER e search_path limpo'
);

assert(
  migration14Content.includes('REVOKE ALL ON FUNCTION public.manage_order_status_internal') &&
  migration14Content.includes('GRANT EXECUTE ON FUNCTION public.manage_order_status_internal') &&
  migration14Content.includes('TO service_role'),
  'manage_order_status_internal é concedida EXCLUSIVAMENTE a service_role'
);

assert(
  migration14Content.includes('REVOKE ALL ON FUNCTION public.manage_order_status(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;'),
  'Migration 000014 reafirma defensivamente bloqueio total da RPC legada manage_order_status'
);

// Auditoria da Edge Function manage-order-status
const edgeFunctionPath = 'supabase/functions/manage-order-status/index.ts';
assert(
  fs.existsSync(edgeFunctionPath),
  'Edge Function manage-order-status existe no workspace'
);

const edgeFunctionContent = fs.readFileSync(edgeFunctionPath, 'utf-8');
assert(
  edgeFunctionContent.includes('auth.getUser()') &&
  edgeFunctionContent.includes('actorUserId'),
  'Edge Function manage-order-status deriva ator server-side via auth.getUser()'
);

assert(
  edgeFunctionContent.includes('manage_order_status_internal'),
  'Edge Function manage-order-status delega mutação para RPC interna manage_order_status_internal'
);

// Auditoria da Edge Function dedicada generate-admin-order-pdf
const generatePdfFunctionPath = 'supabase/functions/generate-admin-order-pdf/index.ts';
assert(
  fs.existsSync(generatePdfFunctionPath),
  'Edge Function dedicada generate-admin-order-pdf existe no workspace'
);

const generatePdfFunctionContent = fs.readFileSync(generatePdfFunctionPath, 'utf-8');
assert(
  generatePdfFunctionContent.includes('generateOrderPdf') &&
  generatePdfFunctionContent.includes("'order-documents'"),
  'Edge Function generate-admin-order-pdf gera PDF server-side e grava no bucket order-documents'
);

// Auditoria do supabase/config.toml
const configTomlContent = fs.readFileSync('supabase/config.toml', 'utf-8');
assert(
  configTomlContent.includes('[functions.manage-order-status]') &&
  configTomlContent.includes('verify_jwt = true'),
  'supabase/config.toml declara [functions.manage-order-status] com verify_jwt = true'
);

// Auditoria do CSS de impressão
const indexCssContent = fs.readFileSync('src/index.css', 'utf-8');
assert(
  indexCssContent.includes('@media print') &&
  (indexCssContent.includes('#order-print-root') || indexCssContent.includes('#printable-order-slip')) &&
  indexCssContent.includes('.no-print'),
  'src/index.css configura regras isoladas de impressão via @media print'
);

// =========================================================================
// RESULTADO FINAL
// =========================================================================
console.log('\n======================================================');
console.log(`TOTAL DE TESTES: ${passCount + failCount}`);
console.log(`PASSOU: ${passCount}`);
console.log(`FALHOU: ${failCount}`);
console.log('======================================================');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
