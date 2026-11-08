"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { browserClient } from "@/lib/supabase/clients";

type Job = {
  id: number; company: string; role: string; location: string; country: string; work_mode: string; seniority: string;
  category: string; summary: string; requirements: string; why: string; fit: string; source: string; link: string;
  ats: string; post_link: string; posted_by: string; poster_role: string; contact: string; listing: string;
  found_on: string | null; posted_on: string | null; verified_on: string | null; tier: string; score: number;
  score_parts: Record<string, number>; cv: string; cv_signals: Record<string, number>; flags: string[];
  years_required: number | null; external_key: string;
};
type Status = { job_id: number; list: string | null; stage: string | null; opened_on: string | null; applied_on: string | null; cv_used: string | null; dismiss_reason: string | null };
type Company = { id: number; name: string; tier: string; geo: string; careers_url: string; relevance: string; ats: string; board: string; board_source: string; last_fetched_at: string | null; last_fetch_error: string };
type Run = { id: number; kind: string; started_at: string; finished_at: string | null; summary: string; new_job_ids: number[]; closed_count: number; companies_checked: number };

const VIEWS = [["home", "Home"], ["roles", "Roles"], ["tracker", "Tracker"], ["companies", "Companies"], ["health", "Board health"]] as const;
type View = (typeof VIEWS)[number][0];
const STAGES = ["Applied", "Screening", "Interviewing", "Offer", "Rejected", "No response"];
const REASONS = ["Too junior", "Too senior", "Location", "Domain", "Work rights", "Already applied", "Not interested"];
const JOB_COLS = "id,external_key,company,role,location,country,work_mode,seniority,category,summary,requirements,why,fit,source,link,ats,post_link,posted_by,poster_role,contact,listing,found_on,posted_on,verified_on,tier,score,score_parts,cv,cv_signals,flags,years_required";

