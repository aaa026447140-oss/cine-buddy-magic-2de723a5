import {
  answerCallbackQuery,
  answerPreCheckoutQuery,
  copyMessage,
  editMessageText,
  getChat,
  getChatMember,
  getChatMemberCount,
  pinChatMessage,
  sendInvoice,
  sendMessage,
  tg,
} from "./api";
import { ADMIN_ID, PAGE_SIZE, STAR_AMOUNTS } from "./constants";
import { formatDuration, formatWhen, isInappropriateQuery, matchesBlockedWords } from "./moderation";
import {
  addAdmin,
  addSourceChannel,
  addRequiredChannel,
  countBroadcastRecipients,
  createBroadcastJob,
  listRequiredChannels,
  listUsersPaged,
  removeRequiredChannel,
  MAX_PERMANENT_REQUIRED,
  MAX_TEMPORARY_REQUIRED,
  cacheQuery,
  cacheSearchAll,
  getCachedSearch,
  getCachedSearchAll,
  getAdminState,
  getBotUser,
  applyAutoBlock,
  releaseIfExpired,
  logSearch,
  FLAGGED_PREFIX,
  lastSearches,
  getMovieById,
  getSettings,
  indexMovie,
  isSourceChannel,
  isUserAdmin,
  listAdmins,
  listGroups,
  listGroupsDetailed,
  listSourceChannels,
  listUsers,
  markGroupInactive,
  markUserBlocked,
  unmarkUserBlocked,
  unblockAllUsers,
  recordPayment,
  removeAdmin,
  removeSourceChannel,
  fetchAllSearchCandidates,
  paginateCandidates,
  searchBotUsers,
  setAdminState,
  setPageState,
  stats,
  updateSettings,
  upsertGroup,
  upsertUser,
  userStars,
  touchGroupMember,
  uniqueReach,
  getEntitlements,
  addBonusDaily,
  addExtraCredits,
  setPremium,
  registerReferral,
  searchesUsedToday,
  premiumIdsAmong,
  consumeSearch,
  listBlockedWords,
  addBlockedWord,
  removeBlockedWord,
  resetDailyQuotaForAll,
  serverMetrics,
  moviesCount,
  createBroadcastRequest,
  getBroadcastRequest,
  setBroadcastRequestStatus,
  createUnblockRequest,
  getUnblockRequest,
  setUnblockRequestStatus,
  openUnblockRequestFor,
  listUnblockRequests,
  releaseUserAfterPayment,
  unblockPriceFor,
  saveSupportThread,
  getSupportThreadUser,
  type BotSettings,
  type BotUserRow,
} from "./db";
import { processBroadcastTick } from "./broadcast";
import {
  adminPanelKeyboard,
  adminsListKeyboard,
  requiredChannelsKeyboard,
  subscribeChannelsKeyboard,
  resultsKeyboard,
  sourceChannelsKeyboard,
  startMenuKeyboard,
  subscribeRequiredKeyboard,
  supportMenuKeyboard,
  quotaMenuKeyboard,
  quotaAdminKeyboard,
  blockedWordsKeyboard,
} from "./keyboards";

let _me: { id: number; username: string } | null = null;
async function getMe() {
  if (_me) return _me;
  const m: any = await tg("getMe");
  _me = { id: m.id, username: m.username };
  return _me;
}

// Check the bot has admin + can_invite_users permission in a group.
// Returns { ok: true } when permitted; otherwise returns a message tagging
// the group admin explaining permissions are missing.
async function checkGroupPermissions(chatId: number): Promise<
  { ok: true } | { ok: false; text: string; extra?: any }
> {
  try {
    const me = await getMe();
    const self: any = await getChatMember(chatId, me.id).catch(() => null);
    const isAdmin = self && (self.status === "administrator" || self.status === "creator");
    const canInvite = self?.status === "creator" || !!self?.can_invite_users;
    if (isAdmin && canInvite) return { ok: true };
    // Find an admin to tag.
    const admins: any[] = await tg("getChatAdministrators", { chat_id: chatId }).catch(() => []);
    const target = admins.find((a) => a?.user && !a.user.is_bot && a.status === "creator")
      || admins.find((a) => a?.user && !a.user.is_bot);
    let mention = "המנהל";
    if (target?.user) {
      const u = target.user;
      if (u.username) mention = `@${u.username}`;
      else {
        const name = escapeHtml(`${u.first_name || ""} ${u.last_name || ""}`.trim() || "מנהל");
        mention = `<a href="tg://user?id=${u.id}">${name}</a>`;
      }
    }
    return { ok: false, text: `${mention} חסרות לבוט הרשאות כדי לפעול כמו שצריך` };
  } catch {
    return { ok: true };
  }
}

function isMainAdmin(userId: number | undefined) {
  return userId === ADMIN_ID;
}
async function isAdmin(userId: number | undefined): Promise<boolean> {
  if (!userId) return false;
  return isUserAdmin(userId, ADMIN_ID);
}

function extractTitle(msg: any): string {
  const cap = msg.caption || msg.text || "";
  if (msg.video?.file_name) return cap || msg.video.file_name;
  if (msg.document?.file_name) return cap || msg.document.file_name;
  if (msg.audio?.title) return cap || msg.audio.title;
  return cap || "";
}

function extractFile(msg: any) {
  if (msg.video) return { file_unique_id: msg.video.file_unique_id, file_type: "video", duration: msg.video.duration, file_size: msg.video.file_size };
  if (msg.document) return { file_unique_id: msg.document.file_unique_id, file_type: "document", duration: null, file_size: msg.document.file_size };
  if (msg.audio) return { file_unique_id: msg.audio.file_unique_id, file_type: "audio", duration: msg.audio.duration, file_size: msg.audio.file_size };
  if (msg.animation) return { file_unique_id: msg.animation.file_unique_id, file_type: "animation", duration: msg.animation.duration, file_size: msg.animation.file_size };
  return null;
}

type RequiredTarget = { chat_id: number; title: string; url: string };

/** Legacy single required channel + the multi list (permanent + live temporary). */
async function requiredTargets(settings: BotSettings): Promise<RequiredTarget[]> {
  const list = await listRequiredChannels().catch(() => []);
  const targets: RequiredTarget[] = list.map((c) => ({
    chat_id: c.chat_id,
    title: c.title || c.username || String(c.chat_id),
    url: c.invite_link || (c.username ? `https://t.me/${c.username}` : ""),
  }));
  if (settings.required_channel_id && !targets.some((t) => t.chat_id === Number(settings.required_channel_id))) {
    targets.unshift({
      chat_id: Number(settings.required_channel_id),
      title: settings.required_channel_title || settings.required_channel_username || "ערוץ החובה",
      url:
        settings.required_channel_invite_link ||
        (settings.required_channel_username ? `https://t.me/${settings.required_channel_username}` : ""),
    });
  }
  return targets;
}

async function missingRequiredChannels(userId: number, settings: BotSettings): Promise<RequiredTarget[]> {
  const targets = await requiredTargets(settings);
  if (!targets.length) return [];
  const checks = await Promise.all(
    targets.map(async (t) => {
      try {
        const m: any = await getChatMember(t.chat_id, userId);
        return ["creator", "administrator", "member", "restricted"].includes(m.status) ? null : t;
      } catch {
        return t;
      }
    }),
  );
  return checks.filter(Boolean) as RequiredTarget[];
}

async function isSubscribed(userId: number, settings: BotSettings): Promise<boolean> {
  return (await missingRequiredChannels(userId, settings)).length === 0;
}

// ───── Search quota ─────
type QuotaInfo = {
  enabled: boolean;
  premium: boolean;
  limit: number;
  used: number;
  bonus: number;
  credits: number;
  referrals: number;
};

async function quotaInfo(userId: number, settings: BotSettings): Promise<QuotaInfo> {
  const [ent, used] = await Promise.all([
    getEntitlements(userId).catch(() => null),
    searchesUsedToday(userId).catch(() => 0),
  ]);
  const bonus = ent?.bonus_daily ?? 0;
  return {
    enabled: !!settings.quota_enabled,
    premium: !!ent?.is_premium,
    limit: Math.max(0, Number(settings.free_searches_per_day || 0)) + bonus,
    used,
    bonus,
    credits: ent?.extra_credits ?? 0,
    referrals: ent?.referrals_count ?? 0,
  };
}

/**
 * Consume one search from the user's daily allowance.
 * Returns true when the search may proceed; otherwise sends the upsell prompt.
 */
async function allowSearch(
  chatId: number,
  userId: number,
  settings: BotSettings,
  inGroup: boolean,
  replyToMessageId?: number,
): Promise<boolean> {
  if (!settings.quota_enabled) return true;
  if (await isAdmin(userId)) return true;
  const ent = await getEntitlements(userId).catch(() => null);
  if (ent?.is_premium) return true;
  const limit = Math.max(0, Number(settings.free_searches_per_day || 0)) + (ent?.bonus_daily ?? 0);
  const res = await consumeSearch(userId, limit);
  if (res.allowed) return true;
  const me = await getMe();
  if (inGroup) {
    await sendMessage(
      chatId,
      `⏳ נגמרו לך החיפושים החינמיים להיום (${limit}).\nפתח את הבוט בפרטי כדי לקבל עוד חיפושים.`,
      {
        reply_to_message_id: replyToMessageId,
        reply_markup: { inline_keyboard: [[{ text: "🎟️ קבל עוד חיפושים", url: `https://t.me/${me.username}?start=quota` }]] },
      } as any,
    ).catch(() => {});
    return false;
  }
  await sendMessage(chatId, quotaText(await quotaInfo(userId, settings), settings, me.username, userId), {
    reply_markup: quotaMenuKeyboard(settings, me.username, userId, false),
  }).catch(() => {});
  return false;
}

function quotaText(q: QuotaInfo, s: BotSettings, botUsername: string, userId: number): string {
  if (!q.enabled) {
    return (
      `🎟️ <b>החיפושים שלי</b>\n\n` +
      `✅ כרגע החיפוש בבוט הוא <b>ללא הגבלה</b> — אין מכסה יומית.\n` +
      (q.bonus ? `🎁 בונוס קבוע מהזמנות: <b>+${q.bonus}</b> ליום (${q.referrals} הזמנות)\n` : "") +
      (q.credits ? `⚡ חיפושים חד־פעמיים שנרכשו: <b>${q.credits}</b>\n` : "") +
      `\n📣 <b>הזמן חברים</b> — כל משתמש חדש שיצטרף דרך הקישור שלך מוסיף לך <b>+1 חיפוש בכל יום</b>, לתמיד.\n` +
      `🔗 <code>https://t.me/${botUsername}?start=r_${userId}</code>`
    );
  }
  if (q.premium) {
    return (
      `💎 <b>פרימיום פעיל</b>\n\n` +
      `יש לך חיפושים <b>ללא הגבלה</b>. תודה על התמיכה ❤️\n\n` +
      `🔗 קישור ההזמנה שלך:\n<code>https://t.me/${botUsername}?start=r_${userId}</code>`
    );
  }
  const left = Math.max(0, q.limit - q.used);
  return (
    `🎟️ <b>החיפושים שלי</b>\n\n` +
    `🔍 חיפושים חינם היום: <b>${left}</b> מתוך <b>${q.limit}</b>\n` +
    (q.bonus ? `🎁 בונוס קבוע מהזמנות: <b>+${q.bonus}</b> ליום (${q.referrals} הזמנות)\n` : "") +
    (q.credits ? `⚡ חיפושים חד־פעמיים שנרכשו: <b>${q.credits}</b>\n` : "") +
    `\n📣 <b>הזמן חברים</b> — כל משתמש חדש שיצטרף דרך הקישור שלך מוסיף לך <b>+1 חיפוש בכל יום</b>, לתמיד.\n` +
    `🔗 <code>https://t.me/${botUsername}?start=r_${userId}</code>\n\n` +
    `💫 אפשר גם לרכוש:\n` +
    `• ⚡ חיפוש נוסף חד־פעמי — ${s.price_single_search} ⭐\n` +
    `• 📅 +1 חיפוש בכל יום (לתמיד) — ${s.price_daily_extra} ⭐\n` +
    `• 💎 פרימיום ללא הגבלה — ${s.price_premium} ⭐`
  );
}

async function sendQuotaMenu(chatId: number, userId: number, editMessageId?: number) {
  const settings = await getSettings();
  const me = await getMe();
  const q = await quotaInfo(userId, settings);
  const text = quotaText(q, settings, me.username, userId);
  const kb = quotaMenuKeyboard(settings, me.username, userId, q.premium);
  if (editMessageId) {
    const ok = await editMessageText(chatId, editMessageId, text, { reply_markup: kb }).then(() => true).catch(() => false);
    if (ok) return;
  }
  await sendMessage(chatId, text, { reply_markup: kb }).catch(() => {});
}

function quotaAdminText(s: BotSettings): string {
  return (
    `🎟️ <b>ניהול חיפושים ומחירים</b>\n\n` +
    `מצב: <b>${s.quota_enabled ? "מוגבל (מכסה יומית)" : "חופשי — ללא הגבלה"}</b>\n` +
    `🔢 חיפושים חינם ליום: <b>${s.free_searches_per_day}</b>\n` +
    `⚡ חיפוש חד־פעמי: <b>${s.price_single_search}</b> ⭐\n` +
    `📅 +1 חיפוש בכל יום: <b>${s.price_daily_extra}</b> ⭐\n` +
    `💎 פרימיום ללא הגבלה: <b>${s.price_premium}</b> ⭐\n\n` +
    `🎁 כל משתמש חדש שמצטרף דרך קישור ההזמנה מוסיף למזמין +1 חיפוש בכל יום.`
  );
}

async function renderQuotaAdmin(chatId: number, messageId: number, s: BotSettings) {
  await editMessageText(chatId, messageId, quotaAdminText(s), { reply_markup: quotaAdminKeyboard(s) }).catch(() => {});
}

// ───── Blocked words ─────
async function renderBlockedWords(chatId: number, messageId: number) {
  const words = await listBlockedWords(true).catch(() => [] as string[]);
  const text =
    `🚫 <b>מילים חסומות</b>\n\n` +
    `חיפוש שמכיל אחת מהמילים האלה יגרום לחסימה אוטומטית מדורגת.\n` +
    `סה״כ מילים: <b>${words.length}</b>\n\n` +
    `לחיצה על מילה תסיר אותה מהרשימה.`;
  await editMessageText(chatId, messageId, text, { reply_markup: blockedWordsKeyboard(words.slice(0, 60)) }).catch(() => {});
}

// ───── Server load meter ─────
function fmtBytes(n: number) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

