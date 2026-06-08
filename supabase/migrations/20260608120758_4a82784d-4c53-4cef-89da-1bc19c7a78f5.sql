
-- Multiple source channels
CREATE TABLE IF NOT EXISTS public.bot_source_channels (
  chat_id bigint PRIMARY KEY,
  username text,
  title text,
  added_by bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bot_source_channels TO service_role;
ALTER TABLE public.bot_source_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.bot_source_channels FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Query cache for pagination (short ids in callback_data)
CREATE TABLE IF NOT EXISTS public.query_cache (
  id text PRIMARY KEY,
  query text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.query_cache TO service_role;
ALTER TABLE public.query_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.query_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Backfill existing single source channel into the new table (idempotent)
INSERT INTO public.bot_source_channels (chat_id, username, title, added_by)
SELECT source_channel_id, source_channel_username, source_channel_title, NULL
FROM public.bot_settings
WHERE source_channel_id IS NOT NULL
ON CONFLICT (chat_id) DO NOTHING;
