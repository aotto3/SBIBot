const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlink-member')
    .setDescription('Remove a Discord ↔ Bookeo cast member link')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(opt =>
      opt.setName('discord')
        .setDescription('Discord user to unlink')
        .setRequired(true)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser('discord');

    const existing = db.db.prepare('SELECT * FROM member_links WHERE discord_id = ?').get(user.id);
    if (!existing) {
      return interaction.reply({
        content: `<@${user.id}> isn't linked to anyone.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    db.db.prepare('DELETE FROM member_links WHERE discord_id = ?').run(user.id);

    await interaction.reply({
      content: `Unlinked <@${user.id}> (was **${existing.bookeo_name}**).`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
