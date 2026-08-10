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

function detachedChildSpawnStdio(platform, reportDescriptor) {
  if (platform !== "linux") {
    return Object.freeze(["ignore", "pipe", "ignore"]);
  }
  if (!Number.isSafeInteger(reportDescriptor) || reportDescriptor < 3) {
    throw new Error(
      "Linux detached child requires a private report descriptor",
    );
  }
  // The Linux capsule's network seccomp policy intentionally rejects
  // socketpair(2). libuv implements UV_CREATE_PIPE with a socketpair on Unix,
  // so inherit a pre-opened private tmpfs file instead. This keeps the network
  // boundary intact while still carrying the child's setsid evidence.
  return Object.freeze(["ignore", reportDescriptor, "ignore"]);
}

function completeChildReportLine(value) {
  if (typeof value !== "string" && !Buffer.isBuffer(value)) {
    throw new Error("MCP capsule child report frame must be bytes or text");
  }
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : value;
  const newline = text.indexOf("\n");
  if (newline < 0) return null;
  if (newline !== text.length - 1) {
    throw new Error("MCP capsule child report contains trailing bytes");
  }
  return text.slice(0, newline);
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
  completeChildReportLine,
  detachedChildSpawnStdio,
  LINUX_CHILD_RUNTIME_PATH,
  resolveChildRuntimePath,
  successfulChildReport,
};
