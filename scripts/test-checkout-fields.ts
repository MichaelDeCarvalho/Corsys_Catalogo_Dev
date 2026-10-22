import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWholesaleRequestGate } from '../src/utils/wholesaleRequestGate';
import { CHECKOUT_FIELDS, LOCKED_CHECKOUT_FIELDS, DEFAULT_CHECKOUT_FIELDS, fieldApplies, parseCheckoutFields, checkoutRequiredErrors, projectCheckoutValues } from '../src/config/checkoutFields';

const defaults = () => structuredClone(DEFAULT_CHECKOUT_FIELDS);
assert.deepEqual(parseCheckoutFields(defaults()), defaults());
for (const bad of [null, [], {}, { ...defaults(), total: { visible: true, required: true } },
  { ...defaults(), email: { visible: false, required: true } },
  { ...defaults(), email: { visible: 'false', required: false } },
  { ...defaults(), name: { visible: false, required: false } },
  { ...defaults(), email: { visible: true, required: false, label: 'Injected' } }]) {
  assert.throws(() => parseCheckoutFields(bad));
}
const config = defaults();
config.email = { visible: true, required: true };
config.city = { visible: true, required: true };
config.companyName = { visible: true, required: true };
config.notes = { visible: false, required: false };
const values = { type: 'PF', name: 'Teste', document: '52998224725', phone: '41999999999', street: 'Rua teste', email: ' ', city: '', companyName: 'valor antigo', notes: 'valor oculto', paymentMethod: 'pix' };
assert.deepEqual(Object.keys(checkoutRequiredErrors(config, values, false)), ['email', 'city']);
assert.deepEqual(Object.keys(checkoutRequiredErrors(config, { ...values, type: 'PJ', companyName: '' }, false)), ['companyName', 'email', 'city']);
assert.deepEqual(Object.keys(checkoutRequiredErrors(config, { ...values, type: 'PJ', companyName: '' }, true)), ['email', 'city']);
const projected = projectCheckoutValues(config, values, false);
assert.equal(projected.notes, ''); assert.equal(projected.companyName, '');
assert.equal(projected.paymentMethod, 'pix'); assert.equal(values.notes, 'valor oculto');
assert.equal(checkoutRequiredErrors(config, { ...values, email: 'a@b.invalid', city: 'Curitiba' }, false).email, undefined);
// Fixed core remains mandatory only when buyer enters it; wholesale uses approved identity.
assert.deepEqual(Object.keys(checkoutRequiredErrors(defaults(), { type: 'PF' }, false)), ['name', 'phone', 'document', 'street']);
assert.deepEqual(Object.keys(checkoutRequiredErrors(defaults(), { type: 'PJ' }, true)), ['street']);
console.log('Checkout fields: parser, required rules, PF/PJ/B2B and hidden-value projection PASS');

// Complete configurable-field matrix at the pure validation/projection layer.
// This is not a browser test or a server persistence claim.
const optionalCheckoutFields = (Object.keys(CHECKOUT_FIELDS) as Array<keyof typeof CHECKOUT_FIELDS>)
  .filter(key => !LOCKED_CHECKOUT_FIELDS.includes(key));
let matrixChecks = 0;
for (const key of optionalCheckoutFields) {
  for (const wholesale of [false, true]) {
    const hidden = defaults();
    hidden[key] = { visible: false, required: false };
    assert.deepEqual(parseCheckoutFields(hidden), hidden);
    const entered = {
      type: 'PJ', name: 'Comprador QA', document: '12345678000195',
      phone: '41999999999', street: 'Rua QA', [key]: 'valor-antigo',
    };
    const sanitized = projectCheckoutValues(hidden, entered, wholesale);
    assert.equal(sanitized[key], '', `Campo oculto ${key} deve ser expurgado (${wholesale ? 'B2B' : 'retail'})`);
    assert.equal(entered[key], 'valor-antigo', 'Projeção não pode mutar formulário de entrada');
    assert.equal(checkoutRequiredErrors(hidden, entered, wholesale)[key], undefined,
      'Campo oculto não pode ser obrigatório');

    const required = defaults();
    required[key] = { visible: true, required: true };
    const missing = { ...entered, [key]: ' ' };
    const errors = checkoutRequiredErrors(required, missing, wholesale);
    if (fieldApplies(key, wholesale, missing.type)) {
      assert.equal(errors[key], `${CHECKOUT_FIELDS[key]} é obrigatório.`);
    } else {
      assert.equal(errors[key], undefined,
        `Campo ${key} não deve exigir identidade comercial do browser B2B`);
    }
    matrixChecks += 2;
  }
}
console.log(`Checkout fields matrix: ${matrixChecks} hidden/required rules across ${optionalCheckoutFields.length} optional fields and PF/PJ/B2B contract PASS`);

