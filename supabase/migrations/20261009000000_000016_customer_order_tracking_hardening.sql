-- =============================================================================
-- CORSYS.CATÁLOGO — MIGRATION 000016: CUSTOMER ORDER TRACKING HARDENING (HOTFIX)
-- Data: 2026-10-08
-- Status: RELEASE CANDIDATE / HOSTED STATUS PENDING POST-SYNC VERIFICATION
-- =============================================================================
-- Princípios e Diretrizes:
-- 1. Forward-only: Migrations 000001 a 000015 permanecem estritamente intactas e congeladas.
-- 2. Menor Privilégio e Privacidade Máxima:
--    - Eliminação completa de PII (customer, customerName, shippingAddress) e IDs internos (id, tenant_id, buyer_user_id)
--      das projeções das RPCs de rastreamento do cliente.
--    - Isolamento estrito de shopping_mode:
--      * track_order_by_token_internal exige shopping_mode = 'retail'
--      * list_my_customer_orders_internal exige shopping_mode = 'wholesale'
--    - Tenant resolution histórica: não exige t.status = 'active' para viabilizar consulta de pedidos históricos.
--    - Reafirmação expressa de ACL (REVOKE ALL de PUBLIC/anon/authenticated; GRANT EXECUTE para service_role).
--    - Zero policies públicas em public.orders.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. RECRIAR RPC: public.track_order_by_token_internal
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.track_order_by_token_internal(
  p_tenant_slug TEXT,
  p_tracking_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id UUID;
  v_order RECORD;
  v_result JSONB;
BEGIN
  -- 1.1 Validações defensivas de entrada
  IF p_tenant_slug IS NULL OR trim(p_tenant_slug) = '' THEN
    RAISE EXCEPTION 'Slug do tenant é obrigatório.' USING ERRCODE = '22000';
  END IF;

  IF length(trim(p_tenant_slug)) > 120 THEN
    RAISE EXCEPTION 'Slug do tenant excede o limite máximo de 120 caracteres.' USING ERRCODE = '22000';
  END IF;

  IF p_tracking_token_hash IS NULL OR NOT (p_tracking_token_hash ~ '^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION 'Hash de token de rastreamento inválido (deve ser SHA-256 de 64 caracteres hex).' USING ERRCODE = '22000';
  END IF;

  -- 1.2 Resolução de tenant (histórico: não restringe por t.status = 'active')
  SELECT t.id INTO v_tenant_id
  FROM public.tenants t
  JOIN public.tenant_public_settings s ON s.tenant_id = t.id
  WHERE (s.slug = trim(p_tenant_slug) OR t.slug = trim(p_tenant_slug))
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Loja com identificador "%" não foi encontrada.', p_tenant_slug USING ERRCODE = 'P0002';
  END IF;

  -- 1.3 Busca restrita com shopping_mode = 'retail' e tracking_token_hash
  SELECT 
    o.order_number,
    o.status,
    o.shopping_mode,
    o.delivery_method,
    o.payment_method,
    o.items,
    o.subtotal,
    o.discount,
    o.shipping_fee,
    o.total,
    o.created_at,
    o.updated_at
  INTO v_order
  FROM public.orders o
  WHERE o.tenant_id = v_tenant_id
    AND o.tracking_token_hash = p_tracking_token_hash
    AND o.shopping_mode = 'retail'
  LIMIT 1;

  IF v_order.order_number IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado para este token de rastreamento.' USING ERRCODE = 'P0002';
  END IF;

  -- 1.4 Retorno sanitizado estrito (sem id, customer, customerName, shippingAddress, tenant_id ou internal keys)
  v_result := jsonb_build_object(
    'orderNumber', v_order.order_number,
    'status', v_order.status,
    'shoppingMode', v_order.shopping_mode,
    'deliveryMethod', v_order.delivery_method,
    'paymentMethod', v_order.payment_method,
    'items', v_order.items,
    'subtotal', v_order.subtotal,
    'discount', v_order.discount,
    'shippingFee', v_order.shipping_fee,
    'total', v_order.total,
    'createdAt', v_order.created_at,
    'updatedAt', v_order.updated_at
  );

  RETURN v_result;
END;
$$;

-- Restrito exclusivamente a service_role
REVOKE ALL ON FUNCTION public.track_order_by_token_internal(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_order_by_token_internal(TEXT, TEXT) TO service_role;
COMMENT ON FUNCTION public.track_order_by_token_internal IS 'Consulta segura de pedido de varejo por token SHA-256 sem vazamento de PII ou chaves internas.';


-- -----------------------------------------------------------------------------
-- 2. RECRIAR RPC: public.list_my_customer_orders_internal
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_customer_orders_internal(
  p_tenant_slug TEXT,
  p_buyer_user_id UUID,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id UUID;
  v_total_count INTEGER;
  v_orders JSONB;
BEGIN
  -- 2.1 Validações defensivas de entrada
  IF p_tenant_slug IS NULL OR trim(p_tenant_slug) = '' THEN
    RAISE EXCEPTION 'Slug do tenant é obrigatório.' USING ERRCODE = '22000';
  END IF;

  IF length(trim(p_tenant_slug)) > 120 THEN
    RAISE EXCEPTION 'Slug do tenant excede o limite máximo de 120 caracteres.' USING ERRCODE = '22000';
  END IF;

  IF p_buyer_user_id IS NULL THEN
    RAISE EXCEPTION 'Identificador do comprador é obrigatório.' USING ERRCODE = '22000';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'Limite de paginação deve estar entre 1 e 50.' USING ERRCODE = '22000';
  END IF;

  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Offset de paginação deve ser um número maior ou igual a zero.' USING ERRCODE = '22000';
  END IF;

  -- 2.2 Resolução de tenant (histórico: não restringe por t.status = 'active')
  SELECT t.id INTO v_tenant_id
  FROM public.tenants t
  JOIN public.tenant_public_settings s ON s.tenant_id = t.id
  WHERE (s.slug = trim(p_tenant_slug) OR t.slug = trim(p_tenant_slug))
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Loja com identificador "%" não foi encontrada.', p_tenant_slug USING ERRCODE = 'P0002';
  END IF;

  -- 2.3 Contagem de pedidos do comprador restrita a shopping_mode = 'wholesale'
  SELECT count(*) INTO v_total_count
  FROM public.orders o
  WHERE o.tenant_id = v_tenant_id
    AND o.buyer_user_id = p_buyer_user_id
    AND o.shopping_mode = 'wholesale';

  -- 2.4 Projeção de pedidos sanitizada idêntica à do varejo
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'orderNumber', o.order_number,
      'status', o.status,
      'shoppingMode', o.shopping_mode,
      'deliveryMethod', o.delivery_method,
      'paymentMethod', o.payment_method,
      'items', o.items,
      'subtotal', o.subtotal,
      'discount', o.discount,
      'shippingFee', o.shipping_fee,
      'total', o.total,
      'createdAt', o.created_at,
      'updatedAt', o.updated_at
    )
  ), '[]'::jsonb)
  INTO v_orders
  FROM (
    SELECT *
    FROM public.orders o
    WHERE o.tenant_id = v_tenant_id
      AND o.buyer_user_id = p_buyer_user_id
      AND o.shopping_mode = 'wholesale'
    ORDER BY o.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) o;

  RETURN jsonb_build_object(
    'orders', v_orders,
    'total', v_total_count,
    'limit', p_limit,
    'offset', p_offset
  );
END;
$$;

-- Restrito exclusivamente a service_role
REVOKE ALL ON FUNCTION public.list_my_customer_orders_internal(TEXT, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_customer_orders_internal(TEXT, UUID, INTEGER, INTEGER) TO service_role;
COMMENT ON FUNCTION public.list_my_customer_orders_internal IS 'Consulta paginada segura de histórico B2B sem vazamento de PII ou chaves internas.';


-- -----------------------------------------------------------------------------
-- 3. REAFIRMAÇÃO DE ACL: public.set_order_tracking_token_internal
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.set_order_tracking_token_internal(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_tracking_token_internal(UUID, UUID, TEXT) TO service_role;

COMMIT;
