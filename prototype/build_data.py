"""Turn the Sheet snapshot into the prototype's data: normalised dates, score,
CV suggestion, work-rights flag, ATS, liveness, company coverage."""
import json, re, sys
from datetime import date, datetime

SNAP = sys.argv[1]
OUT = sys.argv[2]
TODAY = date(2026, 11, 8)

s = json.load(open(SNAP))
H = s["jobs"]["header"]
rows = [dict(zip(H, r)) for r in s["jobs"]["rows"]]


def pdate(v):
    v = (v or "").strip()
    for fmt in ("%Y-%m-%d", "%d-%b-%Y", "%d %b %Y", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            pass
    return None


def fmt_kind(v):
    v = (v or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        return "iso"
    return "text" if v else "blank"


def country(loc):
    l = (loc or "").lower()
    if re.search(r"remote", l) and not re.search(r"india|bengaluru|bangalore", l):
        return "Remote"
    if re.search(r"india|bengaluru|bangalore|gurgaon|gurugram|mumbai|pune|hyderabad|delhi|noida|chennai", l):
        return "India"
    if re.search(r"dubai|uae|abu dhabi|emirates", l):
        return "UAE"
    if re.search(r"singapore", l):
        return "Singapore"
    if re.search(r"doha|qatar", l):
        return "Qatar"
    return "Europe"


def ats(url):
    u = (url or "").lower()
    for k in ("greenhouse", "lever", "ashby", "myworkday", "smartrecruiters", "workable", "linkedin", "amazon.jobs"):
        if k in u:
            return {"myworkday": "workday", "amazon.jobs": "amazon"}.get(k, k)
    return "careers site" if u else "none"


SIG = {
    "AI": ["ai", "ml", "llm", "genai", "generative", "agentic", "agent", "machine learning", "model"],
    "Payments": ["payment", "payments", "upi", "checkout", "gateway", "card", "cards", "wallet", "acquiring", "issuing", "remittance", "billing"],
    "Growth": ["growth", "retention", "conversion", "acquisition", "engagement", "activation", "funnel", "experiment", "monetisation", "monetization", "lifecycle"],
}


def count(text, words):
    t = " " + re.sub(r"[^a-z0-9/ ]", " ", text.lower()) + " "
    return sum(t.count(" " + w + " ") for w in words)


def suggest_cv(r):
    scores = {}
    for cv, words in SIG.items():
        scores[cv] = 4 * count(r["Role Name"], words) + count(r["Category"], words) + count(r["Short Description"] + " " + r["Key Requirements"], words)
    ranked = sorted(scores.items(), key=lambda x: -x[1])
    (c1, s1), (c2, s2) = ranked[0], ranked[1]
    if s1 < 4:
        return "General consumer", [], scores
    if s2 >= 4 and s1 - s2 <= 1:
        return f"{c1} or {c2}", [c1, c2], scores
    return c1, [c1], scores


def years_required(text):
    nums = [int(n) for n in re.findall(r"(\d{1,2})\s*\+?\s*(?:-|to|–)?\s*\d{0,2}\s*\+?\s*years", text.lower())]
    nums = [n for n in nums if 1 <= n <= 20]
    return min(nums) if nums else None


SENIORITY = {"Senior PM": 25, "Lead PM": 22, "PM": 20, "Principal PM": 13, "Senior / Principal PM": 16, "Staff PM": 13, "Group PM": 11, "Product Lead": 16, "Head / Director": 8}
LOC = {"India": 20, "Remote": 12, "Singapore": 10, "UAE": 10, "Qatar": 8, "Europe": 6}
DOMAIN_WORDS = SIG["AI"] + SIG["Payments"] + SIG["Growth"] + ["consumer", "marketplace", "fintech", "travel", "commerce", "e-commerce", "fulfilment", "subscription"]

# Target companies
tc_rows = s["target_companies"]
hdr_i = next(i for i, r in enumerate(tc_rows) if r and r[0] == "Company")
TH = tc_rows[hdr_i]
targets = [dict(zip(TH, r)) for r in tc_rows[hdr_i + 1:] if r and r[0]]
tier_of = {t["Company"].strip().lower(): t["Priority Tier"] for t in targets}

jobs = []
for i, r in enumerate(rows):
    found, posted, verified = pdate(r["Date Found"]), pdate(r["Date Posted"]), pdate(r["Last Verified"])
    ctry = country(r["Location"])
    cv, cv_opts, cv_sig = suggest_cv(r)
    yrs = years_required(r["Key Requirements"])
    tier = tier_of.get(r["Company"].strip().lower(), "")
    ref = posted or found
    age = (TODAY - ref).days if ref else None
    ver_age = (TODAY - verified).days if verified else None

    parts = {}
    parts["Seniority"] = SENIORITY.get(r["Seniority"], 10)
    dom = count(r["Category"] + " " + r["Short Description"], DOMAIN_WORDS)
    parts["Domain"] = min(25, dom * 3)
    parts["Location"] = LOC.get(ctry, 6)
    if yrs is None:
        parts["Experience"] = 8
    elif yrs <= 6:
        parts["Experience"] = 15
    elif yrs <= 8:
        parts["Experience"] = 10
    elif yrs <= 10:
        parts["Experience"] = 4
    else:
        parts["Experience"] = 0
    parts["Freshness"] = 0 if age is None else (10 if age <= 7 else 6 if age <= 14 else 3 if age <= 30 else 0)
    parts["Target company"] = 5 if tier == "Tier 1" else 3 if tier == "Tier 2" else 0
    if r["Listing Status"] == "Open" and (ver_age is None or ver_age > 14):
        parts["Not re-checked"] = -10
    score = max(0, sum(parts.values()))

    flags = []
    if ctry not in ("India", "Remote"):
        flags.append(f"Work rights: {ctry}")
    if yrs and yrs > 8:
        flags.append(f"Asks {yrs}+ yrs")
    if r["Listing Status"] == "Open" and (ver_age is None or ver_age > 14):
        flags.append("Not re-checked 14d+")
    if fmt_kind(r["Date Found"]) == "text":
        flags.append("Date stored as text")

    jobs.append({
        "id": i + 6,
        "company": r["Company"], "role": r["Role Name"], "location": r["Location"], "country": ctry,
        "mode": r["Work Mode"] or "Unknown", "seniority": r["Seniority"], "category": r["Category"],
        "summary": r["Short Description"], "requirements": r["Key Requirements"], "jd": r["JD"],
        "fit": r["Fit / Relevance"], "why": r["Why It Matches"], "source": r["Source"], "link": r["Job Link"],
        "ats": ats(r["Job Link"]), "postedBy": r["Posted By"], "posterRole": r["Poster Role"], "postLink": r["Post Link"],
        "contact": r["Contact / DM Opportunity"], "status": r["Application Status"], "nextAction": r["Next Action"],
        "listing": r["Listing Status"], "notes": r["Notes"],
        "found": found.isoformat() if found else None, "posted": posted.isoformat() if posted else None,
        "verified": verified.isoformat() if verified else None, "verifiedAge": ver_age, "age": age,
        "tier": tier, "cv": cv, "cvOptions": cv_opts, "cvSignals": cv_sig, "years": yrs,
        "score": score, "parts": parts, "flags": flags,
    })

roles_by_co = {}
for j in jobs:
    roles_by_co.setdefault(j["company"].strip().lower(), []).append(j["id"])

companies = []
for t in targets:
    k = t["Company"].strip().lower()
    url = t.get("Careers URL", "")
    n = len(roles_by_co.get(k, []))
    companies.append({
        "name": t["Company"], "tier": t["Priority Tier"], "geo": t["Primary Geography"], "careers": url,
        "linkedin": t.get("LinkedIn URL", ""), "relevance": t.get("Primary Relevance", ""),
        "notes": t.get("Tier rationale / notes", ""), "ats": ats(url), "roles": n,
        "coverage": "Roles found" if n else ("No careers URL" if not url else "No roles found"),
    })

config = [r[:5] for r in s["search_configuration"] if r and r[0] and r[0] not in ("SEARCH CONFIGURATION", "Type") and not r[0].startswith("Rules used")]

out = {"generated": TODAY.isoformat(), "exported_at": s["exported_at"], "jobs": jobs, "companies": companies, "config": config}
json.dump(out, open(OUT, "w"), separators=(",", ":"))

# compact report
from collections import Counter
print("jobs", len(jobs), "companies", len(companies))
print("score buckets", Counter((j["score"] // 10) * 10 for j in jobs).most_common())
print("cv", Counter(j["cv"] for j in jobs).most_common())
print("countries", Counter(j["country"] for j in jobs).most_common())
print("coverage", Counter(c["coverage"] for c in companies).most_common())
print("flags", Counter(f.split(":")[0] if f.startswith("Work") else f for j in jobs for f in j["flags"]).most_common())
print("top5", [(j["score"], j["company"], j["role"][:40], j["cv"]) for j in sorted(jobs, key=lambda x: -x["score"])[:5]])
