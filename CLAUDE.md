# CLAUDE.md

See RULES.md for operational rules with feedback tracking.

## Commands
- Start: `node index.js` / `npm start`
- Register commands: `node deploy-commands.js` / `npm run deploy-commands` — re-run on any add/rename/option change
- Tests: `npm test` (runs all `test/*.test.js` — 5 files)

## Env vars
DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, BOOKEO_API_URL, BOOKEO_API_KEY
DB_PATH: `../db.sqlite` (local) | `/data/db.sqlite` (Railway)

## Docx editing (Windows)
- XML edits: Node.js script files only — no sed/awk/perl (multi-line corruption risk)
- `/tmp` → `C:\Users\Allen\AppData\Local\Temp` — run `cygpath -w /tmp/dir` before passing to Node
- Before any replace: `grep -c 'pattern' file` must return 1; abort if 0 or 2+
- `pack.py`: always `--validate false` (validator crashes on cp1252/Unicode bug on this machine)

## Architecture
`commands/*.js` → `lib/{db,meetings,bookeo,shows,rsvp,coverage,confirm,utils,checkin,scheduler}.js`

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
- Confirm button: `confirm_coverage:{type}:{id}` → original message fetched via DB (channel+messageID) → reactions fetched from Discord
- Multi-role confirm: `handleMultiRoleButton` → `pendingMultiRole Map(userId:gameId)` → `cmr_submit:{gameId}`
- After confirm: if all request shifts resolved → `buildResolvedHeaderPost()`
- `/purge` (ManageGuild): hard-deletes `Coverage Shift` or `Custom Game` + post

## Check-in system
- Config: `lib/shows.js` `checkin: { roles, callTimeOffset: -30 }` per show
- Eligible: GGB (Mikey), Lucidity (Riley), Endings (HR role only) — MFB excluded (no checkin block)
- `checkin_records`: `id, shift_date, show, bookeo_name, discord_id, call_time (unix), checked_in_at, alert_message_id, alert_channel_id, forced_by`
- Seed: `seedAndScheduleToday()` → `groupEligibleShifts()` (dedup by person+show+date, keep earliest time) → upsert → schedule alerts
- `scheduler.start()` called AFTER `seedAndScheduleToday()` resolves (prevents 9am cron race on startup)
- `_trySeed`: 20s timeout; retry every 5min up to 1hr (12 attempts); stops if date rolls over
- Alert chain: `_scheduleCheckinAlert` → `_fireCheckinAlert` (no grace window; past call times fire immediately on restart) → `_editAlertForLateCheckin`
- `bot_config` keys: `checkin_alert_channel_{SHOW}`, `checkin_contacts` (JSON array), `coverage_manager`, `coverage_channel_{SHOW}[_{CHARACTER}]`
- `/checkin-status`: last 3 days; states: ✅ checked in | ⚠️ alert fired | 🔴 MISSED (bug) | ⏳ pending

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
