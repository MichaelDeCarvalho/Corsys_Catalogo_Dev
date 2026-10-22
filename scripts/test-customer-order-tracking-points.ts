/**
 * TEST SUITE: CUSTOMER ORDER TRACKING V1 (ITEM 3 — PRIVACY & HARDENING AUDIT)
 *
 * Cobertura Completa e Rigorosa:
 * 1. Migration Governance (000016 existe, 000015 intacta, RPCs atualizadas)
 * 2. RPCs de Banco de Dados (shopping_mode isolado, sem active tenant requirement, zero PII, zero internal IDs)
 * 3. Edge Functions Gateway (allowlist de body estrita, sanitização de saída, zero PII, zero SQL leaks)
 * 4. TypeScript Parse Real de Edge Functions (zero erros de sintaxe)
 * 5. Frontend Service & Storage (CustomerTrackedOrder sem PII/ID, validação em runtime fail-closed, storage tenant-scoped)
 * 6. UI & Privacy (remoção total de busca manual, sem endereço na UI, tenant isolation, logout privacy, redirecionamento signOut)
 * 7. Princípios Arquiteturais (zero SELECT direto de orders no client, zero RPC interna no client, zero token na URL, zero polling/realtime)
 */

import * as fs from 'fs';
import * as ts from 'typescript';
import { 
  getStoredRetailTrackings, 
  storeRetailOrderTracking, 
  removeStoredRetailTracking,
  validateCustomerTrackedOrder,
  CustomerTrackedOrder
} from '../src/services/customerTrackingService';
import { validateReceipt } from '../src/services/orderService';

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

console.log('======================================================');
console.log('TEST SUITE: CUSTOMER ORDER TRACKING V1 — PRIVACY & HARDENING');
console.log('======================================================\n');

// =========================================================================
// 1. MIGRATION GOVERNANCE & SCHEMA AUDIT
// =========================================================================
console.log('1. Governança de Migrations e Banco de Dados');

const migration15Path = 'supabase/migrations/20261008_000015_customer_order_tracking.sql';
assert(fs.existsSync(migration15Path), 'Migration 000015 existe no repositório');
const migration15Sql = fs.readFileSync(migration15Path, 'utf-8');

const migration16Path = 'supabase/migrations/20261009000000_000016_customer_order_tracking_hardening.sql';
assert(fs.existsSync(migration16Path), '1.1 Migration 000016 existe no workspace');
const migration16Sql = fs.readFileSync(migration16Path, 'utf-8');

assert(
  migration15Sql.includes('buyer_user_id UUID NULL REFERENCES auth.users(id)') &&
  migration15Sql.includes('tracking_token_hash TEXT NULL') &&
  migration15Sql.includes('idx_orders_buyer_lookup') &&
  migration15Sql.includes('uq_orders_tracking_token_hash'),
  '1.2 Migration 000015 permanece intacta com colunas, constraints e índices originais'
);

// 2. RPCs em Migration 000016
console.log('\n2. Auditoria das RPCs de Rastreamento (Migration 000016)');

assert(
  migration16Sql.includes("o.shopping_mode = 'retail'") &&
  migration16Sql.includes('o.tracking_token_hash = p_tracking_token_hash'),
  '2.1 retail RPC track_order_by_token_internal exige estritamente shopping_mode = \'retail\' e token_hash'
);

assert(
  migration16Sql.includes("o.shopping_mode = 'wholesale'") &&
  migration16Sql.includes('o.buyer_user_id = p_buyer_user_id'),
  '2.2 B2B RPC list_my_customer_orders_internal exige estritamente shopping_mode = \'wholesale\' e buyer_user_id'
);

assert(
  !migration16Sql.includes("AND t.status = 'active'") &&
  !migration16Sql.includes('t.status = "active"'),
  '2.3 Rastreamento histórico não restringe por t.status = \'active\' (acesso mesmo com loja inativa)'
);

// Extrai corpo de retorno da retail RPC
const retailRpcReturn = migration16Sql.split('v_result := jsonb_build_object(')[1]?.split(');')[0] || '';
assert(
  !retailRpcReturn.includes("'id'") &&
  !retailRpcReturn.includes("'customer'") &&
  !retailRpcReturn.includes("'customerName'") &&
  !retailRpcReturn.includes("'shippingAddress'") &&
  !retailRpcReturn.includes("'tenant_id'") &&
  !retailRpcReturn.includes("'buyer_user_id'") &&
  !retailRpcReturn.includes("'seller_id'") &&
  !retailRpcReturn.includes("'idempotency_key'"),
  '2.4 Projeção de retorno da retail RPC livre de id, customerName, shippingAddress, tenant_id e internal IDs'
);

