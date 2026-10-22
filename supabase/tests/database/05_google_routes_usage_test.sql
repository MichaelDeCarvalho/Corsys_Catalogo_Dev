BEGIN;
TRUNCATE private.google_routes_usage;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.reserve_google_routes_attempt(); RAISE EXCEPTION 'anon reservation allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.reserve_google_routes_attempt(); RAISE EXCEPTION 'buyer reservation allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 FOR i IN 1..250 LOOP
  UPDATE private.google_routes_burst SET window_started_at=clock_timestamp()-interval '61 seconds';
  IF NOT public.reserve_google_routes_attempt() THEN RAISE EXCEPTION 'early day denial'; END IF;
 END LOOP;
 IF public.reserve_google_routes_attempt() THEN RAISE EXCEPTION '251st allowed'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM private.google_routes_usage WHERE attempts <> 250) THEN RAISE EXCEPTION 'counter mismatch'; END IF;
 UPDATE private.google_routes_usage SET attempts=0 WHERE period_kind='day';
 UPDATE private.google_routes_usage SET attempts=7500 WHERE period_kind='month';
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF public.reserve_google_routes_attempt() THEN RAISE EXCEPTION 'monthly limit ignored'; END IF;
 BEGIN UPDATE private.google_routes_usage SET attempts=0; RAISE EXCEPTION 'service reset allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS Google global daily/monthly counters and role restrictions; fixtures rolled back' AS result;
