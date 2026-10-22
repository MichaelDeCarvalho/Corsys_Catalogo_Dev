import { createClient } from "npm:@supabase/supabase-js@2";
import { computeGoogleRoadDistance, estimatedFreightCents } from "../_shared/googleRoutes.ts";
import { getDeliveryQuoteSecret, signDeliveryQuote } from "../_shared/deliveryQuote.ts";


/**
 * Segredo HMAC dedicado para cotações de frete, isolado das credenciais do Supabase.
 */
function getQuoteHmacSecret(): string {
  return getDeliveryQuoteSecret(name => Deno.env.get(name));
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

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const allowedOrigins = (Deno.env.get("ROUTING_ALLOWED_ORIGINS") || "")
    .split(",").map(value => value.trim()).filter(Boolean);
  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
  // Origin is only a browser safeguard; project-wide quota remains mandatory.
  if (!origin || !allowedOrigins.includes(origin)) {
    return new Response(JSON.stringify({ error: "Origem não permitida." }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Método não permitido." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (Deno.env.get("GOOGLE_ROUTES_ENABLED") !== "true") {
    return new Response(JSON.stringify({ error: "Frete automático indisponível." }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    if (!/^[a-z0-9-]{1,100}$/.test(slug) || !["uber_moto", "uber_carro", "entrega"].includes(method) || !privacyConfirmed || !address || typeof address !== "object" || Array.isArray(address)) {
      return new Response(
        JSON.stringify({ error: "Parâmetros de cotação incompletos ou não confirmados." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate Limiting / Proteção de Rajada
    const rateLimitKey = slug.toLowerCase();
    if (!checkRateLimit(rateLimitKey)) {
      return new Response(
        JSON.stringify({ error: "Limite de solicitações de frete excedido. Aguarde alguns instantes." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const keys = ["street", "number", "neighborhood", "city", "state", "zipCode"];
    if (keys.some(k => typeof address[k] !== "string" || !address[k].trim() || address[k].length > 200 || address[k].includes("|")) || !/^[A-Z]{2}$/.test(address.state) || !/^\d{8}$/.test(address.zipCode)) {
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
    if (!secretKey) secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !secretKey) throw new Error("ROUTING_CONFIGURATION_MISSING");

    const supabaseAdmin = createClient(supabaseUrl, secretKey, {
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
    if (!settings.estimateEnabled) throw new Error("ROUTING_DISABLED_BY_TENANT");
    const { data: methodsRow, error: methodsError } = await supabaseAdmin.from("tenant_public_settings")
      .select("delivery_methods").eq("tenant_id", tenantData.id).maybeSingle();
    if (methodsError || !Array.isArray(methodsRow?.delivery_methods) || !methodsRow.delivery_methods.includes(method))
      throw new Error("DELIVERY_METHOD_NOT_ALLOWED");
    const origin = settings.origin;

    if (!origin || typeof origin !== "object" ||
        keys.some(k => typeof origin[k] !== "string" || !origin[k].trim() || origin[k].length > 200 || origin[k].includes("|")) ||
        !/^[A-Z]{2}$/.test(origin.state) || !/^\d{8}$/.test(origin.zipCode)) {
      return new Response(
        JSON.stringify({ error: "Endereço de saída da loja não cadastrado." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Determina tarifa por km
    let centsPerKm = settings.carCentsPerKm;
    if (method === "uber_moto") {
      centsPerKm = settings.motoCentsPerKm;
    } else if (method === "uber_carro" || method === "entrega") {
      centsPerKm = settings.carCentsPerKm;
    }

    const originStr = `${origin.street}, ${origin.number} - ${origin.neighborhood}, ${origin.city} - ${origin.state}, ${origin.zipCode}`;
    const destinationStr = `${address.street}, ${address.number} - ${address.neighborhood}, ${address.city} - ${address.state}, ${address.zipCode}`;

    const normOrigin = originStr.trim().toLowerCase().replace(/\s+/g, " ");
    const normDest = destinationStr.trim().toLowerCase().replace(/\s+/g, " ");

    // 3. Obtenção da distância via Google Routes ou Mock de Teste
    const googleKey = Deno.env.get("GOOGLE_ROUTES_API_KEY") || "";
    let distanceMeters = 0;

    // No synthetic distance or bypass of project-wide quota in any deployable code.
    if (!googleKey || googleKey === "mock-key") throw new Error("GOOGLE_ROUTES_KEY_MISSING");
    getQuoteHmacSecret();
    estimatedFreightCents(1, centsPerKm);
    distanceMeters = await computeGoogleRoadDistance({
      origin: originStr,
      destination: destinationStr,
      apiKey: googleKey,
      deploymentApproved: true,
      reserveAttempt: async () => {
        const reservation = await supabaseAdmin.rpc("reserve_google_routes_attempt");
        if (reservation.error) return false;
        return reservation.data === true;
      },
    });

    const freightCents = estimatedFreightCents(distanceMeters, centsPerKm);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutos

    // 4. Criação do Token Assinado de Cotação Autoritativa (com origem e destino normalizados vinculados)
    const canonicalQuoteStr = `${slug.trim().toLowerCase()}|${method.trim().toLowerCase()}|${normOrigin}|${normDest}|${distanceMeters}|${centsPerKm}|${freightCents}|${expiresAt}`;
    const hmacSecret = getQuoteHmacSecret();
    const signature = await signDeliveryQuote(canonicalQuoteStr, hmacSecret);
    const payloadBytes = new TextEncoder().encode(canonicalQuoteStr);
    const quoteToken = `${btoa(String.fromCharCode(...payloadBytes))}.${signature}`;

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
  } catch {
    return new Response(JSON.stringify({ error: "Frete indisponível. Confira o endereço ou tente novamente." }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