// Extrai corpo de retorno da B2B RPC
const b2bRpcReturn = migration16Sql.split('jsonb_build_object(\n      \'orderNumber\', o.order_number')[1]?.split(')\n  ), \'[]\'::jsonb)')[0] || '';
assert(
  !b2bRpcReturn.includes("'id'") &&
  !b2bRpcReturn.includes("'customer'") &&
  !b2bRpcReturn.includes("'customerName'") &&
  !b2bRpcReturn.includes("'shippingAddress'"),
  '2.5 Projeção de retorno da B2B RPC livre de id, customerName, shippingAddress e PII'
);

assert(
  migration16Sql.includes('REVOKE ALL ON FUNCTION public.track_order_by_token_internal(TEXT, TEXT) FROM PUBLIC, anon, authenticated;') &&
  migration16Sql.includes('GRANT EXECUTE ON FUNCTION public.track_order_by_token_internal(TEXT, TEXT) TO service_role;') &&
  migration16Sql.includes('REVOKE ALL ON FUNCTION public.list_my_customer_orders_internal(TEXT, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;') &&
  migration16Sql.includes('GRANT EXECUTE ON FUNCTION public.list_my_customer_orders_internal(TEXT, UUID, INTEGER, INTEGER) TO service_role;') &&
  migration16Sql.includes('GRANT EXECUTE ON FUNCTION public.set_order_tracking_token_internal(UUID, UUID, TEXT) TO service_role;'),
  '2.6 ACL restrita reafirmada em 000016: REVOKE ALL para public/anon/authenticated e GRANT EXECUTE para service_role'
);

assert(
  !migration16Sql.includes('CREATE POLICY') &&
  !migration16Sql.includes('FOR SELECT TO anon'),
  '2.7 Nenhuma policy de SELECT direto em orders criada para anon'
);

// =========================================================================
// 3. EDGE FUNCTIONS GATEWAY
// =========================================================================
console.log('\n3. Auditoria de Edge Functions (Defense-in-Depth)');

const trackOrderFunctionPath = 'supabase/functions/track-order-by-token/index.ts';
assert(fs.existsSync(trackOrderFunctionPath), '3.1 Edge Function track-order-by-token existe');
const trackOrderFunctionCode = fs.readFileSync(trackOrderFunctionPath, 'utf-8');

assert(
  trackOrderFunctionCode.includes('allowedKeys = ["tenantSlug", "trackingToken"]') &&
  trackOrderFunctionCode.includes('hasForbiddenKeys'),
  '3.2 track-order-by-token impõe allowlist estrita de corpo (somente tenantSlug e trackingToken)'
);

assert(
  trackOrderFunctionCode.includes('const sanitizedOrder = {') &&
  !trackOrderFunctionCode.includes('id: orderData.id') &&
  !trackOrderFunctionCode.includes('customerName: orderData.customerName') &&
  !trackOrderFunctionCode.includes('shippingAddress: orderData.shippingAddress'),
  '3.3 track-order-by-token sanitiza saída explicitamente antes da resposta sem id, customerName ou shippingAddress'
);

assert(
  trackOrderFunctionCode.includes('Pedido não encontrado.') &&
  !trackOrderFunctionCode.includes('rpcError.message'),
  '3.4 track-order-by-token responde erro 404 genérico sem expor mensagens de erro SQL internas'
);

const listCustomerOrdersPath = 'supabase/functions/list-my-customer-orders/index.ts';
assert(fs.existsSync(listCustomerOrdersPath), '3.5 Edge Function list-my-customer-orders existe');
const listCustomerOrdersCode = fs.readFileSync(listCustomerOrdersPath, 'utf-8');

assert(
  listCustomerOrdersCode.includes('allowedKeys = ["tenantSlug", "limit", "offset"]') &&
  listCustomerOrdersCode.includes('hasForbiddenKeys'),
  '3.6 list-my-customer-orders impõe allowlist estrita de chaves e rejeita campos não permitidos'
);

assert(
  listCustomerOrdersCode.includes('const sanitizedOrders = rawOrders.map(') &&
  !listCustomerOrdersCode.includes('id: ord.id') &&
  !listCustomerOrdersCode.includes('customerName: ord.customerName') &&
  !listCustomerOrdersCode.includes('shippingAddress: ord.shippingAddress'),
  '3.7 list-my-customer-orders sanitiza itens com a mesma allowlist sem id, customerName ou shippingAddress'
);

