# Bot Commands

All commands are typed directly in Discord starting with `/`. Discord shows a dropdown with options as you type — you don't need to memorize the exact format.

**🔒 Manager commands** require the **Manage Server** permission.
**👥 Anyone** means any server member can use it.

Every reply is **private (ephemeral)** unless noted otherwise. For the in-Discord version of this list, run `/help` (member commands) or `/help-admin` (manager commands).

---

## Meetings

### `/schedule-meeting` 🔒
Schedule a **one-time** meeting. The bot immediately posts an announcement in the chosen channel with ✅ ❌ ❓ reactions for RSVPs, and automatically posts reminders 7 days and 24 hours before. Posts show start–end time (e.g. 7:00 PM – 9:00 PM), a Google Calendar link, and the Meeting ID.

| Option | Required | Example |
|---|---|---|
| `title` | ✅ | Company Social Night |
| `date` | ✅ | May 14 · 5/14/2026 · 2026-05-14 |
| `time` | ✅ | 7pm · 7:30pm · 19:00 |
| `channel` | ✅ | #announcements |
| `target` | ✅ | @everyone · @here · Specific members |
| `duration` | optional | 30 min · 1 hour (default) · 1.5 / 2 / 3 hours |
| `reminder_7d` | optional | on (default) |
| `reminder_24h` | optional | on (default) |

> **Target: Specific members** — pings only certain people. After creating the meeting, use `/meeting-add-member` to add them.
> The Meeting ID appears at the bottom of every reminder post — you need it for `/edit-meeting`, `/cancel-meeting`, and `/attendance`.

### `/schedule-recurring` 🔒
Schedule a **repeating** meeting (weekly or monthly). Works like `/schedule-meeting` but repeats automatically. The creation post is a heads-up only; the **7-day reminder** is where RSVP reactions are added.

| Option | Required | Example |
|---|---|---|
| `title` | ✅ | Monday All-Hands |
| `recurrence` | ✅ | Weekly · Monthly |
| `day` | ✅ | Sunday … Saturday |
| `time` | ✅ | 7pm |
| `channel` | ✅ | #cast |
| `target` | ✅ | @everyone · @here · Specific members |
| `week` | Monthly only | First · Second · Third · Fourth · Last |
| `duration` | optional | 1 hour (default) |
| `reminder_7d` / `reminder_24h` | optional | on (default) |

### `/edit-meeting` 🔒
Edit a scheduled meeting. Updates the database and refreshes any already-posted 7d/24h reminders with the new details.

| Option | Required | Notes |
|---|---|---|
| `meeting_id` | ✅ | From the post or `/meetings` |
| `title` · `date` · `time` · `duration` · `channel` | optional | `date` applies to one-time meetings only |

### `/cancel-meeting` 🔒
Cancel a meeting. Strikes through the original post and posts a cancellation notice in the channel with a link back to it.

| Option | Required |
|---|---|
| `meeting_id` | ✅ |

### `/meetings` 🔒
List all active scheduled meetings with IDs, schedules, and next occurrence.

### `/meeting-add-member` 🔒
Add someone to a **Specific members** meeting.

| Option | Required |
|---|---|
| `meeting_id` | ✅ |
| `user` | ✅ (@mention) |

### `/attendance` 🔒
Show who responded to a meeting's RSVP — attending, not attending, maybe, and (for specific-member meetings) who hasn't responded.

| Option | Required | Notes |
|---|---|---|
| `meeting_id` | ✅ | |
| `date` | optional | Recurring meetings — defaults to the most recent reminder |

---

## Coverage Requests

### `/coverage-request` 👥
Request coverage for one or more of your own shifts. Opens a form where you enter the shift date(s) and time(s); the bot posts a coverage request (with a **Confirm Coverage** button) to the show's coverage channel and collects ✅ / ❌ / ❓ reactions from eligible cast.

| Option | Required | Notes |
|---|---|---|
| `show` | ✅ | MFB · The Endings · GGB · Lucidity |
| `character` | required for MFB & The Endings | Your character (Daphne/Houdini, HR/Author) |

### `/cancel-coverage-request` 👥
Cancel a single shift from one of your coverage requests. Edits the post to a cancelled state (never silently deletes).

| Option | Required | Notes |
|---|---|---|
| `request_id` | ✅ | The `Coverage Request ID` printed on the post |

### `/open-coverage` 🔒
List all open coverage requests and custom games with **Cancel / Confirm** buttons to act on each one directly.

### `/list-outstanding-requests` 🔒
A read-only overview of everything still outstanding — open coverage shifts and custom games not yet filled, confirmed, or cancelled, dated today-or-later. Grouped one section per show, soonest-first, with a jump link to each post.

