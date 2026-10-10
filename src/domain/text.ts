const BN = "০১২৩৪৫৬৭৮৯";

export const toAsciiDigits = (s: string): string =>
  s.replace(/[০-৯]/g, (d) => String(BN.indexOf(d)));

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const truncate = (s: string, max: number): string =>
  s.length <= max ? s : s.slice(0, max - 1) + "…";

/** Today's date (YYYY-MM-DD) in Bangladesh time (UTC+6, no DST). */
export const todayInDhaka = (now = Date.now()): string =>
  new Date(now + 6 * 3600_000).toISOString().slice(0, 10);

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const BANGLA_MONTHS: Record<string, number> = {
  "জানুয়ারি": 1, "জানুয়ারী": 1,
  "ফেব্রুয়ারি": 2, "ফেব্রুয়ারী": 2,
  "মার্চ": 3, "এপ্রিল": 4, "মে": 5, "জুন": 6, "জুলাই": 7, "আগস্ট": 8,
  "সেপ্টেম্বর": 9, "অক্টোবর": 10, "নভেম্বর": 11, "ডিসেম্বর": 12,
};

const iso = (y: number, m: number, d: number): string | null =>
  m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate() && y >= 2000 && y < 2100
    ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    : null;

/** Finds the first publication date in numeric, English-month, or Bengali-month formats. */
export function findDate(raw: string): string | null {
  const t = toAsciiDigits(raw).replace(/[\u200B-\u200D\uFEFF]/g, "");
  let m = t.match(/(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = t.match(/(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})/);
  if (m) return iso(+m[3]!, +m[2]!, +m[1]!);
  m = t.match(/(\d{1,2})(?:ই|এ)?\s+([A-Za-z]{3})[a-z]*,?\s+(\d{4})/);
  if (m) return iso(+m[3]!, MONTHS[m[2]!.toLowerCase()] ?? 0, +m[1]!);
  m = t.match(/(\d{1,2})(?:ই|এ)?\s+([\u0980-\u09FF]+),?\s+(\d{4})/);
  if (m) return iso(+m[3]!, BANGLA_MONTHS[m[2]!] ?? 0, +m[1]!);
  return null;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
