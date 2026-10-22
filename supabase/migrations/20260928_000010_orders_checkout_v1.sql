-- =========================================================================
-- MIGRATION 000010: ORDERS & CHECKOUT V1 (BACKEND TRANSACTIONAL CORE)
-- =========================================================================
-- Objetivo:
-- 1. Evolução de schema em public.orders para suporte a idempotência e modalidade de compra.
-- 2. Criação de sequence server-side para geração determinística e segura de order_number.
-- 3. Implementação da RPC transacional atômica internal (public.create_order_checkout_internal)
--    com autoridade financeira server-side, validação de regras B2B e estoque.
-- 4. Implementação da RPC administrativa de gestão de ciclo de vida de pedidos e estoque
--    (public.manage_order_status) com locking pessimista determinístico contra deadlocks e overselling.
-- 5. Menor privilégio: criação interna restrita a service_role; gestão restrita a authenticated (tenant_admin/stock_manager/platform_admin).
--
-- REGRA DE OURO: Migrations 000001 a 000009 permanecem estritamente intactas e congeladas.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. EVOLUÇÃO DEFENSIVA DE SCHEMA: public.orders
-- -------------------------------------------------------------------------

-- 1.1 Adiciona coluna idempotency_key com backfill defensivo e constraint UNIQUE composta
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS idempotency_key UUID DEFAULT gen_random_uuid();

ALTER TABLE public.orders
  ALTER COLUMN idempotency_key SET NOT NULL;

ALTER TABLE public.orders
  ALTER COLUMN idempotency_key DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_orders_tenant_idempotency'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT uq_orders_tenant_idempotency UNIQUE (tenant_id, idempotency_key);
  END IF;
END $$;

-- 1.2 Adiciona coluna shopping_mode ('retail' ou 'wholesale') com constraint CHECK
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shopping_mode TEXT DEFAULT 'retail';

ALTER TABLE public.orders
  ALTER COLUMN shopping_mode SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_shopping_mode'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT chk_orders_shopping_mode CHECK (shopping_mode IN ('retail', 'wholesale'));
  END IF;
END $$;

-- 1.3 Adiciona coluna delivery_method
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_method TEXT DEFAULT 'outro';

ALTER TABLE public.orders
  ALTER COLUMN delivery_method SET NOT NULL;

-- -------------------------------------------------------------------------
-- 2. SEQUENCE DEDICADA PARA ORDER NUMBER SERVER-SIDE
-- -------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.order_number_seq
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  NO MAXVALUE
  CACHE 1;

REVOKE ALL ON SEQUENCE public.order_number_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.order_number_seq TO service_role;

COMMENT ON SEQUENCE public.order_number_seq IS 'Sequência server-side para geração determinística de identificadores legíveis de pedidos.';

