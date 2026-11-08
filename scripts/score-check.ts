/** Scores a Sheet snapshot with lib/score.ts and prints a summary. Usage: npm run test:score -- <snapshot.json> [prototype data.json] */
import { readFileSync } from "node:fs";
import { scoreRole, parseDate, isTargetTitle, countryOf, seniorityFromTitle } from "../lib/score";
import { boardFromUrl } from "../lib/boards";

const snap = JSON.parse(readFileSync(process.argv[2], "utf8"));
const proto = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")) : null;
const H: string[] = snap.jobs.header;
const today = "2026-11-08";
let same = 0, diff = 0; const buckets: Record<number, number> = {}; const ctry: Record<string, number> = {};
snap.jobs.rows.forEach((r: string[], i: number) => {
  const o: Record<string, string> = Object.fromEntries(H.map((h, k) => [h, r[k] ?? ""]));
  const s = scoreRole({ role: o["Role Name"], category: o["Category"], summary: o["Short Description"], requirements: o["Key Requirements"], seniority: o["Seniority"], location: o["Location"], listing: o["Listing Status"], tier: "", found: parseDate(o["Date Found"]), posted: parseDate(o["Date Posted"]), verified: parseDate(o["Last Verified"]), today });
  buckets[Math.floor(s.score / 10) * 10] = (buckets[Math.floor(s.score / 10) * 10] || 0) + 1;
  ctry[s.country] = (ctry[s.country] || 0) + 1;
  if (proto) { const p = proto.jobs[i]; const pt = p.score - (p.parts["Target company"] || 0); if (Math.abs(pt - s.score) <= 2) same++; else diff++; }
});
console.log("buckets", buckets); console.log("countries", ctry);
if (proto) console.log("matches prototype (excluding tier bonus, ±2):", same, "differ:", diff);
const titles = ["Senior Product Manager, Payments", "Product Marketing Manager", "Associate Product Manager", "Lead Product Manager - Growth", "Technical Product Manager", "Senior Manager, Product", "Product Owner", "Principal Product Manager"];
console.log(titles.map((t) => `${t}: ${isTargetTitle(t) ? "keep" : "skip"} (${seniorityFromTitle(t)})`).join("\n"));
console.log(["Bengaluru, Karnataka, India", "Dubai - United Arab Emirates", "London, UK", "Remote - EMEA", "Bangkok", "San Francisco, CA"].map((l) => `${l} -> ${countryOf(l)}`).join("\n"));
console.log(["https://job-boards.greenhouse.io/agoda", "https://jobs.lever.co/atlys", "https://jobs.ashbyhq.com/deel", "https://apply.workable.com/mercari/", "https://wise.wd1.myworkdayjobs.com/en-US/External"].map((u) => JSON.stringify(boardFromUrl(u))).join("\n"));
