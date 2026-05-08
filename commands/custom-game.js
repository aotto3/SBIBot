const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db                    = require('../lib/db');
const { buildConfirmButton } = require('../lib/confirm');
const utils                 = require('../lib/utils');
const { SHOW_CHOICES, showLabel, showRoleGroups, showEmojis, allEmojisForShow, emojiDisplay, reactWith } = require('../lib/shows');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('custom-game')
    .setDescription('Post a custom game availability check for a show')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('show')
        .setDescription('Which show?')
        .setRequired(true)
        .addChoices(...SHOW_CHOICES)
    )
    .addStringOption(opt =>
      opt.setName('date')
        .setDescription('Date of the custom game (e.g. April 20, 4/20, 2026-04-20)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('time')
        .setDescription('Time of the custom game (e.g. 7pm, 7:30pm, 19:00) — optional')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const showKey   = interaction.options.getString('show');
    const dateStr   = interaction.options.getString('date');
    const timeStr   = interaction.options.getString('time') ?? null;
    const guild     = interaction.guild;

    const parsedDate = utils.parseDate(dateStr);
    if (!parsedDate) {
      return interaction.editReply(`Couldn't parse date \`${dateStr}\`. Try: \`April 20\`, \`4/20/2026\`, \`2026-04-20\``);
    }

    let parsedTime = null;
    if (timeStr) {
      parsedTime = utils.parseTime(timeStr);
      if (!parsedTime) {
        return interaction.editReply(`Couldn't parse time \`${timeStr}\`. Try: \`7pm\`, \`7:30pm\`, \`19:00\``);
      }
    }

    const emojis = allEmojisForShow(showKey);

    const [y, mo, d]  = parsedDate.split('-').map(Number);
    const dateDisplay = utils.formatMeetingDate(new Date(y, mo - 1, d));
    const dateTimeDisplay = parsedTime
      ? `${dateDisplay} at ${utils.formatTime(parsedTime)}`
      : dateDisplay;

    // ── Resolve channel ───────────────────────────────────────────────────────
    let targetChannel;
    try {
      targetChannel = await utils.resolveCustomGameChannel(guild, showKey);
    } catch (err) {
      return interaction.editReply(`❌ Could not find channel for **${showLabel(showKey)}**: ${err.message}`);
    }

    // ── Create DB record first to get the game ID ─────────────────────────────
    const id = db.createCustomGame({
      channel_id:   targetChannel.id,
      show:         showKey,
      date:         parsedDate,
      time:         parsedTime,
      requester_id: interaction.user.id,
    });

    // ── Build post content ────────────────────────────────────────────────────
    const lines = [
      `**${showLabel(showKey)}**`,
      `Custom Game Request`,
      `@here Is anyone available on ${dateTimeDisplay}?`,
    ];

    // React prompt: skip for MFB (role-grouped emojis speak for themselves)
    if (!showRoleGroups(showKey)) {
      const promptLines = buildPromptLines(showEmojis(showKey), guild);
      lines.push('', ...promptLines);
    }

    lines.push(`_Game ID: ${id}_`);

    const content = lines.join('\n');

    // ── Post and react ────────────────────────────────────────────────────────
    const msg = await targetChannel.send({ content, components: [buildConfirmButton(false, 'game', id)] });

    for (const emoji of emojis) {
      await reactWith(msg, guild, emoji);
    }

    db.setCustomGameMessageId(id, msg.id);

    await interaction.editReply(`✅ Posted availability check for **${showLabel(showKey)}** on ${dateTimeDisplay} in <#${targetChannel.id}>. (Game ID: \`${id}\`)`);
  },
};

/**
 * Build the compact react-prompt line for shows with single emojis per group.
 */
function buildPromptLines(emojis, guild) {
  const groups = [emojis.yes, emojis.maybe, emojis.no];
  const parts  = groups.map(g => `${emojiDisplay(guild, g[0])} ${g[0].label.toLowerCase()}`);
  return [`React: ${parts.join('  ')}`];
}