async function serverLoadText(force = false): Promise<string> {
  const m = await serverMetrics(force).catch(() => ({} as Record<string, number>));
  if (!Object.keys(m).length) {
    return `📈 <b>מד עומס שרת</b>\n\n⏳ צילום המצב לא התקבל — לחץ על רענן.`;
  }
  const movies = m.movies_count ?? 0;
  const conns = m.connections ?? 0;
  const maxConns = m.max_connections || 60;
  const connPct = Math.min(100, (conns / maxConns) * 100);
  const rate = m.searches_last_min ?? 0;
  const storage = m.db_bytes ?? 0;
  const capturedAt = new Date((m.captured_at_epoch ?? Date.now() / 1000) * 1000);
  const now = capturedAt.toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem" });
  const uptime = (() => {
    const s = m.uptime_sec ?? 0;
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), mi = Math.floor((s % 3600) / 60);
    return d > 0 ? `${d} ימים ${h} שע׳` : h > 0 ? `${h} שע׳ ${mi} דק׳` : `${mi} דק׳`;
  })();
  const shared = m.shared_buffers_bytes ?? 0;
  const effCache = m.effective_cache_bytes ?? 0;
  const memPerConn = m.work_mem_bytes ?? 0;
  const commits = m.commits ?? 0;
  const rollbacks = m.rollbacks ?? 0;
  const rbPct = commits + rollbacks > 0 ? (rollbacks / (commits + rollbacks)) * 100 : 0;
  return (
    `📈 <b>מד עומס שרת</b> · צילום מצב ${now}\n` +
    `✅ נתונים ישירים שנמדדו באותו רגע — ללא הערכות\n\n` +
    `🧠 <b>הגדרות זיכרון מאומתות</b>\n` +
    `• מטמון פנימי (shared_buffers): ${fmtBytes(shared)}\n` +
    `• יעד מטמון (effective_cache): ${fmtBytes(effCache)}\n` +
    `• זיכרון מרבי לשאילתה (work_mem): ${fmtBytes(memPerConn)}\n` +
    `• זיכרון תחזוקה: ${fmtBytes(m.maintenance_work_mem_bytes ?? 0)}\n\n` +
    `🔌 חיבורים: <b>${conns}/${maxConns}</b> (${Math.round(connPct)}%)\n` +
    `• פנויים: <b>${m.idle_conns ?? 0}</b> · תקועים בטרנזקציה: <b>${m.idle_in_tx ?? 0}</b>\n` +
    `⚡ שאילתות פעילות כרגע: <b>${m.active_queries ?? 0}</b>\n` +
    `⏱️ השאילתה הארוכה ביותר: <b>${m.longest_query_sec ?? 0} שנ׳</b>\n` +
    `🔒 שאילתות ממתינות לנעילה: <b>${m.waiting_queries ?? 0}</b>\n` +
    `💥 קיפאונים (deadlocks): <b>${m.deadlocks ?? 0}</b> · ביטולי טרנזקציה: <b>${rbPct.toFixed(2)}%</b>\n\n` +
    `🔎 חיפושים בדקה האחרונה: <b>${rate}</b>\n` +
    `🕐 חיפושים בשעה האחרונה: <b>${m.searches_last_hour ?? 0}</b>\n` +
    `📅 חיפושים ב-24 שעות: <b>${m.searches_today ?? 0}</b>\n` +
    `🎯 יעילות מטמון: <b>${m.cache_hit_ratio ?? 0}%</b> · אינדקסים: <b>${m.index_hit_ratio ?? 0}%</b>\n` +
    `📥 שורות שנקראו: <b>${(m.tuples_read ?? 0).toLocaleString()}</b> · נכתבו: <b>${(m.tuples_written ?? 0).toLocaleString()}</b>\n\n` +
    `💾 <b>גודל מסד הנתונים בפועל</b>: ${fmtBytes(storage)}\n` +
    `🎬 מאגר הסרטים: ${fmtBytes(m.movies_bytes ?? 0)} (מתוכו אינדקסים: ${fmtBytes(m.movies_index_bytes ?? 0)})\n` +
    `👤 טבלת משתמשים: ${fmtBytes(m.users_bytes ?? 0)} · 🗒️ לוגים/מטמון: ${fmtBytes(m.logs_bytes ?? 0)}\n` +
    `📝 יומן כתיבה (WAL): ${fmtBytes(m.wal_bytes ?? 0)} · קבצים זמניים: ${fmtBytes(m.temp_bytes ?? 0)} (${m.temp_files ?? 0})\n\n` +
    `📊 <b>פעילות היום</b>\n` +
    `• משתמשים חדשים: <b>${m.new_users_today ?? 0}</b> · פעילים: <b>${m.active_users_today ?? 0}</b>\n` +
    `• סרטים חדשים שנוספו: <b>${m.new_movies_today ?? 0}</b>\n` +
    `• חסומים: <b>${m.blocked_users ?? 0}</b> · פרימיום: <b>${m.premium_users ?? 0}</b>\n` +
    `• שורות במטמון חיפוש: <b>${m.cache_rows ?? 0}</b>\n\n` +
    `🕒 זמן פעילות השרת: <b>${uptime}</b>\n` +
    `👤 משתמשים: <b>${m.users_count ?? 0}</b> · 👥 קבוצות: <b>${m.groups_count ?? 0}</b> · 🎬 סרטים: <b>${movies.toLocaleString()}</b>`
  );
}

async function renderServerLoad(chatId: number, messageId: number) {
  const kb = {
    inline_keyboard: [
      [{ text: "🔄 רענן", callback_data: "admin_load" }],
      [{ text: "« חזרה", callback_data: "admin_open" }],
    ],
  };
  // Single snapshot + refresh button. A long polling loop here kept the webhook
  // request open for ~10s, and Telegram serialises updates per chat — that made
  // every other admin button feel stuck/slow while the meter was running.
  const text = await serverLoadText(true);
  await editMessageText(chatId, messageId, text, { reply_markup: kb }).catch(() => {});
}

async function requireSubscriptionOrPrompt(
  chatId: number,
  userId: number,
  settings: BotSettings,
  recheckPayload: string,
): Promise<boolean> {
  const missing = await missingRequiredChannels(userId, settings);
  if (!missing.length) return true;
  const lines = missing.map((m) => `• <b>${escapeHtml(m.title)}</b>`).join("\n");
  await sendMessage(
    chatId,
    `🔒 כדי להשתמש בבוט עליך להיות מנוי לערוצי החובה הבאים:\n\n${lines}\n\nהצטרף ולחץ על «הצטרפתי, בדוק שוב».`,
    { reply_markup: subscribeChannelsKeyboard(missing, recheckPayload) },
  );
  return false;
}

// ───── Main entry ─────
export async function handleUpdate(update: any) {
  try {
    if (update.message) return await handleMessage(update.message);
    if (update.edited_message) return; // ignore edits
    if (update.channel_post) return await handleChannelPost(update.channel_post);
    if (update.callback_query) return await handleCallback(update.callback_query);
    if (update.pre_checkout_query) return await handlePreCheckout(update.pre_checkout_query);
    if (update.my_chat_member) return await handleMyChatMember(update.my_chat_member);
  } catch (e: any) {
    console.error("handleUpdate error:", e?.message || e);
  }
}

// ───── Channel posts (auto-index new movies) ─────
async function handleChannelPost(msg: any) {
  const chatId = Number(msg.chat.id);
  // Accept any chat in the multi-source list (plus legacy single setting).
  const fromMulti = await isSourceChannel(chatId);
  if (!fromMulti) {
    const settings = await getSettings();
    if (Number(settings.source_channel_id || 0) !== chatId) return;
  }
  const file = extractFile(msg);
  if (!file) return;
  const title = extractTitle(msg);
  if (!title) return;
  await indexMovie({
    source_channel_id: chatId,
    message_id: Number(msg.message_id),
    title,
    raw_caption: msg.caption || msg.text || null,
    ...file,
  });
}

// ───── my_chat_member: track group join/leave ─────
async function handleMyChatMember(ev: any) {
  const chat = ev.chat;
  const newStatus = ev.new_chat_member?.status;
  if (chat.type === "group" || chat.type === "supergroup") {
    if (["left", "kicked"].includes(newStatus)) {
      await markGroupInactive(Number(chat.id));
    } else {
      await upsertGroup({ id: Number(chat.id), title: chat.title, type: chat.type });
    }
  }
}

// ───── Messages ─────
async function handleMessage(msg: any) {
  const chat = msg.chat;
  const from = msg.from;
  if (!from) return;

  // Group: track membership and handle search by text
  if (chat.type === "group" || chat.type === "supergroup") {
    // Admin contact group: relay main-admin replies back to the user.
    const gs = await getSettings().catch(() => null);
    if (gs?.support_group_id && Number(gs.support_group_id) === Number(chat.id)) {
      return await handleSupportGroupMessage(msg);
    }
    await upsertGroup({ id: Number(chat.id), title: chat.title, type: chat.type });
    touchGroupMember(Number(chat.id), Number(from.id)).catch(() => {});
    if (msg.text) {
      // Treat any text starting with "?" or any text that isn't a command as a search.
      const text = msg.text.trim();
      if (text.startsWith("/")) return; // ignore commands in groups
      if (text.length < 2) return;
      // Blocked user in a group: silently ignore search attempts, but notify them.
      const bu = await getBotUser(Number(from.id)).catch(() => null);
      if (bu?.is_blocked && !(await releaseIfExpired(bu).catch(() => false))) {
        await sendBlockedNotice(Number(chat.id), bu, msg.message_id);
        return;
      }
      if (await moderationGate(chat.id, Number(from.id), text, msg.message_id)) return;
      // Require bot admin+can_invite_users permission in the group before serving results.
      const perm = await checkGroupPermissions(chat.id).catch(() => ({ ok: true } as any));
      if (!perm.ok) {
        await sendMessage(chat.id, perm.text, perm.extra || {}).catch(() => {});
        return;
      }
      const settings = await getSettings();
      if (!(await allowSearch(Number(chat.id), Number(from.id), settings, true, msg.message_id))) return;
      logSearch(Number(from.id), text).catch(() => {});
      await safeRunSearchAndRespond(chat.id, from.id, text, 0, null, true);
    }
    return;
  }

  // Private chat
  if (chat.type !== "private") return;
  await upsertUser({
    id: Number(from.id),
    username: from.username,
    first_name: from.first_name,
    last_name: from.last_name,
    language_code: from.language_code,
  });

  // Successful payment notification
  if (msg.successful_payment) {
    const sp = msg.successful_payment;
    const payload: string = sp.invoice_payload || "";
    await recordPayment({
      telegram_user_id: Number(from.id),
      stars_amount: Number(sp.total_amount),
      telegram_payment_charge_id: sp.telegram_payment_charge_id,
      telegram_provider_charge_id: sp.provider_payment_charge_id || "",
      payload,
    });
    if (payload.startsWith("buy:")) {
      const kind = payload.split(":")[1];
      if (kind === "single") {
        await addExtraCredits(Number(from.id), 1).catch(() => {});
        await sendMessage(chat.id, "⚡ נוסף לך חיפוש נוסף חד־פעמי. תודה! ❤️");
      } else if (kind === "daily") {
        await addBonusDaily(Number(from.id), 1).catch(() => {});
        await sendMessage(chat.id, "📅 מעכשיו יש לך +1 חיפוש בכל יום, לתמיד. תודה! ❤️");
      } else if (kind === "premium") {
        await setPremium(Number(from.id), true).catch(() => {});
        await sendMessage(chat.id, "💎 הפרימיום הופעל! חיפושים ללא הגבלה. תודה! ❤️");
      }
      return;
    }
    if (payload.startsWith("unblock:")) {
      const reqId = Number(payload.split(":")[1]);
      await releaseUserAfterPayment(Number(from.id)).catch(() => {});
      await setUnblockRequestStatus(reqId, "paid").catch(() => {});
      await sendMessage(chat.id, "🔓 החסימה שלך הוסרה. תודה! שים לב — עבירה נוספת תוביל לחסימה חדשה.");
      await sendMessage(
        ADMIN_ID,
        `💰 המשתמש <code>${from.id}</code> שילם ${sp.total_amount} ⭐ והחסימה שלו הוסרה.`,
      ).catch(() => {});
      return;
    }
    await sendMessage(chat.id, `🙏 תודה רבה על התמיכה! קיבלנו ${sp.total_amount} ⭐`);
    return;
  }

  const text: string = msg.text || "";

  // Support ticket composition (available to every user, not only admins).
  {
    const st0 = await getAdminState(Number(from.id)).catch(() => null);
    if (st0?.state === "awaiting_support_msg") {
      if (text === "/cancel") {
        await setAdminState(Number(from.id), null).catch(() => {});
        await sendMessage(chat.id, "❎ בוטל.");
        return;
      }
      await setAdminState(Number(from.id), null).catch(() => {});
      return await forwardSupportMessage(msg);
    }
  }

  // Admin multi-step flow
  if (await isAdmin(from.id)) {
    const st = await getAdminState(Number(from.id));
    // Legacy leftover state from the old in-request broadcast: never lock the
    // admin out — broadcasts now run as resumable background jobs.
    if (st?.state === "broadcasting") {
      await setAdminState(Number(from.id), null).catch(() => {});
      return;
    }
    if (st && (text === "/cancel" || !text.startsWith("/"))) {
      return await handleAdminStateInput(chat.id, Number(from.id), st, msg);
    }
  }

  // Global /cancel — clear any pending admin state; harmless for regular users.
  if (text === "/cancel") {
    await setAdminState(Number(from.id), null).catch(() => {});
    await sendMessage(chat.id, "❎ בוטל.");
    return;
  }

  // Block check for private chats — blocked users cannot search.
  {
    const bu = await getBotUser(Number(from.id)).catch(() => null);
    if (bu?.is_blocked && text && !text.startsWith("/start") && text !== "/stats" && text !== "/admin") {
      if (!(await releaseIfExpired(bu).catch(() => false))) {
        await sendBlockedNotice(Number(chat.id), bu);
        return;
      }
    }
  }

  // /start with optional payload
  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    const payload = parts[1] || "";
    if (payload.startsWith("m_")) {
      const movieId = Number(payload.slice(2));
      return await serveMovie(chat.id, Number(from.id), movieId);
    }
    if (payload.startsWith("r_")) {
      const referrer = Number(payload.slice(2));
      if (Number.isFinite(referrer) && referrer !== Number(from.id)) {
        const ok = await registerReferral(Number(from.id), referrer).catch(() => false);
        if (ok) {
          const settings = await getSettings();
          if (settings.quota_enabled) {
            await sendMessage(referrer, "🎉 מישהו הצטרף דרך הקישור שלך — קיבלת +1 חיפוש בכל יום!").catch(() => {});
          }
        }
      }
      return await sendStartMenu(chat.id, Number(from.id));
    }
    if (payload === "quota") {
      return await sendQuotaMenu(chat.id, Number(from.id));
    }
    return await sendStartMenu(chat.id, Number(from.id));
  }

  if (text === "/stats") {
    return await sendStats(chat.id, Number(from.id));
  }

  if (text === "/admin" && (await isAdmin(from.id))) {
    return await sendAdminPanel(chat.id, Number(from.id));
  }

  // Free-text search in private
  if (text && !text.startsWith("/")) {
    if (await moderationGate(chat.id, Number(from.id), text)) return;
    const settings = await getSettings();
    if (!(await allowSearch(chat.id, Number(from.id), settings, false))) return;
    logSearch(Number(from.id), text).catch(() => {});
    return await safeRunSearchAndRespond(chat.id, Number(from.id), text, 0, null, false);
  }
}