// B2B integration-contract tests (pure functions only; no browser, network or order creation).
// Commercial identity is always derived server-side; browser may send operational contact only.
import { buildCheckoutRequestBody, computeOrderFingerprint, type SubmitOrderCheckoutDraft } from '../src/services/orderService';

const wholesalePolicy = defaults();
wholesalePolicy.email = { visible: false, required: false };
wholesalePolicy.notes = { visible: false, required: false };
wholesalePolicy.city = { visible: true, required: true };
const rawWholesaleForm = {
  type: 'PJ', name: 'Dados forjados', document: '12345678000195',
  companyName: 'Razão social forjada', phone: '41999999999',
  street: 'Rua de teste', city: '', email: 'oculto@example.invalid',
  notes: 'observações ocultas', sellerCode: 'VEN-01', paymentMethod: 'pix'
};
const wholesaleRequired = checkoutRequiredErrors(wholesalePolicy, rawWholesaleForm, true);
assert.deepEqual(Object.keys(wholesaleRequired), ['city'],
  'B2B exige somente campos aplicáveis e configurados, sem exigir identidade comercial no browser');

const safeWholesaleForm = projectCheckoutValues(wholesalePolicy, rawWholesaleForm, true);
assert.equal(safeWholesaleForm.companyName, '');
assert.equal(safeWholesaleForm.email, '');
assert.equal(safeWholesaleForm.notes, '');
assert.equal(rawWholesaleForm.companyName, 'Razão social forjada', 'Projeção não altera entrada original');

const idempotencyKey = '11111111-1111-4111-8111-111111111111';
const wholesaleDraft: SubmitOrderCheckoutDraft = {
  tenantSlug: 'tenant-qa-a',
  shoppingMode: 'wholesale',
  items: [{ productId: '11111111-1111-4111-8111-111111111112', quantity: 3 }],
  customer: {
    name: 'Cliente comercial falso', document: '12345678000195',
    companyName: 'Razão social falsa', type: 'PJ',
    email: '  operacional@example.invalid  ', phone: ' 41988889999 '
  },
  shippingAddress: { street: ' Rua de teste ', city: 'Curitiba', number: ' 100 ' },
  paymentMethod: 'pix',
  deliveryMethod: 'retirada'
};
const canonicalB2bBody = buildCheckoutRequestBody(wholesaleDraft, idempotencyKey);
assert.deepEqual(canonicalB2bBody.customer, {
  email: 'operacional@example.invalid', phone: '41988889999'
}, 'B2B não encaminha name, document, companyName nem type fornecidos pelo navegador');
assert.deepEqual(canonicalB2bBody.items, [{
  productId: '11111111-1111-4111-8111-111111111112',
  quantity: 3, selectedVariant: null
}], 'B2B envia apenas identidade do produto, quantidade e variante, sem valores financeiros');
assert.equal(canonicalB2bBody.shoppingMode, 'wholesale');
assert.equal(canonicalB2bBody.tenantSlug, 'tenant-qa-a');
assert.equal((canonicalB2bBody.shippingAddress as Record<string, unknown>).street, 'Rua de teste');