| Option | Required | Notes |
|---|---|---|
| `show` | optional | Omit for **all shows** |

Each row shows a status marker (🔴 needs coverage / 🟡 awaiting confirmation), the type + ID (`Shift #N` / `Game #N`), date, time, character, requester, and a link.

> **`/open-coverage` vs `/list-outstanding-requests`:** `/open-coverage` gives you action **buttons**; `/list-outstanding-requests` is a filterable **read-only** list with links — best for a quick "what's still open?" scan.

### `/purge` 🔒
Hard-delete a coverage shift, coverage request, or custom game and its post (irreversible). For cleanup only.

| Option | Required | Notes |
|---|---|---|
| `type` | ✅ | Coverage Shift · Custom Game |
| `id` | ✅ | The shift/game ID |

---

## Custom Games

### `/custom-game` 🔒
Post a custom game availability check for a show. The bot posts to the chosen channel, adds show-specific reaction emojis, and tracks responses live on the post. Once every role is covered with ✅ it DMs the requester; if unfilled after 48h it posts a reminder pinging the specific unfilled role(s).

| Option | Required | Example |
|---|---|---|
| `show` | ✅ | MFB · The Endings · GGB · Lucidity |
| `date` | ✅ | April 20 · 4/20/2026 |
| `time` | optional | 7pm |

**Show reactions:**

| Show | Reactions |
|---|---|
| Man From Beyond | ✅ · `:Dmaybe:` `:Hmaybe:` (Daphne/Houdini maybe) · `:Dno:` `:Hno:` (Daphne/Houdini no) |
| The Endings · GGB · Lucidity | ✅ available · ❓ maybe · ❌ unavailable |

> The **Game ID** is printed on the post — use it with `/cancel-custom-game` or `/purge`.

### `/cancel-custom-game` 🔒
Cancel a custom game post — **deletes the original post** and marks the game closed.

| Option | Required | Notes |
|---|---|---|
| `game_id` | ✅ | Printed on the post |

---

## Schedules & Shift Reminders

### `/schedule` 🔒
Show the full show schedule for the coming week, pulled from Bookeo.

| Option | Required | Notes |
|---|---|---|
| `week_of` | optional | Defaults to today |

### `/member-schedule` 👥
Show one cast member's upcoming shifts for the next 7 days.

| Option | Required | Notes |
|---|---|---|
| `name` | one of these | First name as it appears in Bookeo |
| `discord` | one of these | @mention a linked cast member |
| `week_of` | optional | Defaults to today |

### `/send-shift-reminders` 🔒
Send shift DMs manually — or preview what would be sent to one person without sending. (Normally automatic: weekly on Mondays and daily, both at 8:48am CT.)

| Option | Required | Notes |
|---|---|---|
| `mode` | optional | This week (default) · Next 24 hours |
| `user` | optional | Only this person (omit for everyone) |
| `preview` | optional | Show the DM text instead of sending — requires `user` |
| `week_of` | optional | Defaults to today |

---

## Check-in System

On show days, eligible cast get a **Check in** button in their shift DM and can also run `/check-in`. If someone hasn't checked in by call time, the bot posts a no-show alert to the show's configured channel.

**Eligible shows/roles:** Great Gold Bird — Mikey · Lucidity — Riley · The Endings — HR only (Author excluded) · MFB — not eligible. Call time is 30 min before curtain.

### `/check-in` 👥
Check in for your shift today. One eligible shift confirms immediately; multiple shows a picker.

### `/checkin-status` 🔒
Show check-in status for the last 3 days (✅ checked in · ⚠️ alert fired · 🔴 missed · ⏳ pending).

### `/force-checkin` 🔒
Manually confirm a cast member as checked in. If the no-show alert already fired, it's edited to note the manual confirmation.

| Option | Required | Notes |
|---|---|---|
| `user` | ✅ | @mention |
| `show` | optional | Required if they have multiple eligible shifts today |

### `/add-checkin-contact` · `/remove-checkin-contact` · `/list-checkin-contacts` 🔒
Manage the no-show notification ping list. Contacts (plus the cast member) are pinged when a no-show alert fires.

| Option | Required | Notes |
|---|---|---|
| `user` | ✅ (add/remove) | @mention |

### `/dev-checkin-test` 🔒 *(dev/testing)*
Developer tool. `seed` seeds a test check-in record + DM button; `clear` deletes today's check-in records. Not for regular use.

---

## Cast Member Setup

Connect a cast member's Bookeo name to their Discord account — required for shift DMs, check-ins, and first-name display on posts.