/** Message shown to an already-blocked user, including release time. */
function blockedNotice(u: { blocked_until?: string | null; block_reason?: string | null }) {
  return blockedNoticeText(u);
}

function blockedNoticeText(u: { blocked_until?: string | null; block_reason?: string | null }) {
  if (!u.blocked_until) return "🚫 אתה חסום לצמיתות. פנה למנהל.";
  return (
    "🚫 אתה חסום כרגע.\n" +
    (u.block_reason ? `סיבה: ${u.block_reason}\n` : "") +
    `תשוחרר: ${formatWhen(u.blocked_until)}`
  );
}

// ───── Admin contact group (support tickets) ─────

/** A user's message to the admin: copied into the contact group with a header. */
async function forwardSupportMessage(msg: any) {
  const from = msg.from;
  const settings = await getSettings();
  const gid = Number(settings.support_group_id || 0);
  if (!gid) {
    await sendMessage(msg.chat.id, "❌ אין כרגע קבוצת פניות מוגדרת. נסה שוב מאוחר יותר.").catch(() => {});
    return;
  }
  const name = escapeHtml(
    [from.first_name, from.last_name].filter(Boolean).join(" ") || String(from.id),
  );
  const header =
    `✉️ <b>פנייה חדשה</b>\n` +
    `👤 ${name}${from.username ? ` · @${escapeHtml(from.username)}` : ""}\n` +
    `🆔 <code>${from.id}</code>\n\n` +
    `<i>כדי להשיב — הגב על ההודעה הזו או על ההודעה של המשתמש.</i>`;
  try {
    const head: any = await sendMessage(gid, header);
    const copied: any = await copyMessage(gid, msg.chat.id, msg.message_id);
    if (head?.message_id) await saveSupportThread(gid, Number(head.message_id), Number(from.id)).catch(() => {});
    if (copied?.message_id) await saveSupportThread(gid, Number(copied.message_id), Number(from.id)).catch(() => {});
    await sendMessage(msg.chat.id, "✅ הפנייה נשלחה לאדמין. תקבל תשובה כאן בצ׳אט.").catch(() => {});
  } catch (e: any) {
    console.error("support forward failed:", e?.message);
    await sendMessage(msg.chat.id, "❌ לא הצלחתי לשלוח את הפנייה. נסה שוב מאוחר יותר.").catch(() => {});
  }
}

/** Main-admin replies inside the contact group are relayed to the user. */
async function handleSupportGroupMessage(msg: any) {
  const from = msg.from;
  if (Number(from?.id) !== ADMIN_ID) return;
  if (msg.text && msg.text.trim() === "/cancel") return;
  const replyTo = msg.reply_to_message;
  if (!replyTo) {
    await sendMessage(
      msg.chat.id,
      "ℹ️ כדי לשלוח הודעה למשתמש — <b>הגב על ההודעה שלו</b> כאן בקבוצה. הודעה שלא נשלחה כתגובה לא נשלחת לאף אחד.",
      { reply_to_message_id: msg.message_id } as any,
    ).catch(() => {});
    return;
  }
  const target = await getSupportThreadUser(Number(msg.chat.id), Number(replyTo.message_id)).catch(() => null);
  if (!target) {
    await sendMessage(
      msg.chat.id,
      "❌ לא זיהיתי משתמש בהודעה שהגבת עליה. הגב על הודעת הפנייה של המשתמש.",
      { reply_to_message_id: msg.message_id } as any,
    ).catch(() => {});
    return;
  }
  try {
    await sendMessage(target, "📩 <b>הודעה מהאדמין</b>").catch(() => {});
    await copyMessage(target, msg.chat.id, msg.message_id);
    await sendMessage(msg.chat.id, "✅ נשלח למשתמש.", { reply_to_message_id: msg.message_id } as any).catch(() => {});
  } catch (e: any) {
    await sendMessage(
      msg.chat.id,
      `❌ לא הצלחתי לשלוח למשתמש: ${escapeHtml(e?.description || e?.message || "")}`,
      { reply_to_message_id: msg.message_id } as any,
    ).catch(() => {});
  }
}

/**
 * Sends the blocked notice with a "request paid release" button. The request
 * itself always goes to the main admin for approval before any payment.
 */
async function sendBlockedNotice(chatId: number, u: BotUserRow, replyTo?: number) {
  const price = unblockPriceFor(u);
  const permanent = !u.blocked_until;
  const extra: any = replyTo ? { reply_to_message_id: replyTo } : {};
  extra.reply_markup = {
    inline_keyboard: [
      [
        {
          text: permanent
            ? `🔓 בקש שחרור בתשלום · ${price} ⭐`
            : `🔓 שחרור מיידי בתשלום · ${price} ⭐`,
          callback_data: "unblk_req",
        },
      ],
    ],
  };
  await sendMessage(chatId, blockedNotice(u), extra).catch(() => {});
}

/**
 * Blocks a user who searched inappropriate content, escalating the duration on
 * each offence (5m → 15m → 30m → 1d → 2d → week → permanent).
 * Returns true when the search must not proceed.
 */
async function moderationGate(chatId: number, userId: number, query: string, replyTo?: number) {
  const words = await listBlockedWords().catch(() => [] as string[]);
  const hit = words.length ? matchesBlockedWords(query, words) : isInappropriateQuery(query);
  if (!hit) return false;
  logSearch(userId, query, true).catch(() => {});
  const r = await applyAutoBlock(userId, "חיפוש לא הולם").catch(() => null);
  const text = r
    ? "🚫 נחסמת עקב חיפוש לא הולם.\n" +
      (r.minutes
        ? `משך החסימה: ${formatDuration(r.minutes)}\nתשוחרר: ${formatWhen(r.until!)}`
        : "החסימה היא לצמיתות.")
    : "🚫 נחסמת עקב חיפוש לא הולם.";
  const extra: any = replyTo ? { reply_to_message_id: replyTo } : {};
  if (r) {
    const price = unblockPriceFor({ blocked_until: r.until, block_strikes: r.strike });
    const inPrivate = Number(chatId) === Number(userId);
    const label = r.minutes
      ? `🔓 שחרור מיידי בתשלום · ${price} ⭐`
      : `🔓 בקש שחרור בתשלום · ${price} ⭐`;
    extra.reply_markup = {
      inline_keyboard: [
        [
          inPrivate
            ? { text: label, callback_data: "unblk_req" }
            : { text: label, url: `https://t.me/${(await getMe()).username}?start=unblock` },
        ],
      ],
    };
  }
  await sendMessage(chatId, text, extra).catch(() => {});
  return true;
}

async function buildStatsView() {
  const [s, groupList] = await Promise.all([stats(), listGroupsDetailed()]);
  // Reachability-check each group so counts stay live: if the bot was removed
  // from a group, mark it inactive and drop it from the public count.
  const reach = await Promise.all(
    groupList.map(async (g) => {
      try { await getChatMemberCount(g.chat_id); return { ok: true, id: g.chat_id }; }
      catch { return { ok: false, id: g.chat_id }; }
    }),
  );
  const unreachable = reach.filter((r) => !r.ok);
  if (unreachable.length) {
    await Promise.all(unreachable.map((r) => markGroupInactive(r.id).catch(() => {})));
  }
  const activeGroups = reach.filter((r) => r.ok).length;
  const text =
    `📊 <b>סטטיסטיקת המאגר</b>\n\n` +
    `🎬 סרטים במאגר: <b>${s.movies.toLocaleString()}</b>\n` +
    `👤 משתמשים: <b>${s.users.toLocaleString()}</b>\n` +
    `👥 קבוצות: <b>${activeGroups.toLocaleString()}</b>`;
  const reply_markup = { inline_keyboard: [[{ text: "« חזרה", callback_data: "back_to_start" }]] };
  return { text, reply_markup };
}

async function sendStats(chatId: number, _userId?: number) {
  const v = await buildStatsView();
  await sendMessage(chatId, v.text, { reply_markup: v.reply_markup });
}

async function buildStartView(userId: number) {
  const settings = await getSettings();
  const me = await getMe();
  let text =
    `🎬 <b>בוט חיפוש סרטים</b>\n\n` +
    `🔍 כדי לחפש סרט — פשוט <b>שלח לי את שם הסרט</b> בהודעה כאן בצ׳אט.\n` +
    `לדוגמה: <code>הארי פוטר</code> או <code>Inception</code>\n\n` +
    `📥 אני אחזיר לך תוצאות מהמאגר. לחץ על השם של הסרט כדי לקבל אותו.\n` +
    `📚 אם יש הרבה תוצאות — אפשר לדפדף בעמודים בעזרת הכפתורים למטה.\n\n` +
    `💡 ניתן גם להוסיף אותי לקבוצות ולחפש שם.`;
  const kb = startMenuKeyboard(settings, me.username);
  if (settings.quota_enabled) {
    const q = await quotaInfo(userId, settings);
    text += q.premium
      ? `\n\n💎 <b>פרימיום פעיל</b> — חיפושים ללא הגבלה.`
      : `\n\n🎟️ נשארו לך היום <b>${Math.max(0, q.limit - q.used)}</b> מתוך <b>${q.limit}</b> חיפושים חינם.`;
    kb.inline_keyboard.unshift([{ text: "🎟️ החיפושים שלי", callback_data: "quota_menu" }]);
  }
  if (await isAdmin(userId)) {
    kb.inline_keyboard.unshift([{ text: "⚙️ לוח אדמין", callback_data: "admin_open" }]);
  }
  return { text, reply_markup: kb };
}

async function sendStartMenu(chatId: number, userId: number) {
  const v = await buildStartView(userId);
  await sendMessage(chatId, v.text, { reply_markup: v.reply_markup });
}

async function sendAdminPanel(chatId: number, userId?: number) {
  const s = await stats();
  const main = isMainAdmin(userId);
  const text =
    `⚙️ <b>לוח אדמין</b>${main ? "" : " (זמני)"}\n\n` +
    `🎬 סרטים במאגר: <b>${s.movies.toLocaleString()}</b>\n` +
    `👤 משתמשים: <b>${s.users.toLocaleString()}</b>\n` +
    `👥 קבוצות: <b>${s.groups.toLocaleString()}</b>\n` +
    `⭐ סה״כ כוכבים: <b>${s.totalStars.toLocaleString()}</b>`;
  await sendMessage(chatId, text, { reply_markup: adminPanelKeyboard(main) });
}

// ───── Search & pagination ─────
async function runSearchAndRespond(
  chatId: number,
  userId: number,
  query: string,
  page: number,
  editMessageId: number | null,
  inGroup: boolean,
  queryIdOverride?: string,
  latestScope?: string,
  dedupe: boolean = true,
) {
  // Stable qid per query — dedupe toggle & pagination reuse the same cache.
  const qid = queryIdOverride || shortId(`search-v6:${query}`);
  let cached = await getCachedSearchAll(qid).catch(() => null);
  if (!cached) {
    const allRows = await fetchAllSearchCandidates(query);
    cached = { query, rows: allRows };
    await Promise.all([
      cacheQuery(qid, query, allRows.length, dedupe).catch(() => {}),
      cacheSearchAll(qid, query, allRows).catch(() => {}),
    ]);
  }
  const sliced = paginateCandidates(cached.rows as any, page, PAGE_SIZE, dedupe);
  const rows = sliced.rows;
  const total = sliced.total;
  const hiddenDuplicates = sliced.hiddenDuplicates;
  if (total === 0) {
    const txt = `❌ לא נמצאו תוצאות עבור: <b>${escapeHtml(query)}</b>`;
    if (editMessageId) await editMessageText(chatId, editMessageId, txt).catch(() => {});
    else await sendMessage(chatId, txt);
    return;
  }
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  if (safePage !== page) {
    return await runSearchAndRespond(chatId, userId, query, safePage, editMessageId, inGroup, qid, latestScope, dedupe);
  }
  const dedupeLine = dedupe
    ? hiddenDuplicates > 0
      ? `\n🧹 סינון כפילויות פעיל · הוסתרו ${hiddenDuplicates.toLocaleString()} כפילויות`
      : `\n🧹 סינון כפילויות פעיל`
    : `\n⚠️ מציג את כל התוצאות כולל כפילויות`;
  const header = `🔎 תוצאות עבור: <b>${escapeHtml(query)}</b>\nנמצאו ${total.toLocaleString()} תוצאות${totalPages > 1 ? ` · עמוד ${page + 1}/${totalPages}` : ""}${dedupeLine}`;
  const botUsername = inGroup ? (await getMe()).username : "";
  const kb = resultsKeyboard(rows as any, page, totalPages, qid, botUsername, inGroup, {
    dedupe,
    hiddenDuplicates,
    query,
  });
  if (editMessageId) {
    const edited = await editMessageText(chatId, editMessageId, header, { reply_markup: kb })
      .then(() => true)
      .catch(() => false);
    if (edited) await setPageState(latestScope || `${chatId}:${editMessageId}`, qid, page).catch(() => {});
    else {
      const sent: any = await sendMessage(chatId, header, { reply_markup: kb });
      if (sent?.message_id) await setPageState(`${chatId}:${sent.message_id}`, qid, page).catch(() => {});
    }
  } else {
    const sent: any = await sendMessage(chatId, header, { reply_markup: kb });
    if (sent?.message_id) await setPageState(`${chatId}:${sent.message_id}`, qid, page).catch(() => {});
  }
}

async function safeRunSearchAndRespond(
  chatId: number,
  userId: number,
  query: string,
  page: number,
  editMessageId: number | null,
  inGroup: boolean,
  queryIdOverride?: string,
  latestScope?: string,
  dedupe: boolean = true,
) {
  try {
    await runSearchAndRespond(chatId, userId, query, page, editMessageId, inGroup, queryIdOverride, latestScope, dedupe);
  } catch (e: any) {
    console.error("search failed:", e?.message || e);
    // When triggered from a button (editMessageId set), DO NOT overwrite the
    // existing results with an error — that destroyed a working list. Just
    // send a lightweight notice as a new message and keep results intact.
    const text = "❌ הייתה תקלה זמנית. נסה שוב.";
    if (editMessageId) await sendMessage(chatId, text).catch(() => {});
    else await sendMessage(chatId, text).catch(() => {});
  }
}

