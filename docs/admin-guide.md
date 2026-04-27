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
7. [Bot Settings](#7-bot-settings)
8. [Cleanup](#8-cleanup)
9. [Command Reference](#9-command-reference)

---

## 1. First-Time Setup

Run these once when configuring the bot for the first time (or when something changes).

**Link all cast members**
Use `/link-member` to connect each Discord user to their Bookeo name. This is required before shift DMs and check-ins will work for that person. See [Member Management](#2-member-management).

**Set coverage channels**
Use `/set-coverage-channel` to tell the bot where to post coverage requests for each show. MFB and The Endings require a separate channel per character — you'll need to run the command once per character.

| Show | `show` | `character` needed? |
|---|---|---|
| The Man From Beyond | `MFB` | Yes — `Daphne` and `Houdini` (run twice) |
| The Endings | `Endings` | Yes — `HR` and `Author` (run twice) |
| Great Gold Bird | `GGB` | No |
| Lucidity | `Lucidity` | No |

**Set coverage manager**
Use `/set-coverage-manager` to designate who receives fillable-shift DMs and the nightly EOD coverage summary. Typically the person responsible for confirming coverage.

**Set check-in alert channels**
Use `/set-checkin-channel` for each check-in eligible show (GGB, Lucidity, The Endings). This is the channel where no-show alerts fire when a cast member misses their call time.

**Add check-in contacts**
Use `/add-checkin-contact` to add anyone who should be pinged on no-show alerts. Run once per person.

**Set error channel**
Use `/set-error-channel` to designate a channel for bot error messages.

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

**Managing existing meetings**

- `/meetings` — lists all active meetings with their IDs. You'll need the ID for every other meeting command.
- `/edit-meeting meeting_id:N` — change any combination of title, date (one-time only), time, duration, or channel. Existing posted reminders are not edited; changes apply to future reminders.
- `/cancel-meeting meeting_id:N` — deactivates the meeting and posts a cancellation notice to the meeting channel.
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

### Channel Configuration

**`/set-coverage-channel`**
Configure where coverage requests post. See [First-Time Setup](#1-first-time-setup) for the full breakdown.

**`/list-coverage-channels`**
Shows the current channel assignment for every show/character.

**`/set-coverage-manager`**
Set who receives fillable-shift DMs and the nightly EOD coverage summary.

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

## 7. Bot Settings

**`/bot-config setting:X value:On|Off`**
Toggle automated shift DMs:
- `Weekly shift DMs` — Sunday DMs covering the next 7 days.
- `Daily 24hr shift DMs` — morning DMs for shifts that day.

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
| `/coverage-request` | (Cast member) Submit a coverage request |
| `/cancel-coverage-request` | Cancel a single coverage shift by Shift ID |
| `/open-coverage` | View and manage all open requests and games |
| `/set-coverage-channel` | Set the coverage channel for a show/character |
| `/list-coverage-channels` | List all configured coverage channels |
| `/set-coverage-manager` | Set who receives fillable DMs and EOD summary |
| **Check-in** | |
| `/checkin-status` | View check-in records for the last 3 days |
| `/force-checkin` | Manually confirm a cast member as checked in |
| `/set-checkin-channel` | Set the no-show alert channel for a show |
| `/add-checkin-contact` | Add a user to no-show alert pings |
| `/remove-checkin-contact` | Remove a user from no-show alert pings |
| `/list-checkin-contacts` | List current no-show alert contacts |
| **Bot Settings** | |
| `/bot-config` | Toggle automated shift DMs on or off |
| `/set-error-channel` | Set the channel for bot error messages |
| **Cleanup** | |
| `/purge` | Hard-delete a coverage shift or custom game record and its post |
