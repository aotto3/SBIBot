const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');

const SHOW_LABELS = {
  GGB:      'Great Gold Bird',
  Lucidity: 'Lucidity',
  Endings:  'The Endings',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-checkin-channel')
    .setDescription('Set the alert channel for check-in no-shows for a specific show')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('show')
        .setDescription('Which show to configure')
        .setRequired(true)
        .addChoices(
          { name: 'Great Gold Bird', value: 'GGB'      },
          { name: 'Lucidity',        value: 'Lucidity' },
          { name: 'The Endings',     value: 'Endings'  },
        )
    )
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel to send check-in no-show alerts to')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const show    = interaction.options.getString('show');
    const channel = interaction.options.getChannel('channel');

    db.setConfig(`checkin_alert_channel_${show}`, channel.id);

    await interaction.editReply({
      content: `✅ Check-in alert channel for **${SHOW_LABELS[show]}** set to <#${channel.id}>.`,
    });
  },
};
