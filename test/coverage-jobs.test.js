'use strict';

/**
 * Unit tests for deep helpers in lib/coverage-jobs.js.
 *
 * Run with: node --test test/coverage-jobs.test.js
 */

const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const { fetchGuildMembersWithRetry, planCoveragePingTargets } = require('../lib/coverage-jobs');

// ─── fetchGuildMembersWithRetry ───────────────────────────────────────────────

test('fetchGuildMembersWithRetry — retries a transient failure then succeeds', async () => {
  let calls = 0;
  const discord = {
    fetchGuildMembers: async () => {
      calls++;
      if (calls < 2) throw new Error('Request with opcode 8 was rate limited');
    },
  };

  await fetchGuildMembersWithRetry(discord, { id: 'g1' }, { retries: 2, sleep: async () => {} });

  assert.equal(calls, 2, 'should retry once, then succeed on the second attempt');
});

test('fetchGuildMembersWithRetry — succeeds on first attempt without extra calls', async () => {
  let calls = 0;
  const discord = { fetchGuildMembers: async () => { calls++; } };

  await fetchGuildMembersWithRetry(discord, { id: 'g1' }, { retries: 2, sleep: async () => {} });

  assert.equal(calls, 1, 'a first-attempt success must not trigger any retries');
});

test('fetchGuildMembersWithRetry — throws after exhausting retries', async () => {
  let calls = 0;
  const discord = {
    fetchGuildMembers: async () => { calls++; throw new Error('Members didn\'t arrive in time'); },
  };

  await assert.rejects(
    () => fetchGuildMembersWithRetry(discord, { id: 'g1' }, { retries: 2, sleep: async () => {} }),
    /arrive in time/,
  );
  assert.equal(calls, 3, 'should attempt the initial call plus 2 retries, then give up');
});

// ─── planCoveragePingTargets (#137) ───────────────────────────────────────────

test('planCoveragePingTargets — "all" mode returns every planned item', () => {
  const plan = [{ messageId: 'm1' }, { messageId: 'm2' }, { messageId: 'm3' }];
  assert.deepEqual(planCoveragePingTargets(plan, ['m1'], 'all'), plan);
});

test('planCoveragePingTargets — "smart" mode skips posts already pinged today', () => {
  const plan = [{ messageId: 'm1' }, { messageId: 'm2' }, { messageId: 'm3' }];
  const targets = planCoveragePingTargets(plan, ['m1', 'm3'], 'smart');
  assert.deepEqual(targets.map(t => t.messageId), ['m2'], 'only the un-pinged post remains');
});

test('planCoveragePingTargets — "smart" with nothing pinged returns the full plan', () => {
  const plan = [{ messageId: 'm1' }, { messageId: 'm2' }];
  assert.deepEqual(planCoveragePingTargets(plan, [], 'smart'), plan);
});
