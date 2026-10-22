-- Forward-only defense against idempotency replay across wholesale buyers.
-- Existing 000018 checkout RPC is frozen and MUST NOT be edited in place.
-- This migration moves that implementation to the non-exposed private schema
-- and keeps the same public signature behind an authorization-aware wrapper.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF to_regprocedure('public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Checkout RPC baseline missing; stop migration';
  END IF;
  IF to_regprocedure('private.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Private checkout RPC name already exists; stop migration';
  END IF;
END
$preflight$;

ALTER FUNCTION public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)
  SET SCHEMA private;

-- The old implementation must not be directly callable by any API role.
REVOKE ALL ON FUNCTION private.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.create_order_checkout_internal(
  p_tenant_slug text,
  p_idempotency_key uuid,
  p_shopping_mode text,
  p_items jsonb,
  p_customer jsonb,
  p_shipping_address jsonb,
  p_payment_method text,
  p_delivery_method text,
  p_notes text DEFAULT NULL,
  p_seller_code text DEFAULT NULL,
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
  -- Resolve the same official tenant binding used by the existing checkout.
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

  -- Serialize same-tenant/key attempts before comparing ownership. Without
  -- this lock, two buyers could both pass the no-existing-row check and the
  -- second could enter the old RPC's idempotent fast-path after first commit.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_tenant_id::text || ':' || p_idempotency_key::text, 0)
  );

  -- An idempotency key never grants another buyer access to the prior order.
  -- Check the buyer's current approval even when this is a replay, including
  -- when approval was revoked after the initial checkout.
  IF p_shopping_mode = 'wholesale' THEN
    IF p_buyer_user_id IS NULL OR NOT coalesce(v_b2b_enabled, false)
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
    p_notes, p_seller_code, p_buyer_user_id
  );
END
$wrapper$;

REVOKE ALL ON FUNCTION public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)
  TO service_role;

COMMENT ON FUNCTION public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)
  IS 'Server-only wholesale authorization and same-buyer idempotency guard. Delegates to frozen private checkout implementation.';

COMMIT;
