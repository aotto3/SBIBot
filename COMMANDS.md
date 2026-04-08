# Bot Commands

All commands are typed directly in Discord starting with `/`. Discord will show you a dropdown with options as you type — you don't need to memorize the exact format.

**🔒 Manager commands** require the Manage Server permission.  
**👥 Anyone** means any server member can use it.

---

## Meetings

### `/schedule-meeting` 🔒
Schedule a **one-time** meeting. The bot immediately posts an announcement in the chosen channel and adds ✅ ❌ ❓ reactions for RSVPs. Reminders are automatically sent 7 days and 24 hours before.

| Option | Required | Example |
|---|---|---|
| `title` | ✅ | Company Social Night |
| `date` | ✅ | May 14 · 5/14/2026 · 2026-05-14 |
| `time` | ✅ | 7pm · 7:30pm · 19:00 |
| `channel` | ✅ | #announcements |
| `target` | ✅ | @everyone · @here · Specific members |
| `duration` | optional | 1 hour (default) |
| `reminder_7d` | optional | on (default) |
| `reminder_24h` | optional | on (default) |

> **Target: Specific members** — Use this if you only want to ping certain people. After creating the meeting, use `/meeting-add-member` to add them.

---

### `/schedule-recurring` 🔒
Schedule a **repeating** meeting (weekly or monthly). Works the same as above but repeats automatically.

| Option | Required | Example |
|---|---|---|
| `title` | ✅ | Monday All-Hands |
| `recurrence` | ✅ | Weekly · Monthly |
| `day` | ✅ | Monday · Friday · etc. |
| `time` | ✅ | 7pm |
| `channel` | ✅ | #cast |
| `target` | ✅ | @everyone · @here · Specific members |
| `week` | Monthly only | First · Second · Third · Fourth · Last |
| `duration` | optional | 1 hour (default) |

> The creation post is a heads-up only (no RSVP). The **7-day reminder** is when reactions are added for RSVPs.

---

### `/edit-meeting` 🔒
Edit an existing scheduled meeting. Only updates the database — already-posted reminder messages are not changed.

| Option | Required | Notes |
|---|---|---|
| `meeting_id` | ✅ | From `/meetings` |
| `title` | optional | New title |
| `date` | optional | New date — one-time meetings only |
| `time` | optional | New start time |
| `duration` | optional | New duration |
| `channel` | optional | New channel for future reminders |

---

### `/cancel-meeting` 🔒
Cancel a meeting. Posts a strikethrough notice in the meeting's channel so everyone sees it's off.

| Option | Required | Notes |
|---|---|---|
| `meeting_id` | ✅ | The number shown when the meeting was created, or from `/meetings` |

---

### `/meetings` 🔒
List all active scheduled meetings with their IDs, schedules, and next occurrence. Only you can see the response.

---

### `/meeting-add-member` 🔒
Add someone to a **Specific members** meeting. Only needed if you chose "Specific members" as the target when creating the meeting.

| Option | Required |
|---|---|
| `meeting_id` | ✅ |
| `user` | ✅ — @mention them |

---

### `/attendance` 🔒
See a breakdown of who responded to a meeting's RSVP — attending, not attending, maybe, and (for specific-member meetings) who hasn't responded.

| Option | Required | Notes |
|---|---|---|
| `meeting_id` | ✅ | |
| `date` | optional | For recurring meetings — defaults to the most recent reminder |

---

## Custom Game Availability

### `/custom-game` 👥
Post an availability check asking who can do a custom game. The bot pings `@here`, adds the correct reaction emojis for that show, and tracks responses live on the post.

| Option | Required | Example |
|---|---|---|
| `show` | ✅ | Man From Beyond · The Endings · Great Gold Bird · Lucidity |
| `date` | ✅ | April 20 · 4/20/2026 |
| `channel` | ✅ | #mfb-cast |
| `time` | optional | 7pm |

**What happens automatically:**
- Reactions for that show are added (MFB uses the custom :dno: :hno: :dmaybe: :hmaybe: emojis)
- As people react, their names and roles appear on the post in real time
- Once every role is covered with a ✅, the bot privately DMs whoever posted the request with the cast list
- If no one fills the request after 48 hours, the bot posts a reminder in the channel. For multi-role shows (MFB, The Endings), it pings only the specific unfilled role(s) instead of @here

