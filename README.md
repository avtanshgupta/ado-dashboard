# 🛡️ Azure DevOps PR Dashboard

A dashboard to manage pull requests across four Azure DevOps repositories in
`microsoft.visualstudio.com` / **Windows Defender**:

- `WD.Client.Linux`
- `WD.Client.Mac`
- `WD.Client.Linux.eBPF`
- `WD.Client.Linux.Installer`

It surfaces the PRs you created, PRs assigned to you for review, and open PRs from
your team — with comment counts, CI/pipeline status, review status, and inline
**merge** and **re-trigger pipeline** actions.

> **Multi-user.** Each person signs in with their **own** Azure DevOps identity and
> acts with their **own** permissions — locally via the Azure CLI (`az login`), or
> when hosted by pasting a short-lived Azure token. The **only** login gate is
> **group membership**: you may sign in iff you're a member of the
> `mdelinux@microsoft.com` (**MDE Linux**) group. Every user gets their own
> settings, notifications, and data.

---

## ✨ Features

| Area | What you get |
| --- | --- |
| **Sign-in** | Locally: automatic via the Azure CLI (`az login`). Hosted: paste a short-lived Azure token. Each user authenticates as themselves; only **MDE Linux** group members are admitted. |
| **Overview** | Three cards — **My / Assigned / Team**, each showing **Open / Draft / Closed** — plus stacked + per-repo charts, and a **timeline filter** (1mo … 2y). |
| **My Pull Requests** | Every PR you authored. State, active comments, pipeline, review status, **Proof-of-Presence** badge. Merge (only when mergeable) / re-run CI inline. |
| **Assigned to Me** | Active PRs where you're a reviewer **or one of your review groups is involved** (configurable), your open vs resolved threads, re-run CI. |
| **Team PRs** | Open PRs from your configured team members across all repos. |
| **PR Detail** | Description & comments rendered as **Markdown**, commits & files changed, pipelines (per-build re-run), **collapsible discussion threads** (open-only by default, dropdown for resolved/all), timeline, **reviewer management** (add / remove / toggle required), **linked work items**, and a **merge-blocked-by** breakdown. |
| **PR actions** | Merge (only when mergeable), enable/cancel auto-complete, publish draft, **convert to draft**, **abandon / reactivate**, re-run gates, cast vote. |
| **Merge gating** | The Merge button appears **only when the PR is actually mergeable** (active, no conflicts, all blocking policies green). Otherwise it shows what's blocking. |
| **Pipelines** | Overview, trigger runs, run history with stage/job/log drill-down, and **Analytics** (success-rate trend, mean/median duration, flaky-commit detection). |
| **Settings** | In-dashboard, per-user: repositories to monitor, team members, Assigned review-group aliases (auto-resolved), pipelines, default time window, notification preferences. New users start with only **WD.Client.Linux** monitored; everything else empty. |
| **Filter / sort / search** | Per-repo chips, **label filter**, **state filter (defaults to Open)**, **time-range filter (defaults to 6 months)**, sortable columns, **pagination**, free-text filter, and a global search across **PRs & pipelines**. Filters persist across reloads. |
| **Notifications** | In-app **bell** with unread badge + preferences (new PRs, comments, review changes, pipeline pass/fail, closes). Optional email via SMTP. |
| **Theme** | Light / Dark / System (follows your OS). |
| **Export** | CSV download per category (incl. labels); "PDF" via browser print. |
| **Responsive** | Works on desktop, tablet, and mobile, with keyboard-accessible tables & dialogs. |

---

## 🚀 Quick start

### Prerequisites
- **Node.js 20+** (the web build's `marked` dependency requires Node ≥ 20).
- **Azure CLI** signed in: run `az login` (verify with `az account show`).

### Install & run
```bash
cd ado-pr-dashboard
npm run install:all     # installs server/ and web/ deps
npm run dev             # backend (:4000) + frontend (:5173)
```
Open **http://localhost:5173** — locally it loads straight into the dashboard,
authenticated as your `az`-signed-in account.

### Production (single process)
```bash
npm run build           # builds the frontend into web/dist
npm start               # backend serves the UI + API on :4000
```
Open **http://localhost:4000**.

### How auth works
The dashboard is **multi-user** — each request runs as the signed-in user, using
that user's own Azure DevOps permissions (isolated per request via an
`AsyncLocalStorage` context), with per-user settings, notifications, and cache.

There are two ways to sign in:

- **Local (default):** the server obtains a token from your local Azure CLI
  (`az account get-access-token`) and acts as **you**. If you see a "Not signed in"
  message, run `az login` and reload.
- **Hosted / shared:** there's no local `az`, so users sign in on a token-paste
  screen — run `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv`
  and paste the printed token (append `| pbcopy` on macOS, `| clip` on Windows, or
  `| xclip -selection clipboard` on Linux to copy it straight to the clipboard). The
  server stores a short-lived token per user in a vault keyed by their identity and
  hands the browser an opaque session cookie. The optional
  [`scripts/token-pusher.sh`](scripts/token-pusher.sh) helper keeps a session
  refreshed so users rarely re-paste. Set `DISABLE_AZ_FALLBACK=true` when hosting.

**Access control.** There is a single login gate: the signed-in user must be a
member of the **`mdelinux@microsoft.com`** (MDE Linux) Azure DevOps / AAD group.
Membership is checked live against Azure DevOps (via the IdentityPicker) as the
user, and cached briefly, so removing someone from the group revokes their access
within minutes — there are no roles, allow-lists, or in-app user management to
maintain. Change the group with the `ALLOWED_GROUP` env var, or set it empty to
open the app to anyone who can authenticate against the org. Per-user state lives
under `server/data/` (`auth.json`, `users/`, `notif/`).


