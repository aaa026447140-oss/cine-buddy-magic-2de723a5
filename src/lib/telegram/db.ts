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
  const { data, error } = await req.range(offset, to);
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
  const { data, error } = await req.range(0, REGULAR_SEARCH_SCAN_LIMIT - 1);
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