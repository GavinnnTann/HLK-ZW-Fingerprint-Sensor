# HLK-ZW Web Tester

Browser-based tester for HLK-ZW series fingerprint sensors, talking to the
module directly over the Web Serial API. Matches the Python desktop tester
feature for feature, then goes beyond it — capability probe, on-chip random
number reader, raw image capture — with nothing to install.

## Browser support

| Browser | Web Serial | Notes |
|---|---|---|
| Chrome / Edge / Opera / Arc (desktop) | 89+ | Reference implementation |
| Firefox (desktop) | 151+ | Extra add-on install step, see below |
| Firefox for Android | ❌ | Not implemented |
| Chrome for Android | 138+, partial | Bluetooth RFCOMM ports only — no USB |
| Safari (macOS / iOS) | ❌ | No implementation, none announced |

Where it is missing the tester shows an explanatory notice instead. Those users
should run [`../HLK_ZW_Tester_Program.py`](../HLK_ZW_Tester_Program.py), which
has the same capabilities on Windows, macOS and Linux.

The page must be served over HTTPS or `localhost`; Web Serial is unavailable in
insecure contexts.

### Firefox notes

Firefox 151 (19 May 2026) shipped Web Serial with the full API surface this
tester uses — `requestPort`, `getPorts`, `open`/`close`, `readable`/`writable`,
`getInfo`, `getSignals`/`setSignals`, `forget`, and the `connect`/`disconnect`
events. No code changes were needed; the tester runs unmodified. Two behaviours
differ from Chromium and are worth knowing before filing a bug:

- **Add-on gating.** The first time a site calls `requestPort()`, Firefox asks
  the user to install a site-permission add-on, *then* shows the port picker.
  Cancelling the add-on step rejects the promise and looks like a plain
  connection failure.
- **Enterprise policy.** Under Firefox Enterprise Policies Web Serial is
  disabled by default; an administrator has to allow it with
  `DefaultSerialGuardSetting`.

`dev/serial-probe.html` is a dependency-free page that prints exactly which
parts of the API the current browser exposes, plus buttons that exercise
`requestPort` / `getPorts` / open-write-read against real hardware. Open it
directly over `localhost` (or any HTTPS host) when triaging a browser report.

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
- **What's new** — release notes in the app, with the running version and
  commit (see below)

### Capability probe

The one thing this tester does that the Python one does not. Not every HLK-ZW
variant implements every opcode, and a rejected opcode surfaces as a confusing
confirm code — a ZW3020 answers HiSpeedSearch (`0x1B`) with `0x13`, which the
tables render as "wrong password" even though the password is fine. That cost
days of back-and-forth in issue #1.

The probe sends each optional command and reports what came back, so an unusual
module is a screenshot rather than a forensic exercise.

## Versioning and release notes

The header shows the running version (`v1.4.0`); hovering it gives the full
build id, and clicking it opens the **What's new** tab. That tab also prints the
commit and build date, and every problem report attaches all three
(`app_version`, `build_sha`, `build_date`) — the commit is what actually
identifies a build, since the tester redeploys on every push to `main` and a
page is often several commits ahead of the last tag.

| Where | Source |
|---|---|
| Version | `package.json`, injected as `__APP_VERSION__` |
| Commit | `VERCEL_GIT_COMMIT_SHA` / `GITHUB_SHA` in CI, else `git rev-parse`, else `dev` |
| Build date | Build time, UTC day |
| Release notes | [`src/changelog.js`](src/changelog.js) |

The version tracks the repository's release line — the same number as
`library.properties` and the GitHub releases — so the app and the release notes
on GitHub always mean the same thing. (It was pinned at `1.0.0` until v1.4.0,
which made `app_version` useless in problem reports.)

Release notes are hand-maintained data rather than a fetch of the GitHub
releases API, so the tab works on a bench machine with no network. **When you
bump `package.json`, add the matching entry to `src/changelog.js` in the same
commit** — `test/changelog.test.mjs` fails the build otherwise, and it also
checks ordering, dates and change kinds. Use `date: null` for a version that has
not been tagged yet; the tab renders it as *unreleased*.

A **What's new** dot appears on the tab when the running version differs from the
one last read (`seenVersion` in `localStorage`). A first-time visitor is recorded
silently, so the dot only ever means "new since your last visit".

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
