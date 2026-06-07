import { INVITE_PRIVATE_BOT_URL, STAR_AMOUNTS } from "./constants";
import type { BotSettings } from "./db";

export function startMenuKeyboard(s: BotSettings, botUsername: string) {
  const rows: any[][] = [];
  if (s.updates_channel_url || s.required_channel_invite_link) {
    rows.push([{ text: "📢 ערוץ עדכונים", url: s.updates_channel_url || s.required_channel_invite_link || "" }]);
  }
  rows.push([
    { text: "❤️ תמיכה בבוט", callback_data: "support_menu" },
    { text: "➕ הוספה לקבוצה", url: `https://t.me/${botUsername}?startgroup=add` },
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
  query: string,
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
    if (page > 0) nav.push({ text: "« הקודם", callback_data: `pg_${encodeQuery(query)}_${page - 1}` });
    nav.push({ text: `${page + 1}/${totalPages}`, callback_data: "noop" });
    if (page < totalPages - 1) nav.push({ text: "הבא »", callback_data: `pg_${encodeQuery(query)}_${page + 1}` });
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

export function adminPanelKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🎬 הגדרת ערוץ סרטים", callback_data: "admin_set_source" }],
      [{ text: "🔒 הגדרת ערוץ חובה", callback_data: "admin_set_required" }],
      [{ text: "📊 סטטיסטיקות", callback_data: "admin_stats" }],
      [{ text: "📣 שידור לפרטיים", callback_data: "admin_bc_private" }],
      [{ text: "📣 שידור לקבוצות", callback_data: "admin_bc_groups" }],
      [{ text: "📣 שידור לכולם", callback_data: "admin_bc_all" }],
      [{ text: "« סגור", callback_data: "admin_close" }],
    ],
  };
}

function truncate(s: string, n: number) {
  s = s.replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
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