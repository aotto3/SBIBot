const db      = require('./db');
const bookeo  = require('./bookeo');
const utils   = require('./utils');
const { SHOWS, showLabel, hasCheckin, checkinConfig, getShowRole } = require('./shows');

const CENTRAL_TZ = 'America/Chicago';

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true if the show has a check-in config block (i.e. any cast member
 * on this shift may need to check in). MFB has no config block → false.
 *
 * @param {{ show: string, cast: string[] }} shift
 */
function isEligibleForCheckin(shift) {
  return !!(hasCheckin(shift.show) && shift.cast.length > 0);
}

/**
 * Parse a Bookeo time string ("H:MM AM/PM") to { hour, minute } in 24-hour form.
 */
function parseBookeoTime(timeStr) {
  const [timePart, meridiem] = timeStr.trim().split(' ');
  const [rawH, rawM] = timePart.split(':').map(Number);
  const hour = rawH === 12
    ? (meridiem === 'PM' ? 12 : 0)
    : (meridiem === 'PM' ? rawH + 12 : rawH);
  return { hour, minute: rawM };
}

/**
 * Convert a Central-timezone wall-clock time to a Unix timestamp (seconds).
 * Handles both CST (UTC-6) and CDT (UTC-5) correctly via an Intl probe.
 *
 * @param {string} dateStr  YYYY-MM-DD
 * @param {number} hour     24-hour hour
 * @param {number} minute
 */
function centralTimeToUnix(dateStr, hour, minute) {
  const [y, mo, d] = dateStr.split('-').map(Number);

  // Probe UTC: assume UTC-6 (CST) as a starting guess
  const probeMs = Date.UTC(y, mo - 1, d, hour + 6, minute);
  const probe   = new Date(probeMs);

  // Find what hour/minute this UTC instant actually maps to in Central
  const fmt   = new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL_TZ,
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts     = fmt.formatToParts(probe);
  const probeHour = parseInt(parts.find(p => p.type === 'hour').value) % 24;
  const probeMin  = parseInt(parts.find(p => p.type === 'minute').value);

  // Adjust for any offset error (e.g. CDT is UTC-5 not UTC-6)
  const diffMs = ((hour - probeHour) * 60 + (minute - probeMin)) * 60_000;
  return Math.floor((probeMs + diffMs) / 1000);
}

/**
 * Compute the Unix call-time timestamp for a shift.
 *
 * @param {string} dateStr       YYYY-MM-DD
 * @param {string} timeStr       "H:MM AM/PM"
 * @param {number} offsetMinutes Negative = before show (e.g. -30)
 */
function shiftCallTimeUnix(dateStr, timeStr, offsetMinutes) {
  const { hour, minute } = parseBookeoTime(timeStr);
  const totalMinutes = hour * 60 + minute + offsetMinutes;
  const callHour   = Math.floor(totalMinutes / 60);
  const callMinute = totalMinutes % 60;
  return centralTimeToUnix(dateStr, callHour, callMinute);
}

/**
 * Group eligible shifts by (bookeo_name, show, date), keeping the earliest
 * show time per group. Returns an array of group objects ready for seeding.
 *
 * @param {Array} shifts  Raw shift objects from Bookeo
 * @returns {Array<{ shift_date, show, bookeo_name, showTime }>}
 */
function groupEligibleShifts(shifts) {
  const groups = new Map();

  for (const shift of shifts) {
    if (!isEligibleForCheckin(shift)) continue;

    for (const castName of shift.cast) {
      const key = `${castName}|${shift.show}|${shift.date}`;

      if (!groups.has(key)) {
        groups.set(key, {
          shift_date:  shift.date,
          show:        shift.show,
          bookeo_name: castName,
          showTime:    shift.time,
        });
      } else {
        // Keep the earliest show time (so call-time alert uses the first game)
        const existing = groups.get(key);
        const { hour: eH, minute: eM } = parseBookeoTime(existing.showTime);
        const { hour: nH, minute: nM } = parseBookeoTime(shift.time);
        if (nH * 60 + nM < eH * 60 + eM) {
          existing.showTime = shift.time;
        }
      }
    }
  }

  return Array.from(groups.values());
}

