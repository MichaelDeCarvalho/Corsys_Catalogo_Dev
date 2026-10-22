import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HEX_64_REGEX = /^[a-f0-9]{64}$/;

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

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return new Response(
      JSON.stringify({ error: "Content-Type deve ser application/json." }),
      { status: 415, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const rawBody = await req.text();
    const rawBodyByteLength = new TextEncoder().encode(rawBody).byteLength;
    if (rawBodyByteLength > 4096) {
      return new Response(
        JSON.stringify({ error: "Tamanho de requisição excede o limite permitido (4 KB)." }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody || "{}");
    } catch {
      return new Response(
        JSON.stringify({ error: "JSON malformado no corpo da requisição." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return new Response(
        JSON.stringify({ error: "Corpo da requisição deve ser um objeto JSON." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validação estrita de allowlist de chaves (defense-in-depth)
    const allowedKeys = ["tenantSlug", "trackingToken"];
    const payloadKeys = Object.keys(payload);
    const hasForbiddenKeys = payloadKeys.some((k) => !allowedKeys.includes(k)) || payloadKeys.length !== 2;
    if (hasForbiddenKeys) {
      return new Response(
        JSON.stringify({ error: "Corpo da requisição deve conter exclusivamente tenantSlug e trackingToken." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { tenantSlug, trackingToken } = payload;

    if (typeof tenantSlug !== "string" || !tenantSlug.trim() || tenantSlug.trim().length > 120) {
      return new Response(
        JSON.stringify({ error: "Identificador da loja (tenantSlug) inválido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (typeof trackingToken !== "string" || !HEX_64_REGEX.test(trackingToken.trim().toLowerCase())) {
      return new Response(
        JSON.stringify({ error: "Token de rastreamento inválido (deve possuir 64 caracteres hexadecimais)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calcula o SHA-256 do token recebido (sem logging de token raw ou hash)
    const cleanToken = trackingToken.trim().toLowerCase();
    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cleanToken));
    const tokenHashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

    // Configuração do Supabase Admin
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const rawSecretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");

    if (!supabaseUrl || !rawSecretKeys) {
      console.error("[track-order-by-token] Configuração do servidor incompleta.");
      return new Response(
        JSON.stringify({ error: "Serviço de rastreamento indisponível no momento." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let secretKey = "";
    try {
      const parsedKeys = JSON.parse(rawSecretKeys);
      secretKey = typeof parsedKeys?.default === "string" ? parsedKeys.default : "";
      if (!secretKey) throw new Error("Chave default ausente");
    } catch {
      console.error("[track-order-by-token] Falha ao processar chaves do servidor.");
      return new Response(
        JSON.stringify({ error: "Serviço de rastreamento indisponível no momento." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: orderData, error: rpcError } = await supabaseAdmin.rpc(
      "track_order_by_token_internal",
      {
        p_tenant_slug: tenantSlug.trim(),
        p_tracking_token_hash: tokenHashHex,
      }
    );

    if (rpcError) {
      return new Response(
        JSON.stringify({ error: "Pedido não encontrado." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!orderData) {
      return new Response(
        JSON.stringify({ error: "Pedido não encontrado." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Sanitização defensiva explícita (allowlist de campos públicos)
    const sanitizedOrder = {
      orderNumber: orderData.orderNumber,
      status: orderData.status,
      shoppingMode: orderData.shoppingMode,
      deliveryMethod: orderData.deliveryMethod,
      paymentMethod: orderData.paymentMethod,
      items: orderData.items,
      subtotal: orderData.subtotal,
      discount: orderData.discount,
      shippingFee: orderData.shippingFee,
      total: orderData.total,
      createdAt: orderData.createdAt,
      updatedAt: orderData.updatedAt,
    };

    return new Response(
      JSON.stringify({
        success: true,
        order: sanitizedOrder,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[track-order-by-token] Erro inesperado:", err);
    return new Response(
      JSON.stringify({ error: "Erro interno no servidor ao consultar o pedido." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
