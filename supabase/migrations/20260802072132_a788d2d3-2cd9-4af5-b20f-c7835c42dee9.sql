CREATE OR REPLACE FUNCTION public.server_metrics()
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'db_bytes', pg_database_size(current_database()),
    'movies_bytes', pg_total_relation_size('public.movies'),
    'movies_index_bytes', pg_indexes_size('public.movies'),
    'logs_bytes', pg_total_relation_size('public.search_log') + pg_total_relation_size('public.query_cache') + pg_total_relation_size('public.broadcast_log'),
    'users_bytes', pg_total_relation_size('public.bot_users'),
    'connections', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()),
    'active_queries', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active'),
    'idle_conns', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle'),
    'idle_in_tx', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'),
    'waiting_queries', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'),
    'longest_query_sec', (SELECT COALESCE(round(EXTRACT(epoch FROM max(now() - query_start))::numeric, 1), 0) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND query NOT ILIKE '%pg_stat_activity%'),
    'max_connections', (SELECT setting::int FROM pg_settings WHERE name = 'max_connections'),
    'shared_buffers_bytes', (SELECT setting::bigint * 8192 FROM pg_settings WHERE name = 'shared_buffers'),
    'effective_cache_bytes', (SELECT setting::bigint * 8192 FROM pg_settings WHERE name = 'effective_cache_size'),
    'work_mem_bytes', (SELECT setting::bigint * 1024 FROM pg_settings WHERE name = 'work_mem'),
    'maintenance_work_mem_bytes', (SELECT setting::bigint * 1024 FROM pg_settings WHERE name = 'maintenance_work_mem'),
    'wal_bytes', (SELECT COALESCE(sum(size), 0) FROM pg_ls_waldir()),
    'temp_bytes', (SELECT COALESCE(temp_bytes, 0) FROM pg_stat_database WHERE datname = current_database()),
    'temp_files', (SELECT COALESCE(temp_files, 0) FROM pg_stat_database WHERE datname = current_database()),
    'deadlocks', (SELECT COALESCE(deadlocks, 0) FROM pg_stat_database WHERE datname = current_database()),
    'rollbacks', (SELECT COALESCE(xact_rollback, 0) FROM pg_stat_database WHERE datname = current_database()),
    'commits', (SELECT COALESCE(xact_commit, 0) FROM pg_stat_database WHERE datname = current_database()),
    'tuples_read', (SELECT COALESCE(tup_fetched, 0) FROM pg_stat_database WHERE datname = current_database()),
    'tuples_written', (SELECT COALESCE(tup_inserted + tup_updated + tup_deleted, 0) FROM pg_stat_database WHERE datname = current_database()),
    'blks_read', (SELECT COALESCE(blks_read, 0) FROM pg_stat_database WHERE datname = current_database()),
    'uptime_sec', (SELECT COALESCE(round(EXTRACT(epoch FROM (now() - pg_postmaster_start_time()))::numeric, 0), 0)),
    'stats_age_sec', (SELECT COALESCE(round(EXTRACT(epoch FROM (now() - stats_reset))::numeric, 0), 0) FROM pg_stat_database WHERE datname = current_database()),
    'searches_last_min', (SELECT count(*) FROM public.search_log WHERE created_at > now() - interval '1 minute'),
    'searches_last_hour', (SELECT count(*) FROM public.search_log WHERE created_at > now() - interval '1 hour'),
    'searches_today', (SELECT count(*) FROM public.search_log WHERE created_at > now() - interval '24 hours'),
    'new_movies_today', (SELECT count(*) FROM public.movies WHERE created_at > now() - interval '24 hours'),
    'new_users_today', (SELECT count(*) FROM public.bot_users WHERE first_seen > now() - interval '24 hours'),
    'active_users_today', (SELECT count(*) FROM public.bot_users WHERE last_seen > now() - interval '24 hours'),
    'blocked_users', (SELECT count(*) FROM public.bot_users WHERE is_blocked),
    'premium_users', (SELECT count(*) FROM public.user_entitlements WHERE is_premium),
    'cache_rows', (SELECT count(*) FROM public.query_cache),
    'movies_count', (SELECT reltuples::bigint FROM pg_class WHERE oid = 'public.movies'::regclass),
    'users_count', (SELECT count(*) FROM public.bot_users),
    'groups_count', (SELECT count(*) FROM public.bot_groups WHERE is_active),
    'cache_hit_ratio', (SELECT COALESCE(round(100.0 * sum(blks_hit) / NULLIF(sum(blks_hit) + sum(blks_read), 0), 1), 0) FROM pg_stat_database WHERE datname = current_database()),
    'index_hit_ratio', (SELECT COALESCE(round(100.0 * sum(idx_blks_hit) / NULLIF(sum(idx_blks_hit) + sum(idx_blks_read), 0), 1), 0) FROM pg_statio_user_indexes)
  );
$function$;