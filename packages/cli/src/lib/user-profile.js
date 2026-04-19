/**
 * User Profile — persistent USER.md for AI-curated user preferences.
 *
 * Stores user preferences, coding style, communication style, and tech stack
 * in a global USER.md file. AI-curated with character limit and automatic
 * consolidation.
 *
 * Inspired by Hermes Agent's USER.md user profile system.
 *
 * @module user-profile
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { getHomeDir } from "./paths.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const USER_PROFILE_FILENAME = "USER.md";
const MAX_PROFILE_LENGTH = 2000; // characters

// ─── Exported for test injection ────────────────────────────────────────────

export const _deps = {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
};

// ─── Path ───────────────────────────────────────────────────────────────────

/**
 * Get the USER.md file path.
 * @returns {string}
 */
export function getUserProfilePath() {
  return join(getHomeDir(), USER_PROFILE_FILENAME);
}

// ─── Read ───────────────────────────────────────────────────────────────────

/**
 * Read the user profile content.
 * @returns {string} Profile content, or empty string if not found
 */
export function readUserProfile() {
  const profilePath = getUserProfilePath();
  try {
    if (_deps.existsSync(profilePath)) {
      return _deps.readFileSync(profilePath, "utf-8");
    }
  } catch (_err) {
    // Graceful degradation
  }
  return "";
}

// ─── Write ──────────────────────────────────────────────────────────────────

/**
 * Update the user profile with new content.
 * Enforces MAX_PROFILE_LENGTH character limit.
 *
 * @param {string} content - New profile content
 * @returns {{ written: boolean, truncated: boolean, length: number }}
 */
export function updateUserProfile(content) {
  if (!content || typeof content !== "string") {
    return { written: false, truncated: false, length: 0 };
  }

  const profilePath = getUserProfilePath();
  const dir = dirname(profilePath);

  try {
    if (!_deps.existsSync(dir)) {
      _deps.mkdirSync(dir, { recursive: true });
    }

    let truncated = false;
    let finalContent = content.trim();
    if (finalContent.length > MAX_PROFILE_LENGTH) {
      finalContent = finalContent.substring(0, MAX_PROFILE_LENGTH);
      truncated = true;
    }

    _deps.writeFileSync(profilePath, finalContent, "utf-8");
    return { written: true, truncated, length: finalContent.length };
  } catch (_err) {
    return { written: false, truncated: false, length: 0 };
  }
}

// ─── Append ─────────────────────────────────────────────────────────────────

/**
 * Append a line to the user profile.
 * If the profile would exceed MAX_PROFILE_LENGTH, returns needsConsolidation: true.
 *
 * @param {string} line - Line to append
 * @returns {{ appended: boolean, needsConsolidation: boolean, length: number }}
 */
export function appendToUserProfile(line) {
  if (!line || typeof line !== "string") {
    return { appended: false, needsConsolidation: false, length: 0 };
  }

  const current = readUserProfile();
  const newContent = current ? `${current}\n${line.trim()}` : line.trim();

  if (newContent.length > MAX_PROFILE_LENGTH) {
    return {
      appended: false,
      needsConsolidation: true,
      length: current.length,
    };
  }

  const result = updateUserProfile(newContent);
  return {
    appended: result.written,
    needsConsolidation: false,
    length: result.length,
  };
}

// ─── Consolidation ──────────────────────────────────────────────────────────

/**
 * Consolidate the user profile using an LLM to stay within character limits.
 * The LLM merges and summarizes the profile, preserving key preferences.
 *
 * @param {function} llmFn - async (prompt) => string — LLM call function
 * @returns {Promise<{ consolidated: boolean, oldLength: number, newLength: number }>}
 */
