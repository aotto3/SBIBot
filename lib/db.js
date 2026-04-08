const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'db.sqlite');

// Ensure the directory exists (volume may not be mounted during pre-deploy)
const DB_DIR = path.dirname(DB_PATH);
if (DB_DIR && DB_DIR !== '.' && !fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ─── Schema ───────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS member_links (
    discord_id    TEXT PRIMARY KEY,
    discord_name  TEXT,
    bookeo_name   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meetings (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    title             TEXT NOT NULL,
    time              TEXT NOT NULL,
    duration          INTEGER NOT NULL DEFAULT 60,  -- minutes

    -- One-time: set date. Recurring: set recurrence_* fields.
    date              TEXT,
    recurrence_type   TEXT,   -- 'weekly' | 'monthly_weekday'
    recurrence_day    TEXT,   -- 'monday' | 'tuesday' | etc.
    recurrence_week   TEXT,   -- 'first' | 'second' | 'third' | 'fourth' | 'last'

    channel_id        TEXT NOT NULL,
    target_type       TEXT NOT NULL DEFAULT 'here',  -- 'everyone' | 'here' | 'members'

    reminder_7d       INTEGER NOT NULL DEFAULT 1,
    reminder_24h      INTEGER NOT NULL DEFAULT 1,

    active            INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS meeting_members (
    meeting_id  INTEGER NOT NULL REFERENCES meetings(id),
    discord_id  TEXT NOT NULL,
    PRIMARY KEY (meeting_id, discord_id)
  );

  -- Tracks which reminder instances have been posted (handles recurring meetings)
  CREATE TABLE IF NOT EXISTS meeting_reminders_sent (
    meeting_id     INTEGER NOT NULL REFERENCES meetings(id),
    instance_date  TEXT NOT NULL,   -- YYYY-MM-DD of the specific occurrence
    reminder_type  TEXT NOT NULL,   -- '7d' | '24h'
    message_id     TEXT,            -- Discord message ID once posted
    PRIMARY KEY (meeting_id, instance_date, reminder_type)
  );

  CREATE TABLE IF NOT EXISTS bot_config (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS custom_games (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id     TEXT UNIQUE,             -- set after posting
    channel_id     TEXT NOT NULL,
    show           TEXT NOT NULL,           -- 'MFB' | 'Endings' | 'GGB' | 'Lucidity'
    date           TEXT NOT NULL,           -- YYYY-MM-DD
    time           TEXT,                    -- HH:MM (optional)
    requester_id   TEXT,                    -- Discord user ID of whoever ran /custom-game
    filled_at      INTEGER,                 -- unix timestamp when fill was detected (null = unfilled)
    reminder_sent  INTEGER NOT NULL DEFAULT 0,  -- 1 once 48h reminder has been posted
    created_at     INTEGER DEFAULT (unixepoch())
  );
`);

// ─── Migrations ───────────────────────────────────────────────────────────────
// Safe to run on every start — ALTER TABLE fails silently if column already exists.

try { db.exec('ALTER TABLE meetings ADD COLUMN duration INTEGER NOT NULL DEFAULT 60'); } catch {}
try { db.exec('ALTER TABLE custom_games ADD COLUMN time TEXT'); } catch {}
try { db.exec('ALTER TABLE custom_games ADD COLUMN requester_id TEXT'); } catch {}
try { db.exec('ALTER TABLE custom_games ADD COLUMN filled_at INTEGER'); } catch {}
try { db.exec('ALTER TABLE custom_games ADD COLUMN reminder_sent INTEGER NOT NULL DEFAULT 0'); } catch {}

// ─── Seed ─────────────────────────────────────────────────────────────────────

// Seed default config if not already present
const seedConfig = db.prepare('INSERT OR IGNORE INTO bot_config (key, value) VALUES (?, ?)');
seedConfig.run('weekly_shifts_enabled', 'true');
seedConfig.run('daily_shifts_enabled', 'true');

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig(key) {
  const row = db.prepare('SELECT value FROM bot_config WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setConfig(key, value) {
  db.prepare('INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)').run(key, value);
}

// ─── Member links ─────────────────────────────────────────────────────────────

function linkMember(discordId, discordName, bookeoName) {
  db.prepare(`
    INSERT INTO member_links (discord_id, discord_name, bookeo_name) VALUES (?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET discord_name = excluded.discord_name, bookeo_name = excluded.bookeo_name
  `).run(discordId, discordName, bookeoName);
}

function getMemberByBookeoName(bookeoName) {
  return db.prepare('SELECT * FROM member_links WHERE bookeo_name = ?').get(bookeoName);
}

function getMemberByDiscordId(discordId) {
  return db.prepare('SELECT * FROM member_links WHERE discord_id = ?').get(discordId);
}

function getAllMemberLinks() {
  return db.prepare('SELECT * FROM member_links ORDER BY bookeo_name').all();
}

// ─── Meetings ─────────────────────────────────────────────────────────────────

function createMeeting(data) {
  const result = db.prepare(`
    INSERT INTO meetings
      (title, time, duration, date, recurrence_type, recurrence_day, recurrence_week,
       channel_id, target_type, reminder_7d, reminder_24h)
    VALUES
      (@title, @time, @duration, @date, @recurrence_type, @recurrence_day, @recurrence_week,
       @channel_id, @target_type, @reminder_7d, @reminder_24h)
  `).run(data);
  return result.lastInsertRowid;
}

function getMeeting(id) {
  return db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
}

function getActiveMeetings() {
  return db.prepare('SELECT * FROM meetings WHERE active = 1 ORDER BY date, time').all();
}

function deactivateMeeting(id) {
  db.prepare('UPDATE meetings SET active = 0 WHERE id = ?').run(id);
}

/**
 * Update any subset of a meeting's fields.
 * Allowed fields: title, time, duration, date, channel_id
 */
function updateMeeting(id, fields) {
  const allowed = ['title', 'time', 'duration', 'date', 'channel_id'];
  const updates = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (!updates.length) return;
  const setClauses = updates.map(([k]) => `${k} = ?`).join(', ');
  const values     = updates.map(([, v]) => v);
  db.prepare(`UPDATE meetings SET ${setClauses} WHERE id = ?`).run(...values, id);
}

// ─── Meeting members ──────────────────────────────────────────────────────────

function addMeetingMember(meetingId, discordId) {
  db.prepare('INSERT OR IGNORE INTO meeting_members (meeting_id, discord_id) VALUES (?, ?)').run(meetingId, discordId);
}

function getMeetingMembers(meetingId) {
  return db.prepare('SELECT * FROM meeting_members WHERE meeting_id = ?').all(meetingId);
}

// ─── Reminder tracking ────────────────────────────────────────────────────────

function hasReminderBeenSent(meetingId, instanceDate, reminderType) {
  return !!db.prepare(`
    SELECT 1 FROM meeting_reminders_sent
    WHERE meeting_id = ? AND instance_date = ? AND reminder_type = ?
  `).get(meetingId, instanceDate, reminderType);
}

function markReminderSent(meetingId, instanceDate, reminderType, messageId) {
  db.prepare(`
    INSERT OR IGNORE INTO meeting_reminders_sent (meeting_id, instance_date, reminder_type, message_id)
    VALUES (?, ?, ?, ?)
  `).run(meetingId, instanceDate, reminderType, messageId);
}

function getReminderRecord(meetingId, instanceDate, reminderType) {
  return db.prepare(`
    SELECT * FROM meeting_reminders_sent
    WHERE meeting_id = ? AND instance_date = ? AND reminder_type = ?
  `).get(meetingId, instanceDate, reminderType);
}

function getReminderByMessageId(messageId) {
  return db.prepare(`
    SELECT * FROM meeting_reminders_sent WHERE message_id = ?
  `).get(messageId);
}

// ─── Custom games ─────────────────────────────────────────────────────────────

function createCustomGame(data) {
  // data: { channel_id, show, date, time, requester_id }
  const result = db.prepare(`
    INSERT INTO custom_games (channel_id, show, date, time, requester_id)
    VALUES (@channel_id, @show, @date, @time, @requester_id)
  `).run(data);
  return result.lastInsertRowid;
}

function setCustomGameMessageId(id, messageId) {
  db.prepare('UPDATE custom_games SET message_id = ? WHERE id = ?').run(messageId, id);
}

function getCustomGameById(id) {
  return db.prepare('SELECT * FROM custom_games WHERE id = ?').get(id);
}

function getCustomGameByMessageId(messageId) {
  return db.prepare('SELECT * FROM custom_games WHERE message_id = ?').get(messageId);
}

function markCustomGameFilled(id) {
  db.prepare('UPDATE custom_games SET filled_at = unixepoch() WHERE id = ?').run(id);
}

function deactivateCustomGame(id) {
  db.prepare('UPDATE custom_games SET filled_at = unixepoch() WHERE id = ?').run(id);
}

function markCustomGameReminderSent(id) {
  db.prepare('UPDATE custom_games SET reminder_sent = 1 WHERE id = ?').run(id);
}

/** Returns games older than cutoff (unix seconds) that are unfilled and haven't had a reminder sent. */
function getUnfilledCustomGames(cutoff) {
  return db.prepare(`
    SELECT * FROM custom_games
    WHERE filled_at IS NULL
      AND reminder_sent = 0
      AND requester_id IS NOT NULL
      AND created_at <= ?
  `).all(cutoff);
}

/**
 * Return the first name for a Discord user: first word of bookeo_name if linked,
 * otherwise the provided fallback (display name / username).
 */
function getMemberFirstName(discordId, fallback) {
  const link = getMemberByDiscordId(discordId);
  if (link && link.bookeo_name) return link.bookeo_name.split(' ')[0];
  return fallback;
}

module.exports = {
  db,
  getConfig,
  setConfig,
  linkMember,
  getMemberByBookeoName,
  getMemberByDiscordId,
  getAllMemberLinks,
  createMeeting,
  getMeeting,
  getActiveMeetings,
  deactivateMeeting,
  updateMeeting,
  addMeetingMember,
  getMeetingMembers,
  hasReminderBeenSent,
  markReminderSent,
  getReminderRecord,
  getReminderByMessageId,
  createCustomGame,
  setCustomGameMessageId,
  getCustomGameById,
  getCustomGameByMessageId,
  markCustomGameFilled,
  deactivateCustomGame,
  markCustomGameReminderSent,
  getUnfilledCustomGames,
  getMemberFirstName,
};
