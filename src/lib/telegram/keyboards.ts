import { STAR_AMOUNTS } from "./constants";
import type { BotSettings } from "./db";

export function startMenuKeyboard(s: BotSettings, botUsername: string) {
  const rows: any[][] = [];
  rows.push([
    { text: "📊 כמה סרטים יש במאגר?", callback_data: "show_stats" },
  ]);
  if (s.search_group_url) {
    rows.push([{ text: `🔎 ${s.search_group_title || "קבוצת החיפוש"}`, url: s.search_group_url }]);
  }
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
  rows.push([{ text: "📢 פרסום ממומן", callback_data: "ads_menu" }]);
  return { inline_keyboard: rows };
}

export function quotaMenuKeyboard(
  s: BotSettings,
  botUsername: string,
  userId: number,
  isPremium: boolean,
) {
  const rows: any[][] = [];
  rows.push([
    {
      text: "🔗 הזמן חברים וקבל חיפושים",
      url: `https://t.me/share/url?url=${encodeURIComponent(`https://t.me/${botUsername}?start=r_${userId}`)}&text=${encodeURIComponent("בוט חיפוש סרטים 🎬")}`,
    },
  ]);
  rows.push([{ text: "📋 העתק את קישור ההזמנה שלי", callback_data: "quota_link" }]);
  if (!isPremium) {
    rows.push([{ text: `⚡ חיפוש נוסף חד־פעמי · ${s.price_single_search} ⭐`, callback_data: "buy_single" }]);
    rows.push([{ text: `📅 +1 חיפוש כל יום · ${s.price_daily_extra} ⭐`, callback_data: "buy_daily" }]);
    rows.push([{ text: `💎 פרימיום — ללא הגבלה · ${s.price_premium} ⭐`, callback_data: "buy_premium" }]);
  }
  rows.push([{ text: "« חזרה", callback_data: "back_to_start" }]);
  return { inline_keyboard: rows };
}

