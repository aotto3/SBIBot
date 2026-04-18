const db      = require('./db');
const bookeo  = require('./bookeo');
const utils   = require('./utils');
const { SHOWS, showLabel, hasCheckin, checkinConfig, getShowRole } = require('./shows');

const CENTRAL_TZ = 'America/Chicago';

// Module-level client singleton — set once via init() in ClientReady
let _client = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Store the Discord client for use by all async checkin operations.
 * Must be called once in ClientReady before any other checkin functions.
 */
function init(client) {
  _client = client;
}

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
 * Does NOT schedule timeouts — that is done in seedAndScheduleToday().
 *
 * @returns {Promise<number>} Number of records processed
 */
async function _seedRecords() {
  const today     = utils.todayCentral();
  const seedStart = Date.now();
  console.log(`[checkin] === SEEDING START (${today}) ===`);

  const guild = _client.guilds.cache.get(process.env.DISCORD_GUILD_ID);

  if (!guild) {
    console.error('[checkin] Guild not found — cannot seed check-in records');
    return 0;
  }

  let shifts;
  try {
    shifts = await bookeo.getSchedule(today, today);
  } catch (err) {
    console.error('[checkin] Failed to fetch schedule for seeding:', err.message);
    return 0;
  }

  // bookeo-asst ignores the to param — filter client-side
  shifts = shifts.filter(s => s.date === today);

  if (!shifts.length) {
    console.log(`[checkin] No shifts today (${today})`);
    return 0;
  }

  console.log(`[checkin] ${shifts.length} shift(s) found for ${today}`);

  const groups = groupEligibleShifts(shifts);
  console.log(`[checkin] ${groups.length} eligible (show, cast member, date) group(s) to process`);
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
          const ch = await _client.channels.fetch(errorChannelId);
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
      console.log(`[checkin] SKIP ${bookeo_name} / ${show} — role "${roleStr ?? 'none'}" not in eligible roles [${showConfig.roles.join(', ')}]`);
      continue;
    }

    const callTime    = shiftCallTimeUnix(shift_date, showTime, showConfig.callTimeOffset);
    const callTimeStr = new Intl.DateTimeFormat('en-US', {
      timeZone: CENTRAL_TZ, hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(callTime * 1000));

    db.upsertCheckinRecord({
      shift_date,
      show,
      bookeo_name,
      discord_id: link.discord_id,
      call_time:  callTime,
    });

    seeded++;
    console.log(`[checkin] SEED ${bookeo_name} / ${show} — call time ${callTimeStr} CT (show @ ${showTime})`);
  }

  const elapsed = ((Date.now() - seedStart) / 1000).toFixed(1);
  console.log(`[checkin] === SEEDING DONE — ${seeded} record(s) seeded in ${elapsed}s ===`);
  return seeded;
}

/**
 * Seed today's check-in records from Bookeo and schedule alerts for all pending
 * records (including startup recovery for any records seeded in a previous boot).
 * Call once from ClientReady after init().
 *
 * @returns {Promise<{ seeded: number, scheduled: number }>}
 */
async function seedAndScheduleToday() {
  const seeded = await _seedRecords();

  // Schedule alerts for all pending records — this covers both newly seeded
  // records and any pre-existing records from a previous boot that still need
  // their alert scheduled. Because we seed first and schedule after, each
  // record's alert is only scheduled once.
  const today   = utils.todayCentral();
  const pending = db.getPendingCheckins(today);
  for (const rec of pending) {
    _scheduleCheckinAlert(rec);
  }

  const scheduled = pending.length;
  if (scheduled) {
    console.log(`[checkin] ${scheduled} alert(s) scheduled (${seeded} new record(s) seeded today)`);
  }
  return { seeded, scheduled };
}

// ─── Alert firing ─────────────────────────────────────────────────────────────

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
 * @param {object} rec  A checkin_records row
 */
