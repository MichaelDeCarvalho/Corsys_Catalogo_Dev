-- Synthetic fixtures only; all rows and settings are rolled back. Successful order creation
-- can consume sequence values (PostgreSQL sequences are nontransactional).
BEGIN;
SET LOCAL lock_timeout = '5s';
INSERT INTO auth.users(id,email) VALUES
 ('41840000-0000-4000-8000-000000000001','item4-admin@example.invalid'),
 ('41840000-0000-4000-8000-000000000002','item4-sales@example.invalid'),
 ('41840000-0000-4000-8000-000000000003','item4-stock@example.invalid'),
 ('41840000-0000-4000-8000-000000000004','item4-platform@example.invalid'),
 ('41840000-0000-4000-8000-000000000005','item4-buyer@example.invalid');
INSERT INTO public.tenants(id,slug,name,owner_email) VALUES
 ('41840000-0000-4000-8000-000000000010','item4-test-a','Item 4 test A','test@example.invalid'),
 ('41840000-0000-4000-8000-000000000011','item4-test-b','Item 4 test B','test@example.invalid');
INSERT INTO public.tenant_public_settings(tenant_id,slug,public_name,whatsapp_number,delivery_methods,wholesale_min_order_value) VALUES
 ('41840000-0000-4000-8000-000000000010','item4-test-a','Test A','5541999999999','["retirada"]',0),
 ('41840000-0000-4000-8000-000000000011','item4-test-b','Test B','5541999999999','["retirada"]',0);
INSERT INTO public.tenant_users(id,tenant_id,role,name,email) VALUES
 ('41840000-0000-4000-8000-000000000001','41840000-0000-4000-8000-000000000010','tenant_admin','Test','item4-admin@example.invalid'),
 ('41840000-0000-4000-8000-000000000002','41840000-0000-4000-8000-000000000010','sales_rep','Test','item4-sales@example.invalid'),
 ('41840000-0000-4000-8000-000000000003','41840000-0000-4000-8000-000000000010','stock_manager','Test','item4-stock@example.invalid');
INSERT INTO public.platform_admins(id,email) VALUES ('41840000-0000-4000-8000-000000000004','item4-platform@example.invalid');
INSERT INTO public.products(id,tenant_id,name,sku,category,price,stock) VALUES
 ('41840000-0000-4000-8000-000000000020','41840000-0000-4000-8000-000000000010','Test product','ITEM4-TEST','Test',10,100);
INSERT INTO public.wholesale_customers(tenant_id,user_id,cnpj,legal_name,contact_name,email,phone,status) VALUES
 ('41840000-0000-4000-8000-000000000010','41840000-0000-4000-8000-000000000005','11222333000181','Synthetic official company','Test','test@example.invalid','41999999999','approved');

DO $$ DECLARE config jsonb; field text; BEGIN
 SELECT checkout_fields INTO config FROM public.tenant_public_settings WHERE slug='item4-test-a';
 IF NOT private.valid_checkout_fields(config) THEN RAISE EXCEPTION 'Default invalid'; END IF;
 IF private.valid_checkout_fields(NULL) OR private.valid_checkout_fields('{}') OR
    private.valid_checkout_fields(config || '{"total":{"visible":true,"required":true}}') OR
    private.valid_checkout_fields(jsonb_set(config,'{email}','{"visible":false,"required":true}')) OR
    private.valid_checkout_fields(jsonb_set(config,'{email}','{"visible":"true","required":false}')) OR
    private.valid_checkout_fields(jsonb_set(config,'{name}','{"visible":true,"required":false}')) THEN
   RAISE EXCEPTION 'Invalid config accepted';
 END IF;
 BEGIN
   UPDATE public.tenant_public_settings SET checkout_fields=config || '{"total":{}}' WHERE slug='item4-test-a';
   RAISE EXCEPTION 'Constraint accepted unknown field';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- Real grants + RLS under PostgREST roles.
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  UPDATE public.tenant_public_settings SET checkout_fields=checkout_fields WHERE slug='item4-test-a';
  RAISE EXCEPTION 'Anon update allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','41840000-0000-4000-8000-000000000001',true);
DO $$ DECLARE n int; BEGIN
 UPDATE public.tenant_public_settings SET checkout_fields=jsonb_set(checkout_fields,'{city}','{"visible":true,"required":true}') WHERE slug='item4-test-a';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'Own admin denied'; END IF;
 UPDATE public.tenant_public_settings SET checkout_fields=checkout_fields WHERE slug='item4-test-b';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'Cross tenant update allowed'; END IF;
 BEGIN
  PERFORM public.create_order_checkout_internal('item4-test-a',gen_random_uuid(),'retail','[]','{}','{}','pix','retirada');
  RAISE EXCEPTION 'Browser RPC allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','41840000-0000-4000-8000-000000000002',true);
DO $$ DECLARE n int; BEGIN
 UPDATE public.tenant_public_settings SET checkout_fields=checkout_fields WHERE slug='item4-test-a';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'Sales rep update allowed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','41840000-0000-4000-8000-000000000003',true);
DO $$ DECLARE n int; BEGIN
 UPDATE public.tenant_public_settings SET checkout_fields=checkout_fields WHERE slug='item4-test-a';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'Stock manager update allowed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','41840000-0000-4000-8000-000000000004',true);
DO $$ DECLARE n int; BEGIN
 UPDATE public.tenant_public_settings SET checkout_fields=checkout_fields WHERE slug='item4-test-b';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'Platform admin denied'; END IF;
