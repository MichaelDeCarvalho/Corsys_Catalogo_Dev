import { createClient } from "npm:@supabase/supabase-js@2";
import { generateOrderPdf } from "../_shared/orderPdf.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Validação estrita de UUID v4 (versão 4, variante RFC 4122)
 */
function isValidUuidV4(uuid: unknown): boolean {
  if (typeof uuid !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid.trim());
}

/**
 * Validação de UUID genérico para identificadores
 */
function isValidUuid(uuid: unknown): boolean {
  if (typeof uuid !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid.trim());
}

/**
 * Validação rigorosa de CPF brasileiro (módulo 11)
 */
function isValidCPF(cpf: unknown): boolean {
  if (typeof cpf !== "string") return false;
  const clean = cpf.replace(/\D/g, "");
  if (clean.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(clean)) return false;

  const digits = clean.split("").map(Number);
  let sum1 = 0;
  for (let i = 0; i < 9; i++) {
    sum1 += digits[i] * (10 - i);
  }
  const rem1 = (sum1 * 10) % 11;
  const expected1 = rem1 === 10 || rem1 === 11 ? 0 : rem1;
  if (digits[9] !== expected1) return false;

  let sum2 = 0;
  for (let i = 0; i < 10; i++) {
    sum2 += digits[i] * (11 - i);
  }
  const rem2 = (sum2 * 10) % 11;
  const expected2 = rem2 === 10 || rem2 === 11 ? 0 : rem2;
  if (digits[10] !== expected2) return false;

  return true;
}

/**
 * Validação rigorosa de CNPJ brasileiro (módulo 11)
 */
function isValidCNPJ(cnpj: unknown): boolean {
  if (typeof cnpj !== "string") return false;
  const clean = cnpj.replace(/\D/g, "");
  if (clean.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(clean)) return false;

  const digits = clean.split("").map(Number);
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum1 = 0;
  for (let i = 0; i < 12; i++) {
    sum1 += digits[i] * weights1[i];
  }
  const rem1 = sum1 % 11;
  const expected1 = rem1 < 2 ? 0 : 11 - rem1;
  if (digits[12] !== expected1) return false;

  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum2 = 0;
  for (let i = 0; i < 13; i++) {
    sum2 += digits[i] * weights2[i];
  }
  const rem2 = sum2 % 11;
  const expected2 = rem2 < 2 ? 0 : 11 - rem2;
  if (digits[13] !== expected2) return false;

  return true;
}

