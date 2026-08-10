import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;
export function admin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  _admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _admin;
}

export interface BotSettings {
  id: number;
  source_channel_id: number | null;
  source_channel_username: string | null;
  source_channel_title: string | null;
  required_channel_id: number | null;
  required_channel_username: string | null;
  required_channel_title: string | null;
  required_channel_invite_link: string | null;
  updates_channel_url: string | null;
  support_chat_url: string | null;
  builder_username: string | null;
  search_group_url: string | null;
  search_group_title: string | null;
  support_group_id: number | null;
  support_group_title: string | null;
  support_topics_enabled: boolean;
  quota_enabled: boolean;
  free_searches_per_day: number;
  price_single_search: number;
  price_daily_extra: number;
  price_premium: number;
  price_premium_year: number;
  price_premium_forever: number;
  enable_single: boolean;
  enable_daily: boolean;
  enable_premium: boolean;
  enable_premium_year: boolean;
  enable_premium_forever: boolean;
}

export async function getSettings(): Promise<BotSettings> {
  const { data, error } = await admin().from("bot_settings").select("*").eq("id", 1).single();
  if (error) throw error;
  return data as any;
}

export async function updateSettings(patch: Partial<BotSettings>) {
  const { error } = await admin()
    .from("bot_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw error;
}

export async function upsertUser(u: {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
}) {
  await admin().from("bot_users").upsert(
    {
      telegram_id: u.id,
      username: u.username ?? null,
      first_name: u.first_name ?? null,
      last_name: u.last_name ?? null,
      language_code: u.language_code ?? null,
      last_seen: new Date().toISOString(),
    },
    { onConflict: "telegram_id" },
  );
}

export async function upsertGroup(c: { id: number; title?: string; type?: string }) {
  await admin().from("bot_groups").upsert(
    {
      chat_id: c.id,
      title: c.title ?? null,
      type: c.type ?? null,
      is_active: true,
      last_seen: new Date().toISOString(),
    },
    { onConflict: "chat_id" },
  );
}

export async function markGroupInactive(chat_id: number) {
  await admin().from("bot_groups").update({ is_active: false }).eq("chat_id", chat_id);
}

export async function markUserBlocked(telegram_id: number) {
  await admin()
    .from("bot_users")
    .update({ is_blocked: true, blocked_until: null, block_reason: "חסימה ידנית לצמיתות" })
    .eq("telegram_id", telegram_id);
}

export async function unmarkUserBlocked(telegram_id: number) {
  await admin()
    .from("bot_users")
    .update({ is_blocked: false, blocked_until: null, block_reason: null })
    .eq("telegram_id", telegram_id);
}

/** Escalating auto-block ladder for inappropriate searches. */
export const BLOCK_LADDER_MIN = [5, 15, 30, 60 * 24, 60 * 48, 60 * 24 * 7];

/**
 * Applies the next escalation step for a user caught searching inappropriate
 * content. Returns the applied duration (null = permanent) and release time.
 */
export async function applyAutoBlock(
  telegram_id: number,
  reason: string,
): Promise<{ minutes: number | null; until: string | null; strike: number }> {
  const u = await getBotUser(telegram_id);
  const strike = (u?.block_strikes ?? 0) + 1;
  const minutes = strike <= BLOCK_LADDER_MIN.length ? BLOCK_LADDER_MIN[strike - 1] : null;
  const until = minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null;
  await admin()
    .from("bot_users")
    .update({ is_blocked: true, blocked_until: until, block_reason: reason, block_strikes: strike })
    .eq("telegram_id", telegram_id);
  return { minutes, until, strike };
}

/** Clears a temporary block whose time has passed. Returns true if released. */
export async function releaseIfExpired(u: BotUserRow | null): Promise<boolean> {
  if (!u?.is_blocked || !u.blocked_until) return false;
  if (new Date(u.blocked_until).getTime() > Date.now()) return false;
  await admin()
    .from("bot_users")
    .update({ is_blocked: false, blocked_until: null, block_reason: null })
    .eq("telegram_id", u.telegram_id);
  return true;
}

/** Marker prefix stored on search-log rows that triggered a moderation block. */
export const FLAGGED_PREFIX = "⛔ ";

export async function logSearch(telegram_id: number, query: string, flagged = false) {
  const q = (flagged ? FLAGGED_PREFIX : "") + query.slice(0, 200);
  await admin().from("search_log").insert({ telegram_id, query: q } as any);
}

/**
 * Releases every temporary block whose time has passed, so the blocked list is
 * always accurate to the second. Returns how many were released.
 */
export async function releaseExpiredBlocks(): Promise<number> {
  const now = new Date().toISOString();
  const { data } = await admin()
    .from("bot_users")
    .update({ is_blocked: false, blocked_until: null, block_reason: null })
    .eq("is_blocked", true)
    .not("blocked_until", "is", null)
    .lte("blocked_until", now)
    .select("telegram_id");
  return (data ?? []).length;
}

// ───── Blocked words (moderation dictionary) ─────
let _wordsCache: { at: number; words: string[] } | null = null;

export async function listBlockedWords(force = false): Promise<string[]> {
  if (!force && _wordsCache && Date.now() - _wordsCache.at < 60_000) return _wordsCache.words;
  const { data } = await admin().from("blocked_words" as any).select("word").order("word", { ascending: true });
  const words = ((data ?? []) as any[]).map((r) => String(r.word));
  _wordsCache = { at: Date.now(), words };
  return words;
}

export async function addBlockedWord(word: string, added_by: number) {
  const w = word.trim().toLowerCase();
  if (!w) return;
  await admin().from("blocked_words" as any).upsert({ word: w, added_by } as any, { onConflict: "word" });
  _wordsCache = null;
}

export async function removeBlockedWord(word: string) {
  await admin().from("blocked_words" as any).delete().eq("word", word);
  _wordsCache = null;
}

/** Reset today's used-search counters for everyone (premium/credits untouched). */
export async function resetDailyQuotaForAll(): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await admin().from("search_usage").update({ used: 0 } as any).eq("day", day);
}

/** One internally consistent database snapshot, with a last-good fallback. */
let _metricsCache: { at: number; m: Record<string, number> } | null = null;
let _metricsInflight: Promise<Record<string, number>> | null = null;

export async function serverMetrics(force = false): Promise<Record<string, number>> {
  if (!force && _metricsCache && Date.now() - _metricsCache.at < 15_000) return _metricsCache.m;
  if (_metricsInflight) return _metricsInflight;
  _metricsInflight = (async () => {
    try {
      const { data, error } = await admin().rpc("server_metrics" as any);
      if (error) throw error;
      if (!data || typeof data !== "object") throw new Error("Invalid metrics snapshot");
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(data as any)) out[k] = Number(v) || 0;
      const required = ["captured_at_epoch", "db_bytes", "movies_count", "connections", "users_count"];
      if (!required.every((key) => Number.isFinite(out[key]))) throw new Error("Incomplete metrics snapshot");
      _metricsCache = { at: Date.now(), m: out };
      return out;
    } catch (error) {
      console.error("server_metrics snapshot failed", error);
      return _metricsCache?.m ?? {};
    }
  })();
  try {
    return await _metricsInflight;
  } finally {
    _metricsInflight = null;
  }
}

/** Exact trigger-maintained movie count from the metrics snapshot. */
let _moviesCountCache: { at: number; n: number } | null = null;

export async function moviesCount(force = false): Promise<number> {
  if (!force && _moviesCountCache && Date.now() - _moviesCountCache.at < 60_000) {
    return _moviesCountCache.n;
  }
  let n = 0;
  try {
    const m = await serverMetrics(force);
    n = Number(m.movies_count) || 0;
  } catch {
    /* ignore */
  }
  if (!n) return _moviesCountCache?.n ?? 0;
  _moviesCountCache = { at: Date.now(), n };
  return n;
}

export async function lastSearches(
  telegram_id: number,
  limit = 15,
): Promise<{ query: string; created_at: string }[]> {
  const { data } = await admin()
    .from("search_log")
    .select("query,created_at")
    .eq("telegram_id", telegram_id)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as any;
}

