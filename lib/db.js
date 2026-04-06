const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'db.sqlite');
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
`);

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

function getAllMemberLinks() {
  return db.prepare('SELECT * FROM member_links ORDER BY bookeo_name').all();
}

// ─── Meetings ─────────────────────────────────────────────────────────────────

function createMeeting(data) {
  const result = db.prepare(`
    INSERT INTO meetings
      (title, time, date, recurrence_type, recurrence_day, recurrence_week,
       channel_id, target_type, reminder_7d, reminder_24h)
    VALUES
      (@title, @time, @date, @recurrence_type, @recurrence_day, @recurrence_week,
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

module.exports = {
  db,
  getConfig,
  setConfig,
  linkMember,
  getMemberByBookeoName,
  getAllMemberLinks,
  createMeeting,
  getMeeting,
  getActiveMeetings,
  deactivateMeeting,
  addMeetingMember,
  getMeetingMembers,
  hasReminderBeenSent,
  markReminderSent,
  getReminderRecord,
};
