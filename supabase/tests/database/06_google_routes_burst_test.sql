BEGIN;
TRUNCATE private.google_routes_usage, private.google_routes_burst;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 FOR i IN 1..10 LOOP
  IF NOT public.reserve_google_routes_attempt() THEN RAISE EXCEPTION 'early burst denial'; END IF;
 END LOOP;
 IF public.reserve_google_routes_attempt() THEN RAISE EXCEPTION 'burst 11 allowed'; END IF;
 BEGIN UPDATE private.google_routes_burst SET attempts=0; RAISE EXCEPTION 'service reset allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM private.google_routes_usage WHERE attempts<>10) THEN RAISE EXCEPTION 'denied request consumed quota'; END IF;
 UPDATE private.google_routes_burst SET window_started_at=clock_timestamp()-interval '61 seconds';
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF NOT public.reserve_google_routes_attempt() THEN RAISE EXCEPTION 'expired window blocked'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS burst limit, expiry, role isolation and denied-request accounting; no Google calls' AS result;
