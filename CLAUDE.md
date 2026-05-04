# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start the bot
node index.js
# or
npm start

# Register slash commands with Discord (run after adding or changing any command)
node deploy-commands.js
# or
npm run deploy-commands
```

**Tests:** `node --test test/coverage.test.js` and `node --test test/confirm.test.js` — pure-function tests using `node:test` + `node:assert/strict`. No linter configured.

## Environment Variables

Required in `.env` (locally) or Railway environment variables (production):

| Variable | Purpose |
|---|---|
| `DISCORD_TOKEN` | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Application ID (for slash command registration) |
| `DISCORD_GUILD_ID` | Server ID (guild-scoped commands appear instantly) |
| `BOOKEO_API_URL` | Base URL for bookeo-asst, e.g. `https://bookeo-asst.appspot.com` |
| `BOOKEO_API_KEY` | API key for bookeo-asst `/api/schedule` — sent as `X-Api-Key` header |
| `DB_PATH` | SQLite file path — defaults to `../db.sqlite` relative to `lib/`. On Railway, set to `/data/db.sqlite` |

## Architecture

### Two-system design

The bot depends on a separate Python/Google App Engine app called **bookeo-asst** for all Bookeo scheduling data. The bot never talks to the Bookeo API directly — it calls `GET /api/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD` on bookeo-asst and receives a JSON array of `{ date, time, show, cast, guest_count }` objects. The `BOOKEO_API_URL` env var points to it.

### Data flow

```
Discord slash command
  → commands/*.js          (parse args, validate, call lib/)
      → lib/db.js          (SQLite via node:sqlite built-in — NOT better-sqlite3)
      → lib/meetings.js    (post reminder messages + RSVP reactions)
      → lib/bookeo.js      (HTTP to bookeo-asst, DM formatting, 5-min cache)
      → lib/shows.js       (show config: emojis, role mappings, tracker format)
      → lib/rsvp.js        (live RSVP tracker for both meeting and custom game posts)
      → lib/coverage.js    (pure text-building functions for coverage posts and DMs)
      → lib/confirm.js     (coverage confirm/cancel button handlers, multi-role flow)
      → lib/utils.js       (time/date parsing, recurrence logic, timezone helpers)
      → lib/checkin.js     (check-in seeding, alert scheduling, late check-in edits)
  → lib/scheduler.js       (node-cron jobs, started from index.js on ClientReady)
```

### Key architectural decisions

**SQLite via `node:sqlite` (Node 24 built-in)** — do not switch to `better-sqlite3`; it requires native compilation which fails on Railway without extra build config.

**Slash commands are guild-scoped**, not global. `deploy-commands.js` must be re-run whenever commands are added, renamed, or their options change. Global commands take up to 1 hour to propagate; guild commands are instant.

**`Routes` import location matters**: `Routes` must come from `discord-api-types/v10`, NOT from `@discordjs/rest` (it moved packages in v2).
```js
const { REST }   = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');  // ← correct
```

**Ephemeral replies**: always use `flags: MessageFlags.Ephemeral` — never `ephemeral: true` (deprecated).

**`GatewayIntentBits.GuildMembers` is a privileged intent** — enabled in both `index.js` and the Discord Developer Portal (Bot → Privileged Gateway Intents → Server Members Intent). Required for `interaction.guild.members.fetch()` to return all members. Without it, only cached members (those seen since startup) are available.

**Timezone**: All cron schedules and "today" calculations use `America/Chicago`. Railway deploys run UTC; evening Houston time is already the next calendar day in UTC, which breaks date comparisons. Use `utils.todayCentral()` whenever you need today's date as a string — never `utils.toDateString(new Date())`. `utils.nextOccurrence()` also converts to Central time internally.

**`postMeetingReminder` throws on channel errors** — it does NOT silently swallow failures. Commands that call it should wrap in try/catch and surface the error to the user.

**Bookeo API cache**: `lib/bookeo.js` caches responses for 5 minutes in a module-level `Map` keyed on `from|to` params. Avoids redundant calls when multiple commands run close together.

**Bookeo API timeout**: `lib/bookeo.js` sets a 15-second timeout on all `axios.get` calls. If bookeo-asst is slow or down, the call fails fast rather than hanging indefinitely.

