-- 000019 is reserved for the existing delivery work in the original checkout.
-- Keep archived rows visible to their tenant administrator so RLS permits soft deletion.
-- Wholesale tiers contain B2B prices and must not bypass the approved-buyer gateway.
BEGIN;
DROP POLICY IF EXISTS products_select_tenant ON public.products;
CREATE POLICY products_select_tenant ON public.products FOR SELECT TO authenticated
USING (
  (tenant_id = (SELECT private.get_current_tenant_id()) AND
    (deleted_at IS NULL OR (SELECT private.has_tenant_role(ARRAY['tenant_admin']))))
  OR (SELECT private.is_platform_admin())
);

DROP POLICY IF EXISTS wholesale_tiers_select_public ON public.wholesale_tiers;
REVOKE ALL ON public.wholesale_tiers FROM anon;
-- Existing tenant-scoped staff policies and authenticated grants remain in force.
COMMIT;