// ─── Seeding ──────────────────────────────────────────────────────────────────

/**
 * Fetch today's shifts, filter to eligible roles, and upsert checkin_records.
 * Does NOT schedule timeouts — that is done in scheduler.js (Slice 5).
 *
 * @param {import('discord.js').Client} client
 */
async function seedTodayCheckins(client) {
  const today = utils.todayCentral();
  const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);

  if (!guild) {
    console.error('[checkin] Guild not found — cannot seed check-in records');
    return;
  }

  let shifts;
  try {
    shifts = await bookeo.getSchedule(today, today);
  } catch (err) {
    console.error('[checkin] Failed to fetch schedule for seeding:', err.message);
    return;
  }

  // bookeo-asst ignores the to param — filter client-side
  shifts = shifts.filter(s => s.date === today);

  if (!shifts.length) {
    console.log(`[checkin] No shifts today (${today})`);
    return;
  }

  const groups = groupEligibleShifts(shifts);
  const errorChannelId = db.getConfig('error_channel_id');

  let seeded = 0;

  for (const group of groups) {
    const { shift_date, show, bookeo_name, showTime } = group;
    const showConfig = checkinConfig(show);

    // Resolve Discord ID from member_links
    const link = db.getMemberByBookeoName(bookeo_name);
    if (!link) {
      const msg = `⚠️ [check-in] Cast member **${bookeo_name}** has an eligible shift today (${show}) but is not linked in member_links. They will not receive a check-in record.`;
      console.warn('[checkin]', msg);
      if (errorChannelId) {
        try {
          const ch = await client.channels.fetch(errorChannelId);
          await ch.send(msg);
        } catch (e) {
          console.error('[checkin] Failed to post to error channel:', e.message);
        }
      }
      continue;
    }

    // Check if this cast member holds an eligible role for this show
    const roleStr = await getShowRole(guild, link.discord_id, show);
    const roles   = roleStr ? roleStr.split('/') : [];
    const eligible = showConfig.roles.some(r => roles.includes(r));

    if (!eligible) {
      // Cast member is not in an eligible role (e.g. Author for Endings)
      console.log(`[checkin] ${bookeo_name} is not in an eligible role for ${show} — skipping`);
      continue;
    }

    const callTime = shiftCallTimeUnix(shift_date, showTime, showConfig.callTimeOffset);

    db.upsertCheckinRecord({
      shift_date,
      show,
      bookeo_name,
      discord_id: link.discord_id,
      call_time:  callTime,
    });

    const rec = db.getCheckinRecord(shift_date, show, bookeo_name);
    scheduleCheckinAlert(client, rec);

    seeded++;
    console.log(`[checkin] Seeded record: ${bookeo_name} / ${show} / ${shift_date} @ call time ${new Date(callTime * 1000).toISOString()}`);
  }

  console.log(`[checkin] Seeding complete — ${seeded} record(s) upserted for ${today}`);
}

// ─── Alert firing ─────────────────────────────────────────────────────────────

const GRACE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Format a Unix timestamp as "H:MM AM/PM CT" for display in alerts.
 */
function formatCallTime(unixSeconds) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL_TZ,
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(unixSeconds * 1000)) + ' CT';
}

/**
 * Fire a no-show alert to the show's configured alert channel.
 * Posts a message pinging all checkin contacts and stores the message ID.
 *
 * @param {import('discord.js').Client} client
 * @param {object} rec  A checkin_records row
 */
