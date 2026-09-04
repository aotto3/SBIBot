'use strict';

/**
 * Tests for the coverage ping redirect logic in lib/rsvp.js.
 * Run with: node --test test/rsvp.test.js
 *
 * Uses a real in-process SQLite DB (DB_PATH=:memory:).
 * rsvp.js uses raw Discord.js objects directly (not the scheduler adapter),
 * so tests build minimal fake objects that satisfy the call sites.
 */

const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const repo                = require('../lib/coverage-repository');
const db                  = require('../lib/db');
const { handleReactionChange } = require('../lib/rsvp');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanDb() {
  db.db.prepare('DELETE FROM coverage_requests').run();
  db.db.prepare('DELETE FROM coverage_shifts').run();
  db.db.prepare('DELETE FROM custom_games').run();
  db.db.prepare('DELETE FROM coverage_ping_messages').run();
  db.db.prepare('DELETE FROM meeting_rsvps').run();
  db.db.prepare('DELETE FROM meeting_reminders_sent').run();
  db.db.prepare('DELETE FROM meeting_members').run();
  db.db.prepare('DELETE FROM meetings').run();
}

/** A Map with the Discord.js Collection methods the rsvp code uses. */
function coll(entries = []) {
  const m = new Map(entries);
  m.find   = (fn) => { for (const v of m.values()) if (fn(v)) return v; return undefined; };
  m.filter = (fn) => coll([...m.entries()].filter(([, v]) => fn(v)));
  m.map    = (fn) => [...m.values()].map(fn);
  return m;
}

/**
 * Seed a ping record and return a set of spy arrays + the fake Discord objects
 * needed to call handleReactionChange.
 *
 * @param {object} opts
 * @param {string} opts.pingMsgId
 * @param {string} opts.originalMsgId
 * @param {string} opts.show
 * @param {string} opts.emojiName     Emoji the test user reacts with
 * @param {boolean} [opts.alreadyRedirected=false]
 * @param {boolean} [opts.dmFails=false]
 */