/** Unblock every currently blocked user. Returns how many were released. */
export async function unblockAllUsers(): Promise<number> {
  const a = admin();
  const { count } = await a
    .from("bot_users")
    .select("*", { count: "exact", head: true })
    .eq("is_blocked", true);
  await a
    .from("bot_users")
    .update({ is_blocked: false, blocked_until: null, block_reason: null })
    .eq("is_blocked", true);
  return count ?? 0;
}

export const USER_COLS =
  "telegram_id,username,first_name,last_name,is_blocked,first_seen,last_seen,blocked_until,block_reason,block_strikes";

export type BotUserRow = {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  is_blocked: boolean;
  first_seen: string;
  last_seen: string;
  blocked_until?: string | null;
  block_reason?: string | null;
  block_strikes?: number | null;
};

export async function searchBotUsers(query: string, limit = 20): Promise<BotUserRow[]> {
  const q = query.trim();
  const a = admin();
  let req: any = a.from("bot_users").select(USER_COLS);
  if (q) {
    if (/^-?\d+$/.test(q)) {
      req = req.eq("telegram_id", Number(q));
    } else {
      const clean = q.replace(/^@/, "").replace(/[%,()]/g, "");
      req = req.or(
        `username.ilike.%${clean}%,first_name.ilike.%${clean}%,last_name.ilike.%${clean}%`,
      );
    }
  }
  const { data } = await req.order("last_seen", { ascending: false }).limit(limit);
  return ((data ?? []) as any) as BotUserRow[];
}

export async function getBotUser(telegram_id: number): Promise<BotUserRow | null> {
  const { data } = await admin()
    .from("bot_users")
    .select(USER_COLS)
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  return (data as any) ?? null;
}

export async function userStars(telegram_id: number): Promise<number> {
  const { data } = await admin()
    .from("star_payments")
    .select("stars_amount")
    .eq("telegram_user_id", telegram_id);
  return (data ?? []).reduce((s: number, p: any) => s + (p.stars_amount || 0), 0);
}

export type StarSupporter = {
  telegram_id: number;
  stars: number;
  payments: number;
  last_at: string;
};

/** Aggregated Telegram Stars supporters, biggest first. */
export async function listStarSupportersPaged(opts: { page: number; pageSize: number }) {
  const { data } = await admin()
    .from("star_payments")
    .select("telegram_user_id,stars_amount,created_at")
    .order("created_at", { ascending: false })
    .limit(5000);
  const map = new Map<number, StarSupporter>();
  for (const p of (data ?? []) as any[]) {
    const id = Number(p.telegram_user_id);
    const cur = map.get(id) || { telegram_id: id, stars: 0, payments: 0, last_at: p.created_at };
    cur.stars += Number(p.stars_amount || 0);
    cur.payments += 1;
    if (new Date(p.created_at) > new Date(cur.last_at)) cur.last_at = p.created_at;
    map.set(id, cur);
  }
  const all = [...map.values()].sort((a, b) => b.stars - a.stars);
  const start = opts.page * opts.pageSize;
  return {
    rows: all.slice(start, start + opts.pageSize),
    total: all.length,
    totalStars: all.reduce((s, r) => s + r.stars, 0),
  };
}

/** Latest individual star payments of one user. */
export async function userStarPayments(telegram_id: number, limit = 10) {
  const { data } = await admin()
    .from("star_payments")
    .select("stars_amount,created_at,payload")
    .eq("telegram_user_id", telegram_id)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as any[]) as { stars_amount: number; created_at: string; payload: string | null }[];
}

export async function indexMovie(m: {
  source_channel_id: number;
  message_id: number;
  title: string;
  file_unique_id?: string | null;
  file_type?: string | null;
  duration?: number | null;
  file_size?: number | null;
  raw_caption?: string | null;
}) {
  await admin().from("movies").upsert(m as any, { onConflict: "source_channel_id,message_id" });
}

const SEARCH_WORD_LIMIT = 6;
const WORD_SEARCH_DEDUPE_OVERFETCH = 8;
const WORD_SEARCH_MIN_WINDOW = 100;
const WORD_SEARCH_MAX_WINDOW = 500;
const REGULAR_SEARCH_BATCH = 500;
const REGULAR_SEARCH_SCAN_LIMIT = 1000;
const MOVIE_SEARCH_COLUMNS = "id,title,message_id,source_channel_id,raw_caption,file_unique_id,file_type,file_size";
const MOVIE_RESULT_COLUMNS = "id,title,message_id,source_channel_id,file_unique_id,file_type,file_size";

type SearchMovieRow = {
  id: number;
  title: string;
  message_id: number;
  source_channel_id: number;
  raw_caption?: string | null;
  file_unique_id?: string | null;
  file_type?: string | null;
  file_size?: number | null;
};

type ParsedRegularSearch = {
  keywords: string[];
  seasonNumbers: number[];
  episodeNumbers: number[];
  genericNumbers: number[];
  hasNumberFilters: boolean;
};

export type SearchMoviesResult = {
  rows: any[];
  total: number;
  totalRaw: number;
  hiddenDuplicates: number;
};

export async function searchMovies(
  query: string,
  page: number,
  pageSize: number,
  opts: { dedupe?: boolean } = {},
): Promise<SearchMoviesResult> {
  const q = query.trim();
  if (!q) return { rows: [], total: 0, totalRaw: 0, hiddenDuplicates: 0 };
  const parsed = parseRegularSearch(q);
  const dedupe = opts.dedupe !== false;
  if (!parsed.hasNumberFilters) return searchWordsPaged(q, page, pageSize, dedupe);
  if (parsed.keywords.length === 0) return { rows: [], total: 0, totalRaw: 0, hiddenDuplicates: 0 };

  const all = await fetchRegularSearchCandidates(q, parsed);
  const filtered = parsed.hasNumberFilters
    ? all
        .filter((row) => matchesRegularSearch(row, parsed))
        .map((row) => ({ row, score: regularSearchScore(row, parsed) }))
        .sort((a, b) => b.score - a.score || Number(b.row.id) - Number(a.row.id))
        .map(({ row }) => row)
    : all;
  return paginateSearchRows(filtered, page, pageSize, dedupe);
}

// ───── Full-candidate fetch (cached once per query, sliced in-memory) ─────
const SEARCH_ALL_CAP = 300;

export async function fetchAllSearchCandidates(query: string): Promise<SearchMovieRow[]> {
  const q = query.trim();
  if (!q) return [];
  const parsed = parseRegularSearch(q);
  if (parsed.hasNumberFilters && parsed.keywords.length > 0) {
    const all = await fetchRegularSearchCandidates(q, parsed);
    return all
      .filter((row) => matchesRegularSearch(row, parsed))
      .map((row) => ({ row, score: regularSearchScore(row, parsed) }))
      .sort((a, b) => b.score - a.score || Number(b.row.id) - Number(a.row.id))
      .map(({ row }) => row)
      .slice(0, SEARCH_ALL_CAP);
  }
  if (parsed.hasNumberFilters && parsed.keywords.length === 0) return [];
  const titleRows = await fetchFastTitleSearchRows(q, 0, SEARCH_ALL_CAP).then((r) => r.rows).catch(() => []);
  if (titleRows.length > 0) return titleRows;
  const { rows } = await fetchWordSearchRows(q, 0, SEARCH_ALL_CAP, false).catch(() => ({ rows: [], totalRaw: 0 }));
  return rows;
}

export function paginateCandidates(
  rows: SearchMovieRow[],
  page: number,
  pageSize: number,
  dedupe: boolean,
): SearchMoviesResult {
  const totalRaw = rows.length;
  const finalRows = dedupe ? dedupeRows(rows) : rows;
  const total = finalRows.length;
  const hiddenDuplicates = Math.max(0, totalRaw - total);
  const from = page * pageSize;
  return formatSearchResult(finalRows.slice(from, from + pageSize), total, totalRaw, hiddenDuplicates);
}