> The bot reply when you run `/custom-game` includes a **Game ID** — save it if you may need to cancel the post later with `/cancel-custom-game`.

**Show reactions:**

| Show | Emojis |
|---|---|
| Man From Beyond | ✅ available · :dmaybe: Daphne maybe · :hmaybe: Houdini maybe · :dno: Daphne no · :hno: Houdini no |
| The Endings | ✅ available · ❓ maybe · ❌ unavailable |
| Great Gold Bird | ✅ available · ❓ maybe · ❌ unavailable |
| Lucidity | ✅ available · ❓ maybe · ❌ unavailable |

> Role labels (Daphne, Houdini, HR, Author) are pulled automatically from your Discord server roles. Mikey and Riley are assigned automatically for GGB and Lucidity.

---

### `/cancel-custom-game` 🔒
Close a custom game availability post (e.g. if it's no longer needed before the 48-hour reminder fires).

| Option | Required | Notes |
|---|---|---|
| `game_id` | ✅ | Shown in the bot reply when you ran `/custom-game` |
| `notify` | optional | Post a notice in the channel? (default: yes) |

---

## Schedules & Shift Reminders

### `/schedule` 🔒
Show the full show schedule for the coming week, pulled from Bookeo.

| Option | Required | Notes |
|---|---|---|
| `week_of` | optional | Start date — defaults to today |

---

### `/member-schedule` 🔒
Show one cast member's upcoming shifts for the next 7 days.

| Option | Required | Notes |
|---|---|---|
| `name` | one of these | First name as it appears in Bookeo (e.g. DeShae) |
| `discord` | one of these | @mention a linked cast member |
| `week_of` | optional | Start date — defaults to today |

---

### `/send-shift-reminders` 🔒
Manually send shift DMs to all cast members with shifts in the selected window. Normally this runs automatically (Mondays for the week ahead, daily for the next 24 hours), but this lets you trigger it on demand.

| Option | Required | Notes |
|---|---|---|
| `mode` | optional | This week (default) · Next 24 hours |
| `week_of` | optional | Start date — defaults to today |

---

## Cast Member Setup

These commands connect a cast member's name in Bookeo to their Discord account, which enables shift DMs and shows their first name on RSVP posts.

### `/link-member` 🔒
Link a cast member's Bookeo name to their Discord account.

| Option | Required | Example |
|---|---|---|
| `bookeo_name` | ✅ | Allen Otto *(full name as it appears in Bookeo)* |
| `discord` | ✅ | @Allen |

---

### `/unlink-member` 🔒
Remove a cast member link (e.g. if someone leaves the cast).

| Option | Required |
|---|---|
| `discord` | ✅ — @mention them |

---

### `/list-members` 🔒
Show all current Bookeo ↔ Discord links.

---

## Help

### `/help` 👥
Show a summary of all available commands. Only you can see the response.

---

## Bot Settings

### `/bot-config` 🔒
Turn automated shift DM features on or off.

| Setting | What it does |
|---|---|
| Weekly shift DMs | DMs every cast member their shifts for the coming week every Monday at 9am |
| Daily 24hr shift DMs | DMs cast members with shifts in the next 24 hours every day at 9am |

---

## Quick Reference

| I want to… | Command |
|---|---|
| Schedule a one-time event | `/schedule-meeting` |
| Set up a repeating meeting | `/schedule-recurring` |
| Edit a meeting's details | `/edit-meeting` |
| Cancel a meeting | `/cancel-meeting` |
| See all my meetings | `/meetings` |
| See who's coming to a meeting | `/attendance` |
| Ask who's free for a custom game | `/custom-game` |
| Close a custom game post | `/cancel-custom-game` |
| See this week's show schedule | `/schedule` |
| See someone's upcoming shifts | `/member-schedule` |
| Send shift DMs right now | `/send-shift-reminders` |
| Connect a cast member to Discord | `/link-member` |
| See all linked cast members | `/list-members` |
| Turn automated DMs on/off | `/bot-config` |
| See all commands | `/help` |
