const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { openDMChannel, openDMChannels } = require('../lib/dm-channels');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClient({ fetchShouldFail = false, createDMShouldFail = false } = {}) {
  const createDM = mock.fn(async () => {
    if (createDMShouldFail) throw new Error('Cannot send messages to this user');
  });
  const mockUser = { createDM };

  const fetch = mock.fn(async (id) => {
    // Allen's ID always succeeds (needed for failure notifications)
    if (id === '302924689704222723') return { send: mock.fn(async () => {}) };
    if (fetchShouldFail) throw new Error('Unknown User');
    return mockUser;
  });

  return { client: { users: { fetch } }, mockUser, fetch };
}

// ─── openDMChannel ────────────────────────────────────────────────────────────

test('openDMChannel returns ok:true and calls createDM for a valid user', async () => {
  const { client, mockUser, fetch } = makeClient();
  const result = await openDMChannel(client, 'user-1');

  assert.deepEqual(result, { ok: true });
  assert.equal(fetch.mock.calls.filter(c => c.arguments[0] === 'user-1').length, 1);
  assert.equal(mockUser.createDM.mock.calls.length, 1);
});

test('openDMChannel returns ok:false and notifies Allen when fetch fails', async () => {
  const { client, fetch } = makeClient({ fetchShouldFail: true });
  const result = await openDMChannel(client, 'bad-id');

  assert.equal(result.ok, false);
  assert.ok(result.error);
  // Allen was notified
  const allenFetch = fetch.mock.calls.find(c => c.arguments[0] === '302924689704222723');
  assert.ok(allenFetch, 'should have fetched Allen to notify');
});

test('openDMChannel returns ok:false and notifies Allen when createDM fails', async () => {
  const { client, fetch } = makeClient({ createDMShouldFail: true });
  const result = await openDMChannel(client, 'user-1');

  assert.equal(result.ok, false);
  assert.ok(result.error);
  const allenFetch = fetch.mock.calls.find(c => c.arguments[0] === '302924689704222723');
  assert.ok(allenFetch, 'should have fetched Allen to notify');
});

// ─── openDMChannels ───────────────────────────────────────────────────────────

test('openDMChannels returns {opened:0, failed:0} for an empty link list', async () => {
  const { client } = makeClient();
  const result = await openDMChannels(client, []);
  assert.deepEqual(result, { opened: 0, failed: 0 });
});

test('openDMChannels calls createDM for every linked member', async () => {
  const { client, mockUser } = makeClient();
  const links = [
    { discord_id: 'user-1', bookeo_name: 'Alice' },
    { discord_id: 'user-2', bookeo_name: 'Bob' },
    { discord_id: 'user-3', bookeo_name: 'Carol' },
  ];

  const result = await openDMChannels(client, links);

  assert.deepEqual(result, { opened: 3, failed: 0 });
  assert.equal(mockUser.createDM.mock.calls.length, 3);
});

test('openDMChannels counts failures correctly when some members fail', async () => {
  // First fetch call for a real user succeeds; second fails; Allen's fetch always succeeds.
  let userFetchCount = 0;
  const fetch = mock.fn(async (id) => {
    if (id === '302924689704222723') return { send: mock.fn(async () => {}) };
    userFetchCount++;
    if (userFetchCount === 2) throw new Error('Unknown User');
    return { createDM: mock.fn(async () => {}) };
  });
  const client = { users: { fetch } };

  const links = [
    { discord_id: 'user-1', bookeo_name: 'Alice' },
    { discord_id: 'user-2', bookeo_name: 'Bob' },   // will fail
    { discord_id: 'user-3', bookeo_name: 'Carol' },
  ];

  const result = await openDMChannels(client, links);
  assert.deepEqual(result, { opened: 2, failed: 1 });
});
