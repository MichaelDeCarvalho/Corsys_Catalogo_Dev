BEGIN;
SET LOCAL lock_timeout = '5s';
-- A single global lock serializes reservations across tenants and Edge instances.
CREATE TABLE private.google_routes_usage (
 period_kind text NOT NULL CHECK (period_kind IN ('day','month')),
 period_start date NOT NULL,
 attempts integer NOT NULL CHECK (attempts >= 0),
 PRIMARY KEY (period_kind, period_start)
);
ALTER TABLE private.google_routes_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.google_routes_usage FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reserve_google_routes_attempt() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE day_start date := (now() AT TIME ZONE 'America/Los_Angeles')::date;
 month_start date := date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles')::date;
 day_count integer; month_count integer;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(511302, 250);
 INSERT INTO private.google_routes_usage VALUES ('day',day_start,0),('month',month_start,0)
 ON CONFLICT DO NOTHING;
 SELECT attempts INTO day_count FROM private.google_routes_usage WHERE period_kind='day' AND period_start=day_start;
 SELECT attempts INTO month_count FROM private.google_routes_usage WHERE period_kind='month' AND period_start=month_start;
 IF day_count >= 250 OR month_count >= 7500 THEN RETURN false; END IF;
 UPDATE private.google_routes_usage SET attempts=attempts+1
 WHERE (period_kind='day' AND period_start=day_start) OR (period_kind='month' AND period_start=month_start);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.reserve_google_routes_attempt() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_google_routes_attempt() TO service_role;
COMMENT ON FUNCTION public.reserve_google_routes_attempt() IS 'Server-only global attempt reservation. Failed Google calls retain consumed slot. 250/day,7500/month; does not replace Google quota or shared billing checks.';
COMMIT;
