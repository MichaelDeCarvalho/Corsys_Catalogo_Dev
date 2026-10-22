-- Item 5. Forward-only; existing checkout RPC and applied migrations unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE FUNCTION private.valid_delivery_methods(methods jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 IF methods IS NULL OR jsonb_typeof(methods)<>'array' THEN RETURN false; END IF;
 IF jsonb_array_length(methods) NOT BETWEEN 1 AND 7 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(methods) x WHERE jsonb_typeof(x)<>'string' OR
   (x #>> '{}') <> ALL(ARRAY['retirada','entrega','uber','uber_moto','uber_carro','transportadora','outro'])) THEN RETURN false; END IF;
 RETURN (SELECT count(DISTINCT x) FROM jsonb_array_elements(methods) x)=jsonb_array_length(methods);
END $$;
CREATE FUNCTION private.valid_delivery_settings(config jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE key text; address jsonb;
BEGIN
 IF config IS NULL OR jsonb_typeof(config)<>'object' THEN RETURN false; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(config))<>4 OR NOT config ? 'origin' OR jsonb_typeof(config->'estimateEnabled') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
 FOREACH key IN ARRAY ARRAY['motoCentsPerKm','carCentsPerKm'] LOOP
   IF jsonb_typeof(config->key) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
   IF (config->>key)::numeric NOT BETWEEN 1 AND 10000 OR trunc((config->>key)::numeric)<>(config->>key)::numeric THEN RETURN false; END IF;
 END LOOP;
 address:=config->'origin';
 IF address='null'::jsonb THEN RETURN NOT (config->>'estimateEnabled')::boolean; END IF;
 IF jsonb_typeof(address)<>'object' THEN RETURN false; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(address))<>6 THEN RETURN false; END IF;
 FOREACH key IN ARRAY ARRAY['street','number','neighborhood','city','state','zipCode'] LOOP
   IF jsonb_typeof(address->key) IS DISTINCT FROM 'string' OR length(trim(address->>key)) NOT BETWEEN 1 AND 200 THEN RETURN false; END IF;
 END LOOP;
 RETURN address->>'state' ~ '^[A-Z]{2}$' AND address->>'zipCode' ~ '^[0-9]{8}$';
END $$;
REVOKE ALL ON FUNCTION private.valid_delivery_methods(jsonb), private.valid_delivery_settings(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.valid_delivery_methods(jsonb), private.valid_delivery_settings(jsonb) TO authenticated, service_role;

-- Existing Hosted uses string arrays. Abort rather than silently changing unsupported legacy data.
ALTER TABLE public.tenant_public_settings ADD CONSTRAINT valid_delivery_methods CHECK(private.valid_delivery_methods(delivery_methods));
GRANT UPDATE(delivery_methods) ON public.tenant_public_settings TO authenticated;
CREATE TABLE public.tenant_delivery_settings (
 tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
 settings jsonb NOT NULL DEFAULT '{"origin":null,"motoCentsPerKm":180,"carCentsPerKm":250,"estimateEnabled":false}',
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT valid_delivery_settings CHECK(private.valid_delivery_settings(settings))
);
ALTER TABLE public.tenant_delivery_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_delivery_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tenant_delivery_settings TO authenticated;
GRANT ALL ON public.tenant_delivery_settings TO service_role;
CREATE POLICY delivery_admin_select ON public.tenant_delivery_settings FOR SELECT TO authenticated USING (
 (tenant_id=(SELECT private.get_current_tenant_id()) AND (SELECT private.has_tenant_role(ARRAY['tenant_admin']::text[]))) OR (SELECT private.is_platform_admin()));
CREATE POLICY delivery_admin_insert ON public.tenant_delivery_settings FOR INSERT TO authenticated WITH CHECK (
 (tenant_id=(SELECT private.get_current_tenant_id()) AND (SELECT private.has_tenant_role(ARRAY['tenant_admin']::text[]))) OR (SELECT private.is_platform_admin()));
CREATE POLICY delivery_admin_update ON public.tenant_delivery_settings FOR UPDATE TO authenticated USING (
 (tenant_id=(SELECT private.get_current_tenant_id()) AND (SELECT private.has_tenant_role(ARRAY['tenant_admin']::text[]))) OR (SELECT private.is_platform_admin())) WITH CHECK (
 (tenant_id=(SELECT private.get_current_tenant_id()) AND (SELECT private.has_tenant_role(ARRAY['tenant_admin']::text[]))) OR (SELECT private.is_platform_admin()));
INSERT INTO public.tenant_delivery_settings(tenant_id) SELECT tenant_id FROM public.tenant_public_settings;

-- Atomic compare-and-save under caller's RLS, no privilege bypass.
CREATE FUNCTION public.save_delivery_settings(p_tenant_id uuid, p_methods jsonb, p_settings jsonb, p_previous_methods jsonb, p_previous_settings jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE current_methods jsonb; current_settings jsonb;
BEGIN
 SELECT delivery_methods INTO current_methods FROM public.tenant_public_settings WHERE tenant_id=p_tenant_id FOR UPDATE;
 IF NOT FOUND OR current_methods IS DISTINCT FROM p_previous_methods THEN RAISE EXCEPTION 'Recarregue a configuração ou verifique sua permissão.' USING ERRCODE='40001'; END IF;
 SELECT settings INTO current_settings FROM public.tenant_delivery_settings WHERE tenant_id=p_tenant_id FOR UPDATE;
 IF current_settings IS DISTINCT FROM p_previous_settings THEN RAISE EXCEPTION 'Recarregue a configuração ou verifique sua permissão.' USING ERRCODE='40001'; END IF;
 IF NOT private.valid_delivery_methods(p_methods) OR NOT private.valid_delivery_settings(p_settings) THEN RAISE EXCEPTION 'Configuração de entrega inválida.' USING ERRCODE='22000'; END IF;
 UPDATE public.tenant_public_settings SET delivery_methods=p_methods WHERE tenant_id=p_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE='42501'; END IF;
 INSERT INTO public.tenant_delivery_settings(tenant_id,settings) VALUES(p_tenant_id,p_settings)
 ON CONFLICT(tenant_id) DO UPDATE SET settings=EXCLUDED.settings, updated_at=now();
END $$;
REVOKE ALL ON FUNCTION public.save_delivery_settings(uuid,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_delivery_settings(uuid,jsonb,jsonb,jsonb,jsonb) TO authenticated;
COMMENT ON TABLE public.tenant_delivery_settings IS 'Private commercial delivery origin and internal estimate rates. Admin-only RLS; never public origin.';
COMMIT;
