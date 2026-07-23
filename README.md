# 📊 Azure DevOps Dashboard

![Node](https://img.shields.io/badge/node-%E2%89%A520-3c873a)
![React](https://img.shields.io/badge/react-18-61dafb)
![Express](https://img.shields.io/badge/express-4-000000)
![Tests](https://img.shields.io/badge/tests-node%3Atest-blueviolet)
![License](https://img.shields.io/badge/license-Internal-blue)

A multi-user web dashboard for managing **pull requests**, **pipelines**, and
**work items** across your Azure DevOps **projects** — spanning one **or more
organizations** — from a single place. Each person signs in with their **own**
Azure DevOps identity and acts with their **own** permissions; there is no shared
service account and no database to run.

New users start monitoring three projects by default — **Windows Defender**,
**OS**, and **WDATP** (all in `microsoft.visualstudio.com`) — and every kind of
data (PRs, builds, repositories, work items, queries) is scoped to the projects
each user chooses to monitor. Add another project — including one in a **different
organization** (e.g. `https://dev.azure.com/MSecProductSecurity/…`) — by pasting
its URL under **Settings → General → Projects**; the same Azure token is used
against every org you can access.

> **Live instance:** https://ado-dashboard.azurewebsites.net

---

## Table of contents

- [Highlights](#-highlights)
- [Tech stack](#-tech-stack)
- [Architecture](#-architecture)
- [Project structure](#-project-structure)
- [Quick start](#-quick-start)
- [Authentication & access control](#-authentication--access-control)
- [Configuration](#-configuration)
- [Deployment](#-deployment)
- [API reference](#-api-reference)
- [Testing & quality](#-testing--quality)
- [Security](#-security)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Highlights

**Pull requests**
- **My / Assigned / Team** views with state, active-comment counts, CI/pipeline
  status, review status and a Proof-of-Presence badge.
- **Assigned to Me** also surfaces PRs where one of your configured review groups
  is a reviewer (each tagged with a 👥 badge).
- **Inline review** without leaving the app: per-file diff, comment / reply /
  resolve threads (general or line-anchored), and a batched *start-a-review* flow.
- **Full PR lifecycle:** create, merge (only when actually mergeable), vote,
  enable/cancel auto-complete, publish/convert-to-draft, abandon/reactivate,
  manage reviewers, link/unlink work items, and re-run gates — with a
  **merge-blocked-by** breakdown when a PR isn't ready.
- **Bulk actions** across selected PRs.

**Pipelines**
- Overview, trigger runs (pick branch + parameters), run history with
  stage/job/log drill-down, retry (whole run or **failed stages only**), CSV
  export, and **Analytics** (success-rate trend, mean/median duration, flaky-commit
  detection).

**Work items**
- A full section across every monitored project: **Overview** (rollups by state
  category / type / assignee, aging, weekly created-vs-closed throughput, SLA
  breaches) plus **Assigned / Created / Team / Following / Current Sprint / Saved
  Queries** tabs.
- **Detail** view with sanitized rich-text (description / repro / acceptance),
  discussion, links & relations (incl. linked PRs), and inline editing (valid
  state transitions only, reassign, tags, priority, comment, link/unlink).
- **Create** a work item, and add **saved queries** by pasting a query link.

**Across the app**
- **Project Overview** landing page and a prioritized **Action Center** inbox
  (*what needs me next*) with follow / snooze / dismiss.
- **Stale-while-revalidate caching:** every list/overview/detail renders its last
  payload instantly (per tab, in `sessionStorage`) and refreshes in the background
  with an *"Updating…"* indicator; the cache is wiped on sign-out.
- **Filter / sort / search:** per-repo chips, multi-select state filter, time-range
  filter, sortable + paginated columns, free-text filter, **saved views**, and a
  global search (⌘K / Ctrl-K command palette; jump to a work item by `#id`).
- **In-app notifications** with live updates over **Server-Sent Events**, an unread
  badge, per-event preferences, and optional desktop/browser push.
- **Stand-up** generator (Markdown + `.ics`), CSV export, guided onboarding tour,
  and Light / Dark / System themes.

---

## 🧱 Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, React Router 6, Vite 5, Recharts, `marked` + DOMPurify (safe Markdown/HTML), `lucide-react` icons |
| Backend | Node ≥ 20, Express 4, `AsyncLocalStorage` per-request context, native `fetch` to the Azure DevOps REST API (v7.1) |
| Auth | Azure CLI (`az`) locally, or a per-user token vault (AES-256-GCM at rest) with an opaque session cookie when hosted |
| Storage | **No database** — per-user JSON files under `DATA_DIR` (`auth.json`, `users/`, `notif/`) |
| Tests / lint | Node's built-in `node:test`, ESLint 9 (`eslint-plugin-react`, `-react-hooks`) |
| Packaging | Multi-stage `Dockerfile` (single image serves SPA + API on `:4000`) |

---

## 🏗 Architecture

```
web/  (React + Vite SPA)  ──/api──►  server/  (Node + Express)  ──REST v7.1──►  Azure DevOps
        rendered same-origin           per-request user context                (1..N orgs)
        in production                   bounded concurrency + short cache
```

- **`server/`** authenticates each request as the signed-in user — locally via the
  Azure CLI, or via the per-user token vault (browser session cookie) when hosted —
  and runs every request inside that user's `AsyncLocalStorage` context. It fans out
  to the ADO REST API with **bounded concurrency** and a short per-user cache,
  exposes clean JSON endpoints and PR/pipeline/work-item actions, and streams live
  updates over **Server-Sent Events**. A single group-membership check gates sign-in.
- **`web/`** renders the dashboard, charts, tables, detail views, inline diffs, the
  settings editor, command palette, and notifications. In production the built SPA is
  served same-origin by the Node server; in dev, Vite proxies `/api` to `:4000`.
- **Multi-org:** each monitored project carries an `org` base URL; the ADO client
  resolves the correct organization per project for every REST call, so a single AAD
  token can drive several organizations at once.

---

## 📁 Project structure

```
ado-pr-dashboard/
├── server/                       # Node + Express API
│   ├── src/
│   │   ├── index.js              # app bootstrap; serves web/dist in production
│   │   ├── config.js             # .env + app.config.json loader
│   │   ├── routes/               # api.js, auth.js
│   │   ├── middleware/           # sessionContext, csrf, rateLimit, securityHeaders, auditLog
│   │   ├── services/             # pr, pipeline, workItem, notifications, stream, …
│   │   └── lib/                  # adoClient, userConfig, crypto, analytics, links, …
│   ├── config/app.config.json    # org defaults & per-user seeds
│   ├── test/                     # node:test suites
│   └── data/                     # per-user JSON state (gitignored)
├── web/                          # React + Vite SPA
│   ├── src/
│   │   ├── pages/                # Overview, PRs, Pipelines, WorkItems, Settings, …
│   │   ├── components/           # tables, filters, charts, tour, command palette
│   │   └── lib/                  # api client, hooks, SWR cache, formatters
│   └── test/                     # node:test suites
├── dev.mjs                       # concurrent dev runner (API + Vite)
├── Dockerfile                    # multi-stage build → single runtime image
└── package.json                  # root scripts: install:all, dev, build, test, lint
```

---

## 🚀 Quick start

### Prerequisites
- **Node.js ≥ 20** (the web build's `marked` dependency requires it).
- **Azure CLI** signed in for local use: `az login` (verify with `az account show`).

### Install & run (development)
```bash
npm run install:all     # install server/ and web/ dependencies
npm run dev             # API on :4000 + Vite dev server on :5173 (via dev.mjs)
```
Open **http://localhost:5173**. Locally the app loads straight into the dashboard,
authenticated as your `az`-signed-in account.

### Production (single process)
```bash
npm run build           # builds the SPA into web/dist
npm start               # Node server serves the UI + API on :4000
```
Open **http://localhost:4000**.

### Useful scripts
| Command | What it does |
| --- | --- |
| `npm run dev` | API + web dev servers with hot reload |
| `npm run build` | Build the SPA into `web/dist` |
| `npm start` | Serve the built SPA + API from Node on `:4000` |
| `npm test` | Run the `server/` and `web/` `node:test` suites |
| `npm run lint` | ESLint over `server/src` and `web/src` |

---

## 🔐 Authentication & access control

The dashboard is **multi-user**: every request runs as the signed-in user, using
that user's own Azure DevOps permissions, with per-user settings, notifications,
and cache. There are two ways to sign in:

- **Local (default):** the server obtains a token from your local Azure CLI
  (`az account get-access-token`) and acts as **you**. If you see *"Not signed in"*,
  run `az login` and reload.
- **Hosted / shared:** there is no local `az`, so users sign in on a token-paste
  screen. Generate a token and paste it:
  ```bash
  az account get-access-token \
    --resource 499b84ac-1321-427f-aa17-267ca6975798 \
    --query accessToken -o tsv
  # append | pbcopy (macOS), | clip (Windows) or | xclip -selection clipboard (Linux)
  ```
  The server stores a short-lived token per user in an **encrypted vault** keyed by
  identity and hands the browser an opaque session cookie. When a token expires the
  app shows an inline re-paste banner — paste a fresh token and you keep your place.
  Set `DISABLE_AZ_FALLBACK=true` when hosting.

**Access gate.** The single login gate is **group membership**: a user may sign in
only if they belong to the `mdelinux@microsoft.com` (**MDE Linux**) Azure DevOps /
AAD group. Membership is checked live (via the IdentityPicker) as the user and
cached briefly, so removing someone from the group revokes access within minutes —
there are no roles, allow-lists, or in-app user management. Change the group with
`ALLOWED_GROUP`, or set it empty to admit anyone who can authenticate against the org.

---

## ⚙️ Configuration

### In-app settings (per user)
Open **Settings** in the app; every setting is personal to the signed-in user and
persists to `server/data/users/<your-id>.json`:

- **Monitored projects** — add by pasting a project URL, from **any organization**
  you can access. This is the scope for everything (PRs, builds, repos, work items,
  queries). Defaults to **Windows Defender / OS / WDATP**.
- **Repositories** and **pipelines** to track — added by pasting a link within a
  monitored project.
- **Team members** — drive *Team PRs* and the *Work Items → Team* tab.
- **Review-group aliases** — type an alias; it's auto-resolved to the group's
  display name (surfaces those PRs under *Assigned to Me*).
- **Work-item saved queries** — add by pasting a query link; run them under
  *Work Items → Queries*. (All work items under monitored projects are tracked
  automatically — no area paths needed.)
- **Comment templates** (reusable reply snippets) and **PR description
  templates** (prefill a new PR's description; optionally scoped per repository).
- **Default time window**, **SLA / aging thresholds**, **saved views**,
  **muted repos**, and notification preferences.
- **Recent activity** — your own audit trail of state-changing actions (under
  *Settings → Account*).

> Added items (projects, repos, pipelines, queries, aliases) are **removable, not
> editable** — remove and re-add to change one.

### Org defaults & seeds — `server/config/app.config.json`
Seeds each new user's settings on first run and holds org-level constants:
```jsonc
{
  "organizationUrl": "https://microsoft.visualstudio.com", // default org / identity
  "project": "Windows Defender",                            // fallback project
  "projectId": "22c8b9b6-…",
  "projects": [                                             // seeded monitored projects
    { "name": "Windows Defender", "id": "22c8b9b6-…" },
    { "name": "OS",               "id": "8d47e068-…" },
    { "name": "WDATP",            "id": "f0333b3d-…" }
  ],
  "adoResourceId": "499b84ac-…",   // AAD resource for ADO access tokens
  "repositories": ["WD.Client.Linux"],
  "team": [],
  "reviewerGroups": [],
  "defaultTimeRangeMonths": 6,
  "pipelines": [ { "repo": "WD.Client.Linux", "definitionId": 137667, "name": "…" } ],
  "cacheTtlSeconds": 45,           // per-user server cache TTL
  "fetchConcurrency": 16           // max concurrent ADO REST calls
}
```

### Server environment — `server/.env` (copy from `.env.example`)
| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | Backend port (Vite dev proxies `/api` here) |
| `ALLOWED_GROUP` | `mdelinux@microsoft.com` | Required group for sign-in; empty = open to the org |
| `DISABLE_AZ_FALLBACK` | `false` | `true` when hosted (no local `az`) — force token-paste |
| `COOKIE_SECURE` | `false` | `true` when served over HTTPS |
| `COOKIE_NAME` | `ado_sid` | Session cookie name |
| `DATA_DIR` | `server/data` | Persistent path for sessions/users/notifications |
| `ALLOWED_ORIGINS` | *(unset)* | Comma-separated extra CORS origins (localhost allowed by default) |
| `TOKEN_ENC_KEY` | *(auto)* | 32-byte key (64 hex / base64) to encrypt vault tokens; auto-generated in `DATA_DIR` if unset |

---

## 📦 Deployment

### Docker
The multi-stage [`Dockerfile`](Dockerfile) builds the SPA and runs the server
serving both the UI and API on port `4000`. It defaults to hosted mode
(`DISABLE_AZ_FALLBACK=true`, `COOKIE_SECURE=true`) and persists per-user state on a
`/home/data` volume.
```bash
docker build -t ado-pr-dashboard .
docker run -p 4000:4000 -v ado-data:/home/data \
  -e TOKEN_ENC_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  ado-pr-dashboard
```

### Azure App Service (Linux, Node 20/22)
The live instance runs as a zip deploy — the SPA is prebuilt and the server serves
`web/dist`, so **build is disabled** on the platform.
```bash
APP=ado-dashboard ; RG=<resource-group>

# 1) One-time app settings
az webapp config appsettings set -g "$RG" -n "$APP" --settings \
  DISABLE_AZ_FALLBACK=true COOKIE_SECURE=true DATA_DIR=/home/data \
  SCM_DO_BUILD_DURING_DEPLOYMENT=false \
  TOKEN_ENC_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
az webapp config set -g "$RG" -n "$APP" --startup-file "node server/src/index.js"

# 2) Build the SPA and stage server + production deps + web/dist
npm run build
rm -rf dist && mkdir -p dist/server dist/web
cp -r server/src server/config server/package.json server/package-lock.json dist/server/
cp -r web/dist dist/web/dist
( cd dist/server && npm ci --omit=dev )
( cd dist && zip -rq ../deploy.zip . )

# 3) Deploy (async; poll SCM /api/deployments for status)
az webapp deploy -g "$RG" -n "$APP" --type zip --src-path deploy.zip \
  --clean true --restart true --async true
```
`DATA_DIR=/home/data` keeps per-user logins on persistent storage across deploys.
Provide `TOKEN_ENC_KEY` (ideally from Key Vault) so vault tokens are encrypted with
a key held outside the data volume.

---

## 📚 API reference

`GET /api/health` is public; every other `/api` route runs in the authenticated
session context. Representative surface — see
[`server/src/routes/`](server/src/routes) for the full set.

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/api/auth/me · /login · /token · /logout` | Session bootstrap + token-paste sign-in (public) |
| GET/PUT | `/api/config` | Per-user settings + identity (validated on write) |
| GET | `/api/audit?limit=` | The signed-in user's recent state-changing actions (audit trail) |
| POST/GET | `/api/resolve-group · /identities?query= · /repos/resolve · /projects/resolve · /pipelines/resolve` | Resolve an alias/repo/project/pipeline link |
| GET | `/api/overview · /summary · /pr-analytics · /standup(.ics)` | Rollups, project summary, analytics, stand-up |
| GET/POST | `/api/action-center · /snooze · /dismiss · /follows` | Prioritized inbox + follow / snooze / dismiss |
| GET/POST | `/api/prs/created · /assigned · /team` · `POST /api/prs` | PR lists (enriched) and PR creation |
| GET | `/api/prs/:repo/:id · /:id/diff` | Detail (commits, files, threads, PoP, WIs, blockers) + diff |
| POST | `/api/prs/:repo/:id/merge · /requeue · /vote · /publish · /autocomplete · /abandon · /reactivate · /draft` | PR actions |
| POST/PATCH | `/api/prs/:repo/:id/threads[/inline\|/batch\|/:tid/comments]` · `/reviewers` · `/workitems` | Threads, reviewers, work-item links |
| GET/POST | `/api/pipelines · /:id/runs · /:id/analytics · /overview · /:id/queue · /runs/:id/retry[-failed]` | Pipelines, runs, analytics, trigger, retry |
| GET | `/api/workitems/assigned · /created · /team · /following · /sprint · /overview · /summary · /types` | Work-item lists, rollups, type metadata |
| GET | `/api/workitems/:id · /queries/:queryId/run · /queries/resolve?ref= · /export.csv?tab=` | WI detail, run/resolve a saved query, CSV |
| POST/PATCH | `/api/workitems · /:id · /:id/comments · /:id/links[/remove]` | Create/update (json-patch + `rev` guard), comment, link |
| GET | `/api/stream` (SSE) · `/api/notifications` · POST `/poll · /read` · PUT `/preferences` | Live updates + notifications |
| GET | `/api/export.csv?category=… · /api/pipelines/:id/export.csv` | CSV export |

---

## 🧪 Testing & quality

```bash
npm run lint     # ESLint over server/src + web/src
npm test         # server/ and web/ node:test suites
```
Business logic lives in pure, dependency-free libraries (`server/src/lib/*`,
`web/src/lib/*`) that are unit-tested with Node's built-in test runner — no test
framework to install. Run a single suite with, e.g.,
`node --test server/test/workItemQuery.test.js`.

**CI:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs lint, tests,
and the web build on every push/PR to `main`, plus an advisory (report-only)
dependency-audit and secret scan.

---

## 🛡 Security

- **Per-request identity:** each request executes in the signed-in user's
  `AsyncLocalStorage` context and calls ADO with that user's token — the real API
  enforces every permission; nothing is bypassed.
- **CSRF:** state-changing requests must carry an `X-Requested-With` header (OWASP
  custom-header pattern); browsers can't set it cross-origin without a CORS preflight.
- **Headers:** CSP, `X-Content-Type-Options`, frame-deny, and HSTS-when-secure on
  every response, including the served SPA.
- **Rate limiting** on auth/token routes and on **all state-changing `/api` calls**
  (a generous per-IP ceiling that blunts runaway loops without throttling browsing);
  **CORS** restricted to configured/localhost origins (no wildcard).
- **Audit log:** every state-changing request is recorded to an append-only,
  per-user JSONL trail (method, route, status, latency — **no** tokens, bodies, or
  comment text) and surfaced under *Settings → Account → Recent activity*.
- **Sessions** carry a TTL and rotate their `sid` on re-auth; vault tokens are
  encrypted at rest with **AES-256-GCM**.
- **Access gate** re-checks MDE Linux group membership on every `/api` request.
- **Rich text** from ADO is sanitized with DOMPurify before rendering.
- **Merge** requires explicit confirmation (strategy, delete-source-branch, and an
  opt-in policy bypass) — it never merges silently.

---

## 🩺 Troubleshooting

| Symptom | Fix |
| --- | --- |
| *"Not signed in"* locally | Run `az login`, then reload. |
| 401 *token expired* when hosted | Paste a fresh token when the re-paste banner appears (see [Authentication](#-authentication--access-control)). |
| 403 *not a member of …* | Your account isn't in the `ALLOWED_GROUP` (MDE Linux). |
| `fetch failed` / connect timeout to ADO | IPv6 routing; the server already forces `ipv4first`. Check network/VPN and that the org URL is reachable. |
| Logins reset after a deploy | Set `DATA_DIR` to persistent storage (e.g. `/home/data`) and a stable `TOKEN_ENC_KEY`. |
| A project/repo/query won't add | Paste the **full URL**; it must belong to a monitored project/org. |
| Build fails with an old Node | Use Node ≥ 20 (`node -v`). |

---

## 🤝 Contributing

1. `npm run install:all`
2. Make focused changes; keep business logic in the pure `lib/` modules and add a
   `node:test` case beside it.
3. `npm run lint && npm test && npm run build` must pass before you push.

---

## 📄 License

Internal tooling — **not** licensed for external distribution. The Azure DevOps
organizations, groups, and projects referenced here are Microsoft-internal. Add a
`LICENSE` file before sharing this repository outside your organization.
