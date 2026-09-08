const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const db = require('../lib/db');
const members = require('../lib/members');
const bookeo = require('../lib/bookeo');
const { SHOW_CHOICES, showLabel, showCharacters } = require('../lib/shows');
const {
  parseShiftInput,
  buildHeaderPost,
  buildShiftPost,
  buildPickableShifts,
  decodeShiftValues,
} = require('../lib/coverage');
const { buildConfirmButton } = require('../lib/confirm');
const utils = require('../lib/utils');

// Max options in a Discord string select menu.
const MAX_PICK_OPTIONS = 25;

// ─── Component builders ───────────────────────────────────────────────────────

/** The manual free-text shift-entry modal (the pre-picker flow, unchanged). */
function buildCoverageModal(show, character) {
  const modal = new ModalBuilder()
    .setCustomId(`coverage_request_modal:${show}:${character ?? ''}`)
    .setTitle(`${showLabel(show)}${character ? ` (${character})` : ''} — Coverage`);

  const shiftsInput = new TextInputBuilder()
    .setCustomId('shifts')
    .setLabel('Shift dates and times (one per line)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('e.g.\n5/1/2026 at 7pm\n5/2/2026 at 5:30pm')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(shiftsInput));
  return modal;
}

/** The shift-picker select menu for a linked requester's own upcoming shifts. */
function buildPickerRow(show, character, pickable) {
  const options = pickable.slice(0, MAX_PICK_OPTIONS);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`coverage_pick:${show}:${character ?? ''}`)
    .setPlaceholder('Choose the shift(s) you need covered')
    .setMinValues(1)
    .setMaxValues(options.length) // allow picking any number of the listed shifts
    .addOptions(options.map(s => ({
      label: s.label,
      description: s.description,
      value: s.value,
    })));
  return new ActionRowBuilder().addComponents(menu);
}