-- -------------------------------------------------------------------------
-- 3. RPC INTERNA: public.create_order_checkout_internal
-- -------------------------------------------------------------------------
-- Invocada EXCLUSIVAMENTE pela Edge Function 'submit-order-checkout' com service_role.
-- Executa 100% da autoridade financeira, resolução de tenant, regras B2B e checagem de estoque.
-- NÃO DECREMENTA ESTOQUE NO STATUS PENDING (proteção contra esgotamento malicioso de estoque).

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
BEGIN
  -- 1. Validações preliminares de entrada
  IF p_tenant_slug IS NULL OR trim(p_tenant_slug) = '' THEN
    RAISE EXCEPTION 'Slug do tenant é obrigatório.' USING ERRCODE = 'P0002';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Chave de idempotência é obrigatória.' USING ERRCODE = '22000';
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

  IF p_customer IS NULL OR jsonb_typeof(p_customer) <> 'object' OR
     NULLIF(trim(COALESCE(p_customer->>'name', '')), '') IS NULL OR
     NULLIF(trim(COALESCE(p_customer->>'phone', '')), '') IS NULL THEN
    RAISE EXCEPTION 'Dados de cliente inválidos (nome e telefone são obrigatórios).' USING ERRCODE = '22000';
  END IF;

  IF p_shipping_address IS NULL OR jsonb_typeof(p_shipping_address) <> 'object' OR
     NULLIF(trim(COALESCE(p_shipping_address->>'street', '')), '') IS NULL THEN
    RAISE EXCEPTION 'Endereço de entrega inválido (rua é obrigatória).' USING ERRCODE = '22000';
  END IF;

  IF p_payment_method IS NULL OR p_payment_method NOT IN ('pix', 'boleto', 'credit_card', 'cash_on_delivery') THEN
    RAISE EXCEPTION 'Forma de pagamento não suportada: %', p_payment_method USING ERRCODE = '22000';
  END IF;

  IF p_delivery_method IS NULL OR trim(p_delivery_method) = '' THEN
    RAISE EXCEPTION 'Método de entrega é obrigatório.' USING ERRCODE = '22000';
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

  -- 6. Validação B2B / Wholesale se aplicável
  IF p_shopping_mode = 'wholesale' THEN
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

    -- Snapshot oficial para identidade B2B
    v_customer_snapshot := jsonb_build_object(
      'name', v_wholesale_cust.contact_name,
      'companyName', v_wholesale_cust.legal_name,
      'tradeName', v_wholesale_cust.trade_name,
      'document', v_wholesale_cust.cnpj,
      'type', 'PJ',
      'email', COALESCE(NULLIF(trim(p_customer->>'email'), ''), v_wholesale_cust.email),
      'phone', COALESCE(NULLIF(trim(p_customer->>'phone'), ''), v_wholesale_cust.phone)
    );
  ELSE
    v_customer_snapshot := p_customer;
  END IF;

  -- 7. Validação de Unicidade de Produtos no Pedido (sem duplicatas de productId)
  SELECT count(DISTINCT (elem->>'productId')) = count(*)
  INTO v_no_duplicate_products
  FROM jsonb_array_elements(p_items) elem;

  IF NOT v_no_duplicate_products THEN
    RAISE EXCEPTION 'O pedido não pode conter produtos repetidos em linhas separadas.' USING ERRCODE = '22000';
  END IF;

  -- 8. Iteração sobre os Itens: Validação de Posse, Estoque e Recálculo Server-Side de Preços
  FOR v_raw_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_item_prod_id := (v_raw_item->>'productId')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Identificador de produto inválido no item.' USING ERRCODE = '22000';
    END;

    IF (v_raw_item->>'quantity') ~ '^[0-9]+$' THEN
      v_item_qty := (v_raw_item->>'quantity')::integer;
    ELSE
      RAISE EXCEPTION 'Quantidade de item deve ser um número inteiro positivo.' USING ERRCODE = '22000';
    END IF;

    IF v_item_qty < 1 THEN
      RAISE EXCEPTION 'Quantidade de item deve ser de pelo menos 1 unidade.' USING ERRCODE = '22000';
    END IF;

    v_item_variant := NULLIF(trim(COALESCE(v_raw_item->>'selectedVariant', '')), '');

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

  -- 9. Validação de Pedido Mínimo da Loja
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

  -- 10. Geração determinística de Order Number server-side
  v_order_number := 'PED-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0');

  -- 11. Inserção Atômica com tratamento de corrida de concorrência em Idempotência
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
      p_shipping_address,
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

COMMENT ON FUNCTION public.create_order_checkout_internal IS 'Criação transacional de pedidos via Edge Gateway server-side com autoridade financeira e checagem de estoque.';

-- -------------------------------------------------------------------------
-- 4. RPC ADMINISTRATIVA: public.manage_order_status
-- -------------------------------------------------------------------------
-- Invocada por tenant_admin, stock_manager ou platform_admin autenticados.
-- Executa trava FOR UPDATE determinística no pedido e produtos para decrementar/restaurar estoque.