export function quotaAdminKeyboard(s: BotSettings) {
  return {
    inline_keyboard: [
      [{ text: s.quota_enabled ? "🟢 מערכת חיפושים: פעילה (כבה)" : "🔴 מערכת חיפושים: כבויה (הפעל)", callback_data: "admin_q_toggle" }],
      [{ text: `🔢 חיפושים חינם ליום: ${s.free_searches_per_day}`, callback_data: "admin_q_free" }],
      [{ text: `⚡ מחיר חיפוש חד־פעמי: ${s.price_single_search} ⭐`, callback_data: "admin_q_p_single" }],
      [{ text: `📅 מחיר חיפוש יומי קבוע: ${s.price_daily_extra} ⭐`, callback_data: "admin_q_p_daily" }],
      [{ text: `💎 מחיר פרימיום: ${s.price_premium} ⭐`, callback_data: "admin_q_p_premium" }],
      [{ text: "💎 ניהול פרימיום למשתמשים", callback_data: "admin_prem:recent:0" }],
      [{ text: "♻️ אפס את המכסה היומית לכולם", callback_data: "admin_q_reset" }],
      [{ text: "« חזרה", callback_data: "admin_open" }],
    ],
  };
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
  dedupe: { dedupe: boolean; hiddenDuplicates: number; query: string } = { dedupe: true, hiddenDuplicates: 0, query: "" },
) {
  const rows: any[][] = [];
  for (const r of results) {
    // In group: button deep-links into private chat for the movie.
    // In private: same callback fetches the movie immediately.
    if (inGroup) {
      rows.push([{ text: movieButtonText(r.title), url: `https://t.me/${botUsername}?start=m_${r.id}` }]);
    } else {
      rows.push([{ text: movieButtonText(r.title), callback_data: `get_${r.id}` }]);
    }
  }
  if (totalPages > 1) {
    const nav: any[] = [];
    if (page > 0) nav.push({ text: "⬅️ הקודם", callback_data: pageCallback(queryId, page - 1, dedupe.dedupe) });
    nav.push({ text: `${page + 1}/${totalPages}`, callback_data: "noop" });
    if (page < totalPages - 1) nav.push({ text: "הבא ➡️", callback_data: pageCallback(queryId, page + 1, dedupe.dedupe) });
    rows.push(nav);
  }
  // Duplicate filter toggle
  if (dedupe.dedupe) {
    if (dedupe.hiddenDuplicates > 0) {
      rows.push([{ text: `🔁 הצג כפילויות (+${dedupe.hiddenDuplicates})`, callback_data: `dup:${queryId}:0:${page}` }]);
    }
  } else {
    rows.push([{ text: `🧹 הפעל סינון כפילויות`, callback_data: `dup:${queryId}:1:${page}` }]);
  }
  rows.push([{ text: "❤️ תמיכה בבוט", callback_data: "support_menu" }]);
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

/** Join buttons for every required channel the user is still missing. */
export function subscribeChannelsKeyboard(
  missing: { title: string; url: string }[],
  recheckPayload: string,
) {
  const rows: any[][] = missing
    .filter((m) => m.url)
    .map((m) => [{ text: `📢 הצטרף — ${truncate(m.title, 40)}`, url: m.url }]);
  rows.push([{ text: "✅ הצטרפתי, בדוק שוב", callback_data: `check_${recheckPayload}` }]);
  return { inline_keyboard: rows };
}

export function requiredChannelsKeyboard(
  channels: { chat_id: number; title: string | null; username: string | null; kind: string; expires_at: string | null }[],
  canAddPermanent: boolean,
  canAddTemporary: boolean,
) {
  const rows: any[][] = [];
  for (const c of channels) {
    const icon = c.kind === "temporary" ? "⏳" : "📌";
    rows.push([
      { text: `❌ ${icon} ${truncate(c.title || c.username || String(c.chat_id), 40)}`, callback_data: `admin_req_rm_${c.chat_id}` },
    ]);
  }
  if (canAddPermanent) rows.push([{ text: "➕ הוסף ערוץ חובה קבוע", callback_data: "admin_req_add_perm" }]);
  if (canAddTemporary) rows.push([{ text: "⏳ הוסף ערוץ חובה זמני", callback_data: "admin_req_add_temp" }]);
  rows.push([{ text: "« חזרה", callback_data: "admin_open" }]);
  return { inline_keyboard: rows };
}

export function adminPanelKeyboard(isMain: boolean) {
  const rows: any[][] = [
    [{ text: "🎬 ניהול ערוצי סרטים", callback_data: "admin_sources" }],
  ];
  if (isMain) {
    rows.push([{ text: "🔒 ניהול ערוצי חובה", callback_data: "admin_required" }]);
  }
  rows.push([{ text: "🔎 הגדרת קבוצת חיפוש", callback_data: "admin_set_search_group" }]);
  rows.push([{ text: "🎟️ ניהול חיפושים ומחירים", callback_data: "admin_quota" }]);
  rows.push([{ text: "📊 סטטיסטיקות", callback_data: "admin_stats" }]);
  rows.push([
    { text: "🚫 מילים חסומות", callback_data: "admin_words" },
    { text: "📈 מד עומס שרת", callback_data: "admin_load" },
  ]);
  rows.push([
    { text: "👤 משתמשים", callback_data: "admin_users" },
    { text: "🚫 משתמשים חסומים", callback_data: "admin_ul:recent:0:1" },
  ]);
  rows.push([{ text: "📣 שידור לפרטיים", callback_data: "admin_bc_private" }]);
  rows.push([{ text: "📣 שידור לקבוצות", callback_data: "admin_bc_groups" }]);
  rows.push([{ text: "📣 שידור לכולם", callback_data: "admin_bc_all" }]);
  if (isMain) {
    rows.push([{ text: "👥 ניהול אדמינים", callback_data: "admin_manage" }]);
  }
  rows.push([{ text: "« סגור", callback_data: "admin_close" }]);
  return { inline_keyboard: rows };
}

export function sourceChannelsKeyboard(
  channels: { chat_id: number; username: string | null; title: string | null }[],
  canManage: boolean = true,
) {
  const rows: any[][] = [];
  if (canManage) {
    for (const c of channels) {
      const label = `❌ ${c.title || c.username || c.chat_id}`;
      rows.push([{ text: label, callback_data: `admin_src_rm_${c.chat_id}` }]);
    }
    rows.push([{ text: "➕ הוסף ערוץ נוסף", callback_data: "admin_src_add" }]);
  }
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

/** Blocked-word dictionary management. */
export function blockedWordsKeyboard(words: string[]) {
  const rows: any[][] = [];
  for (let i = 0; i < words.length; i += 2) {
    const pair = words.slice(i, i + 2).map((w) => ({
      text: `❌ ${truncate(w, 20)}`,
      callback_data: `admin_word_rm:${Buffer.from(w, "utf8").toString("base64url").slice(0, 50)}`,
    }));
    rows.push(pair);
  }
  rows.push([{ text: "➕ הוסף מילה חסומה", callback_data: "admin_word_add" }]);
  rows.push([{ text: "« חזרה", callback_data: "admin_open" }]);
  return { inline_keyboard: rows };
}

function truncate(s: string, n: number) {
  s = cleanButtonText(s);
  const chars = Array.from(s);
  return chars.length > n ? chars.slice(0, n - 1).join("") + "…" : s;
}

/**
 * Telegram may visually crop long RTL labels from the wrong side. Keep the
 * button shorter than the client width and isolate its direction so the
 * beginning of the attached caption is always the part that remains visible.
 */
export function movieButtonText(raw: string): string {
  const captionStart = cleanButtonText(raw || "ללא שם").replace(/\s+/g, " ").trim();
  const chars = Array.from(captionStart || "ללא שם");
  // Fit as many leading characters as Telegram allows on one full-width row;
  // any cropping happens at the END of the caption, never at the start.
  const MAX = 64;
  const visible = chars.length > MAX ? `${chars.slice(0, MAX - 1).join("")}…` : chars.join("");
  return `\u2067${visible}\u2069`;
}

function cleanButtonText(value: string) {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value[i] + value[i + 1];
        i++;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    out += value[i];
  }
  return out.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim() || "ללא שם";
}

function pageCallback(queryId: string, page: number, dedupe: boolean) {
  return `nav:${queryId}:${page}:${dedupe ? 1 : 0}`;
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