async function serveMovie(chatId: number, userId: number, movieId: number) {
  const settings = await getSettings();
  const ok = await requireSubscriptionOrPrompt(chatId, userId, settings, `m_${movieId}`);
  if (!ok) return;
  const movie: any = await getMovieById(movieId);
  if (!movie) {
    await sendMessage(chatId, "❌ הסרט לא נמצא במאגר.");
    return;
  }
  try {
    // copyMessage strips the original sender attribution — clean delivery.
    await copyMessage(chatId, movie.source_channel_id, movie.message_id);
  } catch (e: any) {
    console.error("copyMessage failed:", e?.message);
    await sendMessage(chatId, "❌ לא הצלחתי לשלוח את הסרט. ייתכן שהוא הוסר מהערוץ המקור.");
  }
}

// ───── Callbacks ─────
async function handleCallback(cq: any) {
  const data: string = cq.data || "";
  const from = cq.from;
  const msg = cq.message;
  if (!msg) {
    await answerCallbackQuery(cq.id);
    return;
  }
  const chatId = msg.chat.id;

  if (data === "noop") return answerCallbackQuery(cq.id);

  if (data === "show_stats") {
    await answerCallbackQuery(cq.id);
    // Show an immediate loading state so a single click always reacts,
    // then replace it with the live numbers when the count query returns.
    await editMessageText(chatId, msg.message_id, "📊 בודק כמה סרטים יש במאגר...", {
      reply_markup: { inline_keyboard: [[{ text: "« חזרה", callback_data: "back_to_start" }]] },
    }).catch(() => {});
    const v = await buildStatsView();
    await editMessageText(chatId, msg.message_id, v.text, { reply_markup: v.reply_markup }).catch(() => {});
    return;
  }

  // Always ack pagination/get callbacks immediately so the spinner clears fast.
  if (data.startsWith("nav:") || data.startsWith("pg2:") || data.startsWith("pg_") || data.startsWith("get_")) {
    answerCallbackQuery(cq.id).catch(() => {});
  }

  if (data.startsWith("dup:")) {
    const [, qid, flag, pageText] = data.split(":");
    const cached = await getCachedSearch(qid);
    const recovered = cached?.query || queryFromMessageText(msg.text);
    if (!recovered) {
      answerCallbackQuery(cq.id, { text: "❌ פג תוקף החיפוש", show_alert: true }).catch(() => {});
      return;
    }
    answerCallbackQuery(cq.id).catch(() => {});
    const newDedupe = flag === "1";
    const inGroup = msg.chat.type !== "private";
    const currentPage = pageFromCallbackOrMessage(pageText, msg.text);
    await safeRunSearchAndRespond(chatId, from.id, recovered, currentPage, msg.message_id, inGroup, qid, `${chatId}:${msg.message_id}`, newDedupe);
    return;
  }

  if (data === "back_to_start") {
    await answerCallbackQuery(cq.id);
    const v = await buildStartView(from.id);
    await editMessageText(chatId, msg.message_id, v.text, { reply_markup: v.reply_markup }).catch(() => {});
    return;
  }

  if (data === "ads_menu") {
    await answerCallbackQuery(cq.id);
    await editMessageText(chatId, msg.message_id, "📢 טוען נתוני חשיפה...", {
      reply_markup: { inline_keyboard: [[{ text: "« חזרה", callback_data: "back_to_start" }]] },
    }).catch(() => {});
    const [users, groups] = await Promise.all([listUsers(), listGroupsDetailed()]);
    const groupCounts = await Promise.all(
      groups.map(async (g) => {
        try { return Number(await getChatMemberCount(g.chat_id)) || 0; } catch { return 0; }
      }),
    );
    const totalGroupMembers = groupCounts.reduce((a, b) => a + b, 0);
    const r = await uniqueReach(totalGroupMembers, users).catch(() => null);
    const totalPrivate = users.length;
    const overlap = r?.overlap ?? 0;
    const combined = Math.max(totalGroupMembers, totalGroupMembers + totalPrivate - overlap);
    const text =
      `📢 <b>פרסום ממומן</b>\n\n` +
      `👨‍👩‍👧 סה״כ משתמשים בקבוצות: <b>${totalGroupMembers.toLocaleString()}</b>\n` +
      `👤 סה״כ משתמשים בפרטי: <b>${totalPrivate.toLocaleString()}</b>\n` +
      `🌐 סה״כ חשיפה ייחודית (ללא כפילויות): <b>${combined.toLocaleString()}</b>\n` +
      (overlap ? `🔁 נוכו ${overlap.toLocaleString()} משתמשים שנמצאים גם בקבוצה וגם בפרטי\n` : "") +
      `\n` +
      `רוצה לפרסם? לחץ על הכפתור למטה.`;
    await editMessageText(chatId, msg.message_id, text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📝 אני רוצה לפרסם", callback_data: "ads_contact" }],
          [{ text: "« חזרה", callback_data: "back_to_start" }],
        ],
      },
    }).catch(() => {});
    return;
  }

  if (data === "ads_contact") {
    await answerCallbackQuery(cq.id);
    const text =
      `📝 <b>הזמנת פרסום ממומן</b>\n\n` +
      `לפרטים, מחירים ותיאום פרסום — פנה אל:\n` +
      `👤 @Ahdhfufhtj`;
    await editMessageText(chatId, msg.message_id, text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💬 פנייה למפרסם", url: "https://t.me/Ahdhfufhtj" }],
          [{ text: "« חזרה", callback_data: "ads_menu" }],
        ],
      },
    }).catch(() => {});
    return;
  }

  if (data === "support_menu") {
    await answerCallbackQuery(cq.id);
    await editMessageText(
      chatId,
      msg.message_id,
      `❤️ <b>תמיכה בבוט</b>\n\nתודה רבה על השיקול לתמוך! בחר את סכום הכוכבים:`,
      { reply_markup: supportMenuKeyboard() },
    ).catch(() => {});
    return;
  }

  if (data === "quota_menu") {
    await answerCallbackQuery(cq.id);
    await sendQuotaMenu(chatId, Number(from.id), msg.message_id);
    return;
  }

  if (data === "quota_link") {
    await answerCallbackQuery(cq.id);
    const me2 = await getMe();
    await sendMessage(chatId, `🔗 קישור ההזמנה שלך:\n<code>https://t.me/${me2.username}?start=r_${from.id}</code>`).catch(() => {});
    return;
  }

  if (data === "buy_single" || data === "buy_daily" || data === "buy_premium") {
    await answerCallbackQuery(cq.id);
    const s = await getSettings();
    const kind = data.slice(4);
    const map: Record<string, { amount: number; title: string; desc: string }> = {
      single: { amount: s.price_single_search, title: "חיפוש נוסף חד־פעמי", desc: "חיפוש אחד נוסף מעבר למכסה היומית." },
      daily: { amount: s.price_daily_extra, title: "+1 חיפוש בכל יום", desc: "תוספת קבועה של חיפוש אחד בכל יום, לתמיד." },
      premium: { amount: s.price_premium, title: "פרימיום — ללא הגבלה", desc: "חיפושים ללא הגבלה, ללא מכסה יומית." },
    };
    const item = map[kind];
    if (!item || !(item.amount > 0)) return;
    await sendInvoice({
      chat_id: chatId,
      title: item.title,
      description: item.desc,
      payload: `buy:${kind}:${from.id}:${Date.now()}`,
      currency: "XTR",
      prices: [{ label: `${item.amount} Stars`, amount: item.amount }],
    }).catch((e: any) => {
      console.error("sendInvoice failed:", e?.message);
      sendMessage(chatId, "❌ לא הצלחתי לפתוח חלון תשלום. נסה שוב מאוחר יותר.");
    });
    return;
  }

  if (data.startsWith("donate_")) {
    const amount = parseInt(data.slice("donate_".length), 10);
    if (!STAR_AMOUNTS.includes(amount)) return answerCallbackQuery(cq.id, { text: "סכום לא חוקי", show_alert: true });
    await answerCallbackQuery(cq.id);
    await sendInvoice({
      chat_id: chatId,
      title: `תמיכה בבוט · ${amount} כוכבים`,
      description: `תרומה של ${amount} כוכבי טלגרם לבוט. תודה רבה ❤️`,
      payload: `donate:${from.id}:${amount}:${Date.now()}`,
      currency: "XTR",
      prices: [{ label: `${amount} Stars`, amount }],
    }).catch((e: any) => {
      console.error("sendInvoice failed:", e?.message);
      sendMessage(chatId, "❌ לא הצלחתי לפתוח חלון תשלום. נסה שוב מאוחר יותר.");
    });
    return;
  }

  if (data.startsWith("get_")) {
    const movieId = Number(data.slice(4));
    await serveMovie(chatId, from.id, movieId);
    return;
  }

  if (data === "contact_admin") {
    await answerCallbackQuery(cq.id);
    const s = await getSettings();
    if (!s.support_group_id) {
      await sendMessage(chatId, "ℹ️ פניות לאדמין אינן פעילות כרגע.").catch(() => {});
      return;
    }
    await setAdminState(Number(from.id), "awaiting_support_msg").catch(() => {});
    await sendMessage(
      chatId,
      "✉️ שלח כאן את ההודעה שלך לאדמין (אפשר גם תמונה או קובץ).\nלביטול שלח /cancel",
    ).catch(() => {});
    return;
  }

  if (data === "unblk_req") {
    await answerCallbackQuery(cq.id);
    const u = await getBotUser(Number(from.id)).catch(() => null);
    if (!u?.is_blocked || (await releaseIfExpired(u).catch(() => false))) {
      await sendMessage(chatId, "✅ אינך חסום כרגע.").catch(() => {});
      return;
    }
    const open = await openUnblockRequestFor(Number(from.id)).catch(() => null);
    if (open?.status === "approved") {
      await sendMessage(chatId, `✅ הבקשה שלך אושרה. לתשלום ושחרור מיידי:`, {
        reply_markup: { inline_keyboard: [[{ text: `⭐ שלם ${open.stars} כוכבים`, callback_data: `unblk_pay_${open.id}` }]] },
      }).catch(() => {});
      return;
    }
    if (open?.status === "pending") {
      await sendMessage(chatId, "⏳ הבקשה שלך כבר ממתינה לאישור האדמין.").catch(() => {});
      return;
    }
    const price = unblockPriceFor(u);
    const isPermanent = !u.blocked_until;
    if (!isPermanent) {
      // Temporary blocks: the user pays directly, no admin approval needed.
      const reqTmp = await createUnblockRequest({
        telegram_id: Number(from.id),
        stars: price,
        permanent: false,
      }).catch(() => null);
      if (!reqTmp) {
        await sendMessage(chatId, "❌ לא הצלחתי לפתוח חלון תשלום. נסה שוב.").catch(() => {});
        return;
      }
      await setUnblockRequestStatus(reqTmp.id, "approved").catch(() => {});
      await sendInvoice({
        chat_id: chatId,
        title: "שחרור מחסימה",
        description: "תשלום חד־פעמי לשחרור מיידי מהחסימה בבוט.",
        payload: `unblock:${reqTmp.id}:${from.id}`,
        currency: "XTR",
        prices: [{ label: `${price} Stars`, amount: price }],
      }).catch(() => sendMessage(chatId, "❌ לא הצלחתי לפתוח חלון תשלום.").catch(() => {}));
      return;
    }
    const req = await createUnblockRequest({
      telegram_id: Number(from.id),
      stars: price,
      permanent: !u.blocked_until,
    }).catch(() => null);
    if (!req) {
      await sendMessage(chatId, "❌ לא הצלחתי לשלוח את הבקשה. נסה שוב.").catch(() => {});
      return;
    }
    await sendMessage(chatId, "📨 הבקשה נשלחה לאדמין הראשי. תקבל הודעה כשהיא תאושר.").catch(() => {});
    await sendMessage(
      ADMIN_ID,
      `🔓 <b>בקשת שחרור מחסימה</b>\n\n` +
        `👤 ${escapeHtml(displayUserName(u))}\n🆔 <code>${u.telegram_id}</code>\n` +
        `סוג חסימה: <b>${u.blocked_until ? formatWhen(u.blocked_until) : "לצמיתות"}</b>\n` +
        `מחיר שחרור: <b>${price} ⭐</b>`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ אישור", callback_data: `admin_unb_ok_${req.id}` },
              { text: "❌ דחייה", callback_data: `admin_unb_no_${req.id}` },
            ],
          ],
        },
      },
    ).catch(() => {});
    return;
  }

  if (data.startsWith("unblk_pay_")) {
    await answerCallbackQuery(cq.id);
    const reqId = Number(data.slice("unblk_pay_".length));
    const req = await getUnblockRequest(reqId).catch(() => null);
    if (!req || req.telegram_id !== Number(from.id) || req.status !== "approved") {
      await sendMessage(chatId, "❌ הבקשה אינה זמינה לתשלום.").catch(() => {});
      return;
    }
    await sendInvoice({
      chat_id: chatId,
      title: "שחרור מחסימה",
      description: "תשלום חד־פעמי לשחרור מיידי מהחסימה בבוט.",
      payload: `unblock:${req.id}:${from.id}`,
      currency: "XTR",
      prices: [{ label: `${req.stars} Stars`, amount: req.stars }],
    }).catch(() => sendMessage(chatId, "❌ לא הצלחתי לפתוח חלון תשלום.").catch(() => {}));
    return;
  }

  if (data.startsWith("check_")) {
    const payload = data.slice("check_".length);
    const settings = await getSettings();
    if (await isSubscribed(from.id, settings)) {
      await answerCallbackQuery(cq.id, { text: "✅ אומת! שולח..." });
      // delete the prompt
      await tg("deleteMessage", { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
      if (payload.startsWith("m_")) {
        const movieId = Number(payload.slice(2));
        await serveMovie(chatId, from.id, movieId);
      }
    } else {
      await answerCallbackQuery(cq.id, { text: "❌ עדיין לא הצטרפת לערוץ", show_alert: true });
    }
    return;
  }

  if (data.startsWith("nav:")) {
    const [, qid, pageText, dedupeText] = data.split(":");
    const page = Number(pageText);
    const cached = await getCachedSearch(qid);
    const recovered = cached?.query || queryFromMessageText(msg.text);
    if (!recovered || !Number.isInteger(page) || page < 0) {
      await answerCallbackQuery(cq.id, { text: "פג תוקף החיפוש — שלח שוב את השם", show_alert: true }).catch(() => {});
      return;
    }
    if (page === pageFromMessageText(msg.text)) return;
    const inGroup = msg.chat.type !== "private";
    await safeRunSearchAndRespond(chatId, from.id, recovered, page, msg.message_id, inGroup, qid, `${chatId}:${msg.message_id}`, dedupeFromCallbackOrMsg(dedupeText, msg, cached));
    return;
  }

  if (data.startsWith("pg2:")) {
    const [, qid, pageText] = data.split(":");
    const page = Number(pageText);
    const cached = await getCachedSearch(qid);
    const recovered = cached?.query || queryFromMessageText(msg.text);
    if (!recovered || !Number.isInteger(page) || page < 0) {
      await answerCallbackQuery(cq.id, { text: "פג תוקף החיפוש — שלח שוב את השם", show_alert: true }).catch(() => {});
      return;
    }
    if (page === pageFromMessageText(msg.text)) return;
    const inGroup = msg.chat.type !== "private";
    await safeRunSearchAndRespond(chatId, from.id, recovered, page, msg.message_id, inGroup, qid, `${chatId}:${msg.message_id}`, dedupeFromMsg(msg, cached));
    return;
  }

  if (data.startsWith("pg_")) {
    const rest = data.slice(3);
    const latestScope = `${chatId}:${msg.message_id}`;
    const idx = rest.lastIndexOf("_");
    const qid = rest.slice(0, idx);
    const action = rest.slice(idx + 1);
    const currentPage = pageFromMessageText(msg.text);
    const page = action === "n" ? currentPage + 1 : action === "p" ? currentPage - 1 : Number(action);
    const cached = await getCachedSearch(qid);
    const recovered = cached?.query || queryFromMessageText(msg.text);
    if (!recovered || !Number.isFinite(page) || page < 0) {
      await answerCallbackQuery(cq.id, { text: "פג תוקף החיפוש — שלח שוב את השם", show_alert: true }).catch(() => {});
      return;
    }
    const inGroup = msg.chat.type !== "private";
    await safeRunSearchAndRespond(chatId, from.id, recovered, page, msg.message_id, inGroup, qid, latestScope, dedupeFromMsg(msg, cached));
    return;
  }

  // Admin callbacks
  if (data.startsWith("admin_")) {
    if (!(await isAdmin(from.id))) return answerCallbackQuery(cq.id, { text: "❌ אין הרשאה", show_alert: true });
    return await handleAdminCallback(cq, data);
  }

  await answerCallbackQuery(cq.id);
}

// ───── Admin ─────
async function handleAdminCallback(cq: any, data: string) {
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;
  const userId = cq.from.id;
  const main = isMainAdmin(userId);
  await answerCallbackQuery(cq.id);

  // Main-admin-only actions
  if (
    !main &&
    (data === "admin_set_required" ||
      data === "admin_required" ||
      data.startsWith("admin_req_") ||
      data === "admin_manage" ||
      data === "admin_add" ||
      data === "admin_src_add" ||
      data === "admin_support_group" ||
      data === "admin_unbreq" ||
      data.startsWith("admin_unb_") ||
      data.startsWith("admin_bcok_") ||
      data.startsWith("admin_bcno_") ||
      data.startsWith("admin_src_rm_") ||
      data.startsWith("admin_rm_"))
  ) {
    return;
  }

  // Search quota / pricing management (main admin only)
  if (data === "admin_quota" || data.startsWith("admin_q_")) {
    const s = await getSettings();
    if (data === "admin_quota") {
      return await renderQuotaAdmin(chatId, messageId, s);
    }
    if (data === "admin_q_toggle") {
      await updateSettings({ quota_enabled: !s.quota_enabled } as any);
      return await renderQuotaAdmin(chatId, messageId, await getSettings());
    }
    if (data === "admin_q_reset") {
      await resetDailyQuotaForAll().catch(() => {});
      await sendMessage(
        chatId,
        "♻️ המכסה היומית אופסה לכל המשתמשים.\nהפרימיום והחיפושים הנוספים שנרכשו נשמרו כרגיל.",
      ).catch(() => {});
      return await renderQuotaAdmin(chatId, messageId, await getSettings());
    }
    const prompts: Record<string, string> = {
      admin_q_free: "🔢 שלח את מספר החיפושים החינמיים ליום (0 = ללא חינם):",
      admin_q_p_single: "⚡ שלח את המחיר בכוכבים לחיפוש נוסף חד־פעמי:",
      admin_q_p_daily: "📅 שלח את המחיר בכוכבים לתוספת קבועה של חיפוש בכל יום:",
      admin_q_p_premium: "💎 שלח את המחיר בכוכבים לפרימיום (ללא הגבלה):",
    };
    if (prompts[data]) {
      await setAdminState(Number(userId), data);
      return await sendMessage(chatId, `${prompts[data]}\n\nלביטול שלח /cancel`).then(() => {}).catch(() => {});
    }
    return;
  }

  switch (data) {
    case "admin_open":
      return await editMessageText(chatId, messageId, `⚙️ <b>לוח אדמין</b>${main ? "" : " (זמני)"}`, {
        reply_markup: adminPanelKeyboard(main),
      }).catch(() => {});
    case "admin_close":
      return await tg("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => {});
    case "admin_stats": {
      // Show a loading state first — fetching per-group member counts can take a moment.
      await editMessageText(chatId, messageId, "📊 טוען סטטיסטיקות מפורטות...", {
        reply_markup: { inline_keyboard: [[{ text: "« חזרה", callback_data: "admin_open" }]] },
      }).catch(() => {});
      const [s, groupList] = await Promise.all([stats(), listGroupsDetailed()]);
      // Fetch member counts in parallel, tolerate individual failures.
      const counts = await Promise.all(
        groupList.map(async (g) => {
          try {
            const n = await getChatMemberCount(g.chat_id);
            return { ...g, count: Number(n) || 0, ok: true };
          } catch {
            return { ...g, count: 0, ok: false };
          }
        }),
      );
      // Bot was removed from unreachable groups → auto-mark inactive so they
      // disappear from stats on the next call.
      const unreachable = counts.filter((g) => !g.ok);
      if (unreachable.length) {
        await Promise.all(unreachable.map((g) => markGroupInactive(g.chat_id).catch(() => {})));
      }
      const active = counts.filter((g) => g.ok).sort((a, b) => b.count - a.count);
      const totalGroupMembers = active.reduce((sum, g) => sum + g.count, 0);
      const activeGroupsCount = active.length;
      const combinedReach = totalGroupMembers + s.users;
      const shown = active.slice(0, 60);
      const groupLines = shown.length
        ? shown
            .map((g, i) => {
              const name = escapeHtml(g.title || String(g.chat_id));
              return `${i + 1}. <b>${name}</b> — ${g.count.toLocaleString()} משתמשים`;
            })
            .join("\n")
        : "<i>אין קבוצות פעילות.</i>";
      const moreNote = active.length > 60 ? `\n<i>...ועוד ${active.length - 60} קבוצות</i>` : "";
      const text =
        `📊 <b>סטטיסטיקות מפורטות</b>\n\n` +
        `🎬 סרטים: <b>${s.movies.toLocaleString()}</b>\n` +
        `👤 משתמשים בפרטי: <b>${s.users.toLocaleString()}</b>\n` +
        `👥 קבוצות פעילות: <b>${activeGroupsCount.toLocaleString()}</b>\n` +
        `👨‍👩‍👧 סה״כ משתמשים בקבוצות: <b>${totalGroupMembers.toLocaleString()}</b>\n` +
        `🌐 סה״כ קהל (פרטי + קבוצות): <b>${combinedReach.toLocaleString()}</b>\n` +
        `⭐ סה״כ כוכבים שתרמו: <b>${s.totalStars.toLocaleString()}</b>\n\n` +
        `<b>רשימת קבוצות (לחץ לקבלת קישור הזמנה):</b>\n${groupLines}${moreNote}`;
      // Telegram message hard limit is 4096 chars; trim from the middle if needed.
      const safe = text.length > 3900 ? text.slice(0, 3900) + "\n<i>...נחתך</i>" : text;
      const groupButtons = shown.map((g) => [{
        text: `📨 ${truncateBtn(g.title || String(g.chat_id), 45)}`,
        callback_data: `admin_grp_${g.chat_id}`,
      }]);
      return await editMessageText(chatId, messageId, safe, {
        reply_markup: { inline_keyboard: [...groupButtons, [{ text: "« חזרה", callback_data: "admin_open" }]] },
      }).catch(() => {});
    }
    case "admin_sources": {
      const list = await listSourceChannels();
      const lines = list.length
        ? list.map((c) => `• <b>${escapeHtml(c.title || c.username || String(c.chat_id))}</b> — <code>${c.chat_id}</code>`).join("\n")
        : "<i>אין ערוצי סרטים מוגדרים.</i>";
      return await editMessageText(
        chatId,
        messageId,
        `🎬 <b>ערוצי סרטים</b>\n\n${lines}\n\nלחיצה על ❌ תסיר ערוץ. כל הסרטים שכבר נאספו נשמרים במאגר.`,
        { reply_markup: sourceChannelsKeyboard(list, main) },
      ).catch(() => {});
    }
    case "admin_src_add":
      await setAdminState(userId, "awaiting_source_channel_add");
      return await sendMessage(
        chatId,
        "📥 שלח לי את <b>שם המשתמש</b> או <b>ה-ID</b> של ערוץ סרטים <b>נוסף</b>.\n\n" +
          "דוגמה: <code>@my_movies</code> או <code>-1001234567890</code>.\n" +
          "הוסף את הבוט לערוץ <b>כאדמין</b> תחילה.\n\n" +
          "שלח /cancel לביטול.",
      );
    case "admin_set_required":
      await setAdminState(userId, "awaiting_required_channel");
      return await sendMessage(
        chatId,
        "🔒 שלח לי את <b>שם המשתמש</b> או <b>ה-ID</b> של ערוץ החובה.\n\n" +
          "דוגמה: <code>@my_channel</code>.\n" +
          "ודא שהבוט הוסף לערוץ <b>כאדמין</b>.\n\n" +
          "שלח /cancel לביטול.",
      );
    case "admin_required":
      return await renderRequiredChannels(chatId, messageId);
    case "admin_req_add_perm":
      await setAdminState(userId, "awaiting_required_add", { kind: "permanent" });
      return await sendMessage(
        chatId,
        "📌 שלח את <b>שם המשתמש</b> או <b>ה-ID</b> של ערוץ חובה <b>קבוע</b>.\n" +
          "דוגמה: <code>@my_channel</code>\nהבוט חייב להיות אדמין בערוץ.\n\nשלח /cancel לביטול.",
      );
    case "admin_req_add_temp":
      await setAdminState(userId, "awaiting_required_add", { kind: "temporary" });
      return await sendMessage(
        chatId,
        "⏳ שלח ערוץ חובה <b>זמני</b> ומספר ימים, בפורמט:\n\n" +
          "<code>@my_channel 7</code> — חובה למשך 7 ימים\n\nהבוט חייב להיות אדמין בערוץ.\n\nשלח /cancel לביטול.",
      );
    case "admin_set_search_group":
      await setAdminState(userId, "awaiting_search_group");
      return await sendMessage(
        chatId,
        "🔎 שלח לי את <b>הקישור לקבוצת החיפוש</b> (למשל <code>https://t.me/mygroup</code> או <code>@mygroup</code>).\n\n" +
          "אפשר גם לשלוח בשורה שנייה שם תצוגה מותאם (למשל <code>קבוצת החיפוש שלנו</code>).\n" +
          "כדי להסיר את הכפתור — שלח <code>מחק</code>.\n\n" +
          "שלח /cancel לביטול.",
      );
    case "admin_support_group":
      await setAdminState(userId, "awaiting_support_group");
      return await sendMessage(
        chatId,
        "📮 שלח את <b>ה-ID</b> או <b>שם המשתמש</b> של קבוצת הפניות (למשל <code>-1001234567890</code> או <code>@mygroup</code>).\n\n" +
          "הוסף אותי לקבוצה תחילה. כל פנייה של משתמש תגיע לשם, ותשובה נשלחת בתגובה להודעת המשתמש.\n" +
          "כדי לבטל את הכפתור — שלח <code>מחק</code>.\n\n" +
          "שלח /cancel לביטול.",
      );
    case "admin_bc_private":
      await setAdminState(userId, "awaiting_broadcast", { target: "private" });
      return await sendMessage(chatId, "✏️ שלח את ההודעה לשידור <b>לכל המשתמשים בפרטי</b>.\nשלח /cancel לביטול.");
    case "admin_bc_groups":
      await setAdminState(userId, "awaiting_broadcast", { target: "groups" });
      return await sendMessage(chatId, "✏️ שלח את ההודעה לשידור <b>לכל הקבוצות</b> (תוצמד אוטומטית).\nשלח /cancel לביטול.");
    case "admin_bc_all":
      await setAdminState(userId, "awaiting_broadcast", { target: "all" });
      return await sendMessage(chatId, "✏️ שלח את ההודעה לשידור <b>לכולם</b> (בקבוצות תוצמד אוטומטית).\nשלח /cancel לביטול.");
    case "admin_manage": {
      const admins = await listAdmins();
      const lines = admins.length
        ? admins
            .map((a: any) => {
              const exp = a.expires_at
                ? `עד ${new Date(a.expires_at).toLocaleString("he-IL")}`
                : "קבוע";
              return `• <code>${a.telegram_id}</code> — ${exp}`;
            })
            .join("\n")
        : "<i>אין אדמינים זמניים כרגע.</i>";
      return await editMessageText(
        chatId,
        messageId,
        `👥 <b>ניהול אדמינים</b>\n\n${lines}\n\nלחיצה על כפתור עם ❌ תסיר את האדמין.`,
        { reply_markup: adminsListKeyboard(admins as any) },
      ).catch(() => {});
    }
    case "admin_add":
      await setAdminState(userId, "awaiting_admin_add");
      return await sendMessage(
        chatId,
        "➕ שלח את <b>ה-ID של המשתמש</b> ואת מספר הימים, בפורמט:\n\n" +
          "<code>123456789 7</code> — אדמין למשך 7 ימים\n" +
          "<code>123456789 0</code> — אדמין קבוע\n\n" +
          "שלח /cancel לביטול.",
      );
  }
  if (data === "admin_users") {
    return await renderUsersList(chatId, messageId, { query: "", page: 0, sort: "recent", blockedOnly: false });
  }

  // ── Broadcast approval (main admin reviews sub-admin requests) ──
  if (data.startsWith("admin_bcok_") || data.startsWith("admin_bcno_")) {
    const approve = data.startsWith("admin_bcok_");
    const reqId = Number(data.slice("admin_bcok_".length));
    const req = await getBroadcastRequest(reqId).catch(() => null);
    if (!req || req.status !== "pending") {
      return await sendMessage(chatId, "ℹ️ הבקשה כבר טופלה.").then(() => {}).catch(() => {});
    }
    await setBroadcastRequestStatus(reqId, approve ? "approved" : "rejected", userId).catch(() => {});
    await editMessageText(
      chatId,
      messageId,
      `${cq.message.text || ""}\n\n${approve ? "✅ אושר" : "❌ נדחה"}`,
    ).catch(() => {});
    if (!approve) {
      await sendMessage(req.requester_chat_id, "❌ בקשת השידור שלך נדחתה על ידי האדמין הראשי.").catch(() => {});
      return;
    }
    const total = await countBroadcastRecipients(req.target).catch(() => 0);
    const startText = `🚀 <b>מתחיל שידור...</b>\nיעד: ${req.target}\nסה״כ נמענים: <b>${total.toLocaleString()}</b>`;
    const status: any = await sendMessage(chatId, startText).catch(() => null);
    const notify: any = await sendMessage(
      req.requester_chat_id,
      `✅ השידור שלך אושר.\n\n${startText}`,
    ).catch(() => null);
    try {
      const job = await createBroadcastJob({
        admin_user_id: req.requester_id,
        admin_chat_id: chatId,
        status_msg_id: status?.message_id ?? null,
        notify_chat_id: Number(req.requester_chat_id),
        notify_msg_id: notify?.message_id ?? null,
        target: req.target,
        from_chat_id: Number(req.from_chat_id),
        message_id: Number(req.message_id),
        total,
      });
      await processBroadcastTick(15_000, job.id);
    } catch (e: any) {
      await sendMessage(chatId, `❌ שגיאה בשידור: ${escapeHtml(e?.message || String(e))}`).catch(() => {});
    }
    return;
  }

  // ── Paid unblock requests ──
  if (data === "admin_unbreq") {
    return await renderUnblockRequests(chatId, messageId);
  }
  if (data.startsWith("admin_unb_ok_") || data.startsWith("admin_unb_no_")) {
    const approve = data.startsWith("admin_unb_ok_");
    const reqId = Number(data.slice("admin_unb_ok_".length));
    const req = await getUnblockRequest(reqId).catch(() => null);
    if (!req || (req.status !== "pending" && req.status !== "approved")) {
      return await sendMessage(chatId, "ℹ️ הבקשה כבר טופלה.").then(() => {}).catch(() => {});
    }
    await setUnblockRequestStatus(reqId, approve ? "approved" : "rejected", userId).catch(() => {});
    // Remove the decision message so the admin can't approve twice.
    if (messageId) {
      await tg("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => {});
    }
    if (approve) {
      await sendMessage(
        req.telegram_id,
        `✅ בקשת השחרור שלך אושרה.\nלשחרור מיידי — שלם <b>${req.stars} ⭐</b>:`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: `⭐ שלם ${req.stars} כוכבים`, callback_data: `unblk_pay_${req.id}` }]],
          },
        },
      ).catch(() => {});
      await sendMessage(chatId, `✅ אושר. נשלח למשתמש <code>${req.telegram_id}</code> קישור לתשלום ${req.stars} ⭐.`).catch(() => {});
    } else {
      await sendMessage(req.telegram_id, "❌ בקשת השחרור שלך נדחתה.").catch(() => {});
      await sendMessage(chatId, `❌ הבקשה של <code>${req.telegram_id}</code> נדחתה.`).catch(() => {});
    }
    return;
  }
  if (data === "admin_words") {
    return await renderBlockedWords(chatId, messageId);
  }
  if (data === "admin_word_add") {
    await setAdminState(userId, "awaiting_blocked_word");
    return await sendMessage(
      chatId,
      "➕ שלח את המילה/מילים להוספה לרשימת המילים החסומות (אפשר כמה, מופרדות בפסיק).\nשלח /cancel לביטול.",
    ).then(() => {}).catch(() => {});
  }
  if (data.startsWith("admin_word_rm:")) {
    const enc = data.slice("admin_word_rm:".length);
    let word = "";
    try { word = Buffer.from(enc, "base64url").toString("utf8"); } catch { word = ""; }
    if (word) await removeBlockedWord(word).catch(() => {});
    return await renderBlockedWords(chatId, messageId);
  }
  if (data === "admin_load") {
    return await renderServerLoad(chatId, messageId);
  }
  if (data.startsWith("admin_prem:")) {
    const [, sort, pageText] = data.split(":");
    return await renderPremiumList(chatId, messageId, {
      page: Math.max(0, Number(pageText) || 0),
      sort: sort === "joined" ? "joined" : "recent",
    });
  }
  if (data === "admin_prem_search") {
    await setAdminState(userId, "awaiting_prem_search");
    return await sendMessage(
      chatId,
      "🔎 שלח שם משתמש (עם או בלי @), שם, או ID לחיפוש לניהול פרימיום.\nשלח /cancel לביטול.",
    ).then(() => {}).catch(() => {});
  }
  if (data.startsWith("admin_premu_")) {
    const tid = Number(data.slice("admin_premu_".length));
    if (Number.isFinite(tid)) return await renderPremiumUser(chatId, messageId, tid);
  }
  if (data.startsWith("admin_premtg_")) {
    const [idText, onText] = data.slice("admin_premtg_".length).split("_");
    const tid = Number(idText);
    const on = onText === "1";
    if (Number.isFinite(tid)) {
      await setPremium(tid, on).catch(() => {});
      await sendMessage(tid, on ? "💎 קיבלת פרימיום — חיפושים ללא הגבלה!" : "ℹ️ הפרימיום שלך הוסר.").catch(() => {});
      return await renderPremiumUser(chatId, messageId, tid);
    }
  }
  if (data.startsWith("admin_ul:")) {
    const [, sort, pageText, blockedText] = data.split(":");
    return await renderUsersList(chatId, messageId, {
      query: "",
      page: Math.max(0, Number(pageText) || 0),
      sort: sort === "joined" ? "joined" : "recent",
      blockedOnly: blockedText === "1",
    });
  }
  if (data.startsWith("admin_req_rm_")) {
    const cid = Number(data.slice("admin_req_rm_".length));
    if (Number.isFinite(cid)) {
      await removeRequiredChannel(cid).catch(() => {});
      const settings = await getSettings();
      if (Number(settings.required_channel_id || 0) === cid) {
        await updateSettings({
          required_channel_id: null,
          required_channel_username: null,
          required_channel_title: null,
          required_channel_invite_link: null,
        }).catch(() => {});
      }
    }
    return await renderRequiredChannels(chatId, messageId);
  }
  if (data === "admin_users_search") {
    await setAdminState(userId, "awaiting_user_search");
    return await sendMessage(
      chatId,
      "🔎 שלח שם משתמש (עם או בלי @), שם פרטי/משפחה, או ID לחיפוש.\nשלח /cancel לביטול.",
    );
  }
  if (data.startsWith("admin_user_")) {
    const tid = Number(data.slice("admin_user_".length));
    if (Number.isFinite(tid)) return await renderUserView(chatId, messageId, tid);
  }
  if (data.startsWith("admin_uhist_")) {
    const tid = Number(data.slice("admin_uhist_".length));
    if (Number.isFinite(tid)) return await renderSearchHistory(chatId, messageId, tid);
  }
  if (data.startsWith("admin_ublk_")) {
    const tid = Number(data.slice("admin_ublk_".length));
    if (Number.isFinite(tid)) {
      await markUserBlocked(tid).catch(() => {});
      return await renderUserView(chatId, messageId, tid);
    }
  }
  if (data.startsWith("admin_uunblk_")) {
    const tid = Number(data.slice("admin_uunblk_".length));
    if (Number.isFinite(tid)) {
      await unmarkUserBlocked(tid).catch(() => {});
      return await renderUserView(chatId, messageId, tid);
    }
  }
  if (data === "admin_unblock_all") {
    const n = await unblockAllUsers().catch(() => 0);
    await renderUsersList(chatId, messageId, { query: "", page: 0, sort: "recent", blockedOnly: true });
    return await sendMessage(chatId, `✅ שוחררו <b>${n}</b> משתמשים חסומים.`);
  }
  if (data.startsWith("admin_grp_")) {
    const cid = Number(data.slice("admin_grp_".length));
    if (!Number.isFinite(cid)) return;
    try {
      let link: string | null = null;
      try {
        const inv: any = await tg("createChatInviteLink", { chat_id: cid, creates_join_request: false });
        link = inv?.invite_link || null;
      } catch {
        try {
          link = (await tg<string>("exportChatInviteLink", { chat_id: cid })) as any;
        } catch {}
      }
      const info: any = await getChat(cid).catch(() => null);
      const title = escapeHtml(info?.title || String(cid));
      if (link) {
        await sendMessage(
          chatId,
          `🔗 <b>${title}</b>\nקישור הזמנה: ${link}`,
          { reply_markup: { inline_keyboard: [[{ text: "➡️ פתח את הקבוצה", url: link }]] } },
        );
      } else {
        await sendMessage(chatId, `❌ לא הצלחתי ליצור קישור עבור <b>${title}</b>. ודא שהבוט אדמין עם הרשאת הזמנת משתמשים.`);
      }
    } catch (e: any) {
      await sendMessage(chatId, `❌ שגיאה: ${escapeHtml(e?.description || e?.message || "")}`);
    }
    return;
  }

  if (data.startsWith("admin_src_rm_")) {
    const cid = Number(data.slice("admin_src_rm_".length));
    await removeSourceChannel(cid);
    const list = await listSourceChannels();
    const lines = list.length
      ? list.map((c) => `• <b>${escapeHtml(c.title || c.username || String(c.chat_id))}</b> — <code>${c.chat_id}</code>`).join("\n")
      : "<i>אין ערוצי סרטים מוגדרים.</i>";
    return await editMessageText(
      chatId,
      messageId,
      `🎬 <b>ערוצי סרטים</b>\n\n${lines}\n\n✅ הוסר: <code>${cid}</code>`,
      { reply_markup: sourceChannelsKeyboard(list) },
    ).catch(() => {});
  }
  if (data.startsWith("admin_rm_")) {
    const tid = Number(data.slice("admin_rm_".length));
    await removeAdmin(tid);
    const admins = await listAdmins();
    const lines = admins.length
      ? admins
          .map((a: any) => {
            const exp = a.expires_at ? `עד ${new Date(a.expires_at).toLocaleString("he-IL")}` : "קבוע";
            return `• <code>${a.telegram_id}</code> — ${exp}`;
          })
          .join("\n")
      : "<i>אין אדמינים זמניים כרגע.</i>";
    return await editMessageText(
      chatId,
      messageId,
      `👥 <b>ניהול אדמינים</b>\n\n${lines}\n\n✅ הוסר: <code>${tid}</code>`,
      { reply_markup: adminsListKeyboard(admins as any) },
    ).catch(() => {});
  }
}

