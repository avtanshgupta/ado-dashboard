# ADO PR Dashboard — Gap Analysis Report

**Scope analysed:** `/workspace/ado-pr-dashboard/` (server `~3,080` LOC Node/Express, web `~4,430` LOC React/Vite)
**Date:** 2026-07-18
**Method:** Full static read of every server + web source file, config, scripts and README; plus live validation — clean dependency reinstall, production build, server boot, and probing of `/api/health` (200), unauthenticated `/api/overview` (401) and header-less `POST /api/refresh` (403).

---

## 1. Executive summary

The dashboard is a well-structured, feature-rich, multi-user Azure DevOps PR/pipeline manager. The architecture is sound: per-request identity via `AsyncLocalStorage`, a bounded-concurrency + short-TTL ADO client with sensible retry/backoff, live group-membership gating, CSRF header defense, restricted CORS, and DOMPurify-sanitised markdown. It **builds and boots cleanly** and the documented security middleware behaves as advertised.

The gaps are concentrated in six areas that matter most for trusting this as a *system* you run day-to-day:

| # | Theme | Headline gap | Worst-case impact |
|---|-------|--------------|-------------------|
| A | **Quality engineering** | **Zero automated tests, no lint/CI/type-checking** | Any change can silently break merge/vote/mergeability logic |
| B | **Security** | **Live ADO bearer tokens stored in plaintext on disk**; **high-severity `nodemailer` CVEs**; no security headers / session expiry | Token theft ⇒ act as any user; email-based injection |
| C | **Scale & reliability** | **No pagination** (hard `$top` caps drop data); per-process cache/state breaks on >1 instance; heavy per-user notification polling | Wrong counts & missing PRs at team scale; ADO throttling |
| D | **Workflow coverage** | **Read-only reviewing** — can't reply to comments, resolve threads, or see the diff | Forced back into ADO for the most common review actions |
| E | **Analytics for "managing" ADO** | No PR cycle-time / review-aging / throughput metrics | Can't actually *manage* review flow, only view it |
| F | **Build/deploy/ops** | Node version mismatch, no Dockerfile/CI, single 750 KB bundle, no structured logging | Undocumented, fragile deployment |

Nothing here blocks personal single-user use today. Several items (B5, B6, C13) become important the moment this is hosted for the team.

---

## 2. What is already solid (context)

So the reader knows these were checked and are **not** gaps:

- Per-request auth isolation via `AsyncLocalStorage` (`lib/context.js`, `middleware/sessionContext.js`).
- ADO client with bounded concurrency, per-user short-TTL cache with FIFO cap, 429/5xx retry with jittered backoff, and **non-GET requests only retried on 429** to avoid double-submits (`lib/adoClient.js`).
- Live group-membership gate via IdentityPicker with stale-on-error reuse so a transient AAD hiccup doesn't lock everyone out (`lib/access.js`).
- CSRF via required `X-Requested-With` header + `SameSite=Lax` cookie; CORS restricted to configured/localhost origins, no wildcard (`middleware/csrf.js`, `index.js`).
- User markdown rendered through `marked` **then DOMPurify**, with links forced to `rel="noopener noreferrer" target="_blank"` (`components/ui.jsx`).
- Config writes are validated/normalised before persisting (`lib/userConfig.js`), and `sessions.js` persists atomically via tmp-file + `rename`.

---

## 3. Detailed gaps

Severity: **P0** = fix before/if hosted for others · **P1** = important · **P2** = quality/nice-to-have.
Each item cites concrete evidence.

### A. Testing & quality engineering

**A1 — No automated tests anywhere. [P1]**
No `*.test.*`/`*.spec.*` files, no test runner in either `package.json`. The most bug-prone logic is entirely uncovered: `mergeability()`, `reviewStatus()` (policy-aware approval ladder), `pipelineStatus()`, notification snapshot diffing (`notificationsService.poll`), and the pipeline timeline stage→job→task tree (`pipelineService.getRunDetail`). These encode subtle ADO semantics and will drift silently.
*Recommendation:* add Vitest (already Vite-native) for the web + Node's built-in `node:test` for the server; start with pure functions in `lib/mappers.js` and `services/*` (inject a fake `adoGet`). Aim for the mapping/gating logic first.

