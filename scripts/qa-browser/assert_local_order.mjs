// Independent database check after real Chromium/Edge checkout; disposable Supabase only.
import { createClient } from '@supabase/supabase-js';

if (process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.QA_CONFIRM_DISPOSABLE_STACK !== 'yes' ||
    process.env.QA_ALLOW_SYNTHETIC_LOCAL_ORDER !== 'yes' ||
    process.env.QA_SUPABASE_URL !== 'http://127.0.0.1:54321' ||
    !process.env.QA_LOCAL_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ACCESS_TOKEN ||
    process.env.SUPABASE_PROJECT_ID) {
  throw new Error('BLOCKED: cannot audit orders outside disposable local Supabase');
}
const db = createClient(process.env.QA_SUPABASE_URL, process.env.QA_LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: orders, error } = await db.from('orders')
  .select('id,tenant_id,order_number,shopping_mode,total');
if (error) throw new Error('Local order lookup failed: ' + error.code);
if (orders?.length !== 1) throw new Error('Expected exactly one local fictitious checkout order');
const { data: tenant, error: tenantError } = await db.from('tenants')
  .select('slug').eq('id', orders[0].tenant_id).single();
if (tenantError || tenant?.slug !== 'corsys-catalogo-demo') {
  throw new Error('Fictitious order leaked into another tenant');
}
if (orders[0].shopping_mode !== 'retail' ||
    !orders[0].order_number || !(Number(orders[0].total) > 0)) {
  throw new Error('Persisted order has invalid expected financial/status fields');
}
console.log('LOCAL-ORDER DB PASS: exactly one order, correct synthetic tenant and mode; no real PII logged');
