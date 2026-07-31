CREATE TABLE IF NOT EXISTS public.search_log (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  query text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.search_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.search_log_id_seq TO service_role;
ALTER TABLE public.search_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.search_log FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_search_log_user_time ON public.search_log (telegram_id, created_at DESC);

ALTER TABLE public.bot_users
  ADD COLUMN IF NOT EXISTS blocked_until timestamptz,
  ADD COLUMN IF NOT EXISTS block_reason text,
  ADD COLUMN IF NOT EXISTS block_strikes integer NOT NULL DEFAULT 0;