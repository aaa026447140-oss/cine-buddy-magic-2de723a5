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
  cacheQuery,
  cacheSearchAll,
  getCachedSearch,
  getCachedSearchAll,
  getAdminState,
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
  recordPayment,
  removeAdmin,
  removeSourceChannel,
  fetchAllSearchCandidates,
  paginateCandidates,
  setAdminState,
  setPageState,
  stats,
  updateSettings,
  upsertGroup,
  upsertUser,
  type BotSettings,
} from "./db";
import {
  adminPanelKeyboard,
  adminsListKeyboard,
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

async function isSubscribed(userId: number, settings: BotSettings): Promise<boolean> {
  if (!settings.required_channel_id) return true; // no required channel set
  try {
    const m: any = await getChatMember(settings.required_channel_id, userId);
    return ["creator", "administrator", "member", "restricted"].includes(m.status);
  } catch {
    return false;
  }
}

async function requireSubscriptionOrPrompt(
  chatId: number,
  userId: number,
  settings: BotSettings,
  recheckPayload: string,
): Promise<boolean> {
  if (await isSubscribed(userId, settings)) return true;
  const inviteUrl =
    settings.required_channel_invite_link ||
    (settings.required_channel_username ? `https://t.me/${settings.required_channel_username}` : "");
  await sendMessage(
    chatId,
    "🔒 כדי להשתמש בבוט עליך להיות מנוי לערוץ החובה שלנו.\n\nהצטרף ולחץ על «הצטרפתי, בדוק שוב».",
    { reply_markup: subscribeRequiredKeyboard(inviteUrl, recheckPayload) },
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
    if (st && !text.startsWith("/")) {
      return await handleAdminStateInput(chat.id, Number(from.id), st, msg);
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
  const s = await stats();
  const text =
    `📊 <b>סטטיסטיקת המאגר</b>\n\n` +
    `🎬 סרטים במאגר: <b>${s.movies.toLocaleString()}</b>\n` +
    `👤 משתמשים: <b>${s.users.toLocaleString()}</b>\n` +
    `👥 קבוצות: <b>${s.groups.toLocaleString()}</b>`;
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
    `💡 ניתן גם להוסיף אותי לקבוצות ולחפש שם.\n\n` +
    `נבנה על ידי @${settings.builder_username?.replace(/^@/, "") || "Hsshsusudjd"}`;
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
    const [, qid, flag] = data.split(":");
    const cached = await getCachedSearch(qid);
    const recovered = cached?.query || queryFromMessageText(msg.text);
    if (!recovered) {
      answerCallbackQuery(cq.id, { text: "❌ פג תוקף החיפוש", show_alert: true }).catch(() => {});
      return;
    }
    answerCallbackQuery(cq.id).catch(() => {});
    const newDedupe = flag === "1";
    const inGroup = msg.chat.type !== "private";
    await safeRunSearchAndRespond(chatId, from.id, recovered, 0, msg.message_id, inGroup, undefined, `${chatId}:${msg.message_id}`, newDedupe);
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
      `הבוט שלנו פעיל בעשרות קבוצות ואלפי משתמשים פרטיים —\n` +
      `הפרסומת שלך תגיע לקהל אמיתי וממוקד.\n\n` +
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
    await safeRunSearchAndRespond(chatId, from.id, recovered, page, msg.message_id, inGroup, qid, `${chatId}:${msg.message_id}`, cached?.dedupe !== false);
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
    await safeRunSearchAndRespond(chatId, from.id, recovered, page, msg.message_id, inGroup, qid, `${chatId}:${msg.message_id}`, cached?.dedupe !== false);
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
    await safeRunSearchAndRespond(chatId, from.id, recovered, page, msg.message_id, inGroup, qid, latestScope, cached?.dedupe !== false);
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
  if (!main && (data === "admin_set_required" || data === "admin_manage" || data === "admin_add" || data.startsWith("admin_rm_"))) {
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
      const totalGroupMembers = counts.reduce((sum, g) => sum + g.count, 0);
      const combinedReach = totalGroupMembers + s.users;
      const groupLines = counts.length
        ? counts
            .sort((a, b) => b.count - a.count)
            .slice(0, 60)
            .map((g) => {
              const name = escapeHtml(g.title || String(g.chat_id));
              return g.ok
                ? `• <b>${name}</b> — ${g.count.toLocaleString()} משתמשים`
                : `• <b>${name}</b> — <i>לא זמין</i>`;
            })
            .join("\n")
        : "<i>אין קבוצות פעילות.</i>";
      const moreNote = counts.length > 60 ? `\n<i>...ועוד ${counts.length - 60} קבוצות</i>` : "";
      const text =
        `📊 <b>סטטיסטיקות מפורטות</b>\n\n` +
        `🎬 סרטים: <b>${s.movies.toLocaleString()}</b>\n` +
        `👤 משתמשים בפרטי: <b>${s.users.toLocaleString()}</b>\n` +
        `👥 קבוצות פעילות: <b>${s.groups.toLocaleString()}</b>\n` +
        `👨‍👩‍👧 סה״כ משתמשים בקבוצות: <b>${totalGroupMembers.toLocaleString()}</b>\n` +
        `🌐 סה״כ קהל (פרטי + קבוצות): <b>${combinedReach.toLocaleString()}</b>\n` +
        `⭐ סה״כ כוכבים שתרמו: <b>${s.totalStars.toLocaleString()}</b>\n\n` +
        `<b>רשימת קבוצות:</b>\n${groupLines}${moreNote}`;
      // Telegram message hard limit is 4096 chars; trim from the middle if needed.
      const safe = text.length > 3900 ? text.slice(0, 3900) + "\n<i>...נחתך</i>" : text;
      return await editMessageText(chatId, messageId, safe, {
        reply_markup: { inline_keyboard: [[{ text: "« חזרה", callback_data: "admin_open" }]] },
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

  if (st.state === "awaiting_broadcast") {
    const target = st.data?.target as "private" | "groups" | "all";
    await setAdminState(userId, null);
    await sendMessage(chatId, "🚀 מתחיל שידור — זה עשוי לקחת זמן, אל תסגור את הצ׳אט...");
    // MUST await — in the Worker runtime detached promises are cancelled
    // when the handler returns, which is why broadcasts never actually went out.
    try {
      await runBroadcast(chatId, userId, target, msg);
    } catch (e: any) {
      console.error("broadcast error:", e?.message || e);
      await sendMessage(chatId, `❌ שגיאה בשידור: ${escapeHtml(e?.message || String(e))}`).catch(() => {});
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

async function runBroadcast(adminChatId: number, adminUserId: number, target: "private" | "groups" | "all", srcMsg: any) {
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

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    try {
      const copied: any = await copyMessage(r.id, fromChatId, messageId);
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
    // Periodic progress
    if (i % 500 === 499) {
      await sendMessage(adminChatId, `📤 התקדמות: ${i + 1}/${recipients.length} · נשלח: ${sent} · נכשל: ${failed}`).catch(() => {});
    }
  }
  await sendMessage(
    adminChatId,
    `✅ <b>שידור הסתיים</b>\n\nיעד: ${target}\nסה״כ: ${recipients.length}\nנשלח: ${sent}\nנכשל: ${failed}`,
  );
}

// ───── Payments ─────
async function handlePreCheckout(q: any) {
  await answerPreCheckoutQuery(q.id, true).catch((e) => console.error("preCheckout:", e?.message));
}

// ───── Utils ─────
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function pageFromMessageText(text?: string): number {
  const match = (text || "").match(/עמוד\s+(\d+)\s*\/\s*\d+/);
  const oneBasedPage = match ? Number(match[1]) : 1;
  return Number.isFinite(oneBasedPage) && oneBasedPage > 0 ? oneBasedPage - 1 : 0;
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