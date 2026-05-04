# SBI Bot — Automated Behavior Guide

This document explains everything the bot does on its own, without anyone running a command. It is split into two sections: what cast members should expect, and what admins should expect.

---

## Part 1: Cast Members — What to Expect

### Weekly Shift Summary (Monday mornings)

Every Monday around 9:00 AM CT, the bot sends each cast member a private DM listing their shifts for the coming week. This is a heads-up only — no action is required.

If you do not receive this DM on a Monday, either:
- Your Discord account is not linked yet (ask an admin to run `/link-member`)
- The weekly DM feature is turned off (ask an admin)

---

### Daily Shift Reminder (Every morning)

Every morning around 9:00 AM CT, the bot sends a private DM to anyone who has a shift in the next 24 hours. This DM includes:

- The show name, date, and time
- A **Check In** button for each shift you're required to check in for

Tap the button to check in. The button will update to confirm your check-in time and become disabled. You can also check in using `/check-in` in any bot channel.

> **Note:** Not all shows require individual check-in. Only Great Gold Bird, Lucidity, and The Endings (HR role only) have check-in requirements.

---

### If You Don't Check In by Call Time

Your call time is 30 minutes before your show's start time.

If you haven't checked in by call time, the bot automatically posts an alert in the production team's channel and pings the designated contacts. The alert includes your name, show, and call time.

If you check in late — after the alert has already posted — the bot updates that alert message to note that you checked in and at what time.

If an admin manually confirms your check-in, the alert is updated to reflect that instead.

---

### Coverage Requests

When a cast member posts a coverage request, it appears in the show's coverage channel. React to let them know your availability:

- **✅** — Available to take the shift
- **❌** — Not available
- **❓** — Unsure

You don't need to do anything else. The production team handles confirming coverage.

---

## Part 2: Admins — What to Expect

### On Startup

Every time the bot starts (or restarts after a redeploy), it:

1. **Seeds check-in records** — Pulls today's Bookeo shifts and creates check-in records for all eligible cast members. If Bookeo is unreachable, the bot retries every 5 minutes for up to an hour.
2. **Schedules check-in alerts** — Sets a timer for each pending record to fire at the cast member's call time. If the bot was down during a call time, those alerts fire immediately on restart.
3. **Sends Allen a DM** — `✅ SBI Bot is online at [time] CT`. Confirms the bot is running and the DM channel to Allen is working.
4. **Pre-opens DM channels** — Opens DM channels with cast members in the background to avoid delays on first contact.

---

### Midnight (12:05 AM CT) — Check-in Seeding

The bot seeds check-in records for the new day and schedules alert timers. This runs silently with no visible output.

---

### 8:00 AM CT Daily — Reminders and Follow-ups

Each morning at 8am, the bot runs three checks:

**Meeting reminders**
Scans all active meetings. If a meeting is exactly 7 days away or 1 day away, the bot posts a follow-up reminder in the configured channel. Unlike the original "just scheduled" post (which has RSVP reactions), these reminders @mention everyone who has already reacted ✅ or ❓ on the original post and include a link back to it. No new reactions are added — cast members RSVP once on the original post. Each reminder is only ever posted once — the bot tracks what's already been sent.

**Custom game 48-hour follow-up**
Scans all open custom game posts older than 48 hours that haven't received a follow-up yet. For posts that still need coverage:
- For single-role shows (GGB, Lucidity): posts a follow-up pinging `@here`
- For multi-role shows (MFB, Endings): checks which roles are still uncovered and pings only those specific roles
- Tags the original requester in the follow-up

**Coverage role pings**
Scans all open coverage shift posts. For any shift that still has uncovered roles, the bot posts a role mention in the coverage channel tagging the specific Discord role(s) needed. This runs alongside the 48-hour custom game follow-up.

---

### 9:00 AM CT Daily — Shift DMs

