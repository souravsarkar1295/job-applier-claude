import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/clients";
import { atsFromUrl, countryOf, dedupKey, parseDate, scoreRole, todayIST } from "@/lib/score";
import { boardFromUrl } from "@/lib/boards";

export const maxDuration = 60;

type Snapshot = {
  jobs: { header: string[]; rows: string[][] };
  target_companies: string[][];
};

/** Imports the Google Sheet snapshot (job_board_snapshot.json). Safe to run again: rows are upserted. */
export async function POST(req: Request) {
  let snap: Snapshot;
  try { snap = await req.json(); } catch { return NextResponse.json({ error: "That file isn't valid JSON." }, { status: 400 }); }
  if (!snap?.jobs?.header || !Array.isArray(snap?.target_companies)) {
    return NextResponse.json({ error: "That doesn't look like a job board snapshot." }, { status: 400 });
  }
  const db = adminClient();
  const today = todayIST();

  // Companies
  const tc = snap.target_companies;
  const hi = tc.findIndex((r) => r?.[0] === "Company");
  const TH = tc[hi];
  const companies = tc.slice(hi + 1).filter((r) => r?.[0]).map((r) => {
    const o = Object.fromEntries(TH.map((h, i) => [h, r[i] ?? ""]));
    const careers = o["Careers URL"] || "";
    const b = boardFromUrl(careers);
    return {
      name: o["Company"].trim(), tier: o["Priority Tier"], geo: o["Primary Geography"], careers_url: careers,
      linkedin_url: o["LinkedIn URL"], relevance: o["Primary Relevance"], notes: o["Tier rationale / notes"] || "",
      ats: b ? b.ats : atsFromUrl(careers), board: b ? b.board : "", board_source: b ? "url" : "",
      active: (o["Monitor Careers?"] || "Yes") !== "No",
    };
  });
  // Keep boards found by the refresh job; only fill from the Sheet when empty.
  const { data: existingCos } = await db.from("companies").select("name, board, board_source, ats");
  const prev = new Map((existingCos || []).map((c) => [c.name.toLowerCase(), c]));
  const coRows = companies.map((c) => {
    const p = prev.get(c.name.toLowerCase());
    return p && p.board && !c.board ? { ...c, board: p.board, board_source: p.board_source, ats: p.ats } : c;
  });
  const { error: coErr } = await db.from("companies").upsert(coRows, { onConflict: "name" });
  if (coErr) return NextResponse.json({ error: "Companies: " + coErr.message }, { status: 500 });
  const { data: coIds } = await db.from("companies").select("id, name, tier");
  const coByName = new Map((coIds || []).map((c) => [c.name.toLowerCase(), c]));

  // Jobs
  const H = snap.jobs.header;
  const { data: existingJobs } = await db.from("jobs").select("external_key, verified_on, listing");
  const ej = new Map((existingJobs || []).map((j) => [j.external_key, j]));
  const rows = snap.jobs.rows.map((r, i) => {
    const o: Record<string, string> = Object.fromEntries(H.map((h, k) => [h, r[k] ?? ""]));
    const key = `sheet:${i + 6}`;
    const prevJ = ej.get(key);
    const co = coByName.get((o["Company"] || "").trim().toLowerCase());
    let verified = parseDate(o["Last Verified"]);
    let listing = o["Listing Status"] || "Unknown";
    if (prevJ?.verified_on && (!verified || prevJ.verified_on > verified)) { verified = prevJ.verified_on; listing = prevJ.listing; }
    const found = parseDate(o["Date Found"]);
    const posted = parseDate(o["Date Posted"]);
    const s = scoreRole({
      role: o["Role Name"], category: o["Category"], summary: o["Short Description"], requirements: o["Key Requirements"],
      seniority: o["Seniority"], location: o["Location"], listing, tier: co?.tier || "",
      found, posted, verified, today,
    });
    return {
      external_key: key, dedup_key: dedupKey(o["Company"], o["Role Name"], o["Location"]),
      company: o["Company"], company_id: co?.id ?? null, role: o["Role Name"], location: o["Location"],
      country: countryOf(o["Location"]), work_mode: o["Work Mode"] || "Unknown", seniority: o["Seniority"],
      category: o["Category"], summary: o["Short Description"], requirements: o["Key Requirements"], jd: o["JD"],
      fit: o["Fit / Relevance"] || "Unreviewed", why: o["Why It Matches"], source: o["Source"], link: o["Job Link"],
      ats: atsFromUrl(o["Job Link"]), posted_by: o["Posted By"], poster_role: o["Poster Role"], post_link: o["Post Link"],
      contact: o["Contact / DM Opportunity"] || "Unknown", listing, found_on: found, posted_on: posted, verified_on: verified,
      notes: o["Notes"], tier: co?.tier || "", score: s.score, score_parts: s.parts, cv: s.cv, cv_signals: s.cvSignals,
      flags: s.flags, years_required: s.years, updated_at: new Date().toISOString(),
    };
  }).filter((r) => r.role);

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("jobs").upsert(rows.slice(i, i + 200), { onConflict: "external_key" });
    if (error) return NextResponse.json({ error: "Jobs: " + error.message }, { status: 500 });
  }
  await db.from("runs").insert({ kind: "import", finished_at: new Date().toISOString(), summary: `Imported ${rows.length} roles and ${coRows.length} companies from the Sheet snapshot` });
  return NextResponse.json({ jobs: rows.length, companies: coRows.length });
}
