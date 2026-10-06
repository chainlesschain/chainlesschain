"use strict";

// Monitoring authorization is process-local and established only by completed
// login handlers. Loading a default DID does not establish a login session.
let getDid = () => null;
let getUKeyManager = () => null;
let generation = 0;
let session = null;
let watchedManager = null;
const attempts = new WeakSet();
const revocationEvents = [
  "locked",
  "device-disconnected",
  "device-not-found",
  "driver-changed",
  "closed",
];

function clearProjectGoalAuth(mode = null) {
  generation++;
  if (mode === null || session?.mode === mode) session = null;
}

function revokeUKey() {
  clearProjectGoalAuth("ukey");
}

function detachManager() {
  for (const event of revocationEvents)
    watchedManager?.removeListener?.(event, revokeUKey);
  watchedManager = null;
}

function currentManager() {
  let manager = null;
  try {
    manager = getUKeyManager() ?? null;
  } catch {}
  if (manager !== watchedManager) {
    revokeUKey();
    detachManager();
    watchedManager = manager;
    for (const event of revocationEvents)
      watchedManager?.on?.(event, revokeUKey);
  }
  return manager;
}

function currentDid() {
  try {
    const did = getDid();
    return typeof did === "string" && did.startsWith("did:") ? did : null;
  } catch {
    return null;
  }
}

function configureProjectGoalAuth(options = {}) {
  disposeProjectGoalAuth();
  if (
    typeof options.getDid !== "function" ||
    typeof options.getUKeyManager !== "function"
  )
    throw new TypeError("Project goal authentication requires host providers");
  getDid = options.getDid;
  getUKeyManager = options.getUKeyManager;
  currentManager();
}

function beginProjectGoalAuthentication() {
  const manager = currentManager();
  const attempt = Object.freeze({
    generation: ++generation,
    did: currentDid(),
    manager,
    driver: manager?.currentDriver ?? null,
  });
  attempts.add(attempt);
  return attempt;
}

function authenticate(mode, manager, attempt) {
  if (!attempt || !attempts.has(attempt)) return false;
  attempts.delete(attempt);
  const current = currentManager();
  if (
    attempt.generation !== generation ||
    attempt.did === null ||
    attempt.did !== currentDid()
  )
    return false;
  if (mode === "ukey") {
    try {
      if (
        !manager ||
        manager !== current ||
        manager !== attempt.manager ||
        !attempt.driver ||
        manager.currentDriver !== attempt.driver ||
        manager.isUnlocked() !== true
      )
        return false;
    } catch {
      return false;
    }
  }
  generation++;
  session = {
    mode,
    did: attempt.did,
    manager: mode === "ukey" ? manager : null,
    driver: mode === "ukey" ? attempt.driver : null,
  };
  return true;
}

function authenticateProjectGoalPassword(attempt) {
  return authenticate("password", null, attempt);
}

function authenticateProjectGoalUKey(manager, attempt) {
  return authenticate("ukey", manager, attempt);
}

function getProjectGoalActor() {
  const manager = currentManager();
  if (!session) return null;
  if (currentDid() !== session.did) {
    clearProjectGoalAuth();
    return null;
  }
  if (session.mode === "ukey") {
    try {
      if (
        manager !== session.manager ||
        manager?.currentDriver !== session.driver ||
        manager?.isUnlocked() !== true
      ) {
        revokeUKey();
        return null;
      }
    } catch {
      revokeUKey();
      return null;
    }
  }
  return session.did;
}

function disposeProjectGoalAuth() {
  clearProjectGoalAuth();
  detachManager();
  getDid = () => null;
  getUKeyManager = () => null;
}

module.exports = {
  configureProjectGoalAuth,
  getProjectGoalActor,
  beginProjectGoalAuthentication,
  authenticateProjectGoalPassword,
  authenticateProjectGoalUKey,
  clearProjectGoalAuth,
  disposeProjectGoalAuth,
};
