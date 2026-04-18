require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  Partials,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { handleReactionChange } = require('./lib/rsvp');
const db      = require('./lib/db');
const checkin = require('./lib/checkin');
const { showLabel } = require('./lib/shows');
const utils   = require('./lib/utils');
const { handleCoverageRequestModal } = require('./commands/coverage-request');
const fs   = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
  ],
  // Partials needed so the bot can read reactions on messages it didn't see posted
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ─── Load commands ────────────────────────────────────────────────────────────

client.commands = new Collection();

const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'))) {
  const command = require(path.join(commandsDir, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
  } else {
    console.warn(`[warn] commands/${file} is missing data or execute — skipped`);
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────

// Attempt seeding with a 20s timeout. On failure, retry every 5 minutes for up
// to 1 hour. Background retries fire after the scheduler is already running so
// they don't block anything. Stops retrying if the date rolls over (no point
// seeding yesterday's records).
const SEED_TIMEOUT_MS  = 20_000;
const SEED_RETRY_MS    = 5 * 60 * 1000;
const SEED_MAX_RETRIES = 12; // 12 × 5min = 1 hour

async function _trySeed(seedDate, attempt) {
  try {
    await Promise.race([
      checkin.seedAndScheduleToday(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timed out after 20s')), SEED_TIMEOUT_MS)
      ),
    ]);
    const suffix = attempt > 1 ? ` (succeeded on attempt ${attempt})` : '';
    console.log(`[checkin] Seeding complete${suffix}`);
  } catch (err) {
    console.error(`[checkin] Seeding attempt ${attempt} failed: ${err.message}`);
    if (attempt >= SEED_MAX_RETRIES) {
      console.error('[checkin] Seeding exhausted all retries — check bookeo-asst');
      return;
    }
    const utils = require('./lib/utils');
    if (utils.todayCentral() !== seedDate) {
      console.log('[checkin] Date rolled over during retry — skipping remaining retries');
      return;
    }
    console.log(`[checkin] Retrying seeding in 5 minutes (attempt ${attempt + 1}/${SEED_MAX_RETRIES})`);
    setTimeout(() => _trySeed(seedDate, attempt + 1), SEED_RETRY_MS);
  }
}

client.once(Events.ClientReady, async c => {
  console.log(`Logged in as ${c.user.tag}`);

  // ── Check-in seeding & startup recovery ────────────────────────────────────
  // Seed first so check-in records exist before the 9am shift DM cron fires.
  // Starting the scheduler before seeding completes causes a race where the
  // DM job queries pending records before they've been inserted.
  // _trySeed will retry in the background on failure without blocking startup.
  checkin.init(client);
  const seedDate = require('./lib/utils').todayCentral();
  await _trySeed(seedDate, 1);

  require('./lib/scheduler').start(client);
});

// ─── DM forwarding ───────────────────────────────────────────────────────────
// Forward any DM received by the bot to Allen so cast member questions don't
// go unnoticed. Allen's ID is hardcoded — change here if ownership transfers.

const ALLEN_DISCORD_ID = '302924689704222723';

client.on(Events.MessageCreate, async message => {
  console.log(`[dm-forward] MessageCreate: author=${message.author?.username} isDM=${message.channel.isDMBased()} isBot=${message.author?.bot}`);
  // Only handle DMs, not guild messages
  if (!message.channel.isDMBased()) return;
  // Ignore the bot's own messages and Allen DMing the bot directly
  if (message.author.bot) return;
  if (message.author.id === ALLEN_DISCORD_ID) return;

  const timeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(message.createdAt) + ' CT';

  const body    = message.content || '_(no text — may contain an attachment)_';
  const forward = `📩 DM from **${message.author.displayName}** (@${message.author.username})\n${timeStr}\n\n"${body}"`;

  try {
    const allen = await client.users.fetch(ALLEN_DISCORD_ID);
    await allen.send(forward);
    console.log(`[dm-forward] Forwarded DM from ${message.author.username} to Allen`);
  } catch (err) {
    console.error('[dm-forward] Failed to forward DM:', err.message);
  }
});

// ─── RSVP reaction tracker ────────────────────────────────────────────────────

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    await handleReactionChange(client, reaction, user);
  } catch (err) {
    console.error('[rsvp] Unhandled error on reaction add:', err);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  try {
    await handleReactionChange(client, reaction, user);
  } catch (err) {
    console.error('[rsvp] Unhandled error on reaction remove:', err);
  }
});

