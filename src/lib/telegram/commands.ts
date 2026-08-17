import { tg, setMyCommands } from "./api";
import { getAdminId } from "./constants";

/** Commands every user sees in the blue "/" menu (private + groups). */
const PUBLIC_COMMANDS = [
  { command: "start", description: "🎬 תפריט הבוט" },
  { command: "premium", description: "💎 רכישת פרימיום לחודש" },
  { command: "year", description: "🏆 רכישת פרימיום לשנה" },
  { command: "forever", description: "♾️ רכישת פרימיום לנצח" },
  { command: "search", description: "⚡ רכישת חיפוש נוסף חד־פעמי" },
  { command: "daily", description: "📅 רכישת +1 חיפוש בכל יום" },
];

/** The admin panel command is visible only in the main admin's private chat. */
const ADMIN_COMMANDS = [
  ...PUBLIC_COMMANDS,
  { command: "admin", description: "⚙️ לוח אדמין" },
];

let synced = false;

export async function syncBotCommands(force = false) {
  if (synced && !force) return;
  synced = true;
  try {
    await setMyCommands(PUBLIC_COMMANDS, { type: "default" });
    await setMyCommands(PUBLIC_COMMANDS, { type: "all_private_chats" });
    await setMyCommands(PUBLIC_COMMANDS, { type: "all_group_chats" });
    // Group admins get their own scope in Telegram — keep it clean too.
    await setMyCommands(PUBLIC_COMMANDS, { type: "all_chat_administrators" });
    await setMyCommands(ADMIN_COMMANDS, { type: "chat", chat_id: getAdminId() });
  } catch (e: any) {
    synced = false;
    console.error("setMyCommands failed:", e?.description || e?.message || e);
  }
}

/** "/premium@MyBot arg" → "premium" (empty string when not a command). */
export function parseCommand(text: string): string {
  const first = text.trim().split(/\s+/)[0] || "";
  if (!first.startsWith("/")) return "";
  return first.slice(1).split("@")[0].toLowerCase();
}

export const deleteMessageSafe = (chat_id: number, message_id: number) =>
  tg("deleteMessage", { chat_id, message_id }).catch(() => {});
