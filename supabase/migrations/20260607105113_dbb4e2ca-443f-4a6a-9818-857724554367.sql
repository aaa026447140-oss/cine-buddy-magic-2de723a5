CREATE TABLE public.bot_admins (
  telegram_id bigint PRIMARY KEY,
  added_by bigint NOT NULL,
  expires_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bot_admins TO service_role;
ALTER TABLE public.bot_admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.bot_admins FOR ALL TO service_role USING (true) WITH CHECK (true);