async function handleAdminStateInput(chatId: number, userId: number, st: { state: string; data: any }, msg: any) {
  const text: string = (msg.text || "").trim();
  if (text === "/cancel") {
    await setAdminState(userId, null);
    await sendMessage(chatId, "❎ בוטל.");
    return;
  }

  // Search quota / pricing inputs
  if (st.state.startsWith("admin_q_")) {
    const n = parseInt(text.replace(/[^\d-]/g, ""), 10);
    if (!Number.isFinite(n)) {
      await sendMessage(chatId, "❌ שלח מספר בלבד. לביטול /cancel");
      return;
    }
    await setAdminState(userId, null);
    {
      const field =
        st.state === "admin_q_free"
          ? "free_searches_per_day"
          : st.state === "admin_q_p_single"
            ? "price_single_search"
            : st.state === "admin_q_p_daily"
              ? "price_daily_extra"
              : "price_premium";
      await updateSettings({ [field]: Math.max(0, n) } as any);
      await sendMessage(chatId, "✅ עודכן.");
    }
    const s = await getSettings();
    await sendMessage(chatId, quotaAdminText(s), { reply_markup: quotaAdminKeyboard(s) }).catch(() => {});
    return;
  }

  if (
    st.state === "awaiting_source_channel" ||
    st.state === "awaiting_source_channel_add" ||
    st.state === "awaiting_required_channel"
  ) {
    // Source/required channel configuration is main-admin only.
    if (!isMainAdmin(userId)) {
      await setAdminState(userId, null).catch(() => {});
      return;
    }
    const target =
      st.state === "awaiting_required_channel" ? "required" : "source";
    const chatRef = text.startsWith("@") || text.startsWith("-") || /^\d+$/.test(text) ? text : `@${text}`;
    try {
      const ch: any = await getChat(chatRef);
      // verify bot is admin
      const me = await getMe();
      const mem: any = await getChatMember(ch.id, me.id).catch(() => null);
      if (!mem || !["administrator", "creator"].includes(mem.status)) {
        await sendMessage(chatId, "❌ הבוט לא אדמין בערוץ הזה. הוסף אותו כאדמין ונסה שוב.");
        return;
      }
      let invite = ch.invite_link as string | null;
      if (!invite && !ch.username) {
        try {
          const link: any = await tg("createChatInviteLink", { chat_id: ch.id });
          invite = link.invite_link;
        } catch {}
      }
      if (target === "source") {
        // Add to the multi-channel list (does NOT clear existing channels).
        await addSourceChannel({
          chat_id: Number(ch.id),
          username: ch.username || null,
          title: ch.title || null,
          added_by: userId,
        });
        await sendMessage(
          chatId,
          `✅ ערוץ סרטים נוסף: <b>${escapeHtml(ch.title || ch.username || String(ch.id))}</b>\n\n` +
            `מעכשיו, כל סרט חדש שיתפרסם בערוץ יתווסף אוטומטית למאגר.\n\n` +
            `ℹ️ לאינדוקס הסרטים הקיימים בערוץ, השתמש בסקריפט Telethon.`,
        );
      } else {
        await updateSettings({
          required_channel_id: Number(ch.id),
          required_channel_username: ch.username || null,
          required_channel_title: ch.title || null,
          required_channel_invite_link: invite || (ch.username ? `https://t.me/${ch.username}` : null),
        });
        await sendMessage(chatId, `✅ ערוץ חובה נקבע: <b>${escapeHtml(ch.title || ch.username || String(ch.id))}</b>`);
      }
      await setAdminState(userId, null);
    } catch (e: any) {
      await sendMessage(chatId, `❌ לא הצלחתי לאמת את הערוץ.\n${escapeHtml(e?.description || e?.message || "")}`);
    }
    return;
  }

  if (st.state === "awaiting_required_add") {
    const kind: "permanent" | "temporary" = st.data?.kind === "temporary" ? "temporary" : "permanent";
    const parts = text.split(/\s+/);
    const ref = parts[0] || "";
    const days = Number(parts[1] ?? "0");
    if (kind === "temporary" && (!Number.isFinite(days) || days <= 0)) {
      await sendMessage(chatId, "❌ חסר מספר ימים. דוגמה: <code>@my_channel 7</code>. או /cancel לביטול.");
      return;
    }
    const existing = await listRequiredChannels();
    const count = existing.filter((c) => (c.kind === "temporary") === (kind === "temporary")).length;
    const max = kind === "temporary" ? MAX_TEMPORARY_REQUIRED : MAX_PERMANENT_REQUIRED;
    if (count >= max) {
      await setAdminState(userId, null);
      await sendMessage(chatId, `❌ הגעת למקסימום (${max}) ערוצי חובה מסוג זה. הסר ערוץ קיים תחילה.`);
      return;
    }
    const chatRef = ref.startsWith("@") || ref.startsWith("-") || /^\d+$/.test(ref) ? ref : `@${ref}`;
    try {
      const ch: any = await getChat(chatRef);
      const me = await getMe();
      const mem: any = await getChatMember(ch.id, me.id).catch(() => null);
      if (!mem || !["administrator", "creator"].includes(mem.status)) {
        await sendMessage(chatId, "❌ הבוט לא אדמין בערוץ הזה. הוסף אותו כאדמין ונסה שוב.");
        return;
      }
      let invite = ch.invite_link as string | null;
      if (!invite && !ch.username) {
        try {
          const link: any = await tg("createChatInviteLink", { chat_id: ch.id });
          invite = link.invite_link;
        } catch {}
      }
      const expires_at = kind === "temporary" ? new Date(Date.now() + days * 86400_000).toISOString() : null;
      await addRequiredChannel({
        chat_id: Number(ch.id),
        username: ch.username || null,
        title: ch.title || null,
        invite_link: invite || (ch.username ? `https://t.me/${ch.username}` : null),
        kind,
        expires_at,
        added_by: userId,
      });
      await setAdminState(userId, null);
      await sendMessage(
        chatId,
        `✅ ערוץ חובה ${kind === "temporary" ? `<b>זמני</b> (${days} ימים)` : "<b>קבוע</b>"} נוסף: ` +
          `<b>${escapeHtml(ch.title || ch.username || String(ch.id))}</b>`,
      );
    } catch (e: any) {
      await sendMessage(chatId, `❌ לא הצלחתי לאמת את הערוץ.\n${escapeHtml(e?.description || e?.message || "")}`);
    }
    return;
  }

  if (st.state === "awaiting_search_group") {
    await setAdminState(userId, null);
    if (/^מחק$/i.test(text) || /^remove$/i.test(text) || /^clear$/i.test(text)) {
      await updateSettings({ search_group_url: null, search_group_title: null });
      await sendMessage(chatId, "✅ כפתור קבוצת החיפוש הוסר.");
      return;
    }
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const raw = lines[0] || "";
    const customTitle = lines.slice(1).join(" ").trim() || null;
    let url = raw;
    if (raw.startsWith("@")) url = `https://t.me/${raw.slice(1)}`;
    else if (/^[A-Za-z0-9_]{5,}$/.test(raw)) url = `https://t.me/${raw}`;
    if (!/^https?:\/\//i.test(url)) {
      await sendMessage(chatId, "❌ קישור לא חוקי. שלח קישור מלא (https://t.me/...) או @username. שלח /cancel לביטול.");
      await setAdminState(userId, "awaiting_search_group");
      return;
    }
    await updateSettings({ search_group_url: url, search_group_title: customTitle });
    await sendMessage(
      chatId,
      `✅ נקבעה קבוצת חיפוש: <b>${escapeHtml(customTitle || url)}</b>\n\nעכשיו יופיע כפתור בתפריט הראשי לכל המשתמשים.`,
    );
    return;
  }

  if (st.state === "awaiting_support_group") {
    if (!isMainAdmin(userId)) {
      await setAdminState(userId, null).catch(() => {});
      return;
    }
    await setAdminState(userId, null);
    if (/^(מחק|remove|clear)$/i.test(text)) {
      await updateSettings({ support_group_id: null, support_group_title: null } as any);
      await sendMessage(chatId, "✅ קבוצת הפניות בוטלה. כפתור «פנייה לאדמין» הוסר מהתפריט.");
      return;
    }
    const ref = text.startsWith("@") || text.startsWith("-") || /^\d+$/.test(text) ? text : `@${text}`;
    try {
      const ch: any = await getChat(ref);
      if (!["group", "supergroup"].includes(ch.type)) {
        await sendMessage(chatId, "❌ זו לא קבוצה. שלח מזהה של קבוצה שאני חבר בה.");
        return;
      }
      await updateSettings({ support_group_id: Number(ch.id), support_group_title: ch.title || null } as any);
      await sendMessage(
        chatId,
        `✅ קבוצת הפניות נקבעה: <b>${escapeHtml(ch.title || String(ch.id))}</b>\n\n` +
          `מעכשיו כפתור «✉️ פנייה לאדמין» מופיע בתפריט, וכל פנייה תגיע לשם. כדי להשיב — הגב על הודעת המשתמש.`,
      );
    } catch (e: any) {
      await sendMessage(chatId, `❌ לא הצלחתי לאמת את הקבוצה.\n${escapeHtml(e?.description || e?.message || "")}`);
    }
    return;
  }

  if (st.state === "awaiting_blocked_word") {
    await setAdminState(userId, null);
    const parts = text.split(/[,\n]/).map((w) => w.trim().toLowerCase()).filter(Boolean);
    for (const w of parts) await addBlockedWord(w, userId).catch(() => {});
    await sendMessage(chatId, parts.length ? `✅ נוספו ${parts.length} מילים לרשימה החסומה.` : "❌ לא נשלחה מילה.").catch(() => {});
    const words = await listBlockedWords(true).catch(() => [] as string[]);
    await sendMessage(chatId, `🚫 <b>מילים חסומות</b>\nסה״כ: <b>${words.length}</b>`, {
      reply_markup: blockedWordsKeyboard(words.slice(0, 60)),
    }).catch(() => {});
    return;
  }
  if (st.state === "awaiting_prem_search") {
    await setAdminState(userId, null);
    const results = await searchBotUsers(text, 20);
    const kb: any[][] = await premiumUserRows(results);
    kb.push([{ text: "🔎 חיפוש נוסף", callback_data: "admin_prem_search" }]);
    kb.push([{ text: "« חזרה", callback_data: "admin_prem:recent:0" }]);
    await sendMessage(
      chatId,
      `💎 <b>ניהול פרימיום — תוצאות חיפוש</b>\n"<code>${escapeHtml(text)}</code>" · ${results.length} תוצאות\n\n` +
        (results.length ? "לחץ על משתמש כדי להעניק או להסיר פרימיום." : "<i>לא נמצאו משתמשים.</i>"),
      { reply_markup: { inline_keyboard: kb } },
    );
    return;
  }

  if (st.state === "awaiting_user_search") {
    await setAdminState(userId, null);
    const results = await searchBotUsers(text, 30);
    const header = `👤 <b>תוצאות חיפוש משתמשים</b>\n"<code>${escapeHtml(text)}</code>" · ${results.length} תוצאות`;
    const body = results.length ? "לחץ על משתמש כדי לראות פרטים ולחסום/לבטל חסימה." : "<i>לא נמצאו משתמשים.</i>";
    const kb: any[][] = results.map((u) => [
      { text: `${u.is_blocked ? "🚫 " : ""}${truncateBtn(displayUserName(u), 40)} · ${u.telegram_id}`, callback_data: `admin_user_${u.telegram_id}` },
    ]);
    kb.push([{ text: "🔎 חיפוש נוסף", callback_data: "admin_users_search" }]);
    kb.push([{ text: "« חזרה", callback_data: "admin_open" }]);
    await sendMessage(chatId, `${header}\n\n${body}`, { reply_markup: { inline_keyboard: kb } });
    return;
  }

  if (st.state === "awaiting_broadcast") {
    const target = st.data?.target as "private" | "groups" | "all";
    // Clear the state immediately so the admin is never locked out.
    await setAdminState(userId, null).catch(() => {});
    // Sub-admins cannot broadcast directly — the main admin approves first.
    if (!isMainAdmin(userId)) {
      const preview = (msg.text || msg.caption || "").slice(0, 500);
      try {
        const req = await createBroadcastRequest({
          requester_id: userId,
          requester_chat_id: chatId,
          target,
          from_chat_id: Number(msg.chat.id),
          message_id: Number(msg.message_id),
          preview: preview || null,
        });
        const who = await getBotUser(userId).catch(() => null);
        await sendMessage(
          ADMIN_ID,
          `📣 <b>בקשת שידור מאדמין</b>\n\n` +
            `👤 ${escapeHtml(who ? displayUserName(who) : String(userId))} · <code>${userId}</code>\n` +
            `🎯 יעד: <b>${target}</b>\n\n` +
            (preview ? `📝 תוכן ההודעה:\n<code>${escapeHtml(preview)}</code>` : "📝 הודעת מדיה — מצורפת מטה."),
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ אישור ושידור", callback_data: `admin_bcok_${req.id}` },
                  { text: "❌ ביטול", callback_data: `admin_bcno_${req.id}` },
                ],
              ],
            },
          },
        );
        await copyMessage(ADMIN_ID, Number(msg.chat.id), Number(msg.message_id)).catch(() => {});
        await sendMessage(chatId, "📨 הבקשה נשלחה לאדמין הראשי לאישור. תקבל עדכון כאן.");
      } catch (e: any) {
        await sendMessage(chatId, `❌ שגיאה בשליחת הבקשה: ${escapeHtml(e?.message || String(e))}`).catch(() => {});
      }
      return;
    }
    const total = await countBroadcastRecipients(target).catch(() => 0);
    const status: any = await sendMessage(
      chatId,
      `\ud83d\ude80 <b>\u05de\u05ea\u05d7\u05d9\u05dc \u05e9\u05d9\u05d3\u05d5\u05e8...</b>\n\u05d9\u05e2\u05d3: ${target}\n\u05e1\u05d4\u05f4\u05db \u05e0\u05de\u05e2\u05e0\u05d9\u05dd: <b>${total.toLocaleString()}</b>`,
    ).catch(() => null);
    try {
      const job = await createBroadcastJob({
        admin_user_id: userId,
        admin_chat_id: chatId,
        status_msg_id: status?.message_id ?? null,
        target,
        from_chat_id: Number(msg.chat.id),
        message_id: Number(msg.message_id),
        total,
      });
      // Start right away; the cron tick resumes the job until it is complete,
      // so the broadcast always reaches every recipient.
      await processBroadcastTick(15_000, job.id);
    } catch (e: any) {
      console.error("broadcast error:", e?.message || e);
      await sendMessage(chatId, `\u274c \u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05e9\u05d9\u05d3\u05d5\u05e8: ${escapeHtml(e?.message || String(e))}`).catch(() => {});
    }
    return;
  }

  if (st.state === "awaiting_admin_add") {
    if (!isMainAdmin(userId)) {
      await setAdminState(userId, null);
      return;
    }
    const parts = text.split(/\s+/);
    const tid = Number(parts[0]);
    const days = Number(parts[1] ?? "0");
    if (!Number.isFinite(tid) || tid <= 0) {
      await sendMessage(chatId, "❌ ID לא חוקי. נסה שוב או /cancel.");
      return;
    }
    const expires_at = days > 0 ? new Date(Date.now() + days * 86400_000).toISOString() : null;
    await addAdmin({ telegram_id: tid, added_by: userId, expires_at });
    await setAdminState(userId, null);
    await sendMessage(
      chatId,
      `✅ <code>${tid}</code> נוסף כאדמין${expires_at ? ` עד <b>${new Date(expires_at).toLocaleString("he-IL")}</b>` : " <b>קבוע</b>"}.`,
    );
    return;
  }
}

