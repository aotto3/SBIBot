'use strict';

/**
 * Single source of truth for the bot owner's Discord ID.
 *
 * The owner is the only user allowed to run owner-restricted commands
 * (e.g. /coverage-stats) and is the default recipient for DM forwarding and
 * job-failure notices. Historically this literal was copied into several
 * modules; import it from here instead of hard-coding it again.
 */

const OWNER_DISCORD_ID = '302924689704222723';

/** True when the given Discord user ID is the bot owner. */
function isOwner(userId) {
  return userId === OWNER_DISCORD_ID;
}

module.exports = { OWNER_DISCORD_ID, isOwner };
