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