export async function consolidateUserProfile(llmFn) {
  const current = readUserProfile();
  if (!current || current.length <= MAX_PROFILE_LENGTH) {
    return {
      consolidated: false,
      oldLength: current.length,
      newLength: current.length,
    };
  }

  const prompt = `You are consolidating a user profile for an AI assistant. Merge and summarize the following user preferences into a concise profile under ${MAX_PROFILE_LENGTH} characters. Preserve the most important preferences, coding style, and tech stack information. Return ONLY the consolidated profile text, no explanations.\n\n---\n${current}\n---`;

  try {
    const consolidated = await llmFn(prompt);
    if (consolidated && typeof consolidated === "string") {
      const result = updateUserProfile(consolidated);
      return {
        consolidated: true,
        oldLength: current.length,
        newLength: result.length,
      };
    }
  } catch (_err) {
    // Consolidation is optional; failure is non-critical
  }

  return {
    consolidated: false,
    oldLength: current.length,
    newLength: current.length,
  };
}

// ─── Exports ────────────────────────────────────────────────────────────────

export const MAX_USER_PROFILE_LENGTH = MAX_PROFILE_LENGTH;

// ===== V2 Surface: User Profile governance overlay (CLI v0.141.0) =====
export const USER_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending", ACTIVE: "active", DORMANT: "dormant", ARCHIVED: "archived",
});
export const USER_PREF_LIFECYCLE_V2 = Object.freeze({
  PROPOSED: "proposed", APPLIED: "applied", REJECTED: "rejected", SUPERSEDED: "superseded", CANCELLED: "cancelled",
});
const _upTrans = new Map([
  [USER_PROFILE_MATURITY_V2.PENDING, new Set([USER_PROFILE_MATURITY_V2.ACTIVE, USER_PROFILE_MATURITY_V2.ARCHIVED])],
  [USER_PROFILE_MATURITY_V2.ACTIVE, new Set([USER_PROFILE_MATURITY_V2.DORMANT, USER_PROFILE_MATURITY_V2.ARCHIVED])],
  [USER_PROFILE_MATURITY_V2.DORMANT, new Set([USER_PROFILE_MATURITY_V2.ACTIVE, USER_PROFILE_MATURITY_V2.ARCHIVED])],
  [USER_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _upTerminal = new Set([USER_PROFILE_MATURITY_V2.ARCHIVED]);
const _uprefTrans = new Map([
  [USER_PREF_LIFECYCLE_V2.PROPOSED, new Set([USER_PREF_LIFECYCLE_V2.APPLIED, USER_PREF_LIFECYCLE_V2.REJECTED, USER_PREF_LIFECYCLE_V2.CANCELLED])],
  [USER_PREF_LIFECYCLE_V2.APPLIED, new Set([USER_PREF_LIFECYCLE_V2.SUPERSEDED])],
  [USER_PREF_LIFECYCLE_V2.REJECTED, new Set()],
  [USER_PREF_LIFECYCLE_V2.SUPERSEDED, new Set()],
  [USER_PREF_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _upsV2 = new Map();
const _uprefsV2 = new Map();
let _upMaxActivePerOwner = 5, _upMaxPendingPrefsPerProfile = 20, _upIdleMs = 90 * 24 * 60 * 60 * 1000, _uprefStuckMs = 7 * 24 * 60 * 60 * 1000;
function _upPos(n, label) { const v = Math.floor(Number(n)); if (!Number.isFinite(v) || v <= 0) throw new Error(`${label} must be positive integer`); return v; }
function _upCheckP(from, to) { const a = _upTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid user profile transition ${from} → ${to}`); }
function _uprefCheck(from, to) { const a = _uprefTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid user pref transition ${from} → ${to}`); }
export function setMaxActiveUserProfilesPerOwnerV2(n) { _upMaxActivePerOwner = _upPos(n, "maxActiveUserProfilesPerOwner"); }
export function getMaxActiveUserProfilesPerOwnerV2() { return _upMaxActivePerOwner; }
export function setMaxPendingUserPrefsPerProfileV2(n) { _upMaxPendingPrefsPerProfile = _upPos(n, "maxPendingUserPrefsPerProfile"); }
export function getMaxPendingUserPrefsPerProfileV2() { return _upMaxPendingPrefsPerProfile; }
export function setUserProfileIdleMsV2(n) { _upIdleMs = _upPos(n, "userProfileIdleMs"); }
export function getUserProfileIdleMsV2() { return _upIdleMs; }
export function setUserPrefStuckMsV2(n) { _uprefStuckMs = _upPos(n, "userPrefStuckMs"); }
export function getUserPrefStuckMsV2() { return _uprefStuckMs; }
export function _resetStateUserProfileV2() { _upsV2.clear(); _uprefsV2.clear(); _upMaxActivePerOwner = 5; _upMaxPendingPrefsPerProfile = 20; _upIdleMs = 90 * 24 * 60 * 60 * 1000; _uprefStuckMs = 7 * 24 * 60 * 60 * 1000; }
export function registerUserProfileV2({ id, owner, handle, metadata } = {}) {
  if (!id) throw new Error("user profile id required"); if (!owner) throw new Error("user profile owner required");
  if (_upsV2.has(id)) throw new Error(`user profile ${id} already registered`);
  const now = Date.now();
  const p = { id, owner, handle: handle || id, status: USER_PROFILE_MATURITY_V2.PENDING, createdAt: now, updatedAt: now, activatedAt: null, archivedAt: null, lastTouchedAt: now, metadata: { ...(metadata || {}) } };
  _upsV2.set(id, p); return { ...p, metadata: { ...p.metadata } };
}
function _upCountActive(owner) { let n = 0; for (const p of _upsV2.values()) if (p.owner === owner && p.status === USER_PROFILE_MATURITY_V2.ACTIVE) n++; return n; }
export function activateUserProfileV2(id) {
  const p = _upsV2.get(id); if (!p) throw new Error(`user profile ${id} not found`);
  _upCheckP(p.status, USER_PROFILE_MATURITY_V2.ACTIVE);
  const recovery = p.status === USER_PROFILE_MATURITY_V2.DORMANT;
  if (!recovery && _upCountActive(p.owner) >= _upMaxActivePerOwner) throw new Error(`max active user profiles for owner ${p.owner} reached`);
  const now = Date.now(); p.status = USER_PROFILE_MATURITY_V2.ACTIVE; p.updatedAt = now; p.lastTouchedAt = now; if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function dormantUserProfileV2(id) { const p = _upsV2.get(id); if (!p) throw new Error(`user profile ${id} not found`); _upCheckP(p.status, USER_PROFILE_MATURITY_V2.DORMANT); p.status = USER_PROFILE_MATURITY_V2.DORMANT; p.updatedAt = Date.now(); return { ...p, metadata: { ...p.metadata } }; }
export function archiveUserProfileV2(id) { const p = _upsV2.get(id); if (!p) throw new Error(`user profile ${id} not found`); _upCheckP(p.status, USER_PROFILE_MATURITY_V2.ARCHIVED); const now = Date.now(); p.status = USER_PROFILE_MATURITY_V2.ARCHIVED; p.updatedAt = now; if (!p.archivedAt) p.archivedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function touchUserProfileV2(id) { const p = _upsV2.get(id); if (!p) throw new Error(`user profile ${id} not found`); if (_upTerminal.has(p.status)) throw new Error(`cannot touch terminal user profile ${id}`); const now = Date.now(); p.lastTouchedAt = now; p.updatedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function getUserProfileV2(id) { const p = _upsV2.get(id); if (!p) return null; return { ...p, metadata: { ...p.metadata } }; }
export function listUserProfilesV2() { return [..._upsV2.values()].map((p) => ({ ...p, metadata: { ...p.metadata } })); }
function _uprefCountPending(profileId) { let n = 0; for (const r of _uprefsV2.values()) if (r.profileId === profileId && r.status === USER_PREF_LIFECYCLE_V2.PROPOSED) n++; return n; }
export function createUserPrefV2({ id, profileId, key, metadata } = {}) {
  if (!id) throw new Error("user pref id required"); if (!profileId) throw new Error("user pref profileId required");
  if (_uprefsV2.has(id)) throw new Error(`user pref ${id} already exists`);
  if (!_upsV2.has(profileId)) throw new Error(`user profile ${profileId} not found`);
  if (_uprefCountPending(profileId) >= _upMaxPendingPrefsPerProfile) throw new Error(`max pending user prefs for profile ${profileId} reached`);
  const now = Date.now();
  const r = { id, profileId, key: key || "", status: USER_PREF_LIFECYCLE_V2.PROPOSED, createdAt: now, updatedAt: now, startedAt: now, settledAt: null, metadata: { ...(metadata || {}) } };
  _uprefsV2.set(id, r); return { ...r, metadata: { ...r.metadata } };
}
export function applyUserPrefV2(id) { const r = _uprefsV2.get(id); if (!r) throw new Error(`user pref ${id} not found`); _uprefCheck(r.status, USER_PREF_LIFECYCLE_V2.APPLIED); const now = Date.now(); r.status = USER_PREF_LIFECYCLE_V2.APPLIED; r.updatedAt = now; if (!r.settledAt) r.settledAt = now; return { ...r, metadata: { ...r.metadata } }; }
export function rejectUserPrefV2(id, reason) { const r = _uprefsV2.get(id); if (!r) throw new Error(`user pref ${id} not found`); _uprefCheck(r.status, USER_PREF_LIFECYCLE_V2.REJECTED); const now = Date.now(); r.status = USER_PREF_LIFECYCLE_V2.REJECTED; r.updatedAt = now; if (!r.settledAt) r.settledAt = now; if (reason) r.metadata.rejectReason = String(reason); return { ...r, metadata: { ...r.metadata } }; }
export function supersedeUserPrefV2(id) { const r = _uprefsV2.get(id); if (!r) throw new Error(`user pref ${id} not found`); _uprefCheck(r.status, USER_PREF_LIFECYCLE_V2.SUPERSEDED); const now = Date.now(); r.status = USER_PREF_LIFECYCLE_V2.SUPERSEDED; r.updatedAt = now; if (!r.settledAt) r.settledAt = now; return { ...r, metadata: { ...r.metadata } }; }
export function cancelUserPrefV2(id, reason) { const r = _uprefsV2.get(id); if (!r) throw new Error(`user pref ${id} not found`); _uprefCheck(r.status, USER_PREF_LIFECYCLE_V2.CANCELLED); const now = Date.now(); r.status = USER_PREF_LIFECYCLE_V2.CANCELLED; r.updatedAt = now; if (!r.settledAt) r.settledAt = now; if (reason) r.metadata.cancelReason = String(reason); return { ...r, metadata: { ...r.metadata } }; }
export function getUserPrefV2(id) { const r = _uprefsV2.get(id); if (!r) return null; return { ...r, metadata: { ...r.metadata } }; }
export function listUserPrefsV2() { return [..._uprefsV2.values()].map((r) => ({ ...r, metadata: { ...r.metadata } })); }
export function autoDormantIdleUserProfilesV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const p of _upsV2.values()) if (p.status === USER_PROFILE_MATURITY_V2.ACTIVE && (t - p.lastTouchedAt) >= _upIdleMs) { p.status = USER_PROFILE_MATURITY_V2.DORMANT; p.updatedAt = t; flipped.push(p.id); } return { flipped, count: flipped.length }; }
export function autoCancelStaleUserPrefsV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const r of _uprefsV2.values()) if (r.status === USER_PREF_LIFECYCLE_V2.PROPOSED && (t - r.startedAt) >= _uprefStuckMs) { r.status = USER_PREF_LIFECYCLE_V2.CANCELLED; r.updatedAt = t; if (!r.settledAt) r.settledAt = t; r.metadata.cancelReason = "auto-cancel-stale"; flipped.push(r.id); } return { flipped, count: flipped.length }; }
export function getUserProfileGovStatsV2() {
  const profilesByStatus = {}; for (const v of Object.values(USER_PROFILE_MATURITY_V2)) profilesByStatus[v] = 0; for (const p of _upsV2.values()) profilesByStatus[p.status]++;
  const prefsByStatus = {}; for (const v of Object.values(USER_PREF_LIFECYCLE_V2)) prefsByStatus[v] = 0; for (const r of _uprefsV2.values()) prefsByStatus[r.status]++;
  return { totalUserProfilesV2: _upsV2.size, totalUserPrefsV2: _uprefsV2.size, maxActiveUserProfilesPerOwner: _upMaxActivePerOwner, maxPendingUserPrefsPerProfile: _upMaxPendingPrefsPerProfile, userProfileIdleMs: _upIdleMs, userPrefStuckMs: _uprefStuckMs, profilesByStatus, prefsByStatus };
}
