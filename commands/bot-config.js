const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');

const SETTINGS = {
  weekly_shifts: {
    key:         'weekly_shifts_enabled',
    label:       'Weekly shift DMs (every Monday)',
  },
  daily_shifts: {
    key:         'daily_shifts_enabled',
    label:       'Daily 24hr shift DMs',
  },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bot-config')
    .setDescription('Toggle automated bot behaviours on or off')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('setting')
        .setDescription('Which setting to change')
        .setRequired(true)
        .addChoices(
          { name: 'Weekly shift DMs (every Monday)',  value: 'weekly_shifts' },
          { name: 'Daily 24hr shift DMs',             value: 'daily_shifts'  },
        )
    )
    .addStringOption(opt =>
      opt.setName('value')
        .setDescription('Turn it on or off')
        .setRequired(true)
        .addChoices(
          { name: 'On',  value: 'on'  },
          { name: 'Off', value: 'off' },
        )
    ),

  async execute(interaction) {
    const settingKey = interaction.options.getString('setting');
    const value      = interaction.options.getString('value');
    const setting    = SETTINGS[settingKey];

    db.setConfig(setting.key, value === 'on' ? 'true' : 'false');

    const icon   = value === 'on' ? '✅' : '❌';
    const status = value === 'on' ? 'enabled' : 'disabled';

    await interaction.reply({
      content: `${icon} **${setting.label}** is now **${status}**.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
