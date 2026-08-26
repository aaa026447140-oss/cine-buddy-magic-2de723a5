CREATE TABLE IF NOT EXISTS public.search_stats (
  query_norm text PRIMARY KEY,
  query text NOT NULL,
  searches bigint NOT NULL DEFAULT 0,
  found_count bigint NOT NULL DEFAULT 0,
  notfound_count bigint NOT NULL DEFAULT 0,
  last_results integer NOT NULL DEFAULT 0,
  last_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.search_stats TO service_role;

ALTER TABLE public.search_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service only" ON public.search_stats FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_search_stats_searches ON public.search_stats (searches DESC);

CREATE OR REPLACE FUNCTION public.bump_search_stat(_query text, _results integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  norm text := lower(btrim(regexp_replace(_query, '\s+', ' ', 'g')));
BEGIN
  IF norm = '' OR norm IS NULL THEN RETURN; END IF;
  INSERT INTO public.search_stats (query_norm, query, searches, found_count, notfound_count, last_results, last_at)
  VALUES (left(norm, 200), left(btrim(_query), 200), 1,
          CASE WHEN _results > 0 THEN 1 ELSE 0 END,
          CASE WHEN _results > 0 THEN 0 ELSE 1 END,
          GREATEST(_results, 0), now())
  ON CONFLICT (query_norm) DO UPDATE SET
    searches = public.search_stats.searches + 1,
    found_count = public.search_stats.found_count + CASE WHEN _results > 0 THEN 1 ELSE 0 END,
    notfound_count = public.search_stats.notfound_count + CASE WHEN _results > 0 THEN 0 ELSE 1 END,
    last_results = GREATEST(_results, 0),
    last_at = now();
END;
$$;