// Thin Telegram Bot API client
const TOKEN = () => {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN missing");
  return t;
};

const API = () => `https://api.telegram.org/bot${TOKEN()}`;

export async function tg<T = any>(method: string, body?: any): Promise<T> {
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

export const getChatMemberCount = (chat_id: number | string) =>
  tg<number>("getChatMemberCount", { chat_id });

export const pinChatMessage = (chat_id: number | string, message_id: number, disable_notification = true) =>
  tg("pinChatMessage", { chat_id, message_id, disable_notification });

export const sendInvoice = (params: any) => tg("sendInvoice", params);

export const answerPreCheckoutQuery = (pre_checkout_query_id: string, ok: boolean, error_message?: string) =>
  tg("answerPreCheckoutQuery", { pre_checkout_query_id, ok, error_message });

export const setMyCommands = (commands: { command: string; description: string }[], scope?: any) =>
  tg("setMyCommands", { commands, ...(scope ? { scope } : {}) });