async function fireCheckinAlert(client, rec) {
  // Re-fetch the record — it may have been checked in while the timeout was pending
  const fresh = db.getCheckinRecordById(rec.id);
  if (!fresh || fresh.checked_in_at) {
    console.log(`[checkin] Alert suppressed for ${rec.bookeo_name} / ${rec.show} — already checked in`);
    return;
  }

  const channelId = db.getConfig(`checkin_alert_channel_${rec.show}`);
  if (!channelId) {
    console.warn(`[checkin] No alert channel configured for ${rec.show} — cannot fire alert for ${rec.bookeo_name}`);
    return;
  }

  const contacts = db.getCheckinContacts();
  const mentions = contacts.length
    ? contacts.map(id => `<@${id}>`).join(' ')
    : '';

  const callTimeStr = formatCallTime(rec.call_time);
  const pingLine = [mentions, `<@${rec.discord_id}>`].filter(Boolean).join(' ');
  const content = `⚠️ ${pingLine} **${rec.bookeo_name}** has not checked in for **${showLabel(rec.show)}**. Call time was ${callTimeStr}.`.trim();

  try {
    const channel = await client.channels.fetch(channelId);
    const msg     = await channel.send(content);
    db.storeAlertInfo(rec.id, msg.id, channelId);
    console.log(`[checkin] No-show alert fired for ${rec.bookeo_name} / ${rec.show} (msg ${msg.id})`);
  } catch (err) {
    console.error(`[checkin] Failed to send alert for ${rec.bookeo_name} / ${rec.show}:`, err.message);
  }
}

/**
 * Schedule a no-show alert for a single checkin record.
 * - Future call time   → setTimeout until call_time
 * - Within grace (5m)  → fire immediately (recovery path)
 * - Beyond grace       → skip (bot was down too long; log and move on)
 *
 * @param {import('discord.js').Client} client
 * @param {object} rec  A checkin_records row
 */
function scheduleCheckinAlert(client, rec) {
  const nowMs    = Date.now();
  const callMs   = rec.call_time * 1000;
  const delayMs  = callMs - nowMs;

  if (delayMs > 0) {
    setTimeout(() => fireCheckinAlert(client, rec), delayMs);
    console.log(`[checkin] Alert scheduled for ${rec.bookeo_name} / ${rec.show} in ${Math.round(delayMs / 60000)}m`);
  } else if (-delayMs <= GRACE_WINDOW_MS) {
    console.log(`[checkin] Alert for ${rec.bookeo_name} / ${rec.show} is within grace window — firing now (recovery)`);
    fireCheckinAlert(client, rec);
  } else {
    console.log(`[checkin] Alert for ${rec.bookeo_name} / ${rec.show} skipped — call time was ${Math.round(-delayMs / 60000)}m ago (beyond grace window)`);
  }
}

// ─── Late check-in alert edit ─────────────────────────────────────────────────

/**
 * If a no-show alert was already posted for this record, edit it to show
 * that the person checked in late.
 *
 * @param {import('discord.js').Client} client
 * @param {object} rec        A checkin_records row (after markCheckedIn)
 * @param {string|null} forcedById  Discord user ID of admin, or null for self
 */
async function editAlertForLateCheckin(client, rec, forcedById = null) {
  if (!rec.alert_message_id || !rec.alert_channel_id) return;

  const checkinTimeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL_TZ,
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(rec.checked_in_at * 1000)) + ' CT';

  const firstName = rec.bookeo_name.split(' ')[0];
  const suffix    = forcedById
    ? `✅ Manually confirmed by <@${forcedById}> at ${checkinTimeStr}.`
    : `✅ ${firstName} checked in at ${checkinTimeStr}.`;

  try {
    const channel = await client.channels.fetch(rec.alert_channel_id);
    const msg     = await channel.messages.fetch(rec.alert_message_id);
    await msg.edit(`${msg.content}\n${suffix}`);
    console.log(`[checkin] Edited alert message for ${rec.bookeo_name} / ${rec.show}`);
  } catch (err) {
    console.error(`[checkin] Failed to edit alert message for ${rec.bookeo_name} / ${rec.show}:`, err.message);
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  isEligibleForCheckin,
  groupEligibleShifts,
  shiftCallTimeUnix,
  seedTodayCheckins,
  scheduleCheckinAlert,
  editAlertForLateCheckin,
};