async function searchWordsPaged(query: string, page: number, pageSize: number, dedupe: boolean): Promise<SearchMoviesResult> {
  if (!dedupe) {
    const { rows, totalRaw } = await fetchWordSearchRows(query, page * pageSize, pageSize, true);
    return formatSearchResult(rows, totalRaw, totalRaw, 0);
  }

  const wanted = (page + 1) * pageSize;
  const windowSize = Math.min(Math.max(wanted * WORD_SEARCH_DEDUPE_OVERFETCH, WORD_SEARCH_MIN_WINDOW), WORD_SEARCH_MAX_WINDOW);
  const { rows, totalRaw } = await fetchWordSearchRows(query, 0, windowSize, true);
  const deduped = dedupeRows(rows);
  const hiddenInWindow = rows.length - deduped.length;
  const pageRows = deduped.slice(page * pageSize, page * pageSize + pageSize);
  const estimatedTotal = Math.max(pageRows.length + page * pageSize, totalRaw - hiddenInWindow);
  return formatSearchResult(pageRows, estimatedTotal, totalRaw, Math.max(0, totalRaw - estimatedTotal));
}

function paginateSearchRows(rows: SearchMovieRow[], page: number, pageSize: number, dedupe: boolean): SearchMoviesResult {
  const totalRaw = rows.length;
  const finalRows = dedupe ? dedupeRows(rows) : rows;
  const total = finalRows.length;
  const hiddenDuplicates = Math.max(0, totalRaw - total);
  const from = page * pageSize;
  return formatSearchResult(finalRows.slice(from, from + pageSize), total, totalRaw, hiddenDuplicates);
}

function formatSearchResult(rows: SearchMovieRow[], total: number, totalRaw: number, hiddenDuplicates: number): SearchMoviesResult {
  return {
    rows: rows.map((r) => ({
    id: r.id,
    title: r.title,
    message_id: r.message_id,
    source_channel_id: r.source_channel_id,
    })),
    total,
    totalRaw,
    hiddenDuplicates,
  };
}

async function fetchWordSearchRows(query: string, offset: number, limit: number, withCount: boolean): Promise<{ rows: SearchMovieRow[]; totalRaw: number }> {
  const to = Math.max(offset, offset + limit - 1);
  const req = buildWordSearchRequest(query, withCount).range(offset, to);
  const { data, error, count } = await req;
  if (error && withCount) return fetchWordSearchRows(query, offset, limit, false);
  if (error) return fetchFastTitleSearchRows(query, offset, limit);
  const rows = (data ?? []) as SearchMovieRow[];
  const fallbackTotal = offset + rows.length + (rows.length === limit ? pageSizeFallback(limit) : 0);
  return { rows, totalRaw: typeof count === "number" ? count : fallbackTotal };
}

async function fetchFastTitleSearchRows(query: string, offset: number, limit: number): Promise<{ rows: SearchMovieRow[]; totalRaw: number }> {
  const words = query.split(/\s+/).filter(Boolean).slice(0, Math.min(SEARCH_WORD_LIMIT, 3));
  const to = Math.max(offset, offset + limit - 1);
  let req: any = admin().from("movies").select(MOVIE_RESULT_COLUMNS);
  for (const w of words) req = req.ilike("title", `%${escapePostgrestLike(w)}%`);
  const { data, error } = await req.order("id", { ascending: false }).range(offset, to);
  if (error && words.length > 1) return fetchFastTitleSearchRows(words[0], offset, limit);
  if (error) throw error;
  const rows = (data ?? []) as SearchMovieRow[];
  const fallbackTotal = offset + rows.length + (rows.length === limit ? pageSizeFallback(limit) : 0);
  return { rows, totalRaw: fallbackTotal };
}

function buildWordSearchRequest(query: string, withCount: boolean): any {
  const words = query.split(/\s+/).filter(Boolean).slice(0, SEARCH_WORD_LIMIT);
  const countMode = "planned";
  let req: any = admin().from("movies").select(MOVIE_RESULT_COLUMNS, withCount ? { count: countMode } : undefined);
  for (const w of words) req = req.or(ilikeAnyField(w));
  return req.order("id", { ascending: false });
}

function pageSizeFallback(limit: number) {
  return Math.min(limit, 100);
}

async function fetchRegularSearchCandidates(query: string, parsed: ParsedRegularSearch): Promise<SearchMovieRow[]> {
  const titleFirst = await fetchRegularTitleCandidates(parsed).catch(() => []);
  if (titleFirst.length > 0) return titleFirst;

  const candidates: SearchMovieRow[] = [];
  try {
    for (let from = 0; from < REGULAR_SEARCH_SCAN_LIMIT; from += REGULAR_SEARCH_BATCH) {
      const to = Math.min(from + REGULAR_SEARCH_BATCH - 1, REGULAR_SEARCH_SCAN_LIMIT - 1);
      const { data, error } = await buildRegularSearchRequest(query, parsed).range(from, to);
      if (error) throw error;
      const batch = (data ?? []) as SearchMovieRow[];
      candidates.push(...batch);
      if (batch.length < REGULAR_SEARCH_BATCH) break;
    }
  } catch {
    return titleFirst;
  }
  return candidates;
}

async function fetchRegularTitleCandidates(parsed: ParsedRegularSearch): Promise<SearchMovieRow[]> {
  if (parsed.keywords.length === 0) return [];
  let req: any = admin().from("movies").select(MOVIE_SEARCH_COLUMNS);
  for (const word of parsed.keywords.slice(0, Math.min(SEARCH_WORD_LIMIT, 4))) {
    req = req.ilike("title", `%${escapePostgrestLike(word)}%`);
  }
  const { data, error } = await req.order("id", { ascending: false }).range(0, REGULAR_SEARCH_SCAN_LIMIT - 1);
  if (error) throw error;
  return (data ?? []) as SearchMovieRow[];
}

function buildRegularSearchRequest(query: string, parsed: ParsedRegularSearch): any {
  let req: any = admin()
    .from("movies")
    .select(MOVIE_SEARCH_COLUMNS);
  for (const word of parsed.keywords.slice(0, SEARCH_WORD_LIMIT)) req = req.or(ilikeAnyField(word));
  const numericConditions = numericBaseConditions(parsed);
  if (parsed.keywords.length === 0) {
    if (numericConditions.length > 0) req = req.or(numericConditions.join(","));
    else for (const w of query.split(/\s+/).filter(Boolean).slice(0, SEARCH_WORD_LIMIT)) req = req.or(ilikeAnyField(w));
  }
  return req.order("id", { ascending: false });
}

function dedupeRows(rows: SearchMovieRow[]): SearchMovieRow[] {
  const seen = new Set<string>();
  const out: SearchMovieRow[] = [];
  for (const row of rows) {
    const key = dedupeKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function dedupeKey(row: SearchMovieRow): string {
  if (row.file_unique_id) return `u:${row.file_unique_id}`;
  const title = normalizeSearchText(row.title || "");
  return `k:${title}|${row.file_type ?? ""}|${row.file_size ?? ""}`;
}

function ilikeAnyField(value: string) {
  const esc = escapePostgrestLike(value);
  return `title.ilike.%${esc}%,raw_caption.ilike.%${esc}%`;
}

function numericBaseConditions(parsed: ParsedRegularSearch) {
  const conditions: string[] = [];
  const add = (field: "title" | "raw_caption", phrase: string) => conditions.push(`${field}.ilike.%${escapePostgrestLike(phrase)}%`);
  for (const n of parsed.seasonNumbers) {
    for (const form of numericForms(n)) {
      add("title", `עונה ${form}`);
      add("raw_caption", `עונה ${form}`);
      add("title", `season ${form}`);
      add("raw_caption", `season ${form}`);
    }
  }
  for (const n of parsed.episodeNumbers) {
    for (const form of numericForms(n)) {
      add("title", `פרק ${form}`);
      add("raw_caption", `פרק ${form}`);
      add("title", `episode ${form}`);
      add("raw_caption", `episode ${form}`);
    }
  }
  for (const n of parsed.genericNumbers) {
    for (const form of numericForms(n)) {
      add("title", form);
      add("raw_caption", form);
    }
  }
  return conditions.slice(0, 20);
}

function parseRegularSearch(query: string): ParsedRegularSearch {
  const tokens = tokenizeSearch(query);
  const used = new Set<number>();
  const seasonNumbers: number[] = [];
  const episodeNumbers: number[] = [];
  const genericNumbers: number[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const compact = parseCompactContext(tokens[i]);
    if (compact) {
      (compact.kind === "season" ? seasonNumbers : episodeNumbers).push(compact.value);
      used.add(i);
      continue;
    }
    const context = contextKind(tokens[i]);
    if (!context || i + 1 >= tokens.length) continue;
    const value = numberValue(tokens[i + 1]);
    if (value === null) continue;
    (context === "season" ? seasonNumbers : episodeNumbers).push(value);
    used.add(i);
    used.add(i + 1);
  }

  const keywords: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token || used.has(i) || contextKind(token) || SEARCH_STOP_WORDS.has(token)) continue;
    const n = numberValue(token);
    if (n !== null) {
      genericNumbers.push(n);
      continue;
    }
    if (token.length >= 2) keywords.push(token);
  }

  return {
    keywords: unique(keywords).slice(0, SEARCH_WORD_LIMIT),
    seasonNumbers: uniqueNumbers(seasonNumbers),
    episodeNumbers: uniqueNumbers(episodeNumbers),
    genericNumbers: uniqueNumbers(genericNumbers),
    hasNumberFilters: seasonNumbers.length > 0 || episodeNumbers.length > 0 || genericNumbers.length > 0,
  };
}