The bot sends personalized shift DMs to all linked cast members with shifts in the next 24 hours. These DMs include check-in buttons for any pending check-ins.

If a cast member is not linked via `/link-member`, they are silently skipped. The bot logs the send count and any failures.

---

### 9:00 AM CT Monday — Weekly Shift DMs

The bot sends each linked cast member a DM covering their shifts for the coming 7 days. No check-in buttons are included — this is informational only.

---

### 9:00 PM CT Daily — EOD Coverage Summary

If there are any unfilled coverage shifts or custom games, the bot sends a consolidated DM to the coverage manager. The summary lists every open item with the show, date/time, available cast members (by role for multi-role shows), and a direct link to each post. If nothing is outstanding, no DM is sent.

---

### Fillable Shift Detection (Real-time)

When a cast member reacts ✅ to a coverage shift or custom game post, the bot checks whether coverage is now achievable:

- For single-role shows: at least one ✅ reactor
- For multi-role shows (MFB, Endings): at least one ✅ reactor per role

When the threshold is met, the bot immediately DMs the coverage manager with the show, date/time, who's available (grouped by role for multi-role shows), and a link to the original post. This is the signal to go confirm coverage.

---

### Check-in Alerts (Fire at Call Time)

When a cast member's call time arrives and they haven't checked in, the bot:

1. Posts an alert in the show's configured alert channel
2. Pings all configured check-in contacts + the cast member themselves
3. Stores the alert message ID so it can be edited later if they check in late

If the bot was restarted after a call time passed, the alert fires immediately on startup for any cast member whose call time is already past and who hasn't checked in.

**Alert message format:**
> ⚠️ @contacts @castmember **[Name]** has not checked in for **[Show]**. Call time was [time] CT.

**If they check in late:**
> ⚠️ ... ✅ [FirstName] checked in at [time] CT.

**If an admin force-checks them in:**
> ⚠️ ... ✅ Manually confirmed by @Admin at [time] CT.

---

### DM Forwarding (Real-time)

Any DM sent to the bot by someone other than Allen is automatically forwarded to Allen via DM in this format:

> 📩 DM from **Display Name** (@username)
> Saturday, April 18 at 2:34 PM CT
>
> "message content"

---

### RSVP Tracking (Real-time)

When anyone adds or removes a reaction on a meeting post or custom game post, the bot updates the RSVP tracker section of that post in place. No manual refresh needed.

For meetings, RSVP tracking only applies to the original "just scheduled" post — the 7-day and 24-hour follow-up reminders have no reactions of their own.

---

### What Can Disable Automatic Behavior

| Behavior | What disables it |
|---|---|
| Weekly shift DMs | Admin turns off "Weekly shift DMs" in `/bot-config` |
| Daily shift DMs | Admin turns off "Daily 24hr shift DMs" in `/bot-config` |
| Check-in alerts for a show | No alert channel set for that show (`/set-checkin-channel`) |
| Shift DMs for a cast member | Member not linked via `/link-member` |
| Check-in records for a cast member | Member not linked, or doesn't have the required show role |
| EOD coverage summary | No coverage manager set (`/set-coverage-manager`) |
| Fillable shift DMs | No coverage manager set (`/set-coverage-manager`) |

---

### Expected Bot Activity at a Glance

| Time | What happens |
|---|---|
| Bot startup | Startup DM to Allen, check-in seeding, alert timers set |
| 12:05 AM CT | Check-in records seeded for the new day |
| 8:00 AM CT | Meeting reminders + custom game 48h follow-ups + coverage role pings |
| 9:00 AM CT | Daily shift DMs with check-in buttons |
| 9:00 AM CT (Monday only) | Weekly shift DMs |
| 9:00 PM CT | EOD coverage summary DM to coverage manager (if anything is open) |
| Call time (30 min before show) | No-show alert if cast member hasn't checked in |
| Anytime | Fillable shift DMs, DM forwarding, RSVP tracker updates |
