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

[SCREENSHOT: Discord slash command menu open, showing SBI Bot commands in the list]

---

## Meeting Reminders

### What the bot does automatically
When a meeting is scheduled, the SBI Bot posts a reminder in the relevant channel. That post includes:

- The meeting date, time, and any details
- Three reaction buttons: ✅ (attending) · ❌ (can't make it) · ❓ (maybe)
- A live attendance tracker that updates as people respond

As the meeting gets closer, the bot sends **follow-up reminders 7 days before and 24 hours before**, tagging everyone who responded ✅ or ❓ so they don't miss it.

[SCREENSHOT: A meeting reminder post showing the date/time, RSVP emoji reactions, and the live attendance tracker below it]

### What you need to do
React to the reminder post with one of the three emojis:

- ✅ — I'll be there
- ❌ — I can't make it
- ❓ — Not sure yet

The tracker updates automatically. You can change your response at any time — just remove your old reaction and add the new one.

---

## Check-In

### What the bot does automatically
For shows with check-in enabled (GGB, Lucidity, and The Endings), the bot keeps an eye on call times. If you haven't checked in by your call time, an alert fires in your show's `#[show]-admin` channel so the right people are notified.

> **Note:** MFB does not use check-in.

[SCREENSHOT: A check-in alert message in the admin channel, showing the cast member's name and shift details]

### What you need to do
When you arrive for your shift, run this command:

```
/check-in
```

If you're only scheduled for one show that day, the bot checks you in automatically. If you have multiple shows, you'll see a quick menu to pick which one.

[SCREENSHOT: The /check-in response — either a confirmation message for a single show, or a dropdown menu to select from multiple shows]

---

## Coverage Requests

### What the bot does automatically
Once you post a coverage request, the bot takes it from there:

- Posts individual messages for each shift in your show's role channel (e.g., `#mfb-daphne`, `#mfb-houdini`, `#ggb-mikey`, `#endings-hr`, `#endings-author`, `#lucidity-riley`)
- Sends daily reminders about open requests until they're filled
- Notifies the coverage manager automatically when a shift is covered

[SCREENSHOT: A coverage request post in a role channel, showing shift details and the confirm/cancel buttons]

### What you need to do

**To post a coverage request**, use:

```
/coverage-request
```

You'll be asked to select your show (and your character, if your show has more than one role). Then a small form will pop up — enter your shift dates and times, one per line.

**Example entry in the form:**
```
May 10 7:30pm
May 12 2:00pm
```

[SCREENSHOT: The coverage request modal/form with the shift date entry field visible]

The bot will confirm how many shifts were posted once you submit.

---

**To cancel a coverage request**, use:

```
/cancel-coverage-request
```

You'll need the **shift ID**, which appears at the bottom of your original coverage request post.

[SCREENSHOT: The bottom of a coverage request post, highlighting where the shift ID appears]

You can only cancel your own requests. Once cancelled, the post in the coverage channel will update automatically.

---

## Viewing Schedules

### What you need to do
Want to check your upcoming shifts — or someone else's? Use:

```
/member-schedule
```

You can search by first name (as it appears in Bookeo) or by tagging someone's Discord account. The bot will return a list of upcoming shifts including the show, date, time, and guest count.

**Example:**
```
/member-schedule
Name: Allen
```

[SCREENSHOT: The /member-schedule output showing a list of upcoming shifts for a cast member]

By default it shows the next 7 days, but you can set a custom date range if needed.

---

## Getting Help

Type `/help` in any Discord channel to see a full list of available bot commands.

If something doesn't seem right or the bot isn't responding, reach out to **Allen** directly in Discord.
