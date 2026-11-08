/**
 * Readers for public job sites. Each returns PM postings from the site's own search,
 * newest first, limited to a few pages per run.
 */
import * as cheerio from "cheerio";

export type SitePosting = {
  site: string; id: string; title: string; company: string; location: string; url: string;
  postedOn: string | null; experience: string; description: string; agency: boolean;
};

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers: { "user-agent": BROWSER_UA, "accept-language": "en-US,en;q=0.9", ...headers }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url.split("?")[0]}`);
  return res;
}

const isoDaysAgo = (n: number, today: string) => new Date(Date.parse(today) - n * 864e5).toISOString().slice(0, 10);
/** "9 days ago", "Today", "Yesterday", "3 weeks ago", "17 Oct" -> date */
export function relDate(text: string, today: string): string | null {
  const t = (text || "").toLowerCase().trim();
  if (!t) return null;
  if (/today|just now|hour|minute/.test(t)) return today;
  if (/yesterday/.test(t)) return isoDaysAgo(1, today);
  let m = t.match(/(\d+)\+?\s*day/); if (m) return isoDaysAgo(+m[1], today);
  m = t.match(/(\d+)\+?\s*week/); if (m) return isoDaysAgo(+m[1] * 7, today);
  m = t.match(/(\d+)\+?\s*month/); if (m) return isoDaysAgo(+m[1] * 30, today);
  m = t.match(/^(\d{1,2})\s+([a-z]{3})/);
  if (m) {
    const y = +today.slice(0, 4);
    let d = new Date(`${m[2]} ${m[1]} ${y} UTC`);
    if (d.getTime() > Date.parse(today) + 864e5) d = new Date(`${m[2]} ${m[1]} ${y - 1} UTC`);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}

const AGENCY = /(client of|confidential|recruit|talent|staffing|consult|hr solutions|manpower|partner network|search ltd|placement|headhunt|executive search|michael page|hays|robert walters|randstad|adecco|antal)/i;

/* ---------- Naukrigulf (JSON search API used by its own site) ---------- */
export async function naukrigulf(location: "uae" | "qatar", today: string, maxPages = 4): Promise<SitePosting[]> {
  const out: SitePosting[] = [];
  for (let page = 0; page < maxPages; page++) {
    const url = `https://www.naukrigulf.com/spapi/jobapi/search?Keywords=${encodeURIComponent("product manager")}&Limit=30&Location=${location}&Offset=${page * 30}&pageNo=${page + 1}&seo=1`;
    const j = await (await get(url, { appid: "205", systemid: "2323", "client-type": "desktop", accept: "application/json" })).json();
    const jobs = (j.Jobs || []).map((x: any) => x.Job || x);
    for (const p of jobs) {
      const company = p.Company?.Name || "";
      out.push({
        site: "Naukrigulf", id: String(p.JobId), title: p.Designation, company, location: p.Location || "",
        url: p.JdURL, postedOn: p.LatestPostedDate ? new Date(+p.LatestPostedDate * 1000).toISOString().slice(0, 10) : null,
        experience: p.Experience ? `${p.Experience.Min}-${p.Experience.Max} years` : "",
        description: [p.jobInfo, ...(p.jobHighlights || [])].filter(Boolean).join("\n"), agency: AGENCY.test(company),
      });
    }
    if (jobs.length < 30) break;
    await sleep(1200);
  }
  return out;
}

