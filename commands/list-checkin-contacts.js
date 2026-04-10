const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list-checkin-contacts')
    .setDescription('List all users currently on the check-in notification list')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const contacts = db.getCheckinContacts();

    if (!contacts.length) {
      await interaction.editReply({ content: 'No check-in contacts configured.' });
      return;
    }

    const mentions = contacts.map(id => `<@${id}>`).join('\n');

    await interaction.editReply({
      content: `**Check-in notification contacts:**\n${mentions}`,
    });
  },
};