const SEARCH_STOP_WORDS = new Set(["את", "של", "עם", "סדרה", "הסדרה", "סרט", "הסרט", "season", "episode"]);
const HEBREW_NUMBER_WORDS: Record<string, number> = {
  "אחד": 1, "אחת": 1, "ראשון": 1, "ראשונה": 1,
  "שני": 2, "שניה": 2, "שנייה": 2, "שתיים": 2, "שניים": 2,
  "שלוש": 3, "שלושה": 3, "שלישי": 3, "שלישית": 3,
  "ארבע": 4, "ארבעה": 4, "רביעי": 4, "רביעית": 4,
  "חמש": 5, "חמישה": 5, "חמישי": 5, "חמישית": 5,
  "שש": 6, "שישה": 6, "שישי": 6, "שישית": 6,
  "שבע": 7, "שבעה": 7, "שביעי": 7, "שביעית": 7,
  "שמונה": 8, "שמיני": 8, "שמינית": 8,
  "תשע": 9, "תשעה": 9, "תשיעי": 9, "תשיעית": 9,
  "עשר": 10, "עשרה": 10, "עשירי": 10, "עשירית": 10,
};

function matchesRegularSearch(row: SearchMovieRow, parsed: ParsedRegularSearch) {
  const haystack = normalizeSearchText(`${row.title || ""} ${row.raw_caption || ""}`);
  if (!parsed.keywords.every((word) => haystack.includes(word))) return false;
  if (!parsed.seasonNumbers.every((n) => hasContextNumber(haystack, "season", n))) return false;
  if (!parsed.episodeNumbers.every((n) => hasContextNumber(haystack, "episode", n))) return false;
  return parsed.genericNumbers.every((n) => hasPlainNumber(haystack, n));
}

function regularSearchScore(row: SearchMovieRow, parsed: ParsedRegularSearch) {
  const title = normalizeSearchText(row.title || "");
  let score = 0;
  for (const word of parsed.keywords) if (title.includes(word)) score += 20;
  for (const n of parsed.seasonNumbers) if (hasContextNumber(title, "season", n)) score += 60;
  for (const n of parsed.episodeNumbers) if (hasContextNumber(title, "episode", n)) score += 70;
  score -= Math.min(title.length, 250) / 100;
  return score;
}

function hasContextNumber(text: string, kind: "season" | "episode", n: number) {
  const labels = kind === "season" ? ["עונה", "עונת", "season", "s"] : ["פרק", "episode", "ep", "e"];
  return labels.some((label) => numericForms(n).some((form) => text.includes(`${label} ${form}`) || text.includes(`${label}${form}`)));
}

function hasPlainNumber(text: string, n: number) {
  return numericForms(n).some((form) => new RegExp(`(^|\\D)${escapeRegex(form)}(\\D|$)`).test(text));
}

function tokenizeSearch(query: string) {
  return normalizeSearchText(query).match(/[\p{L}\p{N}]+/gu) ?? [];
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().normalize("NFKC").replace(/[־‐‑–—_.:/\\()[\]{}+|]/g, " ").replace(/\s+/g, " ").trim();
}

function contextKind(token: string): "season" | "episode" | null {
  if (["עונה", "עונת", "season", "seasons", "s"].includes(token)) return "season";
  if (["פרק", "episode", "episodes", "ep", "e"].includes(token)) return "episode";
  return null;
}

function parseCompactContext(token: string): { kind: "season" | "episode"; value: number } | null {
  const match = token.match(/^(עונה|עונת|season|s|פרק|episode|ep|e)(\d{1,3})$/);
  if (!match) return null;
  const value = numberValue(match[2]);
  if (value === null) return null;
  return { kind: ["עונה", "עונת", "season", "s"].includes(match[1]) ? "season" : "episode", value };
}

function numberValue(token: string) {
  if (/^\d{1,3}$/.test(token)) return Number(token);
  return HEBREW_NUMBER_WORDS[token] ?? null;
}

function numericForms(n: number) {
  const forms = [String(n)];
  if (n >= 0 && n < 10) forms.push(String(n).padStart(2, "0"));
  return unique(forms);
}

