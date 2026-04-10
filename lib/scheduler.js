const cron     = require('node-cron');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db       = require('./db');
const utils    = require('./utils');
const bookeo   = require('./bookeo');
const { postMeetingReminder } = require('./meetings');
const { SHOWS, getShowRole } = require('./shows');

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

    // In daily mode, attach check-in buttons for any pending check-in records today
    let dmPayload = dmText;
    if (mode === 'daily') {
      const today   = utils.todayCentral();
      const pending = db.getPendingCheckinsByDiscord(link.discord_id, today);
      if (pending.length) {
        const rows = pending.map(rec => {
          const btn = new ButtonBuilder()
            .setCustomId(`checkin:${rec.show}:${rec.shift_date}`)
            .setLabel(`Check in: ${SHOWS[rec.show].label}`)
            .setStyle(ButtonStyle.Success);
          return new ActionRowBuilder().addComponents(btn);
        });
        dmPayload = { content: dmText, components: rows };
      }
    }

    try {
      const user = await client.users.fetch(link.discord_id);
      await user.send(dmPayload);
      sent++;
      console.log(`[scheduler] Sent ${mode} shift DM to ${castName} (${link.discord_id})`);
    } catch (err) {
      console.error(`[scheduler] Failed to DM ${castName} (${link.discord_id}):`, err.message);
    }
  }

  console.log(`[scheduler] Shift DM run complete — sent: ${sent}, no link: ${skipped}`);
}

// ─── Custom game 48h reminder ─────────────────────────────────────────────────

async function runCustomGameReminders(client) {
  const cutoff   = Math.floor(Date.now() / 1000) - (48 * 3600);
  const unfilled = db.getUnfilledCustomGames(cutoff);

  if (!unfilled.length) return;
  console.log(`[scheduler] Found ${unfilled.length} unfilled custom game(s) past 48h`);

  for (const game of unfilled) {
    const config      = SHOWS[game.show];
    const dateTimeStr = formatGameDateTime(game.date, game.time);

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
          const coveredRoles = new Set();

          if (yesReaction) {
            const yesUsers = (await yesReaction.users.fetch()).filter(u => !u.bot);
            for (const u of yesUsers.values()) {
              const roleStr = await getShowRole(guild, u.id, game.show);
              if (roleStr) {
                for (const part of roleStr.split('/')) coveredRoles.add(part);
              }
            }
          }

          const missingRoleNames = Object.entries(config.discordRoles)
            .filter(([roleName]) => !coveredRoles.has(roleName))
            .map(([, discordRoleName]) => discordRoleName);

          if (missingRoleNames.length > 0) {
            await guild.roles.fetch(); // populate cache
            const mentions = missingRoleNames.map(rName => {
              const role = guild.roles.cache.find(r => r.name === rName);
              return role ? `<@&${role.id}>` : `@${rName}`;
            });
            pingStr = mentions.join(' ');
          }
        } catch (err) {
          console.warn(`[scheduler] Could not check fill status for game ${game.id}, falling back to @here:`, err.message);
        }
      }

      const content = `<@${game.requester_id}>, ${pingStr} Heads up - we are still looking for coverage for **${config.label}** for ${dateTimeStr}. Please respond if you have not yet. Thank you!`;
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

module.exports = { start, runMeetingReminderCheck, runShiftDMs, runCustomGameReminders };
