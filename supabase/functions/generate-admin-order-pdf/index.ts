import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { generateOrderPdf } from "../_shared/orderPdf.ts";

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
    // 1. Validação de Autenticação do Usuário via JWT
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
      console.error("[generate-admin-order-pdf] Variáveis de ambiente Supabase ausentes.");
      return new Response(
        JSON.stringify({ error: "Serviço temporariamente indisponível." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validação da sessão autenticada
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

    // 3. Validação Estrita de Chaves (SOMENTE orderId)
    const allowedKeys = ["orderId"];
    const bodyKeys = Object.keys(payload);
    const hasOnlyAllowedKeys =
      bodyKeys.length === 1 &&
      bodyKeys[0] === "orderId";

    if (!hasOnlyAllowedKeys) {
      return new Response(
        JSON.stringify({
          error: "Payload inválido. Deve conter estritamente a chave 'orderId'.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { orderId } = payload;
    if (!orderId || !isValidUuid(orderId)) {
      return new Response(
        JSON.stringify({ error: "Identificador de pedido (orderId) inválido ou ausente." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. AUTORIZAÇÃO DE LEITURA VIA RLS:
    // O pedido é consultado no contexto do JWT do usuário (supabaseUserClient).
    // NÃO usar service_role para essa leitura; a RLS do PostgreSQL decide a autorização.
    // sales_rep autorizado pela RLS pode ler e gerar PDF.
    const { data: order, error: orderErr } = await supabaseUserClient
      .from("orders")
      .select(`
        id,
        tenant_id,
        order_number,
        shopping_mode,
        status,
        payment_method,
        delivery_method,
        subtotal,
        discount,
        shipping_fee,
        total,
        created_at,
        customer,
        shipping_address,
        items,
        notes,
        seller_code
      `)
      .eq("id", orderId)
      .maybeSingle();

    if (orderErr || !order) {
      // Resposta sanitizada 404 sem revelar se o pedido pertence a outro tenant
      return new Response(
        JSON.stringify({ error: "Pedido não encontrado ou acesso não autorizado." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. SERVICE ROLE SOMENTE APÓS LEITURA AUTORIZADA
    // Utilizado estritamente para buscar branding público, upload no bucket privado e gerar signed URL
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: branding } = await supabaseAdmin
      .from("tenant_public_settings")
      .select("public_name, logo_url, primary_color, accent_color")
      .eq("tenant_id", order.tenant_id)
      .maybeSingle();

    // 6. Geração dos bytes do PDF via helper oficial compartilhado
    const pdfBytes = await generateOrderPdf(order, branding || {});

    // 7. Upload idempotente no bucket privado 'order-documents'
    const canonicalPdfPath = `${order.tenant_id}/orders/${order.id}/pedido-${order.order_number}.pdf`;
    const { error: uploadErr } = await supabaseAdmin.storage
      .from("order-documents")
      .upload(canonicalPdfPath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) {
      console.error("[generate-admin-order-pdf] Erro no upload do PDF:", uploadErr);
      return new Response(
        JSON.stringify({ error: "Falha ao armazenar documento do pedido." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 8. Criação de Signed URL com TTL de EXATAMENTE 600 segundos (10 minutos)
    const { data: signedData, error: signErr } = await supabaseAdmin.storage
      .from("order-documents")
      .createSignedUrl(canonicalPdfPath, 600);

    if (signErr || !signedData?.signedUrl) {
      return new Response(
        JSON.stringify({ error: "Falha ao gerar link seguro para o documento." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 9. Resposta sanitizada com TTL de 600s (nunca logar a signed URL)
    return new Response(
      JSON.stringify({
        success: true,
        orderNumber: order.order_number,
        documentUrl: signedData.signedUrl,
        expiresIn: 600,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[generate-admin-order-pdf] Erro inesperado:", err);
    return new Response(
      JSON.stringify({ error: "Erro interno no servidor ao processar o documento do pedido." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
