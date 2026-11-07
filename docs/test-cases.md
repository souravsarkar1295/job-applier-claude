# Job Applier: Flow Test Cases

These cases are the acceptance suite for M0 to M7. Each one was first walked through spec v0.2 on paper. The "Desk check" column records the result: **Covered** means v0.2 already handled it, and **Gap, fixed in v0.3** means walking the case showed something missing, which is now in the spec. The "Proved in" column is the milestone where the case is run for real.

The job lifecycle is also checked by script. `python3 scripts/check_lifecycle.py` confirms every status in the table is in the state diagram, can be reached, and is either terminal or has a way out. On v0.2 it found five problems: `withdrawn` missing from the diagram and unreachable, and `expired`, `no_response`, `skipped` and `withdrawn` as dead ends. On v0.3 it passes with 19 statuses and 50 transitions.

## Run start and sync

| ID | Scenario | Expected behaviour | Spec | Desk check | Proved in |
|---|---|---|---|---|---|
| T01 | First run, 12 saved jobs, profile filled | All 12 synced as `queued` with JD snapshots, then processed in saved order | 5.1 | Covered | M3 |
| T02 | Second chat starts a run while one is active | Refused, naming the active run | 8.6 | Gap, fixed in v0.3: no run lock existed | M4 |
| T03 | Previous run died, its lock is stale | New run starts after the 15-minute lock expiry | 8.6 | Gap, fixed in v0.3 | M4 |
| T04 | Sourav unsaves a `queued` job | Becomes `skipped`, reason unsaved | 5.1 | Gap, fixed in v0.3: unsaving wasn't handled | M3 |
| T05 | Sourav unsaves a job already `ready_for_review` | Flagged on the dashboard, status unchanged | 5.1 | Gap, fixed in v0.3 | M3 |
| T06 | First run, Sourav has 40 past applications on LinkedIn | Those within the D13 window are imported as `submitted` into the tracker | 5.1, D13 | Gap, fixed in v0.3: behaviour for unknown applied jobs was undefined | M3 |
| T07 | Saved job already shows "Applied" on LinkedIn | `submitted`, source already applied, no fill | 5.1 | Gap, fixed in v0.3: only checked before refills | M3 |
| T08 | Dashboard API unreachable at run start | Run doesn't start, agent reports in chat | 8.5 | Covered | M4 |

## Triage and filling

| ID | Scenario | Expected behaviour | Spec | Desk check | Proved in |
|---|---|---|---|---|---|
| T09 | Easy Apply job, every answer known | Filled to the review page, `ready_for_review`, push sent, tab left open | 5.1 | Covered | M0, M3 |
| T10 | Posting closed when triaged | `skipped`, reason closed | 5.1 | Covered | M3 |
| T11 | Two CVs fit equally | `parked_info` with a CV question before filling | 5.3 | Covered | M3 |
| T12 | Easy Apply pre-fills an old phone number | Corrected to the profile value | 5.2a | Gap, fixed in v0.3: Easy Apply pre-fill not considered | M0 |
| T13 | Chosen CV already in LinkedIn's saved resumes | Selected from the list, not uploaded again | 5.2a | Gap, fixed in v0.3 | M0 |
| T14 | External apply opens the portal in a new tab | Portal tab becomes the job's tab, LinkedIn tab closed | 5.2 | Gap, fixed in v0.3: spec assumed the same tab | M0 |
| T15 | External link lands on a general careers page | Agent searches by title. No confident match means `parked_info` asking for the link | 5.2 | Gap, fixed in v0.3 | M3 |
| T16 | Workday portal needs an account | `parked_action`, needs you at laptop | 5.2, 8.1 | Covered | M3 |
| T17 | Same role on LinkedIn and the company board | Linked as duplicates, one application | 5.4 | Covered | M6 |
| T18 | Dropdown with no option matching the profile value | Open question listing the exact options | 7.4 | Covered | M3 |
| T19 | Required compensation field, no standing answer | `parked_info` at that page | 7.3, 8.1 | Covered | M3 |
| T20 | Form asks for PAN or date of birth | Open question every time, value never stored in the profile | 7.3 | Gap, fixed in v0.3: identity documents weren't listed | M3 |
| T21 | "Why this company?" with a similar answer in the bank | Drafted fresh, marked drafted | 7.2 | Covered | M3 |
| T22 | Optional field unknown | Left blank, open question created, job still reaches review | 8.1 | Covered | M3 |
| T23 | Three unknown questions across three pages | All three created as found. Job stays `parked_info` until all are answered | 8.1 | Gap, fixed in v0.3: multiple questions per job unspecified | M4 |
| T24 | Unknown widget type | `failed` with screenshot. Retried on two more runs, then waits for Sourav | 7.4, 4 | Gap, fixed in v0.3: retries were unlimited | M3 |
| T25 | LinkedIn shows a security checkpoint mid-run | Run stops at once, nothing else touched, high-priority push | 5.1 | Gap, fixed in v0.3: no account-safety stop existed | M0 (G14) |
| T26 | Daily cap of 20 reached with 8 jobs left | Remaining jobs stay `queued` until the next day | 5.1 | Gap, fixed in v0.3 | M3 |
| T56 | Second run on the same day after 15 applications in the morning | Fills 5 more, then stops at the cap | 5.1 | Added in v0.3.1 | M3 |
| T57 | JD focused on retention and conversion for a consumer app | Growth CV chosen, with the signals shown in review | 5.3 | Added in v0.3.1 | M3 |
| T58 | AI product role focused on retention | AI and Growth fit about equally, so the job parks with a CV question | 5.3 | Added in v0.3.1 | M3 |
| T59 | JD mentions AI once in passing, otherwise general consumer | General consumer CV, not AI | 5.3 | Added in v0.3.1 | M3 |
| T60 | Form asks for expected CTC | Open question every time, with two one-tap options | 7.3, C6 | Added in v0.3.1 | M3 |
| T61 | Workday pre-fills the experience section with a wrong end date | Agent corrects that entry only | 7.4 | Added in v0.3.1 | M3 |

