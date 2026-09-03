'use strict';

/**
 * Guards the /help + /help-admin listings against drift: every command file must
 * appear in exactly one listing, and neither may reference a nonexistent command.
 *
 * Run with: node --test test/help.test.js
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

process.env.DB_PATH = ':memory:';

const { buildHelpEmbed } = require('../lib/command-catalog');

function embedCommandNames(embed) {
  const set = new Set();
  for (const field of embed.toJSON().fields) {
    for (const line of field.value.split('\n')) {
      const m = line.match(/`\/([a-z-]+)`/);
      if (m) set.add(m[1]);
    }
  }
  return set;
}

function actualCommandNames() {
  const dir = path.join(__dirname, '..', 'commands');
  const names = new Set();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js')) continue;
    const mod = require(path.join(dir, f));
    if (mod.data) names.add(mod.data.toJSON().name);
  }
  return names;
}

test('help catalog — every command appears in exactly one of /help or /help-admin', () => {
  const pub    = embedCommandNames(buildHelpEmbed({ admin: false }));
  const adm    = embedCommandNames(buildHelpEmbed({ admin: true }));
  const actual = actualCommandNames();

  assert.deepEqual([...pub].filter(c => adm.has(c)), [], 'no command should be in both listings');

  const covered = new Set([...pub, ...adm]);
  assert.deepEqual([...actual].filter(c => !covered.has(c)), [], 'every command file must appear in /help or /help-admin');
  assert.deepEqual([...covered].filter(c => !actual.has(c)), [], 'no listing should reference a nonexistent command');
});

test('help catalog — listings stay within Discord embed limits', () => {
  for (const admin of [false, true]) {
    const j = buildHelpEmbed({ admin }).toJSON();
    assert.ok(j.fields.length <= 25, 'field count within limit');
    for (const f of j.fields) assert.ok(f.value.length <= 1024, `field "${f.name}" within 1024 chars`);
    assert.ok(JSON.stringify(j).length <= 6000, 'embed within 6000 chars');
  }
});
