import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Validação rigorosa de UUID (RFC 4122)
 */
function isValidUuid(uuid: unknown): boolean {
  if (typeof uuid !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid.trim());
}

const ALLOWED_STATUSES = ["pending", "approved", "preparing", "dispatched", "delivered", "cancelled"] as const;
type AllowedStatus = typeof ALLOWED_STATUSES[number];

serve(async (req: Request) => {
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
    // 1. Validação de Autenticação do Operador via JWT
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Token de autorização ausente ou inválido." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[manage-order-status] Variáveis de ambiente Supabase ausentes.");
      return new Response(
        JSON.stringify({ error: "Serviço temporariamente indisponível." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validação da sessão do operador no contexto Auth
    const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userAuthErr } = await supabaseUserClient.auth.getUser();
    if (userAuthErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Sessão inválida ou expirada." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Identidade do operador derivada estritamente do token server-side
    const actorUserId = userData.user.id;

    // 2. Leitura com Limite Estrito de Tamanho (máx 4096 bytes)
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
        JSON.stringify({ error: "Payload JSON malformado." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return new Response(
        JSON.stringify({ error: "Payload deve ser um objeto JSON." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Validação Estrita de Chaves (SOMENTE orderId e newStatus)
    const allowedKeys = ["orderId", "newStatus"];
    const bodyKeys = Object.keys(payload);
    const hasOnlyAllowedKeys =
      bodyKeys.length === 2 &&
      bodyKeys.every((k) => allowedKeys.includes(k));

    if (!hasOnlyAllowedKeys) {
      return new Response(
        JSON.stringify({
          error: "Payload inválido. Deve conter estritamente as chaves 'orderId' e 'newStatus'.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { orderId, newStatus } = payload;

    if (!orderId || !isValidUuid(orderId)) {
      return new Response(
        JSON.stringify({ error: "Identificador de pedido (orderId) inválido ou ausente." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (
      !newStatus ||
      typeof newStatus !== "string" ||
      !ALLOWED_STATUSES.includes(newStatus as AllowedStatus)
    ) {
      return new Response(
        JSON.stringify({
          error: `Status inválido. Status permitidos: ${ALLOWED_STATUSES.join(", ")}.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Invocação da RPC Interna com service_role
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc(
      "manage_order_status_internal",
      {
        p_order_id: orderId,
        p_new_status: newStatus,
        p_actor_user_id: actorUserId,
      }
    );

    if (rpcErr) {
      console.warn("[manage-order-status] Erro retornado pela RPC:", rpcErr);

      const code = rpcErr.code;
      const message = rpcErr.message || "Erro ao processar transição de status.";

      if (code === "42501") {
        return new Response(
          JSON.stringify({ error: "Acesso não autorizado para gerenciar pedidos deste tenant." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (code === "P0002") {
        return new Response(
          JSON.stringify({ error: message.includes("Produto") ? message : "Pedido não encontrado." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (code === "55P03") {
        return new Response(
          JSON.stringify({ error: message }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (code === "55000" || code === "22000") {
        return new Response(
          JSON.stringify({ error: message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        order: rpcResult,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[manage-order-status] Erro inesperado:", err);
    return new Response(
      JSON.stringify({ error: "Erro interno no servidor ao processar o pedido." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