// ───── Payments ─────
async function handlePreCheckout(q: any) {
  await answerPreCheckoutQuery(q.id, true).catch((e) => console.error("preCheckout:", e?.message));
}

// ───── Utils ─────
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function truncateBtn(s: string, n: number) {
  const chars = Array.from(s);
  return chars.length > n ? chars.slice(0, n - 1).join("") + "…" : s;
}

function displayUserName(u: BotUserRow): string {
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  if (u.username) return `@${u.username}`;
  if (full) return full;
  return String(u.telegram_id);
}

const USERS_PAGE_SIZE = 15;

async function renderRequiredChannels(chatId: number, messageId: number) {
  const [list, settings] = await Promise.all([listRequiredChannels(), getSettings()]);
  const rows = [...list];
  if (settings.required_channel_id && !rows.some((c) => c.chat_id === Number(settings.required_channel_id))) {
    rows.unshift({
      chat_id: Number(settings.required_channel_id),
      username: settings.required_channel_username,
      title: settings.required_channel_title,
      invite_link: settings.required_channel_invite_link,
      kind: "permanent",
      expires_at: null,
    });
  }
  const perm = rows.filter((c) => c.kind !== "temporary");
  const temp = rows.filter((c) => c.kind === "temporary");
  const fmt = (c: (typeof rows)[number]) =>
    `• <b>${escapeHtml(c.title || c.username || String(c.chat_id))}</b>` +
    (c.expires_at ? ` — עד ${new Date(c.expires_at).toLocaleString("he-IL")}` : "");
  const text =
    `🔒 <b>ערוצי חובה</b>\n\n` +
    `📌 <b>קבועים (${perm.length}/${MAX_PERMANENT_REQUIRED})</b>\n${perm.length ? perm.map(fmt).join("\n") : "<i>אין</i>"}\n\n` +
    `⏳ <b>זמניים (${temp.length}/${MAX_TEMPORARY_REQUIRED})</b>\n${temp.length ? temp.map(fmt).join("\n") : "<i>אין</i>"}\n\n` +
    `כל משתמש חייב להיות מנוי לכל הערוצים ברשימה. לחיצה על ❌ מסירה ערוץ.`;
  await editMessageText(chatId, messageId, text, {
    reply_markup: requiredChannelsKeyboard(
      rows as any,
      perm.length < MAX_PERMANENT_REQUIRED,
      temp.length < MAX_TEMPORARY_REQUIRED,
    ),
  }).catch(() => {});
}

