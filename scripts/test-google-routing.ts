import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeGoogleRoadDistance, estimatedFreightCents } from '../supabase/functions/_shared/googleRoutes';
import { googleMapsRouteUrl } from '../src/utils/googleMapsRouteUrl';
// An enabling tenant choice cannot activate the paid feature without release approval.
const checkoutSource = readFileSync('src/components/storefront/CartDrawer.tsx', 'utf8');
assert.match(checkoutSource, /import\.meta\.env\.VITE_GOOGLE_ROUTES_UI_ENABLED === 'true'/,
  'Delivery estimate UI must require an explicit build-time opt-in');
const adminDeliverySource = readFileSync('src/components/tenantadmin/DeliverySettings.tsx', 'utf8');
assert.match(adminDeliverySource, /disabled=\{import\.meta\.env\.VITE_GOOGLE_ROUTES_UI_ENABLED !== 'true'\}/,
  'Tenant admin must not enable an unavailable Google estimate before release');
const origin = 'Rua de teste, 10, Cidade & Bairro, BR';
const destination = 'Outra rua, 20 #fundos, Cidade, BR';
const link = new URL(googleMapsRouteUrl(origin, destination));
assert.equal(link.origin, 'https://www.google.com');
assert.equal(link.searchParams.get('origin'), origin);
assert.equal(link.searchParams.get('destination'), destination);
assert.equal(link.searchParams.get('api'), '1');
assert.equal(link.searchParams.has('key'), false);
assert.throws(() => googleMapsRouteUrl('', destination));
let attempts = 0, calls = 0;
const fakeFetch: typeof fetch = async (input, init) => {
  calls++;
  assert.equal(attempts, calls);
  assert.equal(input, 'https://routes.googleapis.com/directions/v2:computeRoutes');
  const headers = init!.headers as Record<string, string>;
  assert.equal(headers['X-Goog-FieldMask'], 'routes.distanceMeters');
  const body = JSON.parse(init!.body as string);
  assert.equal(body.travelMode, 'DRIVE');
  assert.equal(body.routingPreference, 'TRAFFIC_UNAWARE');
  assert.equal(body.intermediates, undefined);
  return Response.json({ routes: [{ distanceMeters: 12345 }] });
};
const opts = { origin, destination, apiKey: 'synthetic-test-only', deploymentApproved: true,
  reserveAttempt: async () => { attempts++; return true; }, fetcher: fakeFetch };
assert.equal(await computeGoogleRoadDistance(opts), 12345);
assert.equal(estimatedFreightCents(12345, 180), 2222);
assert.equal(estimatedFreightCents(12345, 250), 3086);
assert.throws(() => estimatedFreightCents(NaN, 180));
assert.throws(() => estimatedFreightCents(1000, 180.5));
await assert.rejects(computeGoogleRoadDistance({ ...opts, deploymentApproved: false }), /ROUTING_DISABLED/);
await assert.rejects(computeGoogleRoadDistance({ ...opts, apiKey: '' }), /ROUTING_DISABLED/);
await assert.rejects(computeGoogleRoadDistance({ ...opts, reserveAttempt: async () => false }), /ROUTING_QUOTA_EXHAUSTED/);
assert.equal(calls, 1);
for (const response of [Response.json({}), Response.json({ routes: [{ distanceMeters: -1 }] }), new Response('bad', { status: 429 })]) {
  await assert.rejects(computeGoogleRoadDistance({ ...opts, fetcher: async () => response }));
}
let failedCalls = 0;
await assert.rejects(computeGoogleRoadDistance({ ...opts, fetcher: async () => { failedCalls++; throw new Error('secret/internal'); } }), /ROUTING_UNAVAILABLE/);
assert.equal(failedCalls, 1); // No automatic retry consuming extra quota.
console.log('Google Routes adapter/Maps URL: PASS using synthetic responses; no real API requests.');
