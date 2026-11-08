/**
 * Readers for public company job boards. Each returns every posting on the board;
 * filtering by title and location happens in the refresh job.
 */

export type Ats = "greenhouse" | "lever" | "ashby" | "workable" | "workday";
export type Posting = {
  id: string; title: string; location: string; url: string;
  postedOn: string | null; workMode: string; department: string; description: string;
};

export function boardFromUrl(url: string): { ats: Ats; board: string } | null {
  const u = (url || "").trim();
  let m = u.match(/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_-]+)/);
  if (m) return { ats: "greenhouse", board: m[1] };
  m = u.match(/jobs(?:\.eu)?\.lever\.co\/([A-Za-z0-9_-]+)/);
  if (m) return { ats: "lever", board: m[1] };
  m = u.match(/jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)/);
  if (m) return { ats: "ashby", board: decodeURIComponent(m[1]) };
  m = u.match(/apply\.workable\.com\/([A-Za-z0-9_-]+)/);
  if (m) return { ats: "workable", board: m[1] };
  m = u.match(/https?:\/\/(([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/);
  if (m) return { ats: "workday", board: `${m[1]}|${m[2]}|${m[3]}` };
  return null;
}

const UA = "job-board-refresh/1.0 (personal job search; contact via repo owner)";

async function getJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "user-agent": UA, accept: "application/json", ...(init?.headers || {}) }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url.split("?")[0]}`);
  return res.json();
}

export function stripHtml(html: string) {
  return (html || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/<\/(p|div|li|h\d|br)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

const d10 = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 10) : typeof v === "number" ? new Date(v).toISOString().slice(0, 10) : null);

export async function fetchBoard(ats: Ats, board: string): Promise<Posting[]> {
  if (ats === "greenhouse") {
    const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
    return (j.jobs || []).map((p: any) => ({
      id: String(p.id), title: p.title, location: p.location?.name || "", url: p.absolute_url,
      postedOn: d10(p.first_published), workMode: "Unknown",
      department: (p.departments || []).map((d: any) => d.name).join(", "), description: stripHtml(p.content || ""),
    }));
  }
  if (ats === "lever") {
    const j = await getJson(`https://api.lever.co/v0/postings/${board}?mode=json`);
    return (j || []).map((p: any) => ({
      id: p.id, title: p.text, location: [p.categories?.location, ...(p.categories?.allLocations || [])].filter(Boolean).join("; "),
      url: p.hostedUrl, postedOn: d10(p.createdAt),
      workMode: p.workplaceType === "remote" ? "Remote" : p.workplaceType === "hybrid" ? "Hybrid" : p.workplaceType === "onsite" ? "On-site" : "Unknown",
      department: p.categories?.team || "", description: p.descriptionPlain || stripHtml(p.description || ""),
    }));
  }
  if (ats === "ashby") {
    const j = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`);
    return (j.jobs || []).filter((p: any) => p.isListed !== false).map((p: any) => ({
      id: p.id, title: p.title,
      location: [p.location, ...(p.secondaryLocations || []).map((s: any) => s.location)].filter(Boolean).join("; "),
      url: p.jobUrl, postedOn: d10(p.publishedAt),
      workMode: p.workplaceType === "Remote" || p.isRemote ? "Remote" : p.workplaceType === "Hybrid" ? "Hybrid" : p.workplaceType === "OnSite" ? "On-site" : "Unknown",
      department: p.department || p.team || "", description: p.descriptionPlain || stripHtml(p.descriptionHtml || ""),
    }));
  }
  if (ats === "workable") {
    const j = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${board}`);
    return (j.jobs || []).map((p: any) => ({
      id: p.shortcode || p.id, title: p.title,
      location: [p.city, p.state, p.country].filter(Boolean).join(", ") || (p.locations || []).map((l: any) => [l.city, l.country].filter(Boolean).join(", ")).join("; "),
      url: p.url || p.application_url || `https://apply.workable.com/${board}/j/${p.shortcode}/`,
      postedOn: d10(p.published_on || p.created_at), workMode: p.telecommuting ? "Remote" : "Unknown",
      department: p.department || "", description: stripHtml(p.description || ""),
    }));
  }
  if (ats === "workday") {
    const [host, tenant, site] = board.split("|");
    const out: Posting[] = [];
    for (const q of ["product manager", "product lead"]) {
      const j = await getJson(`https://${host}/wday/cxs/${tenant}/${site}/jobs`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: q }),
      });
      for (const p of j.jobPostings || []) {
        if (out.some((o) => o.id === p.externalPath)) continue;
        out.push({
          id: p.externalPath, title: p.title, location: p.locationsText || "", url: `https://${host}/${site}${p.externalPath}`,
          postedOn: null, workMode: "Unknown", department: "", description: "",
        });
      }
    }
    return out;
  }
  return [];
}

const norm = (s: string) => (s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

/** Tries to find a company's public job board from its name. Only accepts confident matches. */
export async function detectBoard(company: string): Promise<{ ats: Ats; board: string } | null> {
  const base = company.split("/")[0].split("(")[0].trim();
  const n = norm(base);
  const words = base.toLowerCase().split(/\s+/).filter(Boolean);
  const slugs = Array.from(new Set([n, words.join("-"), words[0] + (words[1] || ""), words[0]].filter((s) => s && s.length >= 3)));
  for (const s of slugs) {
    try {
      const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${s}`);
      const name = norm(j.name || "");
      if (name && (name === n || name.startsWith(n) || n.startsWith(name))) return { ats: "greenhouse", board: s };
    } catch { /* not found */ }
  }
  // Lever and Ashby don't return a company name, so only accept the full name as the slug.
  try {
    const j = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${n}`);
    if (Array.isArray(j.jobs)) return { ats: "ashby", board: n };
  } catch { /* not found */ }
  try {
    const j = await getJson(`https://api.lever.co/v0/postings/${n}?mode=json&limit=1`);
    if (Array.isArray(j) && j.length) return { ats: "lever", board: n };
  } catch { /* not found */ }
  return null;
}