/* ---------- Bayt (server-rendered search pages) ---------- */
export async function bayt(country: "uae" | "qatar", today: string, maxPages = 3): Promise<SitePosting[]> {
  const out: SitePosting[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `https://www.bayt.com/en/${country}/jobs/product-manager-jobs/${page > 1 ? `?page=${page}` : ""}`;
    const $ = cheerio.load(await (await get(url, { accept: "text/html" })).text());
    const cards = $("li[data-js-job]");
    cards.each((_, el) => {
      const c = $(el);
      const a = c.find("h2 a").first().length ? c.find("h2 a").first() : c.find('a[href*="/jobs/"]').first();
      const href = a.attr("href") || "";
      const company = c.find("a.t-default").first().text().trim() || c.find(".jb-company").first().text().trim();
      out.push({
        site: "Bayt", id: c.attr("data-job-id") || href, title: a.text().trim(), company,
        location: c.find(".jb-label-location span").map((_, s) => $(s).text().trim()).get().filter(Boolean).join(", "),
        url: href.startsWith("http") ? href : `https://www.bayt.com${href}`,
        postedOn: relDate(c.find('[data-automation-id="job-active-date"]').text(), today),
        experience: c.find(".jb-label-careerlevel").text().replace(/\s+/g, " ").trim(),
        description: c.find(".jb-descr").text().replace(/\s+/g, " ").trim(), agency: AGENCY.test(company),
      });
    });
    if (cards.length < 20) break;
    await sleep(1500);
  }
  return out;
}

/* ---------- GulfTalent (server-rendered list) ---------- */
export async function gulftalent(country: "uae" | "qatar", today: string, maxPages = 2): Promise<SitePosting[]> {
  const out: SitePosting[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `https://www.gulftalent.com/${country}/jobs/title/product-manager${page > 1 ? `/${page}` : ""}`;
    const $ = cheerio.load(await (await get(url, { accept: "text/html" })).text());
    const rows = $("tr").filter((_, tr) => $(tr).find("a.ga-job-click").length > 0);
    rows.each((_, tr) => {
      const r = $(tr);
      const a = r.find("a.ga-job-click").first();
      const href = a.attr("href") || "";
      const company = r.find("a.text-muted").first().text().trim();
      const idm = href.match(/-(\d{5,})$/);
      out.push({
        site: "GulfTalent", id: idm ? idm[1] : href, title: a.text().trim(), company,
        location: r.find("span").first().text().trim() || country.toUpperCase(),
        url: href.startsWith("http") ? href : `https://www.gulftalent.com${href}`,
        postedOn: relDate(r.find("td.col-sm-4").last().text(), today), experience: "", description: "", agency: AGENCY.test(company),
      });
    });
    if (rows.length < 20) break;
    await sleep(1500);
  }
  return out;
}

/* ---------- foundit Gulf (JSON search endpoint used by its own site) ---------- */
export async function founditGulf(location: string, today: string, maxPages = 3): Promise<SitePosting[]> {
  const out: SitePosting[] = [];
  for (let page = 0; page < maxPages; page++) {
    const url = `https://www.founditgulf.com/middleware/jobsearch?query=${encodeURIComponent("product manager")}&locations=${encodeURIComponent(location)}&start=${page * 25}&limit=25&sort=1`;
    const j = await (await get(url, { accept: "application/json, text/plain, */*", referer: `https://www.founditgulf.com/srp/results?query=product%20manager&locations=${encodeURIComponent(location)}`, origin: "https://www.founditgulf.com", "x-requested-with": "XMLHttpRequest" })).json();
    const data = j?.jobSearchResponse?.data || [];
    for (const p of data) {
      const company = p.hideCompanyName ? "Confidential" : p.companyName || "";
      out.push({
        site: "foundit Gulf", id: String(p.jobId || p.id), title: p.title, company, location: p.locations || "",
        url: (p.seoJdUrl || p.jdUrl) ? `https://www.founditgulf.com${p.seoJdUrl || p.jdUrl}` : p.redirectUrl || p.applyUrl || "",
        postedOn: p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : null,
        experience: p.minimumExperience?.years != null ? `${p.minimumExperience.years}-${p.maximumExperience?.years ?? ""} years` : "",
        description: p.skills || "", agency: p.hideCompanyName || AGENCY.test(company),
      });
    }
    if (data.length < 20) break;
    await sleep(1200);
  }
  return out;
}