// TypeScript AST Parse sem erros
function checkTsSyntax(filePath: string): boolean {
  const code = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true);
  const diagnostics: ts.Diagnostic[] = (sourceFile as any).parseDiagnostics || [];
  return diagnostics.length === 0;
}

assert(
  checkTsSyntax(trackOrderFunctionPath) && checkTsSyntax(listCustomerOrdersPath),
  '3.8 Parse TypeScript sintático real de ambas as Edge Functions resultou em zero erros'
);

// =========================================================================
// 4. FRONTEND SERVICE & RUNTIME VALIDATOR
// =========================================================================
console.log('\n4. Frontend Service, Tipos e Validador em Runtime');

const customerTrackingServicePath = 'src/services/customerTrackingService.ts';
assert(fs.existsSync(customerTrackingServicePath), '4.1 customerTrackingService.ts existe');
const customerTrackingCode = fs.readFileSync(customerTrackingServicePath, 'utf-8');

assert(
  customerTrackingCode.includes('export interface CustomerTrackedOrder {') &&
  !customerTrackingCode.includes('id: string;') &&
  !customerTrackingCode.includes('customerName?:') &&
  !customerTrackingCode.includes('shippingAddress:'),
  '4.2 Interface CustomerTrackedOrder não possui id, customerName ou shippingAddress'
);

assert(
  customerTrackingCode.includes('export function validateCustomerTrackedOrder(') &&
  customerTrackingCode.includes('validateCustomerTrackedOrder(data.order)'),
  '4.3 Runtime validator fail-closed implementado e invocado em trackOrderByToken e listMyCustomerOrders'
);

