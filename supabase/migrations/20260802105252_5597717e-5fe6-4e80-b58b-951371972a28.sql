REVOKE ALL ON FUNCTION public.update_movies_metric_counter() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_movies_metric_counter() TO service_role;