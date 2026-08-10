"use strict";

const LINUX_CHILD_RUNTIME_PATH = "/proc/self/exe";

function resolveChildRuntimePath(
  platform = process.platform,
  execPath = process.execPath,
) {
  // The Linux capsule runtime is launched through a consumed descriptor such
  // as /proc/self/fd/3. Re-executing that stale path reports ENOENT even though
  // process creation is allowed. /proc/self/exe is the kernel-bound identity
  // of the currently running runtime and remains executable after fd 3 closes.
  return platform === "linux" ? LINUX_CHILD_RUNTIME_PATH : execPath;
}

function successfulChildReport(report) {
  const payload =
    report && typeof report === "object" && !Array.isArray(report)
      ? report
      : {};
  // These fields are trusted parent-envelope evidence. A child payload must
  // not turn a successful report into a synthetic denial (or vice versa).
  return {
    ...payload,
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
