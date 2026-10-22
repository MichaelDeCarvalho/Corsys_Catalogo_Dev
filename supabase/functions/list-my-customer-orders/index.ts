import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    // 1. Autenticação obrigatória do Comprador via Bearer token
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Autenticação obrigatória para consultar histórico de pedidos." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Token de autenticação inválido ou vazio." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // Allowlist estrita de chaves de requisição (rejeita expressamente userId, buyerUserId, tenantId, email, role, etc)
    const allowedKeys = ["tenantSlug", "limit", "offset"];
    const payloadKeys = Object.keys(payload);
    const hasForbiddenKeys = payloadKeys.some((k) => !allowedKeys.includes(k));
    if (hasForbiddenKeys) {
      return new Response(
        JSON.stringify({ error: "Corpo da requisição contém campos não permitidos." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { tenantSlug } = payload;
    if (typeof tenantSlug !== "string" || !tenantSlug.trim() || tenantSlug.trim().length > 120) {
      return new Response(
        JSON.stringify({ error: "Identificador da loja (tenantSlug) inválido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const limit = typeof payload.limit === "number" && Number.isInteger(payload.limit) && payload.limit >= 1 && payload.limit <= 50
      ? payload.limit
      : 20;

    const offset = typeof payload.offset === "number" && Number.isInteger(payload.offset) && payload.offset >= 0
      ? payload.offset
      : 0;

    // Configuração do Supabase Admin
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const rawSecretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");

    if (!supabaseUrl || !rawSecretKeys) {
      console.error("[list-my-customer-orders] Configuração do servidor incompleta.");
      return new Response(
        JSON.stringify({ error: "Serviço de histórico de pedidos indisponível no momento." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let secretKey = "";
    try {
      const parsedKeys = JSON.parse(rawSecretKeys);
      secretKey = typeof parsedKeys?.default === "string" ? parsedKeys.default : "";
      if (!secretKey) throw new Error("Chave default ausente");
    } catch {
      console.error("[list-my-customer-orders] Falha ao processar chaves do servidor.");
      return new Response(
        JSON.stringify({ error: "Serviço de histórico de pedidos indisponível no momento." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 2. Validação rigorosa do token do comprador e extração server-side do buyerUserId
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData?.user?.id) {
      return new Response(
        JSON.stringify({ error: "Sessão de autenticação inválida ou expirada." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const buyerUserId = userData.user.id;

    // 3. Consulta da RPC interna com service_role
    const { data: listResult, error: rpcError } = await supabaseAdmin.rpc(
      "list_my_customer_orders_internal",
      {
        p_tenant_slug: tenantSlug.trim(),
        p_buyer_user_id: buyerUserId,
        p_limit: limit,
        p_offset: offset,
      }
    );

    if (rpcError) {
      const errorCode = rpcError.code || "";
      if (errorCode === "P0002") {
        return new Response(
          JSON.stringify({ error: "Loja não encontrada." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "Erro ao consultar histórico de pedidos." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Sanitização defensiva explícita para cada item retornado
    const rawOrders = Array.isArray(listResult?.orders) ? listResult.orders : [];
    const sanitizedOrders = rawOrders.map((ord: Record<string, unknown>) => ({
      orderNumber: ord.orderNumber,
      status: ord.status,
      shoppingMode: ord.shoppingMode,
      deliveryMethod: ord.deliveryMethod,
      paymentMethod: ord.paymentMethod,
      items: ord.items,
      subtotal: ord.subtotal,
      discount: ord.discount,
      shippingFee: ord.shippingFee,
      total: ord.total,
      createdAt: ord.createdAt,
      updatedAt: ord.updatedAt,
    }));

    return new Response(
      JSON.stringify({
        success: true,
        orders: sanitizedOrders,
        total: typeof listResult?.total === "number" ? listResult.total : sanitizedOrders.length,
        limit,
        offset,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[list-my-customer-orders] Erro inesperado:", err);
    return new Response(
      JSON.stringify({ error: "Erro interno no servidor ao consultar o histórico." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
