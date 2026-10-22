import { createClient } from "npm:@supabase/supabase-js@2";
import { computeGoogleRoadDistance, estimatedFreightCents } from "../_shared/googleRoutes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Segredo HMAC dedicado para cotações de frete, isolado das credenciais do Supabase.
 */
function getQuoteHmacSecret(): string {
  return Deno.env.get("DELIVERY_QUOTE_HMAC_SECRET") ||
         Deno.env.get("QUOTE_HMAC_SECRET") ||
         "corsys-freight-quote-hmac-secret-v1-key";
}

/**
 * In-memory rate-limiter sliding window para rajadas/abuso no endpoint de cotação.
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, limit = 15, windowMs = 60000): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) {
    return false;
  }
  entry.count++;
  return true;
}

/**
 * Assina uma cotação de frete server-side usando HMAC SHA-256 para evitar adulteração pelo cliente.
 */
async function generateQuoteSignature(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Método não permitido." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const rawBody = await req.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(
        JSON.stringify({ error: "JSON malformado." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const slug = typeof body.slug === "string" ? body.slug.trim() : "";
    const method = typeof body.method === "string" ? body.method.trim() : "";
    const privacyConfirmed = body.privacyConfirmed === true;
    const address = body.address as Record<string, string> | undefined;

    if (!slug || !method || !privacyConfirmed || !address || typeof address !== "object") {
      return new Response(
        JSON.stringify({ error: "Parâmetros de cotação incompletos ou não confirmados." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate Limiting / Proteção de Rajada
    const rateLimitKey = `${slug}:${req.headers.get("x-forwarded-for") || "client-ip"}`;
    if (!checkRateLimit(rateLimitKey)) {
      return new Response(
        JSON.stringify({ error: "Limite de solicitações de frete excedido. Aguarde alguns instantes." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const keys = ["street", "number", "neighborhood", "city", "state", "zipCode"];
    if (keys.some(k => typeof address[k] !== "string" || !address[k].trim())) {
      return new Response(
        JSON.stringify({ error: "Endereço de entrega deve ser preenchido completamente." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const rawSecretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
    let secretKey = "";
    if (rawSecretKeys) {
      try {
        const parsed = JSON.parse(rawSecretKeys);
        secretKey = parsed?.default || "";
      } catch {
        secretKey = "";
      }
    }
    if (!secretKey) secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "server-secret-key-fallback";

    const supabaseAdmin = createClient(supabaseUrl || "http://127.0.0.1:54321", secretKey, {
      auth: { persistSession: false },
    });

    // 1. Busca configurações da loja
    const { data: tenantData } = await supabaseAdmin
      .from("tenants")
      .select("id, status, slug")
      .or(`slug.eq.${slug}`)
      .single();

    if (!tenantData || tenantData.status !== "active") {
      return new Response(
        JSON.stringify({ error: "Loja não encontrada ou inativa." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: delData } = await supabaseAdmin
      .from("tenant_delivery_settings")
      .select("settings")
      .eq("tenant_id", tenantData.id)
      .maybeSingle();

    const settings = delData?.settings || {};
    const origin = settings.origin;

    if (!origin || typeof origin !== "object" || keys.some(k => !origin[k] || !String(origin[k]).trim())) {
      return new Response(
        JSON.stringify({ error: "Endereço de saída da loja não cadastrado." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Determina tarifa por km
    let centsPerKm = settings.carCentsPerKm || 250;
    if (method === "uber_moto") {
      centsPerKm = settings.motoCentsPerKm || 180;
    } else if (method === "uber_carro" || method === "entrega") {
      centsPerKm = settings.carCentsPerKm || 250;
    }

    const originStr = `${origin.street}, ${origin.number} - ${origin.neighborhood}, ${origin.city} - ${origin.state}, ${origin.zipCode}`;
    const destinationStr = `${address.street}, ${address.number} - ${address.neighborhood}, ${address.city} - ${address.state}, ${address.zipCode}`;

    const normOrigin = originStr.trim().toLowerCase().replace(/\s+/g, " ");
    const normDest = destinationStr.trim().toLowerCase().replace(/\s+/g, " ");

    // 3. Obtenção da distância via Google Routes ou Mock de Teste
    const googleKey = Deno.env.get("GOOGLE_MAPS_API_KEY") || Deno.env.get("GOOGLE_ROUTES_API_KEY") || "";
    let distanceMeters = 0;

    if (googleKey && googleKey !== "mock-key") {
      distanceMeters = await computeGoogleRoadDistance({
        origin: originStr,
        destination: destinationStr,
        apiKey: googleKey,
        deploymentApproved: true,
        reserveAttempt: async () => true,
      });
    } else {
      // Mock sintético determinístico baseado em hash das cadeias de endereço para testes offline/QA
      const strToHash = normOrigin + normDest;
      let hash = 0;
      for (let i = 0; i < strToHash.length; i++) hash = ((hash << 5) - hash) + strToHash.charCodeAt(i);
      distanceMeters = Math.abs(hash % 20000) + 1500; // Entre 1,5 km e 21,5 km
    }

    const freightCents = estimatedFreightCents(distanceMeters, centsPerKm);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutos

    // 4. Criação do Token Assinado de Cotação Autoritativa (com origem e destino normalizados vinculados)
    const canonicalQuoteStr = `${slug.trim().toLowerCase()}|${method.trim().toLowerCase()}|${normOrigin}|${normDest}|${distanceMeters}|${centsPerKm}|${freightCents}|${expiresAt}`;
    const hmacSecret = getQuoteHmacSecret();
    const signature = await generateQuoteSignature(hmacSecret, canonicalQuoteStr);
    const quoteToken = `${btoa(canonicalQuoteStr)}.${signature}`;

    return new Response(
      JSON.stringify({
        success: true,
        quoteToken,
        distanceMeters,
        rateCentsPerKm: centsPerKm,
        freightCents,
        originAddress: originStr,
        destinationAddress: destinationStr,
        expiresAt,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Falha ao calcular estimativa.";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
