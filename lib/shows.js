/**
 * Show configuration — emoji schemes and Discord role mappings.
 *
 * emojis: grouped as { yes, maybe, no }, each an array of emoji descriptors:
 *   { name, unicode, label }
 *   - unicode: true  → name is a Unicode character (✅, ❌, ❓)
 *   - unicode: false → name is a custom server emoji name (dno, hmaybe, …)
 *
 * autoRole: if set, every reactor on this show's post is implicitly that role.
 *           Used for single-role shows (GGB → Mikey, Lucidity → Riley).
 *
 * discordRoles: maps display role name → Discord server role name.
 *               Used to look up a reactor's role from their guild membership.
 *               null means no role tracking for this show.
 */
const SHOWS = {
  MFB: {
    label: 'The Man From Beyond',
    autoRole: null,
    discordRoles: { Daphne: 'Daphne', Houdini: 'Houdini' },
    emojis: {
      yes:   [{ name: '✅',      unicode: true,  label: 'Available'           }],
      maybe: [
        { name: 'Dmaybe', unicode: false, label: 'Daphne maybe'        },
        { name: 'Hmaybe', unicode: false, label: 'Houdini maybe'       },
      ],
      no: [
        { name: 'Dno',    unicode: false, label: 'Daphne unavailable'  },
        { name: 'Hno',    unicode: false, label: 'Houdini unavailable' },
      ],
    },
    // Role-grouped tracker display: each section shows ✅ filtered by role + that role's maybe/no emojis
    roleGroups: [
      { name: 'Daphne',  role: 'Daphne',  available: '✅', unavailable: 'Dno',   maybe: 'Dmaybe' },
      { name: 'Houdini', role: 'Houdini', available: '✅', unavailable: 'Hno',   maybe: 'Hmaybe' },
    ],
  },

  Endings: {
    label: 'The Endings',
    autoRole: null,
    discordRoles: { HR: 'HR', Author: 'Author' },
    checkin: { roles: ['HR'], callTimeOffset: -30 },
    emojis: {
      yes:   [{ name: '✅', unicode: true, label: 'Available'   }],
      maybe: [{ name: '❓', unicode: true, label: 'Maybe'       }],
      no:    [{ name: '❌', unicode: true, label: 'Unavailable' }],
    },
  },

  GGB: {
    label: 'Great Gold Bird',
    autoRole: 'Mikey',
    discordRoles: null,
    checkin: { roles: ['Mikey'], callTimeOffset: -30 },
    emojis: {
      yes:   [{ name: '✅', unicode: true, label: 'Available'   }],
      maybe: [{ name: '❓', unicode: true, label: 'Maybe'       }],
      no:    [{ name: '❌', unicode: true, label: 'Unavailable' }],
    },
  },

  Lucidity: {
    label: 'Lucidity',
    autoRole: 'Riley',
    discordRoles: null,
    checkin: { roles: ['Riley'], callTimeOffset: -30 },
    emojis: {
      yes:   [{ name: '✅', unicode: true, label: 'Available'   }],
      maybe: [{ name: '❓', unicode: true, label: 'Maybe'       }],
      no:    [{ name: '❌', unicode: true, label: 'Unavailable' }],
    },
  },
};

/**
 * Flat ordered array of all emoji descriptors for a show
 * (yes first, then maybe, then no — matches the order reactions are added).
 */
function allEmojisForShow(showKey) {
  const { emojis } = SHOWS[showKey];
  return [...emojis.yes, ...emojis.maybe, ...emojis.no];
}

/**
 * Resolve the display string for an emoji descriptor.
 * Unicode emojis are returned as-is; custom emojis are looked up by name
 * in the guild's emoji cache.
 *
 * @param {import('discord.js').Guild} guild
 * @param {{ name: string, unicode: boolean }} emojiDesc
 */
function emojiDisplay(guild, emojiDesc) {
  if (emojiDesc.unicode) return emojiDesc.name;
  const e = guild.emojis.cache.find(e => e.name === emojiDesc.name);
  return e ? e.toString() : `:${emojiDesc.name}:`;
}

