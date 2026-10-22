import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Campos terminantemente proibidos no corpo da requisição do browser
const FORBIDDEN_BODY_FIELDS = [
  "userId",
  "buyerUserId",
  "tenantId",
  "wholesalePrice",
  "price",
  "role",
  "user_id",
  "tenant_id",
  "costPrice",
  "cost_price"
];

// Expressão regular canônica para validação estrita de UUID v4
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    // 1. Defesa em Profundidade: Validação estrita do token Bearer
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Autenticação obrigatória para acesso ao catálogo de atacado." }),
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

    // 2. Resolução segura de chaves modernas do Supabase (SUPABASE_SECRET_KEYS)
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const rawSecretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");

    if (!supabaseUrl || !rawSecretKeys) {
      console.error("[get-wholesale-catalog] Configuração de servidor incompleta.");
      return new Response(
        JSON.stringify({ error: "Serviço indisponível no momento." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let secretKey = "";
    try {
      const parsedKeys = JSON.parse(rawSecretKeys);
      secretKey = typeof parsedKeys?.default === "string" ? parsedKeys.default : "";
      if (!secretKey) throw new Error("Chave default ausente");
    } catch {
      console.error("[get-wholesale-catalog] Falha ao processar chaves de autenticação do servidor.");
      return new Response(
        JSON.stringify({ error: "Serviço indisponível no momento." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // 3. Validação do usuário através da API Auth do Supabase
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData?.user?.id) {
      return new Response(
        JSON.stringify({ error: "Sessão de autenticação inválida ou expirada." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Identidade oficial estritamente derivada do token validado server-side
    const validatedUserId = userData.user.id;

    // 4. Limitação estrita do tamanho do payload (máximo 4 KB)
    const rawBody = await req.text();
    const byteLength = new TextEncoder().encode(rawBody).byteLength;
    if (byteLength > 4096) {
      return new Response(
        JSON.stringify({ error: "Tamanho de requisição excede o limite permitido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let body: Record<string, unknown> = {};
    try {
      body = rawBody.trim() ? JSON.parse(rawBody) : {};
    } catch {
      return new Response(
        JSON.stringify({ error: "Corpo da requisição deve ser um JSON válido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return new Response(
        JSON.stringify({ error: "Corpo da requisição deve ser um objeto JSON." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Allowlist estrita: o body DEVE conter exclusivamente a propriedade "tenantSlug"
    for (const forbiddenKey of FORBIDDEN_BODY_FIELDS) {
      if (forbiddenKey in body) {
        return new Response(
          JSON.stringify({ error: `Parâmetro proibido detectado: ${forbiddenKey}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const bodyKeys = Object.keys(body);
    if (bodyKeys.length !== 1 || bodyKeys[0] !== "tenantSlug") {
      return new Response(
        JSON.stringify({ error: "Corpo da requisição contém campos não permitidos." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tenantSlug = typeof body.tenantSlug === "string" ? body.tenantSlug.trim() : "";
    if (!tenantSlug) {
      return new Response(
        JSON.stringify({ error: "Identificador da loja (tenantSlug) é obrigatório." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (tenantSlug.length > 120) {
      return new Response(
        JSON.stringify({ error: "Identificador da loja inválido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Chamada à RPC Interna com service_role
    const { data: catalogItems, error: rpcError } = await supabaseAdmin.rpc(
      "get_wholesale_catalog_internal",
      {
        p_tenant_slug: tenantSlug,
        p_user_id: validatedUserId,
      }
    );

    if (rpcError) {
      const code = rpcError.code || "";
      if (code === "42501") {
        return new Response(
          JSON.stringify({ error: rpcError.message || "Acesso atacadista não autorizado." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (code === "P0002") {
        return new Response(
          JSON.stringify({ error: "Loja não encontrada ou inativa." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (code === "22000") {
        return new Response(
          JSON.stringify({ error: "Parâmetros inválidos." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.warn(`[get-wholesale-catalog] Erro na RPC [Code: ${code}]`);
      return new Response(
        JSON.stringify({ error: "Não foi possível carregar o catálogo atacadista." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Projeção sanitizada com validação fail-closed estrita por linha
    if (!Array.isArray(catalogItems)) {
      console.error("[get-wholesale-catalog] Resposta da RPC interna não é um array.");
      return new Response(
        JSON.stringify({ error: "Não foi possível carregar o catálogo atacadista." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const items: Array<{
      productId: string;
      sku: string;
      wholesalePrice: number;
      wholesaleMinQuantity: number;
    }> = [];

    for (let i = 0; i < catalogItems.length; i++) {
      const row = catalogItems[i];
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        console.error(`[get-wholesale-catalog] Linha ${i} inválida (não-objeto).`);
        return new Response(
          JSON.stringify({ error: "Não foi possível carregar o catálogo atacadista." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const prodId = typeof row.product_id === "string" ? row.product_id.trim() : "";
      if (!prodId || !UUID_REGEX.test(prodId)) {
        console.error(`[get-wholesale-catalog] Linha ${i} com product_id inválido.`);
        return new Response(
          JSON.stringify({ error: "Não foi possível carregar o catálogo atacadista." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const sku = typeof row.sku === "string" ? row.sku.trim() : "";
      if (!sku || sku.length > 64) {
        console.error(`[get-wholesale-catalog] Linha ${i} com sku inválido.`);
        return new Response(
          JSON.stringify({ error: "Não foi possível carregar o catálogo atacadista." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const rawPrice = row.wholesale_price;
      const numPrice = typeof rawPrice === "number" ? rawPrice : (typeof rawPrice === "string" && rawPrice.trim() !== "" ? Number(rawPrice) : NaN);
      if (!Number.isFinite(numPrice) || numPrice <= 0) {
        console.error(`[get-wholesale-catalog] Linha ${i} com wholesale_price inválido.`);
        return new Response(
          JSON.stringify({ error: "Não foi possível carregar o catálogo atacadista." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const rawMinQty = row.wholesale_min_quantity;
      const numMinQty = typeof rawMinQty === "number" ? rawMinQty : (typeof rawMinQty === "string" && rawMinQty.trim() !== "" ? Number(rawMinQty) : NaN);
      if (!Number.isInteger(numMinQty) || numMinQty < 1) {
        console.error(`[get-wholesale-catalog] Linha ${i} com wholesale_min_quantity inválido.`);
        return new Response(
          JSON.stringify({ error: "Não foi possível carregar o catálogo atacadista." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      items.push({
        productId: prodId,
        sku,
        wholesalePrice: numPrice,
        wholesaleMinQuantity: numMinQty
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        items
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch {
    console.error("[get-wholesale-catalog] Exceção interna não tratada.");
    return new Response(
      JSON.stringify({ error: "Erro interno ao processar catálogo atacadista." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