END $$;
RESET ROLE;

DO $$
DECLARE result jsonb; repeated jsonb; field text; policy jsonb;
 customer jsonb := '{"type":"PF","name":"Synthetic","phone":"41999999999","document":"52998224725","email":"test@example.invalid"}';
 address jsonb := '{"street":"Synthetic street","city":"Test city"}';
 items jsonb := '[{"productId":"41840000-0000-4000-8000-000000000020","quantity":1}]';
 attempt uuid := gen_random_uuid();
BEGIN
 -- Required rule is enforced by checkout, even when a direct caller bypasses the UI.
 BEGIN
  PERFORM public.create_order_checkout_internal('item4-test-a',gen_random_uuid(),'retail',items,customer,address-'city','pix','retirada');
  RAISE EXCEPTION 'Required city accepted';
 EXCEPTION WHEN SQLSTATE '22000' THEN
  IF SQLERRM NOT LIKE '%city%' THEN RAISE; END IF;
 END;
 -- Every configurable field enforces required and strips hidden data, not only city.
 SELECT checkout_fields INTO policy FROM public.tenant_public_settings WHERE slug='item4-test-a';
 FOREACH field IN ARRAY ARRAY['companyName','email','number','complement','neighborhood','city','state','zipCode','notes','sellerCode'] LOOP
  UPDATE public.tenant_public_settings SET checkout_fields=jsonb_set(policy,ARRAY[field],'{"visible":true,"required":true}') WHERE slug='item4-test-a';
  BEGIN
   PERFORM public.create_order_checkout_internal('item4-test-a',gen_random_uuid(),'retail',items,
     (customer - field) || '{"type":"PJ"}',address - field,'pix','retirada');
   RAISE EXCEPTION 'Required field accepted: %',field;
  EXCEPTION WHEN SQLSTATE '22000' THEN
   IF SQLERRM NOT LIKE '%'||field||'%' THEN RAISE; END IF;
  END;
 END LOOP;
 UPDATE public.tenant_public_settings SET checkout_fields=jsonb_set(policy,'{email}','{"visible":false,"required":false}') WHERE slug='item4-test-a';
 result := public.create_order_checkout_internal('item4-test-a',attempt,'retail',items,customer,address,'pix','retirada');
 IF result->'customer'->>'email' IS NOT NULL OR result->>'buyer_user_id' IS NOT NULL OR (result->>'total')::numeric<>10 THEN RAISE EXCEPTION 'Snapshot/price/retail buyer regression'; END IF;
 UPDATE public.tenant_public_settings SET checkout_fields=jsonb_set(checkout_fields,'{email}','{"visible":true,"required":true}') WHERE slug='item4-test-a';
 repeated := public.create_order_checkout_internal('item4-test-a',attempt,'retail',items,customer-'email',address,'pix','retirada');
 IF repeated->>'id' <> result->>'id' THEN RAISE EXCEPTION 'Idempotency regression'; END IF;
 IF (SELECT count(*) FROM public.orders WHERE tenant_id='41840000-0000-4000-8000-000000000010')<>1 THEN RAISE EXCEPTION 'Failed attempts persisted'; END IF;
 IF (SELECT stock FROM public.products WHERE id='41840000-0000-4000-8000-000000000020')<>100 THEN RAISE EXCEPTION 'Stock changed at checkout'; END IF;
 -- Hide all optional fields; previously entered or forged values must not persist.
 FOREACH field IN ARRAY ARRAY['companyName','email','number','complement','neighborhood','city','state','zipCode','notes','sellerCode'] LOOP
  UPDATE public.tenant_public_settings SET checkout_fields=jsonb_set(checkout_fields,ARRAY[field],'{"visible":false,"required":false}') WHERE slug='item4-test-a';
 END LOOP;
 result := public.create_order_checkout_internal('item4-test-a',gen_random_uuid(),'retail',items,
   customer || '{"type":"PJ","companyName":"Discard me"}',
   address || '{"number":"1","complement":"Discard","neighborhood":"Discard","state":"PR","zipCode":"80000000"}',
   'pix','retirada','Discard me','Discard me');
 IF result->'customer'->>'companyName' IS NOT NULL OR result->'customer'->>'email' IS NOT NULL OR
    result->>'notes' IS NOT NULL OR result->>'seller_code' IS NOT NULL THEN RAISE EXCEPTION 'Hidden buyer/order data persisted'; END IF;
 FOREACH field IN ARRAY ARRAY['number','complement','neighborhood','city','state','zipCode'] LOOP
  IF result->'shipping_address'->>field IS NOT NULL THEN RAISE EXCEPTION 'Hidden address data persisted: %',field; END IF;
 END LOOP;
 -- Approved B2B identity is preserved even when retail companyName is hidden.
 result := public.create_order_checkout_internal('item4-test-a',gen_random_uuid(),'wholesale',items,
   customer || '{"companyName":"Forged identity"}',address,'pix','retirada',NULL,NULL,'41840000-0000-4000-8000-000000000005');
 IF result->'customer'->>'companyName' <> 'Synthetic official company' OR
    result->>'buyer_user_id' <> '41840000-0000-4000-8000-000000000005' OR result->'customer'->>'email' IS NOT NULL THEN
  RAISE EXCEPTION 'B2B identity/hidden email regression'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: checkout constraints, required fields, hidden email, idempotency, prices, stock and real-role RLS' AS result;