/**
 * React to a message with an emoji descriptor.
 * Handles both unicode and custom server emojis.
 *
 * @param {import('discord.js').Message} msg
 * @param {import('discord.js').Guild}   guild
 * @param {{ name: string, unicode: boolean }} emojiDesc
 */
async function reactWith(msg, guild, emojiDesc) {
  if (emojiDesc.unicode) {
    await msg.react(emojiDesc.name);
  } else {
    const e = guild.emojis.cache.find(e => e.name === emojiDesc.name);
    if (e) {
      await msg.react(e);
    } else {
      console.warn(`[shows] Custom emoji '${emojiDesc.name}' not found in guild — skipping`);
    }
  }
}

/**
 * Determine a user's role label for a show by checking their Discord roles.
 * Returns null if the show has no role tracking or the member has no matching role.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 * @param {string} showKey
 */
async function getShowRole(guild, userId, showKey) {
  const config = SHOWS[showKey];

  if (config.autoRole) return config.autoRole;
  if (!config.discordRoles) return null;

  try {
    const member = await guild.members.fetch(userId);
    const matched = [];
    for (const [roleName, discordRoleName] of Object.entries(config.discordRoles)) {
      if (member.roles.cache.some(r => r.name === discordRoleName)) {
        matched.push(roleName);
      }
    }
    return matched.length ? matched.join('/') : null;
  } catch (err) {
    console.warn(`[shows] Could not fetch member ${userId} for role lookup:`, err.message);
    return null;
  }
}

/**
 * All emoji names (unicode chars + custom names) that can trigger RSVP handling
 * across all shows.  Used in rsvp.js as a fast pre-filter.
 */
const ALL_SHOW_EMOJI_NAMES = new Set(
  Object.keys(SHOWS).flatMap(k => allEmojisForShow(k).map(e => e.name))
);

// ─── Show registry helpers ────────────────────────────────────────────────────

/** Human-readable label for a show key. */
function showLabel(showKey) {
  return SHOWS[showKey].label;
}

/** true if the show has check-in support configured. */
function hasCheckin(showKey) {
  return !!(SHOWS[showKey] && SHOWS[showKey].checkin);
}

/** { roles, callTimeOffset } for check-in eligible shows, null otherwise. */
function checkinConfig(showKey) {
  return SHOWS[showKey].checkin ?? null;
}

/** true if the show uses per-role Discord role tracking (multi-role shows). */
function hasRoleTracking(showKey) {
  return !!(SHOWS[showKey] && SHOWS[showKey].discordRoles);
}

/** roleGroups array for shows that use role-grouped tracker display, null otherwise. */
function showRoleGroups(showKey) {
  return SHOWS[showKey].roleGroups ?? null;
}

/**
 * Slash command choices for all shows.
 * Pre-computed — spread directly into .addChoices(...SHOW_CHOICES).
 */
const SHOW_CHOICES = Object.entries(SHOWS).map(([value, config]) => ({
  name:  config.label,
  value,
}));

/**
 * Slash command choices for check-in eligible shows only (excludes MFB).
 * Pre-computed — spread directly into .addChoices(...CHECKIN_SHOW_CHOICES).
 */
const CHECKIN_SHOW_CHOICES = Object.entries(SHOWS)
  .filter(([, config]) => !!config.checkin)
  .map(([value, config]) => ({ name: config.label, value }));

module.exports = {
  // Raw config — retained for rsvp.js which traverses structure directly
  SHOWS,
  // Pre-computed slash command choice arrays
  SHOW_CHOICES,
  CHECKIN_SHOW_CHOICES,
  // Query functions — callers should prefer these over reading SHOWS directly
  showLabel,
  hasCheckin,
  checkinConfig,
  hasRoleTracking,
  showRoleGroups,
  // Emoji helpers
  allEmojisForShow,
  emojiDisplay,
  reactWith,
  getShowRole,
  ALL_SHOW_EMOJI_NAMES,
};
