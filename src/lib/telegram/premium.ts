import { sendMessage } from "./api";
import { getSettings } from "./db";
import {
  expirePremium,
  markPremiumWarned,
  premiumExpiringSoon,
  premiumJustExpired,
} from "./db";

/** Days before the end of the month-long period when the heads-up is sent. */
export const PREMIUM_WARN_DAYS = 3;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Sends the "expiring soon" heads-up, and at the exact end of the period sends
 * the renewal question and turns premium off.
 */
export async function processPremiumTick() {
  const s = await getSettings().catch(() => null);
  const price = Number((s as any)?.price_premium ?? 0);
  let warned = 0;
  let expired = 0;

  for (const row of await premiumExpiringSoon(PREMIUM_WARN_DAYS).catch(() => [])) {
    const days = Math.max(1, Math.ceil((new Date(row.premium_until).getTime() - Date.now()) / 86400_000));
    await sendMessage(
      row.telegram_id,
      `⏳ <b>הפרימיום שלך עומד להסתיים</b>\n\n` +
        `💎 הפרימיום שלך בתוקף עוד <b>${days}</b> ימים (עד ${fmtDate(row.premium_until)}).\n` +
        `בסיום התקופה נשאל אותך אם תרצה לחדש.`,
    ).catch(() => {});
    await markPremiumWarned(row.telegram_id).catch(() => {});
    warned++;
  }

  for (const id of await premiumJustExpired().catch(() => [])) {
    await expirePremium(id).catch(() => {});
    await sendMessage(
      id,
      `💎 <b>הפרימיום שלך הסתיים</b>\n\nהאם תרצה לחדש את הפרימיום לחודש נוסף${price > 0 ? ` · ${price} ⭐` : ""}?`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ כן, אני רוצה לחדש", callback_data: "prem_renew_yes" }],
            [{ text: "❌ לא, תודה", callback_data: "prem_renew_no" }],
          ],
        },
      } as any,
    ).catch(() => {});
    expired++;
  }

  return { warned, expired };
}
