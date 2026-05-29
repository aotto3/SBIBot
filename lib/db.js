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

  CREATE TABLE IF NOT EXISTS coverage_requests (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id      TEXT NOT NULL,    -- Discord user ID
    requester_name    TEXT NOT NULL,    -- Display name for posts
    show              TEXT NOT NULL,    -- 'MFB' | 'Endings' | 'GGB' | 'Lucidity'
    character         TEXT,             -- character name for multi-role shows (e.g. 'Daphne'), null for single-role
    channel_id        TEXT NOT NULL,    -- Discord channel where posts live
    header_message_id TEXT,             -- set after posting the header message
    status            TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'cancelled'
    created_at        INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS coverage_shifts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id          INTEGER NOT NULL REFERENCES coverage_requests(id),
    date                TEXT NOT NULL,    -- YYYY-MM-DD
    time                TEXT NOT NULL,    -- HH:MM 24h
    status              TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'covered' | 'cancelled'
    shift_message_id    TEXT,             -- Discord message ID for this shift's post
    confirmed_taker_id  TEXT,             -- Discord user ID of person taking the shift
    confirmed_at        INTEGER           -- unix timestamp when confirmed
  );

  CREATE INDEX IF NOT EXISTS idx_coverage_shifts_request
    ON coverage_shifts(request_id);
  CREATE INDEX IF NOT EXISTS idx_coverage_shifts_status
    ON coverage_shifts(status, date);

  CREATE TABLE IF NOT EXISTS checkin_records (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_date       TEXT NOT NULL,    -- YYYY-MM-DD
    show             TEXT NOT NULL,    -- 'GGB' | 'Lucidity' | 'Endings'
    bookeo_name      TEXT NOT NULL,    -- cast member's Bookeo display name
    discord_id       TEXT NOT NULL,    -- linked Discord user ID
    call_time        INTEGER NOT NULL, -- unix timestamp of call time
    checked_in_at    INTEGER,          -- unix timestamp of check-in (null = not yet)
    alert_message_id TEXT,             -- Discord message ID of the fired alert
    alert_channel_id TEXT,             -- Discord channel ID where alert was posted
    forced_by        TEXT,             -- Discord user ID if an admin forced the check-in
    UNIQUE (shift_date, show, bookeo_name)
  );

  CREATE TABLE IF NOT EXISTS late_booking_baseline (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    date     TEXT NOT NULL,    -- YYYY-MM-DD (today's date when the baseline was taken)
    show     TEXT NOT NULL,    -- 'MFB' | 'Endings' | 'GGB' | 'Lucidity'
    time     TEXT NOT NULL,    -- H:MM AM/PM (Bookeo format)
    cast     TEXT NOT NULL,    -- JSON array of bookeo_name strings
    notified INTEGER NOT NULL DEFAULT 0  -- 1 once cast have been DM'd
  );
  CREATE TABLE IF NOT EXISTS coverage_confirmation_sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    game_id    INTEGER NOT NULL,
    selections TEXT NOT NULL DEFAULT '{}',  -- JSON object: { [roleName]: takerId }
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user_id, game_id)
  );
