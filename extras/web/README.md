# HLK-ZW Web Tester

Browser-based tester for HLK-ZW series fingerprint sensors, talking to the
module directly over the Web Serial API. Matches the Python desktop tester
feature for feature, then goes beyond it — capability probe, on-chip random
number reader, raw image capture — with nothing to install.

## Browser support

Web Serial is **Chromium-only** — Chrome, Edge, Opera, Arc. Firefox and Safari
do not implement it and show an explanatory notice instead. Those users should
run [`../HLK_ZW_Tester_Program.py`](../HLK_ZW_Tester_Program.py), which has the
same capabilities on Windows, macOS and Linux.

The page must be served over HTTPS or `localhost`; Web Serial is unavailable in
insecure contexts.

## Local development

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # protocol conformance tests
npm run build     # production build → dist/
```

## Features

Everything the Python tester does:

- **Connection** — port picker, 9600–115200 baud, selectable stop bits (the
  ZW302x datasheet specifies 8N2), module password
- **Device** — verify password, read system params, template count, finger
  detection, raw 512-byte info-page hex dump
- **Capability probe** — asks the module which optional opcodes it implements
  and shows the result (see below)
- **Random number** — samples the module's on-chip hardware RNG
  (`PS_GetRandomCode`), independent of the fingerprint sensor
- **Raw image capture** — waits for a finger and streams the raw image out of
  the module. The module reports neither its sensor resolution nor its pixel
  packing; **confirmed on real HLK-ZW101 hardware**, it's 160×160 pixels at
  1 bit/pixel — a preprocessed/binarized image, not the 4-bit grayscale
  Hi-Link's demo software assumes. Other HLK-ZW variants are unconfirmed, so
  this reshapes the same bytes live at any width/height/bit-depth you dial
  in, with quick-pick starting points (the confirmed ZW101 default first), so
  you can watch for a recognizable fingerprint pattern instead of noise.
  Save the result as a PNG
- **Enrollment** — two-scan with live progress, cancel, automatic reassignment
  away from an occupied slot
- **Matching** — 1:N search with adjustable timeout and confidence score
- **Storage map** — visual grid of occupied and free slots
- **Templates** — check a slot, delete one, delete a range, wipe all, export and
  import `.fp` files
- **LED** — all six Aura modes and seven colours, with automatic fallback to
  simple on/off, and it reports which path the module actually took
- **Settings** — security level, baud rate, packet size, change password
- **Log** — every frame in and out, with copy, download and problem reporting

### Capability probe

The one thing this tester does that the Python one does not. Not every HLK-ZW
variant implements every opcode, and a rejected opcode surfaces as a confusing
confirm code — a ZW3020 answers HiSpeedSearch (`0x1B`) with `0x13`, which the
tables render as "wrong password" even though the password is fine. That cost
days of back-and-forth in issue #1.

The probe sends each optional command and reports what came back, so an unusual
module is a screenshot rather than a forensic exercise.

## Protocol layer

[`src/protocol/`](src/protocol/) is a third implementation of the EF-01 wire
protocol, alongside `src/HLK_fingerprint.cpp` and `HLK_ZW_Tester_Program.py`.
**A module-compatibility fix in one belongs in all three** — that is the whole
reason they live in one repository.

`test/protocol.test.mjs` pins the framing against the real packets captured in
issue #1, so a regression fails CI rather than reaching hardware.

## Problem reporting

The "Report a problem" button submits the session log plus a diagnostics
snapshot (module variant, capacity, system params, capability results, browser)
to Supabase.

If Supabase is not configured the dialog still works — it offers a prefilled
GitHub issue, clipboard copy and log download. A fork with no backend is fully
usable.

### Supabase setup

Run this in the Supabase SQL editor:

```sql
create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  title       text not null,
  description text not null,
  contact     text,
  log_text    text,
  diagnostics jsonb
);

-- Length limits matter: the insert policy below is open to anonymous users.
alter table public.reports
  add constraint reports_title_len check (char_length(title) between 3 and 200),
  add constraint reports_desc_len  check (char_length(description) between 6 and 5000),
  add constraint reports_log_len   check (log_text is null or char_length(log_text) <= 200000);

alter table public.reports enable row level security;

-- Anonymous visitors may submit a report and nothing else. With no select
-- policy, no one can read the table through the anon key — you read submissions
-- in the dashboard, where the service role bypasses RLS.
create policy "anon can submit reports"
  on public.reports for insert to anon with check (true);
```

Then add the two variables to the **Vercel project** (Settings → Environment
Variables), for both Production and Preview:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the project's `anon` / publishable key |

`vercel pull` fetches these during the build, so they live in one place rather
than being duplicated as GitHub secrets.

The anon key is designed to be public and ships in the JavaScript bundle. What
protects the table is the RLS policy, not the key — never put the `service_role`
key here.

For local development, put the same two variables in `extras/web/.env.local`
(gitignored). Without them the app runs fine and falls back to GitHub issues.

## Deployment

[`.github/workflows/deploy-vercel.yml`](../../.github/workflows/deploy-vercel.yml)
deploys to Vercel. Pushes to `main` that touch `extras/web/` go to production;
pull requests get a preview URL commented back on the PR.

It runs through Actions rather than Vercel's native Git integration so that
`npm test` gates the deploy — the protocol layer here is a third implementation
of the wire protocol, and a drifting build must not reach users.

### One-time setup

1. Create a Vercel project. When linking, set **Root Directory** to
   `extras/web`, or run `vercel link` from that directory.
2. Add three repository secrets (Settings → Secrets and variables → Actions):

   | Secret | Where to find it |
   |---|---|
   | `VERCEL_TOKEN` | Vercel → Account Settings → Tokens |
   | `VERCEL_ORG_ID` | `extras/web/.vercel/project.json` after `vercel link`, or Vercel team settings |
   | `VERCEL_PROJECT_ID` | same `project.json`, or Vercel project settings |

3. Turn **off** Vercel's native Git integration for the project (Settings → Git
   → disconnect). Leaving it on means every push deploys twice — once ungated by
   the tests.

`vite.config.js` sets `base: './'`, so the same build also works from a project
subpath, a custom domain or `file://` without rebuilding.

Web-only changes should **not** bump `library.properties` or get a git tag —
the Arduino Library Manager re-indexes on tags, and a release for a CSS change
is noise in the library's version history.
