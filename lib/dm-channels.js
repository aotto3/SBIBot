const db = require('./db');

const ALLEN_DISCORD_ID = '302924689704222723';

async function _notifyAllen(client, message) {
  try {
    const allen = await client.users.fetch(ALLEN_DISCORD_ID);
    await allen.send(message);
  } catch (err) {
    console.error('[dm-channels] Failed to notify Allen of error:', err.message);
  }
}

/**
 * Open a DM channel with a single user. Completely silent — no message sent.
 * On failure, logs the error and notifies Allen via DM.
 *
 * @param {Client} client
 * @param {string} discordId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function openDMChannel(client, discordId) {
  try {
    const user = await client.users.fetch(discordId);
    await user.createDM();
    return { ok: true };
  } catch (err) {
    console.error(`[dm-channels] Failed to open DM channel for ${discordId}:`, err.message);
    await _notifyAllen(client, `⚠️ Failed to open DM channel for <@${discordId}>: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * Open DM channels for all linked cast members so Discord delivers future
 * MessageCreate events. Called at startup — completely silent to users.
 *
 * @param {Client} client
 * @param {object[]} [links]  Injected for testing; defaults to db.getAllMemberLinks()
 * @returns {Promise<{ opened: number, failed: number }>}
 */
async function openDMChannels(client, links = db.getAllMemberLinks()) {
  let opened = 0, failed = 0;

  for (const { discord_id, bookeo_name } of links) {
    const result = await openDMChannel(client, discord_id);
    if (result.ok) {
      opened++;
      console.log(`[dm-channels] Opened DM channel for ${bookeo_name} (${discord_id})`);
    } else {
      failed++;
    }
  }

  console.log(`[dm-channels] Startup complete — opened: ${opened}, failed: ${failed}`);
  return { opened, failed };
}

module.exports = { openDMChannels, openDMChannel };
