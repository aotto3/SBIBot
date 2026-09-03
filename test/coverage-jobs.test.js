'use strict';

/**
 * Unit tests for deep helpers in lib/coverage-jobs.js.
 *
 * Run with: node --test test/coverage-jobs.test.js
 */

const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const { fetchGuildMembersWithRetry } = require('../lib/coverage-jobs');

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
