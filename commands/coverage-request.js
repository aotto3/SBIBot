const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} = require('discord.js');
const db = require('../lib/db');
const { SHOW_CHOICES, showLabel } = require('../lib/shows');
const { parseShiftInput, buildHeaderPost, buildShiftPost } = require('../lib/coverage');
const utils = require('../lib/utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coverage-request')
    .setDescription('Request coverage for one or more of your shifts')
    .addStringOption(opt =>
      opt.setName('show')
        .setDescription('Which show you need coverage for')
        .setRequired(true)
        .addChoices(...SHOW_CHOICES)
    ),

  async execute(interaction) {
    const show = interaction.options.getString('show');

    const modal = new ModalBuilder()
      .setCustomId(`coverage_request_modal:${show}`)
      .setTitle(`${showLabel(show)} — Request Coverage`);

    const shiftsInput = new TextInputBuilder()
      .setCustomId('shifts')
      .setLabel('Shift dates and times (one per line)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('e.g.\n5/1/2026 at 7pm\n5/2/2026 at 5:30pm')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(shiftsInput));

    await interaction.showModal(modal);
  },
};

/**
 * Handle the modal submission for /coverage-request.
 * Called from index.js when interaction.customId starts with 'coverage_request_modal:'.
 */
async function handleCoverageRequestModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const show       = interaction.customId.split(':')[1];
  const shiftsText = interaction.fields.getTextInputValue('shifts');

  // 1. Parse shift input
  const todayCentral  = utils.todayCentral();
  const [y, mo, d]    = todayCentral.split('-').map(Number);
  const referenceDate = new Date(y, mo - 1, d);
  const parsedShifts  = parseShiftInput(shiftsText, referenceDate);

  if (!parsedShifts.length) {
    await interaction.editReply({
      content: `❌ No valid shift dates found. Try a format like \`May 1, 2026 at 7pm\` or \`5/1/2026 @ 7pm\`.`,
    });
    return;
  }

  // Require time for all shifts
  const missingTime = parsedShifts.filter(s => !s.time);
  if (missingTime.length) {
    const dateList = missingTime.map(s => s.date).join(', ');
    await interaction.editReply({
      content: `❌ Please include a time for each shift. Missing time for: **${dateList}**`,
    });
    return;
  }

  // 2. Check coverage channel is configured
  const channelId = db.getConfig(`coverage_channel_${show}`);
  if (!channelId) {
    await interaction.editReply({
      content: `❌ No coverage channel configured for **${showLabel(show)}**. Ask an admin to run \`/set-coverage-channel\`.`,
    });
    return;
  }

  // 3. Duplicate check — any parsed shift already has an open request?
  const duplicates = parsedShifts.filter(s =>
    db.getOpenShiftByShowAndDateTime(show, s.date, s.time)
  );
  if (duplicates.length) {
    const dupList = duplicates
      .map(s => `**${utils.formatMeetingDate(new Date(...s.date.split('-').map(Number).map((v,i) => i === 1 ? v - 1 : v)))} at ${utils.formatTime(s.time)}**`)
      .join('\n');
    await interaction.editReply({
      content: `❌ An open coverage request already exists for:\n${dupList}\n\nPlease check the coverage channel before submitting again.`,
    });
    return;
  }

  // 4. Create DB records
  const requesterName = interaction.member?.displayName ?? interaction.user.displayName ?? interaction.user.username;
  const requestId = db.createCoverageRequest({
    requester_id:   interaction.user.id,
    requester_name: requesterName,
    show,
    channel_id:     channelId,
  });

  const request = db.getCoverageRequest(requestId);

  const shiftIds = parsedShifts.map(s =>
    db.addCoverageShift({ request_id: requestId, date: s.date, time: s.time })
  );
  const shifts = shiftIds.map(id => db.getCoverageShiftById(id));

  // 5. Fetch channel and post messages
  const channel = await interaction.client.channels.fetch(channelId);

  // First message: header paired with first shift
  const headerText    = buildHeaderPost(request, shifts);
  const firstShiftLine = buildShiftPost(request, shifts[0]);
  const firstContent  = `${headerText}\n\n${firstShiftLine}\n_Coverage Request ID: ${shifts[0].id}_`;

  const headerMsg = await channel.send(firstContent);
  db.setCoverageRequestHeaderMessageId(requestId, headerMsg.id);
  db.setCoverageShiftMessageId(shifts[0].id, headerMsg.id);

  // Remaining shifts each get their own post
  for (const shift of shifts.slice(1)) {
    const content = `${buildShiftPost(request, shift)}\n_Coverage Request ID: ${shift.id}_`;
    const msg     = await channel.send(content);
    db.setCoverageShiftMessageId(shift.id, msg.id);
  }

  const shiftWord = shifts.length === 1 ? 'shift' : 'shifts';
  await interaction.editReply({
    content: `✅ Coverage request posted to <#${channelId}> for ${shifts.length} ${shiftWord}.`,
  });

  console.log(`[coverage] ${interaction.user.tag} posted coverage request ${requestId} for ${show} (${shifts.length} shift(s))`);
}

module.exports.handleCoverageRequestModal = handleCoverageRequestModal;