**bookeo-asst ignores the `to` query parameter** — it always returns a full week of shifts regardless of what `to` is set to. Both `runShiftDMs` in `lib/scheduler.js` and `/send-shift-reminders` filter results client-side after the API call: `shifts.filter(s => s.date >= from && s.date <= to)`. Do not remove this filter — without it, cast members receive DMs for shifts outside the intended window.

### Meeting reminders

Three reminder types exist:
- `'created'` — posted immediately when a meeting is scheduled. Includes full RSVP reactions (✅ ❌ ❓) and a live tracker. Its Discord message ID is stored in `meeting_reminders_sent` so follow-up reminders can link back to it.
- `'7d'` — posted by the daily 8am cron when a meeting is 7 days away. No RSVP reactions — links back to the original post and @mentions current ✅/❓ reactors.
- `'24h'` — same format as `'7d'`, fired 1 day before the meeting.

The `meeting_reminders_sent` table prevents duplicate posts (keyed on `meeting_id + instance_date + reminder_type`). All three types are stored — the schema comment saying `'7d' | '24h'` is outdated; `'created'` rows are also written. For recurring meetings, `instance_date` is the specific occurrence's date.

**7d/24h follow-up format:**
```
📅 **Title** — Friday, May 14, 2026, 7:00 PM – 9:00 PM
_is in 7 days_

Attending (so far): @Alice @Bob

RSVP on the original post: https://discord.com/channels/...

📅 [Add to Google Calendar](<URL>)
_Meeting ID: 5_
```
- "Attending (so far):" is omitted if nobody has RSVP'd ✅ or ❓.
- If the original post can't be fetched (deleted, or predates this feature), the link becomes `_(original post unavailable)_` with no @ mentions.
- No @here/@everyone ping — the attendee mentions serve as the notification.

**`lib/meetings.js` key functions:**
- `buildMeetingReminderContent` — builds the 'created' post content
- `buildFollowupReminderContent(meeting, instanceDate, reminderType, attendeeMentions, originalUrl)` — pure function for 7d/24h content
- `buildCancelledPostContent(meeting, instanceDate)` — builds the cancelled header for a 'created' post edit
- `fetchAttendeeIds(message)` — returns ✅/❓ reactor user IDs from a Discord message, excluding bots
- `db.getCreatedReminderRecord(meetingId, instanceDate)` — looks up the stored 'created' row for a given occurrence

**Meeting cancellation** (`/cancel-meeting`):
- Marks the meeting inactive in the DB
- Edits all existing 'created' Discord posts for that meeting to show strikethrough title + `_This meeting has been cancelled._`, preserving any RSVP tracker section beneath the `TRACKER_MARKER`
- Posts a new cancellation notice linking to the most recent 'created' post (link omitted if no DB record exists)

Meeting posts always show start–end time (e.g. "7:00 PM – 9:00 PM") and a Google Calendar link. The `_Meeting ID: N_` line at the bottom lets users find the ID without running `/meetings`.

### RSVP live tracker

`lib/rsvp.js` handles `MessageReactionAdd` and `MessageReactionRemove` events. It checks whether the reacted message is a meeting reminder or a custom game post (by looking up the message ID in the DB), then updates the message in place.

**`TRACKER_MARKER = '\n\n\u200B'`** — a zero-width space (invisible in Discord) is used to split the static post header from the live tracker section. `editTracker()` always embeds the marker in the updated message so subsequent edits can split on it reliably. The marker was chosen over content-based strings because tracker formats differ between post types.

**`fetchReactorNames(message, emojiName)`** uses `.find(r => r.emoji.name === emojiName)` — this works for both unicode emojis (`✅`) and custom server emojis (`Dno`, `Hmaybe`, etc.) since `reaction.emoji.name` is the unicode char for unicode emojis and the custom name for custom emojis.

### Cast member linking

Bookeo stores cast names as plain strings (e.g. `"Allen Otto"`). The `member_links` table maps these to Discord user IDs. Commands: `/link-member`, `/unlink-member`, `/list-members`. Shift DMs are skipped (with a console warning) for any cast member not in this table.

`db.getMemberFirstName(discordId, fallback)` returns the first word of `bookeo_name` if linked, otherwise the provided fallback. Used throughout to show first names on RSVP posts.

### Show configuration (`lib/shows.js`)

