'use strict';

// ─── In-memory multi-role confirmation state ──────────────────────────────────
// Key: `${userId}:${gameId}` → { [roleName]: takerId }

const pendingMultiRole = new Map();

function setMultiRoleSelection(userId, gameId, roleName, takerId) {
  const key     = `${userId}:${gameId}`;
  const pending = pendingMultiRole.get(key) ?? {};
  pending[roleName] = takerId;
  pendingMultiRole.set(key, pending);
}

function getMultiRoleSelections(userId, gameId) {
  return pendingMultiRole.get(`${userId}:${gameId}`);
}

function clearMultiRoleSelections(userId, gameId) {
  pendingMultiRole.delete(`${userId}:${gameId}`);
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