CREATE OR REPLACE FUNCTION public.manage_order_status(
  p_order_id UUID,
  p_new_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_is_platform_admin BOOLEAN;
  v_order public.orders%ROWTYPE;
  v_result JSONB;
  v_item RECORD;
  v_prod_stock INTEGER;
  v_affected_rows INTEGER;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Identificador de pedido é obrigatório.' USING ERRCODE = '22000';
  END IF;

  IF p_new_status IS NULL OR p_new_status NOT IN ('pending', 'approved', 'preparing', 'dispatched', 'delivered', 'cancelled') THEN
    RAISE EXCEPTION 'Status de pedido inválido: %', p_new_status USING ERRCODE = '22000';
  END IF;

  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Acesso não autenticado.' USING ERRCODE = '42501';
  END IF;

  -- Lock pessimista na linha do pedido
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- Validação de Autorização do Caller
  v_is_platform_admin := EXISTS (
    SELECT 1 FROM public.platform_admins WHERE id = v_caller_id
  );

  IF NOT v_is_platform_admin THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tenant_users
      WHERE tenant_id = v_order.tenant_id
        AND id = v_caller_id
        AND active = true
        AND role::text IN ('tenant_admin', 'stock_manager')
    ) THEN
      RAISE EXCEPTION 'Acesso não autorizado para gerenciar pedidos deste tenant.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Estados terminais: delivered e cancelled são irreversíveis
  IF v_order.status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'Pedido já está em estado terminal (%) e não permite transição.', v_order.status USING ERRCODE = '55000';
  END IF;

  -- Idempotência de transição se o status já for o desejado
  IF v_order.status = p_new_status THEN
    RETURN to_jsonb(v_order);
  END IF;

  -- MATRIZ DE TRANSIÇÃO E CONTROLE DE ESTOQUE
  IF v_order.status = 'pending' AND p_new_status = 'approved' THEN
    -- PENDING -> APPROVED: Adquirir locks pessimistas ordenados por UUID e decrementar estoque
    FOR v_item IN
      SELECT (elem->>'productId')::uuid AS prod_id,
             (elem->>'quantity')::integer AS qty
      FROM jsonb_array_elements(v_order.items) elem
      ORDER BY (elem->>'productId')::uuid ASC
    LOOP
      -- Validação defensiva de quantidade no snapshot
      IF v_item.qty IS NULL OR v_item.qty < 1 THEN
        RAISE EXCEPTION 'Quantidade de item inválida (%) no pedido.', v_item.qty USING ERRCODE = '22000';
      END IF;

      -- Revalidação de existência, posse, atividade e soft-delete com lock FOR UPDATE
      SELECT p.stock INTO v_prod_stock
      FROM public.products p
      WHERE p.id = v_item.prod_id
        AND p.tenant_id = v_order.tenant_id
        AND p.active = true
        AND p.deleted_at IS NULL
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto % indisponível, inativo ou excluído durante a aprovação.', v_item.prod_id USING ERRCODE = 'P0002';
      END IF;

      IF v_prod_stock < v_item.qty THEN
        RAISE EXCEPTION 'Estoque insuficiente para aprovação do item (Disponível: %, Solicitado: %).',
          v_prod_stock, v_item.qty USING ERRCODE = '55P03';
      END IF;

      UPDATE public.products
      SET stock = stock - v_item.qty,
          updated_at = now()
      WHERE id = v_item.prod_id AND tenant_id = v_order.tenant_id;

      GET DIAGNOSTICS v_affected_rows = ROW_COUNT;
      IF v_affected_rows <> 1 THEN
        RAISE EXCEPTION 'Falha ao debitar estoque do produto % (linhas afetadas: %).', v_item.prod_id, v_affected_rows USING ERRCODE = '55000';
      END IF;
    END LOOP;

    UPDATE public.orders
    SET status = 'approved',
        updated_at = now()
    WHERE id = p_order_id
    RETURNING to_jsonb(public.orders.*) INTO v_result;

    RETURN v_result;

  ELSIF v_order.status = 'pending' AND p_new_status = 'cancelled' THEN
    -- PENDING -> CANCELLED: Estoque nunca foi decrementado, apenas atualiza status
    UPDATE public.orders
    SET status = 'cancelled',
        updated_at = now()
    WHERE id = p_order_id
    RETURNING to_jsonb(public.orders.*) INTO v_result;

    RETURN v_result;

  ELSIF v_order.status = 'approved' AND p_new_status = 'preparing' THEN
    -- APPROVED -> PREPARING: Estoque já debitado, apenas atualiza status
    UPDATE public.orders
    SET status = 'preparing',
        updated_at = now()
    WHERE id = p_order_id
    RETURNING to_jsonb(public.orders.*) INTO v_result;

    RETURN v_result;

  ELSIF (v_order.status = 'approved' OR v_order.status = 'preparing') AND p_new_status = 'cancelled' THEN
    -- APPROVED/PREPARING -> CANCELLED: Restaurar estoque dos produtos exatamente uma vez
    FOR v_item IN
      SELECT (elem->>'productId')::uuid AS prod_id,
             (elem->>'quantity')::integer AS qty
      FROM jsonb_array_elements(v_order.items) elem
      ORDER BY (elem->>'productId')::uuid ASC
    LOOP
      -- Validação defensiva de quantidade no snapshot
      IF v_item.qty IS NULL OR v_item.qty < 1 THEN
        RAISE EXCEPTION 'Quantidade de item inválida (%) no pedido.', v_item.qty USING ERRCODE = '22000';
      END IF;

      -- Validação de existência do produto no tenant antes da restauração
      PERFORM 1
      FROM public.products p
      WHERE p.id = v_item.prod_id AND p.tenant_id = v_order.tenant_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto % não encontrado para o tenant durante o cancelamento.', v_item.prod_id USING ERRCODE = 'P0002';
      END IF;

      UPDATE public.products
      SET stock = stock + v_item.qty,
          updated_at = now()
      WHERE id = v_item.prod_id AND tenant_id = v_order.tenant_id;

      GET DIAGNOSTICS v_affected_rows = ROW_COUNT;
      IF v_affected_rows <> 1 THEN
        RAISE EXCEPTION 'Falha ao restaurar estoque do produto % (linhas afetadas: %).', v_item.prod_id, v_affected_rows USING ERRCODE = '55000';
      END IF;
    END LOOP;

    UPDATE public.orders
    SET status = 'cancelled',
        updated_at = now()
    WHERE id = p_order_id
    RETURNING to_jsonb(public.orders.*) INTO v_result;

    RETURN v_result;

  ELSIF v_order.status = 'preparing' AND p_new_status = 'dispatched' THEN
    -- PREPARING -> DISPATCHED: Não altera estoque
    UPDATE public.orders
    SET status = 'dispatched',
        updated_at = now()
    WHERE id = p_order_id
    RETURNING to_jsonb(public.orders.*) INTO v_result;

    RETURN v_result;

  ELSIF v_order.status = 'dispatched' AND p_new_status = 'delivered' THEN
    -- DISPATCHED -> DELIVERED: Terminal
    UPDATE public.orders
    SET status = 'delivered',
        updated_at = now()
    WHERE id = p_order_id
    RETURNING to_jsonb(public.orders.*) INTO v_result;

    RETURN v_result;

  ELSE
    RAISE EXCEPTION 'Transição de status inválida de "%" para "%".',
      v_order.status, p_new_status USING ERRCODE = '22000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.manage_order_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_order_status(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.manage_order_status IS 'Gestão administrativa de status de pedidos com trava de estoque e restauração atômica em cancelamentos.';
