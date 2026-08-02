
-- Keep only the 10 most recent searches per user
CREATE OR REPLACE FUNCTION public.trim_search_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.search_log sl
  WHERE sl.telegram_id = NEW.telegram_id
    AND sl.id NOT IN (
      SELECT id FROM public.search_log
      WHERE telegram_id = NEW.telegram_id
      ORDER BY id DESC
      LIMIT 10
    );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_trim_search_log ON public.search_log;
CREATE TRIGGER trg_trim_search_log
AFTER INSERT ON public.search_log
FOR EACH ROW EXECUTE FUNCTION public.trim_search_log();

-- Periodic purge of non-critical, ephemeral log data only
CREATE OR REPLACE FUNCTION public.purge_bot_logs()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_cache int; c_bl int; c_jobs int; c_usage int;
BEGIN
  DELETE FROM public.query_cache WHERE created_at < now() - interval '24 hours';
  GET DIAGNOSTICS c_cache = ROW_COUNT;

  DELETE FROM public.broadcast_log WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS c_bl = ROW_COUNT;

  DELETE FROM public.broadcast_jobs
    WHERE status IN ('done','failed','cancelled') AND updated_at < now() - interval '7 days';
  GET DIAGNOSTICS c_jobs = ROW_COUNT;

  DELETE FROM public.search_usage WHERE day < (now() AT TIME ZONE 'utc')::date - 30;
  GET DIAGNOSTICS c_usage = ROW_COUNT;

  RETURN json_build_object('query_cache', c_cache, 'broadcast_log', c_bl,
                           'broadcast_jobs', c_jobs, 'search_usage', c_usage);
END;
$$;

REVOKE ALL ON FUNCTION public.purge_bot_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_bot_logs() TO service_role;
REVOKE ALL ON FUNCTION public.trim_search_log() FROM PUBLIC, anon, authenticated;
