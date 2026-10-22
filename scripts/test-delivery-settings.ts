import assert from 'node:assert/strict';
import { DEFAULT_DELIVERY_SETTINGS, parseDeliveryMethods, parseDeliverySettings, deliveryMethodLabel } from '../src/config/deliverySettings';
assert.deepEqual(parseDeliverySettings(DEFAULT_DELIVERY_SETTINGS), DEFAULT_DELIVERY_SETTINGS);
assert.deepEqual(parseDeliveryMethods(['retirada', 'uber_moto', 'uber_carro', 'uber']), ['retirada', 'uber_moto', 'uber_carro', 'uber']);
assert.equal(deliveryMethodLabel('uber_moto'), 'Uber Moto');
assert.equal(deliveryMethodLabel('uber_carro'), 'Uber Carro');
for (const bad of [null, [], ['invalid'], ['retirada', 'retirada'], [{id:'retirada',active:true}]]) assert.throws(() => parseDeliveryMethods(bad));
const origin = {street:'Rua sintética',number:'10',neighborhood:'Centro',city:'Curitiba',state:'PR',zipCode:'80000000'};
assert.deepEqual(parseDeliverySettings({...DEFAULT_DELIVERY_SETTINGS,origin}).origin, origin);
for (const bad of [null,{}, {...DEFAULT_DELIVERY_SETTINGS, extra:true}, {...DEFAULT_DELIVERY_SETTINGS,motoCentsPerKm:0},
  {...DEFAULT_DELIVERY_SETTINGS,carCentsPerKm:NaN}, {...DEFAULT_DELIVERY_SETTINGS,motoCentsPerKm:180.1},
  {...DEFAULT_DELIVERY_SETTINGS,origin:{...origin,zipCode:'80000-000'}}, {...DEFAULT_DELIVERY_SETTINGS,origin:{...origin,street:''}},
  {...DEFAULT_DELIVERY_SETTINGS,origin:{...origin,lat:0}}, {...DEFAULT_DELIVERY_SETTINGS,origin:{...origin,state:'pr'}}]) assert.throws(() => parseDeliverySettings(bad));
console.log('Delivery settings: explicit methods, origin privacy contract and integer tariffs PASS');
