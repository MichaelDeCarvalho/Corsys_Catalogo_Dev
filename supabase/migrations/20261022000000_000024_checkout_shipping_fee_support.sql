-- =============================================================================
-- CORSYS.CATÁLOGO — MIGRATION 000024: CHECKOUT SHIPPING FEE SUPPORT
-- Data: 2026-10-22
-- Forward-only evolution: compatible with 000010–000023.
-- =============================================================================
-- Motivo:
-- Suporte ao cálculo e persistência transacional de taxa de frete no checkout.
-- Atualiza private.create_order_checkout_internal e o wrapper public para aceitar
-- p_shipping_fee (NUMERIC 10,2 DEFAULT 0.00), mantendo a autoridade financeira no servidor.
-- Preserva todas as travas de idempotência e isolamento B2B da migration 000023.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Atualização do procedimento interno no schema private
CREATE OR REPLACE FUNCTION private.create_order_checkout_internal(
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
  p_buyer_user_id UUID DEFAULT NULL,
  p_shipping_fee NUMERIC(10,2) DEFAULT 0.00
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
  v_seller_id UUID := NULL;
  v_seller_code TEXT := NULL;
  v_wholesale_cust RECORD;
  v_customer_snapshot JSONB;
  v_shipping_snapshot JSONB;
  v_sanitized_items JSONB := '[]'::jsonb;
  v_subtotal NUMERIC(10,2) := 0.00;
  v_shipping_fee NUMERIC(10,2) := 0.00;
  v_total NUMERIC(10,2) := 0.00;
  v_raw_item JSONB;
  v_item_prod_id UUID;
  v_item_qty INTEGER;
  v_item_variant TEXT;
  v_prod RECORD;
  v_item_unit_price NUMERIC(10,2);
  v_item_total_price NUMERIC(10,2);
  v_order_number TEXT;
  v_result JSONB;
  v_persisted_buyer_user_id UUID := NULL;

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
  IF p_shipping_fee IS NOT NULL THEN
    IF p_shipping_fee < 0.00 THEN
      RAISE EXCEPTION 'Taxa de frete não pode ser negativa.' USING ERRCODE = '22000';
    END IF;
    v_shipping_fee := round(p_shipping_fee, 2);
  END IF;

  IF p_tenant_slug IS NULL OR trim(p_tenant_slug) = '' THEN
    RAISE EXCEPTION 'Slug do tenant é obrigatório.' USING ERRCODE = 'P0002';
  END IF;

  IF length(trim(p_tenant_slug)) > 120 THEN
    RAISE EXCEPTION 'Slug do tenant excede o limite máximo de 120 caracteres.' USING ERRCODE = '22000';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Chave de idempotência é obrigatória.' USING ERRCODE = '22000';
  END IF;

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

  SELECT 
    t.id, 
    t.status, 
    s.min_order_value, 
    s.wholesale_min_order_value, 
    s.allow_b2b_mode,
    s.delivery_methods
  INTO 
    v_tenant_id, 
    v_tenant_status, 
    v_min_order_value, 
    v_wholesale_min_order_value, 
    v_allow_b2b_mode,
    v_delivery_methods
  FROM public.tenants t
  JOIN public.tenant_public_settings s ON s.tenant_id = t.id
  WHERE (s.slug = trim(p_tenant_slug) OR t.slug = trim(p_tenant_slug))
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Loja com identificador "%" não foi encontrada.', p_tenant_slug USING ERRCODE = 'P0002';
  END IF;

  IF v_tenant_status <> 'active' THEN
    RAISE EXCEPTION 'Esta loja está temporariamente inativa para novos pedidos.' USING ERRCODE = '22000';
  END IF;

  -- Idempotência prévia
  SELECT to_jsonb(o.*) INTO v_existing_order
  FROM public.orders o
  WHERE o.tenant_id = v_tenant_id AND o.idempotency_key = p_idempotency_key;

  IF v_existing_order IS NOT NULL THEN
    RETURN v_existing_order;
  END IF;

  -- B2B e Atacado
  IF p_shopping_mode = 'wholesale' THEN
    IF NOT COALESCE(v_allow_b2b_mode, false) THEN
      RAISE EXCEPTION 'A modalidade de atacado não está ativada nesta loja.' USING ERRCODE = '42501';
    END IF;

    IF p_buyer_user_id IS NULL THEN
      RAISE EXCEPTION 'Pedidos na modalidade Atacado exigem autenticação do comprador.' USING ERRCODE = '42501';
    END IF;

    SELECT wc.* INTO v_wholesale_cust
    FROM public.wholesale_customers wc
    WHERE wc.tenant_id = v_tenant_id AND wc.user_id = p_buyer_user_id;

    IF v_wholesale_cust.id IS NULL THEN
      RAISE EXCEPTION 'Comprador atacadista não possui cadastro nesta loja.' USING ERRCODE = '42501';
    END IF;

    IF v_wholesale_cust.status <> 'approved' THEN
      RAISE EXCEPTION 'Cadastro de atacado do comprador ainda não foi aprovado para efetuar compras.' USING ERRCODE = '42501';
    END IF;

    v_persisted_buyer_user_id := p_buyer_user_id;

    v_customer_snapshot := jsonb_build_object(
      'type', 'PJ',
      'name', COALESCE(NULLIF(trim(v_wholesale_cust.trade_name), ''), trim(v_wholesale_cust.legal_name)),
      'companyName', trim(v_wholesale_cust.legal_name),
      'document', trim(v_wholesale_cust.cnpj),
      'phone', COALESCE(NULLIF(trim(p_customer->>'phone'), ''), trim(v_wholesale_cust.phone)),
      'email', COALESCE(NULLIF(trim(p_customer->>'email'), ''), trim(v_wholesale_cust.email))
    );
  ELSE
    v_persisted_buyer_user_id := NULL;

    IF p_customer IS NULL OR jsonb_typeof(p_customer) <> 'object' THEN
      RAISE EXCEPTION 'Dados do cliente são obrigatórios no varejo.' USING ERRCODE = '22000';
    END IF;

    v_cust_name := trim(p_customer->>'name');
    v_cust_phone := trim(p_customer->>'phone');
    v_cust_email := NULLIF(trim(p_customer->>'email'), '');
    v_cust_doc := NULLIF(trim(p_customer->>'document'), '');
    v_cust_comp_name := NULLIF(trim(p_customer->>'companyName'), '');
    v_cust_type := COALESCE(NULLIF(trim(p_customer->>'type'), ''), 'PF');

    v_customer_snapshot := jsonb_build_object(
      'type', v_cust_type,
      'name', v_cust_name,
      'phone', v_cust_phone,
      'email', v_cust_email,
      'document', v_cust_doc,
      'companyName', v_cust_comp_name
    );
  END IF;

  -- Endereço de Entrega
  IF p_shipping_address IS NULL OR jsonb_typeof(p_shipping_address) <> 'object' THEN
    RAISE EXCEPTION 'Endereço de entrega é obrigatório.' USING ERRCODE = '22000';
  END IF;

  v_ship_street := trim(p_shipping_address->>'street');
  v_ship_number := NULLIF(trim(p_shipping_address->>'number'), '');
  v_ship_complement := NULLIF(trim(p_shipping_address->>'complement'), '');
  v_ship_neighborhood := NULLIF(trim(p_shipping_address->>'neighborhood'), '');
  v_ship_city := NULLIF(trim(p_shipping_address->>'city'), '');
  v_ship_state := NULLIF(trim(p_shipping_address->>'state'), '');
  v_ship_zip := NULLIF(trim(p_shipping_address->>'zipCode'), '');

  v_shipping_snapshot := jsonb_build_object(
    'street', v_ship_street,
    'number', v_ship_number,
    'complement', v_ship_complement,
    'neighborhood', v_ship_neighborhood,
    'city', v_ship_city,
    'state', v_ship_state,
    'zipCode', v_ship_zip
  );

  -- Processa Itens
  FOR i IN 0..v_items_count - 1 LOOP
    v_raw_item := p_items->i;
    v_item_prod_id := (v_raw_item->>'productId')::uuid;
    v_item_qty := (v_raw_item->>'quantity')::integer;
    v_item_variant := NULLIF(trim(v_raw_item->>'selectedVariant'), '');

    SELECT p.* INTO v_prod
    FROM public.products p
    WHERE p.id = v_item_prod_id AND p.tenant_id = v_tenant_id;

    IF v_prod.id IS NULL OR v_prod.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Produto não encontrado ou indisponível nesta loja.' USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_prod.active THEN
      RAISE EXCEPTION 'O produto "%" está inativo no catálogo desta loja.', v_prod.name USING ERRCODE = '22000';
    END IF;

    IF p_shopping_mode = 'wholesale' THEN
      IF v_item_qty < v_prod.min_order_quantity THEN
        RAISE EXCEPTION 'Quantidade do item "%" (%) é inferior à quantidade mínima de atacado (%).',
          v_prod.name, v_item_qty, v_prod.min_order_quantity USING ERRCODE = '22000';
      END IF;

      SELECT t.price INTO v_item_unit_price
      FROM public.wholesale_tiers t
      WHERE t.product_id = v_prod.id AND t.min_quantity <= v_item_qty
      ORDER BY t.min_quantity DESC
      LIMIT 1;

      IF v_item_unit_price IS NULL THEN
        v_item_unit_price := COALESCE(v_prod.wholesale_price, v_prod.promotional_price, v_prod.price);
      END IF;
    ELSE
      v_item_unit_price := COALESCE(v_prod.promotional_price, v_prod.price);
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

  -- Validação de Mínimos
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

  v_total := round(v_subtotal + v_shipping_fee, 2);

  v_order_number := 'PED-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0');

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
      source,
      buyer_user_id
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
      v_shipping_fee,
      v_total,
      'pending',
      p_payment_method,
      NULLIF(trim(COALESCE(p_notes, '')), ''),
      'web_checkout',
      v_persisted_buyer_user_id
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

