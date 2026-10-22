-- =========================================================================
-- MIGRATION 000011: ORDERS & CHECKOUT V1 HARDENING / FORWARD FIX
-- =========================================================================
-- Objetivo:
-- 1. Reafirmar constraints de forma scoped (conrelid = 'public.orders'::regclass).
-- 2. Defense-in-depth na RPC public.create_order_checkout_internal:
--    - Validação estrita de UUID v4 para idempotency_key.
--    - Validação explícita de tipos JSON (jsonb_typeof) para todos os campos (Fail-Closed).
--    - Validação estrita de tipo de cliente PF/PJ (sem coerção silenciosa).
--    - Limites de tamanho estritos para strings (slug, seller_code, delivery_method, notes, variantes).
--    - Proteção de limite técnico de quantidade (1 a 2147483647) antes do cast SQL.
--    - Canonical Customer Snapshot para Varejo e Atacado (sem persistência de JSON arbitrário).
--    - Canonical Shipping Snapshot (sem persistência de JSON arbitrário).
-- 3. Menor privilégio: execução restrita estritamente a service_role.
--
-- REGRA DE OURO: Migrations 000001 a 000010 permanecem estritamente intactas e congeladas.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1. REAFIRMAR CONSTRAINTS DE FORMA SCOPED
-- -------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_orders_tenant_idempotency'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT uq_orders_tenant_idempotency UNIQUE (tenant_id, idempotency_key);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_orders_shopping_mode'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT chk_orders_shopping_mode CHECK (shopping_mode IN ('retail', 'wholesale'));
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 2. CREATE_ORDER_CHECKOUT_INTERNAL — DEFENSE IN DEPTH
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_order_checkout_internal(
  p_tenant_slug TEXT,
  p_idempotency_key UUID,
  p_shopping_mode TEXT,
  p_items JSONB,
  p_customer JSONB,
  p_shipping_address JSONB,
  p_payment_method TEXT,
  p_delivery_method TEXT,
  p_notes TEXT DEFAULT NULL,
  p_seller_code TEXT DEFAULT NULL,
  p_buyer_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id UUID;
  v_tenant_status TEXT;
  v_min_order_value NUMERIC(10,2);
  v_wholesale_min_order_value NUMERIC(10,2);
  v_allow_b2b_mode BOOLEAN;
  v_delivery_methods JSONB;
  v_existing_order JSONB;
  v_items_count INTEGER;
  v_no_duplicate_products BOOLEAN;
  v_seller_id UUID := NULL;
  v_seller_code TEXT := NULL;
  v_wholesale_cust RECORD;
  v_customer_snapshot JSONB;
  v_shipping_snapshot JSONB;
  v_sanitized_items JSONB := '[]'::jsonb;
  v_subtotal NUMERIC(10,2) := 0.00;
  v_raw_item JSONB;
  v_item_prod_id UUID;
  v_item_qty INTEGER;
  v_item_variant TEXT;
  v_prod RECORD;
  v_item_unit_price NUMERIC(10,2);
  v_item_total_price NUMERIC(10,2);
  v_order_number TEXT;
  v_result JSONB;

  -- Variáveis auxiliares para snapshots canônicos
  v_cust_name TEXT;
  v_cust_phone TEXT;
  v_cust_email TEXT;
  v_cust_doc TEXT;
  v_cust_comp_name TEXT;
  v_cust_type TEXT;

  v_ship_street TEXT;
  v_ship_number TEXT;
  v_ship_complement TEXT;
  v_ship_neighborhood TEXT;
  v_ship_city TEXT;
  v_ship_state TEXT;
  v_ship_zip TEXT;
BEGIN
  -- 1. Validações preliminares de entrada com limites de tamanho
  IF p_tenant_slug IS NULL OR trim(p_tenant_slug) = '' THEN
    RAISE EXCEPTION 'Slug do tenant é obrigatório.' USING ERRCODE = 'P0002';
  END IF;

  IF length(trim(p_tenant_slug)) > 120 THEN
    RAISE EXCEPTION 'Slug do tenant excede o limite máximo de 120 caracteres.' USING ERRCODE = '22000';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Chave de idempotência é obrigatória.' USING ERRCODE = '22000';
  END IF;

  -- Validação estrita de UUID v4 (versão 4, variante RFC 4122)
  IF NOT (p_idempotency_key::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'Chave de idempotência inválida (deve ser UUID v4).' USING ERRCODE = '22000';
  END IF;

  IF p_shopping_mode IS NULL OR p_shopping_mode NOT IN ('retail', 'wholesale') THEN
    RAISE EXCEPTION 'Modalidade de compra inválida: %', p_shopping_mode USING ERRCODE = '22000';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Lista de itens inválida.' USING ERRCODE = '22000';
  END IF;

  v_items_count := jsonb_array_length(p_items);
  IF v_items_count < 1 THEN
    RAISE EXCEPTION 'O pedido deve conter pelo menos um item.' USING ERRCODE = '22000';
  END IF;

  IF v_items_count > 200 THEN
    RAISE EXCEPTION 'O pedido excede o limite máximo permitido de 200 itens.' USING ERRCODE = '22000';
  END IF;

  IF p_payment_method IS NULL OR p_payment_method NOT IN ('pix', 'boleto', 'credit_card', 'cash_on_delivery') THEN
    RAISE EXCEPTION 'Forma de pagamento não suportada: %', p_payment_method USING ERRCODE = '22000';
  END IF;

  IF p_delivery_method IS NULL OR trim(p_delivery_method) = '' THEN
    RAISE EXCEPTION 'Método de entrega é obrigatório.' USING ERRCODE = '22000';
  END IF;

  IF length(trim(p_delivery_method)) > 64 THEN
    RAISE EXCEPTION 'Método de entrega excede o limite máximo de 64 caracteres.' USING ERRCODE = '22000';
  END IF;

  IF p_notes IS NOT NULL AND length(trim(p_notes)) > 1000 THEN
    RAISE EXCEPTION 'Observações do pedido excedem o limite máximo de 1000 caracteres.' USING ERRCODE = '22000';
  END IF;

  IF p_seller_code IS NOT NULL AND length(trim(p_seller_code)) > 64 THEN
    RAISE EXCEPTION 'Código de vendedor excede o limite máximo de 64 caracteres.' USING ERRCODE = '22000';
  END IF;

  -- 2. Resolução do Tenant via Slug canônico e verificação de status e settings
  SELECT t.id, t.status, s.min_order_value, s.wholesale_min_order_value, s.allow_b2b_mode, s.delivery_methods
  INTO v_tenant_id, v_tenant_status, v_min_order_value, v_wholesale_min_order_value, v_allow_b2b_mode, v_delivery_methods
  FROM public.tenants t
  JOIN public.tenant_public_settings s ON s.tenant_id = t.id
  WHERE t.slug = trim(p_tenant_slug);

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Loja não encontrada com o identificador fornecido.' USING ERRCODE = 'P0002';
  END IF;

  IF v_tenant_status <> 'active' THEN
    RAISE EXCEPTION 'Esta loja está temporariamente inativa para novos pedidos.' USING ERRCODE = '42501';
  END IF;

  -- 3. Consulta de Idempotência: Se o pedido já existir, retorna-o imediatamente sem duplicar
  SELECT to_jsonb(o.*) INTO v_existing_order
  FROM public.orders o
  WHERE o.tenant_id = v_tenant_id AND o.idempotency_key = p_idempotency_key;

  IF v_existing_order IS NOT NULL THEN
    RETURN v_existing_order;
  END IF;

  -- 4. Validação de Método de Entrega contra as configurações reais do Tenant
  IF v_delivery_methods IS NULL OR NOT (v_delivery_methods @> to_jsonb(trim(p_delivery_method))) THEN
    RAISE EXCEPTION 'Método de entrega "%" não é aceito por esta loja.', p_delivery_method USING ERRCODE = '22000';
  END IF;

  -- 5. Resolução Segura de Código de Vendedor (opcional)
  IF p_seller_code IS NOT NULL AND trim(p_seller_code) <> '' THEN
    SELECT tu.id, tu.seller_code
    INTO v_seller_id, v_seller_code
    FROM public.tenant_users tu
    WHERE tu.tenant_id = v_tenant_id
      AND tu.active = true
      AND tu.seller_code = trim(p_seller_code);

    IF v_seller_id IS NULL THEN
      RAISE EXCEPTION 'Código de vendedor inválido ou inexistente nesta loja.' USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 6. Construção e Validação do Snapshot Canônico do Cliente com Verificação de Tipos JSON
  IF p_customer IS NULL OR jsonb_typeof(p_customer) <> 'object' THEN
    RAISE EXCEPTION 'Dados de cliente inválidos (deve ser um objeto JSON).' USING ERRCODE = '22000';
  END IF;

  IF p_shopping_mode = 'retail' THEN
    -- Validação de tipos para campos obrigatórios
    IF NOT (p_customer ? 'name') OR jsonb_typeof(p_customer->'name') <> 'string' THEN
      RAISE EXCEPTION 'Nome do cliente é obrigatório e deve ser texto.' USING ERRCODE = '22000';
    END IF;
    v_cust_name := NULLIF(trim(p_customer->>'name'), '');
    IF v_cust_name IS NULL OR length(v_cust_name) > 160 THEN
      RAISE EXCEPTION 'Nome do cliente é obrigatório e deve ter no máximo 160 caracteres.' USING ERRCODE = '22000';
    END IF;

    IF NOT (p_customer ? 'phone') OR jsonb_typeof(p_customer->'phone') <> 'string' THEN
      RAISE EXCEPTION 'Telefone do cliente é obrigatório e deve ser texto.' USING ERRCODE = '22000';
    END IF;
    v_cust_phone := NULLIF(trim(p_customer->>'phone'), '');
    IF v_cust_phone IS NULL OR length(v_cust_phone) > 40 THEN
      RAISE EXCEPTION 'Telefone do cliente é obrigatório e deve ter no máximo 40 caracteres.' USING ERRCODE = '22000';
    END IF;

    -- Validação de tipos para campos opcionais
    IF p_customer ? 'email' AND jsonb_typeof(p_customer->'email') <> 'null' THEN
      IF jsonb_typeof(p_customer->'email') <> 'string' THEN
        RAISE EXCEPTION 'E-mail do cliente deve ser texto.' USING ERRCODE = '22000';
      END IF;
      v_cust_email := NULLIF(trim(p_customer->>'email'), '');
      IF v_cust_email IS NOT NULL AND length(v_cust_email) > 254 THEN
        RAISE EXCEPTION 'E-mail do cliente excede o limite máximo de 254 caracteres.' USING ERRCODE = '22000';
      END IF;
    ELSE
      v_cust_email := NULL;
    END IF;

    IF p_customer ? 'document' AND jsonb_typeof(p_customer->'document') <> 'null' THEN
      IF jsonb_typeof(p_customer->'document') <> 'string' THEN
        RAISE EXCEPTION 'Documento do cliente deve ser texto.' USING ERRCODE = '22000';
      END IF;
      v_cust_doc := NULLIF(trim(p_customer->>'document'), '');
      IF v_cust_doc IS NOT NULL AND length(v_cust_doc) > 32 THEN
        RAISE EXCEPTION 'Documento do cliente excede o limite máximo de 32 caracteres.' USING ERRCODE = '22000';
      END IF;
    ELSE
      v_cust_doc := NULL;
    END IF;

    IF p_customer ? 'companyName' AND jsonb_typeof(p_customer->'companyName') <> 'null' THEN
      IF jsonb_typeof(p_customer->'companyName') <> 'string' THEN
        RAISE EXCEPTION 'Razão social deve ser texto.' USING ERRCODE = '22000';
      END IF;
      v_cust_comp_name := NULLIF(trim(p_customer->>'companyName'), '');
      IF v_cust_comp_name IS NOT NULL AND length(v_cust_comp_name) > 200 THEN
        RAISE EXCEPTION 'Razão social excede o limite máximo de 200 caracteres.' USING ERRCODE = '22000';
      END IF;
    ELSE
      v_cust_comp_name := NULL;
    END IF;

    -- Validação rigorosa de tipo PF / PJ (sem coerção silenciosa)
    IF NOT (p_customer ? 'type') OR jsonb_typeof(p_customer->'type') = 'null' OR NULLIF(trim(COALESCE(p_customer->>'type', '')), '') IS NULL THEN
      v_cust_type := 'PF';
    ELSE
      IF jsonb_typeof(p_customer->'type') <> 'string' THEN
        RAISE EXCEPTION 'Tipo de cliente deve ser texto (PF ou PJ).' USING ERRCODE = '22000';
      END IF;
      v_cust_type := upper(trim(p_customer->>'type'));
      IF v_cust_type NOT IN ('PF', 'PJ') THEN
        RAISE EXCEPTION 'Tipo de cliente inválido: % (deve ser PF ou PJ).', v_cust_type USING ERRCODE = '22000';
      END IF;
    END IF;

    v_customer_snapshot := jsonb_build_object(
      'name', v_cust_name,
      'phone', v_cust_phone,
      'email', v_cust_email,
      'document', v_cust_doc,
      'companyName', v_cust_comp_name,
      'type', v_cust_type
    );
  ELSE
    -- WHOLESALE: Identidade oficial vem do cadastro aprovado de wholesale_customers
    IF p_buyer_user_id IS NULL THEN
      RAISE EXCEPTION 'Acesso atacadista exige usuário comprador autenticado.' USING ERRCODE = '42501';
    END IF;

    IF NOT COALESCE(v_allow_b2b_mode, false) THEN
      RAISE EXCEPTION 'Esta loja não opera na modalidade Atacado / B2B.' USING ERRCODE = '42501';
    END IF;

    IF v_wholesale_min_order_value IS NULL THEN
      RAISE EXCEPTION 'Configuração da loja inválida: valor mínimo de atacado não definido.' USING ERRCODE = '55000';
    END IF;

    SELECT wc.id, wc.cnpj, wc.legal_name, wc.trade_name, wc.contact_name, wc.email, wc.phone
    INTO v_wholesale_cust
    FROM public.wholesale_customers wc
    WHERE wc.tenant_id = v_tenant_id
      AND wc.user_id = p_buyer_user_id
      AND wc.status = 'approved';

    IF v_wholesale_cust.id IS NULL THEN
      RAISE EXCEPTION 'Cadastro de comprador B2B não encontrado ou ainda não aprovado pela loja.' USING ERRCODE = '42501';
    END IF;

    -- Validação de tipo de campos operacionais opcionais para Wholesale
    IF p_customer ? 'email' AND jsonb_typeof(p_customer->'email') <> 'null' THEN
      IF jsonb_typeof(p_customer->'email') <> 'string' THEN
        RAISE EXCEPTION 'E-mail operacional deve ser texto.' USING ERRCODE = '22000';
      END IF;
      v_cust_email := NULLIF(trim(p_customer->>'email'), '');
      IF v_cust_email IS NOT NULL AND length(v_cust_email) > 254 THEN
        RAISE EXCEPTION 'E-mail operacional excede o limite máximo de 254 caracteres.' USING ERRCODE = '22000';
      END IF;
    ELSE
      v_cust_email := NULL;
    END IF;

    IF p_customer ? 'phone' AND jsonb_typeof(p_customer->'phone') <> 'null' THEN
      IF jsonb_typeof(p_customer->'phone') <> 'string' THEN
        RAISE EXCEPTION 'Telefone operacional deve ser texto.' USING ERRCODE = '22000';
      END IF;
      v_cust_phone := NULLIF(trim(p_customer->>'phone'), '');
      IF v_cust_phone IS NOT NULL AND length(v_cust_phone) > 40 THEN
        RAISE EXCEPTION 'Telefone operacional excede o limite máximo de 40 caracteres.' USING ERRCODE = '22000';
      END IF;
    ELSE
      v_cust_phone := NULL;
    END IF;

    -- Snapshot oficial para identidade B2B
    v_customer_snapshot := jsonb_build_object(
      'name', v_wholesale_cust.contact_name,
      'companyName', v_wholesale_cust.legal_name,
      'tradeName', v_wholesale_cust.trade_name,
      'document', v_wholesale_cust.cnpj,
      'type', 'PJ',
      'email', COALESCE(v_cust_email, v_wholesale_cust.email),
      'phone', COALESCE(v_cust_phone, v_wholesale_cust.phone)
    );
  END IF;

  -- 7. Construção e Validação do Snapshot Canônico de Endereço com Verificação de Tipos JSON
  IF p_shipping_address IS NULL OR jsonb_typeof(p_shipping_address) <> 'object' THEN
    RAISE EXCEPTION 'Endereço de entrega inválido (deve ser um objeto JSON).' USING ERRCODE = '22000';
  END IF;

  IF NOT (p_shipping_address ? 'street') OR jsonb_typeof(p_shipping_address->'street') <> 'string' THEN
    RAISE EXCEPTION 'Rua/logradouro de entrega é obrigatório e deve ser texto.' USING ERRCODE = '22000';
  END IF;
  v_ship_street := NULLIF(trim(p_shipping_address->>'street'), '');
  IF v_ship_street IS NULL OR length(v_ship_street) > 200 THEN
    RAISE EXCEPTION 'Rua/logradouro é obrigatório e deve ter no máximo 200 caracteres.' USING ERRCODE = '22000';
  END IF;

  IF p_shipping_address ? 'number' AND jsonb_typeof(p_shipping_address->'number') <> 'null' THEN
    IF jsonb_typeof(p_shipping_address->'number') <> 'string' THEN
      RAISE EXCEPTION 'Número do endereço deve ser texto.' USING ERRCODE = '22000';
    END IF;
    v_ship_number := NULLIF(trim(p_shipping_address->>'number'), '');
    IF v_ship_number IS NOT NULL AND length(v_ship_number) > 32 THEN
      RAISE EXCEPTION 'Número do endereço excede o limite máximo de 32 caracteres.' USING ERRCODE = '22000';
    END IF;
  ELSE
    v_ship_number := NULL;
  END IF;

  IF p_shipping_address ? 'complement' AND jsonb_typeof(p_shipping_address->'complement') <> 'null' THEN
    IF jsonb_typeof(p_shipping_address->'complement') <> 'string' THEN
      RAISE EXCEPTION 'Complemento do endereço deve ser texto.' USING ERRCODE = '22000';
    END IF;
    v_ship_complement := NULLIF(trim(p_shipping_address->>'complement'), '');
    IF v_ship_complement IS NOT NULL AND length(v_ship_complement) > 160 THEN
      RAISE EXCEPTION 'Complemento do endereço excede o limite máximo de 160 caracteres.' USING ERRCODE = '22000';
    END IF;
  ELSE
    v_ship_complement := NULL;
  END IF;

  IF p_shipping_address ? 'neighborhood' AND jsonb_typeof(p_shipping_address->'neighborhood') <> 'null' THEN
    IF jsonb_typeof(p_shipping_address->'neighborhood') <> 'string' THEN
      RAISE EXCEPTION 'Bairro do endereço deve ser texto.' USING ERRCODE = '22000';
    END IF;
    v_ship_neighborhood := NULLIF(trim(p_shipping_address->>'neighborhood'), '');
    IF v_ship_neighborhood IS NOT NULL AND length(v_ship_neighborhood) > 120 THEN
      RAISE EXCEPTION 'Bairro do endereço excede o limite máximo de 120 caracteres.' USING ERRCODE = '22000';
    END IF;
  ELSE
    v_ship_neighborhood := NULL;
  END IF;

  IF p_shipping_address ? 'city' AND jsonb_typeof(p_shipping_address->'city') <> 'null' THEN
    IF jsonb_typeof(p_shipping_address->'city') <> 'string' THEN
      RAISE EXCEPTION 'Cidade do endereço deve ser texto.' USING ERRCODE = '22000';
    END IF;
    v_ship_city := NULLIF(trim(p_shipping_address->>'city'), '');
    IF v_ship_city IS NOT NULL AND length(v_ship_city) > 120 THEN
      RAISE EXCEPTION 'Cidade do endereço excede o limite máximo de 120 caracteres.' USING ERRCODE = '22000';
    END IF;
  ELSE
    v_ship_city := NULL;
  END IF;

  IF p_shipping_address ? 'state' AND jsonb_typeof(p_shipping_address->'state') <> 'null' THEN
    IF jsonb_typeof(p_shipping_address->'state') <> 'string' THEN
      RAISE EXCEPTION 'Estado/UF do endereço deve ser texto.' USING ERRCODE = '22000';
    END IF;
    v_ship_state := NULLIF(trim(p_shipping_address->>'state'), '');
    IF v_ship_state IS NOT NULL AND length(v_ship_state) > 64 THEN
      RAISE EXCEPTION 'Estado/UF do endereço excede o limite máximo de 64 caracteres.' USING ERRCODE = '22000';
    END IF;
  ELSE
    v_ship_state := NULL;
  END IF;

  IF p_shipping_address ? 'zipCode' AND jsonb_typeof(p_shipping_address->'zipCode') <> 'null' THEN
    IF jsonb_typeof(p_shipping_address->'zipCode') <> 'string' THEN
      RAISE EXCEPTION 'CEP do endereço deve ser texto.' USING ERRCODE = '22000';
    END IF;
    v_ship_zip := NULLIF(trim(p_shipping_address->>'zipCode'), '');
    IF v_ship_zip IS NOT NULL AND length(v_ship_zip) > 20 THEN
      RAISE EXCEPTION 'CEP do endereço excede o limite máximo de 20 caracteres.' USING ERRCODE = '22000';
    END IF;
  ELSE
    v_ship_zip := NULL;
  END IF;

  v_shipping_snapshot := jsonb_build_object(
    'street', v_ship_street,
    'number', v_ship_number,
    'complement', v_ship_complement,
    'neighborhood', v_ship_neighborhood,
    'city', v_ship_city,
    'state', v_ship_state,
    'zipCode', v_ship_zip
  );

  -- 8. Validação de Unicidade de Produtos no Pedido (sem duplicatas de productId)
  SELECT count(DISTINCT (elem->>'productId')) = count(*)
  INTO v_no_duplicate_products
  FROM jsonb_array_elements(p_items) elem;

  IF NOT v_no_duplicate_products THEN
    RAISE EXCEPTION 'O pedido não pode conter produtos repetidos em linhas separadas.' USING ERRCODE = '22000';
  END IF;

  -- 9. Iteração sobre os Itens: Validação de Posse, Estoque e Recálculo Server-Side de Preços
  FOR v_raw_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_raw_item) <> 'object' THEN
      RAISE EXCEPTION 'Cada item do pedido deve ser um objeto JSON válido.' USING ERRCODE = '22000';
    END IF;

    BEGIN
      v_item_prod_id := (v_raw_item->>'productId')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Identificador de produto inválido no item.' USING ERRCODE = '22000';
    END;

    -- Validação estrita de quantity: deve existir, ser exatamente jsonb_typeof 'number', inteiro positivo e <= 2147483647
    IF NOT (v_raw_item ? 'quantity') OR jsonb_typeof(v_raw_item->'quantity') <> 'number' THEN
      RAISE EXCEPTION 'Quantidade de item deve ser um número inteiro positivo.' USING ERRCODE = '22000';
    END IF;

    IF NOT ((v_raw_item->>'quantity') ~ '^[0-9]+$') THEN
      RAISE EXCEPTION 'Quantidade de item deve ser um número inteiro positivo.' USING ERRCODE = '22000';
    END IF;

    IF length(v_raw_item->>'quantity') > 10 OR (v_raw_item->>'quantity')::numeric > 2147483647::numeric THEN
      RAISE EXCEPTION 'Quantidade de item excede o limite técnico suportado.' USING ERRCODE = '22000';
    END IF;

    v_item_qty := (v_raw_item->>'quantity')::integer;

    IF v_item_qty < 1 THEN
      RAISE EXCEPTION 'Quantidade de item deve ser de pelo menos 1 unidade.' USING ERRCODE = '22000';
    END IF;

    -- Validação de selectedVariant (se presente, deve ser string com máximo 160 caracteres)
    IF v_raw_item ? 'selectedVariant' AND jsonb_typeof(v_raw_item->'selectedVariant') <> 'null' THEN
      IF jsonb_typeof(v_raw_item->'selectedVariant') <> 'string' THEN
        RAISE EXCEPTION 'Variante do produto deve ser texto.' USING ERRCODE = '22000';
      END IF;
      v_item_variant := NULLIF(trim(v_raw_item->>'selectedVariant'), '');
      IF v_item_variant IS NOT NULL AND length(v_item_variant) > 160 THEN
        RAISE EXCEPTION 'Variante selecionada excede o limite máximo de 160 caracteres.' USING ERRCODE = '22000';
      END IF;
    ELSE
      v_item_variant := NULL;
    END IF;

    SELECT p.id, p.name, p.sku, p.unit, p.price, p.promotional_price,
           p.wholesale_price, p.wholesale_enabled, p.wholesale_min_quantity,
           p.min_order_quantity, p.stock, p.images
    INTO v_prod
    FROM public.products p
    WHERE p.id = v_item_prod_id
      AND p.tenant_id = v_tenant_id
      AND p.active = true
      AND p.deleted_at IS NULL;

    IF v_prod.id IS NULL THEN
      RAISE EXCEPTION 'Produto não encontrado ou indisponível no catálogo desta loja.' USING ERRCODE = 'P0002';
    END IF;

    -- Validação de Estoque (Verificação sem decremento em pending)
    IF v_prod.stock < v_item_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para o produto % (Disponível: %, Solicitado: %).',
        v_prod.name, v_prod.stock, v_item_qty USING ERRCODE = '55P03';
    END IF;

    -- Recálculo de Preço Autoritativo Server-Side
    IF p_shopping_mode = 'retail' THEN
      IF v_item_qty < COALESCE(v_prod.min_order_quantity, 1) THEN
        RAISE EXCEPTION 'Quantidade mínima do produto % é de % %.',
          v_prod.name, COALESCE(v_prod.min_order_quantity, 1), v_prod.unit USING ERRCODE = '22000';
      END IF;
      v_item_unit_price := COALESCE(v_prod.promotional_price, v_prod.price);
    ELSE
      IF NOT COALESCE(v_prod.wholesale_enabled, false) OR v_prod.wholesale_price IS NULL OR v_prod.wholesale_price <= 0.00 THEN
        RAISE EXCEPTION 'Produto % não está disponível para venda no atacado.', v_prod.name USING ERRCODE = '22000';
      END IF;
      IF v_item_qty < COALESCE(v_prod.wholesale_min_quantity, 1) THEN
        RAISE EXCEPTION 'Quantidade mínima de atacado para % é de % %.',
          v_prod.name, v_prod.wholesale_min_quantity, v_prod.unit USING ERRCODE = '22000';
      END IF;
      v_item_unit_price := v_prod.wholesale_price;
    END IF;

    v_item_total_price := round(v_item_unit_price * v_item_qty, 2);
    v_subtotal := v_subtotal + v_item_total_price;

    v_sanitized_items := v_sanitized_items || jsonb_build_array(jsonb_build_object(
      'productId', v_prod.id,
      'productName', v_prod.name,
      'productSku', v_prod.sku,
      'productImage', COALESCE(v_prod.images[1], ''),
      'unitPrice', v_item_unit_price,
      'quantity', v_item_qty,
      'unit', v_prod.unit,
      'totalPrice', v_item_total_price,
      'selectedVariant', v_item_variant
    ));
  END LOOP;

  -- 10. Validação de Pedido Mínimo da Loja
  IF p_shopping_mode = 'retail' THEN
    IF v_min_order_value IS NOT NULL AND v_subtotal < v_min_order_value THEN
      RAISE EXCEPTION 'Valor do pedido (R$ %) abaixo do valor mínimo de varejo da loja (R$ %).',
        v_subtotal, v_min_order_value USING ERRCODE = '22000';
    END IF;
  ELSE
    IF v_subtotal < v_wholesale_min_order_value THEN
      RAISE EXCEPTION 'Valor do pedido (R$ %) abaixo do valor mínimo de atacado da loja (R$ %).',
        v_subtotal, v_wholesale_min_order_value USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 11. Geração determinística de Order Number server-side
  v_order_number := 'PED-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0');

  -- 12. Inserção Atômica com tratamento de corrida de concorrência em Idempotência
  BEGIN
    INSERT INTO public.orders (
      tenant_id,
      order_number,
      idempotency_key,
      shopping_mode,
      delivery_method,
      seller_id,
      seller_code,
      customer,
      shipping_address,
      items,
      subtotal,
      discount,
      shipping_fee,
      total,
      status,
      payment_method,
      notes,
      source
    ) VALUES (
      v_tenant_id,
      v_order_number,
      p_idempotency_key,
      p_shopping_mode,
      trim(p_delivery_method),
      v_seller_id,
      v_seller_code,
      v_customer_snapshot,
      v_shipping_snapshot,
      v_sanitized_items,
      v_subtotal,
      0.00,
      0.00,
      v_subtotal,
      'pending',
      p_payment_method,
      NULLIF(trim(COALESCE(p_notes, '')), ''),
      'web_checkout'
    ) RETURNING to_jsonb(public.orders.*) INTO v_result;

    RETURN v_result;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT to_jsonb(o.*) INTO v_existing_order
      FROM public.orders o
      WHERE o.tenant_id = v_tenant_id AND o.idempotency_key = p_idempotency_key;

      IF v_existing_order IS NOT NULL THEN
        RETURN v_existing_order;
      END IF;

      RAISE;
  END;
END;
$$;

-- Menor Privilégio: Restrito EXCLUSIVAMENTE a service_role (não acessível por anon nem authenticated)
REVOKE ALL ON FUNCTION public.create_order_checkout_internal(
  TEXT, UUID, TEXT, JSONB, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_order_checkout_internal(
  TEXT, UUID, TEXT, JSONB, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, UUID
) TO service_role;

COMMENT ON FUNCTION public.create_order_checkout_internal IS 'Criação transacional de pedidos via Edge Gateway server-side com snapshots canônicos e validação rigorosa.';

COMMIT;
