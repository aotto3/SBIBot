const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancel-custom-game')
    .setDescription('Close a custom game availability post')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt =>
      opt.setName('game_id')
        .setDescription('Game ID (shown in the bot reply when the post was created)')
        .setRequired(true)
    )
    .addBooleanOption(opt =>
      opt.setName('notify')
        .setDescription('Post a notice in the channel? (default: yes)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const gameId = interaction.options.getInteger('game_id');
    const notify = interaction.options.getBoolean('notify') ?? true;

    const game = db.getCustomGameById(gameId);
    if (!game) {
      return interaction.editReply(`No custom game found with ID \`${gameId}\`.`);
    }

    if (game.filled_at) {
      return interaction.editReply(`Custom game \`${gameId}\` is already closed (filled or cancelled).`);
    }

    db.deactivateCustomGame(gameId);

    if (notify && game.channel_id) {
      try {
        const channel = await interaction.client.channels.fetch(game.channel_id);
        await channel.send('_This availability post has been closed._');
      } catch (err) {
        console.error(`[cancel-custom-game] Failed to notify channel for game ${gameId}:`, err.message);
      }
    }

    await interaction.editReply(`✅ Custom game \`${gameId}\` closed.`);
  },
};
