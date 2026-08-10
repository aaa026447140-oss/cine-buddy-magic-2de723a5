CREATE TABLE IF NOT EXISTS public.support_topics (
  group_chat_id bigint NOT NULL,
  telegram_id bigint NOT NULL,
  topic_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_chat_id, telegram_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS support_topics_topic_idx ON public.support_topics (group_chat_id, topic_id);
GRANT ALL ON public.support_topics TO service_role;
ALTER TABLE public.support_topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.support_topics FOR ALL TO service_role USING (true) WITH CHECK (true);