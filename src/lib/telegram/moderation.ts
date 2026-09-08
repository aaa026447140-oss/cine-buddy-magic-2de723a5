/**
 * Detection of inappropriate (adult) search queries plus human-readable
 * Hebrew formatting for the escalating auto-block durations.
 */
const HEBREW_PATTERNS: RegExp[] = [
  /^(?:פורנ|פורנו)$/i,
  /^(?:סקס)$/i,
  /^(?:זיון|זיונים|לזיין|מזדיין|מזדיינת|מזדיינים)$/i,
  /^(?:עירום|עירומה|עירומים|עירומות)$/i,
  /^(?:שרמוטה|שרמוטות|זונה|זונות)$/i,
  /^(?:כוס|זין|פות)$/i,
  /^(?:אורגזמה|אורגזמות|אונן|אוננות)$/i,
  /^(?:מציצה|מציצות|ביאה|אנאלי)$/i,
  /^(?:חשפן|חשפנית|חשפנים|חשפניות)$/i,
];

const LATIN_PATTERNS: RegExp[] = [
  /\bporn\b|\bporno\b|\bpornhub\b|\bxxx\b|\bxnxx\b|\bxvideos\b/i,
  /\bsex\b|\bsexy\b|\bnude\b|\bnudes\b|\bnaked\b/i,
  /\bhentai\b|\bmilf\b|\banal\b|\bblowjob\b|\bboobs\b|\bfuck\w*\b/i,
  /\berotic\b|\bcamgirl\b|\bonlyfans\b|\bnsfw\b/i,
];

const HEBREW_PHRASES = ["כוס של", "תשמישי מין", "למבוגרים בלבד"];

function normalizedTokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[\u0591-\u05C7]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function isInappropriateQuery(raw: string): boolean {
  const q = (raw || "").toLowerCase().replace(/[\u0591-\u05C7]/g, "");
  if (!q) return false;
  if (HEBREW_PHRASES.some((phrase) => q.includes(phrase))) return true;
  if (LATIN_PATTERNS.some((re) => re.test(q))) return true;
  return normalizedTokens(q).some((token) => HEBREW_PATTERNS.some((re) => re.test(token)));
}

/**
 * Matches a query against the admin-managed blocked-word list.
 * Admin-managed words match complete normalized words. This prevents a short
 * blocked sequence (for example "פורנ") from blocking an unrelated movie
 * title that merely contains those letters (for example "קליפורניקיישן").
 */
export function matchesBlockedWords(raw: string, words: string[]): boolean {
  const q = (raw || "").toLowerCase().replace(/[\u0591-\u05C7]/g, "");
  if (!q) return false;
  for (const w of words) {
    const word = (w || "").trim().toLowerCase();
    if (!word) continue;
    const normalizedWord = word.replace(/[\u0591-\u05C7]/g, "");
    if (normalizedWord.includes(" ")) {
      const phrase = normalizedWord.split(/\s+/).filter(Boolean).join(" ");
      const normalizedQuery = normalizedTokens(q).join(" ");
      if (normalizedQuery.split(" ").join(" ").includes(phrase)) return true;
      continue;
    }
    if (normalizedTokens(q).includes(normalizedWord)) return true;
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
