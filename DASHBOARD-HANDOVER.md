# Admin Dashboard — Session Handover

**Written:** 2026-08-13 · **For:** the next session picking up the SBIBot admin dashboard build.
**One-line status:** All planning is done and filed as GitHub issues. **No dashboard code exists yet.** Start by building issue **#114**.

---

## 1. Start here (TL;DR)

1. Read the parent PRD **#113** (`gh issue view 113 --comments`) — includes a design-update comment with the v2 forward-compat decisions.
2. Build **issue #114** first — the walking skeleton. It unblocks everything else.
3. Work **TDD-first** (this repo has a `tdd` skill and 278 existing tests): write `lib/dashboard/auth.js` + `lib/audit-log.js` tests → make them pass → then the server/skeleton.
4. **Do NOT start v2 (#122).** It's blocked on v1 and has an explicit "revisit after v1" gate.

---

## 2. What this project is

An **admin dashboard for the SBIBot Discord bot** (a headless bot for Strange Bird Immersive on Railway). It's a lean, single-operator (Allen only) web app **embedded inside the bot process** — the only place with both the live `discord.js` client and the SQLite handle. Server-rendered Express, no SPA/build step, single secret-token login over Railway's HTTPS.

- **v1** makes the bot **observable** (health, roster gaps, coverage, check-ins) + a few safe control actions.
- **v2** (later) makes it **operable** — a messaging console, scheduled sends, CRUD, reporting.

Full design lives in the PRDs and in project memory (`memory/project_admin_dashboard_prd.md`).

---

## 3. Issue map

| Issue | What | Type | Blocked by |
|---|---|---|---|
| **#113** | Parent PRD (v1) | — | — |
| **#114** | Walking skeleton: server + token auth + live health page + **foundations** (audit_log, login-alert, rate-limit middleware, modular routing, adapter-only Discord, CSRF) | 🟡 HITL | — |
| **#115** | Observability: `job_runs` + `recordJobRun` (wrap 7 crons) + error buffer + health enrichment | 🟢 AFK | #114 |
| **#116** | Link health + roster panel + link management (audited) | 🟢 AFK | #114 |
| **#117** | Coverage board panel | 🟢 AFK | #114 |
| **#118** | Check-in reliability history panel | 🟢 AFK | #114 |
| **#119** | Today-at-a-glance panel | 🟢 AFK | #114 |
| **#120** | Config toggles & settings control (audited) | 🟢 AFK | #114 |
| **#121** | Manual job triggers, confirm-gated (audited) | 🟡 HITL | #114, #115 |
| **#122** | **v2 PRD** — operations console | — | ⛔ all of v1; **revisit before building** |

**Dependency shape:**
```
#114 (skeleton + foundations) ──┬── #115 (observability) ──── #121 (job triggers)
                                ├── #116  #117  #118  #119  #120   ← all parallel
```
`#114` is the only blocker for the 3–7 fan-out. Once it lands, #116–#120 can all be built in parallel.

---

## 4. Building #114 — the critical path

**Deep modules to build + unit-test** (mirror the repo's existing patterns):
- `lib/dashboard/auth.js` — **pure**: `verifyToken(provided, secret)` (timing-safe), `signSession(secret)` / `verifySession(cookie, secret)`.
- `lib/audit-log.js` — `record(action, params, result, messageId?)` + reads. **Include a `message_id` column** (v2's undo depends on it). Mirrors `lib/job-runs.js` (which #115 builds — follow the same shape).

**Also in #114 (foundations, deliberately front-loaded for v2):**
- Embedded Express via `makeDashboardServer({ discord, repo, config, ... })` — `discord` is the **`makeDiscordAdapter` instance, never the raw client**.
- General **rate-limit middleware keyed by action** (used for login now; reused for sends in v2).
- **Modular, feature-grouped routing** (a router per feature).
- **CSRF + SameSite=strict**; state changes are POST-only.
- **Login-alert:** bot DMs Allen on login via `adapter.sendDM` — a tripwire AND early proof of the dashboard→Discord send path v2 needs.
- One authenticated health page: live uptime + Discord connection status.
- Responsive base CSS (phone-friendly) + auto-refresh scaffolding.

**⚠️ One-time HITL setup gate (Allen must do this to verify #114):**
- Set `DASHBOARD_SECRET` in Railway.
- Enable a public domain for the Railway service + bind `process.env.PORT`.
- Confirm login (and the login-alert DM) work over the real HTTPS URL.
The bot may currently run as a Railway service with no exposed port — this is the step that changes that.

---

## 5. Architecture facts the new session must know

(Most are in `CLAUDE.md` — read it. Highlights that matter for the dashboard:)
- **SQLite:** `node:sqlite` (Node 24 built-in), NOT better-sqlite3. Schema + all queries in `lib/db.js`. Tests use `DB_PATH=':memory:'`.
- **Adapter injection is the house style:** `lib/adapters/discord.js` (`makeDiscordAdapter`) already exposes `sendMessage`, `sendDM`, `editMessage`, `fetchChannel`, `fetchMessage`, `fetchUser`, `fetchGuildRoles`, `fetchGuildMembers`. Route ALL dashboard Discord I/O through it. `lib/adapters/bookeo.js` wraps the (5-min cached) Bookeo feed.
- **Repository pattern:** `lib/coverage-repository.js` wraps `db.js` with clean names. Build `lib/dashboard-repository.js` the same way — as a **general data layer (reads + writes)**.
- **Typed config:** `lib/config.js` — never construct `bot_config` key strings directly.
- **Tests:** `node --test test/*.test.js` (`npm test`). Conventions: `node:test` + `node:assert/strict`, in-memory DB, stub adapters in `test/helpers/adapters.js`, pure "plan" functions tested directly (see `planLatebookingChecks` in `test/scheduler.test.js`).
- **Timezone:** `America/Chicago`; use `utils.todayCentral()`, never raw `new Date()` for "today".
- **Server mount point:** `index.js` after `Events.ClientReady` (where `scheduler.start(client)` is called).

---

## 6. Rules (from RULES.md / memory / CLAUDE.md — follow these)

- **Investigate → plan → get approval before writing code.** Don't start implementing without an OK.
- **No "Co-Authored-By" lines in commit messages** — ever, for this repo.
- **Ask before deleting/modifying** anything intentionally added (e.g. diagnostic logs).
- Commands are guild-scoped: re-run `node deploy-commands.js` on any command add/rename/option change (dashboard adds no slash commands, but keep in mind).
- Ephemeral replies use `flags: MessageFlags.Ephemeral` (not deprecated `ephemeral: true`).
- Railway auto-deploys on push to `main`; pre-deploy runs `node deploy-commands.js`.

---

## 7. v1 forward-compat already baked in (don't undo it)

During planning, v1 issues were adjusted so v2 bolts on cleanly (see the #113 design-update comment). Key points already in the issues:
- `audit_log` table + `lib/audit-log.js` live in **#114**; every write action (#116 links, #120 config, #121 triggers) writes through to it.
- The confirm flow (built in **#121**) must be a **reusable** preview→confirm→execute pattern, not a one-off — v2 reuses it everywhere.
- `dashboard-repository.js` is a general data layer, not read-models only.

---

## 8. Do NOT build v2 yet

**#122 is the v2 PRD, and it carries a hard "revisit after v1" gate.** It was filed to capture the design while fresh. Before ANY v2 work: build all of v1, then run the revisit checklist in #122 (confirm the real audit_log schema, the real confirm-flow shape, the final adapter surface, actual thresholds), THEN decompose v2 into issues via `prd-to-issues`. The **cast activity/coverage ledger** is parked inside #122 on a data-availability question (no historical shift ledger; Bookeo feed is rolling-week only) — needs J Cameron Cooper input before it's feasible.

---

## 9. Pointers

- PRDs: **#113** (v1), **#122** (v2). v1 slices: **#114–#121**.
- Memory: `memory/project_admin_dashboard_prd.md` (full design + issue list + v2 notes), `memory/project_sbibot.md` (overall project state), `memory/MEMORY.md` (index).
- Repo docs: `CLAUDE.md`, `STATUS.md`, `RULES.md`, `COMMANDS.md`.
