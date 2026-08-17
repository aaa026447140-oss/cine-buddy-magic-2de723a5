CREATE TABLE public.premium_plans (
  id bigserial PRIMARY KEY,
  days integer NOT NULL,
  price_stars integer NOT NULL DEFAULT 0,
  label text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.premium_plans TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.premium_plans_id_seq TO service_role;
ALTER TABLE public.premium_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.premium_plans FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE TRIGGER update_premium_plans_updated_at BEFORE UPDATE ON public.premium_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS bot_locked boolean NOT NULL DEFAULT false;