'use strict';

/**
 * Job-failure notifier.
 *
 * Scheduled cron jobs run through `runJob`, which catches thrown errors and
 * routes a single notice (built by `buildJobOutcomeNotice`) to the ops contact
 * via DM and to the error channel (`notifyJobOutcome`). Partial-failure
 * reporting (a job that completes but drops items) is layered on in a later slice.
 */

// Default DM recipient until an ops-contact is configured (slice #135).
// Defaults to the bot owner (single source of truth in lib/owner.js).
const { OWNER_DISCORD_ID: DEFAULT_OPS_CONTACT_ID } = require('./owner');

/**
 * Build the notification text for a job outcome.
 * Pure — no I/O.
 *
 * Hard failure shape: { label, error }.
 *
 * @param {{ label: string, error?: Error|string }} outcome
 * @returns {string}
 */
function buildJobOutcomeNotice(outcome) {
  const { label } = outcome;

  // Hard failure: the job threw.
  if (outcome.error !== undefined) {
    const err = outcome.error;
    const reason = err && err.message ? err.message : String(err);
    return [
      `⚠️ Scheduled job failed: **${label}**`,
      `Error: ${reason}`,
    ].join('\n');
  }

  // Partial failure: the job completed but silently dropped some items.
  const { planned = 0, sent = 0, failed = [] } = outcome;
  const lines = [
    `⚠️ Scheduled job partially failed: **${label}** — sent ${sent}/${planned}, ${failed.length} dropped`,
  ];
  for (const f of failed) {
    lines.push(`• ${f.type ?? 'item'} \`${f.id}\`: ${f.reason}`);
  }
  lines.push('Run `/rerun-job` to retry the dropped items.');
  return lines.join('\n');
}

/**
 * Run a scheduled job, catching a thrown error and routing it to `notify`.
 *
 * Never rethrows — a single job's failure must not abort sibling jobs that share
 * the same cron callback. Returns the job's result on success (so later slices can
 * inspect a returned summary for partial failures). `notify` failures are swallowed
 * (logged) so a broken notifier can't take the job down with it.
 *
 * @param {string} label   Human-readable job name (from the registry)
 * @param {() => Promise<any>} fn        The job to run
 * @param {(outcome: { label: string, error: Error }) => Promise<void>} notify
 * @returns {Promise<any>}  The job's resolved value, or undefined if it threw
 */
async function runJob(label, fn, notify) {
  let result;
  try {
    result = await fn();
  } catch (err) {
    console.error(`[scheduler] Job "${label}" failed:`, err.message);
    try {
      await notify({ label, error: err });
    } catch (notifyErr) {
      console.error(`[scheduler] Failed to send failure notice for "${label}":`, notifyErr.message);
    }
    return;
  }

  // Partial failure: the job completed but reported dropped items.
  if (result && Array.isArray(result.failed) && result.failed.length > 0) {
    console.warn(`[scheduler] Job "${label}" partially failed: sent ${result.sent}/${result.planned}, ${result.failed.length} dropped`);
    try {
      await notify({ label, planned: result.planned, sent: result.sent, failed: result.failed });
    } catch (notifyErr) {
      console.error(`[scheduler] Failed to send partial-failure notice for "${label}":`, notifyErr.message);
    }
  }

  return result;
}

/**
 * Deliver a job-outcome notice to the ops contact (DM) and the error channel.
 * Each destination is guarded independently: a closed DM or a missing/broken
 * error channel must not stop the other from being notified.
 *
 * @param {object} discord  Discord adapter (sendDM, fetchChannel, sendMessage)
 * @param {{ label: string, error?: Error|string }} outcome
 * @param {{ opsContactId?: string|null, errorChannelId?: string|null }} [opts]
 * @returns {Promise<string>}  The notice text that was dispatched
 */
async function notifyJobOutcome(
  discord,
  outcome,
  { opsContactId = DEFAULT_OPS_CONTACT_ID, errorChannelId = null } = {},
) {
  const notice = buildJobOutcomeNotice(outcome);

  if (opsContactId) {
    try {
      await discord.sendDM(opsContactId, notice);
    } catch (err) {
      console.warn(`[scheduler] Could not DM ops contact about "${outcome.label}":`, err.message);
    }
  }

  if (errorChannelId) {
    try {
      const ch = await discord.fetchChannel(errorChannelId);
      await discord.sendMessage(ch, notice);
    } catch (err) {
      console.warn(`[scheduler] Could not post failure notice for "${outcome.label}" to error channel:`, err.message);
    }
  }

  return notice;
}

module.exports = {
  DEFAULT_OPS_CONTACT_ID,
  buildJobOutcomeNotice,
  runJob,
  notifyJobOutcome,
};
