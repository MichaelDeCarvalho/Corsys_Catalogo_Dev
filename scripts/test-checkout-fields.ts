import assert from 'node:assert/strict';
import { DEFAULT_CHECKOUT_FIELDS, parseCheckoutFields, checkoutRequiredErrors, projectCheckoutValues } from '../src/config/checkoutFields';

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
