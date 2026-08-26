// Thin Telegram Bot API client
const TOKEN = () => {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN missing");
  return t;
};

const API = () => `https://api.telegram.org/bot${TOKEN()}`;

/**
 * Colored inline buttons (Bot API 10.3+).
 * InlineKeyboardButton.style must be one of "danger" | "success" | "primary".
 */
export const ButtonStyle = {
  DANGER: "danger",
  SUCCESS: "success",
  PRIMARY: "primary",
} as const;
export type ButtonStyleValue = (typeof ButtonStyle)[keyof typeof ButtonStyle];

const DANGER_RE = /(^❌|🔴|🚫|✖️|מחק|הסר|חסום|לחסום|דחה|דחייה|ביטול|בטל|סגור|נעילה|נעול)/;
const SUCCESS_RE = /(^✅|🟢|⭐|💎|🏆|♾️|➕|🎁|אישור|אשר|שלם|קנה|רכישה|פרימיום|הפעל|שחרר|פתח חסימה)/;
const PRIMARY_RE = /(^«|^»|⬅️|➡️|📢|🔎|🔍|📊|📈|⚙️|🧵|📋|🎬|👥|👤|📣|📮|🎟️|🔗|❤️)/;

/** Pick a color for a button that did not declare one explicitly. */
function autoStyle(btn: any): ButtonStyleValue | undefined {
  const text = String(btn?.text ?? "");
  if (DANGER_RE.test(text)) return ButtonStyle.DANGER;
  if (SUCCESS_RE.test(text)) return ButtonStyle.SUCCESS;
  if (PRIMARY_RE.test(text) || btn?.url) return ButtonStyle.PRIMARY;
  return undefined;
}

/** Apply colors to every inline button of an outgoing payload. */
function styleMarkup(body: any) {
  const rows = body?.reply_markup?.inline_keyboard;
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const btn of row) {
      if (!btn || typeof btn !== "object" || btn.style) continue;
      const s = autoStyle(btn);
      if (s) btn.style = s;
    }
  }
}

export async function tg<T = any>(method: string, body?: any): Promise<T> {
  if (body) styleMarkup(body);
  const res = await fetch(`${API()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: any = await res.json();
  if (!json.ok) {
    // Caller decides whether to swallow
    const err: any = new Error(`tg.${method}: ${json.description}`);
    err.code = json.error_code;
    err.description = json.description;
    err.parameters = json.parameters;
    throw err;
  }
  return json.result as T;
}


// Convenience wrappers
export const sendMessage = (chat_id: number | string, text: string, opts: any = {}) =>
  tg("sendMessage", { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...opts });

export const editMessageText = (chat_id: number | string, message_id: number, text: string, opts: any = {}) =>
  tg("editMessageText", { chat_id, message_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...opts });

export const answerCallbackQuery = (callback_query_id: string, opts: any = {}) =>
  tg("answerCallbackQuery", { callback_query_id, ...opts });

export const copyMessage = (chat_id: number | string, from_chat_id: number | string, message_id: number, opts: any = {}) =>
  tg("copyMessage", { chat_id, from_chat_id, message_id, ...opts });

export const getChatMember = (chat_id: number | string, user_id: number) =>
  tg("getChatMember", { chat_id, user_id });

export const getChat = (chat_id: number | string) => tg("getChat", { chat_id });

export const createForumTopic = (chat_id: number | string, name: string, opts: any = {}) =>
  tg<{ message_thread_id: number }>("createForumTopic", { chat_id, name, ...opts });

export const deleteForumTopic = (chat_id: number | string, message_thread_id: number) =>
  tg("deleteForumTopic", { chat_id, message_thread_id });

export const getChatMemberCount = (chat_id: number | string) =>
  tg<number>("getChatMemberCount", { chat_id });

export const pinChatMessage = (chat_id: number | string, message_id: number, disable_notification = true) =>
  tg("pinChatMessage", { chat_id, message_id, disable_notification });

export const sendInvoice = (params: any) => tg("sendInvoice", params);

export const answerPreCheckoutQuery = (pre_checkout_query_id: string, ok: boolean, error_message?: string) =>
  tg("answerPreCheckoutQuery", { pre_checkout_query_id, ok, error_message });

export const setMyCommands = (commands: { command: string; description: string }[], scope?: any) =>
  tg("setMyCommands", { commands, ...(scope ? { scope } : {}) });