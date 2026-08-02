CREATE TABLE public.bot_metric_counters (
  metric text PRIMARY KEY,
  value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bot_metric_counters TO service_role;
ALTER TABLE public.bot_metric_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.bot_metric_counters FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.bot_metric_counters (metric, value)
VALUES ('movies_count', (SELECT count(*) FROM public.movies));

CREATE OR REPLACE FUNCTION public.update_movies_metric_counter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.bot_metric_counters
       SET value = value + 1, updated_at = statement_timestamp()
     WHERE metric = 'movies_count';
    RETURN NEW;
  END IF;

  UPDATE public.bot_metric_counters
     SET value = GREATEST(0, value - 1), updated_at = statement_timestamp()
   WHERE metric = 'movies_count';
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_movies_metric_insert
AFTER INSERT ON public.movies
FOR EACH ROW EXECUTE FUNCTION public.update_movies_metric_counter();

CREATE TRIGGER trg_movies_metric_delete
AFTER DELETE ON public.movies
FOR EACH ROW EXECUTE FUNCTION public.update_movies_metric_counter();

CREATE INDEX idx_movies_created_at ON public.movies (created_at DESC);
CREATE INDEX idx_search_log_created_at ON public.search_log (created_at DESC);
CREATE INDEX idx_bot_users_first_seen ON public.bot_users (first_seen DESC);
CREATE INDEX idx_bot_users_last_seen ON public.bot_users (last_seen DESC);
CREATE INDEX idx_bot_users_blocked ON public.bot_users (is_blocked) WHERE is_blocked;
CREATE INDEX idx_bot_groups_active ON public.bot_groups (is_active) WHERE is_active;
CREATE INDEX idx_user_entitlements_premium ON public.user_entitlements (is_premium) WHERE is_premium;

CREATE OR REPLACE FUNCTION public.server_metrics()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  snapshot AS (
    SELECT statement_timestamp() AS captured_at
  ),
  activity AS (
    SELECT
      count(*) FILTER (WHERE datname = current_database())::bigint AS connections,
      count(*) FILTER (WHERE datname = current_database() AND state = 'active' AND pid <> pg_backend_pid())::bigint AS active_queries,
      count(*) FILTER (WHERE datname = current_database() AND state = 'idle')::bigint AS idle_conns,
      count(*) FILTER (WHERE datname = current_database() AND state = 'idle in transaction')::bigint AS idle_in_tx,
      count(*) FILTER (WHERE datname = current_database() AND wait_event_type = 'Lock')::bigint AS waiting_queries,
      COALESCE(round(EXTRACT(epoch FROM max(statement_timestamp() - query_start) FILTER (WHERE datname = current_database() AND state = 'active' AND pid <> pg_backend_pid()))::numeric, 1), 0) AS longest_query_sec
    FROM pg_stat_activity
  ),
  dbstat AS (
    SELECT
      COALESCE(temp_bytes, 0)::bigint AS temp_bytes,
      COALESCE(temp_files, 0)::bigint AS temp_files,
      COALESCE(deadlocks, 0)::bigint AS deadlocks,
      COALESCE(xact_rollback, 0)::bigint AS rollbacks,
      COALESCE(xact_commit, 0)::bigint AS commits,
      COALESCE(tup_fetched, 0)::bigint AS tuples_read,
      COALESCE(tup_inserted + tup_updated + tup_deleted, 0)::bigint AS tuples_written,
      COALESCE(blks_read, 0)::bigint AS blks_read,
      COALESCE(round(EXTRACT(epoch FROM (statement_timestamp() - stats_reset))::numeric, 0), 0) AS stats_age_sec,
      COALESCE(round(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 1), 0) AS cache_hit_ratio
    FROM pg_stat_database
    WHERE datname = current_database()
  ),
  search_counts AS (
    SELECT
      count(*) FILTER (WHERE created_at > statement_timestamp() - interval '1 minute')::bigint AS searches_last_min,
      count(*) FILTER (WHERE created_at > statement_timestamp() - interval '1 hour')::bigint AS searches_last_hour,
      count(*)::bigint AS searches_today
    FROM public.search_log
    WHERE created_at > statement_timestamp() - interval '24 hours'
  ),
  user_counts AS (
    SELECT
      count(*)::bigint AS users_count,
      count(*) FILTER (WHERE first_seen > statement_timestamp() - interval '24 hours')::bigint AS new_users_today,
      count(*) FILTER (WHERE last_seen > statement_timestamp() - interval '24 hours')::bigint AS active_users_today,
      count(*) FILTER (WHERE is_blocked)::bigint AS blocked_users
    FROM public.bot_users
  )
  SELECT json_build_object(
    'captured_at_epoch', EXTRACT(epoch FROM snapshot.captured_at)::bigint,
    'db_bytes', pg_database_size(current_database()),
    'movies_bytes', pg_total_relation_size('public.movies'),
    'movies_index_bytes', pg_indexes_size('public.movies'),
    'logs_bytes', pg_total_relation_size('public.search_log') + pg_total_relation_size('public.query_cache') + pg_total_relation_size('public.broadcast_log'),
    'users_bytes', pg_total_relation_size('public.bot_users'),
    'connections', activity.connections,
    'active_queries', activity.active_queries,
    'idle_conns', activity.idle_conns,
    'idle_in_tx', activity.idle_in_tx,
    'waiting_queries', activity.waiting_queries,
    'longest_query_sec', activity.longest_query_sec,
    'max_connections', (SELECT setting::int FROM pg_settings WHERE name = 'max_connections'),
    'shared_buffers_bytes', (SELECT setting::bigint * 8192 FROM pg_settings WHERE name = 'shared_buffers'),
    'effective_cache_bytes', (SELECT setting::bigint * 8192 FROM pg_settings WHERE name = 'effective_cache_size'),
    'work_mem_bytes', (SELECT setting::bigint * 1024 FROM pg_settings WHERE name = 'work_mem'),
    'maintenance_work_mem_bytes', (SELECT setting::bigint * 1024 FROM pg_settings WHERE name = 'maintenance_work_mem'),
    'wal_bytes', (SELECT COALESCE(sum(size), 0) FROM pg_ls_waldir()),
    'temp_bytes', dbstat.temp_bytes,
    'temp_files', dbstat.temp_files,
    'deadlocks', dbstat.deadlocks,
    'rollbacks', dbstat.rollbacks,
    'commits', dbstat.commits,
    'tuples_read', dbstat.tuples_read,
    'tuples_written', dbstat.tuples_written,
    'blks_read', dbstat.blks_read,
    'uptime_sec', COALESCE(round(EXTRACT(epoch FROM (snapshot.captured_at - pg_postmaster_start_time()))::numeric, 0), 0),
    'stats_age_sec', dbstat.stats_age_sec,
    'searches_last_min', search_counts.searches_last_min,
    'searches_last_hour', search_counts.searches_last_hour,
    'searches_today', search_counts.searches_today,
    'new_movies_today', (SELECT count(*) FROM public.movies WHERE created_at > snapshot.captured_at - interval '24 hours'),
    'new_users_today', user_counts.new_users_today,
    'active_users_today', user_counts.active_users_today,
    'blocked_users', user_counts.blocked_users,
    'premium_users', (SELECT count(*) FROM public.user_entitlements WHERE is_premium),
    'cache_rows', (SELECT count(*) FROM public.query_cache),
    'movies_count', (SELECT value FROM public.bot_metric_counters WHERE metric = 'movies_count'),
    'users_count', user_counts.users_count,
    'groups_count', (SELECT count(*) FROM public.bot_groups WHERE is_active),
    'cache_hit_ratio', dbstat.cache_hit_ratio,
    'index_hit_ratio', (SELECT COALESCE(round(100.0 * sum(idx_blks_hit) / NULLIF(sum(idx_blks_hit) + sum(idx_blks_read), 0), 1), 0) FROM pg_statio_user_indexes)
  )
  FROM snapshot, activity, dbstat, search_counts, user_counts;
$$;

REVOKE ALL ON FUNCTION public.server_metrics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_metrics() TO service_role;