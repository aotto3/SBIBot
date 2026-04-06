# Strange Bird Immersive — Discord Bot Project Context

## Overview
We are building a Discord bot for a theatre company (Strange Bird Immersive) that:
1. Sends meeting reminders to Discord channels with emoji RSVP tracking
2. DMs individual cast members their upcoming show shifts

This file gives you full context to continue the build. Read it entirely before doing anything.

---

## The Two Codebases

### 1. bookeo-asst (Python, Google App Engine)
- **Repo:** https://gitlab.com/jccooper/bookeo-asst
- **Live site:** https://bookeo-asst.appspot.com (password protected)
- **What it does:** Pulls upcoming event/show data from Bookeo and displays it in a web UI
- **Our task here:** Add a `/api/schedule` JSON endpoint so the Discord bot can consume schedule data cleanly

### 2. Discord Bot (to be created)
- **Language:** Node.js with Discord.js
- **Hosting:** Railway (cloud, always-on)
- **Our task here:** Build the bot from scratch

---

## bookeo-asst — What We Know

The site shows "Upcoming Event Summaries" organized by show:
- **The Man From Beyond (MFB)**
- **Great Gold Bird (GGB)**

Each event entry contains:
- Date and time (e.g. "Mon 6 Apr, 5:15 PM")
- Cast assigned (e.g. "Cast: DeShae, Brock") — first names only, currently all unique
- Guest count
- Guest details (names, emails, phone) — NOT needed by the bot

The site is almost certainly Python on Google App Engine (based on .appspot.com domain).

### What We Need to Add to bookeo-asst

A new route: `GET /api/schedule`

Optional query params: `from` and `to` (dates), defaulting to today + 7 days if omitted.

Should return JSON like:
```json
[
  {
    "date": "2026-04-06",
    "time": "5:15 PM",
    "show": "MFB",
    "cast": ["DeShae", "Brock"],
    "guest_count": 7
  },
  {
    "date": "2026-04-11",
    "time": "11:30 AM",
    "show": "MFB",
    "cast": ["Lexie", "Scott"],
    "guest_count": 4
  }
]
```

The endpoint should be protected by the same auth as the rest of the site (or a simple API key — TBD).

**First task:** Explore the repo, understand how it currently fetches and structures data from Bookeo, then add this endpoint with minimal changes to existing code.

---

## Discord Bot — Full Specification

### Server Details
- Single Discord server
- ~25 members
- Bot controlled by admins only (for now)

### Feature 1: Meeting Reminders

**Fixed meetings:** Configured once (e.g. "first Tuesday of every month at 7pm"), run automatically.

**Ad-hoc meetings:** Added via slash command:
```
/schedule-meeting date:2026-05-14 time:7pm channel:#full-company title:"Production Planning"
```

**Reminder behavior:**
- Posts reminder at least 7 days before the meeting
- Optionally a second reminder 24-48hrs before
- Tags @everyone or @here
- Includes emoji reactions: ✅ attending / ❌ can't make it / ❓ maybe
- Bot tracks who reacted with what

**Attendance summary command:**
```
/attendance meeting:May-14
```
Returns a named list: who's ✅ in, ❌ out, ❓ maybe.

**Multi-channel support:** Admins can target different channels for different groups (cast, crew, company-wide).

### Feature 2: Shift DMs

**Data source:** `bookeo-asst.appspot.com/api/schedule` (the endpoint we're adding)

**Member mapping:** Manual Discord ↔ cast name linking via:
```
/link-member discord:@Jane bookeo-name:"Jane"
```
Stored persistently. 25 members, one-time setup.

**DM trigger:**
- Manual: `/send-shift-reminders` (admin only)
- Automatic: Configurable schedule (e.g. every Monday morning for the week ahead)

**DM format example:**
> Hey DeShae! Just a reminder — you're scheduled for The Man From Beyond this Monday, April 6th at 5:15 PM. Reply here if you have any issues!

---

## Tech Stack

### bookeo-asst addition
- Python (Google App Engine) — match whatever framework is already in use
- Likely Flask or webapp2

### Discord Bot
- Runtime: Node.js
- Framework: discord.js v14
- Scheduling: node-cron
- HTTP requests: axios or node-fetch
- Data persistence: JSON file or SQLite (simple — only 25 members)
- Hosting: Railway (deploy from GitHub)

---

## Build Phases

### Phase 1 — bookeo-asst JSON endpoint
- Read existing codebase
- Understand how Bookeo data is fetched
- Add `/api/schedule` route
- Test locally and deploy

### Phase 2 — Discord Bot Foundation
- Project scaffolding (Node.js + discord.js)
- Bot registered in Discord Developer Portal
- Admin permission system
- `/link-member` command + persistent storage

### Phase 3 — Meeting Reminders
- Fixed schedule configuration
- `/schedule-meeting` ad-hoc command
- Reminder posts with emoji RSVP
- `/attendance` summary command

### Phase 4 — Shift DMs
- Fetch from bookeo-asst API
- Match cast names to linked Discord members
- `/send-shift-reminders` manual command
- Automated weekly DM schedule

### Phase 5 — Polish & Deploy
- Deploy bot to Railway
- Environment variables / secrets configured
- Admin guide written
- Live testing with real data

---

## Open Questions / Decisions Pending

1. **bookeo-asst auth for the API endpoint** — should `/api/schedule` use the existing session auth, a simple API key header, or be IP-restricted? Recommend: simple API key stored in Railway env vars.
2. **Bookeo-asst framework** — confirm Flask vs webapp2 vs other once repo is open.
3. **Bot persistence** — SQLite recommended for member links and meeting schedule storage; simple JSON file is acceptable for MVP.
4. **Reminder timing** — confirm: 7 days before + 24hrs before, or just 7 days?

---

## Key Contacts / Context
- Client: Strange Bird Immersive, Houston TX
- Shows: The Man From Beyond (MFB), Great Gold Bird (GGB)
- Cast first names (currently unique): DeShae, Brock, Lexie, Scott, Rebecca, Patrick, Emily, Andrew
- Discord server: single server, ~25 members

---

## Where to Start

1. Clone `https://gitlab.com/jccooper/bookeo-asst`
2. Read the existing code — understand the data model and how Bookeo events are fetched
3. Add the `/api/schedule` JSON endpoint
4. Then scaffold the Discord bot in a new repo

Good luck!
