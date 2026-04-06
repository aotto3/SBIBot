/**
 * deploy-commands.js
 * Run once (or after adding/changing commands) to register slash commands with Discord.
 *
 *   node deploy-commands.js
 *   npm run deploy-commands
 *
 * Uses guild-scoped registration so changes appear instantly (vs. global which takes up to 1 hour).
 */
require('dotenv').config();

const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const fs   = require('fs');
const path = require('path');

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
  console.error('Missing one or more required env vars: DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID');
  process.exit(1);
}

const commands = [];
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'))) {
  const command = require(path.join(commandsDir, file));
  if (command.data) {
    commands.push(command.data.toJSON());
  }
}

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Registering ${commands.length} slash command(s) to guild ${DISCORD_GUILD_ID}...`);
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
      { body: commands }
    );
    console.log('Done.');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
