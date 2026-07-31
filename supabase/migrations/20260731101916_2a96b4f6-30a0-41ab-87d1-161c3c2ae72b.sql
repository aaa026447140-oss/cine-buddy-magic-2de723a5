REVOKE EXECUTE ON FUNCTION public.consume_search(bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_search(bigint, integer) TO service_role;