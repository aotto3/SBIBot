# SBI Bot — Cast Member Guide

Welcome to the SBI Bot! This bot lives right here in Discord and quietly handles a lot of the behind-the-scenes work for our shows — meeting reminders, shift check-ins, and coverage requests. You don't need any technical knowledge to use it. This guide covers everything you need to know as a cast member.

---

## How to Use Bot Commands

The SBI Bot responds to **slash commands** — commands that start with a `/`. Here's how to use them:

1. Click into any Discord channel and type `/`
2. A menu will pop up showing available commands
3. Click the one you want, or keep typing to search for it
4. Fill in any fields that appear and press Enter

> **Tip:** You only need a handful of commands — they're all listed in this guide.

---

## Table of Contents

1. [Meeting Reminders & RSVPs](#1-meeting-reminders--rsvps)
2. [Checking In for Your Shift](#2-checking-in-for-your-shift)
3. [Viewing Your Schedule](#3-viewing-your-schedule)
4. [Requesting Shift Coverage](#4-requesting-shift-coverage)
5. [Cancelling a Coverage Request](#5-cancelling-a-coverage-request)
6. [Responding to Someone Else's Coverage Request](#6-responding-to-someone-elses-coverage-request)

---

## 1. Meeting Reminders & RSVPs

### What the bot does automatically
When a meeting is scheduled, the bot posts an announcement in the meeting channel with RSVP reactions:

- **✅** — You're attending
- **❌** — You can't make it
- **❓** — Maybe

As the meeting gets closer, the bot will post follow-up reminders (7 days out and 24 hours out). These will @mention you if you've already said ✅ or ❓, and include a link back to the original post so you can update your response if your availability changes. If a meeting is cancelled, the original post will be updated to show it's cancelled and a new cancellation notice will appear in the channel.

[SCREENSHOT: A meeting reminder post showing the date/time, RSVP emoji reactions, and the live attendance tracker below it]

### What you need to do
React to the reminder post with one of the three emojis. **You only need to RSVP once** — the original post is the single place your response is tracked. The follow-up reminders don't have their own reactions — just use the link to go back to the original.

You can change your response at any time — just remove your old reaction and add the new one.

---

## 2. Checking In for Your Shift

### What the bot does automatically
For shows with check-in enabled (GGB, Lucidity, and The Endings), the bot keeps an eye on call times. If you haven't checked in by your call time, an alert fires in your show's admin channel so the right people are notified.

> **Note:** MFB does not use check-in.

[SCREENSHOT: The /check-in response — either a confirmation message for a single show, or a dropdown menu to select from multiple shows]

### What you need to do
Use `/check-in` to confirm you're ready for your show.

**When to do it:** Check in before your call time.

**How to use it:**

1. In any channel where the bot is active, type `/check-in` and press Enter.
2. If you have one show today, the bot confirms you immediately.
3. If you have multiple shows today, the bot shows a dropdown — select which show you're checking in for.

**What you'll see:**
> ✅ Checked in for **Great Gold Bird** today.

The bot's reply is private (only you can see it).

---

## 3. Viewing Your Schedule

Use `/member-schedule` to see upcoming shifts.

**How to use it:**

Type `/member-schedule` and fill in the options:

| Option | Required? | Description |
|---|---|---|
| `name` | One of these two | First name as it appears in Bookeo (e.g. `DeShae`) |
| `discord` | One of these two | @mention a linked cast member instead |
| `week_of` | No | Start date to look from — defaults to today |

You must provide either `name` or `discord`, but not both.

**Example:**
> `/member-schedule name:Allen`

**What you'll see:**
```
📅 Allen's schedule: Thursday, May 14 – next 7 days

  • Great Gold Bird — Thursday, May 14 at 7:00 PM (8 guests)
  • The Endings — Saturday, May 16 at 5:30 PM (12 guests)
```

[SCREENSHOT: The /member-schedule output showing a list of upcoming shifts for a cast member]

You can also look up a teammate's schedule the same way — just use their name or @mention them.

---

## 4. Requesting Shift Coverage

### What the bot does automatically
Once you post a coverage request, the bot takes it from there:

- Posts individual messages for each shift in your show's role channel (e.g. `#mfb-daphne`, `#ggb-mikey`, `#endings-hr`)
- Sends daily reminders about open requests until they're filled
- Notifies the coverage manager automatically when a shift is covered

[SCREENSHOT: A coverage request post in a role channel, showing shift details and the react buttons]

### What you need to do

Use `/coverage-request` when you need someone to cover one or more of your shifts.

**How to use it:**

1. Type `/coverage-request` and fill in the options:

| Option | Required? | Description |
|---|---|---|
| `show` | Yes | Which show you need coverage for |
| `character` | For MFB and The Endings | Your character name |

2. Hit Enter. A form (modal) will pop up asking for your shift dates and times — enter one per line:
```
5/1/2026 at 7pm
5/2/2026 at 5:30pm
```

3. Submit the form. The bot posts your request to the coverage channel.

**About the character option (MFB and The Endings):**

These shows have two actors per show, each with their own coverage channel. You must select your character when submitting — otherwise the bot won't know where to post. For MFB, choose `Daphne` or `Houdini`. For The Endings, choose `HR` or `Author`. For GGB and Lucidity, no character selection is needed.

**What gets posted:**

The bot posts a message in the coverage channel showing your show, the dates/times you need covered, and instructions for other cast members to react.

Each individual shift post shows a **Shift ID** at the bottom (e.g. `_Coverage Request ID: 12_`). If you request multiple dates, each date gets its own post with its own ID. Save these numbers — you'll need them if you want to cancel a specific shift later.

---

## 5. Cancelling a Coverage Request

Use `/cancel-coverage-request` to cancel a shift you no longer need covered.

**How to use it:**

1. Find the **Shift ID** at the bottom of the specific shift post you want to cancel.
2. Type `/cancel-coverage-request request_id:[number]` — replacing `[number]` with that ID.

**What happens:**

The shift post is updated to show it's cancelled (it stays in the channel so the history is preserved). If it was the last open shift in your request, the header post is also updated. You'll receive a private confirmation message.

> ✅ Shift `12` cancelled.

**Note:** You can only cancel your own requests. If you need an admin to cancel one for you, ask them to run the same command or use the cancel button in `/open-coverage`.

---

## 6. Responding to Someone Else's Coverage Request

When a cast member posts a coverage request, you'll see it in the show's coverage channel. Here's how to respond:

- **React ✅** if you're available to take the shift
- **React ❌** if you're unavailable
- **React ❓** if you're unsure

Reacting ✅ lets the person requesting coverage (and the production team) see who's available. Once coverage is confirmed by an admin, the post will be updated to show it's covered.

---

## Tips

- All bot replies are **private by default** — only you can see them.
- If the bot doesn't respond, it may be offline. Check with an admin.
- Type `/help` at any time to see a quick list of available commands in Discord.
