REVOKE ALL ON FUNCTION public.server_metrics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_metrics() TO service_role;