async function renderUsersList(
  chatId: number,
  messageId: number,
  opts: { query: string; page: number; sort: "joined" | "recent"; blockedOnly: boolean },
) {
  let results: BotUserRow[];
  let total: number;
  let header: string;
  if (opts.query) {
    results = await searchBotUsers(opts.query, 30);
    total = results.length;
    header = `👤 <b>תוצאות חיפוש משתמשים</b>\n"<code>${escapeHtml(opts.query)}</code>" · ${total} תוצאות`;
  } else {
    const res = await listUsersPaged({
      page: opts.page,
      pageSize: USERS_PAGE_SIZE,
      sort: opts.sort,
      blockedOnly: opts.blockedOnly,
    });
    results = res.rows;
    total = res.total;
    const sortLabel = opts.sort === "joined" ? "לפי סדר הצטרפות" : "לפי שימוש אחרון";
    header =
      (opts.blockedOnly ? `🚫 <b>משתמשים חסומים</b>` : `👤 <b>משתמשי הבוט</b>`) +
      `\nסה״כ: <b>${total.toLocaleString()}</b> · ${sortLabel}` +
      `\nעמוד ${opts.page + 1}/${Math.max(1, Math.ceil(total / USERS_PAGE_SIZE))}`;
  }
  const body = results.length
    ? "לחץ על משתמש כדי לראות פרטים ולחסום/לבטל חסימה."
    : "<i>לא נמצאו משתמשים.</i>";
  const kb: any[][] = results.map((u) => [
    {
      text:
        `${u.is_blocked ? "🚫 " : ""}${truncateBtn(displayUserName(u), 34)} · ${u.telegram_id}` +
        (opts.blockedOnly ? ` · ${u.blocked_until ? formatWhen(u.blocked_until).split(",")[0] : "לצמיתות"}` : ""),
      callback_data: `admin_user_${u.telegram_id}`,
    },
  ]);
  const b = opts.blockedOnly ? "1" : "0";
  if (!opts.query) {
    const totalPages = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));
    const nav: any[] = [];
    if (opts.page > 0) nav.push({ text: "⬅️ הקודם", callback_data: `admin_ul:${opts.sort}:${opts.page - 1}:${b}` });
    nav.push({ text: `${opts.page + 1}/${totalPages}`, callback_data: "noop" });
    if (opts.page < totalPages - 1) nav.push({ text: "הבא ➡️", callback_data: `admin_ul:${opts.sort}:${opts.page + 1}:${b}` });
    if (nav.length > 1) kb.push(nav);
    kb.push([
      { text: `${opts.sort === "joined" ? "✅ " : ""}📅 סדר הצטרפות`, callback_data: `admin_ul:joined:0:${b}` },
      { text: `${opts.sort === "recent" ? "✅ " : ""}🕓 שימוש אחרון`, callback_data: `admin_ul:recent:0:${b}` },
    ]);
    kb.push([
      opts.blockedOnly
        ? { text: "👤 כל המשתמשים", callback_data: `admin_ul:${opts.sort}:0:0` }
        : { text: "🚫 משתמשים חסומים", callback_data: `admin_ul:${opts.sort}:0:1` },
    ]);
    if (opts.blockedOnly && total > 0) {
      kb.push([{ text: "♻️ שחרר את כל החסומים", callback_data: "admin_unblock_all" }]);
    }
    if (opts.blockedOnly) {
      kb.push([{ text: "🔓 בקשות שחרור בתשלום", callback_data: "admin_unbreq" }]);
    }
  }
  kb.push([{ text: "🔎 חיפוש", callback_data: "admin_users_search" }]);
  kb.push([{ text: "« חזרה", callback_data: "admin_open" }]);
  await editMessageText(chatId, messageId, `${header}\n\n${body}`, { reply_markup: { inline_keyboard: kb } }).catch(() => {});
}

