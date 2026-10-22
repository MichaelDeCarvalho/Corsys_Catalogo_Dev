-- Corsys.Catálogo 000024 — shipping fee support, requires 000023.
-- Corrected BEFORE any Hosted application. Do not modify after deployment.
-- Extend by wrapping the frozen checkout instead of reimplementing its business rules.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF to_regprocedure('private.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)') IS NULL
     OR to_regprocedure('public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Migration 000023 must be applied before 000024';
  END IF;
  IF to_regprocedure('public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,numeric,text,text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Shipping checkout signature already exists: reconcile migrations first';
  END IF;
END
$preflight$;

-- Invoked ONLY from the new authorized public wrapper. The 000023 internal
-- function remains the single source for authoritative prices and input rules.
CREATE FUNCTION private.create_order_checkout_with_shipping(
  p_tenant_slug text, p_idempotency_key uuid, p_shopping_mode text,
  p_items jsonb, p_customer jsonb, p_shipping_address jsonb,
  p_payment_method text, p_delivery_method text, p_shipping_fee numeric(10,2),
  p_notes text DEFAULT NULL, p_seller_code text DEFAULT NULL,
  p_buyer_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $internal$
DECLARE
  v_tenant_id uuid;
  v_existing boolean;
  v_order jsonb;
BEGIN
  IF p_shipping_fee IS NULL OR p_shipping_fee < 0 THEN
    RAISE EXCEPTION 'Taxa de frete inválida.' USING ERRCODE = '22000';
  END IF;

  SELECT t.id INTO v_tenant_id
  FROM public.tenants t
  JOIN public.tenant_public_settings s ON s.tenant_id = t.id
  WHERE (s.slug = btrim(p_tenant_slug) OR t.slug = btrim(p_tenant_slug))
    AND t.status = 'active'
  LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Loja indisponível.' USING ERRCODE = 'P0002';
  END IF;

  -- Called while the public wrapper holds its tenant/idempotency advisory lock.
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.tenant_id = v_tenant_id AND o.idempotency_key = p_idempotency_key
  ) INTO v_existing;

  v_order := private.create_order_checkout_internal(
    p_tenant_slug, p_idempotency_key, p_shopping_mode, p_items,
    p_customer, p_shipping_address, p_payment_method, p_delivery_method,
    p_notes, p_seller_code, p_buyer_user_id
  );

  -- Preserve the original receipt, shipping fee and total on idempotent replay.
  IF v_existing THEN RETURN v_order; END IF;

  -- The old checkout inserted the order with shipping_fee=0.00. Both insert
  -- and this update are inside the same transaction; an error rolls back both.
  UPDATE public.orders o
  SET shipping_fee = p_shipping_fee,
      total = pg_catalog.round(o.subtotal - o.discount + p_shipping_fee, 2)
  WHERE o.id = (v_order->>'id')::uuid
    AND o.tenant_id = v_tenant_id
    AND o.idempotency_key = p_idempotency_key
  RETURNING to_jsonb(o.*) INTO v_order;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Falha ao persistir frete no pedido.' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_order;
END
$internal$;

REVOKE ALL ON FUNCTION private.create_order_checkout_with_shipping(
  text,uuid,text,jsonb,jsonb,jsonb,text,text,numeric,text,text,uuid
) FROM PUBLIC, anon, authenticated, service_role;

-- Make the new p_shipping_fee REQUIRED and put it before existing optional
-- parameters. This avoids ambiguous resolution with the frozen 11-arg RPC.
CREATE FUNCTION public.create_order_checkout_internal(
  p_tenant_slug text, p_idempotency_key uuid, p_shopping_mode text,
  p_items jsonb, p_customer jsonb, p_shipping_address jsonb,
  p_payment_method text, p_delivery_method text, p_shipping_fee numeric(10,2),
  p_notes text DEFAULT NULL, p_seller_code text DEFAULT NULL,
  p_buyer_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $wrapper$
DECLARE
  v_tenant_id uuid;
  v_b2b_enabled boolean;
  v_existing_mode text;
  v_existing_buyer uuid;
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
  IF p_shopping_mode IS NULL OR p_shopping_mode NOT IN ('retail', 'wholesale') THEN
    RAISE EXCEPTION 'Modalidade inválida.' USING ERRCODE = '22000';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_tenant_id::text || ':' || p_idempotency_key::text, 0)
  );

  IF p_shopping_mode = 'wholesale' THEN
    IF p_buyer_user_id IS NULL OR NOT coalesce(v_b2b_enabled, false)
       OR NOT EXISTS (
         SELECT 1 FROM public.wholesale_customers wc
         WHERE wc.tenant_id = v_tenant_id AND wc.user_id = p_buyer_user_id
           AND wc.status = 'approved'
       ) THEN
      RAISE EXCEPTION 'Comprador atacadista não autorizado.' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT o.shopping_mode, o.buyer_user_id INTO v_existing_mode, v_existing_buyer
  FROM public.orders o
  WHERE o.tenant_id = v_tenant_id AND o.idempotency_key = p_idempotency_key;
  IF FOUND AND (
    v_existing_mode IS DISTINCT FROM p_shopping_mode OR
    (p_shopping_mode = 'wholesale' AND v_existing_buyer IS DISTINCT FROM p_buyer_user_id)
  ) THEN
    RAISE EXCEPTION 'Chave de pedido pertence a outra identidade.' USING ERRCODE = '42501';
  END IF;

  RETURN private.create_order_checkout_with_shipping(
    p_tenant_slug, p_idempotency_key, p_shopping_mode, p_items,
    p_customer, p_shipping_address, p_payment_method, p_delivery_method,
    p_shipping_fee, p_notes, p_seller_code, p_buyer_user_id
  );
END
$wrapper$;

REVOKE ALL ON FUNCTION public.create_order_checkout_internal(
  text,uuid,text,jsonb,jsonb,jsonb,text,text,numeric,text,text,uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_checkout_internal(
  text,uuid,text,jsonb,jsonb,jsonb,text,text,numeric,text,text,uuid
) TO service_role;
COMMENT ON FUNCTION public.create_order_checkout_internal(
  text,uuid,text,jsonb,jsonb,jsonb,text,text,numeric,text,text,uuid
) IS 'Service-role-only shipping fee checkout; delegates to frozen 000023 authorization and 000018 pricing logic.';
COMMIT;
