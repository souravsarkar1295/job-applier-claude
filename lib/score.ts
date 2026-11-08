/**
 * Scoring, CV suggestion, flags and location parsing. Shared by the import route
 * and the refresh job so every role is scored the same way.
 */

export type Country =
  | "India" | "UAE" | "Singapore" | "Qatar" | "Europe"
  | "Thailand" | "Malaysia" | "Indonesia" | "Japan" | "Remote" | "Other";

export const CORE_COUNTRIES: Country[] = ["India", "UAE", "Singapore", "Qatar", "Europe", "Remote"];
/** Allowed only for Tier 1 companies (Search Configuration rows 62 to 65). */
export const TIER1_ONLY_COUNTRIES: Country[] = ["Thailand", "Malaysia", "Indonesia", "Japan"];

const EUROPE = [
  "europe", "uk", "united kingdom", "england", "london", "manchester", "edinburgh", "ireland", "dublin",
  "germany", "berlin", "munich", "hamburg", "frankfurt", "cologne", "netherlands", "amsterdam", "rotterdam",
  "france", "paris", "spain", "madrid", "barcelona", "portugal", "lisbon", "porto", "italy", "milan", "rome",
  "sweden", "stockholm", "denmark", "copenhagen", "norway", "oslo", "finland", "helsinki", "estonia", "tallinn",
  "poland", "warsaw", "krakow", "czech", "prague", "austria", "vienna", "switzerland", "zurich", "geneva",
  "belgium", "brussels", "luxembourg", "greece", "athens", "romania", "bucharest", "hungary", "budapest",
  "lithuania", "vilnius", "latvia", "riga", "emea",
];

function has(text: string, words: string[]) {
  return words.some((w) => new RegExp(`(^|[^a-z])${w.replace(/ /g, "\\s+")}([^a-z]|$)`).test(text));
}

export function countryOf(location: string): Country {
  const l = (location || "").toLowerCase();
  if (has(l, ["india", "bengaluru", "bangalore", "gurgaon", "gurugram", "mumbai", "pune", "hyderabad", "delhi", "new delhi", "noida", "chennai", "kolkata", "ahmedabad"])) return "India";
  if (has(l, ["dubai", "uae", "abu dhabi", "united arab emirates", "sharjah"])) return "UAE";
  if (has(l, ["singapore"])) return "Singapore";
  if (has(l, ["doha", "qatar"])) return "Qatar";
  if (has(l, ["bangkok", "thailand"])) return "Thailand";
  if (has(l, ["kuala lumpur", "malaysia", "petaling jaya", "selangor"])) return "Malaysia";
  if (has(l, ["jakarta", "indonesia"])) return "Indonesia";
  if (has(l, ["tokyo", "japan"])) return "Japan";
  if (has(l, EUROPE)) return "Europe";
  if (/remote|anywhere|worldwide|global/.test(l)) return "Remote";
  return "Other";
}

export function atsFromUrl(url: string): string {
  const u = (url || "").toLowerCase();
  if (u.includes("greenhouse")) return "greenhouse";
  if (u.includes("lever.co")) return "lever";
  if (u.includes("ashbyhq")) return "ashby";
  if (u.includes("myworkdayjobs") || u.includes("workday")) return "workday";
  if (u.includes("workable")) return "workable";
  if (u.includes("smartrecruiters")) return "smartrecruiters";
  if (u.includes("linkedin")) return "linkedin";
  if (u.includes("amazon.jobs")) return "amazon";
  return u ? "careers site" : "none";
}

const SIG: Record<"AI" | "Payments" | "Growth", string[]> = {
  AI: ["ai", "ml", "llm", "genai", "generative", "agentic", "agent", "machine learning", "model"],
  Payments: ["payment", "payments", "upi", "checkout", "gateway", "card", "cards", "wallet", "acquiring", "issuing", "remittance", "billing"],
  Growth: ["growth", "retention", "conversion", "acquisition", "engagement", "activation", "funnel", "experiment", "monetisation", "monetization", "lifecycle"],
};
const DOMAIN_WORDS = [...SIG.AI, ...SIG.Payments, ...SIG.Growth, "consumer", "marketplace", "fintech", "travel", "commerce", "e-commerce", "fulfilment", "subscription"];

function count(text: string, words: string[]) {
  const t = " " + (text || "").toLowerCase().replace(/[^a-z0-9/ ]/g, " ") + " ";
  return words.reduce((n, w) => n + (t.split(" " + w + " ").length - 1), 0);
}

