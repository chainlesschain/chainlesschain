"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const vscode = require("vscode");

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
];

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

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

async function waitForBridgeLock(profileHome, workspaceDir, timeoutMs) {
  const lockDir = path.join(profileHome, ".chainlesschain", "ide");
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
          ? lock.workspaceFolders.map(normalizeForCompare)
          : [];
        if (
          lock.ide === "vscode" &&
          Number.isInteger(lock.port) &&
          lock.port > 0 &&
          workspaces.includes(normalizeForCompare(workspaceDir))
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
}) {
  assert.ok(phase, "missing CHAINLESSCHAIN_HOST_JOURNEY_PHASE");
  assert.match(phase, /^(?:initial|restart)$/);
  assert.ok(readyFile, "missing CHAINLESSCHAIN_HOST_READY_FILE");
  assert.ok(resultFile, "missing CHAINLESSCHAIN_HOST_RESULT_FILE");
  await withTimeout(
    vscode.commands.executeCommand(
      "workbench.view.extension.chainlesschainIde",
    ),
    15_000,
    "ChainlessChain activity view reveal",
  );
  await withTimeout(
    vscode.commands.executeCommand("chainlesschainIdeChat.focus"),
    15_000,
    "ChainlessChain chat webview focus",
  );
  writeSignal(readyFile, {
    phase,
    extensionPath: fs.realpathSync(extensionPath),
    workspaceDir: fs.realpathSync(workspaceDir),
    readyAt: new Date().toISOString(),
  });
  await waitForJourneyResult(resultFile, phase, 135_000);
}

async function run() {
  const extensionsDir = process.env.CHAINLESSCHAIN_SMOKE_EXTENSIONS_DIR;
  const expectedVersion = process.env.CHAINLESSCHAIN_SMOKE_EXPECTED_VERSION;
  const workspaceDir = process.env.CHAINLESSCHAIN_SMOKE_WORKSPACE;
  const profileHome = process.env.HOME || process.env.USERPROFILE;
  const journeyPhase = process.env.CHAINLESSCHAIN_HOST_JOURNEY_PHASE;
  const readyFile = process.env.CHAINLESSCHAIN_HOST_READY_FILE;
  const resultFile = process.env.CHAINLESSCHAIN_HOST_RESULT_FILE;
  assert.ok(extensionsDir, "missing CHAINLESSCHAIN_SMOKE_EXTENSIONS_DIR");
  assert.ok(expectedVersion, "missing CHAINLESSCHAIN_SMOKE_EXPECTED_VERSION");
  assert.ok(workspaceDir, "missing CHAINLESSCHAIN_SMOKE_WORKSPACE");
  assert.ok(profileHome, "missing isolated profile home");
  console.log(`[extension-host-smoke] ${journeyPhase}: driver entered`);

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

  console.log(`[extension-host-smoke] ${journeyPhase}: activating VSIX`);
  await withTimeout(
    Promise.resolve().then(() => extension.activate()),
    30_000,
    `${EXTENSION_ID} activation`,
  );
  assert.equal(extension.isActive, true, "extension did not become active");
  console.log(`[extension-host-smoke] ${journeyPhase}: VSIX activated`);

  if (journeyPhase === "restart") {
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

  // activate() starts the bridge asynchronously, so wait for its production
  // discovery artifact and then prove the advertised localhost port is live.
  // Windows may need a cold PowerShell start to apply and independently verify
  // the owner-only bridge-token ACL. The production publisher is asynchronous
  // and fail-closed with its own 30s deadline; leave enough outer-test margin
  // to capture that diagnostic instead of terminating the Extension Host first.
  const lock = await waitForBridgeLock(profileHome, workspaceDir, 45_000);
  assert.match(lock.token, /^[a-f0-9]{64}$/, "bridge token is malformed");
  await assertPortListening(lock.port);
  console.log(`[extension-host-smoke] ${journeyPhase}: bridge verified`);

  // Open the production-contributed view through VS Code's real workbench
  // command. The external CDP peer then queries and clicks the actual Webview
  // DOM; this driver exposes no production test command or extension internals.
  await revealChatAndWaitForDomJourney({
    phase: journeyPhase,
    readyFile,
    resultFile,
    extensionPath: extension.extensionPath,
    workspaceDir,
  });

  console.log(
    `[extension-host-smoke] activated installed ${EXTENSION_ID}@${expectedVersion}; ` +
      `${REQUIRED_COMMANDS.length} commands, bridge port, and ${journeyPhase} real-DOM phase verified`,
  );
}

module.exports = { run };
