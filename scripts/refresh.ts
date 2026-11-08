/**
 * Refresh job. Runs on GitHub Actions every 4 hours.
 * 1. Finds job boards for target companies that don't have one yet.
 * 2. Reads every company board, keeps PM roles in Sourav's locations, adds new ones.
 * 3. Re-verifies roles still on a board and closes roles that have disappeared.
 * 4. Re-scores every role and records the run, with an optional phone alert via ntfy.
 */
import { createClient } from "@supabase/supabase-js";
import { fetchBoard, detectBoard, boardFromUrl, type Ats, type Posting } from "../lib/boards";
import {
  CORE_COUNTRIES, TIER1_ONLY_COUNTRIES, countryOf, dedupKey, isTargetTitle, scoreRole,
  seniorityFromTitle, todayIST,
} from "../lib/score";
import { appendFileSync } from "node:fs";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL_ || !KEY) { console.error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set"); process.exit(1); }
const db = createClient(URL_, KEY, { auth: { persistSession: false } });
const TODAY = todayIST();
const FETCHABLE: Ats[] = ["greenhouse", "lever", "ashby", "workable", "workday"];
const DETECT_PER_RUN = Number(process.env.DETECT_PER_RUN || 40);

type Company = { id: number; name: string; tier: string; ats: string; board: string; board_source: string; board_checked_at: string | null; active: boolean; careers_url: string };
type Job = Record<string, any>;

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

function summarise(text: string, max = 600) {
  const t = (text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}
function requirementsFrom(text: string) {
  const lines = (text || "").split(/\n|(?<=\.)\s+/).filter((l) => /years|experience|degree|language|fluent|japanese|arabic|thai|bahasa/i.test(l));
  return summarise(lines.slice(0, 6).join(" "), 500);
}

async function main() {
  const { data: run } = await db.from("runs").insert({ kind: "refresh" }).select("id").single();
  const errors: { company: string; error: string }[] = [];

  const { data: companies, error: cErr } = await db.from("companies").select("id,name,tier,ats,board,board_source,board_checked_at,active,careers_url").eq("active", true);
  if (cErr) throw cErr;
  const cos = (companies || []) as Company[];

  // 1a. Boards readable straight from the careers URL (e.g. companies added in the dashboard)
  for (const c of cos.filter((x) => !x.board && x.careers_url)) {
    const b = boardFromUrl(c.careers_url);
    if (!b) continue;
    await db.from("companies").update({ ats: b.ats, board: b.board, board_source: "url" }).eq("id", c.id);
    Object.assign(c, { ats: b.ats, board: b.board, board_source: "url" });
  }

  // 1. Board detection for companies without one, a few per run, retried monthly.
  const stale = (d: string | null) => !d || Date.parse(TODAY) - Date.parse(d) > 30 * 864e5;
  const toDetect = cos.filter((c) => !c.board && stale(c.board_checked_at)).slice(0, DETECT_PER_RUN);
  await pool(toDetect, 4, async (c) => {
    const found = await detectBoard(c.name).catch(() => null);
    const patch: Record<string, unknown> = { board_checked_at: new Date().toISOString() };
    if (found) Object.assign(patch, { ats: found.ats, board: found.board, board_source: "auto" });
    await db.from("companies").update(patch).eq("id", c.id);
    if (found) Object.assign(c, { ats: found.ats, board: found.board, board_source: "auto" });
  });

  // Existing jobs, for matching
  const { data: existing } = await db.from("jobs").select("id,external_key,dedup_key,board_key,board_job_id,listing,company,role");
  const byBoardId = new Map<string, Job>(); const byDedup = new Map<string, Job>(); const byExt = new Map<string, Job>();
  (existing || []).forEach((j) => {
    if (j.board_key && j.board_job_id) byBoardId.set(`${j.board_key}#${j.board_job_id}`, j);
    if (j.dedup_key) byDedup.set(j.dedup_key, j);
    byExt.set(j.external_key, j);
  });

  const newIds: number[] = []; let verified = 0; let closed = 0; let checked = 0;
  const boards = cos.filter((c) => c.board && FETCHABLE.includes(c.ats as Ats));

  // 2 and 3. Read boards
  await pool(boards, 6, async (c) => {
    const boardKey = `${c.ats}:${c.board}`;
    let postings: Posting[];
    try {
      postings = await fetchBoard(c.ats as Ats, c.board);
      checked++;
      await db.from("companies").update({ last_fetched_at: new Date().toISOString(), last_fetch_error: "" }).eq("id", c.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ company: c.name, error: msg });
      await db.from("companies").update({ last_fetch_error: msg.slice(0, 300) }).eq("id", c.id);
      return;
    }
    const seen = new Set(postings.map((p) => p.id));
    const keep = postings.filter((p) => {
      if (!isTargetTitle(p.title)) return false;
      const country = countryOf(p.location);
      return CORE_COUNTRIES.includes(country) || (c.tier === "Tier 1" && TIER1_ONLY_COUNTRIES.includes(country));
    });

    for (const p of keep) {
      const ext = `${boardKey}:${p.id}`;
      const dk = dedupKey(c.name, p.title, p.location);
      const match = byBoardId.get(`${boardKey}#${p.id}`) || byExt.get(ext) || byDedup.get(dk);
      if (match) {
        await db.from("jobs").update({
          board_key: boardKey, board_job_id: p.id, listing: "Open", verified_on: TODAY, closed_on: null,
          link: p.url, ats: c.ats, ...(p.postedOn ? { posted_on: p.postedOn } : {}), updated_at: new Date().toISOString(),
        }).eq("id", match.id);
        verified++;
        continue;
      }
      const seniority = seniorityFromTitle(p.title);
      const requirements = requirementsFrom(p.description);
      const summary = summarise(p.description);
      const s = scoreRole({
        role: p.title, category: p.department, summary, requirements, seniority, location: p.location,
        listing: "Open", tier: c.tier, found: TODAY, posted: p.postedOn, verified: TODAY, today: TODAY,
      });
      const { data: ins, error } = await db.from("jobs").insert({
        external_key: ext, dedup_key: dk, board_key: boardKey, board_job_id: p.id, company: c.name, company_id: c.id,
        role: p.title, location: p.location, country: s.country, work_mode: p.workMode, seniority, category: p.department,
        summary, requirements, jd: summarise(p.description, 6000), fit: "Unreviewed", source: "Company Careers", link: p.url,
        ats: c.ats, listing: "Open", found_on: TODAY, posted_on: p.postedOn, verified_on: TODAY, tier: c.tier,
        score: s.score, score_parts: s.parts, cv: s.cv, cv_signals: s.cvSignals, flags: s.flags, years_required: s.years,
        notes: `Added by refresh job from ${c.ats} board "${c.board}"${c.board_source === "auto" ? " (board auto-detected)" : ""}.`,
      }).select("id").single();
      if (error) errors.push({ company: c.name, error: error.message });
      else { newIds.push(ins.id); byExt.set(ext, { id: ins.id }); byDedup.set(dk, { id: ins.id }); }
    }

    // Close roles from this board that are no longer listed
    const gone = (existing || []).filter((j) => j.board_key === boardKey && j.listing === "Open" && j.board_job_id && !seen.has(j.board_job_id));
    if (gone.length) {
      await db.from("jobs").update({ listing: "Closed", closed_on: TODAY, verified_on: TODAY }).in("id", gone.map((g) => g.id));
      closed += gone.length;
    }
  });

  // 4. Re-score everything (freshness and staleness change daily)
  const { data: all } = await db.from("jobs").select("id,external_key,company,role,category,summary,requirements,seniority,location,listing,tier,found_on,posted_on,verified_on");
  const updates = (all || []).map((j) => {
    const s = scoreRole({
      role: j.role, category: j.category, summary: j.summary, requirements: j.requirements, seniority: j.seniority,
      location: j.location, listing: j.listing, tier: j.tier, found: j.found_on, posted: j.posted_on, verified: j.verified_on, today: TODAY,
    });
    return { external_key: j.external_key, company: j.company, role: j.role, score: s.score, score_parts: s.parts, flags: s.flags, cv: s.cv, cv_signals: s.cvSignals, country: s.country };
  });
  for (let i = 0; i < updates.length; i += 300) {
    const { error } = await db.from("jobs").upsert(updates.slice(i, i + 300), { onConflict: "external_key" });
    if (error) errors.push({ company: "(re-score)", error: error.message });
  }

  // Summary and alert
  const { data: fresh } = newIds.length
    ? await db.from("jobs").select("company,role,score,tier").in("id", newIds).order("score", { ascending: false })
    : { data: [] as any[] };
  const tier1 = (fresh || []).filter((j) => j.tier === "Tier 1").length;
  const top = fresh?.[0];
  const summary = newIds.length
    ? `${newIds.length} new PM role${newIds.length > 1 ? "s" : ""} · ${tier1} at Tier 1 companies · top match: ${top.company}, ${top.role}`
    : "No new PM roles this run";
  await db.from("runs").update({
    finished_at: new Date().toISOString(), new_job_ids: newIds, closed_count: closed, verified_count: verified,
    companies_checked: checked, errors, summary,
  }).eq("id", run!.id);

  const report = [
    `## Refresh ${TODAY}`, summary, "",
    `Boards read: ${checked} of ${boards.length} · boards detected this run: ${toDetect.filter((c) => c.board).length} of ${toDetect.length} tried`,
    `Re-verified: ${verified} · closed: ${closed} · errors: ${errors.length}`, "",
    ...(fresh || []).slice(0, 20).map((j) => `- ${j.score} · ${j.company} · ${j.role}`),
    ...(errors.length ? ["", "Errors:", ...errors.slice(0, 20).map((e) => `- ${e.company}: ${e.error}`)] : []),
  ].join("\n");
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");

  if (newIds.length && process.env.NTFY_TOPIC) {
    await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
      method: "POST", body: summary, headers: { Title: "PM Job Board", Tags: "briefcase", ...(process.env.DASHBOARD_URL ? { Click: process.env.DASHBOARD_URL } : {}) },
    }).catch((e) => console.error("ntfy failed", e));
    await db.from("runs").update({ alerted_at: new Date().toISOString() }).eq("id", run!.id);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
