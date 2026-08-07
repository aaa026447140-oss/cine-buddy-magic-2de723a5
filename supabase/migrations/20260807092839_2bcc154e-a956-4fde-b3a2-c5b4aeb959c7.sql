ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS price_premium_year integer NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS price_premium_forever integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS enable_single boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_daily boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_premium boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_premium_year boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_premium_forever boolean NOT NULL DEFAULT true;