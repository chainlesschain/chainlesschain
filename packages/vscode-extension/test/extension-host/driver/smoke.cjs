"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const vscode = require("vscode");
const {
  CHAT_VIEW_FOCUS_COMMAND,
  activateMacHostWindow,
  requestChatViewForDomJourney,
  withTimeout,
} = require("./view-control.cjs");
const { runDomRelayJourney } = require("./dom-relay-journey.cjs");
const { runMultiWindowJourney } = require("./multi-window.cjs");

const EXTENSION_ID = "chainlesschain.chainlesschain-ide";
const REQUIRED_COMMANDS = [
  "chainlesschain.ide.showStatus",
  "chainlesschain.cli.installManaged",
  "chainlesschain.chat.newConversation",
  "chainlesschain.diff.accept",
  "chainlesschain.diff.reject",
  "chainlesschain.plan.approve",
  "chainlesschain.plan.requestChanges",
  "chainlesschain.plan.regenerate",
  "chainlesschain.plan.reject",
  "chainlesschain.preview.start",
  "chainlesschain.preview.stop",
  "chainlesschain.sessions.workbench",
  "chainlesschain.session.prStatus",
  "chainlesschain.background.agents",
  "chainlesschain.remote.control",
  "chainlesschain.remote.doctor",
  CHAT_VIEW_FOCUS_COMMAND,
];

function normalizeForCompare(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertPathInside(child, parent) {
  const relative = path.relative(
    normalizeForCompare(parent),
    normalizeForCompare(child),
  );
  assert.ok(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    `expected installed extension path ${child} to be inside ${parent}`,
  );
}

function readExpectedWorkspaceFolders(rawValue, primaryWorkspaceDir) {
  let workspaceFolders;
  try {
    workspaceFolders = JSON.parse(rawValue || "");
  } catch (error) {
    throw new Error(
      "CHAINLESSCHAIN_SMOKE_WORKSPACE_FOLDERS is not valid JSON",
      {
        cause: error,
      },
    );
  }
  assert.ok(
    Array.isArray(workspaceFolders) && workspaceFolders.length === 2,
    "real host journey requires exactly two workspace roots",
  );
  const normalized = workspaceFolders.map((workspaceFolder) => {
    assert.equal(
      typeof workspaceFolder,
      "string",
      "workspace root must be a path string",
    );
    return normalizeForCompare(fs.realpathSync(workspaceFolder));
  });
  assert.equal(
    new Set(normalized).size,
    normalized.length,
    "multi-root journey workspace roots must be distinct",
  );
  assert.equal(
    normalized[0],
    normalizeForCompare(fs.realpathSync(primaryWorkspaceDir)),
    "primary workspace must be the first multi-root folder",
  );
  return workspaceFolders;
}

function assertOpenedWorkspaceFolders(expectedWorkspaceFolders) {
  const actual = (vscode.workspace.workspaceFolders || []).map((folder) =>
    normalizeForCompare(fs.realpathSync(folder.uri.fsPath)),
  );
  const expected = expectedWorkspaceFolders.map((workspaceFolder) =>
    normalizeForCompare(fs.realpathSync(workspaceFolder)),
  );
  assert.deepEqual(
    actual,
    expected,
    "VS Code did not open the exact ordered multi-root workspace",
  );
}

function isCompanionWindow(companionWorkspace) {
  if (!companionWorkspace) return false;
  const actual = (vscode.workspace.workspaceFolders || []).map((folder) =>
    normalizeForCompare(fs.realpathSync(folder.uri.fsPath)),
  );
  return (
    actual.length === 1 &&
    actual[0] === normalizeForCompare(fs.realpathSync(companionWorkspace))
  );
}

async function dismissFreshInstallReloadPrompt() {
  // Every host phase uses a brand-new profile, so no retained Webview can
  // exist. Dismiss the production first-seen-version notification before the
  // visible local/CI desktop can accidentally choose its Reload action and
  // terminate the extension-test contract mid-journey.
  await new Promise((resolve) => setTimeout(resolve, 250));
  await vscode.commands.executeCommand("notifications.clearAll");
}

async function runCompanionWindow({
  extensionsDir,
  expectedVersion,
  profileHome,
  companionWorkspace,
}) {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(
    extension,
    `installed extension ${EXTENSION_ID} was not discovered in companion window`,
  );
  assertPathInside(
    fs.realpathSync(extension.extensionPath),
    fs.realpathSync(extensionsDir),
  );
  assert.equal(extension.packageJSON.version, expectedVersion);
  await withTimeout(
    Promise.resolve().then(() => extension.activate()),
    30_000,
    `${EXTENSION_ID} companion activation`,
  );
  await dismissFreshInstallReloadPrompt();
  const lock = await waitForBridgeLock(
    profileHome,
    [companionWorkspace],
    45_000,
  );
  await assertPortListening(lock.port);
  console.log(
    `[extension-host-smoke] companion: installed VSIX bridge verified on ${lock.port}`,
  );
  // The extension-test path is inherited by every new VS Code window. Only
  // the primary window may settle the process-wide test result; remain alive
  // until its successful completion closes the isolated desktop instance.
  await new Promise(() => {});
}

async function waitForBridgeLock(
  profileHome,
  expectedWorkspaceFolders,
  timeoutMs,
) {
  const lockDir = path.join(profileHome, ".chainlesschain", "ide");
  const expected = expectedWorkspaceFolders.map((workspaceFolder) =>
    normalizeForCompare(fs.realpathSync(workspaceFolder)),
  );
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const files = fs
        .readdirSync(lockDir)
        .filter((name) => name.endsWith(".json"));
      for (const name of files) {
        const lock = JSON.parse(
          fs.readFileSync(path.join(lockDir, name), "utf8"),
        );
        const workspaces = Array.isArray(lock.workspaceFolders)
          ? lock.workspaceFolders.map((workspaceFolder) =>
              normalizeForCompare(fs.realpathSync(workspaceFolder)),
            )
          : [];
        if (
          lock.ide === "vscode" &&
          Number.isInteger(lock.port) &&
          lock.port > 0 &&
          workspaces.length === expected.length &&
          workspaces.every(
            (workspaceFolder, index) => workspaceFolder === expected[index],
          )
        ) {
          return lock;
        }
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `bridge lockfile did not appear in ${lockDir} within ${timeoutMs}ms`,
    { cause: lastError },
  );
}

function assertPortListening(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`bridge port ${port} did not accept a connection`));
    }, 3000);
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

