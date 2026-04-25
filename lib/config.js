// Typed accessors for all bot_config keys — callers never construct key strings directly.
const db = require('./db');

// ─── Feature flags ────────────────────────────────────────────────────────────

function isWeeklyShiftsEnabled() {
  return db.getConfig('weekly_shifts_enabled') === 'true';
}

function setWeeklyShiftsEnabled(enabled) {
  db.setConfig('weekly_shifts_enabled', enabled ? 'true' : 'false');
}

function isDailyShiftsEnabled() {
  return db.getConfig('daily_shifts_enabled') === 'true';
}

function setDailyShiftsEnabled(enabled) {
  db.setConfig('daily_shifts_enabled', enabled ? 'true' : 'false');
}

// ─── Channel IDs ─────────────────────────────────────────────────────────────

function getErrorChannelId() {
  return db.getConfig('error_channel_id') ?? null;
}

function setErrorChannelId(channelId) {
  db.setConfig('error_channel_id', channelId);
}

function getCheckinAlertChannelId(showKey) {
  return db.getConfig(`checkin_alert_channel_${showKey}`) ?? null;
}

function setCheckinAlertChannelId(showKey, channelId) {
  db.setConfig(`checkin_alert_channel_${showKey}`, channelId);
}

function getCoverageChannelId(showKey, character = null) {
  const key = character
    ? `coverage_channel_${showKey}_${character}`
    : `coverage_channel_${showKey}`;
  return db.getConfig(key) ?? null;
}

function setCoverageChannelId(showKey, character, channelId) {
  const key = character
    ? `coverage_channel_${showKey}_${character}`
    : `coverage_channel_${showKey}`;
  db.setConfig(key, channelId);
}

module.exports = {
  isWeeklyShiftsEnabled,
  setWeeklyShiftsEnabled,
  isDailyShiftsEnabled,
  setDailyShiftsEnabled,
  getErrorChannelId,
  setErrorChannelId,
  getCheckinAlertChannelId,
  setCheckinAlertChannelId,
  getCoverageChannelId,
  setCoverageChannelId,
};