function makeSetup(opts) {
  const {
    pingMsgId      = 'ping-msg-1',
    originalMsgId  = 'orig-msg-1',
    show           = 'GGB',
    emojiName      = '✅',
    alreadyRedirected = false,
    dmFails        = false,
  } = opts;

  // Seed ping record
  repo.savePingMessage(pingMsgId, originalMsgId, 'ch-1', show, '2026-06-15', '19:00');
  if (alreadyRedirected) repo.markPingRedirected(pingMsgId);

  const removed = [];
  const edited  = [];
  const dms     = [];

  const fakeMessage = {
    id:      pingMsgId,
    partial: false,
    content: `<@U1> <@U2> Reminder: coverage still needed for Mon Jun 15 at 7:00pm — react ✅ ❓ ❌ to the original request ASAP: https://discord.com/channels/guild-1/ch-1/${originalMsgId}`,
    guild:   { id: 'guild-1' },
    edit:    async (newContent) => { edited.push(newContent); },
  };

  const fakeReaction = {
    partial: false,
    emoji:   { name: emojiName },
    message: fakeMessage,
    users:   {
      remove: async (uid) => { removed.push(uid); },
      fetch:  async () => new Map([['user-1', { id: 'user-1', bot: false }]]),
    },
  };

  const fakeUser = { id: 'user-1', bot: false };

  const fakeClient = {
    users: {
      fetch: async (id) => ({
        id,
        send: async (text) => {
          if (dmFails) throw new Error('Cannot DM this user');
          dms.push({ userId: id, text });
        },
      }),
    },
  };

  return { fakeClient, fakeReaction, fakeUser, removed, edited, dms };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('ping redirect — first mis-react: removes reaction, DMs user, edits message', async () => {
  cleanDb();
  const { fakeClient, fakeReaction, fakeUser, removed, edited, dms } = makeSetup({});

  await handleReactionChange(fakeClient, fakeReaction, fakeUser);

  assert.equal(removed.length, 1,  'reaction should be removed');
  assert.equal(removed[0], 'user-1');

  assert.equal(dms.length, 1, 'DM should be sent');
  assert.ok(dms[0].text.includes('Great Gold Bird'), 'DM should include show label');
  assert.ok(dms[0].text.includes('http'),            'DM should include a link');

  assert.equal(edited.length, 1, 'ping message should be edited once');
  assert.ok(edited[0].includes('to the original request ASAP'), 'edit should contain new call-to-action');
  assert.ok(edited[0].includes('✅ ❓ ❌'),                        'edit should spell out the possible reactions');
  assert.ok(!edited[0].includes("if you're available"),         'edit should not contain old call-to-action');

  // DB flag should be set
  assert.equal(repo.getPingByMessageId('ping-msg-1').redirected, 1, 'redirected flag should be set');
});

test('ping redirect — second mis-react on already-redirected ping: removes + DMs, does NOT re-edit', async () => {
  cleanDb();
  const { fakeClient, fakeReaction, fakeUser, removed, edited, dms } = makeSetup({ alreadyRedirected: true });

  await handleReactionChange(fakeClient, fakeReaction, fakeUser);

  assert.equal(removed.length, 1, 'reaction should still be removed');
  assert.equal(dms.length,    1, 'DM should still be sent');
  assert.equal(edited.length, 0, 'message should NOT be re-edited');
});

test('ping redirect — non-coverage emoji: no action taken', async () => {
  cleanDb();
  const { fakeClient, fakeReaction, fakeUser, removed, edited, dms } = makeSetup({ emojiName: '🎉' });

  // '🎉' is not in ALL_RSVP_EMOJI_NAMES, so handleReactionChange returns early
  await handleReactionChange(fakeClient, fakeReaction, fakeUser);

  assert.equal(removed.length, 0, 'reaction should not be removed for irrelevant emoji');
  assert.equal(dms.length,    0, 'no DM for irrelevant emoji');
  assert.equal(edited.length, 0, 'message should not be edited for irrelevant emoji');
});

test('ping redirect — DM failure is non-blocking: reaction removed and message still edited', async () => {
  cleanDb();
  const { fakeClient, fakeReaction, fakeUser, removed, edited, dms } = makeSetup({ dmFails: true });

  await assert.doesNotReject(() => handleReactionChange(fakeClient, fakeReaction, fakeUser));

  assert.equal(removed.length, 1, 'reaction should still be removed even when DM fails');
  assert.equal(dms.length,    0, 'DM should not appear in spy (it threw)');
  assert.equal(edited.length, 1, 'message should still be edited even when DM fails');
});

// ─── Monthly recurring shared-RSVP reactions ──────────────────────────────────

/**
 * Seed a monthly meeting with recorded 7d + 24h posts and return fake Discord
 * objects: the two post messages, a channel that fetches them, and a reactedFrom
 * spy of stale-reaction removals.
 */
function makeMonthlySetup() {
  const meetingId = db.createMeeting({
    title: 'Board', time: '19:00', duration: 60, date: null,
    recurrence_type: 'monthly_weekday', recurrence_day: 'tuesday', recurrence_week: 'first',
    channel_id: 'C1', target_type: 'here', reminder_7d: 1, reminder_24h: 1,
  });
  db.markReminderSent(meetingId, '2026-05-05', '7d',  'M7');
  db.markReminderSent(meetingId, '2026-05-05', '24h', 'M24');

  const removedFrom = [];
  const messages = new Map();
  const channel = { messages: { fetch: async (id) => { const m = messages.get(id); if (!m) throw new Error(`no msg ${id}`); return m; } } };

  function makeMsg(id) {
    const msg = {
      id, partial: false, content: `header ${id}`,
      guild: { id: 'G1', members: { cache: new Map() } },
      channel, reactions: { cache: coll() },
      edit: async (c) => { msg.content = c; },
    };
    messages.set(id, msg);
    return msg;
  }
  const m7  = makeMsg('M7');
  const m24 = makeMsg('M24');

  /** Give a message a physical reaction whose removal is tracked. */
  function physicalReaction(msg, emojiName, userId) {
    msg.reactions.cache.set(emojiName, {
      emoji: { name: emojiName },
      users: { remove: async (uid) => { removedFrom.push({ messageId: msg.id, emoji: emojiName, userId: uid }); } },
    });
  }

  return { meetingId, m7, m24, removedFrom, physicalReaction };
}

function reactOn(msg, emojiName, user, action = 'add') {
  const reaction = { partial: false, emoji: { name: emojiName }, message: msg,
    users: { remove: async () => {}, fetch: async () => coll([[user.id, user]]) } };
  return handleReactionChange({}, reaction, user, action);
}

test('monthly RSVP — reacting ✅ on the 7d post records shared state and renders both posts', async () => {
  cleanDb();
  const { meetingId, m7, m24 } = makeMonthlySetup();
  const user = { id: 'U1', bot: false, username: 'Alice' };

  await reactOn(m7, '✅', user, 'add');

  const row = db.getMeetingRsvp(meetingId, '2026-05-05', 'U1');
  assert.equal(row.status, 'yes');
  assert.equal(row.post,   '7d');
  assert.ok(m7.content.includes('Attending (1)')  && m7.content.includes('Alice'), '7d tracker rendered');
  assert.ok(m24.content.includes('Attending (1)') && m24.content.includes('Alice'), '24h tracker kept in sync');
});

test('monthly RSVP — changing to ❌ on the 24h post flips status and cleans the stale ✅ off the 7d post', async () => {
  cleanDb();
  const { meetingId, m7, m24, removedFrom, physicalReaction } = makeMonthlySetup();
  const user = { id: 'U1', bot: false, username: 'Alice' };

  physicalReaction(m7, '✅', 'U1');       // the ✅ they placed on the 7d post
  await reactOn(m7,  '✅', user, 'add');   // status yes/7d
  await reactOn(m24, '❌', user, 'add');   // change mind on the 24h post

  const row = db.getMeetingRsvp(meetingId, '2026-05-05', 'U1');
  assert.equal(row.status, 'no');
  assert.equal(row.post,   '24h');
  assert.ok(removedFrom.some(r => r.messageId === 'M7' && r.emoji === '✅' && r.userId === 'U1'),
    'stale ✅ removed from the 7d post');
  assert.ok(m7.content.includes('Not attending (1)') && m7.content.includes('Attending (0)'), 'both posts show No');
  assert.ok(m24.content.includes('Not attending (1)'));
});

test('monthly RSVP — removing the current reaction clears the RSVP', async () => {
  cleanDb();
  const { meetingId, m7 } = makeMonthlySetup();
  const user = { id: 'U1', bot: false, username: 'Alice' };

  await reactOn(m7, '✅', user, 'add');
  await reactOn(m7, '✅', user, 'remove');

  assert.equal(db.getMeetingRsvp(meetingId, '2026-05-05', 'U1'), null, 'RSVP cleared');
  assert.ok(m7.content.includes('Attending (0):** _none yet_'), 'tracker shows none');
});

test('monthly RSVP — a non-monthly meeting post still uses the single-message tracker', async () => {
  cleanDb();
  const meetingId = db.createMeeting({
    title: 'Kickoff', time: '19:00', duration: 60, date: '2026-05-05',
    recurrence_type: null, recurrence_day: null, recurrence_week: null,
    channel_id: 'C1', target_type: 'here', reminder_7d: 1, reminder_24h: 1,
  });
  db.markReminderSent(meetingId, '2026-05-05', 'created', 'MC');

  const channel = {};
  const msg = {
    id: 'MC', partial: false, content: 'header', guild: { id: 'G1', members: { cache: new Map() } },
    channel, reactions: { cache: coll() }, edit: async (c) => { msg.content = c; },
  };
  msg.reactions.cache.set('✅', { emoji: { name: '✅' }, users: { fetch: async () => coll([['U1', { id: 'U1', bot: false, username: 'Alice' }]]) } });

  const user = { id: 'U1', bot: false, username: 'Alice' };
  const reaction = { partial: false, emoji: { name: '✅' }, message: msg, users: { fetch: async () => coll([['U1', user]]) } };
  await handleReactionChange({}, reaction, user, 'add');

  assert.ok(msg.content.includes('Attending'), 'legacy tracker rendered from the message reactions');
  assert.equal(db.getMeetingRsvp(meetingId, '2026-05-05', 'U1'), null, 'no shared-state row for non-monthly posts');
});
