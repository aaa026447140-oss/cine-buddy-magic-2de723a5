ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS support_group_id bigint,
  ADD COLUMN IF NOT EXISTS support_group_title text;

ALTER TABLE public.broadcast_jobs
  ADD COLUMN IF NOT EXISTS notify_chat_id bigint,
  ADD COLUMN IF NOT EXISTS notify_msg_id bigint;

CREATE TABLE public.broadcast_requests (
  id bigserial PRIMARY KEY,
  requester_id bigint NOT NULL,
  requester_chat_id bigint NOT NULL,
  target text NOT NULL,
  from_chat_id bigint NOT NULL,
  message_id bigint NOT NULL,
  preview text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.broadcast_requests TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.broadcast_requests_id_seq TO service_role;
ALTER TABLE public.broadcast_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.broadcast_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.unblock_requests (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  stars integer NOT NULL,
  permanent boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_unblock_requests_status ON public.unblock_requests (status, created_at DESC);
GRANT ALL ON public.unblock_requests TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.unblock_requests_id_seq TO service_role;
ALTER TABLE public.unblock_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.unblock_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.support_threads (
  group_chat_id bigint NOT NULL,
  group_message_id bigint NOT NULL,
  telegram_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_chat_id, group_message_id)
);
GRANT ALL ON public.support_threads TO service_role;
ALTER TABLE public.support_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.support_threads FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER update_broadcast_requests_updated_at BEFORE UPDATE ON public.broadcast_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_unblock_requests_updated_at BEFORE UPDATE ON public.unblock_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();