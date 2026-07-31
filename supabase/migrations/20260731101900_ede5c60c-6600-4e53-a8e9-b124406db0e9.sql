CREATE TABLE public.group_members (
  chat_id bigint NOT NULL,
  user_id bigint NOT NULL,
  last_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);
GRANT ALL ON public.group_members TO service_role;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.group_members FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX group_members_user_idx ON public.group_members (user_id);

CREATE TABLE public.user_entitlements (
  telegram_id bigint PRIMARY KEY,
  bonus_daily integer NOT NULL DEFAULT 0,
  extra_credits integer NOT NULL DEFAULT 0,
  is_premium boolean NOT NULL DEFAULT false,
  premium_since timestamptz,
  referred_by bigint,
  referrals_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.user_entitlements TO service_role;
ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.user_entitlements FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.search_usage (
  telegram_id bigint NOT NULL,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  used integer NOT NULL DEFAULT 0,
  PRIMARY KEY (telegram_id, day)
);
GRANT ALL ON public.search_usage TO service_role;
ALTER TABLE public.search_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.search_usage FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS quota_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS free_searches_per_day integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS price_single_search integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS price_daily_extra integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS price_premium integer NOT NULL DEFAULT 100;

CREATE OR REPLACE FUNCTION public.consume_search(_telegram_id bigint, _limit integer)
RETURNS TABLE (allowed boolean, used integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d date := (now() AT TIME ZONE 'utc')::date;
  cur integer;
  credits integer;
BEGIN
  INSERT INTO public.search_usage (telegram_id, day, used) VALUES (_telegram_id, d, 0)
    ON CONFLICT (telegram_id, day) DO NOTHING;
  SELECT su.used INTO cur FROM public.search_usage su WHERE su.telegram_id = _telegram_id AND su.day = d FOR UPDATE;
  IF cur < _limit THEN
    UPDATE public.search_usage su SET used = su.used + 1 WHERE su.telegram_id = _telegram_id AND su.day = d;
    RETURN QUERY SELECT true, cur + 1;
    RETURN;
  END IF;
  SELECT ue.extra_credits INTO credits FROM public.user_entitlements ue WHERE ue.telegram_id = _telegram_id FOR UPDATE;
  IF credits IS NOT NULL AND credits > 0 THEN
    UPDATE public.user_entitlements ue SET extra_credits = ue.extra_credits - 1, updated_at = now()
      WHERE ue.telegram_id = _telegram_id;
    RETURN QUERY SELECT true, cur;
    RETURN;
  END IF;
  RETURN QUERY SELECT false, cur;
END;
$$;