/** A button that drops into the manual free-text modal. */
function buildManualButtonRow(show, character) {
  const btn = new ButtonBuilder()
    .setCustomId(`coverage_manual:${show}:${character ?? ''}`)
    .setLabel('Enter shift manually')
    .setStyle(ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(btn);
}

// ─── Command ──────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coverage-request')
    .setDescription('Request coverage for one or more of your shifts')
    .addStringOption(opt =>
      opt.setName('show')
        .setDescription('Which show you need coverage for')
        .setRequired(true)
        .addChoices(...SHOW_CHOICES)
    )
    .addStringOption(opt =>
      opt.setName('character')
        .setDescription('Your character (required for MFB and The Endings)')
        .setRequired(false)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const show    = interaction.options.getString('show');
    const chars   = show ? showCharacters(show) : null;
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = chars
      ? chars.filter(c => c.toLowerCase().startsWith(focused)).map(c => ({ name: c, value: c }))
      : [];
    await interaction.respond(choices);
  },

  async execute(interaction) {
    const show      = interaction.options.getString('show');
    const character = interaction.options.getString('character');
    const chars     = showCharacters(show);

    if (chars) {
      if (!character) {
        return interaction.reply({
          content: `❌ **${showLabel(show)}** has multiple characters (${chars.join(', ')}). Please specify your character.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (!chars.includes(character)) {
        return interaction.reply({
          content: `❌ Invalid character **${character}** for **${showLabel(show)}**. Valid options: ${chars.join(', ')}.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    // Unlinked requesters can't have their shifts looked up — go straight to the
    // manual modal (unchanged behavior). The link lookup is synchronous, so this
    // stays within Discord's 3s initial-response window (no defer before showModal).
    const link = db.getMemberByDiscordId(interaction.user.id);
    if (!link) {
      return interaction.showModal(buildCoverageModal(show, character));
    }

    // Linked: fetch their upcoming shifts and offer a picker. Deferring buys time
    // for the (cached) Bookeo call; once deferred we can no longer showModal, so
    // the manual escape hatch is offered as a button instead.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const startDate = utils.todayCentral();
    const [y, mo, d] = startDate.split('-').map(Number);
    const endDate = utils.toDateString(new Date(y, mo - 1, d + 7));

    let scheduleRows;
    try {
      scheduleRows = await bookeo.getSchedule(startDate, endDate);
    } catch (err) {
      await interaction.editReply({
        content: `⚠️ Couldn't reach Bookeo to load your shifts (${err.message}). You can still enter the shift manually.`,
        components: [buildManualButtonRow(show, character)],
      });
      return;
    }

    const pickable = buildPickableShifts(scheduleRows, link.bookeo_name, { now: new Date(), show });

    if (!pickable.length) {
      await interaction.editReply({
        content: `No upcoming **${showLabel(show)}** shifts found for **${link.bookeo_name}** in the next 7 days. If your shift isn't on Bookeo yet, enter it manually.`,
        components: [buildManualButtonRow(show, character)],
      });
      return;
    }

    await interaction.editReply({
      content: `📋 Pick the **${showLabel(show)}**${character ? ` (${character})` : ''} shift you need covered:`,
      components: [buildPickerRow(show, character, pickable)],
    });
  },
};

// ─── Shared creation core ─────────────────────────────────────────────────────

/**
 * Create + post a coverage request from a resolved set of shifts. The interaction
 * MUST already be acknowledged (deferReply or deferUpdate) — this uses editReply.
 * Shared by the manual-modal path and the shift-picker path so both behave identically.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {{ show: string, character: string|null, shifts: Array<{ date: string, time: string }> }} opts
 */
async function createCoverageRequest(interaction, { show, character, shifts: parsedShifts }) {
  // Duplicate check — any shift already has an open request?
  const dupMatches = parsedShifts
    .map(s => ({ shift: s, existing: db.getOpenShiftByShowAndDateTime(show, s.date, s.time) }))
    .filter(({ existing }) => existing);

  if (dupMatches.length) {
    const dupList = dupMatches.map(({ shift, existing }) => {
      const [y, mo, d] = shift.date.split('-').map(Number);
      const dateStr = utils.formatMeetingDate(new Date(y, mo - 1, d));
      const timeStr = utils.formatTime(shift.time);
      let line = `**${dateStr} at ${timeStr}**`;
      if (existing.shift_message_id && existing.channel_id) {
        const link = `https://discord.com/channels/${interaction.guildId}/${existing.channel_id}/${existing.shift_message_id}`;
        line += ` — [view post](${link})`;
      }
      return line;
    }).join('\n');
    await interaction.editReply({
      content: `❌ An open coverage request already exists for:\n${dupList}\n\nPlease check the coverage post before submitting again.`,
      components: [],
    });
    return;
  }

  // Resolve channel (throws + logs to error channel if not found)
  let channel;
  try {
    channel = await utils.resolveCoverageChannel(interaction.guild, show, character);
  } catch (err) {
    const target = character ? `**${showLabel(show)} — ${character}**` : `**${showLabel(show)}**`;
    await interaction.editReply({ content: `❌ Could not find coverage channel for ${target}: ${err.message}`, components: [] });
    return;
  }

  // Create DB records
  const requesterName = members.getDisplayName(interaction.user.id, interaction.member?.displayName ?? interaction.user.displayName ?? interaction.user.username);
  const requestId = db.createCoverageRequest({
    requester_id:   interaction.user.id,
    requester_name: requesterName,
    show,
    character,
    channel_id:     channel.id,
  });

  const request = db.getCoverageRequest(requestId);

  const shiftIds = parsedShifts.map(s =>
    db.addCoverageShift({ request_id: requestId, date: s.date, time: s.time })
  );
  const shifts = shiftIds.map(id => db.getCoverageShiftById(id));

  // Post messages — first message pairs the header with the first shift
  const headerText     = buildHeaderPost(request, shifts);
  const firstShiftLine = buildShiftPost(request, shifts[0]);
  const firstContent   = `${headerText}\n\n${firstShiftLine}\n_Coverage Request ID: ${shifts[0].id}_`;

  const headerMsg = await channel.send({ content: firstContent, components: [buildConfirmButton(false, 'shift', shifts[0].id)] });
  db.setCoverageRequestHeaderMessageId(requestId, headerMsg.id);
  db.setCoverageShiftMessageId(shifts[0].id, headerMsg.id);

  // Remaining shifts each get their own post
  for (const shift of shifts.slice(1)) {
    const content = `${buildShiftPost(request, shift)}\n_Coverage Request ID: ${shift.id}_`;
    const msg     = await channel.send({ content, components: [buildConfirmButton(false, 'shift', shift.id)] });
    db.setCoverageShiftMessageId(shift.id, msg.id);
  }

  const shiftWord = shifts.length === 1 ? 'shift' : 'shifts';
  await interaction.editReply({
    content: `✅ Coverage request posted to <#${channel.id}> for ${shifts.length} ${shiftWord}.`,
    components: [],
  });

  console.log(`[coverage] ${interaction.user.tag} posted coverage request ${requestId} for ${show} (${shifts.length} shift(s))`);
}

// ─── Interaction handlers ─────────────────────────────────────────────────────

/**
 * Handle the modal submission for /coverage-request (manual free-text path).
 * Called from index.js when interaction.customId starts with 'coverage_request_modal:'.
 */
async function handleCoverageRequestModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const parts     = interaction.customId.split(':');
  const show      = parts[1];
  const character = parts[2] || null;
  const shiftsText = interaction.fields.getTextInputValue('shifts');

  // Parse shift input
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

  await createCoverageRequest(interaction, { show, character, shifts: parsedShifts });
}

/**
 * Handle the shift-picker select submission for /coverage-request.
 * Called from index.js when interaction.customId starts with 'coverage_pick:'.
 */
async function handleCoveragePickSelect(interaction) {
  await interaction.deferUpdate();

  const parts     = interaction.customId.split(':');
  const show      = parts[1];
  const character = parts[2] || null;

  // Fan the picked values into the shared creation path — N selected shifts
  // become N shift inputs, identical to selecting them one at a time.
  const shifts = decodeShiftValues(interaction.values);

  if (!shifts.length) {
    await interaction.editReply({
      content: '❌ That shift selection was invalid or expired. Please run `/coverage-request` again.',
      components: [],
    });
    return;
  }

  await createCoverageRequest(interaction, { show, character, shifts });
}

/**
 * Handle the "Enter shift manually" button for /coverage-request.
 * Called from index.js when interaction.customId starts with 'coverage_manual:'.
 */
async function handleCoverageManualButton(interaction) {
  const parts     = interaction.customId.split(':');
  const show      = parts[1];
  const character = parts[2] || null;
  await interaction.showModal(buildCoverageModal(show, character));
}

module.exports.handleCoverageRequestModal = handleCoverageRequestModal;
module.exports.handleCoveragePickSelect   = handleCoveragePickSelect;
module.exports.handleCoverageManualButton = handleCoverageManualButton;
