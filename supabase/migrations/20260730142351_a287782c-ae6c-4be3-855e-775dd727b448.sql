CREATE TABLE IF NOT EXISTS public.required_channels (
  chat_id bigint PRIMARY KEY,
  username text,
  title text,
  invite_link text,
  kind text NOT NULL DEFAULT 'permanent',
  expires_at timestamptz,
  added_by bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.required_channels TO service_role;
ALTER TABLE public.required_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service only" ON public.required_channels;
CREATE POLICY "service only" ON public.required_channels FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.broadcast_jobs (
  id bigserial PRIMARY KEY,
  admin_user_id bigint NOT NULL,
  admin_chat_id bigint NOT NULL,
  status_msg_id bigint,
  target text NOT NULL,
  from_chat_id bigint NOT NULL,
  message_id bigint NOT NULL,
  phase text NOT NULL DEFAULT 'groups',
  cursor_id bigint NOT NULL DEFAULT 0,
  sent integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  last_error text,
  resume_after timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS broadcast_jobs_status_idx ON public.broadcast_jobs (status, resume_after);
GRANT ALL ON public.broadcast_jobs TO service_role;
ALTER TABLE public.broadcast_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service only" ON public.broadcast_jobs;
CREATE POLICY "service only" ON public.broadcast_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);
-- end of migration