-- Revoga execução direta do procedimento do schema private
REVOKE ALL ON FUNCTION private.create_order_checkout_internal(
  TEXT, UUID, TEXT, JSONB, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC
) FROM PUBLIC, anon, authenticated, service_role;

-- 2. Wrapper público com guard de idempotência B2B
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
  p_buyer_user_id UUID DEFAULT NULL,
  p_shipping_fee NUMERIC(10,2) DEFAULT 0.00
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $wrapper$
DECLARE
  v_tenant_id UUID;
  v_b2b_enabled BOOLEAN;
  v_existing_mode TEXT;
  v_existing_buyer UUID;
BEGIN
  SELECT t.id, s.allow_b2b_mode INTO v_tenant_id, v_b2b_enabled
  FROM public.tenants t
  JOIN public.tenant_public_settings s ON s.tenant_id = t.id
  WHERE (s.slug = btrim(p_tenant_slug) OR t.slug = btrim(p_tenant_slug))
    AND t.status = 'active'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Loja indisponível.' USING ERRCODE = 'P0002';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Chave de idempotência inválida.' USING ERRCODE = '22000';
  END IF;
  IF p_shopping_mode NOT IN ('retail', 'wholesale') OR p_shopping_mode IS NULL THEN
    RAISE EXCEPTION 'Modalidade inválida.' USING ERRCODE = '22000';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_tenant_id::text || ':' || p_idempotency_key::text, 0)
  );

  IF p_shopping_mode = 'wholesale' THEN
    IF p_buyer_user_id IS NULL OR NOT COALESCE(v_b2b_enabled, false)
      OR NOT EXISTS (
        SELECT 1 FROM public.wholesale_customers wc
        WHERE wc.tenant_id = v_tenant_id
          AND wc.user_id = p_buyer_user_id
          AND wc.status = 'approved'
      ) THEN
      RAISE EXCEPTION 'Comprador atacadista não autorizado.' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT o.shopping_mode, o.buyer_user_id
    INTO v_existing_mode, v_existing_buyer
  FROM public.orders o
  WHERE o.tenant_id = v_tenant_id AND o.idempotency_key = p_idempotency_key;

  IF FOUND AND (
      v_existing_mode IS DISTINCT FROM p_shopping_mode
      OR (p_shopping_mode = 'wholesale'
          AND v_existing_buyer IS DISTINCT FROM p_buyer_user_id)
  ) THEN
    RAISE EXCEPTION 'Chave de pedido pertence a outra identidade.'
      USING ERRCODE = '42501';
  END IF;

  RETURN private.create_order_checkout_internal(
    p_tenant_slug, p_idempotency_key, p_shopping_mode, p_items,
    p_customer, p_shipping_address, p_payment_method, p_delivery_method,
    p_notes, p_seller_code, p_buyer_user_id, p_shipping_fee
  );
END
$wrapper$;

REVOKE ALL ON FUNCTION public.create_order_checkout_internal(
  TEXT, UUID, TEXT, JSONB, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_order_checkout_internal(
  TEXT, UUID, TEXT, JSONB, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC
) TO service_role;

COMMENT ON FUNCTION public.create_order_checkout_internal(
  TEXT, UUID, TEXT, JSONB, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC
) IS 'Server-only wholesale authorization, same-buyer idempotency guard and shipping fee persistence.';

COMMIT;