async function _fireCheckinAlert(rec) {
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
    const channel = await _client.channels.fetch(channelId);
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
 * @param {object} rec  A checkin_records row
 */
function _scheduleCheckinAlert(rec) {
  const nowMs    = Date.now();
  const callMs   = rec.call_time * 1000;
  const delayMs  = callMs - nowMs;

  if (delayMs > 0) {
    setTimeout(() => _fireCheckinAlert(rec), delayMs);
    const fireAt = new Intl.DateTimeFormat('en-US', {
      timeZone: CENTRAL_TZ, hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(callMs));
    console.log(`[checkin] Alert scheduled for ${rec.bookeo_name} / ${rec.show} in ${Math.round(delayMs / 60000)}m (fires at ${fireAt} CT)`);
  } else {
    // Call time has already passed — fire immediately. This covers both the normal
    // brief-gap case and longer bot-down / Railway-redeploy recovery. Safe because
    // _fireCheckinAlert re-checks checked_in_at before posting, and getPendingCheckins
    // already filters to records where alert_message_id IS NULL (no double-fire).
    const minsLate = Math.round(-delayMs / 60000);
    console.log(`[checkin] Alert for ${rec.bookeo_name} / ${rec.show} is ${minsLate}m past call time — firing now (recovery)`);
    _fireCheckinAlert(rec);
  }
}

// ─── Late check-in alert edit ─────────────────────────────────────────────────

/**
 * If a no-show alert was already posted for this record, edit it to show
 * that the person checked in late.
 *
 * @param {object} rec        A checkin_records row (after markCheckedIn)
 * @param {string|null} forcedById  Discord user ID of admin, or null for self
 */
async function _editAlertForLateCheckin(rec, forcedById = null) {
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
    const channel = await _client.channels.fetch(rec.alert_channel_id);
    const msg     = await channel.messages.fetch(rec.alert_message_id);
    await msg.edit(`${msg.content}\n${suffix}`);
    console.log(`[checkin] Edited alert message for ${rec.bookeo_name} / ${rec.show}`);
  } catch (err) {
    console.error(`[checkin] Failed to edit alert message for ${rec.bookeo_name} / ${rec.show}:`, err.message);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Atomically mark a cast member as checked in and edit the no-show alert if one
 * was posted. All three steps (mark, re-fetch, edit) are bundled here so no
 * caller has to orchestrate them individually.
 *
 * @param {number} recordId
 * @param {{ forcedBy?: string|null }} opts
 * @returns {Promise<{ status: 'ok' | 'already_checked_in' | 'not_found' }>}
 */
async function performCheckin(recordId, { forcedBy = null } = {}) {
  const rec = db.getCheckinRecordById(recordId);
  if (!rec) return { status: 'not_found' };
  if (rec.checked_in_at) return { status: 'already_checked_in' };

  db.markCheckedIn(recordId, forcedBy);
  const fresh = db.getCheckinRecordById(recordId);
  await _editAlertForLateCheckin(fresh, forcedBy);

  return { status: 'ok' };
}

/**
 * Return pending and all check-in records for a Discord user on a given date.
 * Synchronous. Used by /check-in, /force-checkin, and shift DM builder.
 *
 * @param {string} discordId
 * @param {string} shiftDate  YYYY-MM-DD
 * @returns {{ pending: object[], all: object[] }}
 */
function queryCheckins(discordId, shiftDate) {
  const all     = db.getCheckinRecordsByDiscordAndDate(discordId, shiftDate);
  const pending = all.filter(r => !r.checked_in_at);
  return { pending, all };
}

/**
 * Schedule a no-show alert for a record using the stored client.
 * Exported for use by /dev-checkin-test.
 *
 * @param {object} rec  A checkin_records row
 */
function scheduleCheckinAlert(rec) {
  _scheduleCheckinAlert(rec);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Lifecycle API
  init,
  seedAndScheduleToday,
  performCheckin,
  queryCheckins,
  scheduleCheckinAlert,
  // Pure helpers — used by tests
  isEligibleForCheckin,
  groupEligibleShifts,
  shiftCallTimeUnix,
};
