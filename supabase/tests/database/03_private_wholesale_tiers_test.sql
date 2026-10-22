-- Real-role regression for migration 000020. Synthetic fixtures, rolled back.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('52000000-0000-4000-8000-000000000001','tier-admin@example.invalid'),
 ('52000000-0000-4000-8000-000000000002','tier-buyer@example.invalid');
INSERT INTO public.tenants(id,slug,name,owner_email) VALUES
 ('52000000-0000-4000-8000-000000000010','tier-test-a','QA A','qa@example.invalid'),
 ('52000000-0000-4000-8000-000000000011','tier-test-b','QA B','qa@example.invalid');
INSERT INTO public.tenant_public_settings(tenant_id,slug,public_name,whatsapp_number) VALUES
 ('52000000-0000-4000-8000-000000000010','tier-test-a','QA A','0000000000000'),
 ('52000000-0000-4000-8000-000000000011','tier-test-b','QA B','0000000000000');
INSERT INTO public.tenant_users(id,tenant_id,role,name,email) VALUES
 ('52000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000010','tenant_admin','QA','tier-admin@example.invalid');
INSERT INTO public.wholesale_customers(tenant_id,user_id,cnpj,legal_name,contact_name,email,phone,status) VALUES
 ('52000000-0000-4000-8000-000000000010','52000000-0000-4000-8000-000000000002','00000000000001','QA buyer','QA','tier-buyer@example.invalid','00000000000','approved');
INSERT INTO public.products(id,tenant_id,name,sku,category,price,stock) VALUES
 ('52000000-0000-4000-8000-000000000020','52000000-0000-4000-8000-000000000010','QA A','TIER-A','QA',20,10),
 ('52000000-0000-4000-8000-000000000021','52000000-0000-4000-8000-000000000011','QA B','TIER-B','QA',30,10);
INSERT INTO public.wholesale_tiers(product_id,min_quantity,price) VALUES
 ('52000000-0000-4000-8000-000000000020',5,15),
 ('52000000-0000-4000-8000-000000000021',5,25);

SET LOCAL ROLE anon;
DO $$ BEGIN
 PERFORM * FROM public.wholesale_tiers;
 RAISE EXCEPTION 'Anonymous tiers disclosed';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '52000000-0000-4000-8000-000000000002';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.wholesale_tiers) THEN
  RAISE EXCEPTION 'Approved buyer bypassed B2B gateway via raw tiers';
 END IF;
 IF EXISTS(SELECT 1 FROM public.products WHERE id IN
  ('52000000-0000-4000-8000-000000000020','52000000-0000-4000-8000-000000000021')) THEN
  RAISE EXCEPTION 'Buyer obtained raw product authority';
 END IF;
END $$;

SET LOCAL "request.jwt.claim.sub" = '52000000-0000-4000-8000-000000000001';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.wholesale_tiers WHERE product_id = '52000000-0000-4000-8000-000000000020') <> 1
 OR EXISTS(SELECT 1 FROM public.wholesale_tiers WHERE product_id = '52000000-0000-4000-8000-000000000021') THEN
  RAISE EXCEPTION 'Staff tier access or tenant isolation regressed';
 END IF;
 UPDATE public.products SET deleted_at=now() WHERE id='52000000-0000-4000-8000-000000000020';
 IF NOT FOUND THEN RAISE EXCEPTION 'Admin soft deletion failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE id='52000000-0000-4000-8000-000000000020' AND deleted_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Admin cannot inspect own archived product';
 END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: private tiers, approved buyer boundaries, staff tenant isolation and admin soft deletion' AS result;
