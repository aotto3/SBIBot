'use strict';

/**
 * Meeting RSVP resolver — pure logic for the shared per-occurrence RSVP used by
 * the 7-day and 24-hour posts of a monthly recurring meeting.
 *
 * A user expresses one RSVP per occurrence but may react on either post. Given
 * the user's current stored RSVP and an incoming reaction event, this module
 * decides the user's new status and which stale reaction (if any) must be
 * removed from which post so the two posts never show contradictory emojis
 * (most-recent action wins).
 *
 * No I/O — the execute layer persists the result and performs the removals.
 */

const STATUS_EMOJI = { yes: '✅', no: '❌', maybe: '❓' };
const EMOJI_STATUS = { '✅': 'yes', '❌': 'no', '❓': 'maybe' };

/** Map a reaction emoji name to an RSVP status, or null if it isn't an RSVP emoji. */
function statusForEmoji(emojiName) {
  return EMOJI_STATUS[emojiName] ?? null;
}

/**
 * Resolve a reaction event against the user's prior stored RSVP.
 *
 * @param {{status:'yes'|'maybe'|'no', post:'7d'|'24h'}|null} prior
 *        The user's current stored RSVP for this occurrence, or null if none.
 * @param {{post:'7d'|'24h', status:'yes'|'maybe'|'no', action:'add'|'remove'}} event
 * @returns {{
 *   newStatus: 'yes'|'maybe'|'no'|null,
 *   persist: {type:'set', status:string, post:string} | {type:'delete'} | {type:'none'},
 *   cleanup: Array<{post:'7d'|'24h', status:'yes'|'maybe'|'no'}>,
 * }}
 *   `cleanup` entries are reactions the bot should remove (emoji for `status`
 *   from `post`) to keep the two posts consistent.
 */
function resolveReaction(prior, event) {
  if (event.action === 'add') {
    // Identical re-add (same status on the same post) — nothing changes.
    if (prior && prior.status === event.status && prior.post === event.post) {
      return { newStatus: event.status, persist: { type: 'none' }, cleanup: [] };
    }
    // Most-recent action wins; the prior reaction (wherever it sat) is now stale.
    const cleanup = prior ? [{ post: prior.post, status: prior.status }] : [];
    return {
      newStatus: event.status,
      persist: { type: 'set', status: event.status, post: event.post },
      cleanup,
    };
  }

  // action === 'remove': only meaningful if it clears the user's current RSVP.
  const removesCurrent = prior && prior.status === event.status && prior.post === event.post;
  if (removesCurrent) {
    return { newStatus: null, persist: { type: 'delete' }, cleanup: [] };
  }
  // Removing a stale / non-current reaction (e.g. the bot's own cleanup fired an
  // event back at us) — no state change, nothing to persist or clean up.
  return { newStatus: prior ? prior.status : null, persist: { type: 'none' }, cleanup: [] };
}

module.exports = { resolveReaction, statusForEmoji, STATUS_EMOJI, EMOJI_STATUS };
