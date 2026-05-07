'use strict';

/**
 * Tests for lib/shows.js — accessor safety and structural validation.
 * Run with: node --test test/shows.test.js
 */

const test   = require('node:test');
const assert = require('node:assert/strict');

const {
  showLabel,
  showEmojis,
  showRoleGroups,
  checkinConfig,
  getDiscordRoleName,
  allEmojisForShow,
  validateShows,
} = require('../lib/shows');

// ─── _requireShow (exercised via public accessors) ────────────────────────────

test('showLabel — known show returns correct label', () => {
  assert.equal(showLabel('GGB'), 'Great Gold Bird');
  assert.equal(showLabel('MFB'), 'The Man From Beyond');
});

test('showLabel — unknown key throws with the bad key in the message', () => {
  assert.throws(
    () => showLabel('BOGUS'),
    (err) => {
      assert.ok(err.message.includes('BOGUS'), 'error should name the bad key');
      return true;
    }
  );
});

test('showLabel — unknown key throw lists valid keys', () => {
  assert.throws(
    () => showLabel('BOGUS'),
    (err) => {
      for (const key of ['MFB', 'GGB', 'Endings', 'Lucidity']) {
        assert.ok(err.message.includes(key), `error should list valid key "${key}"`);
      }
      return true;
    }
  );
});

test('showEmojis — unknown key throws', () => {
  assert.throws(() => showEmojis('NOPE'), /Unknown show key/);
});

test('showRoleGroups — unknown key throws', () => {
  assert.throws(() => showRoleGroups('NOPE'), /Unknown show key/);
});

test('getDiscordRoleName — unknown key throws', () => {
  assert.throws(() => getDiscordRoleName('NOPE', 'SomeRole'), /Unknown show key/);
});

test('allEmojisForShow — unknown key throws', () => {
  assert.throws(() => allEmojisForShow('NOPE'), /Unknown show key/);
});

// ─── checkinConfig null contract ──────────────────────────────────────────────

test('checkinConfig — MFB returns null (no checkin block)', () => {
  assert.equal(checkinConfig('MFB'), null);
});

test('checkinConfig — GGB returns non-null config', () => {
  const cfg = checkinConfig('GGB');
  assert.ok(cfg !== null);
  assert.ok(Array.isArray(cfg.roles));
  assert.equal(typeof cfg.callTimeOffset, 'number');
});

test('checkinConfig — unknown key throws', () => {
  assert.throws(() => checkinConfig('INVALID'), /Unknown show key/);
});

// ─── validateShows ────────────────────────────────────────────────────────────

const baseValid = {
  TESTSHOW: {
    label: 'Test Show',
    autoRole: null,
    discordRoles: null,
    emojis: {
      yes:   [{ name: '✅', unicode: true, label: 'Available' }],
      maybe: [{ name: '❓', unicode: true, label: 'Maybe' }],
      no:    [{ name: '❌', unicode: true, label: 'Unavailable' }],
    },
  },
};

test('validateShows — does not throw for current valid SHOWS', () => {
  assert.doesNotThrow(() => validateShows());
});

test('validateShows — does not throw for a well-formed custom config', () => {
  assert.doesNotThrow(() => validateShows(baseValid));
});

test('validateShows — throws when label is missing', () => {
  const bad = { TESTSHOW: { ...baseValid.TESTSHOW, label: undefined } };
  assert.throws(() => validateShows(bad), /missing required field "label"/);
});

test('validateShows — throws when emojis is missing', () => {
  const bad = { TESTSHOW: { ...baseValid.TESTSHOW, emojis: undefined } };
  assert.throws(() => validateShows(bad), /missing required field "emojis"/);
});

test('validateShows — throws when emojis.yes is not an array', () => {
  const bad = {
    TESTSHOW: {
      ...baseValid.TESTSHOW,
      emojis: { yes: null, maybe: [], no: [] },
    },
  };
  assert.throws(() => validateShows(bad), /emojis\.yes must be an array/);
});

test('validateShows — throws when checkin.roles is empty', () => {
  const bad = {
    TESTSHOW: {
      ...baseValid.TESTSHOW,
      checkin: { roles: [], callTimeOffset: -30 },
    },
  };
  assert.throws(() => validateShows(bad), /checkin\.roles must be a non-empty array/);
});

test('validateShows — throws when checkin.callTimeOffset is not a number', () => {
  const bad = {
    TESTSHOW: {
      ...baseValid.TESTSHOW,
      checkin: { roles: ['Riley'], callTimeOffset: '-30' },
    },
  };
  assert.throws(() => validateShows(bad), /checkin\.callTimeOffset must be a number/);
});

test('validateShows — passes for show with valid checkin block', () => {
  const good = {
    TESTSHOW: {
      ...baseValid.TESTSHOW,
      checkin: { roles: ['Riley'], callTimeOffset: -30 },
    },
  };
  assert.doesNotThrow(() => validateShows(good));
});