**A2 — No linter or formatter config. [P2]**
Source contains `// eslint-disable-next-line …` (e.g. `web/src/lib/useAsync.js`, `components/ui.jsx`) implying ESLint is expected, but there is **no `.eslintrc`, no Prettier config, and no `lint` script**. Style/quality is unenforced.
*Recommendation:* add `eslint` + `eslint-plugin-react(-hooks)` + Prettier and a `lint` script; wire into CI.

**A3 — No type safety. [P2]**
Plain JS maps large volumes of untyped ADO JSON. A field rename on the ADO side surfaces only as a runtime `undefined`. No JSDoc `@typedef` + `checkJs` either.
*Recommendation:* at minimum add JSDoc typedefs for the PR/run shapes and enable `checkJs`; ideally migrate `lib/` + `services/` to TypeScript.

**A4 — No CI/CD. [P1]**
No GitHub Actions / ADO pipeline YAML anywhere. Nothing runs build, lint, test, or `npm audit` on change — ironic for a tool whose job is surfacing CI health.
*Recommendation:* a minimal pipeline: `npm ci` (both packages) → build → lint → test → `npm audit --audit-level=high`.

### B. Security

**B5 — Live Azure bearer tokens persisted in plaintext. [P0 if hosted]**
`server/data/auth.json` stores each user's real ADO access token in cleartext (`lib/sessions.js` `persist()`, file mode `0o600`). Anyone with host/file/backup access — or a mis-set `DATA_DIR`, or a container-volume snapshot — obtains **live tokens usable as that user** against ADO. There is no encryption at rest and no OS-keychain option.
*Recommendation:* encrypt vault entries at rest (e.g. AES-GCM with a key from Key Vault / env), or store tokens only in memory and rely on the token-pusher to re-supply them; never persist raw JWTs.

**B6 — `nodemailer ^6.9.14` has a HIGH-severity advisory cluster. [P1]**
`npm audit` (server) reports SMTP command injection, CRLF header injection, TLS-cert-validation bypass, and SSRF/file-read (GHSA-mm7p-fcc7-pg87, -c7w3-x93f-qmm8, -vvjj-xcjg-gr5g, -r7g4-qg5f-qqm2, -p6gq-j5cr-w38f). Reachable via the email-notification path (`notificationsService.sendEmail`).
*Recommendation:* upgrade to `nodemailer@9.0.3+` and re-test email; treat notification recipient/`from` as untrusted.

**B7 — Dev-server advisory `esbuild ≤0.24.2` via `vite`. [P2]**
Moderate (GHSA-67mh-4wv8-2f99), dev-only. Low real-world risk but flagged by audit; the fix is a breaking `vite` major.
*Recommendation:* schedule the `vite`/`esbuild` bump; not urgent for production (dev-server only).

**B8 — Server-side sessions never expire and `sid` is not rotated. [P1 if hosted]**
`getSession()` returns a session with no TTL check; `createdAt` is stored but never used (`lib/sessions.js:89-98`). On `/api/auth/token` refresh the existing `sid` is reused, not rotated (`routes/auth.js:71-83`). A stolen cookie stays valid for the 30-day cookie window as long as the token-pusher keeps the vault warm — classic session-fixation exposure.
*Recommendation:* add an absolute + idle session TTL, rotate `sid` on privilege/token refresh, and prune expired sessions on load.

**B9 — No rate limiting / brute-force protection on auth. [P1 if hosted]**
`/api/auth/login` and `/api/auth/token` validate arbitrary pasted tokens with no throttle (`routes/auth.js`).
*Recommendation:* add per-IP/per-user rate limiting (e.g. `express-rate-limit`) on auth + mutating routes.

