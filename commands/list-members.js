const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list-members')
    .setDescription('Show all linked Discord ↔ Bookeo cast members')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const members = db.getAllMemberLinks();

    if (!members.length) {
      return interaction.reply({
        content: 'No members linked yet. Use `/link-member` to add them.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const lines = ['**Linked Members**\n'];
    for (const m of members) {
      lines.push(`<@${m.discord_id}> ↔ **${m.bookeo_name}**`);
    }

    await interaction.reply({
      content: lines.join('\n'),
      flags: MessageFlags.Ephemeral,
    });
  },
};