export function suggestCv(role: string, category: string, summary: string, requirements: string) {
  const scores: Record<string, number> = {};
  (Object.keys(SIG) as (keyof typeof SIG)[]).forEach((cv) => {
    scores[cv] = 4 * count(role, SIG[cv]) + count(category, SIG[cv]) + count(summary + " " + requirements, SIG[cv]);
  });
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [[c1, s1], [c2, s2]] = ranked;
  if (s1 < 4) return { cv: "General consumer", options: [] as string[], signals: scores };
  if (s2 >= 4 && s1 - s2 <= 1) return { cv: `${c1} or ${c2}`, options: [c1, c2], signals: scores };
  return { cv: c1, options: [c1], signals: scores };
}

export function yearsRequired(text: string): number | null {
  const re = /(\d{1,2})\s*\+?\s*(?:-|to|–)?\s*\d{0,2}\s*\+?\s*years/g;
  const nums: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec((text || "").toLowerCase()))) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 20) nums.push(n);
  }
  return nums.length ? Math.min(...nums) : null;
}

export function seniorityFromTitle(title: string): string {
  const t = (title || "").toLowerCase();
  if (/\b(head|director|vp|vice president)\b/.test(t)) return "Head / Director";
  if (/\b(principal|staff)\b/.test(t)) return "Principal PM";
  if (/\bgroup\b/.test(t)) return "Group PM";
  if (/\blead\b/.test(t)) return "Lead PM";
  if (/\b(senior|sr\.?)\b/.test(t)) return "Senior PM";
  return "PM";
}

/** True when a title is a PM role at Sourav's level. */
export function isTargetTitle(title: string): boolean {
  const t = (title || "").toLowerCase();
  if (!/(product manager|product lead|manager,? product|product management lead|head of product)/.test(t)) return false;
  if (/(marketing|associate|assistant|intern|junior|graduate|apm\b|project manager|program manager|programme manager|owner|analyst|designer|engineer)/.test(t)) return false;
  return true;
}

const SENIORITY: Record<string, number> = {
  "Senior PM": 25, "Lead PM": 22, "PM": 20, "Principal PM": 13, "Senior / Principal PM": 16,
  "Staff PM": 13, "Group PM": 11, "Product Lead": 16, "Head / Director": 8,
};
const LOC: Record<string, number> = { India: 20, Remote: 12, Singapore: 10, UAE: 10, Qatar: 8, Europe: 6, Thailand: 7, Malaysia: 7, Indonesia: 7, Japan: 6, Other: 4 };

export type ScoreInput = {
  role: string; category: string; summary: string; requirements: string; seniority: string;
  location: string; listing: string; tier: string;
  found: string | null; posted: string | null; verified: string | null; today: string;
};

const days = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

export function scoreRole(r: ScoreInput) {
  const country = countryOf(r.location);
  const cv = suggestCv(r.role, r.category, r.summary, r.requirements);
  const years = yearsRequired(r.requirements);
  const ref = r.posted || r.found;
  const age = ref ? days(r.today, ref) : null;
  const verifiedAge = r.verified ? days(r.today, r.verified) : null;

  const parts: Record<string, number> = {};
  parts["Seniority"] = SENIORITY[r.seniority] ?? 10;
  parts["Domain"] = Math.min(25, count(r.category + " " + r.summary, DOMAIN_WORDS) * 3);
  parts["Location"] = LOC[country] ?? 6;
  parts["Experience"] = years == null ? 8 : years <= 6 ? 15 : years <= 8 ? 10 : years <= 10 ? 4 : 0;
  parts["Freshness"] = age == null ? 0 : age <= 7 ? 10 : age <= 14 ? 6 : age <= 30 ? 3 : 0;
  parts["Target company"] = r.tier === "Tier 1" ? 5 : r.tier === "Tier 2" ? 3 : 0;
  const stale = r.listing === "Open" && (verifiedAge == null || verifiedAge > 14);
  if (stale) parts["Not re-checked"] = -10;
  const score = Math.max(0, Object.values(parts).reduce((a, b) => a + b, 0));

  const flags: string[] = [];
  if (!["India", "Remote"].includes(country)) flags.push(`Work rights: ${country === "Other" ? "abroad" : country}`);
  if (years && years > 8) flags.push(`Asks ${years}+ yrs`);
  if (stale) flags.push("Not re-checked 14d+");

  return { score, parts, flags, country, cv: cv.cv, cvOptions: cv.options, cvSignals: cv.signals, years };
}

export function dedupKey(company: string, role: string, location: string) {
  const n = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  return `${n(company)}|${n(role)}|${n(location)}`;
}

export function parseDate(v: string | null | undefined): string | null {
  const s = (v || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})$/);
  if (m) {
    const d = new Date(`${m[2]} ${m[1]} ${m[3]} UTC`);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
}
