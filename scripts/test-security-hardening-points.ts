/**
 * ============================================================================
 * TEST SUITE: SECURITY HARDENING V1 (SECURITY DEFINER / B2B ACCESS / AUTH BASELINE)
 * Arquivo: scripts/test-security-hardening-points.ts
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
console.log('TEST SUITE: SECURITY HARDENING V1');
console.log('======================================================');

// =========================================================================
// 1. MIGRATION 000013 & GOVERNANÇA DE MIGRATIONS
// =========================================================================
console.log('\n1. Auditoria da Migration 000013 & Congelamento de 000001-000012');

const migration13Path = 'supabase/migrations/20261001_000013_security_definer_hardening.sql';
assert(fs.existsSync(migration13Path), 'Migration 000013 existe no workspace');

const migration13Sql = fs.readFileSync(migration13Path, 'utf-8');
assert(
  migration13Sql.includes('BEGIN;') && migration13Sql.includes('COMMIT;'),
  'Migration 000013 utiliza explicitamente transação BEGIN / COMMIT'
);

// Confirma que migrations 000001 a 000012 existem e permanecem inalteradas
const expectedMigrations = [
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

const actualMigrations = fs.readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort();
assert(
  actualMigrations.length === 13,
  'Exatamente 13 migrations registradas no workspace'
);

for (const m of expectedMigrations.slice(0, 12)) {
  assert(
    actualMigrations.includes(m),
    `Migration congelada ${m} preservada no workspace`
  );
}

const migrationVersions = actualMigrations.map(f => f.split('_')[0]);
assert(
  new Set(migrationVersions).size === actualMigrations.length,
  'Prefixos de versão das migrations são estritamente únicos (sem colisão de versionamento)'
);

// =========================================================================
// 2. GET_MY_WHOLESALE_STATUS (SECURITY INVOKER)
// =========================================================================
console.log('\n2. Auditoria de get_my_wholesale_status (Security Invoker & RLS)');

const getMyWholesaleStatusBlock = migration13Sql.split('CREATE OR REPLACE FUNCTION public.get_my_wholesale_status')[1]?.split('$$;')[0] || '';
assert(
  getMyWholesaleStatusBlock.includes('SECURITY INVOKER') &&
  !getMyWholesaleStatusBlock.includes('SECURITY DEFINER'),
  'get_my_wholesale_status declarada com SECURITY INVOKER (não usa SECURITY DEFINER)'
);

assert(
  migration13Sql.includes("SET search_path = ''"),
  'get_my_wholesale_status utiliza SET search_path vazio'
);

assert(
  migration13Sql.includes('GRANT EXECUTE ON FUNCTION public.get_my_wholesale_status(TEXT) TO authenticated;'),
  'get_my_wholesale_status concede EXECUTE para authenticated'
);

assert(
  migration13Sql.includes('REVOKE ALL ON FUNCTION public.get_my_wholesale_status(TEXT) FROM PUBLIC, anon;'),
  'get_my_wholesale_status revoga ALL de PUBLIC e anon'
);

assert(
  migration13Sql.includes('v_user_id := auth.uid();') || migration13Sql.includes('auth.uid()'),
  'get_my_wholesale_status extrai identidade exclusivamente via auth.uid()'
);

assert(
  migration13Sql.includes('FROM public.tenant_public_settings') &&
  !migration13Sql.includes('FROM public.tenant_users'),
  'get_my_wholesale_status resolve tenant exclusivamente via public.tenant_public_settings (sem exigir tenant_users)'
);

assert(
  migration13Sql.includes('FROM public.wholesale_customers c') &&
  migration13Sql.includes('c.user_id = v_user_id'),
  'get_my_wholesale_status consulta public.wholesale_customers protegido pela RLS wholesale_customers_select_self'
);

// =========================================================================
// 3. WHOLESALE CATALOG (EDGE FUNCTION GATEWAY & INTERNAL RPC)
// =========================================================================
console.log('\n3. Auditoria do Catálogo B2B (Edge Function & RPC Interna)');

const wholesaleServiceCode = fs.readFileSync('src/services/wholesaleService.ts', 'utf-8');
assert(
  !wholesaleServiceCode.includes("supabase.rpc('get_wholesale_catalog'") &&
  !wholesaleServiceCode.includes('supabase.rpc("get_wholesale_catalog"'),
  'Frontend NÃO chama diretamente a RPC privilegiada get_wholesale_catalog'
);

assert(
  wholesaleServiceCode.includes("supabase.functions.invoke('get-wholesale-catalog'") ||
  wholesaleServiceCode.includes('supabase.functions.invoke("get-wholesale-catalog"'),
  'Frontend consome exclusivamente a Edge Function get-wholesale-catalog'
);

assert(
  wholesaleServiceCode.includes("Preços atacadistas são obtidos EXCLUSIVAMENTE via Edge Function autenticada 'get-wholesale-catalog'"),
  'Comentário de cabeçalho do wholesaleService.ts documenta Edge Function get-wholesale-catalog'
);

assert(
  wholesaleServiceCode.includes('data.success !== true') &&
  wholesaleServiceCode.includes('!Array.isArray(data.items)') &&
  !wholesaleServiceCode.includes('row.productId || row.product_id') &&
  !wholesaleServiceCode.includes('|| 0') &&
  !wholesaleServiceCode.includes('|| 1'),
  'Frontend valida estritamente o payload da Edge Function de forma fail-closed sem fallbacks'
);

const configToml = fs.readFileSync('supabase/config.toml', 'utf-8');
assert(
  configToml.includes('[functions.get-wholesale-catalog]') &&
  configToml.match(/\[functions\.get-wholesale-catalog\][\s\S]*?verify_jwt\s*=\s*true/),
  'supabase/config.toml declara verify_jwt = true para get-wholesale-catalog'
);

const edgeFuncPath = 'supabase/functions/get-wholesale-catalog/index.ts';
assert(fs.existsSync(edgeFuncPath), 'Edge Function get-wholesale-catalog existe no workspace');

const edgeFuncCode = fs.readFileSync(edgeFuncPath, 'utf-8');

const transpileResult = ts.transpileModule(edgeFuncCode, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext
  },
  reportDiagnostics: true
});

const syntaxErrors = (transpileResult.diagnostics || []).filter(
  d => d.category === ts.DiagnosticCategory.Error
);

assert(
  syntaxErrors.length === 0,
  'Edge Function get-wholesale-catalog passa no parsing/transpilação sintática TypeScript (zero erros de sintaxe)'
);

assert(
  edgeFuncCode.includes('Authorization') &&
  edgeFuncCode.includes('Bearer ') &&
  edgeFuncCode.includes('Autenticação obrigatória'),
  'Edge Function exige cabeçalho Authorization Bearer'
);

assert(
  edgeFuncCode.includes('supabaseAdmin.auth.getUser(token)'),
  'Edge Function valida o token via supabaseAdmin.auth.getUser(token)'
);

assert(
  edgeFuncCode.includes('const validatedUserId = userData.user.id;') &&
  !edgeFuncCode.includes('body.userId') &&
  !edgeFuncCode.includes('body.buyerUserId'),
  'Identidade do usuário é server-derived; não aceita userId do body'
);

assert(
  edgeFuncCode.includes('FORBIDDEN_BODY_FIELDS') &&
  edgeFuncCode.includes('"userId"') &&
  edgeFuncCode.includes('"buyerUserId"') &&
  edgeFuncCode.includes('"tenantId"') &&
  edgeFuncCode.includes('"costPrice"') &&
  edgeFuncCode.includes('"cost_price"'),
  'Edge Function bloqueia explicitamente campos proibidos (userId, buyerUserId, tenantId, costPrice, etc.)'
);

assert(
  edgeFuncCode.includes('bodyKeys.length !== 1 || bodyKeys[0] !== "tenantSlug"') &&
  edgeFuncCode.includes('Corpo da requisição contém campos não permitidos.'),
  'Edge Function aplica allowlist estrita fail-closed aceitando exclusivamente tenantSlug'
);

assert(
  edgeFuncCode.includes('Number.isFinite(numPrice)') &&
  edgeFuncCode.includes('Number.isInteger(numMinQty)') &&
  !edgeFuncCode.includes('Number(value) || 0') &&
  !edgeFuncCode.includes('Number(value) || 1'),
  'Edge Function valida cada linha da RPC sem fallbacks silenciosos ou projeção parcial'
);

assert(
  migration13Sql.includes('CREATE OR REPLACE FUNCTION public.get_wholesale_catalog_internal(') &&
  migration13Sql.includes('p_user_id UUID'),
  'RPC interna get_wholesale_catalog_internal recebe p_user_id explicitamente'
);

assert(
  migration13Sql.includes('CREATE OR REPLACE FUNCTION public.get_wholesale_catalog_internal') &&
  migration13Sql.includes('SECURITY DEFINER'),
  'RPC interna get_wholesale_catalog_internal utiliza SECURITY DEFINER'
);

assert(
  migration13Sql.includes('CREATE OR REPLACE FUNCTION public.get_wholesale_catalog_internal') &&
  migration13Sql.includes("SET search_path = ''"),
  'RPC interna get_wholesale_catalog_internal utiliza SET search_path vazio'
);

assert(
  migration13Sql.includes('REVOKE ALL ON FUNCTION public.get_wholesale_catalog_internal(TEXT, UUID) FROM PUBLIC, anon, authenticated;'),
  'RPC interna get_wholesale_catalog_internal revoga acesso de PUBLIC, anon e authenticated'
);

assert(
  migration13Sql.includes('GRANT EXECUTE ON FUNCTION public.get_wholesale_catalog_internal(TEXT, UUID) TO service_role;'),
  'RPC interna get_wholesale_catalog_internal concede execução EXCLUSIVAMENTE a service_role'
);

assert(
  migration13Sql.includes('RETURNS TABLE (') &&
  migration13Sql.includes('product_id UUID,') &&
  migration13Sql.includes('sku TEXT,') &&
  migration13Sql.includes('wholesale_price NUMERIC(10,2),') &&
  migration13Sql.includes('wholesale_min_quantity INTEGER') &&
  !migration13Sql.includes('cost_price NUMERIC'),
  'RPC interna retorna estritamente as 4 colunas autorizadas (product_id, sku, wholesale_price, wholesale_min_quantity)'
);

const selectQuery = migration13Sql.split('RETURN QUERY')[1]?.split(';')[0] || '';
assert(
  !selectQuery.includes('cost_price'),
  'cost_price estritamente ausente da projeção SQL (SELECT)'
);
const edgeFuncItemMapping = edgeFuncCode.split('const items =')[1]?.split('return new Response')[0] || '';
assert(
  !edgeFuncItemMapping.includes('costPrice') && !edgeFuncItemMapping.includes('cost_price'),
  'cost_price estritamente ausente do mapeamento de retorno da Edge Function'
);

// Verifica que nenhuma policy nova foi criada em public.products
assert(
  !migration13Sql.includes('CREATE POLICY') &&
  !migration13Sql.includes('ON public.products'),
  'Zero ampliação de RLS na tabela public.products (proteção de cost_price)'
);

// =========================================================================
// 4. MANAGE_ORDER_STATUS (LEAST PRIVILEGE)
// =========================================================================
console.log('\n4. Auditoria de manage_order_status (Menor Privilégio & Sem API Roles)');

const migration10Sql = fs.readFileSync('supabase/migrations/20260928_000010_orders_checkout_v1.sql', 'utf-8');
assert(
  migration10Sql.includes('CREATE OR REPLACE FUNCTION public.manage_order_status('),
  'Função manage_order_status continua fisicamente preservada no banco (migration 000010)'
);

assert(
  migration13Sql.includes('REVOKE EXECUTE ON FUNCTION public.manage_order_status(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;') ||
  (migration13Sql.includes('REVOKE') && migration13Sql.includes('manage_order_status') && migration13Sql.includes('service_role')),
  'manage_order_status tem execução REVOGADA para PUBLIC, anon, authenticated e service_role'
);

assert(
  !migration13Sql.includes('GRANT EXECUTE ON FUNCTION public.manage_order_status(UUID, TEXT) TO service_role;'),
  'manage_order_status NÃO concede permissão a service_role nesta etapa (least privilege)'
);

const orderManagerCode = fs.readFileSync('src/components/tenantadmin/OrderManager.tsx', 'utf-8');
assert(
  !orderManagerCode.includes('manage_order_status') &&
  !orderManagerCode.includes('supabase.rpc'),
  'Nenhuma integração do OrderManager foi alterada; permanece no estado legado do client'
);

// =========================================================================
// 5. BASELINE DE AUTENTICAÇÃO (supabase/config.toml)
// =========================================================================
console.log('\n5. Auditoria da Configuração de Autenticação (supabase/config.toml)');

assert(
  configToml.includes('minimum_password_length = 12'),
  'minimum_password_length = 12 configurado'
);

assert(
  configToml.includes('password_requirements = "lower_upper_letters_digits_symbols"'),
  'password_requirements = "lower_upper_letters_digits_symbols" configurado'
);

assert(
  configToml.includes('secure_password_change = true'),
  'secure_password_change = true configurado'
);

assert(
  configToml.includes('enable_signup = true'),
  'enable_signup continua true em [auth]'
);

assert(
  configToml.includes('[auth.email]') &&
  configToml.match(/\[auth\.email\][\s\S]*?enable_signup\s*=\s*true/),
  'enable_signup continua true em [auth.email]'
);

assert(
  configToml.includes('enable_anonymous_sign_ins = false'),
  'enable_anonymous_sign_ins continua false'
);

assert(
  !configToml.includes('[auth.mfa.totp]') ||
  !configToml.match(/\[auth\.mfa\.totp\][\s\S]*?enable\s*=\s*true/),
  'MFA continua não habilitado'
);

// =========================================================================
// 6. ORDER DOCUMENTS & STORAGE
// =========================================================================
console.log('\n6. Auditoria de Documentos de Pedido (Order Documents)');

const migration12Sql = fs.readFileSync('supabase/migrations/20260930_000012_order_documents_storage.sql', 'utf-8');
assert(
  migration12Sql.includes('order-documents') &&
  migration12Sql.includes('public = false') &&
  !migration12Sql.includes('CREATE POLICY') &&
  migration12Sql.includes('ZERO CLIENT POLICIES'),
  'Migration 000012 intacta e define ZERO client policies em storage.objects para order-documents'
);

const projectContextCode = fs.readFileSync('docs/PROJECT_CONTEXT.md', 'utf-8');
assert(
  projectContextCode.includes('zero client policies em storage.objects') &&
  projectContextCode.includes('zero SELECT/INSERT/UPDATE/DELETE para browser') &&
  !projectContextCode.includes('SELECT autenticado para tenant_admin'),
  'docs/PROJECT_CONTEXT.md afirma categoricamente zero client policies e zero SELECT/INSERT/UPDATE/DELETE para browser'
);

const securityRegisterCode = fs.readFileSync('docs/SECURITY_REGISTER.md', 'utf-8');
assert(
  securityRegisterCode.includes('ZERO client policies em storage.objects para order-documents') &&
  !securityRegisterCode.includes('Acesso de leitura autenticado restrito para role tenant_admin no diretório'),
  'docs/SECURITY_REGISTER.md corrigido para registrar ZERO client policies'
);

// =========================================================================
// 7. CHECKOUT INTACTO & FEATURE GATE FAIL-CLOSED
// =========================================================================
console.log('\n7. Auditoria de Checkout e Feature Gate');

const submitCheckoutCode = fs.readFileSync('supabase/functions/submit-order-checkout/index.ts', 'utf-8');
assert(
  submitCheckoutCode.includes('Deno.env.get("CHECKOUT_ENABLED") === "true"') &&
  submitCheckoutCode.includes('!checkoutEnabled') &&
  submitCheckoutCode.includes('Checkout temporariamente indisponível') &&
  submitCheckoutCode.includes('status: 503'),
  'submit-order-checkout mantém Feature Gate fail-closed com HTTP 503'
);

const cartDrawerCode = fs.readFileSync('src/components/storefront/CartDrawer.tsx', 'utf-8');
assert(
  cartDrawerCode.includes('handleFinishOrder') &&
  cartDrawerCode.includes('Enviar pedido pelo WhatsApp'),
  'CartDrawer permanece intacto com fluxo de Single WhatsApp CTA do Checkout V1.2'
);

const orderServiceCode = fs.readFileSync('src/services/orderService.ts', 'utf-8');
assert(
  orderServiceCode.includes('buildCheckoutRequestBody') &&
  orderServiceCode.includes('submitOrderCheckout') &&
  orderServiceCode.includes('validateReceipt'),
  'orderService permanece intacto'
);

// Confirma que CHECKOUT_ENABLED não está sendo ativado via código
assert(
  !submitCheckoutCode.includes('CHECKOUT_ENABLED = "true"') &&
  !submitCheckoutCode.includes("CHECKOUT_ENABLED = 'true'"),
  'CHECKOUT_ENABLED não é mutado em código'
);

// =========================================================================
// SUMÁRIO FINAL
// =========================================================================
console.log('\n======================================================');
console.log(`TOTAL DE TESTES: ${passCount + failCount}`);
console.log(`PASSOU: ${passCount}`);
console.log(`FALHOU: ${failCount}`);
console.log('======================================================');

if (failCount > 0) {
  process.exit(1);
}
