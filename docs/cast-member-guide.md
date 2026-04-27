# SBI Bot — Cast Member Guide

SBI Bot is the Discord bot that handles scheduling, check-ins, and shift coverage for the company. This guide covers everything a cast member needs to know to use it.

---

## Table of Contents

1. [Checking In for Your Shift](#1-checking-in-for-your-shift)
2. [Viewing Your Schedule](#2-viewing-your-schedule)
3. [Requesting Shift Coverage](#3-requesting-shift-coverage)
4. [Cancelling a Coverage Request](#4-cancelling-a-coverage-request)
5. [Responding to Someone Else's Coverage Request](#5-responding-to-someone-elses-coverage-request)

---

## 1. Checking In for Your Shift

Use `/check-in` to confirm you're ready for your show.

**When to do it:** Check in before your call time. If you haven't checked in by then, the production team will be notified automatically.

**How to use it:**

1. In any channel where the bot is active, type `/check-in` and press Enter.
2. If you have one show today, the bot confirms you immediately.
3. If you have multiple shows today, the bot shows a dropdown — select which show you're checking in for.

**What you'll see:**
> ✅ Checked in for **Great Gold Bird** today.

The bot's reply is private (only you can see it).

---

## 2. Viewing Your Schedule

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

You can also look up a teammate's schedule the same way — just use their name or @mention them.

---

## 3. Requesting Shift Coverage

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

## 4. Cancelling a Coverage Request

Use `/cancel-coverage-request` to cancel a shift you no longer need covered.

**How to use it:**

1. Find the **Shift ID** at the bottom of the specific shift post you want to cancel.
2. Type `/cancel-coverage-request request_id:[number]` — replacing `[number]` with that ID.

**What happens:**

The shift post is updated to show it's cancelled (it stays in the channel so the history is preserved). If it was the last open shift in your request, the header post is also updated. You'll receive a private confirmation message.

> ✅ Shift `12` cancelled.

**Note:** You can only cancel your own requests. If you need an admin to cancel one for you, ask them to run the same command or use the cancel button in `/open-coverage`.

---

## 5. Responding to Someone Else's Coverage Request

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
