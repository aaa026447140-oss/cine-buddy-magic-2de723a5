ALTER TABLE public.user_entitlements
  ADD COLUMN IF NOT EXISTS premium_until timestamptz,
  ADD COLUMN IF NOT EXISTS premium_warned_at timestamptz,
  ADD COLUMN IF NOT EXISTS premium_expired_notified_at timestamptz;

UPDATE public.user_entitlements
   SET premium_until = now() + interval '30 days'
 WHERE is_premium = true AND premium_until IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_entitlements_premium_until
  ON public.user_entitlements (premium_until) WHERE is_premium = true;