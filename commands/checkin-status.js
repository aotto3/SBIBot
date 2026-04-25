const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db    = require('../lib/db');
const utils = require('../lib/utils');
const { showLabel } = require('../lib/shows');
const { CENTRAL_TZ } = require('../lib/utils');

function fmtTime(unixSeconds) {
  if (!unixSeconds) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL_TZ, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(unixSeconds * 1000)) + ' CT';
}

function fmtDate(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  });
}

function statusLine(rec) {
  const callStr = fmtTime(rec.call_time);
  const nowSec  = Math.floor(Date.now() / 1000);

  if (rec.checked_in_at) {
    const checkinStr = fmtTime(rec.checked_in_at);
    const late       = rec.checked_in_at > rec.call_time;
    const tag        = rec.forced_by ? ' (forced)' : late ? ' (late)' : '';
    return `  ✅ **${rec.bookeo_name}** — call ${callStr} — checked in ${checkinStr}${tag}`;
  }

  if (rec.alert_message_id) {
    return `  ⚠️ **${rec.bookeo_name}** — call ${callStr} — alert fired, not checked in`;
  }

  if (rec.call_time < nowSec) {
    return `  🔴 **${rec.bookeo_name}** — call ${callStr} — MISSED (no alert fired — possible bug)`;
  }

  return `  ⏳ **${rec.bookeo_name}** — call ${callStr} — pending`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('checkin-status')
    .setDescription('Show check-in status for the last 3 days')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const todayStr = utils.todayCentral();
    const [y, mo, d] = todayStr.split('-').map(Number);
    const fromDate = utils.toDateString(new Date(y, mo - 1, d - 2));

    const records = db.getCheckinRecordsByDateRange(fromDate, todayStr);

    if (!records.length) {
      await interaction.editReply({ content: 'No check-in records found for the last 3 days.' });
      return;
    }

    // Group by date → show
    const byDate = new Map();
    for (const rec of records) {
      if (!byDate.has(rec.shift_date)) byDate.set(rec.shift_date, new Map());
      const byShow = byDate.get(rec.shift_date);
      if (!byShow.has(rec.show)) byShow.set(rec.show, []);
      byShow.get(rec.show).push(rec);
    }

    const lines = [];
    for (const [date, byShow] of byDate) {
      const isToday = date === todayStr;
      lines.push(`**${fmtDate(date)}${isToday ? ' (today)' : ''}**`);
      for (const [show, recs] of byShow) {
        lines.push(`${showLabel(show)}`);
        for (const rec of recs) lines.push(statusLine(rec));
      }
      lines.push('');
    }

    // Discord has a 2000-char limit; split into chunks if needed
    const chunks = [];
    let current  = '';
    for (const line of lines) {
      if (current.length + line.length + 1 > 1900) {
        chunks.push(current.trimEnd());
        current = '';
      }
      current += line + '\n';
    }
    if (current.trim()) chunks.push(current.trimEnd());

    await interaction.editReply({ content: chunks[0] });
    for (const chunk of chunks.slice(1)) {
      await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral });
    }
  },
};
