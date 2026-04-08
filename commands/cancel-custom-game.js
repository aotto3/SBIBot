const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancel-custom-game')
    .setDescription('Cancel a custom game availability post and delete it from the channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt =>
      opt.setName('game_id')
        .setDescription('Game ID (shown on the post itself, or in the bot reply when created)')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const gameId = interaction.options.getInteger('game_id');
    const game   = db.getCustomGameById(gameId);

    if (!game) {
      return interaction.editReply(`No custom game found with ID \`${gameId}\`.`);
    }

    if (game.filled_at) {
      return interaction.editReply(`Custom game \`${gameId}\` is already closed (filled or cancelled).`);
    }

    db.deactivateCustomGame(gameId);

    // Delete the original post
    if (game.channel_id && game.message_id) {
      try {
        const channel = await interaction.client.channels.fetch(game.channel_id);
        const message = await channel.messages.fetch(game.message_id);
        await message.delete();
      } catch (err) {
        console.error(`[cancel-custom-game] Failed to delete post for game ${gameId}:`, err.message);
      }
    }

    await interaction.editReply(`✅ Custom game \`${gameId}\` cancelled and post deleted.`);
  },
};
