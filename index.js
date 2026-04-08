require('dotenv').config();

const { Client, GatewayIntentBits, Collection, Events, Partials } = require('discord.js');
const { handleReactionChange } = require('./lib/rsvp');
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

client.once(Events.ClientReady, c => {
  console.log(`Logged in as ${c.user.tag}`);
  require('./lib/scheduler').start(client);
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

// ─── Slash commands ───────────────────────────────────────────────────────────

client.on(Events.InteractionCreate, async interaction => {
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