async function resumeFixtureSessionAfterHostRestart() {
  const statePath = process.env.CC_UI_FIXTURE_STATE;
  assert.ok(statePath, "missing CC_UI_FIXTURE_STATE for restart journey");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const resumable = Object.entries(state?.sessions || {})
    .filter(
      ([sessionId, messageCount]) =>
        typeof sessionId === "string" &&
        sessionId.length > 0 &&
        Number(messageCount) >= 10,
    )
    .sort((left, right) => Number(right[1]) - Number(left[1]));
  assert.ok(resumable.length > 0, "fixture has no completed session to resume");

  // VS Code extension-test windows intentionally use in-memory application
  // storage, so workspaceState cannot cross the two real IDE processes. Route
  // the saved fixture id through the extension's production deep-link handler;
  // this still exercises a fresh host, production resume wiring, and the real
  // CLI --resume protocol without adding a test-only extension command.
  const deepLink = vscode.Uri.parse(
    `vscode://${EXTENSION_ID}/open?session=${encodeURIComponent(resumable[0][0])}`,
  );
  await withTimeout(
    vscode.commands.executeCommand("vscode.open", deepLink),
    15_000,
    "ChainlessChain resume deep link",
  );
}

function writeSignal(filePath, value) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  assert.equal(
    fs.existsSync(filePath),
    false,
    `refusing to reuse stale journey signal ${filePath}`,
  );
  const temporary = path.join(
    parent,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  fs.renameSync(temporary, filePath);
}

