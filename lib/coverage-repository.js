'use strict';

/**
 * Coverage repository — single home for all coverage-related DB access.
 *
 * Wraps lib/db.js with cleaner names scoped to the coverage domain.
 * All coverage callers (rsvp.js, scheduler.js, commands) should import
 * from here rather than calling db directly for coverage data.
 */

const db = require('./db');

// ─── Coverage requests ────────────────────────────────────────────────────────

const createRequest          = data          => db.createCoverageRequest(data);
const setRequestHeaderMessageId = (id, mid) => db.setCoverageRequestHeaderMessageId(id, mid);
const getRequest             = id            => db.getCoverageRequest(id);
const getRequestByHeaderMessage = mid        => db.getCoverageRequestByHeaderMessage(mid);
const markRequestCancelled   = id            => db.markRequestCancelled(id);

// ─── Coverage shifts ──────────────────────────────────────────────────────────

const addShift                   = data         => db.addCoverageShift(data);
const setShiftMessageId          = (id, mid)    => db.setCoverageShiftMessageId(id, mid);
const getShiftById               = id           => db.getCoverageShiftById(id);
const getShiftByMessageId        = mid          => db.getCoverageShiftByMessageId(mid);
const getShiftsByRequest         = requestId    => db.getCoverageShiftsByRequest(requestId);
const getPendingShifts           = requesterId  => db.getPendingCoverageShifts(requesterId);
const markShiftCovered           = (id, taker)  => db.markShiftCovered(id, taker);
const markShiftCancelled         = id           => db.markShiftCancelled(id);
const confirmShift               = (id, taker)  => db.confirmCoverageShift(id, taker);
const getOpenShiftByShowAndDateTime = (show, date, time) => db.getOpenShiftByShowAndDateTime(show, date, time);
const getShiftsForDailyReminder  = date         => db.getCoverageShiftsForDailyReminder(date);
const markAllRespondedAlertSent  = id           => db.markAllRespondedAlertSent(id);

/** Open shifts with joined request info — used by the 8am role-ping job. */
const getOpenShifts = () => db.getOpenCoverageShiftsWithRequests();

/** Shifts notified as fillable but not yet confirmed by Chaney — used by the 9pm EOD reminder. */
const getUnconfirmedShifts = () => db.getUnconfirmedFillableShifts();

// ─── Custom games ─────────────────────────────────────────────────────────────

const createGame           = data        => db.createCustomGame(data);
const setGameMessageId     = (id, mid)   => db.setCustomGameMessageId(id, mid);
const getGameById          = id          => db.getCustomGameById(id);
const getGameByMessageId   = mid         => db.getCustomGameByMessageId(mid);
const markGameFilled       = id          => db.markCustomGameFilled(id);
const deactivateGame       = id          => db.deactivateCustomGame(id);
const markGameReminderSent = id          => db.markCustomGameReminderSent(id);
const confirmGame          = id          => db.confirmCustomGame(id);

/** Games older than cutoff (unix seconds) that are unfilled and haven't had a reminder sent. */
const getUnfilledGames = cutoff => db.getUnfilledCustomGames(cutoff);

/** Open unconfirmed games with a posted message — used by the 8am role-ping job. */
const getOpenGames = () => db.getOpenCustomGamesForPings();

/** Games notified as fillable but not yet confirmed by Chaney — used by the 9pm EOD reminder. */
const getUnconfirmedGames = () => db.getUnconfirmedFillableGames();

// ─── Coverage confirmation ────────────────────────────────────────────────────

const setFillableNotified = (type, id) => db.setFillableNotified(type, id);

// ─── Hard-delete helpers (admin purge) ───────────────────────────────────────

const hardDeleteShift   = id => db.hardDeleteShift(id);
const hardDeleteRequest = id => db.hardDeleteRequest(id);
const hardDeleteGame    = id => db.hardDeleteCustomGame(id);

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Requests
  createRequest,
  setRequestHeaderMessageId,
  getRequest,
  getRequestByHeaderMessage,
  markRequestCancelled,
  // Shifts
  addShift,
  setShiftMessageId,
  getShiftById,
  getShiftByMessageId,
  getShiftsByRequest,
  getPendingShifts,
  markShiftCovered,
  markShiftCancelled,
  confirmShift,
  getOpenShiftByShowAndDateTime,
  getShiftsForDailyReminder,
  getOpenShifts,
  getUnconfirmedShifts,
  markAllRespondedAlertSent,
  // Games
  createGame,
  setGameMessageId,
  getGameById,
  getGameByMessageId,
  markGameFilled,
  deactivateGame,
  markGameReminderSent,
  confirmGame,
  getUnfilledGames,
  getOpenGames,
  getUnconfirmedGames,
  // Confirmation
  setFillableNotified,
  // Hard deletes
  hardDeleteShift,
  hardDeleteRequest,
  hardDeleteGame,
};
