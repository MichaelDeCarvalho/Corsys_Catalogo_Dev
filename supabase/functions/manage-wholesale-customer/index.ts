import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

  try {
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
      console.error("[manage-wholesale-customer] Chaves de ambiente do Supabase ausentes.");
      return new Response(
        JSON.stringify({ error: "Serviço indisponível no momento." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Validação do Usuário Autenticado via JWT
    const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: userData, error: userAuthErr } = await supabaseUserClient.auth.getUser();
    if (userAuthErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Sessão inválida ou expirada." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const callerId = userData.user.id;
    const rawBody = await req.text();
    const payload = JSON.parse(rawBody || "{}");

    const { customerId, action } = payload;
    if (!customerId || typeof customerId !== "string") {
      return new Response(
        JSON.stringify({ error: "Identificador do cliente (customerId) é obrigatório." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const allowedActions = ["approve", "reject", "suspend", "reactivate"];
    if (!allowedActions.includes(action)) {
      return new Response(
        JSON.stringify({ error: `Ação inválida. Ações permitidas: ${allowedActions.join(", ")}.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cliente administrativo com privilégios de service_role para operações de sistema
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // 2. Consulta a solicitação B2B
    const { data: customer, error: customerErr } = await supabaseAdmin
      .from("wholesale_customers")
      .select("id, tenant_id, user_id, email, cnpj, legal_name, contact_name, status")
      .eq("id", customerId)
      .maybeSingle();

    if (customerErr || !customer) {
      return new Response(
        JSON.stringify({ error: "Registro de cliente atacadista não encontrado." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tenantId = customer.tenant_id;

    // 3. Autorização estrita do chamador: deve ser tenant_admin daquele tenant ou platform_admin
    const { data: adminRecord } = await supabaseAdmin
      .from("platform_admins")
      .select("id")
      .eq("id", callerId)
      .maybeSingle();

    const isPlatformAdmin = Boolean(adminRecord);

    if (!isPlatformAdmin) {
      const { data: membership, error: memberErr } = await supabaseAdmin
        .from("tenant_users")
        .select("id, role, active")
        .eq("id", callerId)
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .maybeSingle();

      if (memberErr || !membership || membership.role !== "tenant_admin") {
        return new Response(
          JSON.stringify({ error: "Acesso negado: apenas administradores da loja podem gerenciar clientes atacadistas." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // 4. Execução da Ação Solicitada (Lifecycle Management)
    if (action === "approve") {
      if (customer.status === "approved") {
        return new Response(
          JSON.stringify({ error: "Este cliente atacadista já se encontra aprovado." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let authUserId: string | null = customer.user_id;

      // Se ainda não tem user_id vinculado, cria o convite ou conta via Supabase Auth Admin
      if (!authUserId) {
        try {
          // Tenta convidar por e-mail via API oficial do Supabase Auth Admin
          const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(customer.email, {
            data: {
              account_type: "wholesale_customer",
              cnpj: customer.cnpj,
              company_name: customer.legal_name,
              contact_name: customer.contact_name,
              tenant_id: tenantId
            }
          });

          if (inviteErr) {
            // Verifica se o erro é de usuário já existente
            const errLower = (inviteErr.message || "").toLowerCase();
            if (errLower.includes("already registered") || errLower.includes("already exists") || errLower.includes("unique")) {
              return new Response(
                JSON.stringify({
                  error: "Este e-mail já possui uma conta no sistema. É necessário fluxo de vinculação pelo administrador ou suporte.",
                  code: "USER_ALREADY_EXISTS"
                }),
                { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            console.error("[manage-wholesale-customer] Falha ao convidar usuário auth:", inviteErr);
            return new Response(
              JSON.stringify({ error: `Falha ao criar credencial de acesso do cliente: ${inviteErr.message}` }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (!inviteData?.user?.id) {
            throw new Error("Supabase Auth Admin não retornou id do usuário convidado.");
          }

          authUserId = inviteData.user.id;
        } catch (authException: unknown) {
          const msg = authException instanceof Error ? authException.message : "Erro desconhecido";
          console.error("[manage-wholesale-customer] Exceção Auth Admin:", msg);
          return new Response(
            JSON.stringify({ error: `Falha ao processar conta de acesso: ${msg}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Atualiza o registro no banco somente após o sucesso do Auth Admin (FAIL-CLOSED)
      const { error: updateErr } = await supabaseAdmin
        .from("wholesale_customers")
        .update({
          status: "approved",
          user_id: authUserId,
          approved_at: new Date().toISOString(),
          approved_by: callerId
        })
        .eq("id", customerId);

      if (updateErr) {
        console.error("[manage-wholesale-customer] Erro ao atualizar status para approved:", updateErr);
        return new Response(
          JSON.stringify({ error: "Erro ao registrar aprovação no banco de dados." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Cliente atacadista aprovado com sucesso e convite de acesso enviado.",
          status: "approved",
          userId: authUserId
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "reject") {
      const { error: rejectErr } = await supabaseAdmin
        .from("wholesale_customers")
        .update({
          status: "rejected"
        })
        .eq("id", customerId);

      if (rejectErr) {
        return new Response(
          JSON.stringify({ error: "Erro ao rejeitar solicitação." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, message: "Solicitação atacadista rejeitada.", status: "rejected" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "suspend") {
      const { error: suspendErr } = await supabaseAdmin
        .from("wholesale_customers")
        .update({
          status: "suspended"
        })
        .eq("id", customerId);

      if (suspendErr) {
        return new Response(
          JSON.stringify({ error: "Erro ao suspender acesso atacadista." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, message: "Acesso atacadista do cliente foi suspenso.", status: "suspended" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "reactivate") {
      if (!customer.user_id) {
        return new Response(
          JSON.stringify({ error: "Não é possível reativar cliente sem conta de acesso vinculada." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: reactivateErr } = await supabaseAdmin
        .from("wholesale_customers")
        .update({
          status: "approved",
          approved_at: new Date().toISOString(),
          approved_by: callerId
        })
        .eq("id", customerId);

      if (reactivateErr) {
        return new Response(
          JSON.stringify({ error: "Erro ao reativar cliente atacadista." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, message: "Acesso atacadista reativado com sucesso.", status: "approved" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Ação não processada." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro inesperado";
    console.error("[manage-wholesale-customer] Exceção:", msg);
    return new Response(
      JSON.stringify({ error: "Erro interno no servidor." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
