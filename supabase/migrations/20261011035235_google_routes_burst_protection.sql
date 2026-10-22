BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE private.google_routes_burst (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 window_started_at timestamptz NOT NULL,
 attempts integer NOT NULL CHECK (attempts >= 0)
);
ALTER TABLE private.google_routes_burst ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.google_routes_burst FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.reserve_google_routes_attempt() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE stamp timestamptz := clock_timestamp();
 day_start date := (stamp AT TIME ZONE 'America/Los_Angeles')::date;
 month_start date := date_trunc('month', stamp AT TIME ZONE 'America/Los_Angeles')::date;
 day_count integer; month_count integer; burst_count integer;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(511302, 250);
 INSERT INTO private.google_routes_burst VALUES (true,stamp,0) ON CONFLICT DO NOTHING;
 UPDATE private.google_routes_burst SET window_started_at=stamp, attempts=0
 WHERE window_started_at <= stamp - interval '60 seconds';
 SELECT attempts INTO burst_count FROM private.google_routes_burst WHERE singleton;
 INSERT INTO private.google_routes_usage VALUES ('day',day_start,0),('month',month_start,0) ON CONFLICT DO NOTHING;
 SELECT attempts INTO day_count FROM private.google_routes_usage WHERE period_kind='day' AND period_start=day_start;
 SELECT attempts INTO month_count FROM private.google_routes_usage WHERE period_kind='month' AND period_start=month_start;
 IF burst_count >= 10 OR day_count >= 250 OR month_count >= 7500 THEN RETURN false; END IF;
 UPDATE private.google_routes_burst SET attempts=attempts+1 WHERE singleton;
 UPDATE private.google_routes_usage SET attempts=attempts+1
 WHERE (period_kind='day' AND period_start=day_start) OR (period_kind='month' AND period_start=month_start);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.reserve_google_routes_attempt() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_google_routes_attempt() TO service_role;
COMMENT ON FUNCTION public.reserve_google_routes_attempt() IS 'Server-only global reservation: 10 attempts per 60-second window, 250/day,7500/month. No refunds on failed provider calls.';
COMMIT;
