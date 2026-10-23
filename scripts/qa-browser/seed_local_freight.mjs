// Local-only commercial delivery settings for a disposable CI checkout.
// Never connects to hosted Supabase and never creates real Google requests.
import { createClient } from '@supabase/supabase-js';

if (process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.QA_CONFIRM_DISPOSABLE_STACK !== 'yes' ||
    process.env.QA_SUPABASE_URL !== 'http://127.0.0.1:54321' ||
    !process.env.QA_LOCAL_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ACCESS_TOKEN ||
    process.env.SUPABASE_PROJECT_ID ||
    process.env.DATABASE_URL) {
  throw new Error('BLOCKED: local disposable freight fixture only');
}
const db = createClient(process.env.QA_SUPABASE_URL, process.env.QA_LOCAL_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const slug = 'corsys-catalogo-demo';
const { data: tenant, error: tenantError } = await db.from('tenants')
  .select('id,status').eq('slug', slug).single();
if (tenantError || !tenant || tenant.status !== 'active') {
  throw new Error('Synthetic local tenant not active');
}
const { data: publicSettings, error: publicError } = await db.from('tenant_public_settings')
  .select('delivery_methods').eq('tenant_id', tenant.id).single();
if (publicError || !publicSettings?.delivery_methods?.includes('entrega')) {
  throw new Error('Synthetic local tenant does not offer own delivery');
}
const settings = {
  origin: {
    street: 'Rua da Loja QA',
    number: '10',
    neighborhood: 'Centro',
    city: 'Curitiba',
    state: 'PR',
    zipCode: '80000000'
  },
  motoCentsPerKm: 180,
  carCentsPerKm: 250,
  estimateEnabled: true,
};
const { data: updated, error: saveError } = await db.from('tenant_delivery_settings')
  .update({ settings }).eq('tenant_id', tenant.id).select('tenant_id').single();
if (saveError || updated?.tenant_id !== tenant.id) {
  throw new Error('Failed to configure synthetic QA store delivery origin and rate');
}
console.log('FREIGHT-QA fixture PASS: synthetic store own delivery, origin and R$ 2.50/km; local only');