### `/link-member` 🔒
| Option | Required | Example |
|---|---|---|
| `bookeo_name` | ✅ | Allen Otto *(full name as in Bookeo)* |
| `discord` | ✅ | @Allen |

### `/unlink-member` 🔒
| Option | Required |
|---|---|
| `discord` | ✅ (@mention) |

### `/list-members` 🔒
Show all current Bookeo ↔ Discord links.

---

## Coverage Configuration

### `/set-coverage-manager` 🔒
Set who receives coverage "fillable" notifications and the 9pm EOD coverage reminder.

| Option | Required |
|---|---|
| `user` | ✅ (@mention) |

### `/set-channel-override` · `/clear-channel-override` · `/list-coverage-channels` 🔒
Control where the bot posts, per show. By default the bot auto-resolves channels by name convention; overrides redirect a specific type of post (e.g. to a #test channel).

`/set-channel-override` options:

| Option | Required | Notes |
|---|---|---|
| `type` | ✅ | Coverage Requests · **Check-in Alerts** · Custom Game Requests |
| `show` | ✅ | MFB · The Endings · GGB · Lucidity |
| `channel` | ✅ | Target channel |
| `character` | optional | For MFB/Endings per-character routing |

> This is how you set the **check-in alert channel** for a show (type: *Check-in Alerts*). `/clear-channel-override` removes an override; `/list-coverage-channels` shows all current routing.

### `/add-coverage-exclusion` · `/remove-coverage-exclusion` · `/list-coverage-exclusions` 🔒
Exclude a user from **targeted coverage reminder pings** (the 8am role pings) — e.g. someone who is never available. They still see the posts; they just aren't @-pinged.

| Option | Required | Notes |
|---|---|---|
| `user` | ✅ (add/remove) | @mention |

---

## Bot Settings & Ops

### `/bot-config` 🔒
Toggle automated shift-DM features on or off.

| Setting | What it does |
|---|---|
| Weekly shift DMs | DMs each cast member their week ahead, Mondays 8:48am CT |
| Daily 24hr shift DMs | DMs cast with shifts in the next 24h, daily 8:48am CT |

### `/set-error-channel` 🔒
Set the channel where the bot posts operational error messages (config bugs, and failure notices — see below).

| Option | Required |
|---|---|
| `channel` | ✅ |

### `/set-ops-contact` 🔒
Set who gets a **DM when a scheduled job fails** (or silently drops work). Defaults to the bot owner until set.

| Option | Required |
|---|---|
| `user` | ✅ (@mention) |

### `/rerun-job` 🔒
Re-run a scheduled job on demand (no redeploy) and get a sent/failed/skipped report. Use it after a failure notice.

| Option | Required | Notes |
|---|---|---|
| `job` | ✅ | Coverage role pings · Custom-game reminders · Meeting reminders · EOD coverage reminder · Weekly maybe-nudge · Daily shift DMs · Late-booking seed · Check-in seeding |
| `mode` | optional | **Coverage pings only** — All (re-ping every still-missing post) · Smart (skip posts already pinged today) |
| `preview` | optional | **Coverage pings only** — show what would be sent without sending |

> **Failure notifications:** if any scheduled job throws, or finishes but silently drops items (e.g. "sent 1 of 11"), the bot sends one summary — a DM to the ops contact **and** a post to the error channel. `/rerun-job` is the recovery tool.

---

## Help

### `/help` 👥
Show the commands available to everyone (a short list).

### `/help-admin` 🔒
Show all admin / management commands, grouped by category.

---

## Quick Reference

| I want to… | Command |
|---|---|
| Schedule a one-time / recurring meeting | `/schedule-meeting` · `/schedule-recurring` |
| Edit / cancel a meeting | `/edit-meeting` · `/cancel-meeting` |
| See meetings / who's coming | `/meetings` · `/attendance` |
| Ask for coverage on my shift | `/coverage-request` |
| See / act on what's outstanding | `/list-outstanding-requests` · `/open-coverage` |
| Post / cancel a custom game | `/custom-game` · `/cancel-custom-game` |
| See the week's schedule / one person's shifts | `/schedule` · `/member-schedule` |
| Send or preview shift DMs | `/send-shift-reminders` |
| Check in for my shift | `/check-in` |
| Confirm someone / see check-in status | `/force-checkin` · `/checkin-status` |
| Set a check-in alert channel | `/set-channel-override` (type: Check-in Alerts) |
| Link / list cast members | `/link-member` · `/list-members` |
| Set coverage manager / ops contact / error channel | `/set-coverage-manager` · `/set-ops-contact` · `/set-error-channel` |
| Re-run a failed job | `/rerun-job` |
| Turn automated DMs on/off | `/bot-config` |
| See all commands | `/help` · `/help-admin` |
