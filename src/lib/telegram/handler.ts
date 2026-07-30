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
    await upsertGroup({ id: Number(chat.id), title: chat.title, type: chat.type });
    if (msg.text) {
      // Treat any text starting with "?" or any text that isn't a command as a search.
      const text = msg.text.trim();
      if (text.startsWith("/")) return; // ignore commands in groups
      if (text.length < 2) return;
      // Blocked user in a group: silently ignore search attempts, but notify them.
      const bu = await getBotUser(Number(from.id)).catch(() => null);
      if (bu?.is_blocked) {
        await sendMessage(chat.id, "🚫 אתה חסום פנה למנהל", { reply_to_message_id: msg.message_id } as any).catch(() => {});
        return;
      }
      // Require bot admin+can_invite_users permission in the group before serving results.
      const perm = await checkGroupPermissions(chat.id).catch(() => ({ ok: true } as any));
      if (!perm.ok) {
        await sendMessage(chat.id, perm.text, perm.extra || {}).catch(() => {});
        return;
      }
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
    await recordPayment({
      telegram_user_id: Number(from.id),
      stars_amount: Number(sp.total_amount),
      telegram_payment_charge_id: sp.telegram_payment_charge_id,
      telegram_provider_charge_id: sp.provider_payment_charge_id || "",
      payload: sp.invoice_payload,
    });
    await sendMessage(chat.id, `🙏 תודה רבה על התמיכה! קיבלנו ${sp.total_amount} ⭐`);
    return;
  }

  const text: string = msg.text || "";

  // Admin multi-step flow
  if (await isAdmin(from.id)) {
    const st = await getAdminState(Number(from.id));
    // While a broadcast is running for this admin, ignore any incoming
    // text so the broadcast message itself isn't treated as a search
    // query (Telegram may retry the same update after 60s). /cancel is
    // intentionally ignored here to avoid killing an in-flight run.
    if (st?.state === "broadcasting") {
      // Safety valve: if the worker died mid-broadcast the state would stay
      // forever and the bot would look "dead" for that admin. Consider the
      // state stale when no heartbeat arrived for 90s, or on explicit /cancel.
      const hb = Number(st.data?.heartbeat_at ?? st.data?.started_at ?? 0);
      const stale = !hb || Date.now() - hb > 90_000;
      if (text === "/cancel" || stale) {
        await setAdminState(Number(from.id), null).catch(() => {});
        await sendMessage(chat.id, stale && text !== "/cancel"
          ? "⚠️ שידור קודם נתקע ואופס. אפשר להמשיך כרגיל."
          : "❎ מצב השידור בוטל.").catch(() => {});
        return;
      }
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
      await sendMessage(chat.id, "🚫 אתה חסום פנה למנהל").catch(() => {});
      return;
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
    return await safeRunSearchAndRespond(chat.id, Number(from.id), text, 0, null, false);
  }
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
  const text =
    `🎬 <b>בוט חיפוש סרטים</b>\n\n` +
    `🔍 כדי לחפש סרט — פשוט <b>שלח לי את שם הסרט</b> בהודעה כאן בצ׳אט.\n` +
    `לדוגמה: <code>הארי פוטר</code> או <code>Inception</code>\n\n` +
    `📥 אני אחזיר לך תוצאות מהמאגר. לחץ על השם של הסרט כדי לקבל אותו.\n` +
    `📚 אם יש הרבה תוצאות — אפשר לדפדף בעמודים בעזרת הכפתורים למטה.\n\n` +
    `💡 ניתן גם להוסיף אותי לקבוצות ולחפש שם.`;
  const kb = startMenuKeyboard(settings, me.username);
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
    const totalPrivate = users.length;
    const combined = totalGroupMembers + totalPrivate;
    const text =
      `📢 <b>פרסום ממומן</b>\n\n` +
      `👨‍👩‍👧 סה״כ משתמשים בקבוצות: <b>${totalGroupMembers.toLocaleString()}</b>\n` +
      `👤 סה״כ משתמשים בפרטי: <b>${totalPrivate.toLocaleString()}</b>\n` +
      `🌐 סה״כ חשיפה משוערת: <b>${combined.toLocaleString()}</b>\n\n` +
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
      data.startsWith("admin_rm_"))
  ) {
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
        { reply_markup: sourceChannelsKeyboard(list) },
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

  if (
    st.state === "awaiting_source_channel" ||
    st.state === "awaiting_source_channel_add" ||
    st.state === "awaiting_required_channel"
  ) {
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

  if (st.state === "awaiting_search_group") {
    // handled below
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
    // Send the live status message first so we can edit it as progress advances.
    const status: any = await sendMessage(
      chatId,
      `🚀 <b>מתחיל שידור...</b>\nיעד: ${target}`,
    ).catch(() => null);
    const statusMsgId: number | null = status?.message_id ?? null;
    // Mark admin state as "broadcasting" so any incoming text from this
    // admin (including the broadcast message itself on Telegram retries)
    // is ignored instead of being treated as a search query.
    await setAdminState(userId, "broadcasting", {
      target,
      status_msg_id: statusMsgId,
      started_at: Date.now(),
      heartbeat_at: Date.now(),
    });
    try {
      await runBroadcast(chatId, userId, target, msg, statusMsgId);
    } catch (e: any) {
      console.error("broadcast error:", e?.message || e);
      await sendMessage(chatId, `❌ שגיאה בשידור: ${escapeHtml(e?.message || String(e))}`).catch(() => {});
    } finally {
      await setAdminState(userId, null).catch(() => {});
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

async function runBroadcast(
  adminChatId: number,
  adminUserId: number,
  target: "private" | "groups" | "all",
  srcMsg: any,
  statusMsgId: number | null,
) {
  const users = target === "private" || target === "all" ? await listUsers() : [];
  const groups = target === "groups" || target === "all" ? await listGroups() : [];
  const recipients: { id: number; pin: boolean }[] = [
    ...users.map((id) => ({ id, pin: false })),
    ...groups.map((id) => ({ id, pin: true })),
  ];
  let sent = 0;
  let failed = 0;
  const fromChatId = srcMsg.chat.id;
  const messageId = srcMsg.message_id;
  const total = recipients.length;
  let lastEditAt = 0;
  let lastEditedText = "";
  let lastHeartbeat = Date.now();
  let rateLimitWaits = 0;
  let lastRetryAfter = 0;

  // Telegram flood-control (429) aware sender: waits retry_after and resumes.
  const withFloodWait = async <T>(fn: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        return await fn();
      } catch (e: any) {
        const retryAfter = Number(e?.parameters?.retry_after ?? 0);
        if (e?.code === 429 && retryAfter > 0) {
          rateLimitWaits++;
          lastRetryAfter = retryAfter;
          await sendMessage(
            adminChatId,
            `⏳ קיבלתי באן זמני מטלגרם (Flood control). ממתין <b>${retryAfter}</b> שניות וממשיך.`,
          ).catch(() => {});
          await sleep((retryAfter + 1) * 1000);
          continue;
        }
        throw e;
      }
    }
    throw new Error("flood control: too many retries");
  };

  const renderStatus = (done: boolean) =>
    (done ? `✅ <b>שידור הסתיים</b>\n\n` : `📤 <b>שידור בתהליך...</b>\n\n`) +
    `יעד: ${target}\n` +
    `סה״כ: <b>${total.toLocaleString()}</b>\n` +
    `נשלח: <b>${sent.toLocaleString()}</b>\n` +
    `נכשל: <b>${failed.toLocaleString()}</b>\n` +
    `התקדמות: <b>${sent + failed}/${total}</b>` +
    (rateLimitWaits
      ? `\n⏳ המתנות עקב הגבלת טלגרם: <b>${rateLimitWaits}</b> (אחרונה: ${lastRetryAfter}s)`
      : "");

  const tryEditStatus = async (force: boolean) => {
    if (!statusMsgId) return;
    const now = Date.now();
    if (!force && now - lastEditAt < 1500) return;
    const text = renderStatus(false);
    if (text === lastEditedText) return;
    lastEditAt = now;
    lastEditedText = text;
    await editMessageText(adminChatId, statusMsgId, text).catch(() => {});
  };

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    try {
      const copied: any = await withFloodWait(() => copyMessage(r.id, fromChatId, messageId));
      sent++;
      if (r.pin && copied?.message_id) {
        await pinChatMessage(r.id, copied.message_id, true).catch(() => {});
      }
    } catch (e: any) {
      failed++;
      const code = e?.code;
      const desc: string = e?.description || "";
      if (code === 403 || /blocked|deactivated|kicked|chat not found/i.test(desc)) {
        if (r.pin) await markGroupInactive(r.id).catch(() => {});
        else await markUserBlocked(r.id).catch(() => {});
      }
    }
    // Telegram rate limit: ~30 msg/sec global
    if (i % 25 === 24) await sleep(1000);
    // Live-edit the status message ~every 1.5s
    await tryEditStatus(false);
    // Heartbeat so a crashed run can be detected and never blocks the admin.
    if (Date.now() - lastHeartbeat > 15_000) {
      lastHeartbeat = Date.now();
      await setAdminState(adminUserId, "broadcasting", {
        target,
        status_msg_id: statusMsgId,
        heartbeat_at: lastHeartbeat,
      }).catch(() => {});
    }
  }
  const finalText = renderStatus(true);
  if (statusMsgId) {
    const edited = await editMessageText(adminChatId, statusMsgId, finalText).catch(() => null);
    if (!edited) await sendMessage(adminChatId, finalText).catch(() => {});
  } else {
    await sendMessage(adminChatId, finalText).catch(() => {});
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
      text: `${u.is_blocked ? "🚫 " : ""}${truncateBtn(displayUserName(u), 40)} · ${u.telegram_id}`,
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
  }
  kb.push([{ text: "🔎 חיפוש", callback_data: "admin_users_search" }]);
  kb.push([{ text: "« חזרה", callback_data: "admin_open" }]);
  await editMessageText(chatId, messageId, `${header}\n\n${body}`, { reply_markup: { inline_keyboard: kb } }).catch(() => {});
}

async function renderUserView(chatId: number, messageId: number, telegramId: number) {
  const u = await getBotUser(telegramId);
  if (!u) {
    await editMessageText(chatId, messageId, "❌ המשתמש לא נמצא במאגר.", {
      reply_markup: { inline_keyboard: [[{ text: "« חזרה", callback_data: "admin_users" }]] },
    }).catch(() => {});
    return;
  }
  const stars = await userStars(telegramId).catch(() => 0);
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
    `סטטוס: ${u.is_blocked ? "🚫 חסום" : "✅ פעיל"}`;
  const actionBtn = u.is_blocked
    ? { text: "✅ בטל חסימה", callback_data: `admin_uunblk_${u.telegram_id}` }
    : { text: "🚫 חסום משתמש", callback_data: `admin_ublk_${u.telegram_id}` };
  await editMessageText(chatId, messageId, text, {
    reply_markup: {
      inline_keyboard: [
        [actionBtn],
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