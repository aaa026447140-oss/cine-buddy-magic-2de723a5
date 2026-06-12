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
  await admin().from("bot_users").update({ is_blocked: true }).eq("telegram_id", telegram_id);
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
const REGULAR_SEARCH_BATCH = 1000;
const REGULAR_SEARCH_SCAN_LIMIT = 12000;

type SearchMovieRow = {
  id: number;
  title: string;
  message_id: number;
  source_channel_id: number;
  raw_caption?: string | null;
};

type ParsedRegularSearch = {
  keywords: string[];
  seasonNumbers: number[];
  episodeNumbers: number[];
  genericNumbers: number[];
  hasNumberFilters: boolean;
};

export async function searchMovies(query: string, page: number, pageSize: number, opts: { includeCount?: boolean; knownTotal?: number } = {}) {
  const q = query.trim();
  if (!q) return { rows: [] as any[], total: 0 };
  const parsed = parseRegularSearch(q);
  if (parsed.hasNumberFilters) return searchMoviesRegular(q, parsed, page, pageSize);
  return searchMoviesByWords(q, page, pageSize, opts);
}

async function searchMoviesByWords(query: string, page: number, pageSize: number, opts: { includeCount?: boolean; knownTotal?: number }) {
  const from = page * pageSize;
  const to = from + pageSize - 1;
  const words = query.split(/\s+/).filter(Boolean).slice(0, SEARCH_WORD_LIMIT);
  const includeCount = opts.includeCount !== false;
  let req: any = admin()
    .from("movies")
    .select("id,title,message_id,source_channel_id", includeCount ? { count: "exact" } : {});
  for (const w of words) req = req.or(ilikeAnyField(w));
  const { data, error, count } = await req.order("id", { ascending: false }).range(from, to);
  if (error) throw error;
  return { rows: data ?? [], total: includeCount ? (count ?? 0) : (opts.knownTotal ?? 0) };
}

async function searchMoviesRegular(query: string, parsed: ParsedRegularSearch, page: number, pageSize: number) {
  const candidates: SearchMovieRow[] = [];
  for (let from = 0; from < REGULAR_SEARCH_SCAN_LIMIT; from += REGULAR_SEARCH_BATCH) {
    const to = Math.min(from + REGULAR_SEARCH_BATCH - 1, REGULAR_SEARCH_SCAN_LIMIT - 1);
    const { data, error } = await buildRegularSearchRequest(query, parsed).range(from, to);
    if (error) throw error;
    const batch = (data ?? []) as SearchMovieRow[];
    candidates.push(...batch);
    if (batch.length < REGULAR_SEARCH_BATCH) break;
  }
  const filtered = candidates
    .filter((row) => matchesRegularSearch(row, parsed))
    .map((row) => ({ row, score: regularSearchScore(row, parsed) }))
    .sort((a, b) => b.score - a.score || Number(b.row.id) - Number(a.row.id))
    .map(({ row }) => ({ id: row.id, title: row.title, message_id: row.message_id, source_channel_id: row.source_channel_id }));
  const from = page * pageSize;
  return { rows: filtered.slice(from, from + pageSize), total: filtered.length };
}

function buildRegularSearchRequest(query: string, parsed: ParsedRegularSearch): any {
  let req: any = admin().from("movies").select("id,title,message_id,source_channel_id,raw_caption");
  for (const word of parsed.keywords.slice(0, SEARCH_WORD_LIMIT)) req = req.or(ilikeAnyField(word));
  if (parsed.keywords.length === 0) {
    const numericConditions = numericBaseConditions(parsed);
    if (numericConditions.length > 0) req = req.or(numericConditions.join(","));
    else for (const w of query.split(/\s+/).filter(Boolean).slice(0, SEARCH_WORD_LIMIT)) req = req.or(ilikeAnyField(w));
  }
  return req.order("id", { ascending: false });
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
  return conditions.slice(0, 80);
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

export async function listUsers(): Promise<number[]> {
  const { data } = await admin().from("bot_users").select("telegram_id").eq("is_blocked", false);
  return (data ?? []).map((r: any) => Number(r.telegram_id));
}

export async function stats() {
  const a = admin();
  const [{ count: movies }, { count: users }, { count: groups }, { data: payments }] = await Promise.all([
    a.from("movies").select("*", { count: "exact", head: true }),
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
export type CachedSearch = { query: string; total?: number };
export type CachedSearchPage = { rows: any[]; total: number };
export type CachedPageState = {
  queryId: string;
  page: number;
  status: "rendered" | "pending";
  requestedAt: number;
};

export async function cacheQuery(id: string, query: string, total?: number) {
  const value = JSON.stringify({ kind: "search", query, total, cached_at: Date.now() });
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
    if (parsed?.kind === "search" && typeof parsed.query === "string") return { query: parsed.query, total: parsed.total };
  } catch {
    // Backward compatibility with old rows that stored only the raw query text.
  }
  return { query: value };
}
export async function cacheSearchPage(id: string, page: number, pageSize: number, rows: any[], total: number) {
  const value = JSON.stringify({ kind: "page", rows, total, cached_at: Date.now() });
  await admin().from("query_cache").upsert(
    { id: pageCacheId(id, page, pageSize), query: value, created_at: new Date().toISOString() },
    { onConflict: "id" },
  );
}
export async function getCachedSearchPage(id: string, page: number, pageSize: number): Promise<CachedSearchPage | null> {
  const { data } = await admin().from("query_cache").select("query").eq("id", pageCacheId(id, page, pageSize)).maybeSingle();
  const value = (data as any)?.query;
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.kind === "page" && Array.isArray(parsed.rows) && typeof parsed.total === "number") {
      return { rows: parsed.rows, total: parsed.total };
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