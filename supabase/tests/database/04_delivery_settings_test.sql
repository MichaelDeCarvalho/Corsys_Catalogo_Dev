BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('51950000-0000-4000-8000-000000000001','item5-admin@example.invalid'),
 ('51950000-0000-4000-8000-000000000002','item5-sales@example.invalid'),
 ('51950000-0000-4000-8000-000000000003','item5-stock@example.invalid'),
 ('51950000-0000-4000-8000-000000000004','item5-platform@example.invalid');
INSERT INTO public.tenants(id,slug,name,owner_email) VALUES
 ('51950000-0000-4000-8000-000000000010','item5-test-a','Test A','test@example.invalid'),
 ('51950000-0000-4000-8000-000000000011','item5-test-b','Test B','test@example.invalid');
INSERT INTO public.tenant_public_settings(tenant_id,slug,public_name,whatsapp_number,delivery_methods) VALUES
 ('51950000-0000-4000-8000-000000000010','item5-test-a','Test A','5541999999999','["retirada"]'),
 ('51950000-0000-4000-8000-000000000011','item5-test-b','Test B','5541999999999','["retirada"]');
INSERT INTO public.tenant_users(id,tenant_id,role,name,email) VALUES
 ('51950000-0000-4000-8000-000000000001','51950000-0000-4000-8000-000000000010','tenant_admin','Test','item5-admin@example.invalid'),
 ('51950000-0000-4000-8000-000000000002','51950000-0000-4000-8000-000000000010','sales_rep','Test','item5-sales@example.invalid'),
 ('51950000-0000-4000-8000-000000000003','51950000-0000-4000-8000-000000000010','stock_manager','Test','item5-stock@example.invalid');
INSERT INTO public.platform_admins(id,email) VALUES ('51950000-0000-4000-8000-000000000004','item5-platform@example.invalid');
INSERT INTO public.tenant_delivery_settings(tenant_id) VALUES ('51950000-0000-4000-8000-000000000010'),('51950000-0000-4000-8000-000000000011');
DO $$ DECLARE config jsonb; BEGIN
 SELECT settings INTO config FROM public.tenant_delivery_settings WHERE tenant_id='51950000-0000-4000-8000-000000000010';
 IF NOT private.valid_delivery_settings(config) OR private.valid_delivery_settings('{}') OR
 private.valid_delivery_settings(jsonb_set(config,'{estimateEnabled}','true')) OR
 private.valid_delivery_settings(jsonb_set(config,'{motoCentsPerKm}','0')) OR
 private.valid_delivery_settings(jsonb_set(config,'{carCentsPerKm}','2.5')) OR
 private.valid_delivery_methods('[]') OR private.valid_delivery_methods('["wrong"]') OR
 private.valid_delivery_methods('["retirada","retirada"]') THEN RAISE EXCEPTION 'Invalid delivery contract accepted'; END IF;
 BEGIN
 UPDATE public.tenant_public_settings SET delivery_methods='[]' WHERE slug='item5-test-a';
 RAISE EXCEPTION 'Empty method config accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM settings FROM public.tenant_delivery_settings; RAISE EXCEPTION 'Anon origin leak'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.save_delivery_settings(NULL,NULL,NULL,NULL,NULL); RAISE EXCEPTION 'Anon save allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','51950000-0000-4000-8000-000000000001',true);
DO $$ DECLARE config jsonb; BEGIN
 SELECT settings INTO config FROM public.tenant_delivery_settings WHERE tenant_id='51950000-0000-4000-8000-000000000010';
 IF config IS NULL THEN RAISE EXCEPTION 'Own admin read denied'; END IF;
 IF EXISTS(SELECT 1 FROM public.tenant_delivery_settings WHERE tenant_id='51950000-0000-4000-8000-000000000011') THEN RAISE EXCEPTION 'Cross tenant leak'; END IF;
 PERFORM public.save_delivery_settings('51950000-0000-4000-8000-000000000010','["uber_moto","uber_carro"]',config,'["retirada"]',config);
 BEGIN PERFORM public.save_delivery_settings('51950000-0000-4000-8000-000000000010','["retirada"]',config,'["retirada"]',config);
 RAISE EXCEPTION 'Stale overwrite accepted'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN PERFORM public.save_delivery_settings('51950000-0000-4000-8000-000000000010','["entrega"]','{}','["uber_moto","uber_carro"]',config);
 RAISE EXCEPTION 'Invalid atomic save accepted'; EXCEPTION WHEN data_exception THEN NULL; END;
 IF (SELECT delivery_methods FROM public.tenant_public_settings WHERE slug='item5-test-a')<>'["uber_moto","uber_carro"]'::jsonb THEN RAISE EXCEPTION 'Failed save changed methods'; END IF;
 BEGIN PERFORM public.save_delivery_settings('51950000-0000-4000-8000-000000000011','["entrega"]',config,'["retirada"]',config);
 RAISE EXCEPTION 'Cross tenant save allowed'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','51950000-0000-4000-8000-000000000002',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.tenant_delivery_settings) THEN RAISE EXCEPTION 'Sales origin leak'; END IF;
 BEGIN PERFORM public.save_delivery_settings('51950000-0000-4000-8000-000000000010','["retirada"]','{}','["uber_moto","uber_carro"]',NULL);
 RAISE EXCEPTION 'Sales save allowed'; EXCEPTION WHEN serialization_failure THEN NULL; END; END $$;
SELECT set_config('request.jwt.claim.sub','51950000-0000-4000-8000-000000000003',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.tenant_delivery_settings) THEN RAISE EXCEPTION 'Stock origin leak'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','51950000-0000-4000-8000-000000000004',true);
DO $$ DECLARE config jsonb; BEGIN
 SELECT settings INTO config FROM public.tenant_delivery_settings WHERE tenant_id='51950000-0000-4000-8000-000000000011';
 PERFORM public.save_delivery_settings('51950000-0000-4000-8000-000000000011','["entrega"]',config,'["retirada"]',config);
END $$;
RESET ROLE;
DO $$ BEGIN
 BEGIN PERFORM public.create_order_checkout_internal('item5-test-a',gen_random_uuid(),'retail','[{"productId":"51950000-0000-4000-8000-000000000020","quantity":1}]','{"type":"PF","name":"Synthetic","phone":"41999999999","document":"52998224725"}','{"street":"Synthetic"}','pix','retirada');
 RAISE EXCEPTION 'Disabled method accepted'; EXCEPTION WHEN data_exception THEN NULL; END;
END $$;
ROLLBACK;
SELECT 'PASS: delivery constraints, atomic save, stale writes, role isolation and checkout enforcement' AS result;
