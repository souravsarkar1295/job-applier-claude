/**
 * Adds postings from job sites or careers pages to the board. Used by the refresh job
 * (GitHub Actions) and by /api/ingest (the Chrome sweep on Sourav's Mac).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CORE_COUNTRIES, TIER1_ONLY_COUNTRIES, countryOf, dedupKey, isTargetTitle, scoreRole, seniorityFromTitle,
} from "./score";

export type IncomingPosting = {
  site: string; id: string; title: string; company: string; location: string; url: string;
  postedOn: string | null; experience?: string; description?: string; agency?: boolean; workMode?: string;
};

const titleKey = (company: string, title: string) => `${company}|${title}`.toLowerCase().replace(/[^a-z0-9|]/g, "");
export function summarise(text: string, max = 600) {
  const t = (text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}
export function requirementsFrom(text: string) {
  const lines = (text || "").split(/\n|(?<=\.)\s+/).filter((l) => /years|experience|degree|language|fluent|japanese|arabic|thai|bahasa/i.test(l));
  return summarise(lines.slice(0, 6).join(" "), 500);
}

export async function ingestPostings(db: SupabaseClient, posts: IncomingPosting[], today: string) {
  const [{ data: jobs }, { data: cos }] = await Promise.all([
    db.from("jobs").select("id,external_key,company,role,location,dedup_key"),
    db.from("companies").select("id,name,tier"),
  ]);
  const byExt = new Map((jobs || []).map((j) => [j.external_key, j.id as number]));
  const byTitle = new Map((jobs || []).map((j) => [titleKey(j.company, j.role), j.id as number]));
  const byDedup = new Map((jobs || []).map((j) => [j.dedup_key, j.id as number]));
  const coBy = new Map((cos || []).map((c) => [c.name.toLowerCase(), c]));

  const newIds: number[] = []; const errors: string[] = [];
  let seenAgain = 0, skipped = 0;
  for (const p of posts) {
    if (!p.title || !p.url || !isTargetTitle(p.title)) { skipped++; continue; }
    const co = coBy.get((p.company || "").toLowerCase());
    const tier = co?.tier || "";
    const country = countryOf(p.location);
    if (!(CORE_COUNTRIES.includes(country) || (tier === "Tier 1" && TIER1_ONLY_COUNTRIES.includes(country)))) { skipped++; continue; }
    if (p.postedOn && Date.parse(today) - Date.parse(p.postedOn) > 45 * 864e5) { skipped++; continue; }

    const ext = `site:${p.site}:${p.id}`;
    const existing = byExt.get(ext) ?? byTitle.get(titleKey(p.company, p.title)) ?? byDedup.get(dedupKey(p.company, p.title, p.location));
    if (existing) {
      await db.from("jobs").update({ verified_on: today, listing: "Open" }).eq("id", existing);
      seenAgain++; continue;
    }
    const seniority = seniorityFromTitle(p.title);
    const description = p.description || "";
    const requirements = [p.experience ? `Experience: ${p.experience}` : "", requirementsFrom(description)].filter(Boolean).join(". ");
    const s = scoreRole({
      role: p.title, category: "", summary: summarise(description), requirements, seniority, location: p.location,
      listing: "Open", tier, found: today, posted: p.postedOn, verified: today, today,
    });
    const { data: ins, error } = await db.from("jobs").insert({
      external_key: ext, dedup_key: dedupKey(p.company, p.title, p.location), company: p.company || "Confidential",
      company_id: co?.id ?? null, role: p.title, location: p.location, country: s.country, work_mode: p.workMode || "Unknown",
      seniority, summary: summarise(description), requirements, jd: summarise(description, 6000), fit: "Unreviewed",
      source: p.site, link: p.url, ats: p.site.toLowerCase(), listing: "Open", found_on: today, posted_on: p.postedOn,
      verified_on: today, tier, score: s.score, score_parts: s.parts, cv: s.cv, cv_signals: s.cvSignals,
      flags: p.agency ? [...s.flags, "Agency post"] : s.flags, years_required: s.years,
      notes: `Found on ${p.site}${p.agency ? " via a recruiter or agency; the employer may be undisclosed" : ""}.`,
    }).select("id").single();
    if (error) { errors.push(error.message); continue; }
    newIds.push(ins.id);
    byExt.set(ext, ins.id); byTitle.set(titleKey(p.company, p.title), ins.id);
  }
  return { newIds, seenAgain, skipped, errors };
}