const tamperedDraft = {
  ...wholesaleDraft,
  userId: 'another-user',
  tenantId: 'another-tenant',
  total: 0.01,
  wholesalePrice: 0.01,
  items: [{ ...wholesaleDraft.items[0], price: 0.01, costPrice: 0 }]
} as SubmitOrderCheckoutDraft;
assert.deepEqual(buildCheckoutRequestBody(tamperedDraft, idempotencyKey), canonicalB2bBody,
  'Allowlist descarta chaves extras de autoridade financeira, tenant e usuário');
assert.deepEqual(
  buildCheckoutRequestBody({ ...wholesaleDraft, customer: undefined }, idempotencyKey).customer,
  {},
  'Contato operacional não informado gera customer: {} no atacado'
);
assert.throws(() => buildCheckoutRequestBody({
  ...wholesaleDraft, items: [{ ...wholesaleDraft.items[0], quantity: 0 }]
}, idempotencyKey), 'Quantidade nula não entra no payload');
assert.throws(() => buildCheckoutRequestBody({
  ...wholesaleDraft, customer: { email: 123 }
} as unknown as SubmitOrderCheckoutDraft, idempotencyKey), 'Tipo incorreto de e-mail operacional falha fechado');
assert.throws(() => buildCheckoutRequestBody({
  ...wholesaleDraft, shippingAddress: { street: '  ' }
}, idempotencyKey), 'Endereço obrigatório em branco falha fechado');

wholesalePolicy.email = { visible: true, required: true };
assert.equal(
  checkoutRequiredErrors(wholesalePolicy, { ...rawWholesaleForm, email: ' ', city: 'Curitiba' }, true).email,
  'E-mail é obrigatório.',
  'Regra required configurável também se aplica ao contato operacional no B2B'
);
assert.deepEqual(
  checkoutRequiredErrors(wholesalePolicy, { ...rawWholesaleForm, email: 'contato@example.invalid', city: 'Curitiba' }, true),
  {},
  'Regra required aceita os campos B2B aplicáveis preenchidos'
);

const actorA = '41840000-0000-4000-8000-000000000005';
const actorB = '41840000-0000-4000-8000-000000000006';
const fingerprintA = await computeOrderFingerprint(wholesaleDraft, actorA);
assert.equal(fingerprintA, await computeOrderFingerprint(wholesaleDraft, actorA),
  'Mesma intenção e mesmo comprador produzem fingerprint determinístico para retry');
assert.notEqual(fingerprintA, await computeOrderFingerprint(wholesaleDraft, actorB),
  'Compradores diferentes não compartilham fingerprint');
assert.notEqual(fingerprintA, await computeOrderFingerprint({ ...wholesaleDraft, tenantSlug: 'tenant-qa-b' }, actorA),
  'Tenants diferentes não compartilham fingerprint');
assert.notEqual(fingerprintA, await computeOrderFingerprint({
  ...wholesaleDraft, items: [{ ...wholesaleDraft.items[0], quantity: 4 }]
}, actorA), 'Mudança de quantidade invalida o fingerprint anterior');
assert.notEqual(fingerprintA, await computeOrderFingerprint({
  ...wholesaleDraft, shippingAddress: { ...wholesaleDraft.shippingAddress, number: '999' }
}, actorA), 'Mudança de endereço não pode reutilizar recibo antigo');
assert.notEqual(fingerprintA, await computeOrderFingerprint({
  ...wholesaleDraft, paymentMethod: 'boleto'
}, actorA), 'Mudança de pagamento não pode reutilizar recibo antigo');
assert.notEqual(fingerprintA, await computeOrderFingerprint({
  ...wholesaleDraft, customer: { ...wholesaleDraft.customer, phone: '41977778888' }
}, actorA), 'Mudança de contato não pode reutilizar recibo antigo');
assert.notEqual(fingerprintA, await computeOrderFingerprint({
  ...wholesaleDraft, shoppingMode: 'retail',
  customer: { name: 'Comprador fictício', type: 'PF', document: '52998224725', phone: '41988889999' }
}, actorA), 'Modalidades de compra diferentes não podem reutilizar recibos antigos');
console.log('Checkout receipt fingerprint: buyer, tenant, address, payment, contact, items and mode isolation PASS');
console.log('B2B checkout contract: allowlist, optional/required, operational contact, tampering and actor/tenant fingerprint PASS');


