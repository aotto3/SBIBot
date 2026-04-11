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

There is no test suite or linter configured.

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

**Timezone**: All cron schedules and "today" calculations use `America/Chicago`. Railway deploys run UTC; evening Houston time is already the next calendar day in UTC, which breaks date comparisons. Use `utils.todayCentral()` whenever you need today's date as a string — never `utils.toDateString(new Date())`. `utils.nextOccurrence()` also converts to Central time internally.

**`postMeetingReminder` throws on channel errors** — it does NOT silently swallow failures. Commands that call it should wrap in try/catch and surface the error to the user.

**Bookeo API cache**: `lib/bookeo.js` caches responses for 5 minutes in a module-level `Map` keyed on `from|to` params. Avoids redundant calls when multiple commands run close together.

**bookeo-asst ignores the `to` query parameter** — it always returns a full week of shifts regardless of what `to` is set to. Both `runShiftDMs` in `lib/scheduler.js` and `/send-shift-reminders` filter results client-side after the API call: `shifts.filter(s => s.date >= from && s.date <= to)`. Do not remove this filter — without it, cast members receive DMs for shifts outside the intended window.

### Meeting reminders

Three reminder types exist:
- `'created'` — posted immediately when a meeting is scheduled (dayLabel: "just scheduled")
- `'7d'` — posted by the daily 8am cron when a meeting is 7 days away
- `'24h'` — posted by the daily 8am cron when a meeting is 1 day away

The `meeting_reminders_sent` table prevents duplicate posts (keyed on `meeting_id + instance_date + reminder_type`). For recurring meetings, `instance_date` is the specific occurrence's date.

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

### Check-in system

**Config lives in `lib/shows.js`** — each eligible show has an optional `checkin` block:
```js
checkin: { roles: ['Mikey'], callTimeOffset: -30 }
```
- `roles` — which display role names are required to check in (matched against the cast member's role via `getShowRole`)
- `callTimeOffset` — minutes relative to show time (negative = before). Currently -30 for all eligible shows
- MFB has no `checkin` block — it is excluded entirely (multi-person show, shared call time makes individual check-in impractical)
- Author (The Endings) is excluded because they are not in `checkin.roles`, only HR is. The exclusion is role-based, not show-based.

**`seedTodayCheckins(client)` flow** (runs on `ClientReady`):
1. Fetches today's Bookeo shifts via `lib/bookeo.js`
2. Calls `groupEligibleShifts(shifts)` — deduplicates consecutive shifts for the same (castName, show, date), keeping the earliest start time to avoid double-alerting
3. For each eligible shift, upserts a row into `checkin_records` (columns: `id`, `shift_date`, `show`, `bookeo_name`, `discord_id`, `call_time` unix seconds, `checked_in_at`, `alert_message_id`, `alert_channel_id`, `forced_by`)
4. Calls `scheduleCheckinAlert(client, rec)` for each newly seeded record

**Alert scheduling chain:**
- `scheduleCheckinAlert(client, rec)` — computes delay from now to `rec.call_time`. If delay > 0, sets a `setTimeout`. If call time is within the 5-minute grace window (passed but ≤ 5 min ago), fires immediately. If beyond 5 min, logs and skips (prevents stale alerts from piling up on redeploy)
- `fireCheckinAlert(client, rec)` — posts the no-show alert to the show's configured channel (`checkin_alert_channel_{SHOW}` key in `bot_config`). Pings all contacts from the `checkin_contacts` JSON array in `bot_config` plus the cast member themselves. Stores `alert_message_id` and `alert_channel_id` on the record
- `editAlertForLateCheckin(client, rec, forcedById)` — fetches the stored alert message and edits it to append "✅ [FirstName] checked in at H:MM CT" (normal late check-in) or "Manually confirmed by @Admin at H:MM CT" (forced via `/force-checkin`)

**Startup recovery:** after `seedTodayCheckins` completes, the bot also queries `checkin_records` for any pre-existing pending records (checked_in_at IS NULL, no alert yet fired, shift_date = today) and calls `scheduleCheckinAlert` on each. This handles Railway redeploys mid-day without losing scheduled alerts.

**`bot_config` keys used by check-in:**
- `checkin_alert_channel_{SHOW}` (e.g. `checkin_alert_channel_GGB`) — Discord channel ID for no-show alerts, set via `/set-checkin-channel`
- `checkin_contacts` — JSON-serialized array of Discord user IDs to ping on no-show alerts, managed via `/add-checkin-contact` and `/remove-checkin-contact`

**One-time setup required:** `/set-checkin-channel` for each show (GGB, Lucidity, Endings) and `/add-checkin-contact` for each notification contact. Cast members must also be linked via `/link-member` (already required for shift DMs) — unlinked cast are skipped at seed time.

### Show abbreviations

`lib/bookeo.js` maps abbreviations used in the `/api/schedule` response to display names:
- `MFB` → The Man From Beyond
- `GGB` → Great Gold Bird
- `Endings` → The Endings
- `Lucidity` → Lucidity

To add a new show, update `SHOW_FULL_NAMES` in `lib/bookeo.js` AND the `SHOW_GROUPS` dict in bookeo-asst's `upcoming.py`.

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