Central config for all four shows. Each show entry has:
- `label` — full display name
- `autoRole` — if set, every ✅ reactor gets this role label (GGB → Mikey, Lucidity → Riley)
- `discordRoles` — maps display role name → Discord server role name, for multi-role shows
- `emojis` — grouped as `{ yes, maybe, no }`, each an array of `{ name, unicode, label }`
- `roleGroups` (MFB only) — defines the role-grouped tracker display (Daphne / Houdini sections)

**`showCharacters(showKey)`** — returns the array of character names for multi-role shows (e.g. `['Daphne', 'Houdini']` for MFB, `['HR', 'Author']` for Endings), or `null` for single-role shows. Used by coverage commands to determine whether a character selection is required.

**Custom emoji names are case-sensitive.** MFB uses: `Dno`, `Hno`, `Dmaybe`, `Hmaybe` — these must match exactly what's in the Discord server settings (capital first letter).

**`roleGroups` (MFB)**: The MFB tracker shows a section per character instead of per emoji:
```
**Daphne**
Available — Alice
Unavailable — 
Maybe — 

**Houdini**
...
```
✅ reactors are split by Discord role (Daphne vs Houdini). The `Dno`/`Hno`/`Dmaybe`/`Hmaybe` reactions each belong to a specific section.

### Custom game posts

`/custom-game` creates the DB record **before** posting the message (so the Game ID is known). Post format:
```
**Show Name**
Custom Game Request
@here Is anyone available on Tuesday, April 20, 2026 at 7:00 PM?
[react key — omitted for MFB]
_Game ID: N_
```

The Game ID is embedded in the post itself so it's always visible even if the ephemeral bot reply is dismissed.

`/cancel-custom-game` **deletes** the original post (via `message.delete()`), then marks the game as filled in the DB.

The 48h unfilled reminder (run at 8am if created_at ≤ 48h ago) fetches the post's ✅ reactors and checks which Discord roles are covered. For multi-role shows (MFB, Endings), it pings only the specific missing role(s) by Discord role mention (`<@&ROLE_ID>`). Falls back to `@here` if the message can't be fetched or for single-role shows.

### Coverage requests

Coverage requests support per-character channel routing for multi-role shows (MFB and Endings).

**Channel config keys:**
- Single-role shows (GGB, Lucidity): `coverage_channel_{SHOW}` (e.g. `coverage_channel_GGB`)
- Multi-role shows (MFB, Endings): `coverage_channel_{SHOW}_{CHARACTER}` (e.g. `coverage_channel_MFB_Daphne`)

