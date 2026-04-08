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
      → lib/bookeo.js      (HTTP to bookeo-asst, DM formatting)
      → lib/utils.js       (time/date parsing, recurrence logic)
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

**Timezone**: All cron schedules and "today" calculations use `America/Chicago`. Railway deploys run UTC; evening Houston time is already the next calendar day in UTC, which broke date comparisons. `utils.nextOccurrence()` explicitly converts to Central time before computing today's date. Do not change this to `new Date()` without accounting for the UTC offset.

**`postMeetingReminder` throws on channel errors** — it does NOT silently swallow failures. Commands that call it should wrap in try/catch and surface the error to the user.

### Meeting reminders

Three reminder types exist:
- `'created'` — posted immediately when a meeting is scheduled (dayLabel: "just scheduled")
- `'7d'` — posted by the daily 8am cron when a meeting is 7 days away
- `'24h'` — posted by the daily 8am cron when a meeting is 1 day away

The `meeting_reminders_sent` table prevents duplicate posts (keyed on `meeting_id + instance_date + reminder_type`). For recurring meetings, `instance_date` is the specific occurrence's date.

### Cast member linking

Bookeo stores cast names as plain strings (e.g. `"Allen Otto"`). The `member_links` table maps these to Discord user IDs. Commands: `/link-member`, `/unlink-member`, `/list-members`. Shift DMs are skipped (with a console warning) for any cast member not in this table.

### Show abbreviations

`lib/bookeo.js` maps abbreviations used in the `/api/schedule` response to display names:
- `MFB` → The Man From Beyond
- `GGB` → Great Gold Bird
- `Endings` → The Endings

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