## Pauses and resume

| ID | Scenario | Expected behaviour | Spec | Desk check | Proved in |
|---|---|---|---|---|---|
| T27 | Sourav answers a question on his phone mid-run | Picked up in the resume pass, job finished in its tab | 5.1, 8.3 | Covered | M4 |
| T28 | Sourav completes a Workday sign-in and taps "Done" | Job resumed in the resume pass or next run | 8.1 | Gap, fixed in v0.3: no way to signal an action was done | M4 |
| T29 | Sourav answers a blocking question with "this application only" scope | Applies only to the jobs he picks, others stay blocked | 8.3 | Gap, fixed in v0.3 | M4 |
| T30 | Optional question answered after the job reached review | Answer queued and written into the open tab on the next pass | 8.1, 8.4 | Gap, fixed in v0.3 | M4 |
| T31 | Posting closes while the job is parked | `expired` | 4 | Gap, fixed in v0.3: no transition from parked statuses | M4 |
| T32 | Claude usage limit hit mid-form | Job becomes `interrupted` after 15 minutes. Next run finds the tab and continues from the last page | 8.6 | Covered | M0 (G7) |
| T33 | Interrupted job's tab was closed meanwhile | `needs_refill` | 4 | Gap, fixed in v0.3: no transition | M4 |
| T34 | Slow agent writes after its lease expired | Write rejected, agent re-reads the job | 8.6 | Gap, fixed in v0.3: double-fill was possible | M4 |
| T35 | Mac sleeps mid-run | Run stops, jobs `interrupted`, push sent | 8.6, 17a | Covered for recovery. Gap, fixed in v0.3: setup step to prevent it | M0 |

## Review and submit

| ID | Scenario | Expected behaviour | Spec | Desk check | Proved in |
|---|---|---|---|---|---|
| T36 | Sourav edits an answer in the tab and submits right away | Submission succeeds. Edit reaches the answer bank only if a pre-submit check ran | 8.4 | Covered | M3 |
| T37 | Sourav edits an answer in the dashboard | Written into the open tab on the next agent pass, only that field | 8.4 | Covered | M4 |
| T38 | Sourav submits but forgets to tap "Submitted" (LinkedIn) | Next run sees it in the applied list, `submitted` | 8.5 | Covered | M3 |
| T39 | Sourav submits on an external portal, closes the tab, doesn't tap | `submit_unconfirmed`, one-tap question, never refilled until answered | 8.5 | Covered | M4 |
| T40 | Sourav answers "No, I didn't submit" | `needs_refill`, refilled next run with changed fields marked | 8.5 | Covered | M4 |
| T41 | Chrome restarted, review tab lost | `needs_refill`, push sent | 8.5 | Covered | M4 |
| T42 | Refill finds a new question the first fill didn't have | Resolved normally, flagged as changed in review | 8.2 | Covered | M4 |
| T43 | Refill on a portal that says "You have already applied" | `submitted`, no refill | 8.5 | Covered. Transition added to the diagram in v0.3 | M4 |
| T44 | Sourav decides not to apply after reviewing | Taps "Skip", `skipped`, tab closed at next sweep | 8.4 | Gap, fixed in v0.3: no skip after review | M3 |
| T45 | Sourav updates expected CTC with 4 jobs waiting in review | Those 4 are listed and he chooses whether to update their tabs | 8.3 | Gap, fixed in v0.3 | M4 |
| T46 | Submitted job had two drafts, one edited in the tab without a check | Unedited draft goes to the answer bank, edited one doesn't (per D11) | 8.4, D11 | Gap, fixed in v0.3: draft approval on submission undefined | M4 |
| T47 | Review waiting for 3 days | Included in the daily "waiting on you" digest | 9 | Gap, fixed in v0.3 | M5 |

## Dream companies

| ID | Scenario | Expected behaviour | Spec | Desk check | Proved in |
|---|---|---|---|---|---|
| T48 | Greenhouse company posts a Senior PM role in a matching location | Appears in Discovered next run, one push for the run | 6.1 | Covered | M6 |
| T49 | Discovered posting removed before Sourav decides | `skipped`, reason posting removed | 6.1 | Gap, fixed in v0.3 | M6 |
| T50 | Workday endpoint returns an error for one company | Shown in Runs, other companies unaffected | 6.2, 16 | Covered | M6 |
| T51 | Shortlisted job closed by the time the agent reaches it | `skipped` at triage | 5.1 | Covered | M6 |

## Tracker

| ID | Scenario | Expected behaviour | Spec | Desk check | Proved in |
|---|---|---|---|---|---|
| T52 | No reply 30 days after submission | `no_response`, included in the weekly digest | 4, 9 | Covered | M7 |
| T53 | Company replies after `no_response` was set | Sourav moves it to `screening` or `rejected` | 4 | Gap, fixed in v0.3: `no_response` was a dead end | M7 |
| T54 | Sourav withdraws during interviews | `withdrawn` | 4 | Gap, fixed in v0.3: `withdrawn` wasn't in the diagram | M7 |
| T55 | Sourav reopens a skipped job | Back to `queued` | 4 | Gap, fixed in v0.3 | M3 |

## Summary

61 cases. Of the first 55, 25 were covered by v0.2 and 30 showed a gap, all fixed in v0.3. T56 to T61 were added in v0.3.1 for the CV rules, daily cap and compensation answers. The cases that can only be settled by running them, rather than on paper, are the capability gate checks in spec section 18.
