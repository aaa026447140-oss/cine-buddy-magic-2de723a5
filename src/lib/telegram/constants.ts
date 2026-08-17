// Bot constants
// The main admin Telegram ID is read from the environment so it can be
// configured per deployment without changing source code. On Workers,
// env binds at request time, so this is exposed as a function.
export function getAdminId(): number {
  return Number(process.env["ADMIN_ID"] || "8548686035");
}

export const PAGE_SIZE = 10;
export const STAR_AMOUNTS = [10, 30, 50, 100, 200, 500];
export const BUILDER_USERNAME = "Hsshsusudjd";
export const INVITE_PRIVATE_BOT_URL = `https://t.me/${BUILDER_USERNAME}`;