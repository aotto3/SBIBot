# CLAUDE.md

See RULES.md for operational rules with feedback tracking.

## Commands
- Start: `node index.js` / `npm start`
- Register commands: `node deploy-commands.js` / `npm run deploy-commands` — re-run on any add/rename/option change
- Tests: `npm test` (runs all `test/*.test.js` — 18 files, 365 tests). `checkin.js` alert/retry timers are `.unref()`'d (and the 20s seed-timeout is cleared), so the runner exits on its own — no `--test-force-exit` needed.

## Env vars
DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, BOOKEO_API_URL, BOOKEO_API_KEY
DB_PATH: `../db.sqlite` (local) | `/data/db.sqlite` (Railway)

## Docx editing (Windows)
- XML edits: Node.js script files only — no sed/awk/perl (multi-line corruption risk)
- `/tmp` → `C:\Users\Allen\AppData\Local\Temp` — run `cygpath -w /tmp/dir` before passing to Node
- Before any replace: `grep -c 'pattern' file` must return 1; abort if 0 or 2+
- `pack.py`: always `--validate false` (validator crashes on cp1252/Unicode bug on this machine)

## Architecture
`commands/*.js` → `lib/{db,meetings,bookeo,shows,rsvp,coverage,coverage-repository,coverage-session,coverage-jobs,coverage-stats,confirm,utils,checkin,scheduler,owner}.js`

- SQLite: `node:sqlite` (Node 24 built-in) — NOT `better-sqlite3` (native compile fails on Railway)
- Commands: guild-scoped (instant). Re-run `deploy-commands.js` on any change.
- `Routes`: `require('discord-api-types/v10')` — NOT `@discordjs/rest`
- Ephemeral replies: `flags: MessageFlags.Ephemeral` — `ephemeral: true` is deprecated; fix when touching files that still use it
- GuildMembers intent: privileged — enabled in `index.js` AND Discord Developer Portal
- Timezone: `America/Chicago`. `utils.todayCentral()` for today's date string — never `new Date()` raw
- `postMeetingReminder`: throws on channel errors — callers must try/catch
- Bookeo API: 5-min cache (Map keyed `from|to`), 15s axios timeout
- bookeo-asst: ignores `to` param, returns full week. Filter client-side: `shifts.filter(s => s.date >= from && s.date <= to)`

## Meeting reminders
- `'created'`: immediate, RSVP reactions (✅❌❓) + live tracker
- `'7d'`/`'24h'`: no reactions added; @mentions ✅/❓ reactors from created post; links back to it
- DB: `meeting_reminders_sent(meeting_id, instance_date, reminder_type, message_id)` — all 3 types stored
- `TRACKER_MARKER = '\n\n​'` — zero-width space; splits header from live tracker in all post types
- `lib/meetings.js` exports: `buildMeetingReminderContent`, `buildFollowupReminderContent`, `buildCancelledPostContent`, `fetchAttendeeIds`, `db.getCreatedReminderRecord`
- Cancel: edits all `'created'` posts (strikethrough + cancelled notice, preserves existing tracker if present); posts new notice linking to most recent `'created'` post

## RSVP tracker
- `lib/rsvp.js`: `handleReactionChange()` handles `MessageReactionAdd`/`MessageReactionRemove` → DB lookup → `editTracker()` in place
- `fetchReactorNames(msg, emojiName)`: `.find(r => r.emoji.name === emojiName)` — works for unicode + custom emojis

## Cast members
- `member_links` table: `bookeo_name` ("Allen Otto") → Discord user ID
- `db.getMemberFirstName(discordId, fallback)` → first word of `bookeo_name`; used for alert messages
- `members.getDisplayName(userId, fallback)` → used in RSVP tracker display
- Unlinked cast: silently skipped (console warning + error channel if configured)

## Shows (`lib/shows.js`)
- Shows: MFB, GGB, Endings, Lucidity
- Each: `label`, `autoRole?`, `discordRoles`, `emojis {yes/maybe/no}`, `roleGroups` (MFB only), `checkin?` (GGB/Lucidity/Endings only)
- `showCharacters(key)`: `['Daphne','Houdini']` (MFB) | `['HR','Author']` (Endings) | `null` (single-role)
- Custom emojis (MFB only), case-sensitive: `Dno`, `Hno`, `Dmaybe`, `Hmaybe`
- `autoRole`: GGB→Mikey, Lucidity→Riley
- Add show: add entry to `SHOWS` in `lib/shows.js`; also update abbreviation map in `lib/bookeo.js` and `SHOW_GROUPS` in bookeo-asst `upcoming.py`

