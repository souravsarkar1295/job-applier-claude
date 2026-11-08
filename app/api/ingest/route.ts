import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/clients";
import { ingestPostings, type IncomingPosting } from "@/lib/ingest";
import { todayIST } from "@/lib/score";

export const maxDuration = 60;

/**
 * Receives postings collected by the Chrome sweep on Sourav's Mac (job sites that block
 * cloud servers, and companies' own careers pages). Only the signed-in owner can call it;
 * the middleware enforces that.
 */
export async function POST(req: Request) {
  let body: { source?: string; postings?: IncomingPosting[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON" }, { status: 400 }); }
  const posts = (body.postings || []).filter((p) => p && p.title && p.url).slice(0, 500).map((p) => ({
    ...p, site: p.site || body.source || "Chrome sweep", id: String(p.id || p.url),
  }));
  if (!posts.length) return NextResponse.json({ added: 0, seenAgain: 0, skipped: 0 });
  const db = adminClient();
  const today = todayIST();
  const r = await ingestPostings(db, posts, today);
  await db.from("runs").insert({
    kind: "sweep", finished_at: new Date().toISOString(), new_job_ids: r.newIds, errors: r.errors,
    summary: `Chrome sweep (${body.source || "mixed"}): ${posts.length} read, ${r.newIds.length} new, ${r.seenAgain} already on the board`,
  });
  return NextResponse.json({ added: r.newIds.length, seenAgain: r.seenAgain, skipped: r.skipped, errors: r.errors.slice(0, 5) });
}

/** Companies whose careers pages the sweep should read: no job board found yet. */
export async function GET() {
  const db = adminClient();
  const [{ data }, { data: runs }] = await Promise.all([
    db.from("companies").select("name,tier,careers_url,geo").eq("active", true).eq("board", "").neq("careers_url", "").order("tier"),
    db.from("runs").select("kind,started_at,summary,new_job_ids,alerted_at").order("started_at", { ascending: false }).limit(8),
  ]);
  return NextResponse.json({ companies: data || [], recentRuns: runs || [] });
}

/** Marks runs as alerted and returns the new roles they found that haven't been alerted yet. */
export async function PATCH() {
  const db = adminClient();
  const { data: runs } = await db.from("runs").select("id,new_job_ids").is("alerted_at", null).not("finished_at", "is", null);
  const ids = Array.from(new Set((runs || []).flatMap((r) => r.new_job_ids || [])));
  const { data: jobs } = ids.length
    ? await db.from("jobs").select("company,role,score,tier,source").in("id", ids).eq("listing", "Open").order("score", { ascending: false })
    : { data: [] as { company: string; role: string; score: number; tier: string; source: string }[] };
  if (runs?.length) await db.from("runs").update({ alerted_at: new Date().toISOString() }).in("id", runs.map((r) => r.id));
  const list = jobs || [];
  const tier1 = list.filter((j) => j.tier === "Tier 1").length;
  const top = list[0];
  return NextResponse.json({
    newRoles: list.length, tier1,
    alert: list.length ? `${list.length} new PM role${list.length > 1 ? "s" : ""} · ${tier1} at Tier 1 companies · top match: ${top.company}, ${top.role}` : "",
  });
}
