import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Validação dos dígitos verificadores do CNPJ (Módulo 11)
 */
function isValidCnpj(cnpjDigits: string): boolean {
  if (cnpjDigits.length !== 14) return false;
  // Rejeita sequências com todos os dígitos iguais (ex: 00000000000000, 11111111111111)
  if (/^(\d)\1{13}$/.test(cnpjDigits)) return false;

  const weightsFirst = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weightsSecond = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(cnpjDigits[i], 10) * weightsFirst[i];
  }
  let remainder = sum % 11;
  const digit1 = remainder < 2 ? 0 : 11 - remainder;
  if (parseInt(cnpjDigits[12], 10) !== digit1) return false;

  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(cnpjDigits[i], 10) * weightsSecond[i];
  }
  remainder = sum % 11;
  const digit2 = remainder < 2 ? 0 : 11 - remainder;
  return parseInt(cnpjDigits[13], 10) === digit2;
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
    const rawBody = await req.text();
    // Proteção de tamanho de payload (máximo 32 KB)
    if (rawBody.length > 32768) {
      return new Response(
        JSON.stringify({ error: "Tamanho de requisição excede o limite permitido." }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload = JSON.parse(rawBody);

    // 1. Defesa Anti-Abuso: Honeypot check
    if (payload.website || payload._honeypot || payload.fax) {
      // Falha silenciosa para bots de spam
      return new Response(
        JSON.stringify({ success: true, message: "Solicitação recebida com sucesso." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Resolução do Tenant via slug (nunca aceita tenant_id arbitrário do browser)
    const tenantSlug = typeof payload.tenantSlug === "string" ? payload.tenantSlug.trim() : "";
    if (!tenantSlug) {
      return new Response(
        JSON.stringify({ error: "Identificador da loja (tenantSlug) é obrigatório." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[submit-wholesale-application] Chaves de ambiente do Supabase ausentes.");
      return new Response(
        JSON.stringify({ error: "Serviço indisponível no momento." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // Consulta configurações e status da loja
    const { data: tenantData, error: tenantErr } = await supabaseAdmin
      .from("tenants")
      .select("id, status")
      .eq("slug", tenantSlug)
      .maybeSingle();

    if (tenantErr || !tenantData) {
      return new Response(
        JSON.stringify({ error: "Loja não encontrada." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (tenantData.status !== "active") {
      return new Response(
        JSON.stringify({ error: "Esta loja não está ativa para novos cadastros." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tenantId = tenantData.id;

    // Verifica se allow_b2b_mode está habilitado nas configurações da loja
    const { data: settingsData } = await supabaseAdmin
      .from("tenant_public_settings")
      .select("allow_b2b_mode")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (settingsData && settingsData.allow_b2b_mode === false) {
      return new Response(
        JSON.stringify({ error: "A modalidade atacadista não está habilitada para esta loja." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Normalização e Validação Estrita do CNPJ
    const rawCnpj = typeof payload.cnpj === "string" ? payload.cnpj : "";
    const normalizedCnpj = rawCnpj.replace(/\D/g, "");

    if (normalizedCnpj.length !== 14) {
      return new Response(
        JSON.stringify({ error: "CNPJ inválido. Deve conter exatamente 14 dígitos numéricos." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!isValidCnpj(normalizedCnpj)) {
      return new Response(
        JSON.stringify({ error: "Dígitos verificadores do CNPJ são inválidos." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Validação dos Campos de Cadastro
    const legalName = typeof payload.legalName === "string" ? payload.legalName.trim().slice(0, 150) : "";
    if (legalName.length < 3) {
      return new Response(
        JSON.stringify({ error: "Razão Social é obrigatória (mínimo 3 caracteres)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tradeName = typeof payload.tradeName === "string" ? payload.tradeName.trim().slice(0, 150) : null;

    const contactName = typeof payload.contactName === "string" ? payload.contactName.trim().slice(0, 100) : "";
    if (contactName.length < 2) {
      return new Response(
        JSON.stringify({ error: "Nome do responsável é obrigatório." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawEmail = typeof payload.email === "string" ? payload.email.trim().toLowerCase().slice(0, 100) : "";
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(rawEmail)) {
      return new Response(
        JSON.stringify({ error: "E-mail de contato informado é inválido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawPhone = typeof payload.phone === "string" ? payload.phone.trim().slice(0, 25) : "";
    const phoneDigits = rawPhone.replace(/\D/g, "");
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      return new Response(
        JSON.stringify({ error: "Telefone/WhatsApp deve conter DDD e número válido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const city = typeof payload.city === "string" ? payload.city.trim().slice(0, 100) : null;
    const state = typeof payload.state === "string" ? payload.state.trim().toUpperCase().slice(0, 2) : null;

    // 5. Prevenção de Duplicidade (Segurança e Mensagem Neutra)
    const { data: existingCustomer } = await supabaseAdmin
      .from("wholesale_customers")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .eq("cnpj", normalizedCnpj)
      .maybeSingle();

    if (existingCustomer) {
      return new Response(
        JSON.stringify({
          error: "Já existe uma solicitação para este CNPJ. Entre em contato com a loja caso precise de ajuda.",
          code: "CNPJ_ALREADY_REGISTERED"
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Inserção Segura (Status strictly pending, sem mass assignment)
    const { error: insertErr } = await supabaseAdmin
      .from("wholesale_customers")
      .insert({
        tenant_id: tenantId,
        cnpj: normalizedCnpj,
        legal_name: legalName,
        trade_name: tradeName,
        contact_name: contactName,
        email: rawEmail,
        phone: rawPhone,
        city: city,
        state: state,
        status: "pending"
      });

    if (insertErr) {
      console.error("[submit-wholesale-application] Erro no banco ao criar solicitação:", insertErr);
      return new Response(
        JSON.stringify({ error: "Erro ao registrar solicitação. Tente novamente mais tarde." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Solicitação de cadastro atacadista enviada com sucesso! Sua empresa está em análise."
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Falha interna ao processar requisição.";
    console.error("[submit-wholesale-application] Exceção não tratada:", errorMsg);
    return new Response(
      JSON.stringify({ error: "Erro interno no servidor." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
