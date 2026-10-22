-- =============================================================================
-- CORSYS.CATÁLOGO — MIGRATION 000017: CHECKOUT DELIVERY METHODS COMPAT
-- Data: 2026-10-09
-- Forward-only hotfix: 000001–000016 permanecem congeladas.
-- =============================================================================
-- Motivo:
-- A migration 000015 passou a validar tenant_public_settings.delivery_methods
-- exclusivamente como array de objetos { id, active }, enquanto o formato
-- persistido atualmente é um array JSONB de strings. Isso rejeitou métodos
-- válidos como "retirada" com SQLSTATE 22000 e interrompeu o checkout antes
-- da persistência do pedido.
--
-- Correção mínima:
-- Recriar apenas create_order_checkout_internal preservando toda a lógica
-- vigente e aceitando, na validação de delivery_methods, tanto:
--   1) strings legadas/canônicas atuais; quanto
--   2) objetos estruturados { id, active }.
-- =============================================================================

BEGIN;

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
  v_persisted_buyer_user_id UUID := NULL;

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

  -- 2. Resolução do Tenant Ativo e Configurações Comerciais
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
    RAISE EXCEPTION 'A loja "%" está temporariamente desativada para novos pedidos.', p_tenant_slug USING ERRCODE = '22000';
  END IF;

  -- 3. Checagem de Idempotência Preliminar (Fast-Path)
  SELECT to_jsonb(o.*) INTO v_existing_order
  FROM public.orders o
  WHERE o.tenant_id = v_tenant_id AND o.idempotency_key = p_idempotency_key;

  IF v_existing_order IS NOT NULL THEN
    RETURN v_existing_order;
  END IF;

  -- 4. Validação de Método de Entrega contra Métodos Ativos da Loja
  -- Compatibilidade forward-only:
  -- - formato legado/canônico atual: ["retirada", "entrega", ...]
  -- - formato futuro estruturado: [{"id":"retirada","active":true}, ...]
  IF v_delivery_methods IS NOT NULL AND jsonb_typeof(v_delivery_methods) = 'array' AND jsonb_array_length(v_delivery_methods) > 0 THEN
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_delivery_methods) dm
      WHERE (
        jsonb_typeof(dm) = 'string'
        AND (dm #>> '{}') = trim(p_delivery_method)
      )
      OR (
        jsonb_typeof(dm) = 'object'
        AND dm->>'id' = trim(p_delivery_method)
        AND COALESCE((dm->>'active')::boolean, true) = true
      )
    ) THEN
      RAISE EXCEPTION 'O método de entrega "%" não está ativo ou não é aceito por esta loja.', p_delivery_method USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 5. Resolução Opcional de Vendedor (Vínculo Seguro)
  IF p_seller_code IS NOT NULL AND trim(p_seller_code) <> '' THEN
    SELECT u.id, u.seller_code INTO v_seller_id, v_seller_code
    FROM public.tenant_users u
    WHERE u.tenant_id = v_tenant_id 
      AND u.seller_code = trim(p_seller_code)
      AND u.role = 'sales_rep'
      AND u.status = 'active'
    LIMIT 1;

    IF v_seller_id IS NULL THEN
      v_seller_code := trim(p_seller_code);
    END IF;
  END IF;

  -- 6. Validação e Construção de Snapshot de Cliente
  IF p_shopping_mode = 'wholesale' THEN
    IF NOT COALESCE(v_allow_b2b_mode, false) THEN
      RAISE EXCEPTION 'A modalidade Atacado (B2B) não está habilitada para esta loja.' USING ERRCODE = '22000';
    END IF;

    IF p_buyer_user_id IS NULL THEN
      RAISE EXCEPTION 'Pedidos na modalidade Atacado exigem a identificação autenticada do comprador.' USING ERRCODE = '42501';
    END IF;

    SELECT 
      c.status,
      c.legal_name,
      c.trade_name,
      c.cnpj,
      c.phone,
      c.email
    INTO v_wholesale_cust
    FROM public.wholesale_customers c
    WHERE c.tenant_id = v_tenant_id
      AND c.user_id = p_buyer_user_id
    LIMIT 1;

    IF v_wholesale_cust.status IS NULL THEN
      RAISE EXCEPTION 'Comprador não cadastrado como cliente de atacado para esta loja.' USING ERRCODE = '42501';
    END IF;

    IF v_wholesale_cust.status <> 'approved' THEN
      RAISE EXCEPTION 'Cadastro de atacado do comprador ainda não foi aprovado para efetuar compras.' USING ERRCODE = '42501';
    END IF;

    -- Derivação estrita do buyer_user_id a ser persistido
    v_persisted_buyer_user_id := p_buyer_user_id;

    -- Snapshot oficial e imutável para compras de atacado
    v_customer_snapshot := jsonb_build_object(
      'type', 'PJ',
      'name', COALESCE(NULLIF(trim(v_wholesale_cust.trade_name), ''), trim(v_wholesale_cust.legal_name)),
      'companyName', trim(v_wholesale_cust.legal_name),
      'document', trim(v_wholesale_cust.cnpj),
      'phone', COALESCE(NULLIF(trim(p_customer->>'phone'), ''), trim(v_wholesale_cust.phone)),
      'email', COALESCE(NULLIF(trim(p_customer->>'email'), ''), trim(v_wholesale_cust.email))
    );
  ELSE
    -- Retail: buyer_user_id é estritamente NULL
    v_persisted_buyer_user_id := NULL;

    IF p_customer IS NULL OR jsonb_typeof(p_customer) <> 'object' THEN
      RAISE EXCEPTION 'Dados do cliente são obrigatórios no varejo.' USING ERRCODE = '22000';
    END IF;

    IF p_customer ? 'name' AND jsonb_typeof(p_customer->'name') <> 'null' THEN
      IF jsonb_typeof(p_customer->'name') <> 'string' THEN
        RAISE EXCEPTION 'Nome do cliente deve ser texto.' USING ERRCODE = '22000';
      END IF;
      v_cust_name := trim(p_customer->>'name');
      IF v_cust_name = '' THEN
        RAISE EXCEPTION 'Nome do cliente é obrigatório no varejo.' USING ERRCODE = '22000';
      END IF;
      IF length(v_cust_name) > 120 THEN
        RAISE EXCEPTION 'Nome do cliente excede o limite máximo de 120 caracteres.' USING ERRCODE = '22000';
      END IF;
    ELSE
      RAISE EXCEPTION 'Nome do cliente é obrigatório no varejo.' USING ERRCODE = '22000';
    END IF;

    IF p_customer ? 'phone' AND jsonb_typeof(p_customer->'phone') <> 'null' THEN
      IF jsonb_typeof(p_customer->'phone') <> 'string' THEN
        RAISE EXCEPTION 'Telefone do cliente deve ser texto.' USING ERRCODE = '22000';
      END IF;
      v_cust_phone := trim(p_customer->>'phone');
      IF v_cust_phone = '' THEN
        RAISE EXCEPTION 'Telefone do cliente é obrigatório no varejo.' USING ERRCODE = '22000';
      END IF;
      IF length(v_cust_phone) > 40 THEN
        RAISE EXCEPTION 'Telefone do cliente excede o limite máximo de 40 caracteres.' USING ERRCODE = '22000';
      END IF;
    ELSE
      RAISE EXCEPTION 'Telefone do cliente é obrigatório no varejo.' USING ERRCODE = '22000';
    END IF;

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
        RAISE EXCEPTION 'Razão social do cliente deve ser texto.' USING ERRCODE = '22000';
      END IF;
      v_cust_comp_name := NULLIF(trim(p_customer->>'companyName'), '');
      IF v_cust_comp_name IS NOT NULL AND length(v_cust_comp_name) > 160 THEN
        RAISE EXCEPTION 'Razão social do cliente excede o limite máximo de 160 caracteres.' USING ERRCODE = '22000';
      END IF;
    ELSE
      v_cust_comp_name := NULL;
    END IF;

    IF p_customer ? 'type' AND jsonb_typeof(p_customer->'type') <> 'null' THEN
      IF jsonb_typeof(p_customer->'type') <> 'string' THEN
        RAISE EXCEPTION 'Tipo de cliente deve ser texto (PF ou PJ).' USING ERRCODE = '22000';
      END IF;
      v_cust_type := trim(p_customer->>'type');
      IF v_cust_type NOT IN ('PF', 'PJ') THEN
        RAISE EXCEPTION 'Tipo de cliente inválido (deve ser PF ou PJ).' USING ERRCODE = '22000';
      END IF;
    ELSE
      v_cust_type := 'PF';
    END IF;

    v_customer_snapshot := jsonb_build_object(
      'type', v_cust_type,
      'name', v_cust_name,
      'phone', v_cust_phone,
      'email', v_cust_email,
      'document', v_cust_doc,
      'companyName', v_cust_comp_name
    );
  END IF;

  -- 7. Validação e Construção de Snapshot Canônico do Endereço de Entrega
  IF p_shipping_address IS NULL OR jsonb_typeof(p_shipping_address) <> 'object' THEN
    RAISE EXCEPTION 'Endereço de entrega é obrigatório.' USING ERRCODE = '22000';
  END IF;

  IF p_shipping_address ? 'street' AND jsonb_typeof(p_shipping_address->'street') <> 'null' THEN
    IF jsonb_typeof(p_shipping_address->'street') <> 'string' THEN
      RAISE EXCEPTION 'Logradouro/rua do endereço deve ser texto.' USING ERRCODE = '22000';
    END IF;
    v_ship_street := trim(p_shipping_address->>'street');
    IF v_ship_street = '' THEN
      RAISE EXCEPTION 'Logradouro/rua do endereço é obrigatório.' USING ERRCODE = '22000';
    END IF;
    IF length(v_ship_street) > 200 THEN
      RAISE EXCEPTION 'Logradouro/rua do endereço excede o limite máximo de 200 caracteres.' USING ERRCODE = '22000';
    END IF;
  ELSE
    RAISE EXCEPTION 'Logradouro/rua do endereço é obrigatório.' USING ERRCODE = '22000';
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
      RAISE EXCEPTION 'Quantidade de item deve ser pelo menos 1.' USING ERRCODE = '22000';
    END IF;

    IF v_raw_item ? 'selectedVariant' AND jsonb_typeof(v_raw_item->'selectedVariant') <> 'null' THEN
      IF jsonb_typeof(v_raw_item->'selectedVariant') <> 'string' THEN
        RAISE EXCEPTION 'Variante do produto deve ser texto.' USING ERRCODE = '22000';
      END IF;
      v_item_variant := NULLIF(trim(v_raw_item->>'selectedVariant'), '');
      IF v_item_variant IS NOT NULL AND length(v_item_variant) > 120 THEN
        RAISE EXCEPTION 'Variante do produto excede o limite máximo de 120 caracteres.' USING ERRCODE = '22000';
      END IF;
    ELSE
      v_item_variant := NULL;
    END IF;

    -- Consulta o produto sob tenant_id com trava de integridade
    SELECT 
      p.id, 
      p.name, 
      p.sku, 
      p.unit, 
      p.images, 
      p.price, 
      p.promotional_price, 
      p.wholesale_price, 
      p.min_order_quantity, 
      p.stock, 
      p.active,
      p.deleted_at
    INTO v_prod
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

      -- Resolução de Preço por Volume (Tier) ou Wholesale Base
      SELECT t.price INTO v_item_unit_price
      FROM public.wholesale_tiers t
      WHERE t.product_id = v_prod.id AND t.min_quantity <= v_item_qty
      ORDER BY t.min_quantity DESC
      LIMIT 1;

      IF v_item_unit_price IS NULL THEN
        IF v_prod.wholesale_price IS NOT NULL THEN
          v_item_unit_price := v_prod.wholesale_price;
        ELSE
          v_item_unit_price := COALESCE(v_prod.promotional_price, v_prod.price);
        END IF;
      END IF;
    ELSE
      -- Varejo: Preço promocional ou tabela regular
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
      0.00,
      v_subtotal,
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

-- Reafirmação explícita de menor privilégio.
REVOKE ALL ON FUNCTION public.create_order_checkout_internal(
  TEXT, UUID, TEXT, JSONB, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_order_checkout_internal(
  TEXT, UUID, TEXT, JSONB, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, UUID
) TO service_role;

COMMENT ON FUNCTION public.create_order_checkout_internal IS
'Criação transacional de pedidos via Edge Gateway server-side; delivery_methods compatível com arrays de strings e objetos {id, active}.';

COMMIT;
