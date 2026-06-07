
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Settings (singleton row id=1)
CREATE TABLE public.bot_settings (
  id INT PRIMARY KEY DEFAULT 1,
  source_channel_id BIGINT,
  source_channel_username TEXT,
  source_channel_title TEXT,
  required_channel_id BIGINT,
  required_channel_username TEXT,
  required_channel_title TEXT,
  required_channel_invite_link TEXT,
  updates_channel_url TEXT,
  support_chat_url TEXT DEFAULT 'https://t.me/Hsshsusudjd',
  builder_username TEXT DEFAULT '@Hsshsusudjd',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bot_settings_singleton CHECK (id = 1)
);
GRANT ALL ON public.bot_settings TO service_role;
ALTER TABLE public.bot_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.bot_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
INSERT INTO public.bot_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Movies
CREATE TABLE public.movies (
  id BIGSERIAL PRIMARY KEY,
  source_channel_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  title TEXT NOT NULL,
  file_unique_id TEXT,
  file_type TEXT,
  duration INT,
  file_size BIGINT,
  raw_caption TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_channel_id, message_id)
);
GRANT ALL ON public.movies TO service_role;
CREATE INDEX movies_title_trgm ON public.movies USING GIN (title gin_trgm_ops);
CREATE INDEX movies_caption_trgm ON public.movies USING GIN (raw_caption gin_trgm_ops);
ALTER TABLE public.movies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.movies FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Users (private chat)
CREATE TABLE public.bot_users (
  telegram_id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  language_code TEXT,
  is_blocked BOOLEAN NOT NULL DEFAULT false,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.bot_users TO service_role;
ALTER TABLE public.bot_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.bot_users FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Groups
CREATE TABLE public.bot_groups (
  chat_id BIGINT PRIMARY KEY,
  title TEXT,
  type TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.bot_groups TO service_role;
ALTER TABLE public.bot_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.bot_groups FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Star payments
CREATE TABLE public.star_payments (
  id BIGSERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  stars_amount INT NOT NULL,
  telegram_payment_charge_id TEXT UNIQUE,
  telegram_provider_charge_id TEXT,
  payload TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.star_payments TO service_role;
ALTER TABLE public.star_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.star_payments FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Broadcast log
CREATE TABLE public.broadcast_log (
  id BIGSERIAL PRIMARY KEY,
  target TEXT NOT NULL,
  message_text TEXT,
  total INT NOT NULL DEFAULT 0,
  sent INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.broadcast_log TO service_role;
ALTER TABLE public.broadcast_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.broadcast_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Admin session state (for multi-step admin flows)
CREATE TABLE public.admin_state (
  telegram_id BIGINT PRIMARY KEY,
  state TEXT,
  data JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.admin_state TO service_role;
ALTER TABLE public.admin_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.admin_state FOR ALL TO service_role USING (true) WITH CHECK (true);