**B10 — No HTTP security headers. [P1 if hosted]**
No `helmet`: missing CSP, `X-Frame-Options`, HSTS, `X-Content-Type-Options`, `Referrer-Policy`. The app renders user-authored markdown, so a CSP is valuable defense-in-depth behind DOMPurify.
*Recommendation:* add `helmet` with a strict CSP; set HSTS when `COOKIE_SECURE=true`.

**B11 — `warmIdentity()` uses the local `az` CLI even when `DISABLE_AZ_FALLBACK=true`. [P2]**
`index.js:64` calls `warmIdentity()` unconditionally at boot; observed live — the server logged `Local az identity: Avtansh Gupta …` despite `DISABLE_AZ_FALLBACK=true`. The flag's contract ("never attempts the local fallback") is violated at startup (harmless in practice — it's only a warm-up log — but contradicts the documented behavior a hosted operator relies on).
*Recommendation:* guard `warmIdentity()` behind `!config.disableAzFallback`.

### C. Scalability & reliability

**C13 — No pagination: hard `$top` caps silently drop data. [P1]**
No `continuationToken`/`$skip` handling anywhere (verified). Caps: Created list `$top=50`, Assigned `$top=100`, shared active-PR fetch `$top=500`, Overview all-status `400/200/150` (`services/prService.js`). A repo with >500 active PRs, or an author with >50 open / >200 historical PRs, **silently loses the remainder** — lists *and* overview counts become wrong with no indication.
*Recommendation:* follow ADO `continuationToken` (or `$skip` loop) until exhausted, and/or surface a "results truncated" flag to the UI.

**C14 — Per-process cache, rate limiter, and membership cache preclude horizontal scaling. [P1 if hosted]**
`limit`, `cache`, `groupCache`/`memberCache`, and all file state are in-process (`lib/adoClient.js`, `lib/access.js`). Azure App Service scales out by default; multiple instances ⇒ split-brain cache, duplicated membership lookups, and notification-snapshot divergence. Sticky sessions are required but undocumented.
*Recommendation:* document single-instance requirement, or externalise cache/state (Redis) and make the notification poller shared.

**C15 — Notification polling is O(users × repos × PRs) every 2 min. [P1 if hosted]**
`NotificationBell` polls every 120s; each poll runs `snapshotState()`, which enriches created + assigned + **all team** PRs across **all** repos with per-PR threads + policy calls (`services/prService.js:439`, `notificationsService.poll`). Every user independently re-enriches the whole team surface. This will hit ADO throttling as the team/repo count grows.
*Recommendation:* a single shared server-side poller per repo feeding all users; diff per-user from a shared snapshot; back off adaptively.

**C16 — File-state writes are not atomic/locked (except sessions). [P1]**
`lib/userConfig.js` (`saveUserConfig`) and `services/notificationsService.js` (`save`) use direct `writeFileSync` with read-modify-write and **no locking or tmp+rename**. Concurrent notification polls and a Settings save (or two tabs) can interleave into a torn/last-writer-wins file. (`sessions.js` already does tmp+rename — apply the same pattern.)
*Recommendation:* write via tmp-file + `rename` everywhere; consider a per-user in-process mutex, or move to SQLite. *(Note: `node:sqlite` needs Node 22.5+, so on Node 20 a native/`better-sqlite3` module is required.)*

### D. Functional / workflow coverage ("manage my ADO")

**D17 — Reviewing is read-only: no comment reply / new comment / thread resolve. [P1]**
Threads render read-only (`pages/PrDetail.jsx`); there is no endpoint to POST a comment, reply, or set thread status (`fixed`/`active`). A tool that can merge, vote, and manage reviewers but **can't reply to or resolve a review comment** forces the user back into ADO for the single most common review action.
*Recommendation:* add `POST …/threads/{id}/comments` and `PATCH …/threads/{id}` (status) endpoints + inline UI.