// Lista de campos com autoridade financeira ou sensível que NUNCA devem ser enviados pelo cliente
const FORBIDDEN_BODY_FIELDS = [
  "subtotal",
  "total",
  "discount",
  "shippingFee",
  "shipping_fee",
  "unitPrice",
  "totalPrice",
  "wholesalePrice",
  "buyerUserId",
  "buyer_user_id",
];

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

  // 1. Feature Gate Fail-Closed: CHECKOUT_ENABLED ausente ou false bloqueia com 503
  const checkoutEnabled = Deno.env.get("CHECKOUT_ENABLED") === "true";
  if (!checkoutEnabled) {
    return new Response(
      JSON.stringify({ error: "Checkout temporariamente indisponível." }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
    // Proteção de tamanho de payload por contagem de bytes UTF-8 (máximo 64 KB)
    const rawBodyByteLength = new TextEncoder().encode(rawBody).byteLength;
    if (rawBodyByteLength > 64 * 1024) {
      return new Response(
        JSON.stringify({ error: "Tamanho de requisição excede o limite permitido (64 KB)." }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
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

    // 2. Defesa Anti-Abuso: Honeypot check
    if (payload.website || payload._honeypot || payload.fax) {
      return new Response(
        JSON.stringify({ success: true, message: "Pedido processado com sucesso." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Rejeição de Autoridade Financeira e Campos Sensíveis no Body
    for (const field of FORBIDDEN_BODY_FIELDS) {
      if (field in payload) {
        return new Response(
          JSON.stringify({ error: `Campo não permitido no corpo da requisição: ${field}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // 4. Validação e Whitelist do tenantSlug
    if (typeof payload.tenantSlug !== "string") {
      return new Response(
        JSON.stringify({ error: "Identificador da loja (tenantSlug) deve ser texto." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const tenantSlug = payload.tenantSlug.trim();
    if (!tenantSlug || tenantSlug.length > 120) {
      return new Response(
        JSON.stringify({ error: "Identificador da loja (tenantSlug) inválido ou excede 120 caracteres." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Validação Estrita de UUID v4 para Idempotência
    if (typeof payload.idempotencyKey !== "string") {
      return new Response(
        JSON.stringify({ error: "Chave de idempotência (idempotencyKey) deve ser texto." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const idempotencyKey = payload.idempotencyKey.trim();
    if (!idempotencyKey || !isValidUuidV4(idempotencyKey)) {
      return new Response(
        JSON.stringify({ error: "Chave de idempotência (idempotencyKey UUID v4) é obrigatória e deve ser válida." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Modalidade de Compra
    if (payload.shoppingMode !== undefined && typeof payload.shoppingMode !== "string") {
      return new Response(
        JSON.stringify({ error: "Modalidade de compra deve ser texto." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const shoppingMode = typeof payload.shoppingMode === "string" ? payload.shoppingMode.trim() : "retail";
    if (shoppingMode !== "retail" && shoppingMode !== "wholesale") {
      return new Response(
        JSON.stringify({ error: "Modalidade de compra inválida (deve ser 'retail' ou 'wholesale')." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Validação e Whitelist de Itens
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      return new Response(
        JSON.stringify({ error: "O pedido deve conter pelo menos um item." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (payload.items.length > 200) {
      return new Response(
        JSON.stringify({ error: "O pedido excede o limite máximo permitido de 200 itens." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sanitizedItems = [];
    for (const rawItem of payload.items) {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
        return new Response(
          JSON.stringify({ error: "Cada item do pedido deve ser um objeto JSON válido." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Rejeita campos financeiros dentro de itens
      for (const field of FORBIDDEN_BODY_FIELDS) {
        if (field in (rawItem as Record<string, unknown>)) {
          return new Response(
            JSON.stringify({ error: `Campo não permitido no item: ${field}` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      const itemRecord = rawItem as Record<string, unknown>;
      const productId = typeof itemRecord.productId === "string" ? itemRecord.productId.trim() : "";
      if (!productId || !isValidUuid(productId)) {
        return new Response(
          JSON.stringify({ error: "Identificador de produto inválido no item." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const quantity = itemRecord.quantity;
      if (
        typeof quantity !== "number" ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 2147483647
      ) {
        return new Response(
          JSON.stringify({ error: "Quantidade de item deve ser um número inteiro positivo entre 1 e 2147483647." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let selectedVariant: string | null = null;
      if (itemRecord.selectedVariant !== undefined && itemRecord.selectedVariant !== null) {
        if (typeof itemRecord.selectedVariant !== "string") {
          return new Response(
            JSON.stringify({ error: "Variante do produto deve ser uma string." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        selectedVariant = itemRecord.selectedVariant.trim();
        if (selectedVariant.length > 160) {
          return new Response(
            JSON.stringify({ error: "Variante do produto excede o limite máximo de 160 caracteres." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (selectedVariant.length === 0) {
          selectedVariant = null;
        }
      }

      sanitizedItems.push({
        productId,
        quantity,
        selectedVariant,
      });
    }

    // 8. Validação e Whitelist do Cliente por Shopping Mode
    const rawCustomer = payload.customer;
    if (!rawCustomer || typeof rawCustomer !== "object" || Array.isArray(rawCustomer)) {
      return new Response(
        JSON.stringify({ error: "Dados do cliente são obrigatórios e devem ser um objeto JSON." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const custRecord = rawCustomer as Record<string, unknown>;

    let sanitizedCustomer: Record<string, unknown>;

    if (shoppingMode === "retail") {
      // Nome obrigatório
      if (typeof custRecord.name !== "string") {
        return new Response(
          JSON.stringify({ error: "Nome do cliente é obrigatório e deve ser texto." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const custName = custRecord.name.trim();
      if (!custName || custName.length > 160) {
        return new Response(
          JSON.stringify({ error: "Nome do cliente é obrigatório e deve ter no máximo 160 caracteres." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Telefone obrigatório
      if (typeof custRecord.phone !== "string") {
        return new Response(
          JSON.stringify({ error: "Telefone do cliente é obrigatório e deve ser texto." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const custPhone = custRecord.phone.trim();
      if (!custPhone || custPhone.length > 40) {
        return new Response(
          JSON.stringify({ error: "Telefone do cliente é obrigatório e deve ter no máximo 40 caracteres." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // E-mail opcional (fail-closed se tipo incorreto)
      let custEmail: string | null = null;
      if (custRecord.email !== undefined && custRecord.email !== null) {
        if (typeof custRecord.email !== "string") {
          return new Response(
            JSON.stringify({ error: "E-mail do cliente deve ser texto." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        custEmail = custRecord.email.trim();
        if (custEmail.length > 254) {
          return new Response(
            JSON.stringify({ error: "E-mail do cliente excede o limite máximo de 254 caracteres." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (!custEmail) custEmail = null;
      }

      // Tipo (PF ou PJ - fail-closed se inválido)
      let custType = "PF";
      if (custRecord.type !== undefined && custRecord.type !== null) {
        if (typeof custRecord.type !== "string") {
          return new Response(
            JSON.stringify({ error: "Tipo de cliente deve ser texto (PF ou PJ)." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const normalizedType = custRecord.type.trim().toUpperCase();
        if (normalizedType && normalizedType !== "PF" && normalizedType !== "PJ") {
          return new Response(
            JSON.stringify({ error: "Tipo de cliente inválido (deve ser 'PF' ou 'PJ')." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (normalizedType === "PJ") {
          custType = "PJ";
        }
      }

      // Documento obrigatório para retail (CPF para PF, CNPJ para PJ)
      if (typeof custRecord.document !== "string") {
        return new Response(
          JSON.stringify({
            error: custType === "PF" ? "CPF do cliente é obrigatório." : "CNPJ do cliente é obrigatório.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const rawDoc = custRecord.document.trim();
      if (!rawDoc) {
        return new Response(
          JSON.stringify({
            error: custType === "PF" ? "CPF do cliente é obrigatório." : "CNPJ do cliente é obrigatório.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const cleanDoc = rawDoc.replace(/\D/g, "");
      if (custType === "PF") {
        if (!isValidCPF(cleanDoc)) {
          return new Response(
            JSON.stringify({ error: "CPF do cliente inválido." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        if (!isValidCNPJ(cleanDoc)) {
          return new Response(
            JSON.stringify({ error: "CNPJ do cliente inválido." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
      const custDoc = cleanDoc;

      // Razão Social opcional (fail-closed se tipo incorreto)
      let custCompName: string | null = null;
      if (custRecord.companyName !== undefined && custRecord.companyName !== null) {
        if (typeof custRecord.companyName !== "string") {
          return new Response(
            JSON.stringify({ error: "Razão social deve ser texto." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        custCompName = custRecord.companyName.trim();
        if (custCompName.length > 200) {
          return new Response(
            JSON.stringify({ error: "Razão social excede o limite máximo de 200 caracteres." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (!custCompName) custCompName = null;
      }

      sanitizedCustomer = {
        name: custName,
        phone: custPhone,
        email: custEmail,
        document: custDoc,
        companyName: custCompName,
        type: custType,
      };
    } else {
      // WHOLESALE: Identidade oficial vem de wholesale_customers no banco;
      // email e phone do request são apenas dados operacionais opcionais
      let opEmail: string | null = null;
      if (custRecord.email !== undefined && custRecord.email !== null) {
        if (typeof custRecord.email !== "string") {
          return new Response(
            JSON.stringify({ error: "E-mail operacional deve ser texto." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        opEmail = custRecord.email.trim();
        if (opEmail.length > 254) {
          return new Response(
            JSON.stringify({ error: "E-mail operacional excede o limite máximo de 254 caracteres." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (!opEmail) opEmail = null;
      }

      let opPhone: string | null = null;
      if (custRecord.phone !== undefined && custRecord.phone !== null) {
        if (typeof custRecord.phone !== "string") {
          return new Response(
            JSON.stringify({ error: "Telefone operacional deve ser texto." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        opPhone = custRecord.phone.trim();
        if (opPhone.length > 40) {
          return new Response(
            JSON.stringify({ error: "Telefone operacional excede o limite máximo de 40 caracteres." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (!opPhone) opPhone = null;
      }

      sanitizedCustomer = {
        email: opEmail,
        phone: opPhone,
      };
    }

    // 9. Validação e Whitelist do Endereço de Entrega (Fail-Closed para tipos)
    const rawShipping = payload.shippingAddress;
    if (!rawShipping || typeof rawShipping !== "object" || Array.isArray(rawShipping)) {
      return new Response(
        JSON.stringify({ error: "Endereço de entrega é obrigatório e deve ser um objeto JSON." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const shipRecord = rawShipping as Record<string, unknown>;

    if (typeof shipRecord.street !== "string") {
      return new Response(
        JSON.stringify({ error: "Rua/logradouro de entrega é obrigatório e deve ser texto." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const shipStreet = shipRecord.street.trim();
    if (!shipStreet || shipStreet.length > 200) {
      return new Response(
        JSON.stringify({ error: "Rua/logradouro de entrega é obrigatório e deve ter no máximo 200 caracteres." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let shipNumber: string | null = null;
    if (shipRecord.number !== undefined && shipRecord.number !== null) {
      if (typeof shipRecord.number !== "string") {
        return new Response(
          JSON.stringify({ error: "Número do endereço de entrega deve ser texto." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      shipNumber = shipRecord.number.trim();
      if (shipNumber.length > 32) {
        return new Response(
          JSON.stringify({ error: "Número do endereço excede o limite de 32 caracteres." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!shipNumber) shipNumber = null;
    }

    let shipComp: string | null = null;
    if (shipRecord.complement !== undefined && shipRecord.complement !== null) {
      if (typeof shipRecord.complement !== "string") {
        return new Response(
          JSON.stringify({ error: "Complemento do endereço deve ser texto." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      shipComp = shipRecord.complement.trim();
      if (shipComp.length > 160) {
        return new Response(
          JSON.stringify({ error: "Complemento do endereço excede o limite de 160 caracteres." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!shipComp) shipComp = null;
    }

    let shipNeigh: string | null = null;
    if (shipRecord.neighborhood !== undefined && shipRecord.neighborhood !== null) {
      if (typeof shipRecord.neighborhood !== "string") {
        return new Response(
          JSON.stringify({ error: "Bairro do endereço deve ser texto." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      shipNeigh = shipRecord.neighborhood.trim();
      if (shipNeigh.length > 120) {
        return new Response(
          JSON.stringify({ error: "Bairro do endereço excede o limite de 120 caracteres." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!shipNeigh) shipNeigh = null;
    }

    let shipCity: string | null = null;
    if (shipRecord.city !== undefined && shipRecord.city !== null) {
      if (typeof shipRecord.city !== "string") {
        return new Response(
          JSON.stringify({ error: "Cidade do endereço deve ser texto." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      shipCity = shipRecord.city.trim();
      if (shipCity.length > 120) {
        return new Response(
          JSON.stringify({ error: "Cidade do endereço excede o limite de 120 caracteres." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!shipCity) shipCity = null;
    }

    let shipState: string | null = null;
    if (shipRecord.state !== undefined && shipRecord.state !== null) {
      if (typeof shipRecord.state !== "string") {
        return new Response(
          JSON.stringify({ error: "Estado/UF do endereço deve ser texto." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      shipState = shipRecord.state.trim();
      if (shipState.length > 64) {
        return new Response(
          JSON.stringify({ error: "Estado/UF do endereço excede o limite de 64 caracteres." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!shipState) shipState = null;
    }

    let shipZip: string | null = null;
    if (shipRecord.zipCode !== undefined && shipRecord.zipCode !== null) {
      if (typeof shipRecord.zipCode !== "string") {
        return new Response(
          JSON.stringify({ error: "CEP do endereço deve ser texto." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      shipZip = shipRecord.zipCode.trim();
      if (shipZip.length > 20) {
        return new Response(
          JSON.stringify({ error: "CEP do endereço excede o limite de 20 caracteres." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!shipZip) shipZip = null;
    }

    const sanitizedShippingAddress = {
      street: shipStreet,
      number: shipNumber,
      complement: shipComp,
      neighborhood: shipNeigh,
      city: shipCity,
      state: shipState,
      zipCode: shipZip,
    };

    // 10. Método de Pagamento e Entrega
    if (typeof payload.paymentMethod !== "string") {
      return new Response(
        JSON.stringify({ error: "Forma de pagamento deve ser texto." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const paymentMethod = payload.paymentMethod.trim();
    if (!["pix", "boleto", "credit_card", "cash_on_delivery"].includes(paymentMethod)) {
      return new Response(
        JSON.stringify({ error: "Forma de pagamento não suportada." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (typeof payload.deliveryMethod !== "string") {
      return new Response(
        JSON.stringify({ error: "Método de entrega deve ser texto." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const deliveryMethod = payload.deliveryMethod.trim();
    if (!deliveryMethod || deliveryMethod.length > 64) {
      return new Response(
        JSON.stringify({ error: "Método de entrega inválido ou excede 64 caracteres." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let notes: string | null = null;
    if (payload.notes !== undefined && payload.notes !== null) {
      if (typeof payload.notes !== "string") {
        return new Response(
          JSON.stringify({ error: "Observações do pedido devem ser texto." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      notes = payload.notes.trim();
      if (notes.length > 1000) {
        return new Response(
          JSON.stringify({ error: "Observações do pedido excedem o limite máximo de 1000 caracteres." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!notes) notes = null;
    }

    let sellerCode: string | null = null;
    if (payload.sellerCode !== undefined && payload.sellerCode !== null) {
      if (typeof payload.sellerCode !== "string") {
        return new Response(
          JSON.stringify({ error: "Código de vendedor deve ser texto." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      sellerCode = payload.sellerCode.trim();
      if (sellerCode.length > 64) {
        return new Response(
          JSON.stringify({ error: "Código de vendedor excede o limite máximo de 64 caracteres." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!sellerCode) sellerCode = null;
    }

    // 11. Resolução Segura de Chaves Modernas do Supabase (SUPABASE_SECRET_KEYS)
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const rawSecretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");

    if (!supabaseUrl || !rawSecretKeys) {
      console.error("[submit-order-checkout] Configuração do servidor incompleta.");
      return new Response(
        JSON.stringify({ error: "Serviço de checkout indisponível no momento." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let secretKey = "";
    try {
      const parsedKeys = JSON.parse(rawSecretKeys);
      secretKey = typeof parsedKeys?.default === "string" ? parsedKeys.default : "";
      if (!secretKey) throw new Error("Chave default ausente");
    } catch {
      console.error("[submit-order-checkout] Falha ao processar chaves de autenticação do servidor.");
      return new Response(
        JSON.stringify({ error: "Serviço de checkout indisponível no momento." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let buyerUserId: string | null = null;

    if (shoppingMode === "wholesale") {
      const authHeader = req.headers.get("authorization") || "";
      if (!authHeader.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "Pedidos na modalidade Atacado exigem autenticação do comprador (Bearer token obrigatório)." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const token = authHeader.replace("Bearer ", "").trim();
      const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);

      if (userError || !userData?.user?.id) {
        return new Response(
          JSON.stringify({ error: "Sessão de autenticação inválida ou expirada para pedido de atacado." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // buyerUserId vem SOMENTE da autenticação validada
      buyerUserId = userData.user.id;
    }

    // 12. Chamada à RPC Transacional com service_role
    const { data: orderResult, error: rpcError } = await supabaseAdmin.rpc(
      "create_order_checkout_internal",
      {
        p_tenant_slug: tenantSlug,
        p_idempotency_key: idempotencyKey,
        p_shopping_mode: shoppingMode,
        p_items: sanitizedItems,
        p_customer: sanitizedCustomer,
        p_shipping_address: sanitizedShippingAddress,
        p_payment_method: paymentMethod,
        p_delivery_method: deliveryMethod,
        p_notes: notes,
        p_seller_code: sellerCode,
        p_buyer_user_id: buyerUserId,
      }
    );

    if (rpcError) {
      const errorCode = rpcError.code || "";
      console.warn(`[submit-order-checkout] Erro na RPC [Code: ${errorCode}]`);

      // SQLSTATE 23505 (Unique Violation / Concorrência): NÃO expõe detalhes internos
      if (errorCode === "23505") {
        return new Response(
          JSON.stringify({ error: "Conflito ao processar pedido." }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Mapeamento de status e sanitização de mensagens conhecidas
      if (errorCode === "22000") {
        return new Response(
          JSON.stringify({ error: rpcError.message || "Dados de entrada inválidos." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (errorCode === "42501") {
        return new Response(
          JSON.stringify({ error: rpcError.message || "Acesso não autorizado para esta operação." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (errorCode === "P0002") {
        return new Response(
          JSON.stringify({ error: rpcError.message || "Recurso não encontrado." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (errorCode === "55P03" || errorCode === "55000") {
        return new Response(
          JSON.stringify({ error: rpcError.message || "Conflito ao processar pedido." }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Erros internos ou inesperados: mensagem sanitizada
      return new Response(
        JSON.stringify({ error: "Não foi possível processar o pedido." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 13. Geração e Assinatura do PDF de Pedido no Storage Privado (Order Documents)
    let documentUrl: string | null = null;
    let documentExpiresAt: string | null = null;

    try {
      // 13.1 Consulta de branding server-side
      let branding: { public_name?: string; logo_url?: string; primary_color?: string; accent_color?: string } | null = null;
      try {
        const { data: bData } = await supabaseAdmin
          .from("tenant_public_settings")
          .select("public_name, logo_url, primary_color, accent_color")
          .eq("tenant_id", orderResult.tenant_id)
          .maybeSingle();
        if (bData) branding = bData;
      } catch {
        // Fallback silencioso para branding padrão
      }

      // 13.2 Geração dos bytes do PDF via helper server-side oficial
      const pdfBytes = await generateOrderPdf(orderResult, branding);

      // 13.3 Upload idempotente para o bucket privado 'order-documents'
      const canonicalPdfPath = `${orderResult.tenant_id}/orders/${orderResult.id}/pedido-${orderResult.order_number}.pdf`;
      const { error: uploadError } = await supabaseAdmin.storage
        .from("order-documents")
        .upload(canonicalPdfPath, pdfBytes, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (uploadError) {
        console.warn("[submit-order-checkout] Aviso: Falha no upload do documento de pedido no Storage.");
      } else {
        // 13.4 Criação de Signed URL temporária válida por 7 dias (604800 segundos)
        const { data: signedData, error: signError } = await supabaseAdmin.storage
          .from("order-documents")
          .createSignedUrl(canonicalPdfPath, 604800);

        if (!signError && signedData?.signedUrl) {
          documentUrl = signedData.signedUrl;
          documentExpiresAt = new Date(Date.now() + 604800 * 1000).toISOString();
        } else {
          console.warn("[submit-order-checkout] Aviso: Falha na assinatura da URL do documento de pedido.");
        }
      }
    } catch {
      // Falha na geração/assinatura do PDF NUNCA cancela nem desfaz o pedido já criado no banco (Graceful Fallback)
      console.warn("[submit-order-checkout] Aviso: Falha na geração do documento PDF do pedido.");
      documentUrl = null;
      documentExpiresAt = null;
    }

    // 14. Minimização de Resposta (Response Minimization - sem expor tenant_id, seller_id, idempotency_key ou PII crua)
    const sanitizedResponse = {
      id: orderResult.id,
      orderNumber: orderResult.order_number,
      shoppingMode: orderResult.shopping_mode,
      deliveryMethod: orderResult.delivery_method,
      items: orderResult.items,
      subtotal: orderResult.subtotal,
      discount: orderResult.discount,
      shippingFee: orderResult.shipping_fee,
      total: orderResult.total,
      status: orderResult.status,
      paymentMethod: orderResult.payment_method,
      createdAt: orderResult.created_at,
      documentUrl: documentUrl || null,
      documentExpiresAt: documentExpiresAt || null,
    };

    return new Response(
      JSON.stringify({
        success: true,
        order: sanitizedResponse,
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch {
    console.error("[submit-order-checkout] Exceção interna não tratada.");
    return new Response(
      JSON.stringify({ error: "Erro interno no servidor ao processar o pedido." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
