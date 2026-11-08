-- Job board schema. Run once in the Supabase SQL editor.
-- Access: only the signed-in owner (by email) can read or write through the app.
-- The refresh job and the import route use the secret key, which bypasses row-level security.

create or replace function public.is_owner() returns boolean
language sql stable as $$
  select coalesce(lower(auth.jwt() ->> 'email') = 'sarkar1295sourav@gmail.com', false)
$$;

create table if not exists public.companies (
  id            bigint generated always as identity primary key,
  name          text not null unique,
  tier          text not null default '',
  geo           text not null default '',
  careers_url   text not null default '',
  linkedin_url  text not null default '',
  relevance     text not null default '',
  notes         text not null default '',
  ats           text not null default '',          -- greenhouse | lever | ashby | workable | workday | careers site | none
  board         text not null default '',          -- board slug, or workday "host|tenant|site"
  board_source  text not null default '',          -- url | auto | manual
  active        boolean not null default true,
  board_checked_at timestamptz,
  last_fetched_at  timestamptz,
  last_fetch_error text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.jobs (
  id            bigint generated always as identity primary key,
  external_key  text not null unique,              -- sheet:<row> or <ats>:<board>:<job id>
  dedup_key     text not null default '',
  board_key     text not null default '',          -- <ats>:<board> when the role came from or matched a job board
  board_job_id  text not null default '',
  company       text not null,
  company_id    bigint references public.companies(id) on delete set null,
  role          text not null,
  location      text not null default '',
  country       text not null default '',
  work_mode     text not null default 'Unknown',
  seniority     text not null default '',
  category      text not null default '',
  summary       text not null default '',
  requirements  text not null default '',
  jd            text not null default '',
  fit           text not null default 'Unreviewed',
  why           text not null default '',
  source        text not null default '',
  link          text not null default '',
  ats           text not null default '',
  posted_by     text not null default '',
  poster_role   text not null default '',
  post_link     text not null default '',
  contact       text not null default 'Unknown',
  listing       text not null default 'Open',      -- Open | Closed | Unknown
  found_on      date,
  posted_on     date,
  verified_on   date,
  closed_on     date,
  notes         text not null default '',
  tier          text not null default '',
  score         int not null default 0,
  score_parts   jsonb not null default '{}'::jsonb,
  cv            text not null default '',
  cv_signals    jsonb not null default '{}'::jsonb,
  flags         text[] not null default '{}',
  years_required int,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists jobs_dedup_idx on public.jobs (dedup_key);
create index if not exists jobs_board_idx on public.jobs (board_key, board_job_id);
create index if not exists jobs_found_idx on public.jobs (found_on desc);

-- Sourav's own actions. Kept apart from jobs so the refresh job can never overwrite them.
create table if not exists public.job_status (
  job_id        bigint primary key references public.jobs(id) on delete cascade,
  list          text,                              -- saved | dismissed | null
  stage         text,                              -- Applied | Screening | Interviewing | Offer | Rejected | No response
  opened_on     date,
  applied_on    date,
  cv_used       text,
  dismiss_reason text,
  note          text,
  updated_at    timestamptz not null default now()
);

create table if not exists public.runs (
  id            bigint generated always as identity primary key,
  kind          text not null,                     -- refresh | import
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  new_job_ids   bigint[] not null default '{}',
  closed_count  int not null default 0,
  verified_count int not null default 0,
  companies_checked int not null default 0,
  errors        jsonb not null default '[]'::jsonb,
  summary       text not null default '',
  alerted_at    timestamptz
);

alter table public.companies  enable row level security;
alter table public.jobs       enable row level security;
alter table public.job_status enable row level security;
alter table public.runs       enable row level security;

drop policy if exists owner_all on public.companies;
drop policy if exists owner_all on public.jobs;
drop policy if exists owner_all on public.job_status;
drop policy if exists owner_read on public.runs;
create policy owner_all  on public.companies  for all    to authenticated using (public.is_owner()) with check (public.is_owner());
create policy owner_all  on public.jobs       for all    to authenticated using (public.is_owner()) with check (public.is_owner());
create policy owner_all  on public.job_status for all    to authenticated using (public.is_owner()) with check (public.is_owner());
create policy owner_read on public.runs       for select to authenticated using (public.is_owner());
