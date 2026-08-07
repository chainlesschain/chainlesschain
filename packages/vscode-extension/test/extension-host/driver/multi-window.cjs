"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const MULTI_WINDOW_EVIDENCE_VERSION = 1;

function buildCompanionLaunchArgs({
  userDataDir,
  extensionsDir,
  companionWorkspace,
}) {
  return [
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    "--new-window",
    "--disable-extension-update-checks",
    "--disable-telemetry",
    "--disable-crash-reporter",
    "--disable-workspace-trust",
    companionWorkspace,
  ];
}

function buildCompanionLaunchEnvironment(source = process.env) {
  const env = { ...source };
  // Extension Hosts run their Electron executable as Node. Clear that mode
  // so the child is the desktop client again, but retain VSCODE_IPC_HOOK so
  // --new-window reaches this exact isolated main process and profile.
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function launchCompanionWindow({
  vscodeExecutablePath,
  userDataDir,
  extensionsDir,
  companionWorkspace,
  spawn = childProcess.spawn,
}) {
  const child = spawn(
    vscodeExecutablePath,
    buildCompanionLaunchArgs({
      userDataDir,
      extensionsDir,
      companionWorkspace,
    }),
    {
      env: buildCompanionLaunchEnvironment(),
      stdio: "ignore",
      windowsHide: true,
    },
  );
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function normalizeForCompare(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function canonicalWorkspacePath(value) {
  return normalizeForCompare(fs.realpathSync(value));
}

function workspaceDigest(workspaceFolders) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(workspaceFolders.map(canonicalWorkspacePath)))
    .digest("hex");
}

function normalizedLockWorkspaces(lock) {
  if (!Array.isArray(lock?.workspaceFolders)) return [];
  try {
    return lock.workspaceFolders.map(canonicalWorkspacePath);
  } catch {
    return [];
  }
}

function readBridgeLocks(profileHome) {
  const lockDir = path.join(profileHome, ".chainlesschain", "ide");
  let names;
  try {
    names = fs.readdirSync(lockDir);
  } catch {
    return [];
  }
  const locks = [];
  for (const name of names.filter((value) => value.endsWith(".json")).sort()) {
    try {
      const lock = JSON.parse(
        fs.readFileSync(path.join(lockDir, name), "utf8"),
      );
      if (
        lock?.ide === "vscode" &&
        Number.isInteger(lock.port) &&
        lock.port > 0 &&
        Number.isInteger(lock.pid) &&
        lock.pid > 0 &&
        typeof lock.token === "string" &&
        /^[a-f0-9]{64}$/u.test(lock.token)
      ) {
        locks.push(lock);
      }
    } catch {
      // A publisher may be between temp-file write and atomic rename. Ignore
      // any unrelated malformed/stale row and continue waiting for both exact
      // workspace identities below.
    }
  }
  return locks;
}

function selectMultiWindowLocks(locks, primaryFolders, companionFolders) {
  const expectedPrimary = primaryFolders.map(canonicalWorkspacePath);
  const expectedCompanion = companionFolders.map(canonicalWorkspacePath);
  const matches = (lock, expected) => {
    const actual = normalizedLockWorkspaces(lock);
    return (
      actual.length === expected.length &&
      actual.every(
        (workspaceFolder, index) => workspaceFolder === expected[index],
      )
    );
  };
  const primary = locks.find((lock) => matches(lock, expectedPrimary)) || null;
  const companion =
    locks.find(
      (lock) =>
        lock !== primary &&
        lock.port !== primary?.port &&
        matches(lock, expectedCompanion),
    ) || null;
  return { primary, companion };
}

async function waitForMultiWindowLocks({
  profileHome,
  primaryFolders,
  companionFolders,
  timeoutMs = 60_000,
}) {
  const deadline = Date.now() + timeoutMs;
  let latest = { primary: null, companion: null };
  while (Date.now() < deadline) {
    latest = selectMultiWindowLocks(
      readBridgeLocks(profileHome),
      primaryFolders,
      companionFolders,
    );
    if (latest.primary && latest.companion) return latest;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `two live VS Code bridge locks did not appear within ${timeoutMs}ms ` +
      `(primary=${Boolean(latest.primary)}, companion=${Boolean(latest.companion)})`,
  );
}

function assertPortListening(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`bridge port ${port} did not accept a connection`));
    }, 3_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function writeEvidence(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  assert.equal(
    fs.existsSync(filePath),
    false,
    `refusing to reuse stale multi-window evidence ${filePath}`,
  );
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  fs.renameSync(temporary, filePath);
}

async function runMultiWindowJourney({
  vscodeExecutablePath,
  userDataDir,
  extensionsDir,
  profileHome,
  primaryFolders,
  companionWorkspace,
  evidenceFile,
  launchCompanion = launchCompanionWindow,
}) {
  assert.ok(vscodeExecutablePath, "VS Code executable path is unavailable");
  assert.ok(userDataDir, "VS Code user-data directory is unavailable");
  assert.ok(extensionsDir, "VS Code extensions directory is unavailable");
  const companionFolders = [companionWorkspace];
  assert.equal(
    primaryFolders.some(
      (workspaceFolder) =>
        normalizeForCompare(workspaceFolder) ===
        normalizeForCompare(companionWorkspace),
    ),
    false,
    "companion workspace must be distinct from every primary root",
  );

  await launchCompanion({
    vscodeExecutablePath,
    userDataDir,
    extensionsDir,
    companionWorkspace,
  });
  const { primary, companion } = await waitForMultiWindowLocks({
    profileHome,
    primaryFolders,
    companionFolders,
  });
  assert.notEqual(
    primary.port,
    companion.port,
    "window bridge ports must differ",
  );
  assert.notEqual(
    primary.pid,
    companion.pid,
    "window Extension Host PIDs must differ",
  );
  assert.notEqual(
    primary.token,
    companion.token,
    "window bridge tokens must differ",
  );
  await Promise.all([
    assertPortListening(primary.port),
    assertPortListening(companion.port),
  ]);

  const evidence = Object.freeze({
    version: MULTI_WINDOW_EVIDENCE_VERSION,
    result: "passed",
    observedAt: new Date().toISOString(),
    primary: Object.freeze({
      port: primary.port,
      pid: primary.pid,
      workspaceDigest: workspaceDigest(primaryFolders),
      rootCount: primaryFolders.length,
    }),
    companion: Object.freeze({
      port: companion.port,
      pid: companion.pid,
      workspaceDigest: workspaceDigest(companionFolders),
      rootCount: companionFolders.length,
    }),
    simultaneousListening: true,
    distinctBridgeTokens: true,
  });
  writeEvidence(evidenceFile, evidence);
  return evidence;
}

module.exports = {
  MULTI_WINDOW_EVIDENCE_VERSION,
  buildCompanionLaunchArgs,
  buildCompanionLaunchEnvironment,
  launchCompanionWindow,
  readBridgeLocks,
  runMultiWindowJourney,
  selectMultiWindowLocks,
  waitForMultiWindowLocks,
  workspaceDigest,
};