**D18 — No diff / file view. [P1]**
"Files changed" is a bare count (`fetchFilesCount`); there's no way to see the actual code change. Reviewers must leave to read the diff.
*Recommendation:* surface iteration changes + per-file diff (ADO `…/iterations/{id}/changes` + item content), at least a lightweight unified diff.

**D19 — No PR creation, and no editing of title/description/labels/target branch. [P2]**
Only management of existing PRs. Labels are read-only (fetched, never mutated); no create-PR flow.
*Recommendation:* add create-PR + edit title/description + add/remove label endpoints.

**D20 — Team-member matching is fragile / identity-heuristic. [P1]**
`listTeam` matches `createdBy.uniqueName` (email) against the team set (`services/prService.js:273`), while reviewer-group matching splits `displayName`/`uniqueName` on `\\` (`reviewerGroupName`). Both rely on string/domain heuristics rather than the canonical identity GUID (which reviewers *do* use). AAD-backed identities whose `uniqueName` isn't the plain email will be missed from Team PRs.
*Recommendation:* resolve configured team members to identity GUIDs (as reviewers already are) and match on `createdBy.id`.

**D21 — Global search only covers already-loaded, capped lists. [P1]**
`searchAll` (`lib/filters.js:90`) searches the in-memory buckets only — i.e. the capped Created/Assigned/Team lists currently on screen. It cannot find a PR that wasn't already fetched (older, closed, other authors), so "global search across PRs & pipelines" is really "filter the current view."
*Recommendation:* back search with an ADO PR search query (by id/title/author/branch) server-side.

**D22 — Notification event coverage misses author-critical events. [P2]**
Current triggers: new team/assigned PR, active-comment delta, review-status change, pipeline pass/fail, PR closed (`notificationsService.poll`). Missing the events an author most wants: "changes requested on MY PR," "my PR is now mergeable," "auto-complete merged it," "merge conflict appeared," "required reviewer added/removed."
*Recommendation:* extend the diff to author-centric transitions.

**D23 — No Teams/Slack/webhook or browser push. [P2]**
Only in-app bell + optional SMTP (which is the vulnerable path, B6). A team living in Teams has no channel.
*Recommendation:* add an outgoing webhook (Teams/Slack incoming-webhook) as an alternative to SMTP.

### E. Analytics & reporting (the "management" goal)

**E24 — No PR-flow analytics (cycle time, time-to-first-review, time-to-merge, throughput). [P1]**
Analytics exist only for pipelines (success rate, mean/median duration, flaky detection — `pipelineAnalytics`). There are **no PR-flow metrics**, which are the core of "managing" review velocity.
*Recommendation:* compute time-to-first-review, time-to-merge, and merged-per-week from PR + thread timestamps.

**E25 — No reviewer-workload / PR-aging / stale-PR view. [P1]**
"Awaiting my review" is a single count on the overview (`getProjectSummary.awaitingMyReview`) with no aging buckets, no "waiting on me > N days," no stale-PR surfacing.
*Recommendation:* add aging buckets and a "needs attention" list sorted by idle time.

**E26 — Merged PRs excluded from overview counts. [P1]**
`getOverview` intentionally skips `Merged` (`services/prService.js:291`). Throughput / merged-per-week — a key management KPI — is therefore unavailable from the overview.
*Recommendation:* add a Merged series (respecting the time window) for throughput.

### F. Build, deployment & operations

**F27 — Node version mismatch: README says 18, a dependency requires 20. [P1]**
README/Quick-start requires "Node.js 18+", and the environment runs **v18.19.1**, but `web` depends on `marked@^18`, whose `package.json` declares `engines.node: ">= 20"`. It imports/builds today (engines is advisory), but the app is on an unsupported runtime and the next `marked`/`vite` bump will hard-break it.
*Recommendation:* require **Node 20+** in README + add `"engines": { "node": ">=20" }` to the packages, and pin CI to Node 20.

