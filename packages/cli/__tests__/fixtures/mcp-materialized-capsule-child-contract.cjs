"use strict";

const LINUX_CHILD_RUNTIME_PATH = "/opt/chainless/runtime/node";

function resolveChildRuntimePath(
  platform = process.platform,
  execPath = process.execPath,
) {
  // The Broker mounts its pinned runtime descriptor at this fixed read-only
  // path inside the Linux capsule. Never fall back to process.execPath: the
  // initial /proc/self/fd/N launcher is consumed, while /proc/self/exe is not
  // an executable proof path in every hosted bubblewrap environment.
  return platform === "linux" ? LINUX_CHILD_RUNTIME_PATH : execPath;
}

function detachedChildSpawnIdentityOptions(platform, uid, gid) {
  if (platform !== "linux") return Object.freeze({});
  if (
    !Number.isSafeInteger(uid) ||
    uid < 0 ||
    !Number.isSafeInteger(gid) ||
    gid < 0
  ) {
    throw new Error("Linux detached child requires the current uid and gid");
  }
  // libuv's Linux POSIX_SPAWN_SETSID path can return EPERM inside the nested
  // PID/user namespaces created by bubblewrap. Supplying the unchanged
  // identity selects libuv's fork/exec path without changing privileges; the
  // child report and live test independently prove that setsid still created
  // a new process group and session.
  return Object.freeze({ uid, gid });
}

function successfulChildReport(report, spawnedPid) {
  const payload =
    report && typeof report === "object" && !Array.isArray(report)
      ? report
      : {};
  if (
    !Number.isSafeInteger(spawnedPid) ||
    spawnedPid <= 0 ||
    payload.namespacePid !== spawnedPid
  ) {
    throw new Error("MCP capsule child report PID does not match its spawn");
  }
  // These fields are trusted parent-envelope evidence. A child payload must
  // not turn a successful report into a synthetic denial (or vice versa).
  return {
    ...payload,
    namespacePid: spawnedPid,
    spawnPid: spawnedPid,
    spawnDenied: false,
    reportReceived: true,
    detachedRequested: true,
  };
}

module.exports = {
  detachedChildSpawnIdentityOptions,
  LINUX_CHILD_RUNTIME_PATH,
  resolveChildRuntimePath,
  successfulChildReport,
};
