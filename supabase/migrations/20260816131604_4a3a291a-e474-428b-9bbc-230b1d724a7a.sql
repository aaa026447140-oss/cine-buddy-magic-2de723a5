ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS price_group_premium integer NOT NULL DEFAULT 3000,
  ADD COLUMN IF NOT EXISTS enable_group_premium boolean NOT NULL DEFAULT true;

ALTER TABLE public.bot_groups
  ADD COLUMN IF NOT EXISTS is_premium boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS premium_until timestamp with time zone;