/* ---------- Weekday (Next.js pages with embedded job data) ---------- */
export async function weekday(slug: string, today: string, maxPages = 5): Promise<SitePosting[]> {
  const out: SitePosting[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `https://www.weekday.works/jobs/${slug}${page > 1 ? `-${page}` : ""}`;
    const html = await (await get(url, { accept: "text/html" })).text();
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) break;
    const pp = JSON.parse(m[1]).props?.pageProps || {};
    const jobs = pp.jobs || [];
    let old = 0;
    for (const p of jobs) {
      const posted = p.postedAt ? String(p.postedAt).slice(0, 10) : null;
      if (posted && Date.parse(today) - Date.parse(posted) > 21 * 864e5) old++;
      out.push({
        site: "Weekday", id: p.id, title: p.title, company: p.company || "", location: p.location || "", url: p.url,
        postedOn: posted, experience: p.experience || "", description: [p.snippet, p.salary ? `Salary: ${p.salary}` : ""].filter(Boolean).join("\n"),
        agency: AGENCY.test(p.company || ""),
      });
    }
    if (!jobs.length || page >= (pp.pageCount || 1) || old === jobs.length) break;
    await sleep(1200);
  }
  return out;
}

/* ---------- LinkedIn public (signed-out) job search ---------- */
export async function linkedinGuest(keywords: string, location: string, today: string, maxPages = 3): Promise<SitePosting[]> {
  const out: SitePosting[] = [];
  for (let page = 0; page < maxPages; page++) {
    const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}&f_TPR=r604800&sortBy=DD&start=${page * 10}`;
    const res = await fetch(url, { headers: { "user-agent": BROWSER_UA, accept: "text/html", "accept-language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(25000) });
    if (res.status === 400 || res.status === 404) break;
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for LinkedIn search`);
    const $ = cheerio.load(await res.text());
    const cards = $("li");
    cards.each((_, el) => {
      const c = $(el);
      const urn = c.find("[data-entity-urn]").attr("data-entity-urn") || "";
      const id = (urn.match(/(\d+)$/) || [])[1];
      const link = (c.find("a.base-card__full-link").attr("href") || c.find("a").first().attr("href") || "").split("?")[0];
      if (!id || !link) return;
      const company = c.find("h4").first().text().trim();
      out.push({
        site: "LinkedIn", id, title: c.find("h3").first().text().trim(), company,
        location: c.find(".job-search-card__location").first().text().trim(),
        url: link.replace(/^https:\/\/[a-z]{2}\.linkedin\.com/, "https://www.linkedin.com"),
        postedOn: c.find("time").attr("datetime") || null, experience: "", description: "", agency: AGENCY.test(company),
      });
    });
    if (cards.length < 10) break;
    await sleep(2500);
  }
  return out;
}

const LI_LOCATIONS = ["Bengaluru, Karnataka, India", "India", "United Arab Emirates", "Singapore", "Qatar", "London, England, United Kingdom", "Berlin, Germany", "Amsterdam, North Holland, Netherlands", "Dublin, County Dublin, Ireland"];
async function linkedinAll(today: string) {
  const out: SitePosting[] = [];
  for (const loc of LI_LOCATIONS) {
    for (const kw of ["product manager", "senior product manager"]) {
      out.push(...(await linkedinGuest(kw, loc, today, loc.startsWith("Bengaluru") || loc === "India" ? 3 : 2)));
      await sleep(2000);
    }
  }
  return out;
}

export type SiteRun = { name: string; run: (today: string) => Promise<SitePosting[]> };
export const SITES: SiteRun[] = [
  { name: "Naukrigulf UAE", run: (t) => naukrigulf("uae", t) },
  { name: "Naukrigulf Qatar", run: (t) => naukrigulf("qatar", t, 1) },
  { name: "Bayt UAE", run: (t) => bayt("uae", t) },
  { name: "Bayt Qatar", run: (t) => bayt("qatar", t, 1) },
  { name: "GulfTalent UAE", run: (t) => gulftalent("uae", t) },
  { name: "foundit Gulf UAE", run: (t) => founditGulf("united arab emirates", t) },
  { name: "Weekday Bengaluru", run: (t) => weekday("product-manager-jobs-in-bangalore", t) },
  { name: "Weekday India remote", run: (t) => weekday("product-manager-jobs-in-india-remote", t, 2) },
  { name: "LinkedIn (signed out)", run: (t) => linkedinAll(t) },
];
