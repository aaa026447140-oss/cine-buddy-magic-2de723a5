CREATE TABLE public.blocked_words (
  word text PRIMARY KEY,
  added_by bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.blocked_words TO service_role;
ALTER TABLE public.blocked_words ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.blocked_words FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.blocked_words (word) VALUES
 ('פורנ'),('סקס'),('זיון'),('לזיין'),('עירום'),('עירומה'),('שרמוט'),('זונה'),('זונות'),
 ('זין'),('אורגזמ'),('אונן'),('מציצה'),('אנאלי'),('חשפנ'),('למבוגרים בלבד'),
 ('porn'),('porno'),('pornhub'),('xxx'),('xnxx'),('xvideos'),('sex'),('sexy'),('nude'),
 ('nudes'),('naked'),('hentai'),('milf'),('anal'),('blowjob'),('boobs'),('erotic'),
 ('camgirl'),('onlyfans'),('nsfw')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.server_metrics()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'db_bytes', pg_database_size(current_database()),
    'movies_bytes', pg_total_relation_size('public.movies'),
    'connections', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()),
    'active_queries', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active'),
    'max_connections', (SELECT setting::int FROM pg_settings WHERE name = 'max_connections'),
    'searches_last_min', (SELECT count(*) FROM public.search_log WHERE created_at > now() - interval '1 minute'),
    'searches_last_hour', (SELECT count(*) FROM public.search_log WHERE created_at > now() - interval '1 hour'),
    'searches_today', (SELECT count(*) FROM public.search_log WHERE created_at > now() - interval '24 hours'),
    'movies_count', (SELECT reltuples::bigint FROM pg_class WHERE oid = 'public.movies'::regclass),
    'users_count', (SELECT count(*) FROM public.bot_users),
    'groups_count', (SELECT count(*) FROM public.bot_groups WHERE is_active),
    'cache_hit_ratio', (SELECT COALESCE(round(100.0 * sum(blks_hit) / NULLIF(sum(blks_hit) + sum(blks_read), 0), 1), 0) FROM pg_stat_database WHERE datname = current_database())
  );
$$;