Set via `/set-coverage-channel`. For MFB and Endings, the `character` option is required (server-side validated — Discord doesn't support conditionally required options natively). There is no show-level fallback for multi-role shows; if the character channel isn't configured, the command errors.

**`/coverage-request`** — the `character` option is required for MFB and Endings (validated before the modal opens). Character is embedded in the modal `customId` as `coverage_request_modal:{SHOW}:{CHARACTER}` (empty string for single-role shows). Character is stored on the `coverage_requests` DB record.

**`/cancel-coverage-request`** — takes a single `request_id` (the Shift ID shown on the individual shift post). Cancels that one shift only — does NOT cancel the whole request. The requester or any ManageGuild user can cancel. Uses `planShiftCancel()` from `lib/coverage.js` to decide what to do with the Discord post:
- `delete-all`: last open shift → edits shift post to "❌ Cancelled", edits header to resolved state
- `edit-header`: cancelling the header+shift combined post while siblings remain → edits to header-only content + strikethrough cancelled note
- `delete-shift`: non-header shift with siblings remaining → edits post to "❌ Cancelled — [date]"
Posts are **never deleted** — always edited so the channel history is preserved.

**`/open-coverage`** (ManageGuild only) — lists all open shifts and custom games in one ephemeral view, one message per item with Cancel and Confirm buttons. Links to original posts. Routes to the same `handleCovCancelButton` / `handleConfirmCoverageButton` handlers as in-channel buttons.

**Coverage confirm flow** (`lib/confirm.js`):
- Button custom ID: `confirm_coverage:{type}:{id}` — handled by `handleConfirmCoverageButton`
- Fetches ✅ reactors from the **original post** (looked up via DB channel_id + message_id) — not `interaction.message`, so the button works from both the channel post and `/open-coverage`
- Fallback when no reactors: `interaction.guild.members.fetch()` — requires `GatewayIntentBits.GuildMembers` (privileged intent, enabled in both code and Discord Developer Portal)
- Single-role: shows a select menu of reactors; on submit (`confirm_coverage_select:{type}:{id}`) confirms in DB, posts public confirmation, disables button on original post
- Multi-role (MFB, Endings): `handleMultiRoleButton` shows one select per role sorted by role-holders; `pendingMultiRole` Map (keyed `userId:gameId`) accumulates selections; `cmr_submit:{gameId}` finalizes
- After confirming a shift: checks if all shifts in the request are resolved (open count = 0) and edits header to `buildResolvedHeaderPost()`

**`planShiftCancel(shift, request, remainingOpenShifts)`** (pure, in `lib/coverage.js`) — returns `{ action, headerContent? }`:
- `delete-all` — no siblings remain (edit everything to resolved/cancelled state)
- `edit-header` — this shift IS the header post, siblings remain (edit to header-only + cancelled note)
- `delete-shift` — non-header post, siblings remain (edit this post to cancelled state)

**Cancel behavior — posts are edited, never deleted:**
- Cancelled shift post: `❌ **Cancelled** — [date at time]`
- Cancelled game post (from `/open-coverage`): prepend `❌ **Cancelled**\n\n` to existing content
- Resolved header (all shifts done, mix of covered/cancelled): `buildResolvedHeaderPost()` → "All shifts in this request have been resolved."
- `/cancel-custom-game` (the slash command) still deletes the game post — only the `/open-coverage` cancel button edits it

**`/purge`** (ManageGuild only) — hard-deletes a record AND its Discord post(s). Use for bot cleanup. Types: `Coverage Shift` (also removes orphaned request if it was the last shift) and `Custom Game`. Post deletion failures are silently swallowed. DB rows are hard-deleted (not soft-cancelled).

### Check-in system

**Config lives in `lib/shows.js`** — each eligible show has an optional `checkin` block:
```js
checkin: { roles: ['Mikey'], callTimeOffset: -30 }
```
- `roles` — which display role names are required to check in (matched against the cast member's role via `getShowRole`)
- `callTimeOffset` — minutes relative to show time (negative = before). Currently -30 for all eligible shows
- MFB has no `checkin` block — it is excluded entirely (multi-person show, shared call time makes individual check-in impractical)
- Author (The Endings) is excluded because they are not in `checkin.roles`, only HR is. The exclusion is role-based, not show-based.

**`seedAndScheduleToday()` flow** (runs on `ClientReady` via `_trySeed`):
1. Fetches today's Bookeo shifts via `lib/bookeo.js` (15s axios timeout)
2. Calls `groupEligibleShifts(shifts)` — deduplicates consecutive shifts for the same (castName, show, date), keeping the earliest start time to avoid double-alerting
3. For each eligible shift, upserts a row into `checkin_records` (columns: `id`, `shift_date`, `show`, `bookeo_name`, `discord_id`, `call_time` unix seconds, `checked_in_at`, `alert_message_id`, `alert_channel_id`, `forced_by`)
4. Schedules alerts for all pending records (newly seeded + pre-existing from prior boot)

**Startup seeding order matters**: `scheduler.start()` is called **after** `seedAndScheduleToday()` completes. This prevents a race where the 9am shift DM cron fires before check-in records are inserted, causing cast members to receive DMs without check-in buttons.

**Bookeo down at startup — `_trySeed` retry logic**: seeding is wrapped in a 20-second `Promise.race` timeout. If Bookeo is unreachable, the bot proceeds (scheduler starts) and retries seeding every 5 minutes for up to 1 hour (12 attempts). Retries stop early if the date rolls over. Implemented in `index.js` as `_trySeed(seedDate, attempt)`.

**Alert scheduling chain:**
- `_scheduleCheckinAlert(rec)` — computes delay from now to `rec.call_time`. If delay > 0, sets a `setTimeout`. If call time has already passed (any amount), fires immediately — there is **no grace window**. The `alert_message_id IS NULL` check in `getPendingCheckins` prevents double-firing on redeploy.
- `_fireCheckinAlert(rec)` — re-fetches the record first (suppresses if already checked in), then posts the no-show alert to the show's configured channel (`checkin_alert_channel_{SHOW}` key in `bot_config`). Pings all contacts from the `checkin_contacts` JSON array in `bot_config` plus the cast member themselves. Stores `alert_message_id` and `alert_channel_id` on the record.
- `_editAlertForLateCheckin(rec, forcedById)` — fetches the stored alert message and edits it to append "✅ [FirstName] checked in at H:MM CT" (normal late check-in) or "Manually confirmed by @Admin at H:MM CT" (forced via `/force-checkin`)

**Startup recovery:** after seeding, the bot queries `checkin_records` for any pre-existing pending records (checked_in_at IS NULL, alert_message_id IS NULL, shift_date = today) and calls `_scheduleCheckinAlert` on each. Because there is no grace window, any past-call-time records that never fired (e.g. bot was down) will alert immediately on startup.

**Check-in logging**: seeding emits `=== SEEDING START ===` / `=== SEEDING DONE ===` bracket logs with elapsed time. Each cast member logs either `SEED` (with computed call time) or `SKIP` (with reason: missing link, ineligible role). The shift DM job logs whether each cast member received a check-in button or not, and its start time in CT.

**`bot_config` keys used by check-in:**
- `checkin_alert_channel_{SHOW}` (e.g. `checkin_alert_channel_GGB`) — Discord channel ID for no-show alerts, set via `/set-checkin-channel`
- `checkin_contacts` — JSON-serialized array of Discord user IDs to ping on no-show alerts, managed via `/add-checkin-contact` and `/remove-checkin-contact`

**`bot_config` keys used by coverage:**
- `coverage_manager` — Discord user ID of the person who receives fillable-shift DMs and the 9pm EOD coverage summary, set via `/set-coverage-manager`
- `coverage_channel_{SHOW}` (e.g. `coverage_channel_GGB`) — channel ID for single-role show coverage posts
- `coverage_channel_{SHOW}_{CHARACTER}` (e.g. `coverage_channel_MFB_Daphne`) — channel ID for multi-role show coverage posts

**One-time setup required:** `/set-checkin-channel` for each show (GGB, Lucidity, Endings) and `/add-checkin-contact` for each notification contact. Cast members must also be linked via `/link-member` (already required for shift DMs) — unlinked cast are skipped at seed time.

### Show abbreviations

`lib/bookeo.js` maps abbreviations used in the `/api/schedule` response to display names:
- `MFB` → The Man From Beyond
- `GGB` → Great Gold Bird
- `Endings` → The Endings
- `Lucidity` → Lucidity

To add a new show, update `SHOW_FULL_NAMES` in `lib/bookeo.js` AND the `SHOW_GROUPS` dict in bookeo-asst's `upcoming.py`.

### `/checkin-status` command

`/checkin-status` (ManageGuild only) shows the last 3 days of check-in records grouped by date and show. Each record displays the cast member's name, computed call time, and one of four states:
- ✅ checked in at H:MM CT (with `(late)` or `(forced)` tags as applicable)
- ⚠️ alert fired, not checked in
- 🔴 MISSED — call time passed, no alert fired (indicates a bug)
- ⏳ pending — call time not yet reached

Uses `db.getCheckinRecordsByDateRange(fromDate, toDate)` added to `lib/db.js`.

### DM forwarding

Any DM sent to the bot by a non-bot, non-Allen user is forwarded to Allen via DM. Format:
```
📩 DM from **Display Name** (@username)
Saturday, April 18 at 2:34 PM CT

"message content"
```

Allen's Discord ID (`302924689704222723`) is hardcoded in `index.js` as `ALLEN_DISCORD_ID`. The bot also DMs Allen on every startup: `✅ SBI Bot is online at X:XX CT`. This confirms the bot→Allen DM channel is working and gives a visible signal that the latest code deployed.

### Adding a new slash command

1. Create `commands/your-command.js` exporting `{ data, execute }`.
2. Re-run `npm run deploy-commands` to register it with Discord.
3. No imports or registration needed in `index.js` — commands are auto-loaded from the `commands/` directory.

### Deployment (Railway)

- Railway auto-deploys on push to the connected GitHub branch.
- Set **Pre-deploy command** to `node deploy-commands.js` in Railway settings so slash commands are always registered before the bot starts.
- The SQLite database lives on a persistent volume mounted at `/data`. Set `DB_PATH=/data/db.sqlite`.
- `lib/db.js` creates the `/data` directory with `fs.mkdirSync` if it doesn't exist (needed during pre-deploy before the volume is mounted).
- SIGTERM/SIGINT handlers call `client.destroy()` and `process.exit(0)` for clean Railway restarts.
- `process.on('unhandledRejection')` logs all uncaught promise rejections to the console.
