REVOKE EXECUTE ON FUNCTION public.bump_search_stat(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_search_stat(text, integer) TO service_role;