## Coverage requests
- Channel keys: `coverage_channel_{SHOW}` | `coverage_channel_{SHOW}_{CHARACTER}`
- `/coverage-request`: character required when `showCharacters(show)` is non-null (MFB/Endings); `customId: coverage_request_modal:{SHOW}:{CHARACTER}`
- Posts always edited, never deleted (exception: `/cancel-custom-game` slash cmd deletes; `/open-coverage` button edits)
- `planShiftCancel` → `delete-all` | `edit-header` | `delete-shift`
- `analyzeCoverage(guild, yesUsers, showKey, character?)` in `coverage.js` → `{ isFilled, missingRoles, availableByRole, showType }` — single source of truth for fill detection; used by `rsvp.js`, `coverage-jobs.js`
- Confirm button: `confirm_coverage:{type}:{id}` → original message fetched via DB (channel+messageID) → reactions fetched from Discord
- Multi-role confirm: `handleMultiRoleButton` → `coverage-session.js` (`setMultiRoleSelection` per dropdown) → `cmr_submit:{gameId}` → `planMultiRoleConfirm` → execute
- Multi-role sessions: DB-backed (`coverage_confirmation_sessions` table); 30-min expiry checked at read time; startup deletes sessions older than 30 min; expired session shows ephemeral error in confirm flow
- After confirm: if all request shifts resolved → `buildResolvedHeaderPost()`
- `/purge` (ManageGuild): hard-deletes `Coverage Shift` or `Custom Game` + post
- **Requester exclusion:** 8am role-ping cron skips the coverage requester (they know already); stored as `requester_discord_id` on `coverage_requests`
- **All-responded DMs:** when every cast member has reacted (all ✅/❌), bot DMs both the requester and the coverage manager. If no one said yes, it suggests reaching out to swings and (in the requester DM) contacting the cast manager. Manager DM includes requester name.
  - `buildAllRespondedDM(exhaustedRoles, show, dateTimeStr, postLink, recipient, maybeNames=[], requesterName=null)` in `coverage.js`
  - `recipient`: `'requester'` | `'manager'`; manager variant includes `requesterName` line if provided
