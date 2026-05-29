'use strict';

const db = require('./db');

function setMultiRoleSelection(userId, gameId, roleName, takerId) {
  const existing = db.getConfirmationSession(userId, gameId) ?? {};
  existing[roleName] = takerId;
  db.upsertConfirmationSession(userId, gameId, existing);
}

function getMultiRoleSelections(userId, gameId) {
  return db.getConfirmationSession(userId, gameId);
}

function clearMultiRoleSelections(userId, gameId) {
  db.deleteConfirmationSession(userId, gameId);
}

// ─── Pure plan functions ──────────────────────────────────────────────────────

/**
 * Validate that all role slots have been selected and produce a takers list.
 *
 * @param {Object|undefined} pendingSelections  { [roleName]: takerId } from getMultiRoleSelections
 * @param {string[]}         characters         Role names required for this show
 * @returns {{ valid: false, missingRoles: string[] } | { valid: true, takers: Array<{ role: string, userId: string }> }}
 */
function planMultiRoleConfirm(pendingSelections, characters) {
  const missingRoles = characters.filter(r => !pendingSelections?.[r]);
  if (missingRoles.length) return { valid: false, missingRoles };
  const takers = characters.map(role => ({ role, userId: pendingSelections[role] }));
  return { valid: true, takers };
}

module.exports = {
  setMultiRoleSelection,
  getMultiRoleSelections,
  clearMultiRoleSelections,
  planMultiRoleConfirm,
};
