# job-applier-claude

Sourav's PM job board: finds product roles across company job boards and job sites, scores them, suggests the CV to use, and tracks every application.

Private repository. Personal data (CVs, profile, answers, compensation) is never committed.

| Part | Where |
|---|---|
| Dashboard | Next.js app in `app/` and `components/`, deployed on Vercel, sign-in limited to the owner's email |
| Database | Supabase. Schema in `supabase/migrations/` |
| Refresh job | `scripts/refresh.ts`, run every 4 hours by `.github/workflows/refresh.yml` |
| Scoring and CV rules | `lib/score.ts` |
| Job board readers | `lib/boards.ts` (Greenhouse, Lever, Ashby, Workable, Workday) |
| Design spec | [`docs/spec.md`](docs/spec.md), test cases in [`docs/test-cases.md`](docs/test-cases.md) |

## Environment

See `.env.example`. Vercel needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`. GitHub Actions needs the secrets `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, and optionally `NTFY_TOPIC` for phone alerts without Claude.

## First run

1. Run `supabase/migrations/0001_init.sql` in the Supabase SQL editor.
2. Sign in on the dashboard with the owner's email.
3. Open `/import` and upload the Google Sheet snapshot.
4. Run the "Refresh job board" workflow once from the Actions tab.