function escapePostgrestLike(value: string) {
  return value.replace(/[%_,()]/g, "\\$&");
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function uniqueNumbers(items: number[]) {
  return unique(items.filter((n) => Number.isFinite(n) && n >= 0));
}

export async function getMovieById(id: number) {
  const { data, error } = await admin().from("movies").select("*").eq("id", id).single();
  if (error) return null;
  return data;
}

export async function setAdminState(telegram_id: number, state: string | null, data: any = null) {
  if (state === null) {
    await admin().from("admin_state").delete().eq("telegram_id", telegram_id);
    return;
  }
  await admin().from("admin_state").upsert(
    { telegram_id, state, data, updated_at: new Date().toISOString() },
    { onConflict: "telegram_id" },
  );
}

export async function getAdminState(telegram_id: number): Promise<{ state: string; data: any } | null> {
  const { data } = await admin().from("admin_state").select("state,data").eq("telegram_id", telegram_id).maybeSingle();
  return (data as any) ?? null;
}

export async function recordPayment(p: {
  telegram_user_id: number;
  stars_amount: number;
  telegram_payment_charge_id: string;
  telegram_provider_charge_id: string;
  payload: string;
}) {
  await admin().from("star_payments").insert(p).select().single();
}

export async function listGroups(): Promise<number[]> {
  const { data } = await admin().from("bot_groups").select("chat_id").eq("is_active", true);
  return (data ?? []).map((r: any) => Number(r.chat_id));
}

export async function listGroupsDetailed(): Promise<{ chat_id: number; title: string | null }[]> {
  const { data } = await admin()
    .from("bot_groups")
    .select("chat_id,title")
    .eq("is_active", true)
    .order("last_seen", { ascending: false });
  return (data ?? []).map((r: any) => ({ chat_id: Number(r.chat_id), title: r.title ?? null }));
}

export async function listUsers(): Promise<number[]> {
  // PostgREST caps a plain select at 1000 rows, so page through explicitly.
  const a = admin();
  const ids: number[] = [];
  const step = 1000;
  for (let from = 0; ; from += step) {
    const { data, error } = await a
      .from("bot_users")
      .select("telegram_id")
      .eq("is_blocked", false)
      .order("telegram_id", { ascending: true })
      .range(from, from + step - 1);
    if (error) break;
    const rows = data ?? [];
    for (const r of rows) ids.push(Number((r as any).telegram_id));
    if (rows.length < step) break;
  }
  return ids;
}

// ───── Group membership tracking (used to de-duplicate audience numbers) ─────
export async function touchGroupMember(chat_id: number, user_id: number) {
  await admin()
    .from("group_members")
    .upsert({ chat_id, user_id, last_seen: new Date().toISOString() }, { onConflict: "chat_id,user_id" });
}

/**
 * Unique audience: group members + private users, counting a person who is
 * both a group member and a private user only once.
 * Overlap is measured on users we actually identified inside groups.
 */
export async function uniqueReach(totalGroupMembers: number, privateUserIds: number[]) {
  const a = admin();
  const knownGroupUsers = new Set<number>();
  const step = 1000;
  for (let from = 0; ; from += step) {
    const { data, error } = await a
      .from("group_members")
      .select("user_id")
      .order("user_id", { ascending: true })
      .range(from, from + step - 1);
    if (error) break;
    const rows = data ?? [];
    for (const r of rows) knownGroupUsers.add(Number((r as any).user_id));
    if (rows.length < step) break;
  }
  const privateSet = new Set<number>(privateUserIds);
  let overlap = 0;
  for (const id of knownGroupUsers) if (privateSet.has(id)) overlap++;
  const totalPrivate = privateSet.size;
  // A person who is both a private user and a group member counts as PRIVATE:
  // the overlap is deducted from the group side, never from the private side.
  const groupsOnly = Math.max(0, totalGroupMembers - overlap);
  const unique = groupsOnly + totalPrivate;
  return { totalGroupMembers, groupsOnly, totalPrivate, overlap, unique };
}

// ───── Search quota / entitlements ─────
export type Entitlements = {
  telegram_id: number;
  bonus_daily: number;
  extra_credits: number;
  is_premium: boolean;
  premium_until: string | null;
  referred_by: number | null;
  referrals_count: number;
};

export async function getEntitlements(telegram_id: number): Promise<Entitlements> {
  const { data } = await admin()
    .from("user_entitlements")
    .select("telegram_id,bonus_daily,extra_credits,is_premium,premium_until,referred_by,referrals_count")
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  const row: any = data ?? {
    telegram_id,
    bonus_daily: 0,
    extra_credits: 0,
    is_premium: false,
    premium_until: null,
    referred_by: null,
    referrals_count: 0,
  };
  // Premium is monthly: treat an elapsed period as inactive even before the sweep runs.
  if (row.is_premium && row.premium_until && new Date(row.premium_until).getTime() <= Date.now()) {
    row.is_premium = false;
  }
  return row as Entitlements;
}

async function ensureEntitlements(telegram_id: number) {
  await admin().from("user_entitlements").upsert({ telegram_id }, { onConflict: "telegram_id" });
}

export async function addBonusDaily(telegram_id: number, amount: number) {
  await ensureEntitlements(telegram_id);
  const e = await getEntitlements(telegram_id);
  await admin()
    .from("user_entitlements")
    .update({ bonus_daily: Math.max(0, e.bonus_daily + amount), updated_at: new Date().toISOString() })
    .eq("telegram_id", telegram_id);
}

export async function addExtraCredits(telegram_id: number, amount: number) {
  await ensureEntitlements(telegram_id);
  const e = await getEntitlements(telegram_id);
  await admin()
    .from("user_entitlements")
    .update({ extra_credits: Math.max(0, e.extra_credits + amount), updated_at: new Date().toISOString() })
    .eq("telegram_id", telegram_id);
}

export const PREMIUM_DAYS = 30;

/**
 * Grant or revoke premium. Granting gives `days` (default a month); when the
 * user is still inside an active period the new time is added on top of it.
 */
export async function setPremium(telegram_id: number, on: boolean, days: number = PREMIUM_DAYS) {
  await ensureEntitlements(telegram_id);
  const now = Date.now();
  let until: string | null = null;
  let since: string | null = null;
  if (on) {
    const cur = await getEntitlements(telegram_id).catch(() => null);
    const active = !!cur?.is_premium && !!cur?.premium_until && new Date(cur.premium_until!).getTime() > now;
    const base = active ? new Date(cur!.premium_until!).getTime() : now;
    until = new Date(base + Math.max(1, Math.round(days)) * 86400_000).toISOString();
    // Keep the original purchase date when extending an active subscription.
    since = active ? null : new Date().toISOString();
  }
  await admin()
    .from("user_entitlements")
    .update({
      is_premium: on,
      premium_until: until,
      premium_warned_at: null,
      premium_expired_notified_at: null,
      ...(on ? (since ? { premium_since: since } : {}) : { premium_since: null }),
      updated_at: new Date().toISOString(),
    })
    .eq("telegram_id", telegram_id);
}

/** Premium members whose period ends within `days` and were not warned yet. */
export async function setPremiumForever(telegram_id: number) {
  await ensureEntitlements(telegram_id);
  const cur = await getEntitlements(telegram_id).catch(() => null);
  await admin()
    .from("user_entitlements")
    .update({
      is_premium: true,
      premium_until: null,
      premium_warned_at: null,
      premium_expired_notified_at: null,
      ...(cur?.is_premium ? {} : { premium_since: new Date().toISOString() }),
      updated_at: new Date().toISOString(),
    })
    .eq("telegram_id", telegram_id);
}

export async function premiumExpiringSoon(days: number, limit = 200) {
  const until = new Date(Date.now() + days * 86400_000).toISOString();
  const { data } = await admin()
    .from("user_entitlements")
    .select("telegram_id,premium_until")
    .eq("is_premium", true)
    .is("premium_warned_at", null)
    .not("premium_until", "is", null)
    .lte("premium_until", until)
    .gt("premium_until", new Date().toISOString())
    .limit(limit);
  return ((data ?? []) as any[]).map((r) => ({
    telegram_id: Number(r.telegram_id),
    premium_until: String(r.premium_until),
  }));
}

export async function markPremiumWarned(telegram_id: number) {
  await admin()
    .from("user_entitlements")
    .update({ premium_warned_at: new Date().toISOString() })
    .eq("telegram_id", telegram_id);
}

/** Premium periods that have just ended and still need the renewal prompt. */
export async function premiumJustExpired(limit = 200) {
  const { data } = await admin()
    .from("user_entitlements")
    .select("telegram_id,premium_until")
    .eq("is_premium", true)
    .not("premium_until", "is", null)
    .lte("premium_until", new Date().toISOString())
    .limit(limit);
  return ((data ?? []) as any[]).map((r) => Number(r.telegram_id));
}

/** End an elapsed premium period (keeps the record, just turns the flag off). */
export async function expirePremium(telegram_id: number) {
  await admin()
    .from("user_entitlements")
    .update({
      is_premium: false,
      premium_expired_notified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("telegram_id", telegram_id);
}

/** True when this telegram id has never interacted with the bot before. */
export async function isBrandNewUser(telegram_id: number): Promise<boolean> {
  const { data: u } = await admin()
    .from("bot_users")
    .select("telegram_id")
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  if (u) return false;
  const [logs, usage, pays, ents, members] = await Promise.all([
    admin().from("search_log").select("id").eq("telegram_id", telegram_id).limit(1),
    admin().from("search_usage").select("telegram_id").eq("telegram_id", telegram_id).limit(1),
    admin().from("star_payments").select("id").eq("telegram_user_id", telegram_id).limit(1),
    admin().from("user_entitlements").select("telegram_id").eq("telegram_id", telegram_id).limit(1),
    admin().from("group_members").select("user_id").eq("user_id", telegram_id).limit(1),
  ]);
  return !(
    logs.data?.length ||
    usage.data?.length ||
    pays.data?.length ||
    ents.data?.length ||
    members.data?.length
  );
}

/** Register a referral once; grants the referrer +1 permanent daily search.
 *  Only counts users that have never used the bot before. */
export async function registerReferral(
  newUserId: number,
  referrerId: number,
  isNewUser: boolean,
): Promise<boolean> {
  if (!referrerId || referrerId === newUserId) return false;
  if (!isNewUser) return false;
  await ensureEntitlements(newUserId);
  const e = await getEntitlements(newUserId);
  if (e.referred_by) return false;
  await admin()
    .from("user_entitlements")
    .update({ referred_by: referrerId, updated_at: new Date().toISOString() })
    .eq("telegram_id", newUserId);
  await ensureEntitlements(referrerId);
  const r = await getEntitlements(referrerId);
  await admin()
    .from("user_entitlements")
    .update({
      bonus_daily: r.bonus_daily + 1,
      referrals_count: r.referrals_count + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("telegram_id", referrerId);
  return true;
}

export async function searchesUsedToday(telegram_id: number): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await admin()
    .from("search_usage")
    .select("used")
    .eq("telegram_id", telegram_id)
    .eq("day", day)
    .maybeSingle();
  return Number((data as any)?.used ?? 0);
}

/** Which of the given user IDs currently have premium. */
export async function premiumIdsAmong(ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const { data } = await admin()
    .from("user_entitlements")
    .select("telegram_id,is_premium")
    .in("telegram_id", ids)
    .eq("is_premium", true);
  return new Set(((data ?? []) as any[]).map((r) => Number(r.telegram_id)));
}

/** Premium end dates for the given users (only those with an active period). */
export async function premiumUntilAmong(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const { data } = await admin()
    .from("user_entitlements")
    .select("telegram_id,premium_until")
    .in("telegram_id", ids)
    .eq("is_premium", true);
  const m = new Map<number, string>();
  for (const r of (data ?? []) as any[]) if (r.premium_until) m.set(Number(r.telegram_id), String(r.premium_until));
  return m;
}

/** Atomically consume one search against the daily limit / one-off credits. */
export async function consumeSearch(telegram_id: number, limit: number): Promise<{ allowed: boolean; used: number }> {
  const { data, error } = await admin().rpc("consume_search", { _telegram_id: telegram_id, _limit: limit });
  if (error) return { allowed: true, used: 0 }; // never lock users out on a DB hiccup
  const row: any = Array.isArray(data) ? data[0] : data;
  return { allowed: !!row?.allowed, used: Number(row?.used ?? 0) };
}

export async function stats() {
  const a = admin();
  const [movies, { count: users }, { count: groups }, { data: payments }] = await Promise.all([
    moviesCount(),
    a.from("bot_users").select("*", { count: "exact", head: true }).eq("is_blocked", false),
    a.from("bot_groups").select("*", { count: "exact", head: true }).eq("is_active", true),
    a.from("star_payments").select("stars_amount"),
  ]);
  const totalStars = (payments ?? []).reduce((s: number, p: any) => s + (p.stars_amount || 0), 0);
  return { movies: movies ?? 0, users: users ?? 0, groups: groups ?? 0, totalStars };
}

// ───── Admin management ─────
export async function isUserAdmin(telegram_id: number, mainAdminId: number): Promise<boolean> {
  if (telegram_id === mainAdminId) return true;
  const { data } = await admin()
    .from("bot_admins")
    .select("telegram_id,expires_at")
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  if (!data) return false;
  if (data.expires_at && new Date(data.expires_at as any).getTime() < Date.now()) {
    await admin().from("bot_admins").delete().eq("telegram_id", telegram_id);
    return false;
  }
  return true;
}

export async function listAdmins() {
  const { data } = await admin()
    .from("bot_admins")
    .select("telegram_id,expires_at,note,added_by,created_at")
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function addAdmin(p: { telegram_id: number; added_by: number; expires_at: string | null; note?: string | null }) {
  await admin().from("bot_admins").upsert(p as any, { onConflict: "telegram_id" });
}

export async function removeAdmin(telegram_id: number) {
  await admin().from("bot_admins").delete().eq("telegram_id", telegram_id);
}

// ───── Multi source channels ─────
export async function listSourceChannels(): Promise<{ chat_id: number; username: string | null; title: string | null }[]> {
  const { data } = await admin().from("bot_source_channels").select("chat_id,username,title").order("created_at", { ascending: true });
  return (data as any) ?? [];
}
export async function addSourceChannel(p: { chat_id: number; username: string | null; title: string | null; added_by: number }) {
  await admin().from("bot_source_channels").upsert(p as any, { onConflict: "chat_id" });
}
export async function removeSourceChannel(chat_id: number) {
  await admin().from("bot_source_channels").delete().eq("chat_id", chat_id);
}
export async function isSourceChannel(chat_id: number): Promise<boolean> {
  const { data } = await admin().from("bot_source_channels").select("chat_id").eq("chat_id", chat_id).maybeSingle();
  return !!data;
}

// ───── Query cache (pagination) ─────
export type CachedSearch = { query: string; total?: number; dedupe?: boolean };
export type CachedSearchPage = { rows: any[]; total: number; hiddenDuplicates?: number };
export type CachedPageState = {
  queryId: string;
  page: number;
  status: "rendered" | "pending";
  requestedAt: number;
};

export async function cacheQuery(id: string, query: string, total?: number, dedupe?: boolean) {
  const value = JSON.stringify({ kind: "search", query, total, dedupe, cached_at: Date.now() });
  await admin().from("query_cache").upsert({ id, query: value, created_at: new Date().toISOString() }, { onConflict: "id" });
}
export async function getCachedQuery(id: string): Promise<string | null> {
  const cached = await getCachedSearch(id);
  return cached?.query ?? null;
}
export async function getCachedSearch(id: string): Promise<CachedSearch | null> {
  const { data } = await admin().from("query_cache").select("query").eq("id", id).maybeSingle();
  const value = (data as any)?.query;
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.kind === "search" && typeof parsed.query === "string") return { query: parsed.query, total: parsed.total, dedupe: parsed.dedupe };
  } catch {
    // Backward compatibility with old rows that stored only the raw query text.
  }
  return { query: value };
}
export async function cacheSearchPage(id: string, page: number, pageSize: number, rows: any[], total: number, hiddenDuplicates: number = 0) {
  const value = JSON.stringify({ kind: "page", rows, total, hiddenDuplicates, cached_at: Date.now() });
  await admin().from("query_cache").upsert(
    { id: pageCacheId(id, page, pageSize), query: value, created_at: new Date().toISOString() },
    { onConflict: "id" },
  );
}
const PAGE_CACHE_TTL_MS = 60_000; // 60s so counts refresh as new items arrive
const SEARCH_ALL_TTL_MS = 5 * 60_000; // 5 min: fresh enough, avoids re-search on every click
export async function cacheSearchAll(id: string, query: string, rows: SearchMovieRow[]) {
  const value = JSON.stringify({ kind: "search_all", query, rows, cached_at: Date.now() });
  await admin().from("query_cache").upsert(
    { id: allCacheId(id), query: value, created_at: new Date().toISOString() },
    { onConflict: "id" },
  );
}
export async function getCachedSearchAll(id: string): Promise<{ query: string; rows: SearchMovieRow[] } | null> {
  const { data } = await admin().from("query_cache").select("query").eq("id", allCacheId(id)).maybeSingle();
  const value = (data as any)?.query;
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.kind !== "search_all" || !Array.isArray(parsed.rows)) return null;
    const cachedAt = typeof parsed.cached_at === "number" ? parsed.cached_at : 0;
    if (Date.now() - cachedAt > SEARCH_ALL_TTL_MS) return null;
    return { query: String(parsed.query || ""), rows: parsed.rows as SearchMovieRow[] };
  } catch {
    return null;
  }
}
export async function getCachedSearchPage(id: string, page: number, pageSize: number): Promise<CachedSearchPage | null> {
  const { data } = await admin().from("query_cache").select("query").eq("id", pageCacheId(id, page, pageSize)).maybeSingle();
  const value = (data as any)?.query;
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.kind === "page" && Array.isArray(parsed.rows) && typeof parsed.total === "number") {
      const cachedAt = typeof parsed.cached_at === "number" ? parsed.cached_at : 0;
      if (Date.now() - cachedAt > PAGE_CACHE_TTL_MS) return null;
      return { rows: parsed.rows, total: parsed.total, hiddenDuplicates: typeof parsed.hiddenDuplicates === "number" ? parsed.hiddenDuplicates : 0 };
    }
  } catch {
    return null;
  }
  return null;
}
export async function setPageState(scope: string, queryId: string, page: number, status: "rendered" | "pending" = "rendered") {
  await admin().from("query_cache").upsert(
    { id: pageStateId(scope), query: JSON.stringify({ kind: "page_state", queryId, page, status, requestedAt: Date.now() }), created_at: new Date().toISOString() },
    { onConflict: "id" },
  );
}
export async function getPageState(scope: string): Promise<CachedPageState | null> {
  const { data } = await admin().from("query_cache").select("query").eq("id", pageStateId(scope)).maybeSingle();
  const value = (data as any)?.query;
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.kind === "page_state" && typeof parsed.queryId === "string" && typeof parsed.page === "number") {
      return {
        queryId: parsed.queryId,
        page: parsed.page,
        status: parsed.status === "pending" ? "pending" : "rendered",
        requestedAt: typeof parsed.requestedAt === "number" ? parsed.requestedAt : 0,
      };
    }
  } catch {
    return null;
  }
  return null;
}
export async function setLatestPageRequest(scope: string, token: string) {
  await admin().from("query_cache").upsert(
    { id: pageRequestId(scope), query: JSON.stringify({ kind: "latest_page_request", token }), created_at: new Date().toISOString() },
    { onConflict: "id" },
  );
}
export async function isLatestPageRequest(scope: string, token: string): Promise<boolean> {
  const { data } = await admin().from("query_cache").select("query").eq("id", pageRequestId(scope)).maybeSingle();
  const value = (data as any)?.query;
  if (!value) return true;
  try {
    const parsed = JSON.parse(value);
    return parsed?.kind !== "latest_page_request" || parsed.token === token;
  } catch {
    return true;
  }
}

