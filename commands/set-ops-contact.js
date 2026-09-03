const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const cfg = require('../lib/config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-ops-contact')
    .setDescription('Set who receives DMs when a scheduled job fails')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Person to DM about scheduled-job failures')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = interaction.options.getUser('user');
    cfg.setOpsContactId(user.id);

    await interaction.editReply({
      content: `✅ Ops contact set to <@${user.id}> — they'll be DMed if a scheduled job fails.`,
    });
  },
};