`);

// ─── Migrations ───────────────────────────────────────────────────────────────
// Safe to run on every start — ALTER TABLE fails silently if column already exists.

try { db.exec('ALTER TABLE meetings ADD COLUMN duration INTEGER NOT NULL DEFAULT 60'); } catch {}
try { db.exec('ALTER TABLE custom_games ADD COLUMN time TEXT'); } catch {}
try { db.exec('ALTER TABLE custom_games ADD COLUMN requester_id TEXT'); } catch {}
try { db.exec('ALTER TABLE custom_games ADD COLUMN filled_at INTEGER'); } catch {}
try { db.exec('ALTER TABLE custom_games ADD COLUMN reminder_sent INTEGER NOT NULL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE coverage_requests ADD COLUMN character TEXT'); } catch {}
try { db.exec('ALTER TABLE coverage_shifts ADD COLUMN fillable_notified INTEGER NOT NULL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE coverage_shifts ADD COLUMN all_responded_alert_sent INTEGER NOT NULL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE custom_games ADD COLUMN fillable_notified INTEGER NOT NULL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE custom_games ADD COLUMN confirmed_at INTEGER'); } catch {}

// One-time fix: games cancelled via deactivateCustomGame before this patch had filled_at set
// but confirmed_at null, causing them to re-appear in open-coverage queries.
db.exec('UPDATE custom_games SET confirmed_at = filled_at WHERE filled_at IS NOT NULL AND confirmed_at IS NULL');

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

function deleteConfig(key) {
  db.prepare('DELETE FROM bot_config WHERE key = ?').run(key);
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

function getAllReminderRecords(meetingId) {
  return db.prepare(`
    SELECT * FROM meeting_reminders_sent WHERE meeting_id = ? AND message_id IS NOT NULL
  `).all(meetingId);
}

function getCreatedReminderRecord(meetingId, instanceDate) {
  return db.prepare(`
    SELECT * FROM meeting_reminders_sent
    WHERE meeting_id = ? AND instance_date = ? AND reminder_type = 'created'
  `).get(meetingId, instanceDate) ?? null;
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
  db.prepare('UPDATE custom_games SET filled_at = unixepoch(), confirmed_at = unixepoch() WHERE id = ?').run(id);
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

// ─── Check-in records ─────────────────────────────────────────────────────────

/**
 * Insert a check-in record for a shift. Idempotent — silently ignores duplicates
 * on the unique (shift_date, show, bookeo_name) key.
 */
function upsertCheckinRecord({ shift_date, show, bookeo_name, discord_id, call_time }) {
  db.prepare(`
    INSERT OR IGNORE INTO checkin_records (shift_date, show, bookeo_name, discord_id, call_time)
    VALUES (?, ?, ?, ?, ?)
  `).run(shift_date, show, bookeo_name, discord_id, call_time);
}

function getCheckinRecord(shiftDate, show, bookeoName) {
  return db.prepare(`
    SELECT * FROM checkin_records
    WHERE shift_date = ? AND show = ? AND bookeo_name = ?
  `).get(shiftDate, show, bookeoName);
}

function getCheckinRecordById(id) {
  return db.prepare('SELECT * FROM checkin_records WHERE id = ?').get(id);
}

/** Find a check-in record by the actor's Discord ID, show, and date. */
function getCheckinRecordByDiscordAndShow(discordId, show, shiftDate) {
  return db.prepare(`
    SELECT * FROM checkin_records
    WHERE discord_id = ? AND show = ? AND shift_date = ?
  `).get(discordId, show, shiftDate);
}

/**
 * Mark a check-in record as checked in.
 * @param {number} id
 * @param {string|null} forcedBy - Discord user ID of admin, or null for self-check-in
 */
function markCheckedIn(id, forcedBy = null) {
  db.prepare(`
    UPDATE checkin_records
    SET checked_in_at = unixepoch(), forced_by = ?
    WHERE id = ?
  `).run(forcedBy, id);
}

/** Store the alert message ID and channel ID after firing a no-show alert. */
function storeAlertInfo(id, alertMessageId, alertChannelId) {
  db.prepare(`
    UPDATE checkin_records
    SET alert_message_id = ?, alert_channel_id = ?
    WHERE id = ?
  `).run(alertMessageId, alertChannelId, id);
}

/**
 * Return the named state for a check-in record.
 * Use this instead of inspecting nullable fields directly.
 *
 * @param {object} record  A checkin_records row
 * @returns {'checked-in' | 'alerted' | 'pending'}
 */
function getCheckinState(record) {
  if (record.checked_in_at)    return 'checked-in';
  if (record.alert_message_id) return 'alerted';
  return 'pending';
}

/**
 * Return all records for a given date where check-in hasn't happened yet
 * and no alert has been fired. Used by startup recovery to reschedule timeouts.
 */
function getPendingCheckins(shiftDate) {
  return db.prepare(`
    SELECT * FROM checkin_records
    WHERE shift_date = ? AND checked_in_at IS NULL AND alert_message_id IS NULL
  `).all(shiftDate);
}

/**
 * Return pending (not yet checked in, no alert fired) records for a specific
 * Discord user on a given date. Used to build DM buttons and /check-in command.
 */
function getPendingCheckinsByDiscord(discordId, shiftDate) {
  return db.prepare(`
    SELECT * FROM checkin_records
    WHERE discord_id = ? AND shift_date = ? AND checked_in_at IS NULL AND alert_message_id IS NULL
  `).all(discordId, shiftDate);
}

/**
 * Return records for a given date where an alert was posted but the member
 * has not yet checked in. Used by startup recovery and /checkin-status.
 */
function getAlertedCheckins(shiftDate) {
  return db.prepare(`
    SELECT * FROM checkin_records
    WHERE shift_date = ? AND alert_message_id IS NOT NULL AND checked_in_at IS NULL
  `).all(shiftDate);
}

/**
 * Return all check-in records for a Discord user on a given date, regardless
 * of status. Used by /check-in to distinguish "no shift" from "already checked in".
 */
function getCheckinRecordsByDiscordAndDate(discordId, shiftDate) {
  return db.prepare(`
    SELECT * FROM checkin_records
    WHERE discord_id = ? AND shift_date = ?
  `).all(discordId, shiftDate);
}

/**
 * Return all check-in records for a range of dates, ordered by date and show.
 * Used by /checkin-status to display the last N days.
 */
function getCheckinRecordsByDateRange(fromDate, toDate) {
  return db.prepare(`
    SELECT * FROM checkin_records
    WHERE shift_date >= ? AND shift_date <= ?
    ORDER BY shift_date DESC, show ASC, bookeo_name ASC
  `).all(fromDate, toDate);
}

// ─── Coverage requests ────────────────────────────────────────────────────────

function createCoverageRequest({ requester_id, requester_name, show, character = null, channel_id }) {
  const result = db.prepare(`
    INSERT INTO coverage_requests (requester_id, requester_name, show, character, channel_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(requester_id, requester_name, show, character, channel_id);
  return result.lastInsertRowid;
}