function pageCacheId(id: string, page: number, pageSize: number) {
  return `${id}:p:${page}:${pageSize}`;
}
function pageStateId(scope: string) {
  return `state:${scope}`;
}
function pageRequestId(scope: string) {
  return `nav:${scope}`;
}
function allCacheId(id: string) {
  return `${id}:all`;
}

// ───── Required channels (multi: up to 3 permanent + 5 temporary) ─────
export type RequiredChannelRow = {
  chat_id: number;
  username: string | null;
  title: string | null;
  invite_link: string | null;
  kind: "permanent" | "temporary";
  expires_at: string | null;
};

export const MAX_PERMANENT_REQUIRED = 3;
export const MAX_TEMPORARY_REQUIRED = 5;

export async function listRequiredChannels(): Promise<RequiredChannelRow[]> {
  const { data } = await admin()
    .from("required_channels")
    .select("chat_id,username,title,invite_link,kind,expires_at")
    .order("created_at", { ascending: true });
  const rows = ((data ?? []) as any[]).map((r) => ({ ...r, chat_id: Number(r.chat_id) })) as RequiredChannelRow[];
  // Drop expired temporary channels lazily.
  const now = Date.now();
  const expired = rows.filter((r) => r.expires_at && new Date(r.expires_at).getTime() < now);
  if (expired.length) {
    await admin().from("required_channels").delete().in("chat_id", expired.map((r) => r.chat_id));
  }
  return rows.filter((r) => !r.expires_at || new Date(r.expires_at).getTime() >= now);
}

