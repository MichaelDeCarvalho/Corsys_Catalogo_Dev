/**
 * Narrow Stage-A regression: exercise Vite build guards against accidental
 * Google routing activation. No Supabase/Google network calls are made.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

type Case = { mode: string; url: string; approved: boolean; allowed: boolean; label: string };
const cases: Case[] = [
  { mode: 'production', url: 'http://127.0.0.1:54321', approved: true, allowed: false, label: 'production never opts in' },
  { mode: 'homologation', url: 'https://prod.example.supabase.co', approved: true, allowed: false, label: 'hosted targets forbidden' },
  { mode: 'homologation', url: 'http://127.0.0.1:54321', approved: false, allowed: false, label: 'explicit QA approval required' },
  { mode: 'homologation', url: 'http://127.0.0.1:54321', approved: true, allowed: true, label: 'local isolated QA build' },
];
for (const scenario of cases) {
  const result = spawnSync('bun', ['run', 'build', '--mode', scenario.mode], {
    encoding: 'utf8',
    timeout: 90_000,
    env: {
      ...process.env,
      VITE_GOOGLE_ROUTES_UI_ENABLED: 'true',
      VITE_CORSYS_HOMOLOGATION_APPROVED: scenario.approved ? 'true' : 'false',
      VITE_SUPABASE_URL: scenario.url,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-local-publishable-key',
    },
  });
  if (result.error) throw result.error;
  const output = (result.stdout ?? '') + '\n' + (result.stderr ?? '');
  if (scenario.allowed) {
    assert.equal(result.status, 0, scenario.label + ': ' + output.slice(-2500));
  } else {
    assert.notEqual(result.status, 0, scenario.label);
    assert.match(output, /RELEASE_BLOCKED_GOOGLE_ROUTES/, scenario.label);
  }
  console.log('PASS: ' + scenario.label);
}

const config = readFileSync('supabase/config.toml', 'utf8');
assert.match(config, /\[functions\.estimate-delivery\]\s*verify_jwt\s*=\s*false/);
const edge = readFileSync('supabase/functions/estimate-delivery/index.ts', 'utf8');
assert.match(edge, /Deno\.env\.get\("GOOGLE_ROUTES_ENABLED"\) !== "true"/);
assert.match(edge, /reserve_google_routes_attempt/);
assert.doesNotMatch(edge, /reserveAttempt:\s*async\s*\(\)\s*=>\s*true/);
const ui = readFileSync('src/components/storefront/AutomaticDeliveryEstimate.tsx', 'utf8');
assert.match(ui, /Date\.parse\(data\.expiresAt\) <= Date\.now\(\)/);
assert.doesNotMatch(ui, /expiresAt:\s*data\.expiresAt\s*\|\|/);
const cart = readFileSync('src/components/storefront/CartDrawer.tsx', 'utf8');
assert.match(cart, /Date\.parse\(activeQuote\.expiresAt\) <= Date\.now\(\)/);
console.log('Stage-A frontend and Edge configuration contract: PASS (offline, no paid calls).');
