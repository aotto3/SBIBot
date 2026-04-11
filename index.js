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
const db   = require('./lib/db');
const { SHOWS } = require('./lib/shows');
const { seedTodayCheckins, scheduleCheckinAlert, editAlertForLateCheckin } = require('./lib/checkin');
const utils = require('./lib/utils');
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

client.once(Events.ClientReady, async c => {
  console.log(`Logged in as ${c.user.tag}`);
  require('./lib/scheduler').start(client);

  // ── Check-in seeding & startup recovery ────────────────────────────────────
  // Seed today's check-in records from Bookeo, then schedule alerts.
  // Also reschedules any pending alerts that were lost during a redeploy.
  try {
    await seedTodayCheckins(client);
  } catch (err) {
    console.error('[checkin] seedTodayCheckins failed on startup:', err);
  }

  // Recovery: reschedule alerts for any records that were pending before
  // seedTodayCheckins ran (i.e. seeded in a previous boot, not yet checked in).
  // seedTodayCheckins already scheduled newly-upserted records; this catches
  // records that pre-existed (INSERT OR IGNORE skipped them, so scheduleCheckinAlert
  // wasn't called for them above).
  const today   = utils.todayCentral();
  const pending = db.getPendingCheckins(today);
  for (const rec of pending) {
    scheduleCheckinAlert(client, rec);
  }
  if (pending.length) {
    console.log(`[checkin] Recovery: rescheduled ${pending.length} pending alert(s) from previous boot`);
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

  db.markCheckedIn(rec.id);

  const fresh = db.getCheckinRecordById(rec.id);
  await editAlertForLateCheckin(interaction.client, fresh);

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

  db.markCheckedIn(rec.id);
  const freshSelect = db.getCheckinRecordById(rec.id);
  await editAlertForLateCheckin(interaction.client, freshSelect);
  await interaction.update({
    content: `✅ Checked in for **${SHOWS[show].label}** today.`,
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
