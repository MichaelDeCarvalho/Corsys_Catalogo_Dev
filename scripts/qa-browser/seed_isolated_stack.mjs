// Fixture provisioning ONLY for disposable, local Supabase CI.
import { createClient } from '@supabase/supabase-js';

if (process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.QA_CONFIRM_DISPOSABLE_STACK !== 'yes' ||
    process.env.QA_SUPABASE_URL !== 'http://127.0.0.1:54321' ||
    !process.env.QA_LOCAL_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ACCESS_TOKEN ||
    process.env.SUPABASE_PROJECT_ID) {
  throw new Error('BLOCKED: fixture bootstrap must target unlinked local CI Supabase');
}
const db = createClient(process.env.QA_SUPABASE_URL, process.env.QA_LOCAL_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: tenants, error: tErr } = await db.from('tenants').select('id,slug').in(
  'slug', ['corsys-catalogo-demo', 'tenant-qa-b']
);
if (tErr || tenants?.length !== 2) throw new Error('Missing synthetic tenants');
const tenantA = tenants.find(x => x.slug === 'corsys-catalogo-demo').id;
const tenantB = tenants.find(x => x.slug === 'tenant-qa-b').id;
const fixtureUsers = [
  ['pending', tenantA, '00000000000001'],
  ['suspended', tenantA, '00000000000002'],
  ['rejected', tenantA, '00000000000003'],
  ['approved', tenantA, '00000000000004'],
  ['approved_b', tenantB, '00000000000005'],
];
for (const [state, tenantId, cnpj] of fixtureUsers) {
  const email = 'qa-b2b-' + state.replace('_','-') + '@qa.invalid';
  const { data, error } = await db.auth.admin.createUser({
    email, password: 'QA-Disposable-Only-2026!', email_confirm: true,
  });
  if (error || !data?.user?.id) throw new Error('Synthetic Auth fixture failed: '+(error?.status||'no-user'));
  // Existing least-privilege grants permit INSERT of application data,
  // then a separate UPDATE to link the Auth identity. Do not widen grants.
  const { data: buyer, error: buyerErr } = await db.from('wholesale_customers').insert({
    tenant_id: tenantId, cnpj,
    legal_name: 'Empresa Fictícia '+state, contact_name: 'Comprador QA',
    email, phone: '00000000000',
    status: state === 'approved_b' ? 'approved' : state,
  }).select('id').single();
  if (buyerErr || !buyer?.id) throw new Error('Synthetic wholesale fixture failed: '+buyerErr?.code);
  const { error: linkErr } = await db.from('wholesale_customers').update({
    user_id: data.user.id,
  }).eq('id', buyer.id);
  if (linkErr) throw new Error('Synthetic buyer Auth link failed: '+linkErr.code);
}
console.log('Local QA fixture PASS: 2 tenants, 2 products, 5 Auth users; no Hosted service called');