- **Coverage DB layer:** `lib/coverage-repository.js` wraps all coverage-related `db.js` calls with clean named methods (e.g. `repo.getOpenShifts()`, `repo.confirmShift()`). All coverage callers (`rsvp.js`, `coverage-jobs.js`) use repo — not `db` directly.
- **Coverage cron jobs:** `lib/coverage-jobs.js` exports `runCoverageRolePings(discord, repo)` (8am role pings) and `runEodCoverageReminder(discord, repo)` (9pm EOD DM to cast manager). `scheduler.js` imports and calls them, passing the module-level `repo`.
- **Outstanding list (`/list-outstanding-requests`, PRD #124 / slices #125–#127):** admin (ManageGuild), ephemeral, read-only embed list of everything still outstanding — open coverage shifts + custom games that are not cancelled, not filled/confirmed, and dated today-or-later. Optional `show` option filters to one show (omit = all). One embed per show; coverage shifts and games interleaved soonest-first; 🔴 needs coverage / unfilled, 🟡 ready to fill / filled — awaiting confirmation; each row carries a type+ID (`Shift #N`/`Game #N`), requester (name for coverage, `<@id>` for games), and a jump link (shift post → header fallback). Distinct from `/open-coverage`, which carries Cancel/Confirm buttons — this one is a filterable read-only view with links. Data: `repo.getOutstandingShifts(today, show?)` / `repo.getOutstandingGames(today, show?)` → `db.getOutstandingCoverageShifts` / `db.getOutstandingCustomGames` (date-filtered; the 8am-ping queries `getOpenShifts`/`getOpenGames` are deliberately left untouched). Pure render: `coverage.buildOutstandingEmbeds(shifts, games, guildId, showFilter)` (grouping, sort, status/emoji, links, 4096-char "…and N more" clamp) + `coverage.buildOutstandingEmptyState(showLabel?)`.

## Coverage stats (`/coverage-stats`, PRD #143)
- **Owner-only** admin command — a running log/report of coverage requests & covers. Gate: `owner.isOwner(interaction.user.id)` (single source of truth `owner.OWNER_DISCORD_ID`, reused by `index.js`, `dm-channels.js`, `job-notifier.js`); `default_member_permissions = Administrator` hides it in the UI but the ID check is the real gate. Ephemeral.
- **Deep module `lib/coverage-stats.js`:** `computeCoverageStats(rows, opts)` (pure — operates on Discord IDs) + `buildStatsEmbeds(stats, { resolveName, ... })` (pure render, name resolver injected) + `buildStatsEmptyState()`. Data: `repo.getStatsShiftRows()` → `db.getCoverageStatsShiftRows()` (all shifts, every status, joined with request info; fully retroactive).
- **Slice 1 (#144) = leaderboard:** per-person covers (`confirmed_taker_id`), requests (shifts only, cancelled counted separately as `requestsCancelled`), give/take ratio (`covers/requests`, null when 0 requests).
- **Slice 2 (#145) = fill rate:** `computeCoverageStats` returns `fillRate: { overall, byShow }` where each bucket is `{ covered, cancelled, unfilledPassed, coveredPct }`. Classification: `covered`/`cancelled` by status; open shift → `unfilledPassed` only once its `date+time` has passed (else pending, excluded). Cutoff via injected `opts.now` compared as a Central-time `YYYY-MM-DD HH:MM` stamp (`_centralStamp`). `coveredPct = covered / (covered + unfilledPassed)` (cancelled excluded). Rendered as a `📊 Fill rate` embed field (overall + per-show), omitted when nothing is resolved. Shifts only — games in #149.
- **Slice 3 (#146) = timing:** `computeCoverageStats` returns `timing: { timeToCoverage: { medianHours, avgHours, count }, leadTime: { medianDays, avgDays, count } }`. Time-to-coverage = `confirmed_at − request_created_at` (hours, covered shifts only) — labeled *request → confirmed* since it's confirm time, an upper bound on true response time. Lead time = request→showtime in whole calendar days (`_calendarDaysBetween` on Central dates, all shifts). Median/average guard empty input (null). Rendered as an `⏱️ Timing` field.
- **Slice 4 (#147) = most-needed:** `computeCoverageStats` returns `mostNeeded: { byShow, byCharacter, byWeekday }` — requested shifts grouped and ranked most-first. `byCharacter` includes only rows with a non-null character (multi-role shows); weekday via `_weekdayIndex` (UTC-midnight `getUTCDay`, tz-stable). Rendered as a `🔥 Most-needed` field (by show / by weekday / by character), each line capped at top 6.
- **Slice 5 (#148) = filters + person detail:** command options `show` (choices), `person` (User), `since` (date; parsed via `utils.parseDate`, invalid → ephemeral error). `computeCoverageStats(rows, { show, since, person, now })` applies show+since to all sections (`_applyRowFilters`); `person` produces a scoped `stats.person` detail (`covers`, `requests`, `requestsCancelled`, `ratio`, `coversByShow`, `requestOutcomes`, `responseTime`, `leadTime`) rendered as its own embed instead of the leaderboard. Global title carries a show/since suffix; `stats.filters` echoes the active filters.
- Remaining slices per PRD #143: custom-game taker logging + games in stats (#149).
- Unlinked members render as a Discord mention (`members.getDisplayName(id, `<@${id}>`)`).

## Job failure notifications & recovery (issue #131)
- **`lib/job-notifier.js`:** `runJob(label, fn, notify)` wraps every cron handler — catches throws (hard failure) AND inspects the returned `{ planned, sent, failed[] }` summary (partial failure, e.g. "sent 1 of 11"); either fires one notice per run and never rethrows (so sibling jobs continue). `buildJobOutcomeNotice(outcome)` (pure) formats hard vs partial. `notifyJobOutcome(discord, outcome, { opsContactId, errorChannelId })` DMs the ops contact **and** posts to the error channel (each guarded independently).
- **Job registry:** `scheduler.buildJobRegistry({ discord, repo, bkAdapter, client, notify })` → `key → { label, run }`. Single source shared by the cron wiring, the notifier (job names), and `/rerun-job`. Keys: `meeting-reminders`, `coverage-pings`, `custom-game-reminders`, `eod-reminder`, `maybe-nudge`, `shift-dms`, `latebooking`, `checkin-seed`.
- **Partial-failure summaries:** the 4 batch senders (coverage role-pings, custom-game reminders, shift DMs, late-booking DMs) return `{ planned, sent, failed: [{ id, type, reason }] }`. Late-booking DMs fire from timers, so `notify` is threaded `runLatebookingSeed` → `_scheduleLatebookingCheck` → `runLatebookingCheck`.
- **Ops contact:** `cfg.getOpsContactId()` (config `ops_contact_id`, defaults to owner `ALLEN_DISCORD_ID`) / `/set-ops-contact` (ManageGuild). `DEFAULT_OPS_CONTACT_ID` lives in `job-notifier.js`.
- **`/rerun-job` (ManageGuild):** re-runs any registry job on demand, reports sent/failed/skipped ephemerally (no redeploy). Coverage-pings supports `mode` (all | smart) + `preview`. `planCoveragePingTargets(plan, alreadyPingedIds, mode)` (pure): "smart" skips posts already pinged today (via `db.getCoveragePingedMessageIdsSince(cutoff)`, cutoff = today's Central midnight); "all" keeps every still-missing post. `runCoverageRolePings(discord, repo, { mode, preview, alreadyPingedMessageIds })` — the scheduled 8am path passes no opts (all / no preview, unchanged).
- Two new slash commands (`/rerun-job`, `/set-ops-contact`) → re-run `deploy-commands`.

## Check-in system
- Config: `lib/shows.js` `checkin: { roles, callTimeOffset: -30 }` per show
- Eligible: GGB (Mikey), Lucidity (Riley), Endings (HR role only) — MFB excluded (no checkin block)
- `checkin_records`: `id, shift_date, show, bookeo_name, discord_id, call_time (unix), checked_in_at, alert_message_id, alert_channel_id, forced_by`
- Seed: `seedAndScheduleToday()` → `seedToday(client)` → `groupEligibleShifts()` (dedup by person+show+date, keep earliest time) → upsert → `scheduleAlerts(client, records)`
- `seedToday(client, { _bookeo })` and `scheduleAlerts(client, records)` are exported separately for testing (dependency injection via `_bookeo`)
- `scheduler.start()` called AFTER `seedAndScheduleToday()` resolves (prevents 9am cron race on startup)
- `_trySeed`: 20s timeout; retry every 5min up to 1hr (12 attempts); stops if date rolls over
- Alert chain: `_scheduleCheckinAlert` → `_fireCheckinAlert` (no grace window; past call times fire immediately on restart) → `_editAlertForLateCheckin`
- `bot_config` keys: `checkin_alert_channel_{SHOW}`, `checkin_contacts` (JSON array), `coverage_manager`, `coverage_channel_{SHOW}[_{CHARACTER}]`
- `/checkin-status`: last 3 days; states: ✅ checked in | ⚠️ alert fired | 🔴 MISSED (bug) | ⏳ pending

## Late-booking notifications
- **Purpose:** detect shows that book late (after the 8:48am DMs) and notify assigned cast immediately
- **Bookeo constraint:** bookings close 120 min before show time — latest possible booking is 2h before curtain
- **Morning seed (8:48am):** `runLatebookingSeed(discord, bookeoAdapter)` — fetches today's shifts, finds any with `guest_count === 0`, stores them in `late_booking_baseline` DB table, schedules one `setTimeout` per blank show firing 110 min before that show's start
- **Pure helpers in `scheduler.js`:**
  - `planLatebookingChecks(todayShifts)` → filters `guest_count === 0`, computes `checkTime` via `checkin.shiftCallTimeUnix(date, time, -110)`; returns `[{ date, show, time, cast, checkTime }]`
  - `findNewlyBooked(baselineRows, currentShifts)` → returns baseline rows whose `date|show|time` key now has `guest_count > 0` in current data
- **Check (fires at 110-min mark):** `runLatebookingCheck(discord, bookeoAdapter, date)` — sweeps ALL unnotified rows for that date, fetches fresh Bookeo data, DMs cast on any newly-booked show, marks row `notified = 1`; sweep-all means a 9pm booking caught at the 5pm timer fires immediately
- **Restart recovery:** `start()` calls `_scheduleLatebookingCheck` for every `notified=0` row in `late_booking_baseline`; past check times fire immediately
- **DM builder:** `buildLatebookingAlertDM(firstName, show, date, time, guestCount)` in `scheduler.js`
- **DB table:** `late_booking_baseline(id, date, show, time, cast TEXT [JSON array], notified)`; `seedLatebookingBaseline` is idempotent (checks `COUNT(*)` before inserting)
- **`_scheduledLatebookingChecks`:** module-level `Set` prevents double-scheduling the same row on restart

## DM forwarding
- Non-bot non-Allen DMs → forwarded to Allen (`ALLEN_DISCORD_ID = '302924689704222723'` in `index.js`)
- Startup DM: `✅ SBI Bot is online at X:XX CT`

## New slash command
1. `commands/your-command.js` exporting `{ data, execute }`
2. `npm run deploy-commands`

## Railway deployment
- Auto-deploys on push. Pre-deploy command: `node deploy-commands.js`
- DB: persistent volume at `/data`; `DB_PATH=/data/db.sqlite`
- `lib/db.js`: `fs.mkdirSync(DB_DIR, { recursive: true })` on startup
- SIGTERM/SIGINT: `client.destroy()` + `process.exit(0)`
- `unhandledRejection`: logged to console
