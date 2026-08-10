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
  LINUX_CHILD_RUNTIME_PATH,
  resolveChildRuntimePath,
  successfulChildReport,
};
