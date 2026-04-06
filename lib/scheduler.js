const cron     = require('node-cron');
const db       = require('./db');
const utils    = require('./utils');
const bookeo   = require('./bookeo');
const { postMeetingReminder } = require('./meetings');

// All cron schedules run in Houston (Central) time
const CRON_TZ = 'America/Chicago';

function start(client) {

  // ── Meeting reminder check — every day at 8am ──────────────────────────────
  // Checks all active meetings for any occurrence exactly 7 days or 1 day away
  // and posts the appropriate reminder if it hasn't been sent yet.
  cron.schedule('0 8 * * *', async () => {
    console.log('[scheduler] Running meeting reminder check');
    try {
      await runMeetingReminderCheck(client);
    } catch (err) {
      console.error('[scheduler] Meeting reminder check failed:', err);
    }
  }, { timezone: CRON_TZ });

  // ── Weekly shift DMs — every Monday at 9am ─────────────────────────────────
  cron.schedule('0 9 * * 1', async () => {
    if (db.getConfig('weekly_shifts_enabled') !== 'true') return;
    console.log('[scheduler] Running weekly shift DM job');
    try {
      await runShiftDMs(client, 'weekly');
    } catch (err) {
      console.error('[scheduler] Weekly shift DM job failed:', err);
    }
  }, { timezone: CRON_TZ });

  // ── Daily 24hr shift DMs — every day at 9am ────────────────────────────────
  cron.schedule('0 9 * * *', async () => {
    if (db.getConfig('daily_shifts_enabled') !== 'true') return;
    console.log('[scheduler] Running daily 24hr shift DM job');
    try {
      await runShiftDMs(client, 'daily');
    } catch (err) {
      console.error('[scheduler] Daily 24hr shift DM job failed:', err);
    }
  }, { timezone: CRON_TZ });

  console.log(`[scheduler] Jobs registered (tz: ${CRON_TZ})`);
}

// ─── Meeting reminder logic ───────────────────────────────────────────────────

async function runMeetingReminderCheck(client) {
  const meetings = db.getActiveMeetings();
  const today    = new Date();

  for (const meeting of meetings) {
    // 7-day check
    if (meeting.reminder_7d) {
      const in7 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
      const next7 = utils.nextOccurrence(meeting, in7);
      if (next7 && utils.toDateString(next7) === utils.toDateString(in7)) {
        await postMeetingReminder(client, meeting, utils.toDateString(in7), '7d');
      }
    }

    // 24-hour check
    if (meeting.reminder_24h) {
      const tomorrow  = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      const next24    = utils.nextOccurrence(meeting, tomorrow);
      if (next24 && utils.toDateString(next24) === utils.toDateString(tomorrow)) {
        await postMeetingReminder(client, meeting, utils.toDateString(tomorrow), '24h');
      }
    }
  }
}

// ─── Shift DM logic ───────────────────────────────────────────────────────────

async function runShiftDMs(client, mode) {
  // mode: 'weekly' (next 7 days) | 'daily' (next 24 hours)
  const today = new Date();
  const from  = utils.toDateString(today);

  let to, label;
  if (mode === 'weekly') {
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
    to    = utils.toDateString(end);
    label = 'this week';
  } else {
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    to    = utils.toDateString(end);
    label = 'within 24 hours';
  }

  let shifts;
  try {
    shifts = await bookeo.getSchedule(from, to);
  } catch (err) {
    console.error('[scheduler] Failed to fetch Bookeo schedule:', err.message);
    return;
  }

  if (!shifts.length) {
    console.log(`[scheduler] No shifts found for ${from} → ${to}`);
    return;
  }

  const grouped = bookeo.groupByCastMember(shifts);
  let sent = 0, skipped = 0;

  for (const [castName, castShifts] of Object.entries(grouped)) {
    const link = db.getMemberByBookeoName(castName);
    if (!link) {
      console.warn(`[scheduler] No Discord link for cast member "${castName}" — skipping`);
      skipped++;
      continue;
    }

    const dmText = bookeo.buildShiftDM(castName, castShifts, label);

    try {
      const user = await client.users.fetch(link.discord_id);
      await user.send(dmText);
      sent++;
      console.log(`[scheduler] Sent ${mode} shift DM to ${castName} (${link.discord_id})`);
    } catch (err) {
      console.error(`[scheduler] Failed to DM ${castName} (${link.discord_id}):`, err.message);
    }
  }

  console.log(`[scheduler] Shift DM run complete — sent: ${sent}, no link: ${skipped}`);
}

module.exports = { start, runMeetingReminderCheck, runShiftDMs };
