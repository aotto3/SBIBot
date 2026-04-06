const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link-member')
    .setDescription('Link a Discord user to their Bookeo cast name')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(opt =>
      opt.setName('discord')
        .setDescription('Discord user to link')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('bookeo_name')
        .setDescription('First name as it appears in Bookeo (e.g. DeShae)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const user       = interaction.options.getUser('discord');
    const bookeoName = interaction.options.getString('bookeo_name').trim();

    const existing = db.db.prepare('SELECT * FROM member_links WHERE discord_id = ?').get(user.id);
    db.linkMember(user.id, user.username, bookeoName);

    const action = existing ? 'Updated' : 'Linked';
    await interaction.reply({
      content: `${action}: <@${user.id}> ↔ **${bookeoName}**`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
