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

export async function searchMovies(query: string, page: number, pageSize: number, opts: { includeCount?: boolean; knownTotal?: number } = {}) {
  const q = query.trim();
  if (!q) return { rows: [] as any[], total: 0 };
  const from = page * pageSize;
  const to = from + pageSize - 1;
  // Each word must match (in title OR caption); words are AND-ed together
  // so "עונה 6" requires both "עונה" and "6" to appear, not either one.
  const words = q.split(/\s+/).filter(Boolean).slice(0, 6);
  const includeCount = opts.includeCount !== false;
  let req = admin()
    .from("movies")
    .select("id,title,message_id,source_channel_id", includeCount ? { count: "exact" } : {});
  for (const w of words) {
    const esc = w.replace(/[%_,()]/g, "\\$&");
    req = req.or(`title.ilike.%${esc}%,raw_caption.ilike.%${esc}%`);
  }
  req = req.order("id", { ascending: false }).range(from, to);
  const { data, error, count } = await req;
  if (error) throw error;
  return { rows: data ?? [], total: includeCount ? (count ?? 0) : (opts.knownTotal ?? 0) };
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