## ⚙️ Configuration

### Settings (in the dashboard)
Open **Settings** in the app to configure (each setting is **personal to you**):
- Repositories to monitor
- Team members (drive **Team PRs**)
- **Assigned-to-me** review-group aliases (type an alias; it's auto-resolved to the
  group display name via Azure DevOps)
- Default time window
- Notification preferences

These persist to `server/data/users/<your-id>.json`. New users start with only
**WD.Client.Linux** monitored and everything else empty — configure your own.

### Defaults & org constants — `server/config/app.config.json`
Seeds each user's settings on first run and holds org-level constants.
```jsonc
{
  "organizationUrl": "https://microsoft.visualstudio.com",
  "project": "Windows Defender",
  "projectId": "22c8b9b6-...",
  "adoResourceId": "499b84ac-...",
  "repositories": ["WD.Client.Linux"],  // seed monitored repos (only Linux by default)
  "team": [],                            // seed Team-PR members (empty by default)
  "reviewerGroups": [],                  // seed Assigned-to-me group aliases
  "defaultTimeRangeMonths": 6,
  "pipelines": [],                       // seed monitored pipelines
  "cacheTtlSeconds": 45,
  "fetchConcurrency": 16
}
```

### Server env — `server/.env` (optional; copy from `.env.example`)
```bash
PORT=4000

# ---- Access ----
ALLOWED_GROUP=mdelinux@microsoft.com  # login gate: required group membership
                                      # (set empty to open to the whole org)
DISABLE_AZ_FALLBACK=false  # true when hosted (no local `az`) — force token-paste
COOKIE_SECURE=false        # true when served over HTTPS
# DATA_DIR=/home/data      # persistent path for sessions/users on a host

# ---- Token encryption at rest ----
# Vault tokens are encrypted (AES-256-GCM). Set a 32-byte key (64 hex / base64)
# to hold it outside DATA_DIR; otherwise a keyfile is auto-generated in DATA_DIR.
# TOKEN_ENC_KEY=

# ---- Email notifications (optional — in-app always works) ----
SMTP_HOST=              # leave empty to disable email
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
```

---

## 🏗️ Architecture

```
web/  (React + Vite)  ──/api proxy──►  server/  (Node + Express)  ──REST──►  Azure DevOps
```

- **server/** authenticates each request as the signed-in user — locally via the
  Azure CLI, or via a per-user token vault (browser session cookie) when hosted —
  and runs every request in that user's own `AsyncLocalStorage` context. It
  aggregates the REST API with bounded concurrency + a short per-user cache, and
  exposes clean JSON endpoints plus merge/requeue actions. A single group-membership
  check gates who may sign in.
- **web/** renders the dashboard, charts (Recharts), tables, detail views, settings
  editor, and notifications.

### Key REST endpoints (backend)
| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/api/auth/me · /login · /token · /logout` | Session bootstrap + token-paste sign-in (public); enforces MDE Linux group membership |
| GET/PUT | `/api/config` | Settings (repos, team, aliases, prefs) + your identity — **validated** on write |
| POST | `/api/resolve-group` · GET `/api/identities?query=` | Resolve an alias → ADO group; search users/groups to add as reviewers |
| GET | `/api/overview?months=` | Open/Draft/Closed per category + per-repo |
| GET | `/api/prs/created · /assigned · /team` | PR lists (enriched, incl. labels) |
| GET | `/api/prs/:repo/:id` | Detail (commits, files, threads, PoP, work items, merge blockers) |
| POST | `/api/prs/:repo/:id/merge · /requeue · /vote · /publish · /autocomplete · /abandon · /reactivate · /draft` | PR actions |
| POST/PATCH/DELETE | `/api/prs/:repo/:id/reviewers[/:id]` | Add / toggle-required / remove reviewers |
| GET | `/api/pipelines · /:id/runs · /:id/analytics · /overview` | Pipelines, runs, analytics |
| GET | `/api/notifications` · POST `/poll` · PUT `/preferences` | Notifications |
| GET | `/api/export.csv?category=created\|assigned\|team` | CSV export |

> **Security:** state-changing requests require an `X-Requested-With` header (CSRF
> defense); CORS is restricted to configured/localhost origins (no wildcard); every
> `/api` request re-verifies the caller's MDE Linux group membership.

---

## 🔐 Permissions & safety
- Actions call the real Azure DevOps API, which enforces your permissions. If you
  can't complete a PR or queue a build, the action returns a clear error — nothing
  is bypassed.
- **Merge** opens a confirmation dialog with strategy, delete-source-branch, and an
  explicit policy-bypass opt-in. It never merges without your confirmation.

## 📝 Notes
- **Defaults**: every list view shows **Open** PRs **updated in the last 6 months**.
  Drafts are hidden until you pick *Draft* (or *All states*); change the time window
  with the *Updated:* dropdown.
- The **Created** view fetches history automatically when you select *Merged*,
  *Closed*, or *All states* (historical PRs are listed without the costly per-PR
  enrichment).
- **Assigned to Me** also surfaces PRs where a configured review group (TP Team,
  eBPF Core, Installer Team) is a reviewer — each row is tagged with a 👥 badge.
- Data is cached for ~45s; use **Refresh** to force-refetch.
- Team-PR enrichment of large lists can take a few seconds on a cold load, then is
  served from cache.
