ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS search_group_url text,
  ADD COLUMN IF NOT EXISTS search_group_title text;