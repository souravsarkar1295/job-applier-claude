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
  const { data } = await db.from("companies").select("name,tier,careers_url,geo").eq("active", true).eq("board", "").neq("careers_url", "").order("tier");
  return NextResponse.json({ companies: data || [] });
}