function setCoverageRequestHeaderMessageId(requestId, messageId) {
  db.prepare('UPDATE coverage_requests SET header_message_id = ? WHERE id = ?').run(messageId, requestId);
}

function getCoverageRequest(id) {
  return db.prepare('SELECT * FROM coverage_requests WHERE id = ?').get(id);
}

function getCoverageRequestByHeaderMessage(messageId) {
  return db.prepare('SELECT * FROM coverage_requests WHERE header_message_id = ?').get(messageId);
}

/** Mark a request and all its remaining open shifts as cancelled. Atomic — both tables update or neither does. */
function markRequestCancelled(requestId) {
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE coverage_shifts SET status = 'cancelled' WHERE request_id = ? AND status = 'open'`).run(requestId);
    db.prepare(`UPDATE coverage_requests SET status = 'cancelled' WHERE id = ?`).run(requestId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ─── Coverage shifts ──────────────────────────────────────────────────────────

function addCoverageShift({ request_id, date, time }) {
  const result = db.prepare(`
    INSERT INTO coverage_shifts (request_id, date, time)
    VALUES (?, ?, ?)
  `).run(request_id, date, time);
  return result.lastInsertRowid;
}

function setCoverageShiftMessageId(shiftId, messageId) {
  db.prepare('UPDATE coverage_shifts SET shift_message_id = ? WHERE id = ?').run(messageId, shiftId);
}

function getCoverageShiftById(id) {
  return db.prepare('SELECT * FROM coverage_shifts WHERE id = ?').get(id);
}

function getCoverageShiftByMessageId(messageId) {
  return db.prepare('SELECT * FROM coverage_shifts WHERE shift_message_id = ?').get(messageId);
}

function getCoverageShiftsByRequest(requestId) {
  return db.prepare('SELECT * FROM coverage_shifts WHERE request_id = ? ORDER BY date, time').all(requestId);
}

/** Open shifts for a requester — used for cancel/confirm dropdowns. */
function getPendingCoverageShifts(requesterId) {
  return db.prepare(`
    SELECT cs.*, cr.show, cr.requester_name, cr.channel_id
    FROM coverage_shifts cs
    JOIN coverage_requests cr ON cs.request_id = cr.id
    WHERE cr.requester_id = ? AND cs.status = 'open'
    ORDER BY cs.date, cs.time
  `).all(requesterId);
}

function markShiftCovered(shiftId, takerId) {
  db.prepare(`
    UPDATE coverage_shifts
    SET status = 'covered', confirmed_taker_id = ?, confirmed_at = unixepoch()
    WHERE id = ?
  `).run(takerId, shiftId);
}

function markShiftCancelled(shiftId) {
  db.prepare(`UPDATE coverage_shifts SET status = 'cancelled' WHERE id = ?`).run(shiftId);
}

/**
 * Check for an existing open shift with the same show, date, and time.
 * Used for duplicate detection before creating a new request.
 */
function getOpenShiftByShowAndDateTime(show, date, time) {
  return db.prepare(`
    SELECT cs.*, cr.channel_id FROM coverage_shifts cs
    JOIN coverage_requests cr ON cs.request_id = cr.id
    WHERE cr.show = ? AND cs.date = ? AND cs.time = ? AND cs.status = 'open'
    LIMIT 1
  `).get(show, date, time);
}

/**
 * Return open shifts on a given date, joined with request info.
 * Used by the daily 8am reminder to find shifts happening today that still need coverage.
 */
function getCoverageShiftsForDailyReminder(date) {
  return db.prepare(`
    SELECT cs.*, cr.show, cr.requester_id, cr.requester_name
    FROM coverage_shifts cs
    JOIN coverage_requests cr ON cs.request_id = cr.id
    WHERE cs.status = 'open' AND cs.date = ?
    ORDER BY cs.time
  `).all(date);
}

// ─── Coverage confirmation ────────────────────────────────────────────────────

function confirmCoverageShift(shiftId, takerId) {
  db.prepare(`
    UPDATE coverage_shifts
    SET confirmed_taker_id = ?, confirmed_at = unixepoch(), status = 'covered'
    WHERE id = ?
  `).run(takerId, shiftId);
}

function confirmCustomGame(gameId) {
  db.prepare('UPDATE custom_games SET confirmed_at = unixepoch() WHERE id = ?').run(gameId);
}

function setFillableNotified(type, id) {
  if (type === 'shift') {
    db.prepare('UPDATE coverage_shifts SET fillable_notified = 1 WHERE id = ?').run(id);
  } else {
    db.prepare('UPDATE custom_games SET fillable_notified = 1 WHERE id = ?').run(id);
  }
}

/** Shifts where cast manager was notified but Chaney hasn't confirmed yet. */
function getUnconfirmedFillableShifts() {
  return db.prepare(`
    SELECT cs.*, cr.show, cr.channel_id, cr.requester_id, cr.character
    FROM coverage_shifts cs
    JOIN coverage_requests cr ON cs.request_id = cr.id
    WHERE cs.fillable_notified = 1 AND cs.confirmed_taker_id IS NULL AND cs.status = 'open'
    ORDER BY cs.date, cs.time
  `).all();
}

/** Games where cast manager was notified but Chaney hasn't confirmed yet. */
function getUnconfirmedFillableGames() {
  return db.prepare(`
    SELECT * FROM custom_games
    WHERE fillable_notified = 1 AND confirmed_at IS NULL
    ORDER BY date, time
  `).all();
}

/** All open coverage shifts joined with their request info, for the 8am role-ping job and /open-coverage. */
function getOpenCoverageShiftsWithRequests() {
  return db.prepare(`
    SELECT cs.id, cs.date, cs.time, cs.shift_message_id, cs.all_responded_alert_sent,
           cr.show, cr.character, cr.channel_id, cr.requester_name, cr.requester_id
    FROM coverage_shifts cs
    JOIN coverage_requests cr ON cs.request_id = cr.id
    WHERE cs.status = 'open'
    ORDER BY cs.date, cs.time
  `).all();
}

/** All unconfirmed custom games that have been posted, for the 8am role-ping job. */
function getOpenCustomGamesForPings() {
  return db.prepare(`
    SELECT id, show, date, time, channel_id, message_id
    FROM custom_games
    WHERE confirmed_at IS NULL AND message_id IS NOT NULL
    ORDER BY date, time
  `).all();
}

/** Mark that the "all responded, none available" alert has been sent for this shift. */
function markAllRespondedAlertSent(shiftId) {
  db.prepare('UPDATE coverage_shifts SET all_responded_alert_sent = 1 WHERE id = ?').run(shiftId);
}

// ─── Hard-delete helpers (admin purge) ───────────────────────────────────────

function hardDeleteShift(id) {
  db.prepare('DELETE FROM coverage_shifts WHERE id = ?').run(id);
}

function hardDeleteRequest(id) {
  db.prepare('DELETE FROM coverage_shifts WHERE request_id = ?').run(id);
  db.prepare('DELETE FROM coverage_requests WHERE id = ?').run(id);
}

function hardDeleteCustomGame(id) {
  db.prepare('DELETE FROM custom_games WHERE id = ?').run(id);
}

// ─── Late-booking baseline ────────────────────────────────────────────────────

/**
 * Insert blank-show rows for today's baseline.
 * No-ops if rows already exist for this date (restart safety — never overwrites an established baseline).
 *
 * @param {Array<{ date, show, time, cast }>} rows
 */
function seedLatebookingBaseline(rows) {
  if (!rows.length) return;
  const date = rows[0].date;
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM late_booking_baseline WHERE date = ?').get(date);
  if (count > 0) return;
  const insert = db.prepare(
    'INSERT INTO late_booking_baseline (date, show, time, cast, notified) VALUES (?, ?, ?, ?, 0)'
  );
  for (const row of rows) {
    insert.run(row.date, row.show, row.time, JSON.stringify(row.cast));
  }
}

/**
 * Return all unnotified baseline rows for the given date.
 * Each row has its `cast` field as a parsed array (not JSON string).
 *
 * @param {string} date  YYYY-MM-DD
 * @returns {Array}
 */
function getUnnotifiedLatebookingRows(date) {
  const rows = db.prepare(
    'SELECT * FROM late_booking_baseline WHERE date = ? AND notified = 0'
  ).all(date);
  return rows.map(r => ({ ...r, cast: JSON.parse(r.cast) }));
}

/**
 * Mark a single late_booking_baseline row as notified.
 *
 * @param {number} id
 */
function markLatebookingNotified(id) {
  db.prepare('UPDATE late_booking_baseline SET notified = 1 WHERE id = ?').run(id);
}

// ─── Check-in contacts helpers ────────────────────────────────────────────────

function getCheckinContacts() {
  const raw = getConfig('checkin_contacts');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function addCheckinContact(userId) {
  const contacts = getCheckinContacts();
  if (!contacts.includes(userId)) {
    contacts.push(userId);
    setConfig('checkin_contacts', JSON.stringify(contacts));
  }
}

function removeCheckinContact(userId) {
  const contacts = getCheckinContacts().filter(id => id !== userId);
  setConfig('checkin_contacts', JSON.stringify(contacts));
}

// ─── Coverage ping exclusion helpers ─────────────────────────────────────────

function getCoveragePingExclusions() {
  const raw = getConfig('coverage_ping_exclusions');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function addCoveragePingExclusion(userId) {
  const exclusions = getCoveragePingExclusions();
  if (!exclusions.includes(userId)) {
    exclusions.push(userId);
    setConfig('coverage_ping_exclusions', JSON.stringify(exclusions));
  }
}

function removeCoveragePingExclusion(userId) {
  const exclusions = getCoveragePingExclusions().filter(id => id !== userId);
  setConfig('coverage_ping_exclusions', JSON.stringify(exclusions));
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

// ─── Multi-role confirmation sessions ─────────────────────────────────────────

function upsertConfirmationSession(userId, gameId, selections) {
  const now = Math.floor(Date.now() / 1000);
  const json = JSON.stringify(selections);
  db.prepare(`
    INSERT INTO coverage_confirmation_sessions (user_id, game_id, selections, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, game_id) DO UPDATE SET selections = excluded.selections, updated_at = excluded.updated_at
  `).run(userId, gameId, json, now, now);
}

function getConfirmationSession(userId, gameId) {
  return db.prepare(
    'SELECT selections, updated_at FROM coverage_confirmation_sessions WHERE user_id = ? AND game_id = ?'
  ).get(userId, gameId) ?? undefined;
}

function deleteConfirmationSession(userId, gameId) {
  db.prepare(
    'DELETE FROM coverage_confirmation_sessions WHERE user_id = ? AND game_id = ?'
  ).run(userId, gameId);
}

function deleteExpiredConfirmationSessions(maxAgeSeconds) {
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  db.prepare('DELETE FROM coverage_confirmation_sessions WHERE created_at < ?').run(cutoff);
}

module.exports = {
  db,
  getConfig,
  setConfig,
  deleteConfig,
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
  getAllReminderRecords,
  getCreatedReminderRecord,
  createCustomGame,
  setCustomGameMessageId,
  getCustomGameById,
  getCustomGameByMessageId,
  markCustomGameFilled,
  deactivateCustomGame,
  markCustomGameReminderSent,
  getUnfilledCustomGames,
  getMemberFirstName,
  upsertCheckinRecord,
  getCheckinRecord,
  getCheckinRecordById,
  getCheckinRecordByDiscordAndShow,
  markCheckedIn,
  storeAlertInfo,
  getCheckinState,
  getPendingCheckins,
  getAlertedCheckins,
  getPendingCheckinsByDiscord,
  getCheckinRecordsByDiscordAndDate,
  getCheckinRecordsByDateRange,
  getCheckinContacts,
  addCheckinContact,
  removeCheckinContact,
  getCoveragePingExclusions,
  addCoveragePingExclusion,
  removeCoveragePingExclusion,
  createCoverageRequest,
  setCoverageRequestHeaderMessageId,
  getCoverageRequest,
  getCoverageRequestByHeaderMessage,
  markRequestCancelled,
  addCoverageShift,
  setCoverageShiftMessageId,
  getCoverageShiftById,
  getCoverageShiftByMessageId,
  getCoverageShiftsByRequest,
  getPendingCoverageShifts,
  markShiftCovered,
  markShiftCancelled,
  getOpenShiftByShowAndDateTime,
  getCoverageShiftsForDailyReminder,
  confirmCoverageShift,
  confirmCustomGame,
  setFillableNotified,
  getUnconfirmedFillableShifts,
  getUnconfirmedFillableGames,
  getOpenCoverageShiftsWithRequests,
  getOpenCustomGamesForPings,
  markAllRespondedAlertSent,
  hardDeleteShift,
  hardDeleteRequest,
  hardDeleteCustomGame,
  seedLatebookingBaseline,
  getUnnotifiedLatebookingRows,
  markLatebookingNotified,
  upsertConfirmationSession,
  getConfirmationSession,
  deleteConfirmationSession,
  deleteExpiredConfirmationSessions,
};