const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
const fmtDate = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "–");
const ago = (n: number | null) => (n == null ? "never" : n <= 0 ? "today" : n === 1 ? "1 day ago" : `${n} days ago`);
function countBy<T>(arr: T[], f: (x: T) => string) {
  const m: Record<string, number> = {};
  arr.forEach((x) => { const k = f(x); m[k] = (m[k] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

function Bar({ label, n, max, cls = "" }: { label: string; n: number; max: number; cls?: string }) {
  const w = max ? Math.max(1, Math.round((Math.abs(n) / max) * 100)) : 0;
  return (
    <div className="bar"><span style={{ overflowWrap: "anywhere" }}>{label}</span>
      <div className="track"><div className={`fill ${cls}`} style={{ width: `${w}%` }} /></div>
      <span className="num" style={{ textAlign: "right" }}>{n}</span></div>
  );
}

export default function Board() {
  const supabase = useMemo(() => browserClient(), []);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [status, setStatus] = useState<Record<number, Status>>({});
  const [companies, setCompanies] = useState<Company[]>([]);
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("home");
  const [openId, setOpenId] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState("");
  const today = istToday();
  const [F, setF] = useState({ q: "", country: "All", status: "Not applied", seniority: "All", cv: "All", hideRights: false, sort: "score", limit: 60 });
  const [CF, setCF] = useState({ tier: "All", cov: "All", q: "" });

  const load = useCallback(async () => {
    const [j, s, c, r] = await Promise.all([
      supabase.from("jobs").select(JOB_COLS).order("score", { ascending: false }).limit(5000),
      supabase.from("job_status").select("*"),
      supabase.from("companies").select("id,name,tier,geo,careers_url,relevance,ats,board,board_source,last_fetched_at,last_fetch_error").order("name"),
      supabase.from("runs").select("*").eq("kind", "refresh").order("started_at", { ascending: false }).limit(1),
    ]);
    const err = j.error || s.error || c.error;
    if (err) { setError(err.message); return; }
    setJobs(j.data as Job[]);
    setStatus(Object.fromEntries((s.data as Status[]).map((x) => [x.job_id, x])));
    setCompanies(c.data as Company[]);
    setLastRun((r.data?.[0] as Run) || null);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const sync = () => { const h = location.hash.slice(1); setView((VIEWS.some((v) => v[0] === h) ? h : "home") as View); setOpenId(null); };
    sync(); window.addEventListener("hashchange", sync);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("focus", onFocus); };
  }, [load]);

  const toast = (m: string) => { setToastMsg(m); setTimeout(() => setToastMsg(""), 1800); };
  const st = (id: number): Partial<Status> => status[id] || {};
  const setSt = async (id: number, patch: Partial<Status>) => {
    const next = { ...(status[id] || { job_id: id }), ...patch, job_id: id } as Status;
    setStatus((s) => ({ ...s, [id]: next }));
    const { error: e } = await supabase.from("job_status").upsert({ ...next, updated_at: new Date().toISOString() }, { onConflict: "job_id" });
    if (e) toast("Couldn't save: " + e.message);
  };

  const isOpen = (j: Job) => j.listing === "Open";
  const isNew = (j: Job) => !!j.found_on && daysBetween(today, j.found_on) <= 1;
  const applied = (j: Job) => STAGES.includes(st(j.id).stage || "");
  const dismissed = (j: Job) => st(j.id).list === "dismissed";

  if (error) return <main className="login"><div className="panel"><h1>Couldn&apos;t load the board</h1><p className="t2">{error}</p><button className="btn" onClick={() => { setError(""); load(); }}>Try again</button></div></main>;
  if (!jobs) return <main className="login"><p className="loading">Loading your board…</p></main>;
  if (!jobs.length) return <main className="login"><div className="panel"><h1>Your board is empty</h1><p className="t2">Import your Google Sheet to start. New roles also arrive automatically from the refresh job.</p><a className="btn primary" href="/import">Import from Google Sheet</a></div></main>;

  const tracked = jobs.filter(applied);
  const counts: Record<string, number | undefined> = { roles: jobs.filter((j) => !dismissed(j) && !applied(j) && isOpen(j)).length, tracker: tracked.length, companies: companies.length };

  /* ---------- pieces ---------- */
  const keyFlag = (j: Job) => {
    const f = j.flags.find((x) => x.startsWith("Work rights")) || j.flags.find((x) => x.startsWith("Asks"));
    return f ? <span className="chip bad">{f}</span> : null;
  };
  const Action = ({ j }: { j: Job }) => {
    const s = st(j.id);
    if (applied(j)) return <span className="chip good">{s.stage === "Applied" ? `Applied ${fmtDate(s.applied_on || null)}` : s.stage}</span>;
    if (s.opened_on) return (
      <div className="ask" onClick={(e) => e.stopPropagation()}><span>Applied?</span>
        <button className="btn primary sm" onClick={() => markApplied(j)}>Yes</button>
        <button className="btn sm" onClick={() => setSt(j.id, { opened_on: null })}>Not yet</button></div>
    );
    return <a className="btn primary" href={j.link} target="_blank" rel="noopener" onClick={(e) => { e.stopPropagation(); setTimeout(() => setSt(j.id, { opened_on: today }), 300); }}>Apply</a>;
  };
  const Row = ({ j }: { j: Job }) => {
    const vAge = j.verified_on ? daysBetween(today, j.verified_on) : null;
    return (
      <div className="row" role="button" tabIndex={0} onClick={() => setOpenId(j.id)} onKeyDown={(e) => { if (e.key === "Enter") setOpenId(j.id); }}>
        <div className="score" style={{ ["--s" as string]: j.score }}><span>{j.score}</span></div>
        <div style={{ minWidth: 0 }}>
          <div className="t1">{j.role}</div>
          <div className="t2">{j.company} · {j.location}</div>
          <div className="chips">
            {j.tier && <span className="chip star">{j.tier}</span>}
            <span className="chip cv">Use {j.cv} CV</span>{keyFlag(j)}
            {j.fit === "Unreviewed" && <span className="chip">Not yet reviewed</span>}
          </div>
          <div className="meta num">{isNew(j) && <><b className="newtag">New</b> · </>}Found {fmtDate(j.found_on)} · <span className={vAge == null || vAge > 14 ? "stale" : ""}>checked {ago(vAge)}</span>{st(j.id).list === "saved" ? " · Saved" : ""}</div>
        </div>
        <div className="act"><Action j={j} /></div>
      </div>
    );
  };
  const markApplied = (j: Job) => { setSt(j.id, { list: null, opened_on: null, stage: "Applied", applied_on: today, cv_used: j.cv }); toast("Added to tracker as Applied"); setOpenId(null); };

  /* ---------- views ---------- */
  const live = jobs.filter((j) => isOpen(j) && !dismissed(j));
  const fresh = live.filter(isNew).sort((a, b) => b.score - a.score);
  const notApplied = live.filter((j) => !applied(j));

  const runLine = lastRun ? (
    <p className="runline">Last refresh <b>{new Date(lastRun.started_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</b>{lastRun.finished_at ? ` · ${lastRun.summary}` : " · running now"}</p>
  ) : <p className="runline">No refresh has run yet. Roles come from your Sheet import.</p>;

  function Home() {
    const best = notApplied.filter((j) => !isNew(j)).sort((a, b) => b.score - a.score).slice(0, 10);
    const d = new Date(today + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    const goRoles = (s: string) => { setF((f) => ({ ...f, status: s, limit: 60 })); location.hash = "roles"; };
    return (<>
      <div><h1>Home</h1><p className="sub">{d}</p>{runLine}</div>
      <div className="kpis k3">
        <button className="kpi" onClick={() => goRoles("New today")}><b>{fresh.length}</b><span>New today</span></button>
        <button className="kpi" onClick={() => goRoles("Not applied")}><b>{notApplied.length}</b><span>Not applied yet</span></button>
        <button className="kpi" onClick={() => (location.hash = "tracker")}><b>{tracked.length}</b><span>Applied</span></button>
      </div>
      <section className="section"><div className="sechead"><h2>New today</h2>{fresh.length > 10 && <a href="#roles" onClick={(e) => { e.preventDefault(); goRoles("New today"); }}>All {fresh.length}</a>}</div>
        <div className="list">{fresh.slice(0, 10).map((j) => <Row key={j.id} j={j} />)}{!fresh.length && <div className="empty"><b>No new roles yet today</b>New roles appear here after each refresh, and you get a phone alert.</div>}</div></section>
      <section className="section"><div className="sechead"><h2>Best matches you haven&apos;t applied to</h2><a href="#roles" onClick={(e) => { e.preventDefault(); goRoles("Not applied"); }}>See all</a></div>
        <div className="list">{best.map((j) => <Row key={j.id} j={j} />)}{!best.length && <div className="empty"><b>You&apos;ve applied to every strong match</b>New roles will show up here as they land.</div>}</div></section>
    </>);
  }

  function Roles() {
    const by: Record<string, (j: Job) => boolean> = {
      "New today": (j) => isNew(j) && isOpen(j), "Not applied": (j) => !applied(j) && isOpen(j),
      Saved: (j) => st(j.id).list === "saved" && !applied(j), Applied: applied, All: () => true,
    };
    let list = jobs!.filter((j) => !dismissed(j)).filter(by[F.status]);
    const q = F.q.toLowerCase();
    if (q) list = list.filter((j) => `${j.company} ${j.role} ${j.location} ${j.category}`.toLowerCase().includes(q));
    if (F.country !== "All") list = list.filter((j) => (F.country === "SE Asia & Japan" ? ["Thailand", "Malaysia", "Indonesia", "Japan"].includes(j.country) : j.country === F.country));
    if (F.seniority !== "All") list = list.filter((j) => j.seniority === F.seniority);
    if (F.cv !== "All") list = list.filter((j) => j.cv.includes(F.cv));
    if (F.hideRights) list = list.filter((j) => !j.flags.some((f) => f.startsWith("Work rights")));
    const sorters: Record<string, (a: Job, b: Job) => number> = {
      score: (a, b) => b.score - a.score, newest: (a, b) => (b.found_on || "").localeCompare(a.found_on || ""), company: (a, b) => a.company.localeCompare(b.company),
    };
    list.sort(sorters[F.sort]);
    const levels = Array.from(new Set(jobs!.map((j) => j.seniority).filter(Boolean))).sort();
    const set = (p: Partial<typeof F>) => setF((f) => ({ ...f, ...p, limit: p.limit ?? 60 }));
    return (<>
      <div><h1>Roles</h1><p className="sub">{list.length} roles</p></div>
      <div className="seg big" role="group" aria-label="Status">{["New today", "Not applied", "Saved", "Applied", "All"].map((c) => <button key={c} aria-pressed={F.status === c} onClick={() => set({ status: c })}>{c}</button>)}</div>
      <div className="filters">
        <input type="search" id="f-q" placeholder="Search company, title, city" defaultValue={F.q} aria-label="Search"
          onKeyDown={(e) => { if (e.key === "Enter") set({ q: (e.target as HTMLInputElement).value }); }}
          onBlur={(e) => set({ q: e.target.value })} />
        <div className="seg" role="group" aria-label="Country">{["All", "India", "UAE", "Singapore", "Europe", "SE Asia & Japan", "Remote"].map((c) => <button key={c} aria-pressed={F.country === c} onClick={() => set({ country: c })}>{c}</button>)}</div>
        <select id="f-level" aria-label="Level" value={F.seniority} onChange={(e) => set({ seniority: e.target.value })}><option value="All">Level: all</option>{levels.map((l) => <option key={l}>{l}</option>)}</select>
        <select id="f-cv" aria-label="CV" value={F.cv} onChange={(e) => set({ cv: e.target.value })}><option value="All">CV: all</option>{["General consumer", "AI", "Growth", "Payments"].map((l) => <option key={l}>{l}</option>)}</select>
        <select id="f-sort" aria-label="Sort" value={F.sort} onChange={(e) => set({ sort: e.target.value })}><option value="score">Best match first</option><option value="newest">Newest first</option><option value="company">Company A to Z</option></select>
        <label className="tog"><input type="checkbox" id="f-rights" checked={F.hideRights} onChange={(e) => set({ hideRights: e.target.checked })} /> Hide roles needing work rights abroad</label>
      </div>
      <div className="list">{list.slice(0, F.limit).map((j) => <Row key={j.id} j={j} />)}{!list.length && <div className="empty"><b>No roles here</b>{F.status === "Saved" ? "Open a role and choose Save for later." : "Clear a filter to see more."}</div>}</div>
      {list.length > F.limit && <button className="btn" onClick={() => setF((f) => ({ ...f, limit: f.limit + 60 }))}>Show {Math.min(60, list.length - F.limit)} more</button>}
    </>);
  }

  function Tracker() {
    return (<>
      <div><h1>Tracker</h1><p className="sub">{tracked.length ? `${tracked.length} applications` : "No applications yet"}. Change a card&apos;s stage as you hear back.</p></div>
      <div className="board">{STAGES.map((sname) => {
        const col = tracked.filter((j) => st(j.id).stage === sname);
        return (<div className="col" key={sname}><h3>{sname}<span className="num">{col.length}</span></h3>
          {col.map((j) => (
            <div className="card" key={j.id} onClick={() => setOpenId(j.id)}>
              <div className="t1" style={{ fontSize: 13 }}>{j.role}</div><div className="t2">{j.company}</div>
              <div className="t2 num">Applied {fmtDate(st(j.id).applied_on || null)} · {st(j.id).cv_used || j.cv} CV</div>
              <select aria-label="Stage" value={sname} onClick={(e) => e.stopPropagation()} onChange={(e) => { setSt(j.id, { stage: e.target.value }); toast("Moved to " + e.target.value); }}>
                {STAGES.map((x) => <option key={x}>{x}</option>)}</select>
            </div>))}
          {!col.length && <div className="t2" style={{ padding: "6px 2px" }}>{sname === "Applied" ? "Press Apply on any role, then confirm you applied." : "Empty"}</div>}
        </div>);
      })}</div>
    </>);
  }

  function Companies() {
    const rolesBy = new Map<string, number>();
    jobs!.forEach((j) => rolesBy.set(j.company.toLowerCase(), (rolesBy.get(j.company.toLowerCase()) || 0) + 1));
    const rows = companies.map((c) => {
      const roles = rolesBy.get(c.name.toLowerCase()) || 0;
      const coverage = c.board ? "Board checked automatically" : roles ? "Roles found by search" : c.careers_url ? "No roles found" : "No careers URL";
      return { ...c, roles, coverage };
    });
    const tot = rows.length || 1;
    const cov = countBy(rows, (c) => c.coverage);
    const colr: Record<string, string> = { "Board checked automatically": "var(--accent)", "Roles found by search": "var(--good)", "No roles found": "var(--warn)", "No careers URL": "var(--bad)" };
    let list = rows;
    if (CF.tier !== "All") list = list.filter((c) => c.tier === CF.tier);
    if (CF.cov !== "All") list = list.filter((c) => c.coverage === CF.cov);
    if (CF.q) list = list.filter((c) => `${c.name} ${c.geo} ${c.relevance}`.toLowerCase().includes(CF.q.toLowerCase()));
    list.sort((a, b) => a.tier.localeCompare(b.tier) || b.roles - a.roles || a.name.localeCompare(b.name));
    return (<>
      <div><h1>Companies</h1><p className="sub">{rows.length} target companies. A company with a job board found is checked every refresh.</p></div>
      <div className="panel">
        <div className="stack">{cov.map(([k, n]) => <div key={k} style={{ width: `${(n / tot) * 100}%`, background: colr[k] }} title={`${k}: ${n}`} />)}</div>
        <div className="legend">{cov.map(([k, n]) => <span key={k}><i style={{ background: colr[k] }} />{k} <b className="num">{n}</b></span>)}</div>
      </div>
      <div className="filters">
        <input type="search" id="c-q" placeholder="Search companies" defaultValue={CF.q} aria-label="Search companies" onBlur={(e) => setCF((f) => ({ ...f, q: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") setCF((f) => ({ ...f, q: (e.target as HTMLInputElement).value })); }} />
        <div className="seg" role="group" aria-label="Tier">{["All", "Tier 1", "Tier 2"].map((t) => <button key={t} aria-pressed={CF.tier === t} onClick={() => setCF((f) => ({ ...f, tier: t }))}>{t}</button>)}</div>
        <div className="seg" role="group" aria-label="Coverage">{["All", ...Object.keys(colr)].map((t) => <button key={t} aria-pressed={CF.cov === t} onClick={() => setCF((f) => ({ ...f, cov: t }))}>{t}</button>)}</div>
      </div>
      <div className="tablewrap"><table><thead><tr><th>Company</th><th>Tier</th><th>Geography</th><th>Job board</th><th>Roles</th><th>Coverage</th></tr></thead><tbody>
        {list.map((c) => (
          <tr key={c.id}><td><b>{c.name}</b>{c.careers_url && <><br /><a href={c.careers_url} target="_blank" rel="noopener">Careers page</a></>}</td>
            <td>{c.tier}</td><td>{c.geo}</td>
            <td>{c.board ? `${c.ats}${c.board_source === "auto" ? " (found automatically)" : ""}` : c.ats || "–"}{c.last_fetch_error && <div className="t2" style={{ color: "var(--bad)" }}>Last check failed</div>}</td>
            <td className="num">{c.roles}</td>
            <td><span className={`chip ${c.coverage.startsWith("Board") ? "cv" : c.coverage.startsWith("Roles") ? "good" : c.coverage === "No roles found" ? "warn" : "bad"}`}>{c.coverage}</span></td></tr>))}
      </tbody></table></div>
    </>);
  }

  function Health() {
    const n = jobs!.length;
    const stale = jobs!.filter((j) => j.flags.includes("Not re-checked 14d+")).length;
    const noPosted = jobs!.filter((j) => !j.posted_on).length;
    const unknownMode = jobs!.filter((j) => j.work_mode === "Unknown").length;
    const closed = jobs!.filter((j) => j.listing === "Closed").length;
    const dupKeys = countBy(jobs!, (j) => `${j.company}|${j.role}|${j.location}`.toLowerCase()).filter(([, c]) => c > 1).length;
    const unreviewed = jobs!.filter((j) => j.fit === "Unreviewed").length;
    const checks: [string, string, string][] = [
      ["bad", `${stale} open roles not re-checked in 14+ days`, "Roles on a company job board are re-checked every refresh. The rest came from search and need a board found for their company."],
      ["warn", `${noPosted} roles have no posting date`, "Job board roles get exact dates. Older search-found roles stay blank rather than guessed."],
      ["warn", `${unknownMode} roles have work mode 'Unknown'`, "Filled in when the posting states it."],
      ["good", `${closed} roles closed automatically`, "Removed from the job board since they were found."],
      [unreviewed ? "warn" : "good", `${unreviewed} roles waiting for a fit review`, "New roles from job boards get a score straight away and a written fit note later."],
      [dupKeys ? "warn" : "good", `${dupKeys} duplicate company, title and location keys`, "Job board roles are matched to existing rows before being added."],
    ];
    const ages = ([["0–7 days", 0, 7], ["8–14 days", 8, 14], ["15–30 days", 15, 30], ["31–45 days", 31, 45], ["45+ days", 46, 9999]] as const)
      .map(([l, a, b]) => [l, jobs!.filter((j) => { if (!j.verified_on) return false; const v = daysBetween(today, j.verified_on); return v >= a && v <= b; }).length] as [string, number]);
    const amax = Math.max(1, ...ages.map((a) => a[1]));
    const src = countBy(jobs!, (j) => j.source || "Other"); const ats = countBy(jobs!, (j) => j.ats || "none"); const ctry = countBy(jobs!, (j) => j.country || "Other");
    return (<>
      <div><h1>Board health</h1><p className="sub">Checks on {n} roles. {runLine}</p></div>
      <div className="panel">{checks.map(([lvl, t, d]) => <div className="check" key={t}><span className={`dot ${lvl}`} /><div><b>{t}</b><div className="t2">{d}</div></div><span /></div>)}</div>
      <div className="grid2">
        <div className="panel"><h2>Days since last verified</h2><div className="bars">{ages.map(([l, c], i) => <Bar key={l} label={l} n={c} max={amax} cls={i < 2 ? "good" : i < 3 ? "warn" : "bad"} />)}</div></div>
        <div className="panel"><h2>Where roles came from</h2><div className="bars">{src.map(([l, c]) => <Bar key={l} label={l} n={c} max={src[0][1]} />)}</div></div>
        <div className="panel"><h2>Job board behind the apply link</h2><div className="bars">{ats.map(([l, c]) => <Bar key={l} label={l} n={c} max={ats[0][1]} cls="star" />)}</div></div>
        <div className="panel"><h2>Country</h2><div className="bars">{ctry.map(([l, c]) => <Bar key={l} label={l} n={c} max={ctry[0][1]} />)}</div></div>
      </div>
      <p className="t2"><a href="/import">Re-import from Google Sheet</a></p>
    </>);
  }

  /* ---------- drawer ---------- */
  function Drawer() {
    const j = jobs!.find((x) => x.id === openId);
    const [detail, setDetail] = useState<{ jd: string; notes: string } | null>(null);
    const [dismissReason, setDismissReason] = useState("");
    useEffect(() => {
      if (!openId) return;
      supabase.from("jobs").select("jd,notes").eq("id", openId).single().then(({ data }) => setDetail(data as { jd: string; notes: string }));
    }, []);
    if (!j) return null;
    const s = st(j.id);
    const sig = Object.entries(j.cv_signals || {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ") || "no strong signals, so the default";
    const vAge = j.verified_on ? daysBetween(today, j.verified_on) : null;
    const close = () => setOpenId(null);
    return (<>
      <div className="scrim" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={j.role} onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
        <div className="dhead">
          <div className="score" style={{ ["--s" as string]: j.score }}><span>{j.score}</span></div>
          <div style={{ minWidth: 0 }}><h2>{j.role}</h2><div className="t2">{j.company} · {j.location}</div>
            <div className="chips">{j.tier && <span className="chip star">{j.tier}</span>}<span className="chip">{j.seniority}</span>{j.work_mode !== "Unknown" && <span className="chip">{j.work_mode}</span>}{j.fit && <span className={`chip ${j.fit === "Strong" ? "good" : ""}`}>{j.fit}</span>}{j.flags.map((f) => <span key={f} className={`chip ${/re-checked/.test(f) ? "warn" : "bad"}`}>{f}</span>)}</div></div>
          <button className="x" onClick={close} aria-label="Close" autoFocus>×</button>
        </div>
        <div className="dbody">
          <div><p className="label">Use this CV</p><p className="prose"><b>{j.cv}</b>. Signals counted: {sig}.</p></div>
          {j.post_link && <p className="prose"><a href={j.post_link} target="_blank" rel="noopener">Hiring post</a>{j.posted_by ? ` by ${j.posted_by}` : ""}</p>}
          <div><p className="label">Score breakdown</p><div className="bars">{Object.entries(j.score_parts || {}).map(([k, v]) => <Bar key={k} label={k} n={v} max={k === "Not re-checked" ? 10 : 25} cls={v < 0 ? "bad" : ""} />)}</div></div>
          <dl className="kv">
            <dt>Experience asked</dt><dd>{j.years_required ? `${j.years_required}+ years` : "Not stated"}</dd>
            <dt>Found</dt><dd className="num">{fmtDate(j.found_on)}</dd>
            <dt>Posted</dt><dd className="num">{j.posted_on ? fmtDate(j.posted_on) : "Not known"}</dd>
            <dt>Last verified</dt><dd className="num">{fmtDate(j.verified_on)} ({ago(vAge)})</dd>
            <dt>Listing</dt><dd>{j.listing}</dd>
            <dt>Source</dt><dd>{j.source} · {j.ats}</dd>
            <dt>Category</dt><dd>{j.category || "–"}</dd>
            <dt>Contact</dt><dd>{j.contact}{j.posted_by ? ` · ${j.posted_by}${j.poster_role ? ", " + j.poster_role : ""}` : ""}</dd>
          </dl>
          {j.summary && <div><p className="label">What the role owns</p><p className="prose">{j.summary}</p></div>}
          {j.requirements && <div><p className="label">Key requirements</p><p className="prose">{j.requirements}</p></div>}
          {j.why && <div><p className="label">Why it matches, and gaps</p><p className="prose">{j.why}</p></div>}
          {detail?.jd && <details><summary>Job description</summary><p className="prose" style={{ marginTop: 8 }}>{detail.jd}</p></details>}
          {detail?.notes && <details><summary>Notes</summary><p className="prose" style={{ marginTop: 8 }}>{detail.notes}</p></details>}
          {s.list === "dismissed" && <p className="t2">Not for you: {s.dismiss_reason}</p>}
        </div>
        <div className="dfoot">
          {s.stage ? <span className="chip good">In tracker: {s.stage}</span> : (<>
            <a className="btn primary" href={j.link} target="_blank" rel="noopener" onClick={() => setTimeout(() => { setSt(j.id, { opened_on: today }); close(); }, 300)}>Apply</a>
            <button className="btn" onClick={() => markApplied(j)}>I&apos;ve applied</button>
            {s.list === "saved"
              ? <button className="btn" onClick={() => { setSt(j.id, { list: null }); toast("Removed from saved"); }}>Unsave</button>
              : <button className="btn" onClick={() => { setSt(j.id, { list: "saved" }); toast("Saved for later"); }}>Save for later</button>}
            <select id="dismiss-reason" aria-label="Not for me" value={dismissReason} onChange={(e) => {
              setDismissReason(e.target.value);
              if (e.target.value) { setSt(j.id, { list: "dismissed", dismiss_reason: e.target.value }); toast("Hidden: " + e.target.value); close(); }
            }}><option value="">Not for me…</option>{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
          </>)}
        </div>
      </aside>
    </>);
  }

  const body = { home: Home, roles: Roles, tracker: Tracker, companies: Companies, health: Health }[view];
  return (
    <>
      <div className="app">
        <aside className="rail" aria-label="Sections">
          <div className="brand">PM Job Board<small>Sourav&apos;s search, one place</small></div>
          <nav className="nav">{VIEWS.map(([k, l]) => <a key={k} href={`#${k}`} aria-current={k === view ? "page" : undefined}><span>{l}</span><span className="count">{counts[k] ?? ""}</span></a>)}</nav>
          <div className="foot">{jobs.length} roles · {companies.length} companies<br /><a href="#" onClick={async (e) => { e.preventDefault(); await supabase.auth.signOut(); location.href = "/login"; }}>Sign out</a></div>
        </aside>
        <main><div className="wrap">{body()}</div></main>
      </div>
      <nav className="tabs" aria-label="Sections">{VIEWS.map(([k, l]) => <a key={k} href={`#${k}`} aria-current={k === view ? "page" : undefined}>{l}</a>)}</nav>
      {openId != null && <Drawer key={openId} />}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </>
  );
}