function appendHostTrace(traceFile, phase, stage, details = {}) {
  assert.ok(traceFile, "missing CHAINLESSCHAIN_HOST_TRACE_FILE");
  assert.match(phase, /^(?:initial|restart)$/);
  assert.match(stage, /^[a-z][a-z0-9-]*$/);
  fs.mkdirSync(path.dirname(traceFile), { recursive: true, mode: 0o700 });
  fs.appendFileSync(
    traceFile,
    `${JSON.stringify({
      phase,
      stage,
      at: new Date().toISOString(),
      ...details,
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

async function waitForJourneyResult(resultFile, phase, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.statSync(resultFile, { throwIfNoEntry: false })?.isFile()) {
      let result;
      try {
        result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
      } catch (error) {
        throw new Error(`CDP journey result is malformed: ${resultFile}`, {
          cause: error,
        });
      }
      assert.equal(result.phase, phase, "CDP journey phase mismatch");
      assert.equal(
        result.ok,
        true,
        `CDP journey failed: ${String(result.error || "unknown failure")}`,
      );
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `CDP journey result did not appear within ${timeoutMs}ms: ${resultFile}`,
  );
}

async function revealChatAndWaitForDomJourney({
  phase,
  readyFile,
  resultFile,
  extensionPath,
  workspaceDir,
  workspaceFolders,
}) {
  assert.ok(phase, "missing CHAINLESSCHAIN_HOST_JOURNEY_PHASE");
  assert.match(phase, /^(?:initial|restart)$/);
  assert.ok(readyFile, "missing CHAINLESSCHAIN_HOST_READY_FILE");
  assert.ok(resultFile, "missing CHAINLESSCHAIN_HOST_RESULT_FILE");
  await requestChatViewForDomJourney({
    commands: vscode.commands,
    log: (message) =>
      console.log(`[extension-host-smoke] ${phase}: ${message}`),
  });
  writeSignal(readyFile, {
    phase,
    extensionPath: fs.realpathSync(extensionPath),
    workspaceDir: fs.realpathSync(workspaceDir),
    workspaceFolders: workspaceFolders.map((workspaceFolder) =>
      fs.realpathSync(workspaceFolder),
    ),
    readyAt: new Date().toISOString(),
  });
  await waitForJourneyResult(resultFile, phase, 135_000);
}

async function revealChatForHostApiJourney({
  phase,
  readyFile,
  resultFile,
  traceFile,
  extensionPath,
  workspaceDir,
  workspaceFolders,
}) {
  assert.ok(phase, "missing CHAINLESSCHAIN_HOST_JOURNEY_PHASE");
  assert.match(phase, /^(?:initial|restart)$/);
  assert.ok(readyFile, "missing CHAINLESSCHAIN_HOST_READY_FILE");
  assert.ok(resultFile, "missing CHAINLESSCHAIN_HOST_RESULT_FILE");
  await requestChatViewForDomJourney({
    commands: vscode.commands,
    log: (message) =>
      console.log(`[extension-host-smoke] ${phase}: ${message}`),
  });
  appendHostTrace(traceFile, phase, "view-command-dispatched");
  writeSignal(readyFile, {
    phase,
    mode: "host-api",
    extensionPath: fs.realpathSync(extensionPath),
    workspaceDir: fs.realpathSync(workspaceDir),
    workspaceFolders: workspaceFolders.map((workspaceFolder) =>
      fs.realpathSync(workspaceFolder),
    ),
    readyAt: new Date().toISOString(),
  });
  writeSignal(resultFile, {
    ok: true,
    phase,
    mode: "host-api",
    completedAt: new Date().toISOString(),
  });
  appendHostTrace(traceFile, phase, "phase-completed");
}

async function revealChatAndRunDomRelayJourney({
  phase,
  readyFile,
  resultFile,
  traceFile,
  artifactDir,
  token,
  extensionPath,
  workspaceDir,
  workspaceFolders,
  workspaceTarget,
}) {
  await activateMacHostWindow({
    workspaceTarget,
    log: (message) =>
      console.log(`[extension-host-smoke] ${phase}: ${message}`),
  });
  await requestChatViewForDomJourney({
    commands: vscode.commands,
    waitForFocus: true,
    log: (message) =>
      console.log(`[extension-host-smoke] ${phase}: ${message}`),
  });
  await runDomRelayJourney({
    commands: vscode.commands,
    token,
    phase,
    readyFile,
    resultFile,
    traceFile,
    artifactDir,
    extensionPath,
    workspaceDir,
    workspaceFolders,
  });
}

async function run() {
  const extensionsDir = process.env.CHAINLESSCHAIN_SMOKE_EXTENSIONS_DIR;
  const expectedVersion = process.env.CHAINLESSCHAIN_SMOKE_EXPECTED_VERSION;
  const workspaceDir = process.env.CHAINLESSCHAIN_SMOKE_WORKSPACE;
  const workspaceFoldersJson =
    process.env.CHAINLESSCHAIN_SMOKE_WORKSPACE_FOLDERS;
  const workspaceTarget = process.env.CHAINLESSCHAIN_SMOKE_WORKSPACE_TARGET;
  const profileHome = process.env.HOME || process.env.USERPROFILE;
  const journeyPhase = process.env.CHAINLESSCHAIN_HOST_JOURNEY_PHASE;
  const journeyMode = process.env.CHAINLESSCHAIN_HOST_JOURNEY_MODE || "dom";
  const readyFile = process.env.CHAINLESSCHAIN_HOST_READY_FILE;
  const resultFile = process.env.CHAINLESSCHAIN_HOST_RESULT_FILE;
  const traceFile = process.env.CHAINLESSCHAIN_HOST_TRACE_FILE;
  const artifactDir = process.env.CHAINLESSCHAIN_HOST_ARTIFACT_DIR;
  const hostDomToken = process.env.CHAINLESSCHAIN_HOST_DOM_TOKEN;
  const companionWorkspace =
    process.env.CHAINLESSCHAIN_SMOKE_COMPANION_WORKSPACE;
  const multiWindowEvidenceFile =
    process.env.CHAINLESSCHAIN_MULTI_WINDOW_EVIDENCE_FILE;
  const vscodeExecutablePath =
    process.env.CHAINLESSCHAIN_SMOKE_VSCODE_EXECUTABLE;
  const userDataDir = process.env.CHAINLESSCHAIN_SMOKE_USER_DATA_DIR;
  assert.ok(extensionsDir, "missing CHAINLESSCHAIN_SMOKE_EXTENSIONS_DIR");
  assert.ok(expectedVersion, "missing CHAINLESSCHAIN_SMOKE_EXPECTED_VERSION");
  assert.ok(workspaceDir, "missing CHAINLESSCHAIN_SMOKE_WORKSPACE");
  assert.ok(
    workspaceFoldersJson,
    "missing CHAINLESSCHAIN_SMOKE_WORKSPACE_FOLDERS",
  );
  assert.ok(workspaceTarget, "missing CHAINLESSCHAIN_SMOKE_WORKSPACE_TARGET");
  assert.ok(profileHome, "missing isolated profile home");
  const workspaceFolders = readExpectedWorkspaceFolders(
    workspaceFoldersJson,
    workspaceDir,
  );
  assert.match(journeyMode, /^(?:dom|dom-relay|host-api)$/);
  if (journeyMode === "host-api" || journeyMode === "dom-relay") {
    assert.ok(traceFile, "missing CHAINLESSCHAIN_HOST_TRACE_FILE");
  }
  if (journeyMode === "dom-relay") {
    assert.ok(artifactDir, "missing CHAINLESSCHAIN_HOST_ARTIFACT_DIR");
    assert.match(
      hostDomToken || "",
      /^[a-f0-9]{64}$/u,
      "missing or malformed CHAINLESSCHAIN_HOST_DOM_TOKEN",
    );
  }
  console.log(`[extension-host-smoke] ${journeyPhase}: driver entered`);
  if (journeyPhase === "initial" && isCompanionWindow(companionWorkspace)) {
    return runCompanionWindow({
      extensionsDir,
      expectedVersion,
      profileHome,
      companionWorkspace,
    });
  }
  assertOpenedWorkspaceFolders(workspaceFolders);
  console.log(
    `[extension-host-smoke] ${journeyPhase}: ${workspaceFolders.length} workspace roots verified`,
  );

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(
    extension,
    `installed extension ${EXTENSION_ID} was not discovered`,
  );
  assertPathInside(
    fs.realpathSync(extension.extensionPath),
    fs.realpathSync(extensionsDir),
  );
  assert.equal(
    extension.packageJSON.version,
    expectedVersion,
    "the installed VSIX version differs from package.json",
  );
  console.log(
    `[extension-host-smoke] ${journeyPhase}: installed VSIX discovered`,
  );
  if (journeyMode !== "dom") {
    appendHostTrace(traceFile, journeyPhase, "installed-vsix-discovered", {
      extensionVersion: extension.packageJSON.version,
    });
  }

  console.log(`[extension-host-smoke] ${journeyPhase}: activating VSIX`);
  await withTimeout(
    Promise.resolve().then(() => extension.activate()),
    30_000,
    `${EXTENSION_ID} activation`,
  );
  assert.equal(extension.isActive, true, "extension did not become active");
  await dismissFreshInstallReloadPrompt();
  console.log(`[extension-host-smoke] ${journeyPhase}: VSIX activated`);
  if (journeyMode !== "dom") {
    appendHostTrace(traceFile, journeyPhase, "vsix-activated");
  }

  if (journeyMode !== "host-api" && journeyPhase === "restart") {
    await resumeFixtureSessionAfterHostRestart();
  }

  const commands = new Set(await vscode.commands.getCommands(true));
  const missingCommands = REQUIRED_COMMANDS.filter(
    (command) => !commands.has(command),
  );
  assert.deepEqual(
    missingCommands,
    [],
    `activated extension is missing commands: ${missingCommands.join(", ")}`,
  );
  if (journeyMode !== "dom") {
    appendHostTrace(traceFile, journeyPhase, "commands-verified", {
      commandCount: REQUIRED_COMMANDS.length,
    });
  }

  // activate() starts the bridge asynchronously, so wait for its production
  // discovery artifact and then prove the advertised localhost port is live.
  // Windows may need a cold PowerShell start to apply and independently verify
  // the owner-only bridge-token ACL. The production publisher is asynchronous
  // and fail-closed with its own 30s deadline; leave enough outer-test margin
  // to capture that diagnostic instead of terminating the Extension Host first.
  const lock = await waitForBridgeLock(profileHome, workspaceFolders, 45_000);
  assert.match(lock.token, /^[a-f0-9]{64}$/, "bridge token is malformed");
  await assertPortListening(lock.port);
  console.log(`[extension-host-smoke] ${journeyPhase}: bridge verified`);
  if (journeyMode !== "dom") {
    appendHostTrace(traceFile, journeyPhase, "bridge-verified");
  }

  if (journeyPhase === "initial") {
    assert.ok(
      companionWorkspace,
      "missing CHAINLESSCHAIN_SMOKE_COMPANION_WORKSPACE",
    );
    assert.ok(
      multiWindowEvidenceFile,
      "missing CHAINLESSCHAIN_MULTI_WINDOW_EVIDENCE_FILE",
    );
    await runMultiWindowJourney({
      vscodeExecutablePath,
      userDataDir,
      extensionsDir,
      profileHome,
      primaryFolders: workspaceFolders,
      companionWorkspace,
      evidenceFile: multiWindowEvidenceFile,
    });
    console.log(
      `[extension-host-smoke] ${journeyPhase}: simultaneous second window bridge verified`,
    );
    if (journeyMode !== "dom") {
      appendHostTrace(traceFile, journeyPhase, "multi-window-verified");
    }
  }

  // Open the production-contributed view through VS Code's real workbench
  // command. DOM mode hands off to the external CDP peer for actual Webview
  // interaction. Host-API mode ends at the production command boundary and
  // labels its evidence accordingly; neither path exposes extension internals.
  if (journeyMode === "host-api") {
    await revealChatForHostApiJourney({
      phase: journeyPhase,
      readyFile,
      resultFile,
      traceFile,
      extensionPath: extension.extensionPath,
      workspaceDir,
      workspaceFolders,
    });
  } else if (journeyMode === "dom-relay") {
    await revealChatAndRunDomRelayJourney({
      phase: journeyPhase,
      readyFile,
      resultFile,
      traceFile,
      artifactDir,
      token: hostDomToken,
      extensionPath: extension.extensionPath,
      workspaceDir,
      workspaceFolders,
      workspaceTarget,
    });
  } else {
    await revealChatAndWaitForDomJourney({
      phase: journeyPhase,
      readyFile,
      resultFile,
      extensionPath: extension.extensionPath,
      workspaceDir,
      workspaceFolders,
    });
  }

  console.log(
    `[extension-host-smoke] activated installed ${EXTENSION_ID}@${expectedVersion}; ` +
      `${REQUIRED_COMMANDS.length} commands, bridge port, and ${journeyPhase} ${journeyMode} phase verified`,
  );
}

let runPromise;

function runOnce() {
  if (!runPromise) runPromise = run();
  return runPromise;
}

module.exports = { run: runOnce };