async function renderUserView(chatId: number, messageId: number, telegramId: number) {
  return await renderUserViewImpl(chatId, messageId, telegramId);
}

/** Pending/approved paid-release requests, with approve & reject buttons. */
async function renderUnblockRequests(chatId: number, messageId: number) {
  const reqs = await listUnblockRequests({ limit: 20 }).catch(() => []);
  const kb: any[][] = [];
  const lines: string[] = [];
  for (const r of reqs) {
    const u = await getBotUser(r.telegram_id).catch(() => null);
    const name = u ? escapeHtml(displayUserName(u)) : String(r.telegram_id);
    lines.push(
      `• <b>${name}</b> · <code>${r.telegram_id}</code> — ${r.permanent ? "לצמיתות" : "זמנית"} · ` +
        `${r.stars} ⭐ · ${r.status === "approved" ? "אושר, ממתין לתשלום" : "ממתין לאישור"}`,
    );
    if (r.status === "pending") {
      kb.push([
        { text: `✅ אשר · ${truncateBtn(name, 20)} · ${r.stars}⭐`, callback_data: `admin_unb_ok_${r.id}` },
        { text: "❌ דחה", callback_data: `admin_unb_no_${r.id}` },
      ]);
    }
  }
  kb.push([{ text: "🔄 רענן", callback_data: "admin_unbreq" }]);
  kb.push([{ text: "« חזרה", callback_data: "admin_ul:recent:0:1" }]);
  await editMessageText(
    chatId,
    messageId,
    `🔓 <b>בקשות שחרור בתשלום</b>\n\n` + (lines.length ? lines.join("\n") : "<i>אין בקשות ממתינות.</i>"),
    { reply_markup: { inline_keyboard: kb } },
  ).catch(() => {});
}

const PREMIUM_PAGE_SIZE = 8;

async function premiumUserRows(users: BotUserRow[]) {
  const prem = await premiumIdsAmong(users.map((u) => Number(u.telegram_id))).catch(() => new Set<number>());
  return users.map((u) => [
    {
      text: `${prem.has(Number(u.telegram_id)) ? "💎 " : "▫️ "}${truncateBtn(displayUserName(u), 38)} · ${u.telegram_id}`,
      callback_data: `admin_premu_${u.telegram_id}`,
    },
  ]);
}

async function renderPremiumList(
  chatId: number,
  messageId: number,
  opts: { page: number; sort: "joined" | "recent" },
) {
  const { rows, total } = await listUsersPaged({
    page: opts.page,
    pageSize: PREMIUM_PAGE_SIZE,
    sort: opts.sort,
  });
  const totalPages = Math.max(1, Math.ceil(total / PREMIUM_PAGE_SIZE));
  const sortLabel = opts.sort === "joined" ? "לפי סדר הצטרפות" : "לפי שימוש אחרון";
  const header =
    `💎 <b>ניהול פרימיום</b>\nסה״כ משתמשים: <b>${total.toLocaleString()}</b> · ${sortLabel}\nעמוד ${opts.page + 1}/${totalPages}`;
  const kb: any[][] = await premiumUserRows(rows);
  const nav: any[] = [];
  if (opts.page > 0) nav.push({ text: "⬅️ הקודם", callback_data: `admin_prem:${opts.sort}:${opts.page - 1}` });
  nav.push({ text: `${opts.page + 1}/${totalPages}`, callback_data: "noop" });
  if (opts.page < totalPages - 1) nav.push({ text: "הבא ➡️", callback_data: `admin_prem:${opts.sort}:${opts.page + 1}` });
  if (nav.length > 1) kb.push(nav);
  kb.push([
    { text: `${opts.sort === "joined" ? "✅ " : ""}📅 סדר הצטרפות`, callback_data: "admin_prem:joined:0" },
    { text: `${opts.sort === "recent" ? "✅ " : ""}🕓 שימוש אחרון`, callback_data: "admin_prem:recent:0" },
  ]);
  kb.push([{ text: "🔎 חיפוש לפי שם או ID", callback_data: "admin_prem_search" }]);
  kb.push([{ text: "« חזרה", callback_data: "admin_quota" }]);
  await editMessageText(chatId, messageId, `${header}\n\nלחץ על משתמש כדי להעניק או להסיר פרימיום.`, {
    reply_markup: { inline_keyboard: kb },
  }).catch(() => {});
}

async function renderPremiumUser(chatId: number, messageId: number, telegramId: number) {
  const u = await getBotUser(telegramId);
  const ent = await getEntitlements(telegramId).catch(() => null);
  const isPrem = !!ent?.is_premium;
  const name = u ? escapeHtml(displayUserName(u)) : String(telegramId);
  const text =
    `👤 <b>${name}</b>\n\n` +
    `🆔 ID: <code>${telegramId}</code>\n` +
    (u?.username ? `📛 שם משתמש: @${escapeHtml(u.username)}\n` : "") +
    `💎 פרימיום: <b>${isPrem ? "פעיל" : "לא פעיל"}</b>\n` +
    `🎁 בונוס יומי קבוע: <b>${ent?.bonus_daily ?? 0}</b>\n` +
    `⚡ חיפושים חד־פעמיים: <b>${ent?.extra_credits ?? 0}</b>`;
  await editMessageText(chatId, messageId, text, {
    reply_markup: {
      inline_keyboard: [
        [
          isPrem
            ? { text: "🚫 הסר פרימיום", callback_data: `admin_premtg_${telegramId}_0` }
            : { text: "💎 העניק פרימיום", callback_data: `admin_premtg_${telegramId}_1` },
        ],
        [{ text: "« חזרה לרשימה", callback_data: "admin_prem:recent:0" }],
      ],
    },
  }).catch(() => {});
}

async function renderSearchHistory(chatId: number, messageId: number, telegramId: number) {
  const u = await getBotUser(telegramId).catch(() => null);
  const rows = await lastSearches(telegramId, 15).catch(() => []);
  const name = u ? escapeHtml(displayUserName(u)) : String(telegramId);
  const flaggedCount = rows.filter((r) => r.query.startsWith(FLAGGED_PREFIX)).length;
  const body = rows.length
    ? rows
        .map((r, i) => {
          const flagged = r.query.startsWith(FLAGGED_PREFIX);
          const q = flagged ? r.query.slice(FLAGGED_PREFIX.length) : r.query;
          return (
            `${i + 1}. ${flagged ? "🚫 " : ""}<code>${escapeHtml(q)}</code>` +
            (flagged ? " <i>(חיפוש לא הולם)</i>" : "") +
            `\n   ${formatWhen(r.created_at)}`
          );
        })
        .join("\n")
    : "<i>אין חיפושים שמורים.</i>";
  await editMessageText(
    chatId,
    messageId,
    `📜 <b>15 החיפושים האחרונים</b>\n👤 ${name} · <code>${telegramId}</code>` +
      (flaggedCount ? `\n🚫 חיפושים לא הולמים ברשימה: <b>${flaggedCount}</b>` : "") +
      `\n\n${body}`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚫 חסום לצמיתות", callback_data: `admin_ublk_${telegramId}` }],
          [{ text: "« חזרה למשתמש", callback_data: `admin_user_${telegramId}` }],
        ],
      },
    },
  ).catch(() => {});
}

async function renderUserViewImpl(chatId: number, messageId: number, telegramId: number) {
  const u = await getBotUser(telegramId);
  if (!u) {
    await editMessageText(chatId, messageId, "❌ המשתמש לא נמצא במאגר.", {
      reply_markup: { inline_keyboard: [[{ text: "« חזרה", callback_data: "admin_users" }]] },
    }).catch(() => {});
    return;
  }
  const stars = await userStars(telegramId).catch(() => 0);
  const recent = await lastSearches(telegramId, 1).catch(() => []);
  const name = escapeHtml(displayUserName(u));
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  const text =
    `👤 <b>${name}</b>\n\n` +
    `🆔 ID: <code>${u.telegram_id}</code>\n` +
    (u.username ? `📛 שם משתמש: @${escapeHtml(u.username)}\n` : "") +
    (full ? `🧾 שם מלא: ${escapeHtml(full)}\n` : "") +
    `📅 הצטרף: ${new Date(u.first_seen).toLocaleString("he-IL")}\n` +
    `🕓 נראה לאחרונה: ${new Date(u.last_seen).toLocaleString("he-IL")}\n` +
    `⭐ תרומות בכוכבים: <b>${stars.toLocaleString()}</b>\n` +
    `🔍 חיפוש אחרון: ${recent[0] ? `<code>${escapeHtml(recent[0].query)}</code> · ${formatWhen(recent[0].created_at)}` : "—"}\n` +
    `סטטוס: ${u.is_blocked ? "🚫 חסום" : "✅ פעיל"}` +
    (u.is_blocked
      ? `\nסיבה: ${escapeHtml(u.block_reason || "חסימה ידנית")}` +
        `\nמשתחרר: ${u.blocked_until ? formatWhen(u.blocked_until) : "לצמיתות (עד שחרור ידני)"}` +
        (u.block_strikes ? `\nעבירות: ${u.block_strikes}` : "")
      : "");
  const actionBtn = u.is_blocked
    ? { text: "✅ בטל חסימה", callback_data: `admin_uunblk_${u.telegram_id}` }
    : { text: "🚫 חסום לצמיתות", callback_data: `admin_ublk_${u.telegram_id}` };
  await editMessageText(chatId, messageId, text, {
    reply_markup: {
      inline_keyboard: [
        [actionBtn],
        [{ text: "📜 היסטוריית חיפושים", callback_data: `admin_uhist_${u.telegram_id}` }],
        [{ text: "« חזרה לרשימה", callback_data: "admin_users" }],
      ],
    },
  }).catch(() => {});
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function pageFromMessageText(text?: string): number {
  const match = (text || "").match(/עמוד\s+(\d+)\s*\/\s*\d+/);
  const oneBasedPage = match ? Number(match[1]) : 1;
  return Number.isFinite(oneBasedPage) && oneBasedPage > 0 ? oneBasedPage - 1 : 0;
}

function pageFromCallbackOrMessage(pageText: string | undefined, messageText?: string): number {
  const page = Number(pageText);
  if (Number.isInteger(page) && page >= 0) return page;
  return pageFromMessageText(messageText);
}

// Recover the original search query from a results message text.
// The header we render is:
//   🔎 תוצאות עבור: <QUERY>\nנמצאו ...
// Telegram strips HTML on delivery, so we just take the first line's suffix.
function queryFromMessageText(text?: string): string | null {
  if (!text) return null;
  const line = text.split("\n")[0] || "";
  const m = line.match(/תוצאות עבור:\s*(.+?)\s*$/);
  const q = m ? m[1].trim() : "";
  return q.length >= 2 ? q : null;
}

// Determine dedupe state from the results message itself so pagination and
// re-renders keep the user's chosen filter across expired caches.
function dedupeFromMsg(msg: any, cached: { dedupe?: boolean } | null | undefined): boolean {
  const kb = msg?.reply_markup?.inline_keyboard as any[][] | undefined;
  if (Array.isArray(kb)) {
    for (const row of kb) {
      for (const btn of row || []) {
        const cd: string = btn?.callback_data || "";
        if (typeof cd === "string" && cd.startsWith("dup:")) {
          const parts = cd.split(":");
          // dup:<qid>:<newFlag> — newFlag is what the click WOULD set.
          // So current dedupe is the opposite.
          const newFlag = parts[2];
          if (newFlag === "0") return true;  // currently on, click turns off
          if (newFlag === "1") return false; // currently off, click turns on
        }
      }
    }
  }
  const text: string = msg?.text || "";
  if (text.includes("סינון כפילויות פעיל")) return true;
  if (text.includes("כולל כפילויות")) return false;
  if (cached && typeof cached.dedupe === "boolean") return cached.dedupe;
  return true;
}

function dedupeFromCallbackOrMsg(dedupeText: string | undefined, msg: any, cached: { dedupe?: boolean } | null | undefined): boolean {
  if (dedupeText === "1") return true;
  if (dedupeText === "0") return false;
  return dedupeFromMsg(msg, cached);
}

// Short stable id for callback_data (8 hex chars from SHA-1 of query).
function shortId(s: string): string {
  // Tiny non-crypto hash, no Node 'crypto' dep needed here.
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0")).slice(0, 12);
}