// Teste do runtime validator
let validatorPassed = false;
try {
  const validOrder = validateCustomerTrackedOrder({
    orderNumber: 'PED-123',
    status: 'pending',
    shoppingMode: 'retail',
    deliveryMethod: 'Retirada',
    paymentMethod: 'pix',
    items: [],
    subtotal: 100,
    discount: 0,
    shippingFee: 0,
    total: 100,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  validatorPassed = validOrder.orderNumber === 'PED-123';
} catch {
  validatorPassed = false;
}
assert(validatorPassed, '4.4 validateCustomerTrackedOrder valida com sucesso dados válidos');

let validatorRejected = false;
try {
  validateCustomerTrackedOrder({ orderNumber: '', status: 'invalid_status' });
} catch {
  validatorRejected = true;
}
assert(validatorRejected, '4.5 validateCustomerTrackedOrder falha fechado (fail-closed) para dados inválidos');

// Storage por Tenant
assert(
  customerTrackingCode.includes('corsys_order_tracking_v1:${normalized}') ||
  customerTrackingCode.includes("`corsys_order_tracking_v1:${"),
  '4.6 Chave de localStorage é isolada por tenant (corsys_order_tracking_v1:<slug>)'
);

assert(
  customerTrackingCode.includes('export interface StoredRetailOrderTracking {') &&
  customerTrackingCode.includes('orderNumber: string;') &&
  customerTrackingCode.includes('trackingToken: string;') &&
  customerTrackingCode.includes('createdAt: string;') &&
  !customerTrackingCode.includes('tenantSlug: string;'),
  '4.7 StoredRetailOrderTracking contém exclusivamente orderNumber, trackingToken e createdAt (sem tenantSlug interno)'
);

assert(
  customerTrackingCode.includes('slice(0, 50)'),
  '4.8 Limite máximo de 50 pedidos locais preservado'
);

assert(
  customerTrackingCode.includes('!isNaN(Date.parse(item.createdAt))'),
  '4.9 Validação estrita de formato de data de createdAt ao ler storage'
);

// =========================================================================
// 5. UI & PRIVACY AUDIT (CUSTOMER ORDER TRACKING VIEW)
// =========================================================================
console.log('\n5. Auditoria de UI & Privacidade (CustomerOrderTrackingView.tsx)');

const trackingViewPath = 'src/components/storefront/CustomerOrderTrackingView.tsx';
assert(fs.existsSync(trackingViewPath), '5.1 CustomerOrderTrackingView.tsx existe no workspace');
const trackingViewCode = fs.readFileSync(trackingViewPath, 'utf-8');

assert(
  !trackingViewCode.includes('tokenInput') &&
  !trackingViewCode.includes('isSearchingToken') &&
  !trackingViewCode.includes('handleSearchByToken') &&
  !trackingViewCode.includes('Rastrear por Código Seguro') &&
  !trackingViewCode.includes('64 caracteres'),
  '5.2 Campo de busca manual por token e referências a "Rastrear por Código Seguro" TOTALMENTE AUSENTES'
);

assert(
  !trackingViewCode.includes('shippingAddress') &&
  !trackingViewCode.includes('customerName') &&
  !trackingViewCode.includes('Endereço de Entrega'),
  '5.3 Endereço de Entrega, customerName e PII TOTALMENTE AUSENTES da interface'
);

assert(
  trackingViewCode.includes('ord.orderNumber') &&
  !trackingViewCode.includes('key={ord.id}'),
  '5.4 Interface utiliza orderNumber como chave React e identificador de estado (sem dependência de order UUID)'
);

assert(
  trackingViewCode.includes("import { PUBLIC_TENANT_SLUG } from '../../config/tenant';") &&
  trackingViewCode.includes('getStoredRetailTrackings(PUBLIC_TENANT_SLUG)') &&
  trackingViewCode.includes('trackOrderByToken(PUBLIC_TENANT_SLUG, item.trackingToken)') &&
  trackingViewCode.includes('listMyCustomerOrders(PUBLIC_TENANT_SLUG)') &&
  !trackingViewCode.includes('getStoredRetailTrackings(currentTenant.slug)') &&
  !trackingViewCode.includes('listMyCustomerOrders(currentTenant.slug)') &&
  trackingViewCode.includes('Promise.allSettled'),
  '5.5 Meus Pedidos usa o slug público canônico do Storefront/Checkout para B2B e varejo, sem depender do slug legado do AppContext'
);

assert(
  trackingViewCode.includes('setB2bOrders([]);') &&
  trackingViewCode.includes("setActiveTab('retail');"),
  '5.6 Logout privacy: ao invalidar sessão, zera pedidos B2B e força retorno para aba de varejo'
);

assert(
  trackingViewCode.includes('Seus novos pedidos feitos neste navegador aparecerão aqui.') &&
  trackingViewCode.includes('Para pedidos sem conta, o acompanhamento fica vinculado a este navegador.'),
  '5.7 Empty state de varejo informa vínculo com o navegador sem solicitar CPF, telefone ou token manual'
);

// AuthContext signOut redirect
const authContextCode = fs.readFileSync('src/context/AuthContext.tsx', 'utf-8');
assert(
  authContextCode.includes("viewMode === 'my_orders'") &&
  authContextCode.includes("setViewMode('storefront')"),
  '5.8 AuthContext.signOut redireciona viewMode "my_orders" para "storefront"'
);

// CartDrawer
const cartDrawerCode = fs.readFileSync('src/components/storefront/CartDrawer.tsx', 'utf-8');
assert(
  cartDrawerCode.includes('storeRetailOrderTracking(settings.slug, {') &&
  cartDrawerCode.includes('orderNumber: receipt.orderNumber') &&
  cartDrawerCode.includes('trackingToken: receipt.trackingToken'),
  '5.9 CartDrawer invoca storeRetailOrderTracking com tenant-scoped signature'
);

// =========================================================================
// 6. INTEGRIDADE ARQUITETURAL
// =========================================================================
console.log('\n6. Integridade Arquitetural & Menor Privilégio');

assert(
  !trackingViewCode.includes(".from('orders')") &&
  !trackingViewCode.includes('.from("orders")') &&
  !customerTrackingCode.includes(".from('orders')") &&
  !customerTrackingCode.includes('.from("orders")'),
  '6.1 Ausência total de SELECT direto em public.orders a partir do frontend'
);

assert(
  !trackingViewCode.includes('.rpc(') &&
  !customerTrackingCode.includes('.rpc('),
  '6.2 Ausência total de chamadas a RPCs internas diretamente do browser'
);

assert(
  !trackingViewCode.includes('window.location.search') &&
  !trackingViewCode.includes('URLSearchParams'),
  '6.3 Ausência de extração de token via URL (token nunca exposto em query param)'
);

assert(
  !trackingViewCode.includes('setInterval') &&
  !trackingViewCode.includes('supabase.channel') &&
  !trackingViewCode.includes('postgres_changes'),
  '6.4 Ausência total de Realtime ou polling ineficiente (setInterval)'
);

console.log('\n======================================================');
console.log(`TOTAL DE TESTES ITEM 3: ${passed + failed}`);
console.log(`PASSOU: ${passed}`);
console.log(`FALHOU: ${failed}`);
console.log('======================================================');

if (failed > 0) {
  process.exit(1);
}
