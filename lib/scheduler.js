const cron     = require('node-cron');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db       = require('./db');
const utils    = require('./utils');
const bookeo   = require('./bookeo');
const { postMeetingReminder } = require('./meetings');
const { showLabel, hasRoleTracking, showAutoRole, showCharacters, getDiscordRoleName, getRoleCoverage, getShowRole } = require('./shows');
const { planMissingRolePings, buildEodDM } = require('./coverage');
const checkin = require('./checkin');
const { CENTRAL_TZ } = require('./utils');
const cfg = require('./config');
const members = require('./members');

function start(client) {

  // ── Midnight check-in seeding — every day at 12:05am ─────────────────────
  // Seeds check-in records for the new day before the 9am shift DM cron runs.
  // Without this, records are only seeded at bot startup — so a continuously
  // running bot would never seed records for days after the initial deploy.
  cron.schedule('5 0 * * *', async () => {
    const seedDate = utils.todayCentral();
    console.log(`[checkin] Midnight re-seeding for ${seedDate}`);
    await checkin.seedWithRetry(client, seedDate, 1);
  }, { timezone: CENTRAL_TZ });

  // ── Daily 8am checks ───────────────────────────────────────────────────────
  // • Meeting reminders (7d and 24h windows)
  // • Unfilled custom game reminders (>48h old, not yet filled)
  cron.schedule('0 8 * * *', async () => {
    console.log('[scheduler] Running daily checks');
    try { await runMeetingReminderCheck(client); }
    catch (err) { console.error('[scheduler] Meeting reminder check failed:', err); }
    try { await runCustomGameReminders(client); }
    catch (err) { console.error('[scheduler] Custom game reminder check failed:', err); }
    try { await runCoverageRolePings(client); }
    catch (err) { console.error('[scheduler] Coverage role ping job failed:', err); }
  }, { timezone: CENTRAL_TZ });

  // ── 9pm EOD coverage reminder ─────────────────────────────────────────────
  cron.schedule('0 21 * * *', async () => {
    try { await runEodCoverageReminder(client); }
    catch (err) { console.error('[scheduler] EOD coverage reminder failed:', err); }
  }, { timezone: CENTRAL_TZ });

  // ── Weekly shift DMs — every Monday at 9am ─────────────────────────────────
  cron.schedule('0 9 * * 1', async () => {
    if (!cfg.isWeeklyShiftsEnabled()) return;
    console.log('[scheduler] Running weekly shift DM job');
    try {
      await runShiftDMs(client, 'weekly');
    } catch (err) {
      console.error('[scheduler] Weekly shift DM job failed:', err);
    }
  }, { timezone: CENTRAL_TZ });

  // ── Daily 24hr shift DMs — every day at 9am ────────────────────────────────
  cron.schedule('0 9 * * *', async () => {
    if (!cfg.isDailyShiftsEnabled()) return;
    console.log('[scheduler] Running daily 24hr shift DM job');
    try {
      await runShiftDMs(client, 'daily');
    } catch (err) {
      console.error('[scheduler] Daily 24hr shift DM job failed:', err);
    }
  }, { timezone: CENTRAL_TZ });

  console.log(`[scheduler] Jobs registered (tz: ${CENTRAL_TZ})`);
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
      discord_id: link.discordId,
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
    timeZone: CENTRAL_TZ, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
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
  const memberLinks = new Map(members.getAllLinkedMembers().map(m => [m.bookeoName, m]));

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
            .setLabel(`Check in: ${showLabel(rec.show)}`)
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

  for (const { game, dateTimeStr } of planned) {
    try {
      const channel = await client.channels.fetch(game.channel_id);
      const guild   = channel.guild;

      // Determine which roles still need coverage
      let pingStr = '@here';

      if (hasRoleTracking(game.show) && game.message_id) {
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
              const discordRoleName = getDiscordRoleName(game.show, displayName);
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

// ─── Coverage role-ping execute ───────────────────────────────────────────────

async function runCoverageRolePings(client) {
  const openShifts = db.getOpenCoverageShiftsWithRequests();
  const openGames  = db.getOpenCustomGamesForPings();
  if (!openShifts.length && !openGames.length) return;

  // Map: messageId → show (needed for role name → Discord role lookup after planMissingRolePings)
  const showByMessageId = new Map();

  // Enrich shifts with missingRoles
  const enrichedShifts = [];
  for (const s of openShifts) {
    if (!s.shift_message_id || !s.channel_id) continue;

    const roleForShift = s.character ?? showAutoRole(s.show);
    if (!roleForShift) continue;

    let missingRoles = [roleForShift];
    try {
      const ch  = await client.channels.fetch(s.channel_id);
      const msg = await ch.messages.fetch(s.shift_message_id);
      const yes = msg.reactions.cache.find(r => r.emoji.name === '✅');
      if (yes) {
        const yesUsers = (await yes.users.fetch()).filter(u => !u.bot);
        if (yesUsers.size > 0) missingRoles = [];
      }
    } catch (err) {
      console.warn(`[scheduler] Could not check reactions for shift ${s.id}:`, err.message);
      continue;
    }

    showByMessageId.set(s.shift_message_id, s.show);
    enrichedShifts.push({ ...s, missingRoles });
  }

  // Enrich games with missingRoles
  const enrichedGames = [];
  for (const g of openGames) {
    if (!g.message_id || !g.channel_id) continue;

    let missingRoles = [];
    try {
      const ch    = await client.channels.fetch(g.channel_id);
      const guild = ch.guild;
      const msg   = await ch.messages.fetch(g.message_id);
      const yes   = msg.reactions.cache.find(r => r.emoji.name === '✅');
      const yesUsers = yes
        ? (await yes.users.fetch()).filter(u => !u.bot)
        : new Map();

      if (hasRoleTracking(g.show)) {
        const { missingRoles: mr } = await getRoleCoverage(guild, yesUsers, g.show);
        missingRoles = mr;
      } else {
        if (yesUsers.size === 0) {
          const autoRole = showAutoRole(g.show);
          if (autoRole) missingRoles = [autoRole];
        }
      }
    } catch (err) {
      console.warn(`[scheduler] Could not check reactions for game ${g.id}:`, err.message);
      continue;
    }

    showByMessageId.set(g.message_id, g.show);
    enrichedGames.push({ ...g, missingRoles });
  }

  const plan = planMissingRolePings(enrichedShifts, enrichedGames);
  if (!plan.length) return;

  console.log(`[scheduler] Sending ${plan.length} missing-role ping(s)`);

  for (const { channelId, roleNames, messageId } of plan) {
    try {
      const ch    = await client.channels.fetch(channelId);
      const guild = ch.guild;
      await guild.roles.fetch();

      const show     = showByMessageId.get(messageId);
      const mentions = roleNames.map(roleName => {
        const discordRoleName = show ? getDiscordRoleName(show, roleName) : roleName;
        const discordRole     = guild.roles.cache.find(r => r.name === discordRoleName);
        return discordRole ? `<@&${discordRole.id}>` : `@${discordRoleName}`;
      });

      const link    = `https://discord.com/channels/${guild.id}/${channelId}/${messageId}`;
      const content = `${mentions.join(' ')} Reminder: coverage still needed — react ✅ if you're available: ${link}`;

      await ch.send(content);
      console.log(`[scheduler] Sent role ping in channel ${channelId} for message ${messageId}`);
    } catch (err) {
      console.error(`[scheduler] Role ping failed for message ${messageId}:`, err.message);
    }
  }
}

// ─── EOD coverage reminder execute ───────────────────────────────────────────

async function runEodCoverageReminder(client) {
  const managerId = cfg.getCoverageManagerId();
  if (!managerId) {
    console.warn('[scheduler] EOD reminder: no cast manager configured');
    return;
  }

  const unconfirmedShifts = db.getUnconfirmedFillableShifts();
  const unconfirmedGames  = db.getUnconfirmedFillableGames();
  if (!unconfirmedShifts.length && !unconfirmedGames.length) return;

  const pendingItems = [];

  for (const s of unconfirmedShifts) {
    let guildId = null;
    let availableByRole = [];
    try {
      const ch  = await client.channels.fetch(s.channel_id);
      guildId   = ch.guild.id;
      const msg = await ch.messages.fetch(s.shift_message_id);
      const yes = msg.reactions.cache.find(r => r.emoji.name === '✅');
      if (yes) {
        const yesUsers = (await yes.users.fetch()).filter(u => !u.bot);
        availableByRole = [...yesUsers.values()]
          .map(u => members.getDisplayName(u.id, u.displayName ?? u.username))
          .sort();
      }
    } catch (err) {
      console.warn(`[scheduler] EOD: could not fetch shift ${s.id} info:`, err.message);
      if (!guildId) continue;
    }

    pendingItems.push({
      show:            s.show,
      date:            s.date,
      time:            s.time,
      character:       s.character ?? null,
      availableByRole,
      postLink: `https://discord.com/channels/${guildId}/${s.channel_id}/${s.shift_message_id}`,
    });
  }

  for (const g of unconfirmedGames) {
    let guildId = null;
    let availableByRole = [];
    try {
      const ch    = await client.channels.fetch(g.channel_id);
      guildId     = ch.guild.id;
      const guild = ch.guild;
      const msg   = await ch.messages.fetch(g.message_id);
      const yes   = msg.reactions.cache.find(r => r.emoji.name === '✅');
      const yesUsers = yes
        ? (await yes.users.fetch()).filter(u => !u.bot)
        : new Map();

      if (showCharacters(g.show) && yesUsers.size > 0) {
        availableByRole = {};
        for (const u of yesUsers.values()) {
          const roleStr = await getShowRole(guild, u.id, g.show);
          if (roleStr) {
            for (const part of roleStr.split('/')) {
              if (!availableByRole[part]) availableByRole[part] = [];
              availableByRole[part].push(members.getDisplayName(u.id, u.displayName ?? u.username));
            }
          }
        }
      } else {
        availableByRole = [...yesUsers.values()]
          .map(u => members.getDisplayName(u.id, u.displayName ?? u.username))
          .sort();
      }
    } catch (err) {
      console.warn(`[scheduler] EOD: could not fetch game ${g.id} info:`, err.message);
      if (!guildId) continue;
    }

    pendingItems.push({
      show:            g.show,
      date:            g.date,
      time:            g.time,
      character:       null,
      availableByRole,
      postLink: `https://discord.com/channels/${guildId}/${g.channel_id}/${g.message_id}`,
    });
  }

  if (!pendingItems.length) return;

  const dmText = buildEodDM(pendingItems);
  try {
    const manager = await client.users.fetch(managerId);
    await manager.send(dmText);
    console.log(`[scheduler] Sent EOD coverage reminder (${pendingItems.length} item(s)) to cast manager`);
  } catch (err) {
    console.error('[scheduler] Failed to send EOD coverage reminder:', err.message);
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
  runCoverageRolePings,
  runEodCoverageReminder,
  // Pure plan functions — exported for testing
  planMeetingReminders,
  planShiftDMs,
  planCustomGameReminders,
};