export async function addRequiredChannel(p: {
  chat_id: number;
  username: string | null;
  title: string | null;
  invite_link: string | null;
  kind: "permanent" | "temporary";
  expires_at: string | null;
  added_by: number;
}) {
  await admin().from("required_channels").upsert(p as any, { onConflict: "chat_id" });
}

export async function removeRequiredChannel(chat_id: number) {
  await admin().from("required_channels").delete().eq("chat_id", chat_id);
}

// ───── Users listing (paged + sortable) ─────
export type UserSort = "joined" | "recent";

/** Paged list of active premium members, soonest expiry first. */
export async function listPremiumMembersPaged(opts: {
  page: number;
  pageSize: number;
}): Promise<{ rows: (BotUserRow & { premium_until: string | null })[]; total: number }> {
  const from = opts.page * opts.pageSize;
  const { data, count } = await admin()
    .from("user_entitlements")
    .select("telegram_id,premium_until", { count: "exact" })
    .eq("is_premium", true)
    .order("premium_until", { ascending: true, nullsFirst: false })
    .range(from, from + opts.pageSize - 1);
  const ents = (data ?? []) as { telegram_id: number; premium_until: string | null }[];
  if (!ents.length) return { rows: [], total: count ?? 0 };
  const ids = ents.map((e) => Number(e.telegram_id));
  const { data: users } = await admin().from("bot_users").select(USER_COLS).in("telegram_id", ids);
  const byId = new Map<number, BotUserRow>(
    (((users ?? []) as any) as BotUserRow[]).map((u) => [Number(u.telegram_id), u]),
  );
  const rows = ents.map((e) => {
    const u = byId.get(Number(e.telegram_id));
    return {
      telegram_id: Number(e.telegram_id),
      username: u?.username ?? null,
      first_name: u?.first_name ?? null,
      last_name: u?.last_name ?? null,
      is_blocked: u?.is_blocked ?? false,
      first_seen: u?.first_seen ?? "",
      last_seen: u?.last_seen ?? "",
      premium_until: e.premium_until,
    };
  });
  return { rows, total: count ?? 0 };
}

export async function listUsersPaged(opts: {
  page: number;
  pageSize: number;
  sort: UserSort;
  blockedOnly?: boolean;
}): Promise<{ rows: BotUserRow[]; total: number }> {
  const from = opts.page * opts.pageSize;
  let req: any = admin()
    .from("bot_users")
    .select(USER_COLS, { count: "exact" });
  if (opts.blockedOnly) {
    await releaseExpiredBlocks().catch(() => 0);
    req = req
      .eq("is_blocked", true)
      .or(`blocked_until.is.null,blocked_until.gt.${new Date().toISOString()}`);
  }
  req =
    opts.sort === "joined"
      ? req.order("first_seen", { ascending: true })
      : req.order("last_seen", { ascending: false });
  const { data, count } = await req.range(from, from + opts.pageSize - 1);
  return { rows: ((data ?? []) as any) as BotUserRow[], total: count ?? 0 };
}

// ───── Broadcast jobs (resumable, so a broadcast always finishes) ─────
export type BroadcastJob = {
  id: number;
  admin_user_id: number;
  admin_chat_id: number;
  status_msg_id: number | null;
  notify_chat_id: number | null;
  notify_msg_id: number | null;
  target: "private" | "groups" | "all";
  from_chat_id: number;
  message_id: number;
  phase: "groups" | "private" | "done";
  cursor_id: number;
  sent: number;
  failed: number;
  total: number;
  status: "running" | "done" | "error";
  resume_after: string;
};

export async function createBroadcastJob(p: {
  admin_user_id: number;
  admin_chat_id: number;
  status_msg_id: number | null;
  notify_chat_id?: number | null;
  notify_msg_id?: number | null;
  target: "private" | "groups" | "all";
  from_chat_id: number;
  message_id: number;
  total: number;
}): Promise<BroadcastJob> {
  const phase = p.target === "private" ? "private" : "groups";
  // Group chat_ids are negative, so the batch cursor must start below them.
  const cursor_id = phase === "groups" ? GROUP_CURSOR_START : 0;
  const { data, error } = await admin()
    .from("broadcast_jobs")
    .insert({ ...p, phase, cursor_id } as any)
    .select("*")
    .single();
  if (error) throw error;
  return data as any;
}

/** Sentinel below any Telegram group id (-100xxxxxxxxxx). */
export const GROUP_CURSOR_START = -9007199254740000;