// ─── Check-in button handler ──────────────────────────────────────────────────

async function handleCheckinButton(interaction) {
  const parts    = interaction.customId.split(':');
  const show     = parts[1];
  const date     = parts[2];
  const rec      = db.getCheckinRecordByDiscordAndShow(interaction.user.id, show, date);

  if (!rec) {
    await interaction.reply({ content: 'No check-in record found for you.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (rec.checked_in_at) {
    await interaction.reply({ content: 'You already checked in!', flags: MessageFlags.Ephemeral });
    return;
  }

  await checkin.performCheckin(rec.id);

  const timeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date());

  // Rebuild the message rows, disabling the clicked button with a timestamp
  const updatedRows = interaction.message.components.map(row => {
    const components = row.components.map(btn => {
      if (btn.customId === interaction.customId) {
        return new ButtonBuilder()
          .setCustomId(`checkin_done:${show}:${date}`)
          .setLabel(`✅ Checked in at ${timeStr} CT`)
          .setStyle(ButtonStyle.Success)
          .setDisabled(true);
      }
      return ButtonBuilder.from(btn.toJSON());
    });
    return new ActionRowBuilder().addComponents(components);
  });

  await interaction.update({ components: updatedRows });
  console.log(`[checkin] ${interaction.user.tag} checked in for ${show} on ${date} via DM button`);
}

// ─── Check-in select menu handler ────────────────────────────────────────────

async function handleCheckinSelect(interaction) {
  const date = interaction.customId.split(':')[1];
  const show = interaction.values[0];
  const rec  = db.getCheckinRecordByDiscordAndShow(interaction.user.id, show, date);

  if (!rec) {
    await interaction.update({ content: 'No check-in record found.', components: [] });
    return;
  }
  if (rec.checked_in_at) {
    await interaction.update({ content: 'You already checked in for that show!', components: [] });
    return;
  }

  await checkin.performCheckin(rec.id);
  await interaction.update({
    content: `✅ Checked in for **${showLabel(show)}** today.`,
    components: [],
  });
  console.log(`[checkin] ${interaction.user.tag} checked in for ${show} on ${date} via /check-in select`);
}

// ─── Slash commands and component interactions ────────────────────────────────

client.on(Events.InteractionCreate, async interaction => {
  // Check-in button (from daily DM)
  if (interaction.isButton() && interaction.customId.startsWith('checkin:')) {
    try { await handleCheckinButton(interaction); } catch (err) { console.error('[checkin] Button handler error:', err); }
    return;
  }

  // Check-in select menu (from /check-in command)
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('checkin_select:')) {
    try { await handleCheckinSelect(interaction); } catch (err) { console.error('[checkin] Select handler error:', err); }
    return;
  }

  // Coverage request modal submit
  if (interaction.isModalSubmit() && interaction.customId.startsWith('coverage_request_modal:')) {
    try { await handleCoverageRequestModal(interaction); } catch (err) { console.error('[coverage] Modal handler error:', err); }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[error] /${interaction.commandName}:`, err);
    const payload = { content: 'Something went wrong. Check the logs.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// Railway (and other hosts) send SIGTERM when stopping/restarting the container.
// Without a handler, Node exits with a signal code and npm reports "command failed".
// Handling it explicitly lets the Discord client disconnect cleanly and exit 0.

process.on('SIGTERM', () => {
  console.log('[shutdown] SIGTERM received — disconnecting and exiting');
  client.destroy();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[shutdown] SIGINT received — disconnecting and exiting');
  client.destroy();
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

// ─── Start ────────────────────────────────────────────────────────────────────

client.login(process.env.DISCORD_TOKEN);
