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
export async function foundit(host: "www.founditgulf.com" | "www.foundit.in", site: string, location: string, today: string, maxPages = 3): Promise<SitePosting[]> {
  const out: SitePosting[] = [];
  for (let page = 0; page < maxPages; page++) {
    const url = `https://${host}/middleware/jobsearch?query=${encodeURIComponent("product manager")}&locations=${encodeURIComponent(location)}&start=${page * 25}&limit=25&sort=1`;
    const j = await (await get(url, { accept: "application/json, text/plain, */*", referer: `https://${host}/srp/results?query=product%20manager&locations=${encodeURIComponent(location)}`, origin: `https://${host}`, "x-requested-with": "XMLHttpRequest" })).json();
    const data = j?.jobSearchResponse?.data || [];
    for (const p of data) {
      const company = p.hideCompanyName ? "Confidential" : p.companyName || "";
      out.push({
        site, id: String(p.jobId || p.id), title: p.title, company, location: p.locations || "",
        url: (p.seoJdUrl || p.jdUrl) ? `https://${host}${p.seoJdUrl || p.jdUrl}` : p.redirectUrl || p.applyUrl || "",
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
export const founditGulf = (location: string, today: string) => foundit("www.founditgulf.com", "foundit Gulf", location, today);

/** MyCareersFuture, the Singapore government job portal (public search API used by its own site). */
export async function myCareersFuture(today: string, maxPages = 3): Promise<SitePosting[]> {
  const out: SitePosting[] = [];
  for (let page = 0; page < maxPages; page++) {
    const res = await fetch(`https://api.mycareersfuture.gov.sg/v2/search?limit=50&page=${page}`, {
      method: "POST", signal: AbortSignal.timeout(25000),
      headers: { "user-agent": BROWSER_UA, "content-type": "application/json", accept: "application/json", origin: "https://www.mycareersfuture.gov.sg", referer: "https://www.mycareersfuture.gov.sg/" },
      body: JSON.stringify({ search: "product manager", sortBy: ["new_posting_date"] }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for MyCareersFuture search`);
    const j = await res.json();
    const data: any[] = j?.results || [];
    for (const p of data) {
      const m = p.metadata || {};
      const hidden = !!m.isHideHiringEmployerName;
      const company = (!hidden && p.hiringCompany?.name) || p.postedCompany?.name || "";
      out.push({
        site: "MyCareersFuture", id: String(p.uuid), title: p.title, company: hidden ? "Confidential" : company,
        location: p.address?.overseasCountry ? String(p.address.overseasCountry) : "Singapore",
        url: m.jobDetailsUrl || `https://www.mycareersfuture.gov.sg/job/${p.uuid}`, postedOn: m.newPostingDate || null,
        experience: p.minimumYearsExperience != null ? `${p.minimumYearsExperience}+ years` : "",
        description: (p.skills || []).map((x: any) => x.skill).join(", "),
        agency: hidden || !!m.isPostedOnBehalf || AGENCY.test(p.postedCompany?.name || ""),
      });
    }
    if (data.length < 50) break;
    await sleep(1200);
  }
  return out;
}

/** JobStreet (SEEK Asia): Singapore, Malaysia, Indonesia. */
const JOBSTREET = { SG: ["sg.jobstreet.com", "Singapore", "en-SG"], MY: ["my.jobstreet.com", "Malaysia", "en-MY"], ID: ["id.jobstreet.com", "Indonesia", "en-ID"] } as const;
export async function jobstreet(market: keyof typeof JOBSTREET, today: string, maxPages = 3): Promise<SitePosting[]> {
  const [host, country, locale] = JOBSTREET[market];
  const out: SitePosting[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `https://${host}/api/jobsearch/v5/search?siteKey=${market}-Main&keywords=${encodeURIComponent("product manager")}&page=${page}&pageSize=30&sortmode=ListedDate&daterange=7&locale=${locale}`;
    const j = await (await get(url, { accept: "application/json", referer: `https://${host}/product-manager-jobs` })).json();
    const data: any[] = j?.data || [];
    for (const p of data) {
      const company = p.companyName || p.advertiser?.description || "";
      const label = p.locations?.[0]?.label || "";
      out.push({
        site: "JobStreet", id: String(p.id), title: p.title, company,
        location: label.toLowerCase().includes(country.toLowerCase()) ? label : [label, country].filter(Boolean).join(", "),
        url: `https://${host}/job/${p.id}`, postedOn: p.listingDate ? String(p.listingDate).slice(0, 10) : null, experience: "",
        description: [p.teaser, ...(p.bulletPoints || [])].filter(Boolean).join("\n"), agency: AGENCY.test(company),
      });
    }
    if (data.length < 30) break;
    await sleep(1500);
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


export type SiteRun = { name: string; run: (today: string) => Promise<SitePosting[]> };
export const SITES: SiteRun[] = [
  { name: "Naukrigulf UAE", run: (t) => naukrigulf("uae", t) },
  { name: "Naukrigulf Qatar", run: (t) => naukrigulf("qatar", t, 1) },
  { name: "Bayt UAE", run: (t) => bayt("uae", t) },
  { name: "Bayt Qatar", run: (t) => bayt("qatar", t, 1) },
  { name: "GulfTalent UAE", run: (t) => gulftalent("uae", t) },
  { name: "foundit Gulf UAE", run: (t) => founditGulf("united arab emirates", t) },
  { name: "foundit India Bengaluru", run: (t) => foundit("www.foundit.in", "foundit India", "bengaluru", t) },
  { name: "foundit India", run: (t) => foundit("www.foundit.in", "foundit India", "india", t, 4) },
  { name: "MyCareersFuture Singapore", run: (t) => myCareersFuture(t) },
  { name: "JobStreet Singapore", run: (t) => jobstreet("SG", t) },
  { name: "JobStreet Malaysia", run: (t) => jobstreet("MY", t, 2) },
  { name: "JobStreet Indonesia", run: (t) => jobstreet("ID", t, 2) },
  { name: "Weekday Bengaluru", run: (t) => weekday("product-manager-jobs-in-bangalore", t) },
  { name: "Weekday India remote", run: (t) => weekday("product-manager-jobs-in-india-remote", t, 2) },
];
