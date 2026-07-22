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

async function run() {
  const extensionsDir = process.env.CHAINLESSCHAIN_SMOKE_EXTENSIONS_DIR;
  const expectedVersion = process.env.CHAINLESSCHAIN_SMOKE_EXPECTED_VERSION;
  const workspaceDir = process.env.CHAINLESSCHAIN_SMOKE_WORKSPACE;
  const profileHome = process.env.HOME || process.env.USERPROFILE;
  assert.ok(extensionsDir, "missing CHAINLESSCHAIN_SMOKE_EXTENSIONS_DIR");
  assert.ok(expectedVersion, "missing CHAINLESSCHAIN_SMOKE_EXPECTED_VERSION");
  assert.ok(workspaceDir, "missing CHAINLESSCHAIN_SMOKE_WORKSPACE");
  assert.ok(profileHome, "missing isolated profile home");

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `installed extension ${EXTENSION_ID} was not discovered`);
  assertPathInside(
    fs.realpathSync(extension.extensionPath),
    fs.realpathSync(extensionsDir),
  );
  assert.equal(
    extension.packageJSON.version,
    expectedVersion,
    "the installed VSIX version differs from package.json",
  );

  await withTimeout(
    Promise.resolve().then(() => extension.activate()),
    30_000,
    `${EXTENSION_ID} activation`,
  );
  assert.equal(extension.isActive, true, "extension did not become active");

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
  const lock = await waitForBridgeLock(profileHome, workspaceDir, 20_000);
  assert.match(lock.token, /^[a-f0-9]{64}$/, "bridge token is malformed");
  await assertPortListening(lock.port);

  console.log(
    `[extension-host-smoke] activated installed ${EXTENSION_ID}@${expectedVersion}; ` +
      `${REQUIRED_COMMANDS.length} commands and bridge port verified`,
  );
}

module.exports = { run };
