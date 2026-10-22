-- Isolated disposable PostgreSQL test of migration 000024 after 000023.
-- This file is NEVER applied to Hosted; run only on the separate staging DB.
DO $qa$
DECLARE
  old_signature text := 'public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)';
  new_signature text := 'public.create_order_checkout_internal(text,uuid,text,jsonb,jsonb,jsonb,text,text,numeric,text,text,uuid)';
  internal_signature text := 'private.create_order_checkout_with_shipping(text,uuid,text,jsonb,jsonb,jsonb,text,text,numeric,text,text,uuid)';
  id_a uuid;
  id_b uuid;
  items_a jsonb;
  ship jsonb := '{"street":"Rua Fictícia","number":"100","neighborhood":"Centro","city":"Curitiba","state":"PR","zipCode":"80000000"}'::jsonb;
  customer jsonb := '{"type":"PF","name":"Comprador QA Fictício","phone":"+5500000000000","email":"cliente@qa.invalid","document":"00000000000"}'::jsonb;
  order_a jsonb;
  replay_a jsonb;
  pickup jsonb;
  rejected boolean;
BEGIN
  IF to_regprocedure(old_signature) IS NULL OR to_regprocedure(new_signature) IS NULL OR
     to_regprocedure(internal_signature) IS NULL THEN
    RAISE EXCEPTION 'FAIL: checkout signature missing after 000023/000024';
  END IF;

  IF has_function_privilege('anon', new_signature, 'EXECUTE') OR
     has_function_privilege('authenticated', new_signature, 'EXECUTE') OR
     NOT has_function_privilege('service_role', new_signature, 'EXECUTE') OR
     has_function_privilege('service_role', internal_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: new checkout RPC grants incorrect';
  END IF;
  IF has_function_privilege('anon', old_signature, 'EXECUTE') OR
     has_function_privilege('authenticated', old_signature, 'EXECUTE') OR
     NOT has_function_privilege('service_role', old_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: original 000023 RPC grants changed';
  END IF;

  SELECT id INTO id_a FROM public.products WHERE sku = 'QA-A' LIMIT 1;
  SELECT id INTO id_b FROM public.products WHERE sku = 'QA-B' LIMIT 1;
  IF id_a IS NULL OR id_b IS NULL THEN
    RAISE EXCEPTION 'FAIL: synthetic products absent';
  END IF;

  items_a := jsonb_build_array(jsonb_build_object('productId', id_a, 'quantity', 1));

  order_a := public.create_order_checkout_internal(
    p_tenant_slug := 'corsys-catalogo-demo',
    p_idempotency_key := '910d1111-1111-4111-8111-111111111111'::uuid,
    p_shopping_mode := 'retail',
    p_items := items_a,
    p_customer := customer,
    p_shipping_address := ship,
    p_payment_method := 'pix',
    p_delivery_method := 'entrega',
    p_shipping_fee := 7.50::numeric
  );
  IF (order_a->>'subtotal')::numeric <> 30.00 OR
     (order_a->>'shipping_fee')::numeric <> 7.50 OR
     (order_a->>'total')::numeric <> 37.50 THEN
    RAISE EXCEPTION 'FAIL: persisted subtotal/shipping/total mismatch: %', order_a;
  END IF;

  replay_a := public.create_order_checkout_internal(
    p_tenant_slug := 'corsys-catalogo-demo',
    p_idempotency_key := '910d1111-1111-4111-8111-111111111111'::uuid,
    p_shopping_mode := 'retail',
    p_items := items_a,
    p_customer := customer,
    p_shipping_address := ship,
    p_payment_method := 'pix',
    p_delivery_method := 'entrega',
    p_shipping_fee := 99.00::numeric
  );
  IF (replay_a->>'id') IS DISTINCT FROM (order_a->>'id') OR
     (replay_a->>'total')::numeric <> 37.50 OR
     (replay_a->>'shipping_fee')::numeric <> 7.50 THEN
    RAISE EXCEPTION 'FAIL: idempotent replay repriced the existing order';
  END IF;

  pickup := public.create_order_checkout_internal(
    p_tenant_slug := 'corsys-catalogo-demo',
    p_idempotency_key := '920d2222-2222-4222-8222-222222222222'::uuid,
    p_shopping_mode := 'retail',
    p_items := items_a,
    p_customer := customer,
    p_shipping_address := ship,
    p_payment_method := 'pix',
    p_delivery_method := 'retirada',
    p_shipping_fee := 0.00::numeric
  );
  IF (pickup->>'shipping_fee')::numeric <> 0.00 OR
     (pickup->>'total')::numeric <> 30.00 THEN
    RAISE EXCEPTION 'FAIL: pickup should have zero fee';
  END IF;

  rejected := false;
  BEGIN
    PERFORM public.create_order_checkout_internal(
      p_tenant_slug := 'corsys-catalogo-demo',
      p_idempotency_key := '930d3333-3333-4333-8333-333333333333'::uuid,
      p_shopping_mode := 'retail',
      p_items := items_a,
      p_customer := customer,
      p_shipping_address := ship,
      p_payment_method := 'pix',
      p_delivery_method := 'entrega',
      p_shipping_fee := -0.01::numeric
    );
  EXCEPTION WHEN SQLSTATE '22000' THEN
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'FAIL: negative fee accepted'; END IF;

  rejected := false;
  BEGIN
    PERFORM public.create_order_checkout_internal(
      p_tenant_slug := 'tenant-qa-b',
      p_idempotency_key := '940d4444-4444-4444-8444-444444444444'::uuid,
      p_shopping_mode := 'retail',
      p_items := items_a,
      p_customer := customer,
      p_shipping_address := ship,
      p_payment_method := 'pix',
      p_delivery_method := 'entrega',
      p_shipping_fee := 7.50::numeric
    );
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'FAIL: product from another tenant accepted'; END IF;

  rejected := false;
  BEGIN
    PERFORM public.create_order_checkout_internal(
      p_tenant_slug := 'corsys-catalogo-demo',
      p_idempotency_key := '950d5555-5555-4555-8555-555555555555'::uuid,
      p_shopping_mode := 'wholesale',
      p_items := jsonb_build_array(jsonb_build_object('productId', id_a, 'quantity', 5)),
      p_customer := customer,
      p_shipping_address := ship,
      p_payment_method := 'pix',
      p_delivery_method := 'entrega',
      p_shipping_fee := 7.50::numeric
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'FAIL: unauthorized wholesale buyer accepted'; END IF;

  IF (SELECT count(*) FROM public.orders
      WHERE idempotency_key IN (
        '910d1111-1111-4111-8111-111111111111'::uuid,
        '920d2222-2222-4222-8222-222222222222'::uuid)) <> 2 THEN
    RAISE EXCEPTION 'FAIL: idempotency duplicate or missing order';
  END IF;
  RAISE NOTICE 'STAGING-000024 SQL PASS: grants, total, replay, pickup, tenant isolation, negative fee and unapproved B2B';
END
$qa$;
