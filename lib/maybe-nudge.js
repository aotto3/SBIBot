'use strict';

/**
 * Weekly "maybe" nudge — pure core.
 *
 * Cast who react ❓ (maybe) on a coverage shift or custom game are never
 * followed up by the existing jobs (those only ping non-responders). This
 * module decides who to nudge and what to say, given already-fetched post +
 * reaction data. No Discord or DB access — the execute layer (the Sunday cron)
 * gathers open posts and their reactors and performs the sends.
 */

const { showEmojis, showLabel } = require('./shows');
const utils = require('./utils');

/**
 * From a post's reactions, return the IDs of users who reacted with one of the
 * show's "maybe" emojis (❓ for most shows; Dmaybe/Hmaybe for MFB).
 *
 * @param {Array<{name:string, userIds:string[]}>} reactions  Reactions on the post
 * @param {string} show  Show key
 * @returns {string[]}  Deduped user IDs who expressed "maybe"
 */
function extractMaybeReactorIds(reactions, show) {
  const maybeNames = new Set(showEmojis(show).maybe.map(e => e.name));
  const ids = new Set();
  for (const r of reactions) {
    if (maybeNames.has(r.name)) {
      for (const uid of r.userIds) ids.add(uid);
    }
  }
  return [...ids];
}

/**
 * Consolidate the weekly maybe-nudge into one entry per person.
 * Skips past-dated posts and users on the coverage-ping exclusion list.
 *
 * @param {Array<{show:string, date:string, time:string|null, link:string, maybeUserIds:string[]}>} posts
 *        Open (uncovered) coverage posts with their current maybe-reactor IDs.
 * @param {Iterable<string>} exclusionIds  Users who opted out of coverage pings.
 * @param {string} todayStr  'YYYY-MM-DD' reference date; posts before it are skipped.
 * @returns {Map<string, Array<{show:string, dateTimeStr:string, link:string}>>}
 *          userId → list of the posts they should be nudged about.
 */
function planMaybeNudges(posts, exclusionIds, todayStr) {
  const excluded = new Set(exclusionIds);
  const byUser = new Map();

  for (const post of posts) {
    if (post.date < todayStr) continue; // past-dated — can't cover the past
    const dateTimeStr = utils.formatShiftDateTime(post.date, post.time);
    for (const uid of post.maybeUserIds) {
      if (excluded.has(uid)) continue;
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid).push({ show: post.show, dateTimeStr, link: post.link });
    }
  }

  return byUser;
}

/**
 * Build the consolidated weekly maybe-nudge DM for one recipient.
 *
 * @param {Array<{show:string, dateTimeStr:string, link:string}>} items  Non-empty.
 * @returns {string}
 */
function buildMaybeNudgeDM(items) {
  if (items.length === 1) {
    const it = items[0];
    return [
      `❓ You're still marked **maybe** for **${showLabel(it.show)}** on ${it.dateTimeStr}, and it still needs coverage. React ✅ or ❌ on the post as soon as you can:`,
      it.link,
    ].join('\n');
  }

  const lines = [
    "❓ You're still marked **maybe** on a few coverage posts that still need to be filled. React ✅ or ❌ on each as soon as you can:",
    '',
  ];
  for (const it of items) {
    lines.push(`• **${showLabel(it.show)}** — ${it.dateTimeStr}: ${it.link}`);
  }
  return lines.join('\n');
}

module.exports = { extractMaybeReactorIds, planMaybeNudges, buildMaybeNudgeDM };
