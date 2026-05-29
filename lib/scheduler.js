const cron     = require('node-cron');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db       = require('./db');
const utils    = require('./utils');
const bookeo   = require('./bookeo');
const { showLabel, showAutoRole, showCharacters, getDiscordRoleName, getShowRole, showEmojis } = require('./shows');
const { planMissingRolePings, buildEodDM, buildAllRespondedDM, analyzeCoverage } = require('./coverage');
const checkin = require('./checkin');
const { CENTRAL_TZ } = require('./utils');
const cfg = require('./config');
const members = require('./members');
const { makeDiscordAdapter } = require('./adapters/discord');
const { makeBookeoAdapter }  = require('./adapters/bookeo');

function start(client) {
  const discord   = makeDiscordAdapter(client);
  const bkAdapter = makeBookeoAdapter();

  // ── Midnight check-in seeding — every day at 12:05am ─────────────────────
  // Seeds check-in records for the new day before the shift DM cron runs.
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
    try { await runMeetingReminderCheck(discord); }
    catch (err) { console.error('[scheduler] Meeting reminder check failed:', err); }
    try { await runCustomGameReminders(discord); }
    catch (err) { console.error('[scheduler] Custom game reminder check failed:', err); }
    try { await runCoverageRolePings(discord); }
    catch (err) { console.error('[scheduler] Coverage role ping job failed:', err); }
  }, { timezone: CENTRAL_TZ });

  // ── 9pm EOD coverage reminder ─────────────────────────────────────────────
  cron.schedule('0 21 * * *', async () => {
    try { await runEodCoverageReminder(discord); }
    catch (err) { console.error('[scheduler] EOD coverage reminder failed:', err); }
  }, { timezone: CENTRAL_TZ });

  // ── Backup check-in seeding — every day at 8am ───────────────────────────
  // Safety net: if the midnight seeding failed or the bot restarted after shows
  // started, this ensures check-in records exist for all of today's shows
  // (including 9am shows) before the shift DM window opens at ~8:48am.
  cron.schedule('0 8 * * *', async () => {
    const seedDate = utils.todayCentral();
    console.log(`[checkin] 8am backup re-seeding for ${seedDate}`);
    await checkin.seedWithRetry(client, seedDate, 1);
  }, { timezone: CENTRAL_TZ });

  // ── Weekly shift DMs — every Monday at 8:48am ────────────────────────────
  // Runs before 9am show starts so Bookeo still returns cast member info.
  cron.schedule('48 8 * * 1', async () => {
    if (!cfg.isWeeklyShiftsEnabled()) return;
    console.log('[scheduler] Running weekly shift DM job');
    try {
      await runShiftDMs(discord, bkAdapter, 'weekly');
    } catch (err) {
      console.error('[scheduler] Weekly shift DM job failed:', err);
    }
  }, { timezone: CENTRAL_TZ });

  // ── Daily 24hr shift DMs — every day at 8:48am ───────────────────────────
  // Runs before 9am show starts so Bookeo still returns cast member info.
  cron.schedule('48 8 * * *', async () => {
    if (!cfg.isDailyShiftsEnabled()) return;
    console.log('[scheduler] Running daily 24hr shift DM job');
    try {
      await runShiftDMs(discord, bkAdapter, 'daily');
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
 * Given all member IDs in a Discord role, the set of IDs who have already reacted
 * with any emoji, and a set of excluded IDs, return the IDs that should be
 * individually @mentioned in a coverage reminder.
 *
 * Returns an empty array when every member has responded or is excluded — the
 * caller should fall back to a role-level ping in that case.
 *
 * Pure — no I/O.
 *
 * @param {string[]} memberIds    All user IDs in the relevant Discord role
 * @param {string[]|Set} reactorIds  IDs who reacted with any emoji on the post
 * @param {string[]|Set} exclusionIds  IDs to never ping
 * @returns {string[]}
 */
function planNonResponderMentions(memberIds, reactorIds, exclusionIds) {
  const reacted  = new Set(reactorIds);
  const excluded = new Set(exclusionIds);
  return memberIds.filter(id => !reacted.has(id) && !excluded.has(id));
}

/**
 * Enrich unfilled custom game rows for the reminder execute step.
 * Pure — no I/O. Receives games already cutoff-filtered by the caller.
 * Role coverage check (requires Discord reaction fetches) stays in the execute step.
 *
 * @param {object[]} games  Unfilled custom game rows (already 48h-cutoff-filtered)
 * @returns {Array<{ game: object, dateTimeStr: string }>}
 */
function planCustomGameReminders(games) {
  return games.map(game => ({
    game,
    dateTimeStr: utils.formatShiftDateTime(game.date, game.time),
  }));
}

// ─── Meeting reminder execute ─────────────────────────────────────────────────

async function runMeetingReminderCheck(discord) {
  const meetings = db.getActiveMeetings();
  // Use todayCentral()-derived Date — avoids UTC/Central date-boundary bug on Railway
  const todayStr = utils.todayCentral();
  const [y, mo, d] = todayStr.split('-').map(Number);
  const today = new Date(y, mo - 1, d);

  const planned = planMeetingReminders(meetings, today);
  for (const { meeting, dateStr, window } of planned) {
    await discord.postMeetingReminder(meeting, dateStr, window);
  }
}

// ─── Shift DM execute ─────────────────────────────────────────────────────────

async function runShiftDMs(discord, bookeoAdapter, mode) {
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
    shifts = await bookeoAdapter.getSchedule(from, to);
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
      await discord.sendDM(discord_id, dmPayload);
      sent++;
      console.log(`[scheduler] Sent ${mode} shift DM to ${castName} (${discord_id})`);
    } catch (err) {
      console.error(`[scheduler] Failed to DM ${castName} (${discord_id}):`, err.message);
      skipped++;
    }
  }

  console.log(`[scheduler] Shift DM run complete — sent: ${sent}, no link: ${skipped}`);
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function fetchYesReactors(discord, message) {
  const reaction = message.reactions.cache.find(r => r.emoji.name === '✅');
  if (!reaction) return new Map();
  return discord.fetchReactionUsers(reaction);
}

// ─── Custom game 48h reminder execute ────────────────────────────────────────

async function runCustomGameReminders(discord) {
  const cutoff      = Math.floor(Date.now() / 1000) - (48 * 3600);
  const unfilled    = db.getUnfilledCustomGames(cutoff);
  if (!unfilled.length) return;

  const planned     = planCustomGameReminders(unfilled);
  if (!planned.length) return;
  console.log(`[scheduler] Found ${planned.length} unfilled custom game(s) past 48h`);

  const exclusionIds = db.getCoveragePingExclusions();

  for (const { game, dateTimeStr } of planned) {
    try {
      const channel = await discord.fetchChannel(game.channel_id);
      const guild   = channel.guild;

      let pingStr = '@here';

      if (game.message_id) {
        try {
          await discord.fetchGuildRoles(guild);
          await discord.fetchGuildMembers(guild);

          const msg = await discord.fetchMessage(channel, game.message_id);

          // Collect all non-bot reactors (any emoji)
          const reactorIds = new Set();
          for (const reaction of msg.reactions.cache.values()) {
            const users = await discord.fetchReactionUsers(reaction);
            users.forEach(u => reactorIds.add(u.id));
          }

          // Determine which roles still need coverage
          let roleNamesToTarget = [];
          const yesUsers = await fetchYesReactors(discord, msg);
          const { isFilled, missingRoles } = await analyzeCoverage(guild, yesUsers, game.show);
          if (!isFilled) {
            if (missingRoles.length > 0) {
              roleNamesToTarget = missingRoles;
            } else {
              const autoRole = showAutoRole(game.show);
              if (autoRole) roleNamesToTarget = [autoRole];
            }
          }

          const mentions = [];
          for (const displayName of roleNamesToTarget) {
            const discordRoleName = getDiscordRoleName(game.show, displayName);
            const discordRole     = guild.roles.cache.find(r => r.name === discordRoleName);

            if (!discordRole) {
              mentions.push(`@${discordRoleName}`);
              continue;
            }

            const memberIds     = [...discordRole.members.keys()];
            const nonResponders = planNonResponderMentions(memberIds, reactorIds, exclusionIds);

            if (nonResponders.length > 0) {
              mentions.push(...nonResponders.map(id => `<@${id}>`));
            } else {
              mentions.push(`<@&${discordRole.id}>`);
            }
          }

          if (mentions.length > 0) pingStr = mentions.join(' ');
        } catch (err) {
          console.warn(`[scheduler] Could not check fill status for game ${game.id}, falling back to @here:`, err.message);
        }
      }

      const content = `<@${game.requester_id}>, ${pingStr} Heads up - we are still looking for coverage for **${showLabel(game.show)}** for ${dateTimeStr}. Please respond if you have not yet. Thank you!`;
      await discord.sendMessage(channel, content);
      db.markCustomGameReminderSent(game.id);
      console.log(`[scheduler] Sent 48h reminder for custom game ${game.id}`);
    } catch (err) {
      console.error(`[scheduler] Failed to send 48h reminder for custom game ${game.id}:`, err.message);
    }
  }
}

// ─── Coverage role-ping execute ───────────────────────────────────────────────

async function runCoverageRolePings(discord) {
  const openShifts   = db.getOpenCoverageShiftsWithRequests();
  const openGames    = db.getOpenCustomGamesForPings();
  if (!openShifts.length && !openGames.length) return;

  const exclusionIds = db.getCoveragePingExclusions();

  // Maps: messageId → show / dateTimeStr / requester_id / shift meta (needed in the send loop)
  const showByMessageId      = new Map();
  const dateTimeByMessageId  = new Map();
  const requesterByMessageId = new Map(); // coverage shifts only; used to exclude requester from pings
  const shiftMetaByMessageId = new Map(); // coverage shifts only; messageId → { id, alertSent }

  // Enrich shifts with missingRoles
  const enrichedShifts = [];
  for (const s of openShifts) {
    if (!s.shift_message_id || !s.channel_id) continue;

    const roleForShift = s.character ?? showAutoRole(s.show);
    if (!roleForShift) continue;

    let missingRoles = [roleForShift];
    try {
      const ch       = await discord.fetchChannel(s.channel_id);
      const msg      = await discord.fetchMessage(ch, s.shift_message_id);
      const yesUsers = await fetchYesReactors(discord, msg);
      const { isFilled } = await analyzeCoverage(ch.guild, yesUsers, s.show, s.character ?? null);
      if (isFilled) missingRoles = [];
    } catch (err) {
      console.warn(`[scheduler] Could not check reactions for shift ${s.id}:`, err.message);
      continue;
    }

    showByMessageId.set(s.shift_message_id, s.show);
    dateTimeByMessageId.set(s.shift_message_id, utils.formatShiftDateTime(s.date, s.time));
    if (s.requester_id) requesterByMessageId.set(s.shift_message_id, s.requester_id);
    shiftMetaByMessageId.set(s.shift_message_id, { id: s.id, alertSent: !!s.all_responded_alert_sent });
    enrichedShifts.push({ ...s, missingRoles });
  }

  // Enrich games with missingRoles
  const enrichedGames = [];
  for (const g of openGames) {
    if (!g.message_id || !g.channel_id) continue;

    let missingRoles = [];
    try {
      const ch       = await discord.fetchChannel(g.channel_id);
      const guild    = ch.guild;
      const msg      = await discord.fetchMessage(ch, g.message_id);
      const yesUsers = await fetchYesReactors(discord, msg);
      const { isFilled, missingRoles: mr } = await analyzeCoverage(guild, yesUsers, g.show);
      if (!isFilled) {
        if (mr.length > 0) {
          missingRoles = mr;
        } else {
          const autoRole = showAutoRole(g.show);
          if (autoRole) missingRoles = [autoRole];
        }
      }
    } catch (err) {
      console.warn(`[scheduler] Could not check reactions for game ${g.id}:`, err.message);
      continue;
    }

    showByMessageId.set(g.message_id, g.show);
    dateTimeByMessageId.set(g.message_id, utils.formatShiftDateTime(g.date, g.time));
    enrichedGames.push({ ...g, missingRoles });
  }

  const plan = planMissingRolePings(enrichedShifts, enrichedGames);
  if (!plan.length) return;

  console.log(`[scheduler] Sending ${plan.length} missing-role ping(s)`);

  for (const { channelId, roleNames, messageId } of plan) {
    try {
      const ch    = await discord.fetchChannel(channelId);
      const guild = ch.guild;
      await discord.fetchGuildRoles(guild);
      await discord.fetchGuildMembers(guild);

      const show            = showByMessageId.get(messageId);
      const maybeEmojiNames = show ? new Set(showEmojis(show).maybe.map(e => e.name)) : new Set();

      // Collect all reactors (any emoji) + maybe-reactors in one pass
      const reactorIds      = new Set();
      const maybeReactorIds = new Set();
      try {
        const msg = await discord.fetchMessage(ch, messageId);
        for (const reaction of msg.reactions.cache.values()) {
          const users = await discord.fetchReactionUsers(reaction);
          users.forEach(u => {
            reactorIds.add(u.id);
            if (maybeEmojiNames.has(reaction.emoji.name)) maybeReactorIds.add(u.id);
          });
        }
      } catch (err) {
        console.warn(`[scheduler] Could not fetch reactors for ${messageId}, falling back to role pings:`, err.message);
      }

      const mentions       = [];
      const exhaustedRoles = []; // roles where all effective members responded but none said yes

      for (const roleName of roleNames) {
        const discordRoleName = show ? getDiscordRoleName(show, roleName) : roleName;
        const discordRole     = guild.roles.cache.find(r => r.name === discordRoleName);

        if (!discordRole) {
          mentions.push(`@${discordRoleName}`);
          continue;
        }

        const memberIds        = [...discordRole.members.keys()];
        const shiftRequester   = requesterByMessageId.get(messageId);
        const pingExclusionIds = shiftRequester ? [...exclusionIds, shiftRequester] : exclusionIds;
        const nonResponders    = planNonResponderMentions(memberIds, reactorIds, pingExclusionIds);

        // Effective members are those not in the exclusion list (e.g. not the requester)
        const excludedSet      = new Set(pingExclusionIds);
        const effectiveMembers = memberIds.filter(id => !excludedSet.has(id));

        if (nonResponders.length > 0) {
          // Some members haven't responded yet — ping them individually
          mentions.push(...nonResponders.map(id => `<@${id}>`));
        } else if (effectiveMembers.length > 0) {
          // All effective members responded but none said yes — DM path, no channel ping
          exhaustedRoles.push(roleName);
        } else {
          // No effective members in role (empty or fully excluded) — @role fallback
          mentions.push(`<@&${discordRole.id}>`);
        }
      }

      // Send DMs when all cast for one or more roles have responded with no availability
      const shiftMeta = shiftMetaByMessageId.get(messageId);
      if (exhaustedRoles.length > 0 && shiftMeta && !shiftMeta.alertSent) {
        const dateTimeStr = dateTimeByMessageId.get(messageId);
        const postLink    = `https://discord.com/channels/${guild.id}/${channelId}/${messageId}`;
        const maybeNames  = [...maybeReactorIds]
          .map(id => members.getDisplayName(id, null))
          .filter(Boolean);

        const requesterId = requesterByMessageId.get(messageId);
        if (requesterId) {
          try {
            await discord.sendDM(requesterId,
              buildAllRespondedDM(exhaustedRoles, show, dateTimeStr, postLink, 'requester', maybeNames));
          } catch (err) {
            console.warn(`[scheduler] Could not DM requester for shift ${shiftMeta.id}:`, err.message);
          }
        }

        const managerId = cfg.getCoverageManagerId();
        if (managerId) {
          try {
            await discord.sendDM(managerId,
              buildAllRespondedDM(exhaustedRoles, show, dateTimeStr, postLink, 'manager', maybeNames));
          } catch (err) {
            console.warn(`[scheduler] Could not DM cast manager for shift ${shiftMeta.id}:`, err.message);
          }
        }

        db.markAllRespondedAlertSent(shiftMeta.id);
        shiftMeta.alertSent = true;
        console.log(`[scheduler] Sent all-responded alert for shift ${shiftMeta.id} (${exhaustedRoles.join(', ')})`);
      }

      // Send channel ping for roles that still have non-responders
      if (mentions.length > 0) {
        const dateTimeStr = dateTimeByMessageId.get(messageId);
        const forPart     = dateTimeStr ? ` for ${dateTimeStr}` : '';
        const link        = `https://discord.com/channels/${guild.id}/${channelId}/${messageId}`;
        const content     = `${mentions.join(' ')} Reminder: coverage still needed${forPart} — react ✅ if you're available: ${link}`;
        await discord.sendMessage(ch, content);
        console.log(`[scheduler] Sent role ping in channel ${channelId} for message ${messageId}`);
      }
    } catch (err) {
      console.error(`[scheduler] Role ping failed for message ${messageId}:`, err.message);
    }
  }
}

// ─── EOD coverage reminder execute ───────────────────────────────────────────

async function runEodCoverageReminder(discord) {
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
      const ch  = await discord.fetchChannel(s.channel_id);
      guildId   = ch.guild.id;
      const msg = await discord.fetchMessage(ch, s.shift_message_id);
      const yes = msg.reactions.cache.find(r => r.emoji.name === '✅');
      if (yes) {
        const yesUsers = await discord.fetchReactionUsers(yes);
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
      const ch    = await discord.fetchChannel(g.channel_id);
      guildId     = ch.guild.id;
      const guild = ch.guild;
      const msg   = await discord.fetchMessage(ch, g.message_id);
      const yes   = msg.reactions.cache.find(r => r.emoji.name === '✅');
      const yesUsers = yes
        ? await discord.fetchReactionUsers(yes)
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
    await discord.sendDM(managerId, dmText);
    console.log(`[scheduler] Sent EOD coverage reminder (${pendingItems.length} item(s)) to cast manager`);
  } catch (err) {
    console.error('[scheduler] Failed to send EOD coverage reminder:', err.message);
  }
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
  planNonResponderMentions,
};