// Status/catalog races: deterministic deferred resolutions without a network.
const statusGate = createWholesaleRequestGate();
const oldRequest = statusGate.begin(actorA);
const newRequest = statusGate.begin(actorA);
assert.equal(statusGate.isCurrent(oldRequest, actorA), false,
  'Resposta mais antiga do mesmo usuário não pode sobrescrever uma atualização recente');
assert.equal(statusGate.isCurrent(newRequest, actorA), true,
  'Resposta mais recente do mesmo usuário permanece aplicável');
assert.equal(statusGate.isCurrent(newRequest, actorB), false,
  'Troca de usuário invalida resultado mesmo antes do efeito React de limpeza');
statusGate.invalidate();
assert.equal(statusGate.isCurrent(newRequest, actorA), false,
  'Logout/revogação invalida requisição sem depender de resposta HTTP');

const catalogGate = createWholesaleRequestGate();
let resolveOldCatalog!: (value: string) => void;
let resolveNewCatalog!: (value: string) => void;
const slowOldCatalog = new Promise<string>(resolve => { resolveOldCatalog = resolve; });
const fastNewCatalog = new Promise<string>(resolve => { resolveNewCatalog = resolve; });
const oldCatalogRequest = catalogGate.begin(actorA);
let visibleCatalog: string | null = null;
const oldCompletion = slowOldCatalog.then(value => {
  if (catalogGate.isCurrent(oldCatalogRequest, actorA)) visibleCatalog = value;
});
const newCatalogRequest = catalogGate.begin(actorA);
const newCompletion = fastNewCatalog.then(value => {
  if (catalogGate.isCurrent(newCatalogRequest, actorA)) visibleCatalog = value;
});
resolveNewCatalog('novo catálogo aprovado');
await newCompletion;
resolveOldCatalog('catálogo antigo');
await oldCompletion;
assert.equal(visibleCatalog, 'novo catálogo aprovado',
  'Catálogo antigo chegando por último não sobrescreve o catálogo da requisição nova');

const afterRevocation = catalogGate.begin(actorA);
catalogGate.invalidate();
assert.equal(catalogGate.isCurrent(afterRevocation, actorA), false,
  'Catálogo solicitado antes de revogação não pode repovoar cache após limpeza');
const otherUserRequest = catalogGate.begin(actorB);
assert.equal(catalogGate.isCurrent(otherUserRequest, actorA), false,
  'Requisição pertencente a outro comprador não pode aplicar preços B2B ao atual');
console.log('B2B async request guards: stale result, logout, user switch, out-of-order catalog and revocation PASS');

// Static wiring audit only: executable request gate behavior is tested above.
const contextSource = readFileSync('src/context/WholesaleAccessContext.tsx', 'utf8');
assert.ok(contextSource.includes('statusRequestGateRef.current.isCurrent(request, currentUserIdRef.current)'),
  'Status B2B consulta a identidade atual antes de aplicar a resposta');
assert.ok(contextSource.includes('catalogRequestGateRef.current.isCurrent(request, currentUserIdRef.current)'),
  'Catálogo B2B consulta a identidade atual antes de aplicar a resposta');
assert.ok(contextSource.includes('wholesaleOwnerId !== null && wholesaleOwnerId === user?.id'),
  'Exposição de status no provider é limitada ao usuário atual');
assert.ok(contextSource.includes("targetPendingMode === 'wholesale' && (!user || !isApproved || loadingStatus)"),
  'Confirmar modal B2B usa aprovação atual, não decisão anterior');
assert.ok(contextSource.includes('catalogLoadedUserIdRef.current !== user?.id'),
  'Catálogo vazio não entra em loop de refetch automático');
assert.ok(contextSource.includes('appActionsRef.current = { clearCart, showToast, setShoppingMode }') &&
  contextSource.includes("const resetToRetail = useCallback(() => {"),
  'Callbacks instáveis de AppContext não são dependências diretas do reset de autorização');
console.log('B2B context lifecycle wiring: identity guards, stale modal, empty catalog and stable app actions PASS');
