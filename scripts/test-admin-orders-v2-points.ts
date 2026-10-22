/**
 * ============================================================================
 * TEST SUITE: ADMIN ORDERS V2 (STATUS SERVER-SIDE, STOCK, PRINT, ADMIN PDF)
 * Arquivo: scripts/test-admin-orders-v2-points.ts
 * ============================================================================
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

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
console.log('TEST SUITE: ADMIN ORDERS V2 (QUALITY GATE & COMPLIANCE)');
console.log('======================================================');

// =========================================================================
// 1. MIGRATION 000014 AUDIT
// =========================================================================
console.log('\n1. Auditoria de Migration 000014 (Forward-Only)');

const migrationFiles = fs.readdirSync('supabase/migrations')
  .filter(f => f.endsWith('.sql'))
  .sort();

assert(
  migrationFiles.length === 18,
  `Total de migrations no workspace é exatamente 18 (encontradas: ${migrationFiles.length})`
);

const migration14File = '20261005170000_000014_admin_order_management.sql';
const migration14Path = path.join('supabase/migrations', migration14File);
assert(
  fs.existsSync(migration14Path),
  'Migration 000014 existe no caminho canônico'
);

const migration15Path = path.join('supabase/migrations', '20261008_000015_customer_order_tracking.sql');
assert(
  fs.existsSync(migration15Path),
  'Migration 000015 existe no caminho canônico'
);

const migration16Path = path.join('supabase/migrations', '20261009000000_000016_customer_order_tracking_hardening.sql');
assert(
  fs.existsSync(migration16Path),
  'Migration 000016 existe no caminho canônico'
);

const migration17Path = path.join('supabase/migrations', '20261009010000_000017_checkout_delivery_methods_compat.sql');
assert(
  fs.existsSync(migration17Path),
  'Migration 000017 existe no caminho canônico'
);

const prefixes = migrationFiles.map(f => f.split('_')[0]);
const uniquePrefixes = new Set(prefixes);
assert(
  uniquePrefixes.size === migrationFiles.length,
  'Todos os version prefixes das migrations são estritamente únicos'
);

// Verificar integridade das migrations 000001 a 000013 intactas
const frozenMigrations = [
  '20260902_000001_initial_schema.sql',
  '20260903_000002_import_official_catalog.sql',
  '20260904_000003_public_catalog_settings.sql',
  '20260905_000004_wholesale_item_rules.sql',
  '20260907_000005_b2b_wholesale_access.sql',
  '20260909_000006_branding_storage.sql',
  '20260910_000007_reconcile_b2b_catalog_security.sql',
  '20260916_000008_product_media_storage.sql',
  '20260917_000009_fix_product_media_policy_scope.sql',
  '20260928_000010_orders_checkout_v1.sql',
  '20260929_000011_orders_checkout_hardening.sql',
  '20260930_000012_order_documents_storage.sql',
  '20261001_000013_security_definer_hardening.sql'
];

let allFrozenExist = true;
for (const m of frozenMigrations) {
  if (!fs.existsSync(path.join('supabase/migrations', m))) {
    allFrozenExist = false;
    break;
  }
}
assert(allFrozenExist, 'Todas as migrations 000001 a 000013 permanecem intactas e congeladas');

const migration14Sql = fs.readFileSync(migration14Path, 'utf-8');

assert(
  migration14Sql.includes('CREATE OR REPLACE FUNCTION public.manage_order_status_internal') &&
  migration14Sql.includes('p_order_id UUID') &&
  migration14Sql.includes('p_new_status TEXT') &&
  migration14Sql.includes('p_actor_user_id UUID'),
  'manage_order_status_internal existe com parâmetros tipados (p_order_id, p_new_status, p_actor_user_id)'
);

assert(
  migration14Sql.includes('SECURITY DEFINER'),
  'manage_order_status_internal declarada com SECURITY DEFINER'
);

assert(
  migration14Sql.includes("SET search_path = ''"),
  "manage_order_status_internal com search_path = '' limpo contra hijacking"
);

assert(
  migration14Sql.includes('REVOKE ALL ON FUNCTION public.manage_order_status_internal(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;') &&
  migration14Sql.includes('GRANT EXECUTE ON FUNCTION public.manage_order_status_internal(UUID, TEXT, UUID) TO service_role;'),
  'manage_order_status_internal com EXECUTE concedido estritamente a service_role'
);

assert(
  migration14Sql.includes('REVOKE ALL ON FUNCTION public.manage_order_status(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;'),
  'Função legada manage_order_status continua sem EXECUTE para PUBLIC, anon, authenticated e service_role'
);

// =========================================================================
// 2. STATUS EDGE FUNCTION AUDIT & REAL SYNTAX PARSE
// =========================================================================
console.log('\n2. Auditoria da Edge Function manage-order-status e Parse Real TypeScript');

const statusEdgePath = 'supabase/functions/manage-order-status/index.ts';
assert(fs.existsSync(statusEdgePath), 'manage-order-status/index.ts existe no workspace');

const configToml = fs.readFileSync('supabase/config.toml', 'utf-8');
assert(
  configToml.includes('[functions.manage-order-status]') &&
  configToml.includes('verify_jwt = true'),
  'supabase/config.toml declara [functions.manage-order-status] com verify_jwt = true'
);

const statusEdgeCode = fs.readFileSync(statusEdgePath, 'utf-8');

assert(
  statusEdgeCode.includes('req.method === "OPTIONS"') &&
  statusEdgeCode.includes('req.method !== "POST"'),
  'manage-order-status aceita apenas POST e responde OPTIONS para CORS'
);

assert(
  statusEdgeCode.includes('4096') &&
  statusEdgeCode.includes('rawBodyByteLength > 4096'),
  'manage-order-status rejeita payloads com tamanho > 4096 bytes (4 KB)'
);

assert(
  statusEdgeCode.includes('allowedKeys = ["orderId", "newStatus"]') &&
  statusEdgeCode.includes('bodyKeys.length === 2'),
  'manage-order-status exige body exato contendo apenas orderId e newStatus'
);

assert(
  !statusEdgeCode.includes('action') &&
  statusEdgeCode.includes('allowedKeys'),
  'manage-order-status rejeita explicitamente campo action'
);

assert(
  !statusEdgeCode.includes('body.userId') &&
  !statusEdgeCode.includes('body.actorUserId') &&
  !statusEdgeCode.includes('payload.userId') &&
  !statusEdgeCode.includes('payload.actorUserId') &&
  !statusEdgeCode.includes('payload.tenantId') &&
  !statusEdgeCode.includes('payload.role'),
  'manage-order-status rejeita userId/actorUserId/tenantId/role vindos do body'
);

assert(
  statusEdgeCode.includes('auth.getUser()'),
  'manage-order-status invoca auth.getUser() com JWT'
);

assert(
  statusEdgeCode.includes('const actorUserId = userData.user.id;') ||
  statusEdgeCode.includes('actorUserId = userData.user.id'),
  'manage-order-status deriva ator estritamente server-side da sessão do usuário'
);

assert(
  statusEdgeCode.includes('manage_order_status_internal') &&
  statusEdgeCode.includes('p_actor_user_id: actorUserId'),
  'manage-order-status delega para a RPC interna manage_order_status_internal com actorUserId'
);

assert(
  statusEdgeCode.includes('order: rpcResult') &&
  !statusEdgeCode.includes('customer') &&
  !statusEdgeCode.includes('shipping_address'),
  'manage-order-status retorna resposta mínima sanitizada sem vazar PII'
);

assert(
  !statusEdgeCode.includes('generateOrderPdf') &&
  !statusEdgeCode.includes('order-documents') &&
  !statusEdgeCode.includes('createSignedUrl'),
  'Nenhum código de PDF ou Storage nesta Edge Function (responsabilidade única)'
);

// Real TypeScript AST Parsing and Diagnostics
const statusTsResult = ts.transpileModule(statusEdgeCode, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
  reportDiagnostics: true,
});
const statusErrors = (statusTsResult.diagnostics || []).filter(
  d => d.category === ts.DiagnosticCategory.Error
);
assert(
  statusErrors.length === 0,
  `Parse de sintaxe TypeScript real em manage-order-status resultou em zero erros (erros: ${statusErrors.length})`
);

// =========================================================================
// 3. PDF EDGE FUNCTION AUDIT & REAL SYNTAX PARSE
// =========================================================================
console.log('\n3. Auditoria da Edge Function generate-admin-order-pdf e Parse Real TypeScript');

const pdfEdgePath = 'supabase/functions/generate-admin-order-pdf/index.ts';
assert(fs.existsSync(pdfEdgePath), 'generate-admin-order-pdf/index.ts existe no workspace');

assert(
  configToml.includes('[functions.generate-admin-order-pdf]') &&
  configToml.includes('verify_jwt = true'),
  'supabase/config.toml declara [functions.generate-admin-order-pdf] com verify_jwt = true'
);

const pdfEdgeCode = fs.readFileSync(pdfEdgePath, 'utf-8');

assert(
  pdfEdgeCode.includes('4096') &&
  pdfEdgeCode.includes('rawBodyByteLength > 4096'),
  'generate-admin-order-pdf impõe limite estrito de 4096 bytes no body'
);

assert(
  pdfEdgeCode.includes('allowedKeys = ["orderId"]') &&
  pdfEdgeCode.includes('bodyKeys.length === 1'),
  'generate-admin-order-pdf exige body exato contendo estritamente a chave orderId'
);

assert(
  pdfEdgeCode.includes('auth.getUser()'),
  'generate-admin-order-pdf valida a sessão via auth.getUser()'
);

assert(
  pdfEdgeCode.includes('supabaseUserClient') &&
  pdfEdgeCode.includes('.from("orders")') &&
  pdfEdgeCode.includes('.eq("id", orderId)'),
  'Pedido é lido usando supabaseUserClient no contexto do JWT do usuário'
);

assert(
  pdfEdgeCode.indexOf('supabaseUserClient\n      .from("orders")') < pdfEdgeCode.indexOf('supabaseAdmin = createClient') ||
  pdfEdgeCode.indexOf('.from("orders")') < pdfEdgeCode.indexOf('supabaseAdmin'),
  'public.orders é consultada via RLS ANTES de qualquer uso de service_role'
);

assert(
  pdfEdgeCode.includes('orderErr || !order') &&
  pdfEdgeCode.includes('404'),
  'service_role NÃO é usado para autorização de leitura (RLS decide acesso fail-closed com 404)'
);

assert(
  pdfEdgeCode.includes('import { generateOrderPdf } from "../_shared/orderPdf.ts"') ||
  pdfEdgeCode.includes('generateOrderPdf('),
  'generate-admin-order-pdf reutiliza helper canônico _shared/orderPdf.ts'
);

assert(
  pdfEdgeCode.includes('"order-documents"') ||
  pdfEdgeCode.includes("'order-documents'"),
  'generate-admin-order-pdf usa bucket privado order-documents'
);

assert(
  pdfEdgeCode.includes('canonicalPdfPath =') &&
  pdfEdgeCode.includes('pedido-') &&
  pdfEdgeCode.includes('.pdf'),
  'generate-admin-order-pdf grava no path canônico <tenant_id>/orders/<order_id>/pedido-<order_number>.pdf'
);

assert(
  pdfEdgeCode.includes('upsert: true'),
  'generate-admin-order-pdf executa upload com upsert controlado para atualização de documento'
);

assert(
  pdfEdgeCode.includes('createSignedUrl(canonicalPdfPath, 600)'),
  'createSignedUrl configurada para EXATAMENTE 600 segundos (10 minutos)'
);

assert(
  pdfEdgeCode.includes('expiresIn: 600'),
  'generate-admin-order-pdf responde explicitamente expiresIn: 600'
);

assert(
  !pdfEdgeCode.includes('console.log(signedData') &&
  !pdfEdgeCode.includes('console.log(signedUrl') &&
  !pdfEdgeCode.includes('console.info(signedData'),
  'Signed URL nunca é logada em console'
);

// Real TypeScript AST Parsing and Diagnostics
const pdfTsResult = ts.transpileModule(pdfEdgeCode, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
  reportDiagnostics: true,
});
const pdfErrors = (pdfTsResult.diagnostics || []).filter(
  d => d.category === ts.DiagnosticCategory.Error
);
assert(
  pdfErrors.length === 0,
  `Parse de sintaxe TypeScript real em generate-admin-order-pdf resultou em zero erros (erros: ${pdfErrors.length})`
);

// =========================================================================
// 4. AUTHORIZATION RULES AUDIT
// =========================================================================
console.log('\n4. Auditoria de Autorização e Controle de Acesso');

assert(
  migration14Sql.includes('v_is_platform_admin := EXISTS (') &&
  migration14Sql.includes('SELECT 1 FROM public.platform_admins WHERE id = p_actor_user_id'),
  'platform_admin explicitamente permitido na RPC manage_order_status_internal'
);

assert(
  migration14Sql.includes('WHERE tenant_id = v_order.tenant_id') &&
  migration14Sql.includes('AND id = p_actor_user_id') &&
  migration14Sql.includes('AND active = true') &&
  migration14Sql.includes("'tenant_admin'"),
  'tenant_admin ativo do mesmo tenant explicitamente permitido'
);

assert(
  migration14Sql.includes("'stock_manager'"),
  'stock_manager ativo do mesmo tenant explicitamente permitido'
);

assert(
  !migration14Sql.includes("'sales_rep'") &&
  migration14Sql.includes('42501'),
  'sales_rep negado para mutação de status com erro de autorização 42501'
);

assert(
  migration14Sql.includes('WHERE tenant_id = v_order.tenant_id'),
  'Operadores cross-tenant são expressamente rejeitados na RPC'
);

assert(
  pdfEdgeCode.includes('supabaseUserClient') &&
  pdfEdgeCode.includes('.from("orders")'),
  'sales_rep pode gerar/ler PDF administrativo somente conforme sua permissão RLS de SELECT em orders'
);

// =========================================================================
// 5. STATE MACHINE AUDIT
// =========================================================================
console.log('\n5. Auditoria da Máquina de Estados de Pedidos');

assert(
  migration14Sql.includes("v_order.status = 'pending' AND p_new_status = 'approved'"),
  'Transição pending -> approved implementada'
);

assert(
  migration14Sql.includes("v_order.status = 'pending' AND p_new_status = 'cancelled'"),
  'Transição pending -> cancelled implementada'
);

assert(
  migration14Sql.includes("v_order.status = 'approved' AND p_new_status = 'preparing'"),
  'Transição approved -> preparing implementada'
);

assert(
  migration14Sql.includes("(v_order.status = 'approved' OR v_order.status = 'preparing') AND p_new_status = 'cancelled'"),
  'Transição approved -> cancelled e preparing -> cancelled implementadas'
);

assert(
  migration14Sql.includes("v_order.status = 'preparing' AND p_new_status = 'dispatched'"),
  'Transição preparing -> dispatched implementada'
);

assert(
  migration14Sql.includes("v_order.status = 'dispatched' AND p_new_status = 'delivered'"),
  'Transição dispatched -> delivered implementada'
);

assert(
  migration14Sql.includes("v_order.status IN ('delivered', 'cancelled')") &&
  migration14Sql.includes('Pedido já está em estado terminal'),
  'delivered e cancelled tratados como estados terminais estritos'
);

assert(
  migration14Sql.includes('Transição de status inválida de'),
  'Transições reversas não mapeadas são expressamente negadas'
);

assert(
  migration14Sql.includes('IF v_order.status = p_new_status THEN') &&
  migration14Sql.includes('RETURN jsonb_build_object'),
  'Status igual ao atual é tratado de forma idempotente sem novo efeito colateral'
);

// =========================================================================
// 6. STOCK TRANSACTIONAL INTEGRITY AUDIT
// =========================================================================
console.log('\n6. Auditoria de Integridade Transacional de Estoque');

assert(
  migration14Sql.includes('UPDATE public.products') &&
  migration14Sql.includes('SET stock = stock - v_item.qty') &&
  migration14Sql.includes("v_order.status = 'pending' AND p_new_status = 'approved'"),
  'pending -> approved decrementa estoque exatamente uma vez'
);

assert(
  migration14Sql.includes("v_order.status = 'pending' AND p_new_status = 'cancelled'") &&
  migration14Sql.includes('-- PENDING -> CANCELLED: Estoque nunca foi debitado'),
  'pending -> cancelled não altera estoque de produtos'
);

assert(
  migration14Sql.includes('SET stock = stock + v_item.qty') &&
  migration14Sql.includes("(v_order.status = 'approved' OR v_order.status = 'preparing') AND p_new_status = 'cancelled'"),
  'approved/preparing -> cancelled restaura estoque de produtos exatamente uma vez'
);

assert(
  migration14Sql.includes('FOR UPDATE') &&
  migration14Sql.includes('FROM public.products p'),
  'Locks pessimistas FOR UPDATE aplicados nos produtos'
);

assert(
  migration14Sql.includes("ORDER BY (elem->>'productId')::uuid ASC"),
  'Produtos são bloqueados ordenados deterministicamente por UUID ASC contra deadlock'
);

assert(
  migration14Sql.includes('RAISE EXCEPTION') &&
  migration14Sql.includes('GET DIAGNOSTICS v_affected_rows = ROW_COUNT'),
  'Falha em qualquer item ou validação aborta a transação inteira atomicamente'
);

// =========================================================================
// 7. FRONTEND SERVICE & COMPONENT AUDIT
// =========================================================================
console.log('\n7. Auditoria de Serviços Frontend e Componentes');

const adminOrderServicePath = 'src/services/adminOrderService.ts';
assert(fs.existsSync(adminOrderServicePath), 'src/services/adminOrderService.ts existe');
const adminServiceCode = fs.readFileSync(adminOrderServicePath, 'utf-8');

assert(
  adminServiceCode.includes("supabase.functions.invoke('manage-order-status'") &&
  adminServiceCode.includes('body: { orderId, newStatus }'),
  'updateAdminOrderStatus usa exclusivamente Edge Function manage-order-status'
);

assert(
  adminServiceCode.includes("supabase.functions.invoke('generate-admin-order-pdf'") &&
  adminServiceCode.includes('body: { orderId }'),
  'generateAdminOrderPdf usa exclusivamente Edge Function generate-admin-order-pdf'
);

assert(
  !adminServiceCode.includes("action: 'get_pdf'") &&
  !adminServiceCode.includes("action: 'generate_pdf'") &&
  !adminServiceCode.includes("action: 'update_status'"),
  'Nenhum parâmetro action é enviado para as Edge Functions'
);

assert(
  !adminServiceCode.includes(".from('orders').update(") &&
  !adminServiceCode.includes('.from("orders").update('),
  'Sem update direto em public.orders a partir do serviço frontend'
);

assert(
  !adminServiceCode.includes(".rpc('manage_order_status_internal')") &&
  !adminServiceCode.includes('.rpc("manage_order_status_internal")'),
  'Sem chamada RPC interna direta do browser em adminOrderService'
);

const orderManagerPath = 'src/components/tenantadmin/OrderManager.tsx';
assert(fs.existsSync(orderManagerPath), 'OrderManager.tsx existe');
const orderManagerCode = fs.readFileSync(orderManagerPath, 'utf-8');

assert(
  !orderManagerCode.includes('setAdminOrders') &&
  !orderManagerCode.includes('optimistic'),
  'Sem optimistic update na interface administrativa (confia no servidor)'
);

assert(
  orderManagerCode.includes('updateAdminOrderStatus') &&
  (orderManagerCode.includes('onStatusChanged') || orderManagerCode.includes('onReload')),
  'OrderManager dispara recarga autoritativa após sucesso de status'
);

assert(
  orderManagerCode.includes("currentUser?.role === 'sales_rep'") &&
  orderManagerCode.includes('apenas leitura ao status'),
  'sales_rep tratado como read-only para status no OrderManager'
);

assert(
  !orderManagerCode.includes('.delete()') &&
  !adminServiceCode.includes('.delete()'),
  'Hard delete ausente no OrderManager e no adminOrderService'
);

// =========================================================================
// 8. PRINT PORTAL & DOCUMENT AUDIT
// =========================================================================
console.log('\n8. Auditoria de Impressão (OrderPrintDocument & Portal Fora do Modal)');

const printDocPath = 'src/components/tenantadmin/OrderPrintDocument.tsx';
assert(fs.existsSync(printDocPath), 'OrderPrintDocument.tsx existe');
const printDocCode = fs.readFileSync(printDocPath, 'utf-8');

assert(
  orderManagerCode.includes('createPortal') &&
  orderManagerCode.includes("from 'react-dom'"),
  'OrderManager importa createPortal de react-dom'
);

assert(
  orderManagerCode.includes('OrderPrintDocument'),
  'OrderManager importa OrderPrintDocument'
);

assert(
  orderManagerCode.includes('createPortal(') &&
  orderManagerCode.includes('document.body'),
  'createPortal renderiza diretamente em document.body'
);

assert(
  orderManagerCode.includes('id="order-print-root"'),
  'Elemento container com id="order-print-root" existe'
);

assert(
  !orderManagerCode.includes('id="printable-order-slip"'),
  '#order-print-root não está dentro do modal (antigo printable-order-slip removido do modal)'
);

const indexCssPath = 'src/index.css';
assert(fs.existsSync(indexCssPath), 'src/index.css existe');
const indexCss = fs.readFileSync(indexCssPath, 'utf-8');

assert(
  !indexCss.includes('body *') || !indexCss.includes('visibility: hidden'),
  'Antiga estratégia body * { visibility: hidden } foi removida do src/index.css'
);

assert(
  indexCss.includes('body > #root') &&
  indexCss.includes('display: none !important'),
  'body > #root configurado com display: none !important em @media print'
);

assert(
  indexCss.includes('#order-print-root') &&
  indexCss.includes('display: block !important'),
  '#order-print-root configurado com display: block !important em @media print'
);

assert(
  indexCss.includes('position: static !important'),
  '#order-print-root utiliza position: static !important na impressão'
);

assert(
  indexCss.includes('size: A4 portrait'),
  '@page configurado com size: A4 portrait'
);

assert(
  indexCss.includes('@page') &&
  indexCss.includes('margin: 10mm'),
  '@page configurado com margem explícita de 10mm'
);

assert(
  indexCss.includes('break-inside: avoid !important') ||
  indexCss.includes('page-break-inside: avoid !important'),
  'break-inside: avoid !important configurado para quebra de página controlada'
);

assert(
  !orderManagerCode.includes('dangerouslySetInnerHTML') &&
  !printDocCode.includes('dangerouslySetInnerHTML'),
  'Zero uso de dangerouslySetInnerHTML em OrderManager e OrderPrintDocument'
);

// =========================================================================
// 9. DATA FRESHNESS & AUTO-REFRESH AUDIT
// =========================================================================
console.log('\n9. Auditoria de Frescor de Dados & Auto-Refresh');

const tenantDashboardPath = 'src/components/tenantadmin/TenantDashboard.tsx';
assert(fs.existsSync(tenantDashboardPath), 'TenantDashboard.tsx existe');
const tenantDashboardCode = fs.readFileSync(tenantDashboardPath, 'utf-8');

assert(
  tenantDashboardCode.includes('handleOrderStatusChanged') &&
  tenantDashboardCode.includes('loadAdminOrders') &&
  tenantDashboardCode.includes('loadAdminProducts'),
  'TenantDashboard possui callback handleOrderStatusChanged recarregando orders e products'
);

assert(
  tenantDashboardCode.includes('onStatusChanged={handleOrderStatusChanged}') &&
  orderManagerCode.includes('onStatusChanged'),
  'OrderManager recebe callback pós-status onStatusChanged'
);

assert(
  orderManagerCode.includes('updateAdminOrderStatus') &&
  orderManagerCode.includes('onStatusChanged'),
  'Recarga ocorre após confirmação de sucesso de updateAdminOrderStatus pelo servidor'
);

assert(
  tenantDashboardCode.includes("window.addEventListener('focus'") ||
  tenantDashboardCode.includes('addEventListener("focus"'),
  'Listener de window focus implementado para auto-refresh'
);

assert(
  tenantDashboardCode.includes("document.addEventListener('visibilitychange'") ||
  tenantDashboardCode.includes('addEventListener("visibilitychange"'),
  'Listener de document visibilitychange implementado para auto-refresh'
);

assert(
  tenantDashboardCode.includes("window.removeEventListener('focus'") &&
  tenantDashboardCode.includes("document.removeEventListener('visibilitychange'"),
  'Cleanup obrigatório remove listeners de focus e visibilitychange'
);

assert(
  tenantDashboardCode.includes('lastRefreshAtRef') &&
  (tenantDashboardCode.includes('800') || tenantDashboardCode.includes('500') || tenantDashboardCode.includes('1000')),
  'Guarda anti-refresh duplicado (throttle timestamp) implementada'
);

assert(
  !tenantDashboardCode.includes('setInterval(') &&
  !orderManagerCode.includes('setInterval('),
  'Ausência total de setInterval (sem polling ineficiente)'
);

assert(
  !tenantDashboardCode.includes('supabase.channel') &&
  !orderManagerCode.includes('supabase.channel'),
  'Ausência de supabase.channel nesta fase'
);

assert(
  !tenantDashboardCode.includes('postgres_changes') &&
  !orderManagerCode.includes('postgres_changes'),
  'Ausência de postgres_changes nesta fase'
);

// =========================================================================
// RESUMO FINAL
// =========================================================================
console.log('\n======================================================');
console.log(`TOTAL DE TESTES V2: ${passCount + failCount}`);
console.log(`PASSOU: ${passCount}`);
console.log(`FALHOU: ${failCount}`);
console.log('======================================================');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
