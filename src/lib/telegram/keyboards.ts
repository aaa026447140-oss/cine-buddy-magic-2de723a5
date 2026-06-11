import { INVITE_PRIVATE_BOT_URL, STAR_AMOUNTS } from "./constants";
import type { BotSettings } from "./db";

export function startMenuKeyboard(s: BotSettings, botUsername: string) {
  const rows: any[][] = [];
  rows.push([
    { text: "📊 כמה סרטים יש במאגר?", callback_data: "show_stats" },
  ]);
  if (s.updates_channel_url || s.required_channel_invite_link) {
    rows.push([{ text: "📢 ערוץ עדכונים", url: s.updates_channel_url || s.required_channel_invite_link || "" }]);
  }
  // Request admin rights so users add the bot as admin (not just member).
  const addRights = [
    "change_info",
    "delete_messages",
    "invite_users",
    "pin_messages",
    "manage_topics",
    "manage_video_chats",
    "restrict_members",
  ].join("+");
  rows.push([
    { text: "❤️ תמיכה בבוט", callback_data: "support_menu" },
    { text: "➕ הוספה לקבוצה", url: `https://t.me/${botUsername}?startgroup=true&admin=${addRights}` },
  ]);
  rows.push([{ text: "🤖 הזמנת בוט פרטי משלכם", url: INVITE_PRIVATE_BOT_URL }]);
  return { inline_keyboard: rows };
}

export function supportMenuKeyboard() {
  const rows = STAR_AMOUNTS.map((n) => [{ text: `⭐ ${n} כוכבים`, callback_data: `donate_${n}` }]);
  rows.push([{ text: "« חזרה", callback_data: "back_to_start" }]);
  return { inline_keyboard: rows };
}

export function resultsKeyboard(
  results: { id: number; title: string }[],
  page: number,
  totalPages: number,
  queryId: string,
  botUsername: string,
  inGroup: boolean,
) {
  const rows: any[][] = [];
  for (const r of results) {
    // In group: button deep-links into private chat for the movie.
    // In private: same callback fetches the movie immediately.
    if (inGroup) {
      rows.push([{ text: `🎬 ${truncate(r.title, 55)}`, url: `https://t.me/${botUsername}?start=m_${r.id}` }]);
    } else {
      rows.push([{ text: `🎬 ${truncate(r.title, 55)}`, callback_data: `get_${r.id}` }]);
    }
  }
  if (totalPages > 1) {
    const nav: any[] = [];
    if (page > 0) nav.push({ text: "⬅️ הקודם", callback_data: pageCallback(queryId, page - 1) });
    nav.push({ text: `${page + 1}/${totalPages}`, callback_data: pageCallback(queryId, page) });
    if (page < totalPages - 1) nav.push({ text: "הבא ➡️", callback_data: pageCallback(queryId, page + 1) });
    rows.push(nav);
  }
  rows.push([
    { text: "🤖 הזמנת בוט פרטי", url: INVITE_PRIVATE_BOT_URL },
    { text: "❤️ תמיכה בבוט", callback_data: "support_menu" },
  ]);
  return { inline_keyboard: rows };
}

export function subscribeRequiredKeyboard(inviteUrl: string, recheckPayload: string) {
  return {
    inline_keyboard: [
      [{ text: "📢 הצטרף לערוץ", url: inviteUrl }],
      [{ text: "✅ הצטרפתי, בדוק שוב", callback_data: `check_${recheckPayload}` }],
    ],
  };
}

export function adminPanelKeyboard(isMain: boolean) {
  const rows: any[][] = [
    [{ text: "🎬 ניהול ערוצי סרטים", callback_data: "admin_sources" }],
  ];
  if (isMain) {
    rows.push([{ text: "🔒 הגדרת ערוץ חובה", callback_data: "admin_set_required" }]);
  }
  rows.push([{ text: "📊 סטטיסטיקות", callback_data: "admin_stats" }]);
  rows.push([{ text: "📣 שידור לפרטיים", callback_data: "admin_bc_private" }]);
  rows.push([{ text: "📣 שידור לקבוצות", callback_data: "admin_bc_groups" }]);
  rows.push([{ text: "📣 שידור לכולם", callback_data: "admin_bc_all" }]);
  if (isMain) {
    rows.push([{ text: "👥 ניהול אדמינים", callback_data: "admin_manage" }]);
  }
  rows.push([{ text: "« סגור", callback_data: "admin_close" }]);
  return { inline_keyboard: rows };
}

export function sourceChannelsKeyboard(channels: { chat_id: number; username: string | null; title: string | null }[]) {
  const rows: any[][] = [];
  for (const c of channels) {
    const label = `❌ ${c.title || c.username || c.chat_id}`;
    rows.push([{ text: label, callback_data: `admin_src_rm_${c.chat_id}` }]);
  }
  rows.push([{ text: "➕ הוסף ערוץ נוסף", callback_data: "admin_src_add" }]);
  rows.push([{ text: "« חזרה", callback_data: "admin_open" }]);
  return { inline_keyboard: rows };
}

export function adminsListKeyboard(admins: { telegram_id: number; expires_at: string | null }[]) {
  const rows: any[][] = [];
  for (const a of admins) {
    const label = a.expires_at
      ? `❌ ${a.telegram_id} · עד ${new Date(a.expires_at).toLocaleDateString("he-IL")}`
      : `❌ ${a.telegram_id} · קבוע`;
    rows.push([{ text: label, callback_data: `admin_rm_${a.telegram_id}` }]);
  }
  rows.push([{ text: "➕ הוסף אדמין", callback_data: "admin_add" }]);
  rows.push([{ text: "« חזרה", callback_data: "admin_open" }]);
  return { inline_keyboard: rows };
}

function truncate(s: string, n: number) {
  s = s.replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function pageCallback(queryId: string, page: number) {
  return `nav:${queryId}:${page}`;
}

// Telegram callback_data max 64 bytes. Encode query as base64url, cap length.
export function encodeQuery(q: string): string {
  const b = Buffer.from(q.slice(0, 80), "utf8").toString("base64url");
  return b.slice(0, 48);
}
export function decodeQuery(s: string): string {
  try {
    return Buffer.from(s, "base64url").toString("utf8");
  } catch {
    return "";
  }
}