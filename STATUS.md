# SBIBot — Project Status

**Repo:** https://github.com/aotto3/SBIBot  
**Production:** Railway (auto-deploys from `main` branch)  
**Last updated:** 2026-04-08

---

## Picking up on a new machine

```bash
git clone https://github.com/aotto3/SBIBot.git
cd SBIBot
npm install
```

Create a `.env` file (never committed — get values from Railway or the original machine):

```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
BOOKEO_API_URL=https://bookeo-asst.appspot.com
BOOKEO_API_KEY=
DB_PATH=./db.sqlite
```

Register slash commands, then start:

```bash
node deploy-commands.js
node index.js
```

> **Note:** The production SQLite database lives on a Railway persistent volume at `/data/db.sqlite`. Your local `./db.sqlite` is separate and starts empty — that's fine for testing.

---

## Syncing between machines

The code syncs through GitHub automatically. Before switching machines:

```bash
# On the machine you're leaving:
git add -A
git commit -m "wip: notes on what you were doing"
git push

# On the machine you're arriving at:
git pull
npm install   # only needed if package.json changed
```

The `.env` file is **not** in git. Keep a copy somewhere safe (e.g. Railway's variable dashboard has all production values).

---

## What's built and deployed

### Meeting reminders
- `/schedule-meeting` — one-time meetings with date, time, duration, channel, target, reminders
- `/schedule-recurring` — weekly or monthly recurring meetings
- `/edit-meeting` — update title, date, time, duration, or channel on any active meeting
- `/cancel-meeting` — deactivates a meeting and posts a strikethrough notice
- `/meetings` — lists all active meetings with IDs and next occurrence
- `/meeting-add-member` — adds a specific user to a `members`-targeted meeting
- `/attendance` — view RSVP reactions on a meeting post

Reminder types: `created` (immediate), `7d`, `24h`. Recurring meetings skip RSVP emojis on `created`; the 7d reminder is where RSVPs are collected.

Every reminder post shows:
- Start–end time (e.g. 7:00 PM – 9:00 PM) using stored duration
- Google Calendar link
- `_Meeting ID: N_` at the bottom for easy reference

### Live RSVP tracker
All meeting and custom game posts update in real time as people react. Shows first names (from Bookeo member link if available, Discord display name otherwise). The tracker is appended to the post using a zero-width space (`\u200B`) as the split marker so it never collides with post content.

### Shift DMs (Bookeo integration)
- `/schedule` — view full week schedule from Bookeo
- `/member-schedule` — view one person's schedule (by name or @mention)
- `/send-shift-reminders` — manually trigger shift DMs
- Weekly shift DMs every Monday 9am CT (toggleable)
- Daily 24h shift DMs every day 9am CT (toggleable)
- `/bot-config` — toggle weekly/daily shift DMs on/off
- Bookeo API responses are cached for 5 minutes

### Cast member linking
- `/link-member bookeo_name:"First Last" discord:@User` — links Bookeo name to Discord user (enables shift DMs and first-name display)
- `/unlink-member` — removes a link
- `/list-members` — shows all current links

### Custom game availability
- `/custom-game show date [time] channel` — posts availability check with show-specific reactions
- `/cancel-custom-game game_id` — marks the game closed and **deletes the original post**

**Post format:**
```
The Man From Beyond
Custom Game Request
@here Is anyone available on Tuesday, April 20, 2026 at 7:00 PM?
Game ID: 42
```
The Game ID is embedded in the post itself (not just the ephemeral reply) so it's always findable.

**Live tracker** — updates on the post as people react:
- MFB: role-grouped (Daphne / Houdini sections), no emoji key
- Other shows: emoji-grouped list with role labels

**Fill detection:** when all roles are covered by ✅ reactions, bot DMs the requester privately with cast list.

**48h reminder:** if unfilled after 48 hours, posts in channel at next 8am CT check:
- MFB / The Endings: pings only the specific unfilled Discord role(s) by role mention
- GGB / Lucidity: pings `@here`

### Show config (`lib/shows.js`)
| Show | Roles | Role detection |
|---|---|---|
| Man From Beyond (MFB) | Daphne, Houdini | Discord roles `@Daphne`, `@Houdini` |
| The Endings | HR, Author (fluid — can play both) | Discord roles `@HR`, `@Author` |
| Great Gold Bird (GGB) | Mikey | Auto (single role) |
| Lucidity | Riley | Auto (single role) |

MFB custom server emojis: `:Dno:` `:Hno:` `:Dmaybe:` `:Hmaybe:` — **names are case-sensitive**, must match exactly in Discord server settings.

### Misc
- `/help` — ephemeral command list, available to all members
- All date displays include the year: "Monday, April 20, 2026"
- UTC date-shift bug fixed: `utils.todayCentral()` used everywhere "today" is needed
- SIGTERM/SIGINT graceful shutdown handlers
- `unhandledRejection` global error logger

---

## Environment variables

| Variable | Where to get it |
|---|---|
| `DISCORD_TOKEN` | Discord Developer Portal → Bot |
| `DISCORD_CLIENT_ID` | Discord Developer Portal → General Information |
| `DISCORD_GUILD_ID` | Right-click server in Discord → Copy Server ID |
| `BOOKEO_API_URL` | `https://bookeo-asst.appspot.com` |
| `BOOKEO_API_KEY` | From J Cameron Cooper (bookeo-asst manager) |
| `DB_PATH` | `./db.sqlite` locally, `/data/db.sqlite` on Railway |

---

## Railway setup

- **Repo connected:** `aotto3/SBIBot`, branch `main`
- **Pre-deploy command:** `node deploy-commands.js`
- **Start command:** `npm start`
- **Volume:** mounted at `/data` — set `DB_PATH=/data/db.sqlite`
- Deploys automatically on every push to `main`

---

## Two-system architecture

The bot **never** calls Bookeo directly. It calls `bookeo-asst` (a separate Python/GAE app managed by J Cameron Cooper) at `GET /api/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD` with header `X-Api-Key`. That app talks to Bookeo and returns `[{ date, time, show, cast, guest_count }]`.

To add a new show: update `SHOW_FULL_NAMES` in `lib/bookeo.js` AND `SHOW_GROUPS` in bookeo-asst's `upcoming.py`. Also add the show to `lib/shows.js` with its emoji config and role mappings.

---

## Pending / one-time setup

- **Cast member linking** — run `/link-member` for each cast member so shift DMs and first-name display work correctly
- **MFB custom emojis** — verify `:Dno:` `:Hno:` `:Dmaybe:` `:Hmaybe:` exist in the Discord server with exactly those names (capital first letter)
- **Lucidity** — not yet in Bookeo (show not open); shift DMs won't fire until added to bookeo-asst's `SHOW_GROUPS`
- **`/schedule` and `/member-schedule`** — depend on bookeo-asst `/api/schedule` being live; verify with J Cameron Cooper
