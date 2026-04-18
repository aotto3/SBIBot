const cron     = require('node-cron');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db       = require('./db');
const utils    = require('./utils');
const bookeo   = require('./bookeo');
const { postMeetingReminder } = require('./meetings');
const { SHOWS, showLabel, getRoleCoverage } = require('./shows');
const checkin = require('./checkin');

// All cron schedules run in Houston (Central) time
const CRON_TZ = 'America/Chicago';

function start(client) {

  // ── Daily 8am checks ───────────────────────────────────────────────────────
  // • Meeting reminders (7d and 24h windows)
  // • Unfilled custom game reminders (>48h old, not yet filled)
  cron.schedule('0 8 * * *', async () => {
    console.log('[scheduler] Running daily checks');
    try { await runMeetingReminderCheck(client); }
    catch (err) { console.error('[scheduler] Meeting reminder check failed:', err); }
    try { await runCustomGameReminders(client); }
    catch (err) { console.error('[scheduler] Custom game reminder check failed:', err); }
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

// ─── Pure plan functions ──────────────────────────────────────────────────────

/**
 * Decide which meetings need a reminder posted today.
 * Pure — no I/O. Inject `today` so tests are deterministic.
 *
 * @param {object[]} meetings  Active meeting rows from DB
 * @param {Date}     today     The reference date (use todayCentral()-derived Date in prod)
 * @returns {Array<{ meeting: object, dateStr: string, window: '7d'|'24h' }>}
 */
function planMeetingReminders(meetings, today) {
  const result = [];

  for (const meeting of meetings) {
    if (meeting.reminder_7d) {
      const in7   = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
      const next7 = utils.nextOccurrence(meeting, in7);
      if (next7 && utils.toDateString(next7) === utils.toDateString(in7)) {
        result.push({ meeting, dateStr: utils.toDateString(in7), window: '7d' });
      }
    }

    if (meeting.reminder_24h) {
      const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      const next24   = utils.nextOccurrence(meeting, tomorrow);
      if (next24 && utils.toDateString(next24) === utils.toDateString(tomorrow)) {
        result.push({ meeting, dateStr: utils.toDateString(tomorrow), window: '24h' });
      }
    }
  }

  return result;
}

/**
 * Decide which cast members need shift DMs and what to send.
 * Pure — no I/O. Bookeo fetch and DB writes stay in the execute step.
 *
 * @param {object[]} shifts       Raw shifts (already fetched and window-filtered)
 * @param {Map}      memberLinks  bookeoName → { discord_id } (pre-fetched from DB)
 * @param {'weekly'|'daily'} mode
 * @returns {Array<{ discord_id: string, castName: string, dmText: string }>}
 */
function planShiftDMs(shifts, memberLinks, mode) {
  const label   = mode === 'weekly' ? 'this week' : 'within 24 hours';
  const grouped = bookeo.groupByCastMember(shifts);
  const result  = [];

  for (const [castName, castShifts] of Object.entries(grouped)) {
    const link = memberLinks.get(castName);
    if (!link) continue;
    result.push({
      discord_id: link.discord_id,
      castName,
      dmText: bookeo.buildShiftDM(castName, castShifts, label),
    });
  }

  return result;
}

/**
 * Enrich unfilled custom game rows for the reminder execute step.
 * Pure — no I/O. Receives games already cutoff-filtered by the caller.
 * Role coverage check (requires Discord reaction fetches) stays in the execute step.
 *
 * @param {object[]} games  Unfilled custom game rows (already 48h-cutoff-filtered)
 * @returns {Array<{ game: object, config: object, dateTimeStr: string }>}
 */
function planCustomGameReminders(games) {
  return games.map(game => ({
    game,
    config:      SHOWS[game.show],
    dateTimeStr: formatGameDateTime(game.date, game.time),
  }));
}

// ─── Meeting reminder execute ─────────────────────────────────────────────────

async function runMeetingReminderCheck(client) {
  const meetings = db.getActiveMeetings();
  // Use todayCentral()-derived Date — avoids UTC/Central date-boundary bug on Railway
  const todayStr = utils.todayCentral();
  const [y, mo, d] = todayStr.split('-').map(Number);
  const today = new Date(y, mo - 1, d);

  const planned = planMeetingReminders(meetings, today);
  for (const { meeting, dateStr, window } of planned) {
    await postMeetingReminder(client, meeting, dateStr, window);
  }
}

// ─── Shift DM execute ─────────────────────────────────────────────────────────

async function runShiftDMs(client, mode) {
  // mode: 'weekly' (next 7 days) | 'daily' (next 24 hours)
  const startedAt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  }).format(new Date());
  console.log(`[scheduler] runShiftDMs (${mode}) started at ${startedAt} CT`);

  const todayStr = utils.todayCentral();
  const [y, mo, d] = todayStr.split('-').map(Number);
  const from = todayStr;

  const end = mode === 'weekly'
    ? new Date(y, mo - 1, d + 7)
    : new Date(y, mo - 1, d + 1);
  const to = utils.toDateString(end);

  let shifts;
  try {
    shifts = await bookeo.getSchedule(from, to);
  } catch (err) {
    console.error('[scheduler] Failed to fetch Bookeo schedule:', err.message);
    return;
  }

  // bookeo-asst ignores the `to` param and returns a full week regardless.
  // Filter to only shifts within the requested window.
  const allDates = [...new Set(shifts.map(s => s.date))].sort();
  console.log(`[scheduler] shift DM window: ${from} → ${to}, API returned dates: ${allDates.join(', ')}`);
  shifts = shifts.filter(s => s.date >= from && s.date <= to);
  console.log(`[scheduler] after filter: ${shifts.length} shift(s) in range`);

  if (!shifts.length) {
    console.log(`[scheduler] No shifts in window ${from} → ${to}`);
    return;
  }

  // Pre-fetch all member links once for the pure plan step
  const allLinks   = db.getAllMemberLinks();
  const memberLinks = new Map(allLinks.map(l => [l.bookeo_name, l]));

  const planned = planShiftDMs(shifts, memberLinks, mode);
  let sent = 0, skipped = shifts.length - planned.length;

  for (const { discord_id, castName, dmText } of planned) {
    // In daily mode, attach check-in buttons for any pending check-in records today
    let dmPayload = dmText;
    if (mode === 'daily') {
      const { pending } = checkin.queryCheckins(discord_id, todayStr);
      if (pending.length) {
        const showNames = pending.map(r => r.show).join(', ');
        console.log(`[scheduler] ${castName} — attaching check-in button(s) for: ${showNames}`);
        const rows = pending.map(rec => {
          const btn = new ButtonBuilder()
            .setCustomId(`checkin:${rec.show}:${rec.shift_date}`)
            .setLabel(`Check in: ${SHOWS[rec.show].label}`)
            .setStyle(ButtonStyle.Success);
          return new ActionRowBuilder().addComponents(btn);
        });
        dmPayload = { content: dmText, components: rows };
      } else {
        console.log(`[scheduler] ${castName} — no pending check-in records, sending DM without button`);
      }
    }

    try {
      const user = await client.users.fetch(discord_id);
      await user.send(dmPayload);
      sent++;
      console.log(`[scheduler] Sent ${mode} shift DM to ${castName} (${discord_id})`);
    } catch (err) {
      console.error(`[scheduler] Failed to DM ${castName} (${discord_id}):`, err.message);
      skipped++;
    }
  }

  console.log(`[scheduler] Shift DM run complete — sent: ${sent}, no link: ${skipped}`);
}

// ─── Custom game 48h reminder execute ────────────────────────────────────────

async function runCustomGameReminders(client) {
  const cutoff   = Math.floor(Date.now() / 1000) - (48 * 3600);
  const unfilled = db.getUnfilledCustomGames(cutoff);
  if (!unfilled.length) return;

  const planned = planCustomGameReminders(unfilled);
  if (!planned.length) return;
  console.log(`[scheduler] Found ${planned.length} unfilled custom game(s) past 48h`);

  for (const { game, config, dateTimeStr } of planned) {
    try {
      const channel = await client.channels.fetch(game.channel_id);
      const guild   = channel.guild;

      // Determine which roles still need coverage
      let pingStr = '@here';

      if (config.discordRoles && game.message_id) {
        // Multi-role show: check which roles are already covered by ✅ reactors
        try {
          const msg         = await channel.messages.fetch(game.message_id);
          const yesReaction = msg.reactions.cache.find(r => r.emoji.name === '✅');
          const yesUsers    = yesReaction
            ? (await yesReaction.users.fetch()).filter(u => !u.bot)
            : new Map();

          const { missingRoles } = await getRoleCoverage(guild, yesUsers, game.show);

          if (missingRoles.length > 0) {
            await guild.roles.fetch(); // populate cache
            const mentions = missingRoles.map(displayName => {
              const discordRoleName = config.discordRoles[displayName];
              const role = guild.roles.cache.find(r => r.name === discordRoleName);
              return role ? `<@&${role.id}>` : `@${discordRoleName}`;
            });
            pingStr = mentions.join(' ');
          }
        } catch (err) {
          console.warn(`[scheduler] Could not check fill status for game ${game.id}, falling back to @here:`, err.message);
        }
      }

      const content = `<@${game.requester_id}>, ${pingStr} Heads up - we are still looking for coverage for **${showLabel(game.show)}** for ${dateTimeStr}. Please respond if you have not yet. Thank you!`;
      await channel.send(content);
      db.markCustomGameReminderSent(game.id);
      console.log(`[scheduler] Sent 48h reminder for custom game ${game.id}`);
    } catch (err) {
      console.error(`[scheduler] Failed to send 48h reminder for custom game ${game.id}:`, err.message);
    }
  }
}

function formatGameDateTime(dateStr, timeStr) {
  const [y, mo, d]  = dateStr.split('-').map(Number);
  const dateDisplay = utils.formatMeetingDate(new Date(y, mo - 1, d));
  return timeStr ? `${dateDisplay} at ${utils.formatTime(timeStr)}` : dateDisplay;
}

module.exports = {
  start,
  runMeetingReminderCheck,
  runShiftDMs,
  runCustomGameReminders,
  // Pure plan functions — exported for testing
  planMeetingReminders,
  planShiftDMs,
  planCustomGameReminders,
};
