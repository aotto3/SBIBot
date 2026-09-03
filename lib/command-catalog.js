'use strict';

const { EmbedBuilder } = require('discord.js');

/**
 * Single source of truth for the /help and /help-admin listings.
 * Each entry: [command, description, isPublic?]. Public = any member; otherwise
 * the command requires Manage Server. Keep in sync with the commands/ folder —
 * test/help.test.js asserts every command file appears in exactly one listing.
 */
const CATEGORIES = [
  ['🗓️ Meetings', [
    ['schedule-meeting',    'Schedule a one-time meeting with RSVP reminders'],
    ['schedule-recurring',  'Schedule a recurring (weekly/monthly) meeting'],
    ['edit-meeting',        'Edit an existing scheduled meeting'],
    ['cancel-meeting',      'Cancel (deactivate) a scheduled meeting'],
    ['meetings',            'List all active scheduled meetings'],
    ['meeting-add-member',  'Add a member to a members-targeted meeting'],
    ['attendance',          'Show RSVP counts for a meeting'],
  ]],
  ['🎭 Coverage requests', [
    ['coverage-request',          'Request coverage for one or more of your shifts', true],
    ['cancel-coverage-request',   'Cancel a single shift from a coverage request',   true],
    ['open-coverage',             'List open coverage requests & games (cancel/confirm)'],
    ['list-outstanding-requests', 'List outstanding coverage shifts & custom games'],
    ['purge',                     'Hard-delete a coverage shift, request, or custom game'],
  ]],
  ['👥 Custom games', [
    ['custom-game',        'Post a custom game availability check for a show'],
    ['cancel-custom-game', 'Cancel a custom game post and delete it'],
  ]],
  ['📅 Schedules & shift DMs', [
    ['schedule',             'Show the full show schedule for the coming week'],
    ['member-schedule',      "Show one cast member's upcoming shifts", true],
    ['send-shift-reminders', 'Send shift DMs — or preview without sending'],
  ]],
  ['✅ Check-in', [
    ['check-in',              'Check in for your shift today', true],
    ['checkin-status',        'Show check-in status for the last 3 days'],
    ['force-checkin',         'Manually confirm a cast member as checked in'],
    ['add-checkin-contact',   'Add a user to the no-show notification list'],
    ['remove-checkin-contact','Remove a user from the notification list'],
    ['list-checkin-contacts', 'List check-in notification contacts'],
    ['dev-checkin-test',      '[dev] Seed a test check-in record + DM button'],
  ]],
  ['🔗 Cast member links', [
    ['link-member',   'Link a Discord user to their Bookeo cast name'],
    ['unlink-member', 'Remove a Discord ↔ Bookeo cast member link'],
    ['list-members',  'Show all linked Discord ↔ Bookeo cast members'],
  ]],
  ['⚙️ Coverage config', [
    ['set-coverage-manager',      'Set who receives fillable + EOD coverage notifications'],
    ['add-coverage-exclusion',    'Exclude a user from targeted coverage pings'],
    ['remove-coverage-exclusion', 'Re-enable targeted coverage pings for a user'],
    ['list-coverage-exclusions',  'List users excluded from coverage pings'],
    ['set-channel-override',      'Override the auto-resolved channel for a show'],
    ['clear-channel-override',    'Remove a channel override'],
    ['list-coverage-channels',    'Show channel routing (coverage / check-in / games)'],
  ]],
  ['🛠️ Bot settings & ops', [
    ['bot-config',        'Toggle automated shift DMs on/off'],
    ['set-error-channel', 'Set the channel for bot operational error messages'],
    ['set-ops-contact',   "Set who's DMed when a scheduled job fails"],
    ['rerun-job',         'Re-run a scheduled job on demand (all / smart / preview)'],
  ]],
  ['ℹ️ Help', [
    ['help',       'Show the commands available to everyone', true],
    ['help-admin', 'Show all admin / management commands'],
  ]],
];

/**
 * Build the help embed for one audience.
 * @param {{ admin: boolean }} opts  admin=true → only Manage-Server commands.
 */
function buildHelpEmbed({ admin }) {
  const embed = new EmbedBuilder()
    .setTitle(admin ? '🔧 SBIBot Admin Commands' : '📋 SBIBot Commands')
    .setColor(admin ? 0xED4245 : 0x5865F2)
    .setFooter({
      text: admin
        ? 'Admin commands — all require Manage Server'
        : 'Available to all members · admins: use /help-admin for management commands',
    });

  for (const [category, cmds] of CATEGORIES) {
    const filtered = cmds.filter(([, , isPublic]) => (admin ? !isPublic : !!isPublic));
    if (!filtered.length) continue;
    const value = filtered.map(([name, desc]) => `\`/${name}\` — ${desc}`).join('\n');
    embed.addFields({ name: category, value });
  }

  return embed;
}

module.exports = { CATEGORIES, buildHelpEmbed };