**F28 — Cross-platform `node_modules` breaks the build; no `npm ci`. [P1]**
The shipped/installed `web/node_modules` failed to build on Linux (`Cannot find module '@rollup/rollup-linux-x64-gnu'`, the well-known npm optional-dep bug) until a clean `rm -rf node_modules package-lock.json && npm install`. Nothing documents this, and `npm ci` isn't used.
*Recommendation:* use `npm ci` in install docs/CI; note the platform-specific optional-dependency caveat.

**F29 — No Dockerfile / container / IaC / deploy manifest. [P1]**
README references Azure App Service and `DATA_DIR=/home/data` but ships **no Dockerfile, no deploy workflow, no `az webapp` recipe**. Deployment is manual/undocumented.
*Recommendation:* add a multi-stage Dockerfile (build web → serve from server) + a deploy workflow; document persistent-volume + single-instance requirements.

**F30 — No structured logging, request IDs, or metrics. [P2]**
Only `console.*` and a trivial `/api/health`. For a multi-user hosted service there's no log level, correlation id, or metric.
*Recommendation:* add a structured logger (pino) with request ids; expose a readiness endpoint.

**F31 — Single 750 KB JS bundle, no code-splitting. [P2]**
Production build emits one `~750 KB` (`216 KB` gzip) chunk incl. Recharts; Vite warns >500 KB. No lazy routes.
*Recommendation:* `React.lazy` per route and/or `manualChunks` to split Recharts.

### G. Correctness bugs & edge cases

**G32 — Overview "Open" counts undercount long-lived open PRs. [P1]**
`within(pr)` uses `closedDate || creationDate`; for an active PR `closedDate` is null, so it falls back to **creationDate** (`services/prService.js:286`). An still-open PR created before the window is dropped from the Open/Draft counts even though it's currently open. Open state should not be time-windowed by creation date.
*Recommendation:* count active PRs regardless of age (or window by `lastActivity`), and only window closed/merged by their close date.

**G33 — `fetchFilesCount` caps at the last iteration's `$top: 2000` changes. [P2]**
Very large PRs (>2000 changed items) undercount, and single-iteration counting can differ from ADO's own file count (`services/prService.js:62`).
*Recommendation:* paginate iteration changes, or read ADO's provided change count.

**G34 — `decodeTokenExpiry` fallback is optimistic. [P2]**
A pasted token without a decodable `exp` gets an 80-min assumed expiry (`routes/auth.js:50`); if it actually expires sooner the next call 203s (handled) but the UI shows "authenticated" until then.
*Recommendation:* reject tokens whose `exp` can't be parsed, or shorten the assumed lifetime.

---

## 4. Prioritised remediation roadmap

**P0 — do before hosting for anyone else**
- B5 Encrypt/stop persisting raw tokens.

**P1 — important (correctness, security-at-scale, core workflow)**
- Security: B6 nodemailer upgrade · B8 session TTL+rotation · B9 auth rate-limit · B10 helmet/CSP.
- Correctness/scale: C13 pagination · C16 atomic file writes · G32 open-count window · D20 identity-GUID team matching.
- Scale-if-hosted: C14 shared cache/state · C15 shared notification poller.
- Workflow/analytics: D17 comment/resolve · D18 diff view · D21 real search · E24/E25/E26 PR-flow + aging + throughput.
- Quality/ops: A1 tests (mappers/gating first) · A4 CI · F27 Node 20 · F28 `npm ci` · F29 Dockerfile.

**P2 — quality & nice-to-have**
- A2 ESLint/Prettier · A3 types · B7 vite/esbuild bump · B11 warmIdentity guard · D19 create/edit PR · D22 richer events · D23 Teams/Slack webhook · F30 structured logging · F31 code-splitting · G33 file-count pagination · G34 token-expiry strictness.

---

## 5. Appendix — validation performed