export async function updateBroadcastJob(id: number, patch: Partial<BroadcastJob> & { last_error?: string | null; locked_at?: string | null }) {
  await admin()
    .from("broadcast_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() } as any)
    .eq("id", id);
}

export async function getBroadcastJob(id: number): Promise<BroadcastJob | null> {
  const { data } = await admin().from("broadcast_jobs").select("*").eq("id", id).maybeSingle();
  return (data as any) ?? null;
}

/** Claim the oldest runnable job (simple lease so parallel ticks don't collide). */
export async function claimBroadcastJob(): Promise<BroadcastJob | null> {
  const staleBefore = new Date(Date.now() - 120_000).toISOString();
  const { data } = await admin()
    .from("broadcast_jobs")
    .select("*")
    .eq("status", "running")
    .lte("resume_after", new Date().toISOString())
    .or(`locked_at.is.null,locked_at.lt.${staleBefore}`)
    .order("id", { ascending: true })
    .limit(1);
  const job = (data ?? [])[0] as any as BroadcastJob | undefined;
  if (!job) return null;
  await updateBroadcastJob(job.id, { locked_at: new Date().toISOString() } as any);
  return job;
}

export async function nextGroupBatch(afterId: number, limit: number): Promise<number[]> {
  const { data } = await admin()
    .from("bot_groups")
    .select("chat_id")
    .eq("is_active", true)
    .gt("chat_id", afterId)
    .order("chat_id", { ascending: true })
    .limit(limit);
  return (data ?? []).map((r: any) => Number(r.chat_id));
}

export async function nextUserBatch(afterId: number, limit: number): Promise<number[]> {
  const { data } = await admin()
    .from("bot_users")
    .select("telegram_id")
    .eq("is_blocked", false)
    .gt("telegram_id", afterId)
    .order("telegram_id", { ascending: true })
    .limit(limit);
  return (data ?? []).map((r: any) => Number(r.telegram_id));
}

export async function countBroadcastRecipients(target: "private" | "groups" | "all"): Promise<number> {
  const a = admin();
  let total = 0;
  if (target === "private" || target === "all") {
    const { count } = await a.from("bot_users").select("*", { count: "exact", head: true }).eq("is_blocked", false);
    total += count ?? 0;
  }
  if (target === "groups" || target === "all") {
    const { count } = await a.from("bot_groups").select("*", { count: "exact", head: true }).eq("is_active", true);
    total += count ?? 0;
  }
  return total;
}

// ───── Broadcast approval requests (sub-admins need main-admin approval) ─────
export type BroadcastRequest = {
  id: number;
  requester_id: number;
  requester_chat_id: number;
  target: "private" | "groups" | "all";
  from_chat_id: number;
  message_id: number;
  preview: string | null;
  status: "pending" | "approved" | "rejected";
};

export async function createBroadcastRequest(p: {
  requester_id: number;
  requester_chat_id: number;
  target: "private" | "groups" | "all";
  from_chat_id: number;
  message_id: number;
  preview: string | null;
}): Promise<BroadcastRequest> {
  const { data, error } = await admin().from("broadcast_requests" as any).insert(p as any).select("*").single();
  if (error) throw error;
  return data as any;
}

export async function getBroadcastRequest(id: number): Promise<BroadcastRequest | null> {
  const { data } = await admin().from("broadcast_requests" as any).select("*").eq("id", id).maybeSingle();
  return (data as any) ?? null;
}

export async function setBroadcastRequestStatus(id: number, status: string, reviewed_by: number) {
  await admin().from("broadcast_requests" as any).update({ status, reviewed_by } as any).eq("id", id);
}

// ───── Paid unblock requests ─────
export type UnblockRequest = {
  id: number;
  telegram_id: number;
  stars: number;
  permanent: boolean;
  status: "pending" | "approved" | "rejected" | "paid";
  created_at: string;
};

/** Star price for releasing a block, by the block length that was applied. */
export const UNBLOCK_PRICES: Record<number, number> = {
  5: 1,
  15: 3,
  30: 10,
  1440: 50,
  2880: 60,
  10080: 100,
};
export const UNBLOCK_PRICE_PERMANENT = 200;

export function unblockPriceFor(u: { blocked_until?: string | null; block_strikes?: number | null }): number {
  if (!u.blocked_until) return UNBLOCK_PRICE_PERMANENT;
  const strike = Math.max(1, Number(u.block_strikes || 1));
  const minutes = BLOCK_LADDER_MIN[Math.min(strike, BLOCK_LADDER_MIN.length) - 1];
  return UNBLOCK_PRICES[minutes] ?? UNBLOCK_PRICE_PERMANENT;
}

export async function createUnblockRequest(p: { telegram_id: number; stars: number; permanent: boolean }): Promise<UnblockRequest> {
  const { data, error } = await admin().from("unblock_requests" as any).insert(p as any).select("*").single();
  if (error) throw error;
  return data as any;
}

export async function getUnblockRequest(id: number): Promise<UnblockRequest | null> {
  const { data } = await admin().from("unblock_requests" as any).select("*").eq("id", id).maybeSingle();
  return (data as any) ?? null;
}

export async function setUnblockRequestStatus(id: number, status: string, reviewed_by?: number) {
  await admin()
    .from("unblock_requests" as any)
    .update({ status, ...(reviewed_by ? { reviewed_by } : {}) } as any)
    .eq("id", id);
}

export async function openUnblockRequestFor(telegram_id: number): Promise<UnblockRequest | null> {
  const { data } = await admin()
    .from("unblock_requests" as any)
    .select("*")
    .eq("telegram_id", telegram_id)
    .in("status", ["pending", "approved"])
    .order("id", { ascending: false })
    .limit(1);
  return ((data ?? [])[0] as any) ?? null;
}

export async function listUnblockRequests(opts: { permanentOnly?: boolean; limit?: number } = {}): Promise<UnblockRequest[]> {
  let req = admin()
    .from("unblock_requests" as any)
    .select("*")
    .in("status", ["pending", "approved"])
    .order("id", { ascending: false })
    .limit(opts.limit ?? 20);
  if (opts.permanentOnly) req = req.eq("permanent", true);
  const { data } = await req;
  return ((data ?? []) as any) as UnblockRequest[];
}

/** Full release after a paid unblock: clears the block and the strike counter. */
export async function releaseUserAfterPayment(telegram_id: number) {
  await admin()
    .from("bot_users")
    .update({ is_blocked: false, blocked_until: null, block_reason: null, block_strikes: 0 })
    .eq("telegram_id", telegram_id);
}

// ───── Support tickets (admin contact group) ─────
export async function saveSupportThread(group_chat_id: number, group_message_id: number, telegram_id: number) {
  await admin()
    .from("support_threads" as any)
    .upsert({ group_chat_id, group_message_id, telegram_id } as any, { onConflict: "group_chat_id,group_message_id" });
}

export async function getSupportThreadUser(group_chat_id: number, group_message_id: number): Promise<number | null> {
  const { data } = await admin()
    .from("support_threads" as any)
    .select("telegram_id")
    .eq("group_chat_id", group_chat_id)
    .eq("group_message_id", group_message_id)
    .maybeSingle();
  return (data as any)?.telegram_id ? Number((data as any).telegram_id) : null;
}

// ───── Forum topics (one topic per user in the contact group) ─────
export async function getSupportTopicId(group_chat_id: number, telegram_id: number): Promise<number | null> {
  const { data } = await admin()
    .from("support_topics" as any)
    .select("topic_id")
    .eq("group_chat_id", group_chat_id)
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  return (data as any)?.topic_id ? Number((data as any).topic_id) : null;
}

export async function saveSupportTopic(group_chat_id: number, telegram_id: number, topic_id: number) {
  await admin()
    .from("support_topics" as any)
    .upsert({ group_chat_id, telegram_id, topic_id } as any, { onConflict: "group_chat_id,telegram_id" });
}

export async function getSupportTopicUser(group_chat_id: number, topic_id: number): Promise<number | null> {
  const { data } = await admin()
    .from("support_topics" as any)
    .select("telegram_id")
    .eq("group_chat_id", group_chat_id)
    .eq("topic_id", topic_id)
    .maybeSingle();
  return (data as any)?.telegram_id ? Number((data as any).telegram_id) : null;
}

export async function deleteSupportTopic(group_chat_id: number, telegram_id: number) {
  await admin()
    .from("support_topics" as any)
    .delete()
    .eq("group_chat_id", group_chat_id)
    .eq("telegram_id", telegram_id);
}

/** Every user that ever opened a ticket in the contact group. */
export async function listSupportUsers(group_chat_id: number): Promise<number[]> {
  const { data } = await admin()
    .from("support_threads" as any)
    .select("telegram_id")
    .eq("group_chat_id", group_chat_id)
    .limit(2000);
  const ids = new Set<number>();
  for (const r of (data as any[]) || []) ids.add(Number(r.telegram_id));
  return [...ids];
}

export async function clearSupportTopics(group_chat_id: number) {
  await admin().from("support_topics" as any).delete().eq("group_chat_id", group_chat_id);
}

/** All topic ids currently mapped in the contact group. */
export async function listSupportTopicIds(group_chat_id: number): Promise<number[]> {
  const { data } = await admin()
    .from("support_topics" as any)
    .select("topic_id")
    .eq("group_chat_id", group_chat_id)
    .limit(2000);
  return ((data as any[]) || []).map((r) => Number(r.topic_id)).filter(Boolean);
}
