// Real React provider/DOM; Auth, App actions and network are synthetic boundaries.
// No Supabase, credentials, browser E2E or production data are used here.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const require = createRequire(import.meta.url);
const fixture = {
  user: null, cart: [], cleared: 0, mode: 'retail', statusRequests: [], catalogRequests: [],
};
globalThis.__wholesaleQA = fixture;
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
fixture.status = () => {
  const request = deferred(); fixture.statusRequests.push(request); return request.promise;
};
fixture.catalog = () => {
  const request = deferred(); fixture.catalogRequests.push(request); return request.promise;
};
const compiled = await build({
  entryPoints: ['src/context/WholesaleAccessContext.tsx'], bundle: true, write: false,
  platform: 'node', format: 'esm', jsx: 'transform',
  plugins: [{ name: 'synthetic-boundaries', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({
      path: pathToFileURL(require.resolve(args.path)).href, external: true,
    }));
    builder.onResolve({ filter: /AuthContext|AppContext|services\/wholesaleService|config\/tenant/ }, args => ({
      path: args.path, namespace: 'qa',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'qa' }, args => {
      const prefix = 'const f = globalThis.__wholesaleQA;';
      if (args.path.includes('AuthContext')) return { contents: `${prefix} export const useAuth = () => ({user: f.user});` };
      if (args.path.includes('AppContext')) return { contents: `${prefix} export const useApp = () => ({cart: f.cart, clearCart: () => {f.cart = []; f.cleared++;}, showToast: () => {}, setShoppingMode: mode => {f.mode = mode;}});` };
      if (args.path.includes('wholesaleService')) return { contents: `${prefix} export const fetchMyWholesaleStatus = () => f.status(); export const fetchWholesaleCatalog = () => f.catalog();` };
      return { contents: "export const PUBLIC_TENANT_SLUG = 'synthetic-qa';" };
    });
  }}],
});
const { WholesaleAccessProvider, useWholesaleAccess } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://qa.invalid' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let api;
function Probe() {
  api = useWholesaleAccess();
  return React.createElement('section', null,
    React.createElement('output', { 'aria-label': 'Purchase mode' }, api.purchaseMode),
    React.createElement('output', { 'aria-label': 'Wholesale status' }, api.wholesaleStatus),
    React.createElement('output', { 'aria-label': 'Company' }, api.wholesaleCompany?.legalName ?? ''),
    React.createElement('output', { 'aria-label': 'Catalog' }, [...api.wholesaleCatalogMap.keys()].join(',')),
    React.createElement('button', { onClick: () => api.requestSwitchPurchaseMode('wholesale') }, 'Wholesale'),
    api.isSwitchModeDialogOpen && React.createElement('button', { onClick: api.confirmSwitchPurchaseMode }, 'Confirm'),
  );
}
const container = document.getElementById('root');
let root;
const render = () => act(async () => root.render(React.createElement(WholesaleAccessProvider, null, React.createElement(Probe))));
const output = label => container.querySelector(`output[aria-label="${label}"]`).textContent;
async function click(label) {
  const button = [...container.querySelectorAll('button')].find(node => node.textContent === label);
  assert.ok(button, `Visible action ${label}`);
  await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
}
async function reset(user = { id: 'buyer-a', email: 'a@example.invalid' }) {
  if (root) await act(async () => root.unmount());
  Object.assign(fixture, { user, cart: [], cleared: 0, mode: 'retail', statusRequests: [], catalogRequests: [] });
  root = createRoot(container);
  await render();
}
async function approve(name = 'Synthetic A') {
  await act(async () => fixture.statusRequests.at(-1).resolve({ status: 'approved', legalName: name }));
}
let passed = 0;
let failed = 0;
async function test(name, body) {
  await reset();
  try { await body(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}
try {
  await test('logout discards delayed approval', async () => {
    const pending = fixture.statusRequests[0];
    fixture.user = null; await render();
    await act(async () => pending.resolve({ status: 'approved', legalName: 'Old buyer' }));
    assert.equal(output('Wholesale status'), 'unauthenticated');
    assert.equal(output('Company'), '');
    assert.equal(output('Purchase mode'), 'retail');
  });
  await test('empty catalog completes once despite recreated App actions', async () => {
    await approve(); await click('Wholesale');
    await act(async () => fixture.catalogRequests[0].resolve([]));
    for (let i = 0; i < 3; i++) await render();
    assert.equal(fixture.catalogRequests.length, 1);
    assert.equal(fixture.statusRequests.length, 1);
    assert.equal(output('Catalog'), '');
  });
  await test('out-of-order catalog cannot overwrite current prices', async () => {
    await approve(); await click('Wholesale');
    const old = fixture.catalogRequests[0];
    await act(async () => { void api.loadWholesaleCatalog(); });
    await act(async () => fixture.catalogRequests[1].resolve([{ productId: 'current' }]));
    await act(async () => old.resolve([{ productId: 'old' }]));
    assert.equal(output('Catalog'), 'current');
  });
  await test('buyer switch resets wholesale mode and cart; old prices stay hidden', async () => {
    await approve(); await click('Wholesale');
    const old = fixture.catalogRequests[0];
    fixture.cart = [{ productId: 'synthetic' }]; await render();
    fixture.user = { id: 'buyer-b', email: 'b@example.invalid' }; await render();
    await approve('Synthetic B');
    await act(async () => old.resolve([{ productId: 'private-a' }]));
    assert.equal(output('Company'), 'Synthetic B');
    assert.equal(output('Catalog'), '');
    assert.equal(output('Purchase mode'), 'retail');
    assert.equal(fixture.mode, 'retail');
    assert.equal(fixture.cart.length, 0);
    assert.equal(fixture.catalogRequests.length, 1);
  });
  await test('a new approved buyer cannot confirm the previous buyer modal', async () => {
    await approve(); fixture.cart = [{ productId: 'retail-item' }]; await render();
    await click('Wholesale');
    assert.ok([...container.querySelectorAll('button')].some(node => node.textContent === 'Confirm'));
    fixture.user = { id: 'buyer-b' }; await render(); await approve('Synthetic B');
    assert.equal(api.isSwitchModeDialogOpen, false);
    assert.equal(api.targetPendingMode, null);
    assert.equal(output('Purchase mode'), 'retail');
    assert.equal(fixture.cleared, 0);
    assert.equal(fixture.cart.length, 1);
  });
  await test('same buyer token refresh preserves mode and cart', async () => {
    await approve(); await click('Wholesale');
    await act(async () => fixture.catalogRequests[0].resolve([]));
    fixture.cart = [{ productId: 'synthetic' }];
    fixture.user = { ...fixture.user }; await render(); await approve();
    assert.equal(output('Purchase mode'), 'wholesale');
    assert.equal(fixture.cart.length, 1);
  });
  await test('revocation closes stale modal and preserves retail cart', async () => {
    await approve(); fixture.cart = [{ productId: 'retail-item' }]; await render(); await click('Wholesale');
    await act(async () => { void api.refreshWholesaleStatus(); });
    await act(async () => fixture.statusRequests.at(-1).resolve({ status: 'suspended' }));
    if (api.isSwitchModeDialogOpen) await click('Confirm');
    assert.equal(output('Purchase mode'), 'retail');
    assert.equal(fixture.cart.length, 1);
    assert.equal(fixture.cleared, 0);
  });
  await test('confirmation revalidates server approval before clearing retail cart', async () => {
    await approve(); fixture.cart = [{ productId: 'retail-item' }]; await render(); await click('Wholesale');
    await click('Confirm');
    assert.equal(fixture.cleared, 0);
    await act(async () => fixture.statusRequests.at(-1).resolve({ status: 'suspended' }));
    assert.equal(output('Purchase mode'), 'retail');
    assert.equal(fixture.cart.length, 1);
    assert.equal(fixture.cleared, 0);
    assert.equal(api.isSwitchModeDialogOpen, false);
  });
  await test('pending buyer cannot enable wholesale or fetch private catalog', async () => {
    await act(async () => fixture.statusRequests[0].resolve({ status: 'pending' }));
    await click('Wholesale');
    assert.equal(output('Wholesale status'), 'pending');
    assert.equal(output('Purchase mode'), 'retail');
    assert.equal(fixture.catalogRequests.length, 0);
    assert.equal(fixture.cleared, 0);
  });
  await test('suspended buyer remains in retail without private requests', async () => {
    await act(async () => fixture.statusRequests[0].resolve({ status: 'suspended' }));
    await click('Wholesale');
    assert.equal(output('Wholesale status'), 'suspended');
    assert.equal(output('Purchase mode'), 'retail');
    assert.equal(fixture.catalogRequests.length, 0);
    assert.equal(fixture.cleared, 0);
  });
  await test('rejected buyer remains in retail without private requests', async () => {
    await act(async () => fixture.statusRequests[0].resolve({ status: 'rejected' }));
    await click('Wholesale');
    assert.equal(output('Wholesale status'), 'rejected');
    assert.equal(output('Purchase mode'), 'retail');
    assert.equal(fixture.catalogRequests.length, 0);
  });
  await test('failed approval recheck preserves the retail cart', async () => {
    await approve();
    fixture.cart = [{ productId: 'retail-item' }]; await render();
    await click('Wholesale');
    await click('Confirm');
    assert.equal(fixture.statusRequests.length, 2);
    await act(async () => fixture.statusRequests.at(-1).reject(new Error('Synthetic status outage')));
    assert.equal(output('Purchase mode'), 'retail');
    assert.equal(output('Wholesale status'), 'unauthenticated');
    assert.equal(fixture.cart.length, 1);
    assert.equal(fixture.cleared, 0);
    assert.equal(api.isSwitchModeDialogOpen, false);
  });
  await test('double confirmation revalidates only once and clears cart once', async () => {
    await approve();
    fixture.cart = [{ productId: 'retail-item' }]; await render();
    await click('Wholesale');
    await click('Confirm');
    await click('Confirm');
    assert.equal(fixture.statusRequests.length, 2);
    assert.equal(fixture.cleared, 0);
    await act(async () => fixture.statusRequests.at(-1).resolve({ status: 'approved', legalName: 'Synthetic A' }));
    assert.equal(output('Purchase mode'), 'wholesale');
    assert.equal(fixture.cleared, 1);
    assert.equal(fixture.cart.length, 0);
    assert.equal(fixture.catalogRequests.length, 1);
  });
  await test('revocation hides loaded private catalog and resets wholesale cart', async () => {
    await approve(); await click('Wholesale');
    await act(async () => fixture.catalogRequests[0].resolve([{ productId: 'private-price' }]));
    assert.equal(output('Catalog'), 'private-price');
    fixture.cart = [{ productId: 'private-price' }]; await render();
    await act(async () => { void api.refreshWholesaleStatus(); });
    await act(async () => fixture.statusRequests.at(-1).resolve({ status: 'suspended' }));
    assert.equal(output('Purchase mode'), 'retail');
    assert.equal(output('Wholesale status'), 'suspended');
    assert.equal(output('Catalog'), '');
    assert.equal(output('Company'), '');
    assert.equal(fixture.cart.length, 0);
    assert.equal(fixture.cleared, 1);
  });
  console.log(`Wholesale React DOM lifecycle: ${passed} PASS / ${failed} FAIL; synthetic boundaries, not authenticated E2E`);
  assert.equal(failed, 0);
} finally {
  if (root) await act(async () => root.unmount());
  dom.window.close();
  delete globalThis.__wholesaleQA;
}