| Check | Result |
|-------|--------|
| Clean `npm install` (web) | OK after removing cross-platform `node_modules` (F28) |
| `npm run build` (web) | OK — `dist/…` emitted; single 750 KB chunk warning (F31) |
| Server boot (`DISABLE_AZ_FALLBACK=true`) | OK — but warmed local `az` identity anyway (B11) |
| `GET /api/health` | `200 {ok:true}` |
| `GET /api/overview` (no auth) | `401` (as designed) |
| `POST /api/refresh` (no CSRF header) | `403 code:csrf` (as designed) |
| `npm audit` web / server | 1 moderate (esbuild/vite) / 1 high (nodemailer) |
| Pagination scan (`continuationToken`/`$skip`) | none found — confirms C13 |
| Test-file scan | none found — confirms A1 |

*Note:* validating the build required a clean reinstall of `web/node_modules` (and regenerated `web/package-lock.json`); this replaced a cross-platform-broken install with a working one.

---

## 6. Remediation status (this change set)

The following were **fixed and validated** (full test suite `30 passing`; `npm run lint` clean; web build ✓; server boot + probes ✓; server `npm audit` = 0 vulnerabilities):

| Gap | Fix |
|-----|-----|
| **B5** token plaintext | New `lib/crypto.js` (AES-256-GCM, lazy key from `TOKEN_ENC_KEY` or auto keyfile). `sessions.js` encrypts the vault at rest and **migrates** any legacy plaintext token on load (verified: plaintext → `v1:…` on disk). |
| **B6** nodemailer CVEs | Upgraded `nodemailer` → `^9.0.3`; server audit now clean. |
| **B8** session lifetime | Absolute (7d) + idle (2d) TTL, `isSessionExpired()`, prune on load/read, and **sid rotation** on token refresh (`rotateSession`). |
| **B9** brute force | Hand-rolled `middleware/rateLimit.js`; applied to `/auth/login` + `/auth/token` (60 / 5 min per IP). Verified 429 after the cap. |
| **B10** headers | `middleware/securityHeaders.js`: CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, HSTS-when-secure. Verified on responses. |
| **B11** az warm-up | `warmIdentity()` skipped when `DISABLE_AZ_FALLBACK=true`. Verified in boot log. |
| **C13** pagination | `fetchPRs` now `$skip`-pages to completion (bounded); active fetch pages fully; list/overview caps raised. |
| **C16** torn files | `lib/atomicFile.js` (tmp+rename); used by `sessions`, `userConfig`, `notificationsService`. |
| **G32** open-count | Active PRs counted regardless of age; only terminal PRs windowed by close date. |
| **G34** token expiry | Reject tokens whose `exp` can't be decoded (no more optimistic 80-min guess). |
| **E26** throughput | Overview now emits a `Merged` series (windowed by close date) + per-repo "My merged" + category cards. |
| **D17** read-only review | New endpoints (`POST …/threads`, `POST …/threads/:id/comments`, `PATCH …/threads/:id`) + PrDetail UI to **comment, reply, and resolve/reactivate** threads. |
| **F27** Node version | `engines.node >=20` on all packages; README prerequisite updated. |
| **A1** no tests | `node:test` suites (30 tests): crypto round-trip/tamper, mappers gating logic, session TTL, web filters. |
| **A2** no lint | Flat `eslint.config.js` (+ react/react-hooks); `npm run lint` (fixed JSX false positives via `jsx-uses-vars`). |
| **A4** no CI | `.github/workflows/ci.yml` — install → lint → test → build → audit on Node 20. |
| **F29** no container | Multi-stage `Dockerfile` + `.dockerignore` (build SPA → serve from server; persistent volume; token-key guidance). |

**Deferred** (larger features or breaking, tracked for follow-up): B7 vite/esbuild major (dev-only; CI audits prod deps via `--omit=dev`); C14/C15 shared cache + notification poller (needs Redis / architecture — document single-instance until then); D18 diff view; D19 create/edit PR; D20 full identity-GUID team matching; D21 server-side search; D22 richer events; D23 Teams/Slack; E24/E25 PR-flow + aging analytics; A3 TypeScript; F30 structured logging; F31 code-splitting; G33 file-count pagination.
