import { createClient } from 'npm:@supabase/supabase-js@2';
import { computeGoogleRoadDistance, estimatedFreightCents } from '../_shared/googleRoutes.ts';

Deno.serve(async (req: Request) => {
  const allowed = (Deno.env.get('ROUTING_ALLOWED_ORIGINS') ?? '').split(',').map(x => x.trim()).filter(Boolean);
  const origin = req.headers.get('Origin') ?? '';
  const headers = { 'Content-Type': 'application/json', 'Vary': 'Origin', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const reply = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers });
  // Origin protects browser use; it is NOT authentication or a substitute for global quota.
  if (!origin || !allowed.includes(origin)) return reply(403, 'Origem não permitida.');
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, 'Método não permitido.');
  if (Deno.env.get('GOOGLE_ROUTES_ENABLED') !== 'true') return reply(503, 'Estimativa indisponível. Frete a combinar com a loja.');
  try {
    if (Number(req.headers.get('Content-Length') ?? 0) > 4096) return reply(413, 'Requisição inválida.');
    if (!req.body) return reply(400, 'Requisição inválida.');
    const reader = req.body.getReader();
    const decoder = new TextDecoder();
    let raw = '', bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 4096) { await reader.cancel(); return reply(413, 'Requisição inválida.'); }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    let body;
    try { body = JSON.parse(raw); } catch { return reply(400, 'Requisição inválida.'); }
    if (!body || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'address,method,privacyConfirmed,slug' ||
        body.privacyConfirmed !== true || typeof body.slug !== 'string' || !/^[a-z0-9-]{1,100}$/.test(body.slug) ||
        !['uber_moto', 'uber_carro'].includes(body.method)) return reply(400, 'Dados de entrega inválidos.');
    const addressKeys = ['street', 'number', 'neighborhood', 'city', 'state', 'zipCode'];
    const address = body.address;
    if (!address || typeof address !== 'object' || Array.isArray(address) ||
        Object.keys(address).sort().join(',') !== [...addressKeys].sort().join(',') ||
        addressKeys.some(k => typeof address[k] !== 'string' || !address[k].trim() || address[k].length > 100) ||
        !/^[A-Z]{2}$/.test(address.state) || !/^\d{8}$/.test(address.zipCode)) return reply(400, 'Informe o endereço completo, UF e CEP.');
    const key = Deno.env.get('GOOGLE_ROUTES_API_KEY') ?? '';
    const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
    const url = Deno.env.get('SUPABASE_URL');
    if (!key || !secret || !url) return reply(503, 'Estimativa indisponível.');
    const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: tenant, error: tenantError } = await db.from('tenant_public_settings')
      .select('tenant_id, delivery_methods').eq('slug', body.slug).maybeSingle();
    if (tenantError || !tenant || !Array.isArray(tenant.delivery_methods) || !tenant.delivery_methods.includes(body.method)) return reply(400, 'Método de entrega indisponível.');
    const { data: row, error } = await db.from('tenant_delivery_settings').select('settings').eq('tenant_id', tenant.tenant_id).maybeSingle();
    const config = row?.settings;
    if (error || !config?.estimateEnabled || !config.origin) return reply(503, 'A loja ainda não ativou a estimativa.');
    const format = (a: Record<string, string>) => `${a.street}, ${a.number}, ${a.neighborhood}, ${a.city}, ${a.state}, ${a.zipCode}, Brasil`;
    const originAddress = format(config.origin), destinationAddress = format(address);
    const rate = body.method === 'uber_moto' ? config.motoCentsPerKm : config.carCentsPerKm;
    // Reject corrupt rates before any billable request.
    estimatedFreightCents(1, rate);
    const meters = await computeGoogleRoadDistance({ origin: originAddress, destination: destinationAddress, apiKey: key,
      deploymentApproved: true, reserveAttempt: async () => {
        const reservation = await db.rpc('reserve_google_routes_attempt');
        return !reservation.error && reservation.data === true;
      } });
    return Response.json({ distanceMeters: meters, centsPerKm: rate, estimateCents: estimatedFreightCents(meters, rate),
      originAddress, destinationAddress, routeMode: 'DRIVE', advisoryOnly: true }, { headers });
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code === 'ROUTING_QUOTA_EXHAUSTED') return reply(429, 'Limite de consultas atingido. Frete a combinar com a loja.');
    if (code === 'ROUTE_NOT_FOUND') return reply(422, 'Trajeto não encontrado. Confira os endereços.');
    return reply(503, 'Não foi possível calcular a estimativa. Frete a combinar com a loja.');
  }
});
