# SBI Bot — Admin Guide

Assumes you have **Manage Server** permission. All bot replies are ephemeral (private) unless noted otherwise.

---

## Table of Contents

1. [First-Time Setup](#1-first-time-setup)
2. [Member Management](#2-member-management)
3. [Meetings](#3-meetings)
4. [Schedule & Shift Reminders](#4-schedule--shift-reminders)
5. [Coverage Requests](#5-coverage-requests)
6. [Check-in Monitoring](#6-check-in-monitoring)
7. [Bot Settings & Ops](#7-bot-settings--ops)
8. [Cleanup](#8-cleanup)
9. [Command Reference](#9-command-reference)

---

## 1. First-Time Setup

Run these once when configuring the bot for the first time (or when something changes).

**Link all cast members**
Use `/link-member` to connect each Discord user to their Bookeo name. This is required before shift DMs and check-ins will work for that person. See [Member Management](#2-member-management).

**Set coverage channels (optional)**
By default the bot auto-resolves each show's channel by name convention. To override where a show's coverage requests post, use `/set-channel-override` (type: *Coverage Requests*). MFB and The Endings can be routed per character.

| Show | `show` | `character` needed? |
|---|---|---|
| The Man From Beyond | `MFB` | Yes — `Daphne` and `Houdini` (run twice) |
| The Endings | `Endings` | Yes — `HR` and `Author` (run twice) |
| Great Gold Bird | `GGB` | No |
| Lucidity | `Lucidity` | No |

**Set coverage manager**
Use `/set-coverage-manager` to designate who receives fillable-shift DMs and the nightly EOD coverage summary. Typically the person responsible for confirming coverage.

**Set check-in alert channels**
Use `/set-channel-override` (type: *Check-in Alerts*) for each check-in-eligible show (GGB, Lucidity, The Endings). This is the channel where no-show alerts fire when a cast member misses their call time.

**Add check-in contacts**
Use `/add-checkin-contact` to add anyone who should be pinged on no-show alerts. Run once per person.

**Set error channel**
Use `/set-error-channel` to designate a channel for bot error messages — including scheduled-job failure notices.

**Set ops contact**
Use `/set-ops-contact` to designate who is DM'd when a scheduled job fails. Defaults to the bot owner until set.

---

## 2. Member Management

Cast members must be linked before the bot can DM them, check them in, or look them up by Discord user.

**`/link-member discord:@User bookeo_name:FirstLast`**
Links a Discord user to their Bookeo display name. The `bookeo_name` must match exactly what Bookeo shows (e.g. `Allen Otto`).

**`/unlink-member discord:@User`**
Removes a member link.

**`/list-members`**
Shows all current Discord ↔ Bookeo links.

---

## 3. Meetings

**Scheduling**

- `/schedule-meeting` — one-time meeting. Requires title, date, time, channel, and target (`@everyone`, `@here`, or `Specific members`).
- `/schedule-recurring` — weekly or monthly. Same options plus `recurrence` (Weekly/Monthly), `day`, and `week` (First/Second/etc. — monthly only).

Both default to a 1-hour duration and send 7-day and 24-hour reminders. You can disable either reminder or change the duration via the optional fields. The bot posts the first reminder immediately on creation.

If you choose `Specific members` as the target, the bot tells you to run `/meeting-add-member` to build the list — do that before the first reminder fires.

**How reminders work**

The initial "just scheduled" post is the only one with RSVP reactions (✅ ❌ ❓). The 7-day and 24-hour follow-up reminders @mention anyone who has already RSVP'd ✅ or ❓, and link back to the original post. Cast members only need to RSVP once.

**Managing existing meetings**

- `/meetings` — lists all active meetings with their IDs. You'll need the ID for every other meeting command.
- `/edit-meeting meeting_id:N` — change any combination of title, date (one-time only), time, duration, or channel. Any 7-day and 24-hour reminder posts that have already been sent are updated with the new details and a refreshed attendee list.
- `/cancel-meeting meeting_id:N` — deactivates the meeting, edits the original reminder post to show the meeting is cancelled (with strikethrough title), and posts a cancellation notice in the channel with a link back to the original post.
- `/attendance meeting_id:N` — shows RSVP counts and names for the most recent reminder. Add `date:YYYY-MM-DD` for a specific occurrence.
- `/meeting-add-member meeting_id:N user:@User` — adds a member to a `Specific members`-targeted meeting.

---

## 4. Schedule & Shift Reminders

**`/schedule`**
Shows the full week of Bookeo shifts, grouped by date. Add `week_of` to look at a different week (e.g. `May 14`, `5/14/2026`).

**`/send-shift-reminders`**
Manually triggers shift DMs. Useful if the automatic cron didn't fire or you need to re-send.

Options:
- `mode` — `This week` (7 days) or `Next 24 hours`. Defaults to weekly.
- `user:@User` — limit to one person.
- `preview:True` — shows what the DM would say without actually sending anything.
- `week_of` — look at a specific week.

### Late-Booking Notifications (automatic)

When a show has no audience bookings at 8:48am, the bot monitors for last-minute bookings and alerts assigned cast as soon as possible — no admin action required.

**How it works:**
1. At 8:48am, the bot records any shows with zero bookings in the `late_booking_baseline` table.
2. A timer is scheduled 110 minutes before each blank show's start time (bookings close 120 min before curtain).
3. When the timer fires, the bot re-checks Bookeo and DMs every assigned cast member if the show now has bookings.
4. If a show books after the timer already fired, it's caught at the next scheduled check for that day.

**Restart recovery:** any unnotified baseline rows from today reschedule automatically on bot startup.

There are no admin commands for late-booking notifications — the system is fully automatic once the bot is running.

---

## 5. Coverage Requests

### Custom Games

**`/custom-game show:X date:X channel:#X`**
Posts a custom game availability check to a channel of your choice. The post gets reactions cast members can use to signal availability. The bot replies with a Game ID.

**`/cancel-custom-game game_id:N`**
Cancels the custom game and deletes its post. Get the ID from the post or the bot reply when it was created.

### Coverage Requests

Coverage requests are posted by cast members via `/coverage-request`. Each requested date/time becomes its own **shift post** with a unique Shift ID shown at the bottom. Multi-date requests also get a shared **header post** above all the shift posts.

**`/cancel-coverage-request request_id:N`**
Cancels a single shift by its Shift ID. The shift post is updated to show it's cancelled rather than deleted — the channel history is preserved. If it was the last remaining shift in the request, the header post is updated to reflect that everything has been resolved. The requester or any admin can run this command.

### Confirming Coverage

When someone reacts ✅ to a shift post and enough people are available, the bot DMs the coverage manager. At that point you can confirm who is taking the shift.

**From the coverage channel:** Click the **Confirm Coverage** button at the bottom of the shift post. A private dropdown appears listing everyone who reacted ✅. Select the person taking the shift and submit. The bot posts a public confirmation message and grays out the button.

**From `/open-coverage`:** Same flow — the Confirm button on each item opens the same dropdown.

For multi-role shows (MFB, The Endings), a dropdown appears for each role. Select one person per role, then click **Confirm**.

### Managing All Open Requests

**`/open-coverage`**
Lists every open coverage shift and custom game in one private view, with **Cancel** and **Confirm** buttons next to each item. Each item includes a link to the original post and the relevant ID.

Use this to get a quick summary of everything outstanding, or to confirm/cancel without hunting through channels.

**`/list-outstanding-requests [show:X]`**
A read-only overview of everything still outstanding — open coverage shifts and custom games that haven't been filled, confirmed, or cancelled, and whose date hasn't passed. Results are grouped into one section per show, sorted soonest-first, with a jump link to each post. Add `show:` to limit to a single show; omit it for all shows.

Each row shows a status marker:
- 🔴 **needs coverage** (shift) / **unfilled** (game) — nobody has stepped up yet
- 🟡 **ready to fill — awaiting confirmation** (shift) / **filled — awaiting confirmation** (game) — someone has, but it isn't finalized

Rows are labeled `Shift #N` or `Game #N` so you know which ID to use with `/cancel-coverage-request`, `/cancel-custom-game`, or `/purge`.

> **`/open-coverage` vs `/list-outstanding-requests`:** use `/open-coverage` when you want to **act** (Cancel/Confirm buttons); use `/list-outstanding-requests` when you just want to **see** what's outstanding — with statuses, per-show filtering, and links.

### Channel Configuration

By default the bot auto-resolves channels by name convention; overrides let you redirect a specific kind of post (e.g. to a #test channel).

**`/set-channel-override type:X show:X channel:#X [character:X]`**
Override where a show's posts go. `type` is *Coverage Requests*, *Check-in Alerts*, or *Custom Game Requests*.

**`/clear-channel-override`**
Remove an override — the bot goes back to auto-resolving by name.

**`/list-coverage-channels`**
Shows the current channel routing for coverage, check-in alerts, and custom games.

**`/set-coverage-manager`**
Set who receives fillable-shift DMs and the nightly EOD coverage summary.

### Excluding Someone from Coverage Pings

The 8am role-ping reminders @-mention cast who haven't responded to an open coverage request. To stop pinging someone who is never available (they still see the posts, they're just not @-pinged):

- `/add-coverage-exclusion user:@User` — stop targeting them in pings.
- `/remove-coverage-exclusion user:@User` — resume.
- `/list-coverage-exclusions` — see who's excluded.

---

## 6. Check-in Monitoring

The bot automatically seeds check-in records from Bookeo each morning and fires alerts at call time for any cast member who hasn't checked in.

**`/checkin-status`**
Shows check-in records for the last 3 days, grouped by date and show. Each record shows one of four states: checked in, alert fired (not checked in), missed (alert never fired — indicates a bug), or pending.

**`/force-checkin user:@User`**
Manually marks a cast member as checked in. Use when someone checked in by other means (text, phone, etc.). If they have multiple shifts today, add `show:X` to specify which one.

**Managing alert contacts**
- `/add-checkin-contact user:@User` — add someone to the no-show ping list.
- `/remove-checkin-contact user:@User` — remove them.
- `/list-checkin-contacts` — see the current list.

---

## 7. Bot Settings & Ops

**`/bot-config setting:X value:On|Off`**
Toggle automated shift DMs:
- `Weekly shift DMs` — every **Monday 8:48am CT**, covering the next 7 days.
- `Daily 24hr shift DMs` — every day **8:48am CT**, for shifts in the next 24 hours.

**`/set-error-channel channel:#X`**
Channel for operational error messages, including scheduled-job failure notices.

**`/set-ops-contact user:@User`**
Who gets DM'd when a scheduled job fails. Defaults to the bot owner.

### Scheduled-job failures & recovery

Every scheduled job (meeting reminders, coverage/game role-pings, shift DMs, EOD reminder, maybe-nudge, late-booking seed, check-in seeding) runs through a wrapper that reports failures. If a job **throws**, or finishes but **silently drops items** (e.g. "sent 1 of 11 pings"), the bot sends **one summary per run** — a DM to the ops contact and a post to the error channel — naming the job, the counts, and the affected items.

**`/rerun-job job:X [mode:X] [preview:X]`**
Re-run any scheduled job on demand (no redeploy) and get a sent/failed/skipped report. After a failure notice, this is how you recover.
- For **Coverage role pings**, `mode` is `All` (re-ping every still-missing post) or `Smart` (skip posts already pinged today), and `preview:True` shows what would be sent without sending.

---

## 8. Cleanup

**`/purge type:X id:N`**
Hard-deletes a record and its associated Discord post(s). Use when something went wrong and you need a clean slate. This is permanent and cannot be undone.

| Type | What it deletes |
|---|---|
| `Coverage Shift` | The shift post and DB row. If it was the only shift in its request, also removes the header post and parent request. |
| `Custom Game` | The game post and DB row. |

If the Discord post was already manually deleted, the purge still cleans up the DB record.

---

## 9. Command Reference

| Command | What it does |
|---|---|
| **Member Management** | |
| `/link-member` | Link a Discord user to their Bookeo name |
| `/unlink-member` | Remove a member link |
| `/list-members` | List all Discord ↔ Bookeo links |
| **Meetings** | |
| `/schedule-meeting` | Schedule a one-time meeting |
| `/schedule-recurring` | Schedule a weekly or monthly meeting |
| `/edit-meeting` | Edit an existing meeting |
| `/cancel-meeting` | Cancel a meeting and post a notice |
| `/meetings` | List all active meetings with IDs |
| `/attendance` | Show RSVP counts for a meeting |
| `/meeting-add-member` | Add a member to a targeted meeting |
| **Schedule & Shifts** | |
| `/schedule` | View the weekly Bookeo shift schedule |
| `/member-schedule` | View one cast member's upcoming shifts |
| `/send-shift-reminders` | Manually trigger shift DMs |
| **Coverage** | |
| `/custom-game` | Post a custom game availability check |
| `/cancel-custom-game` | Cancel a custom game and delete its post |
| `/coverage-request` | (Any member) Submit a coverage request |
| `/cancel-coverage-request` | (Any member) Cancel a single coverage shift by ID |
| `/open-coverage` | View and manage (Cancel/Confirm) all open requests and games |
| `/list-outstanding-requests` | Read-only list of outstanding shifts + games, per-show, with links |
| `/set-channel-override` | Override where a show's posts go (coverage / check-in alerts / games) |
| `/clear-channel-override` | Remove a channel override |
| `/list-coverage-channels` | List current channel routing |
| `/set-coverage-manager` | Set who receives fillable DMs and EOD summary |
| `/add-coverage-exclusion` | Exclude a user from targeted coverage pings |
| `/remove-coverage-exclusion` | Re-enable coverage pings for a user |
| `/list-coverage-exclusions` | List excluded users |
| **Check-in** | |
| `/checkin-status` | View check-in records for the last 3 days |
| `/force-checkin` | Manually confirm a cast member as checked in |
| `/add-checkin-contact` | Add a user to no-show alert pings |
| `/remove-checkin-contact` | Remove a user from no-show alert pings |
| `/list-checkin-contacts` | List current no-show alert contacts |
| `/dev-checkin-test` | (Dev) Seed/clear test check-in records |
| **Settings & Ops** | |
| `/bot-config` | Toggle automated shift DMs on or off |
| `/set-error-channel` | Set the channel for bot error + job-failure messages |
| `/set-ops-contact` | Set who is DM'd when a scheduled job fails |
| `/rerun-job` | Re-run a scheduled job on demand (all / smart / preview) |
| **Cleanup** | |
| `/purge` | Hard-delete a coverage shift or custom game record and its post |
| **Help** | |
| `/help` | Member command list (any member) |
| `/help-admin` | Full admin command list |
