/**
 * Detection of inappropriate (adult) search queries plus human-readable
 * Hebrew formatting for the escalating auto-block durations.
 */
const PATTERNS: RegExp[] = [
  /פורנ/i,
  /פורנו/i,
  /סקס/i,
  /זיון|זיונ|לזיין|מזדיינ/i,
  /עירומ|עירום|עירומה/i,
  /שרמוט|זונה|זונות/i,
  /כוס\s*של|זין|פות/i,
  /אורגזמ|אונן|אוננ/i,
  /מציצה|ביאה|אנאלי/i,
  /\bporn\b|\bporno\b|\bpornhub\b|\bxxx\b|\bxnxx\b|\bxvideos\b/i,
  /\bsex\b|\bsexy\b|\bnude\b|\bnudes\b|\bnaked\b/i,
  /\bhentai\b|\bmilf\b|\banal\b|\bblowjob\b|\bboobs\b|\bfuck\w*\b/i,
  /\berotic\b|\bcamgirl\b|\bonlyfans\b|\bnsfw\b/i,
  /\bחשפנ/i,
  /תשמישי|למבוגרים בלבד/i,
];

export function isInappropriateQuery(raw: string): boolean {
  const q = (raw || "").toLowerCase().replace(/[\u0591-\u05C7]/g, "");
  return PATTERNS.some((re) => re.test(q));
}

/**
 * Matches a query against the admin-managed blocked-word list.
 * Hebrew words match as substrings; latin words match on word boundaries.
 */
export function matchesBlockedWords(raw: string, words: string[]): boolean {
  const q = (raw || "").toLowerCase().replace(/[\u0591-\u05C7]/g, "");
  if (!q) return false;
  for (const w of words) {
    const word = (w || "").trim().toLowerCase();
    if (!word) continue;
    if (/^[a-z0-9 ]+$/.test(word)) {
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
      if (re.test(q)) return true;
    } else if (q.includes(word)) {
      return true;
    }
  }
  return false;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} דקות`;
  const hours = minutes / 60;
  if (hours < 24) return hours === 1 ? "שעה" : hours === 0.5 ? "חצי שעה" : `${hours} שעות`;
  const days = hours / 24;
  if (days === 1) return "יום אחד";
  if (days === 7) return "שבוע";
  return `${days} ימים`;
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
}
