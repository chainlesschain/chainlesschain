#!/usr/bin/env node
"use strict";

/**
 * Install the packaged ChainlessChain VSIX into a brand-new VS Code profile,
 * then launch a real Electron Extension Host with a separate test-driver
 * extension. The driver proves that the loaded target came from the fresh
 * extensions directory (not --extensionDevelopmentPath), activates it, and
 * checks its command/bridge surface.
 *
 * @vscode/test-electron and ws are intentionally installed by CI with
 * --no-save --no-package-lock so this leaf package keeps its lockfile-free
 * packaging workflow. Local usage:
 *   npm install --no-save --no-package-lock @vscode/test-electron@3.1.0 ws@8.21.2
 *   npm run test:extension-host -- --vsix chainlesschain-ide.vsix
 */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { PassThrough } = require("node:stream");
const { pathToFileURL } = require("node:url");
const {
  CdpClient,
  assertHostReadySignal,
  assertJourneyArtifacts,
  createFixtureCli,
  createCdpPipeSocket,
  isExactIsoTimestamp,
  readJsonLines,
  readJourneyResult,
  reserveLoopbackPort,
  runCdpHostJourney,
  waitForFile,
} = require("./cdp-journey.cjs");
const { runElectronMainHostJourney } = require("./electron-main-journey.cjs");

const EXTENSION_ID = "chainlesschain.chainlesschain-ide";
const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
// One warmup plus 100 real Workbench DOM cycles can exceed three minutes on
// loaded macOS runners. Keep the per-sample 2s P95 gate strict, but allow the
// complete evidence set to finish inside the workflow's 15-minute step limit.
const HOST_DOM_RELAY_RESULT_TIMEOUT_MS = 600_000;

function defaultVsixPath() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
  );
  const versioned = path.join(
    PACKAGE_ROOT,
    `chainlesschain-ide-${manifest.version}.vsix`,
  );
  return fs.existsSync(versioned)
    ? versioned
    : path.join(PACKAGE_ROOT, "chainlesschain-ide.vsix");
}

function usage() {
  return [
    "Usage: node test/extension-host/run.cjs [options]",
    "",
    "Options:",
    "  --vsix <path>              Packaged VSIX (default: current versioned VSIX, then chainlesschain-ide.vsix)",
    "  --vscode-version <value>   stable, insiders, or an exact version (default: stable)",
    "  --work-dir <path>          Parent for fresh profiles and diagnostic logs",
    "  --artifact-dir <path>      Immutable journey evidence output directory",
    "  --release-commit <sha>     Exact source commit represented by the evidence",
    "  --host-api-only            Diagnostic activation/view check without DOM authority",
    "  --help                     Show this help",
  ].join("\n");
}

function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    vsix: defaultVsixPath(),
    vscodeVersion: "stable",
    workDir: null,
    artifactDir: null,
    releaseCommit: null,
    hostApiOnly: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--vsix") {
      options.vsix = takeValue(argv, i, arg);
      i += 1;
    } else if (arg === "--vscode-version") {
      options.vscodeVersion = takeValue(argv, i, arg);
      i += 1;
    } else if (arg === "--work-dir") {
      options.workDir = takeValue(argv, i, arg);
      i += 1;
    } else if (arg === "--artifact-dir") {
      options.artifactDir = takeValue(argv, i, arg);
      i += 1;
    } else if (arg === "--release-commit") {
      options.releaseCommit = takeValue(argv, i, arg);
      i += 1;
    } else if (arg === "--host-api-only") {
      options.hostApiOnly = true;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return options;
}

function requireTestElectron() {
  try {
    return require("@vscode/test-electron");
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") {
      throw new Error(
        "@vscode/test-electron is required. Run " +
          "`npm install --no-save --no-package-lock @vscode/test-electron@3.1.0` first.",
        { cause: error },
      );
    }
    throw error;
  }
}

const TRANSIENT_NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

function isTransientNetworkError(error, seen = new Set()) {
  if (!error || (typeof error !== "object" && typeof error !== "function")) {
    return false;
  }
  if (seen.has(error)) return false;
  seen.add(error);
  if (TRANSIENT_NETWORK_ERROR_CODES.has(error.code)) return true;
  if (isTransientNetworkError(error.cause, seen)) return true;
  if (Array.isArray(error.errors)) {
    return error.errors.some((entry) => isTransientNetworkError(entry, seen));
  }
  return false;
}

async function retryTransientNetworkOperation(
  operation,
  {
    label,
    attempts = 3,
    wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  },
) {
  assert.ok(typeof operation === "function", "operation must be a function");
  assert.ok(label, "retry label is required");
  assert.ok(
    Number.isInteger(attempts) && attempts > 0,
    "attempts must be positive",
  );
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === attempts || !isTransientNetworkError(error)) throw error;
      const delayMs = attempt * 5_000;
      process.stderr.write(
        `[extension-host-smoke] transient network failure during ${label}; retrying in ${delayMs}ms (${attempt}/${attempts})\n`,
      );
      await wait(delayMs);
    }
  }
  throw new Error(`unreachable retry state for ${label}`);
}

function makeFreshRunRoot(parent) {
  // VS Code places its macOS main-process Unix socket below --user-data-dir.
  // The Darwin sockaddr_un path limit is 103 bytes, while os.tmpdir() expands
  // to a long /var/folders/... path on GitHub-hosted runners. Keep both the
  // default base and the unique directory name deliberately short.
  const defaultBase = process.platform === "darwin" ? "/tmp" : os.tmpdir();
  const base = path.resolve(parent || defaultBase);
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, "ccv-"));
}

function buildProfileArgs({ runRoot, extensionsDir, phase }) {
  if (!/^(?:install|initial|multi-window|restart)$/.test(phase)) {
    throw new Error(`unknown host profile phase: ${phase}`);
  }
  return [
    `--extensions-dir=${extensionsDir}`,
    `--user-data-dir=${path.join(runRoot, `user-data-${phase}`)}`,
  ];
}

function resolveHostJourneyTransport(hostApiMode) {
  return hostApiMode
    ? {
        useDomRelay: false,
        evidenceTransport: "local-ide-bridge+vscode-extension-test-api",
      }
    : {
        useDomRelay: true,
        evidenceTransport: "local-ide-bridge+vscode-webview-message-dom",
      };
}

function createHostProgressJournal(artifactDir) {
  const progressPath = path.join(
    path.dirname(artifactDir),
    `${path.basename(artifactDir)}.progress.jsonl`,
  );
  fs.mkdirSync(path.dirname(progressPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(progressPath, "", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return progressPath;
}

function recordHostProgress(progressPath, stage, details = {}) {
  if (!/^[a-z][a-z0-9_]*$/.test(stage)) {
    throw new Error(`invalid host progress stage: ${stage}`);
  }
  fs.appendFileSync(
    progressPath,
    `${JSON.stringify({ ...details, stage, at: new Date().toISOString() })}\n`,
    "utf8",
  );
}

function hostWorkspaceSettings(fixtureCliCommand) {
  return {
    "chainlesschain.ide.enabled": true,
    "chainlesschain.cli.managed.enabled": false,
    "chainlesschain.cli.path": fixtureCliCommand,
    "extensions.autoCheckUpdates": false,
    "extensions.autoUpdate": false,
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
  };
}

function writeMultiRootWorkspace(runRoot, fixtureCliCommand) {
  const workspaceFolders = [
    path.join(runRoot, "workspace-primary"),
    path.join(runRoot, "workspace-secondary"),
  ];
  for (const [index, workspaceFolder] of workspaceFolders.entries()) {
    fs.mkdirSync(workspaceFolder, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceFolder, index === 0 ? "hello.txt" : "secondary.txt"),
      `ChainlessChain Extension Host multi-root workspace ${index + 1}\n`,
      "utf8",
    );
  }

  const workspaceTarget = path.join(runRoot, "chainlesschain.code-workspace");
  fs.writeFileSync(
    workspaceTarget,
    `${JSON.stringify(
      {
        folders: workspaceFolders.map((workspaceFolder, index) => ({
          name: index === 0 ? "primary" : "secondary",
          path: path.relative(runRoot, workspaceFolder),
        })),
        // Keep activation deterministic and offline. The managed-CLI command
        // still has to be registered; only its asynchronous startup probe is
        // disabled. Workspace-file settings make the same contract apply to
        // both roots instead of relying on the first folder's local settings.
        settings: hostWorkspaceSettings(fixtureCliCommand),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return {
    workspaceDir: workspaceFolders[0],
    workspaceFolders,
    workspaceTarget,
  };
}

function writeCompanionWorkspace(runRoot, fixtureCliCommand) {
  const workspaceDir = path.join(runRoot, "workspace-companion");
  const settingsDir = path.join(workspaceDir, ".vscode");
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "companion.txt"),
    "ChainlessChain Extension Host companion window\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(settingsDir, "settings.json"),
    `${JSON.stringify(hostWorkspaceSettings(fixtureCliCommand), null, 2)}\n`,
    "utf8",
  );
  return workspaceDir;
}

function assertMultiWindowEvidence(filePath) {
  const evidence = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const exactKeys = (value, expected, label) => {
    const actual = Object.keys(value || {}).sort();
    assert.deepEqual(
      actual,
      [...expected].sort(),
      `${label} contains sensitive or unknown fields`,
    );
  };
  exactKeys(
    evidence,
    [
      "version",
      "result",
      "observedAt",
      "primary",
      "companion",
      "simultaneousListening",
      "distinctBridgeTokens",
    ],
    "multi-window evidence",
  );
  if (
    evidence?.version !== 1 ||
    evidence?.result !== "passed" ||
    evidence?.simultaneousListening !== true ||
    evidence?.distinctBridgeTokens !== true ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(
      evidence?.observedAt || "",
    )
  ) {
    throw new Error("multi-window evidence header is invalid");
  }
  for (const label of ["primary", "companion"]) {
    const row = evidence[label];
    exactKeys(
      row,
      ["port", "pid", "rootCount", "workspaceDigest"],
      `multi-window ${label} identity`,
    );
    if (
      !Number.isInteger(row?.port) ||
      row.port < 1 ||
      !Number.isInteger(row?.pid) ||
      row.pid < 1 ||
      !Number.isInteger(row?.rootCount) ||
      row.rootCount < 1 ||
      !/^[a-f0-9]{64}$/u.test(row?.workspaceDigest || "")
    ) {
      throw new Error(`multi-window ${label} identity is invalid`);
    }
  }
  if (
    evidence.primary.port === evidence.companion.port ||
    evidence.primary.pid === evidence.companion.pid ||
    evidence.primary.workspaceDigest === evidence.companion.workspaceDigest
  ) {
    throw new Error("multi-window identities are not distinct");
  }
  return evidence;
}

function hostPhaseSignalPaths(runtimeDir, phase) {
  if (!/^(?:initial|restart)$/.test(phase)) {
    throw new Error(`unknown host journey phase: ${phase}`);
  }
  return {
    readyFile: path.join(runtimeDir, `${phase}-host-ready.json`),
    resultFile: path.join(runtimeDir, `${phase}-cdp-result.json`),
  };
}

function buildHostLaunchArgs({ workspaceDir, profileArgs, cdpPort }) {
  if (!Number.isInteger(cdpPort) || cdpPort < 1 || cdpPort > 65_535) {
    throw new Error(`invalid CDP port: ${cdpPort}`);
  }
  return [
    ...profileArgs,
    `--remote-debugging-port=${cdpPort}`,
    "--remote-debugging-address=127.0.0.1",
    // Match the explicit Origin emitted by the pinned `ws` client. Both the
    // debugging socket and allowed Origin are scoped to this run's random
    // loopback-only port in a fresh test profile.
    `--remote-allow-origins=http://127.0.0.1:${cdpPort}`,
    "--disable-extension-update-checks",
    "--disable-telemetry",
    "--disable-crash-reporter",
    // Keep the positional workspace after every host switch. Some Electron /
    // VS Code launch paths stop interpreting Chromium switches once a
    // positional argument has been consumed.
    workspaceDir,
  ];
}

function buildHostInspectorLaunchArgs({
  workspaceDir,
  profileArgs,
  inspectorPort,
}) {
  if (
    !Number.isInteger(inspectorPort) ||
    inspectorPort < 1 ||
    inspectorPort > 65_535
  ) {
    throw new Error(`invalid Electron inspector port: ${inspectorPort}`);
  }
  return [
    ...profileArgs,
    `--inspect=127.0.0.1:${inspectorPort}`,
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-extension-update-checks",
    "--disable-telemetry",
    "--disable-crash-reporter",
    workspaceDir,
  ];
}

function buildHostApiLaunchArgs({ workspaceDir, profileArgs }) {
  return [
    ...profileArgs,
    // Keep isolated automation hosts away from the login Keychain. On fresh
    // macOS ARM64 runners, stable VS Code can otherwise open its main window
    // but never activate the extension-test driver while waiting on the
    // system secret-storage prompt.
    "--use-inmemory-secretstorage",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-extension-update-checks",
    "--disable-telemetry",
    "--disable-crash-reporter",
    workspaceDir,
  ];
}

function buildExternalCompanionHostLaunchArgs({ workspaceDir, profileArgs }) {
  let userDataArgumentCount = 0;
  const companionProfileArgs = profileArgs.map((argument) => {
    if (!argument.startsWith("--user-data-dir=")) return argument;
    userDataArgumentCount += 1;
    return `${argument}-companion`;
  });
  if (userDataArgumentCount !== 1) {
    throw new Error(
      "external companion profile requires exactly one user-data directory",
    );
  }
  const launchArgs = buildHostApiLaunchArgs({
    workspaceDir,
    profileArgs: companionProfileArgs,
  });
  launchArgs.splice(-1, 0, "--new-window");
  return launchArgs;
}

function buildHostDomRelayLaunchArgs({ workspaceDir, profileArgs }) {
  return [
    ...profileArgs,
    // Retain renderer/service-worker diagnostics for current Electron builds.
    // GPU remains enabled because disabling it can stall stable VS Code before
    // either the target extension or the test driver reaches activation.
    "--verbose",
    // VS Code's own automation launcher uses this switch for isolated tests.
    // A fresh macOS runner has no user secrets to validate, and allowing the
    // current host to reach Keychain can stall its renderer before Webviews
    // are created.
    "--use-inmemory-secretstorage",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-extension-update-checks",
    "--disable-telemetry",
    "--disable-crash-reporter",
    workspaceDir,
  ];
}

function buildHostPipeLaunchArgs({ workspaceDir, profileArgs }) {
  return [
    ...profileArgs,
    "--remote-debugging-pipe",
    "--disable-extension-update-checks",
    "--disable-telemetry",
    "--disable-crash-reporter",
    workspaceDir,
  ];
}

function buildExtensionTestLaunchArgs({
  launchArgs,
  extensionDevelopmentPath,
  extensionTestsPath,
}) {
  return [
    ...launchArgs,
    "--no-sandbox",
    "--disable-gpu-sandbox",
    "--disable-updates",
    "--skip-welcome",
    "--skip-release-notes",
    "--no-cached-data",
    "--disable-workspace-trust",
    `--extensionTestsPath=${extensionTestsPath}`,
    `--extensionDevelopmentPath=${extensionDevelopmentPath}`,
  ];
}

function launchExtensionHostWithCdpPipe({
  vscodeExecutablePath,
  launchArgs,
  extensionDevelopmentPath,
  extensionTestsPath,
  extensionTestsEnv,
  stdout = process.stdout,
  stderr = process.stderr,
  spawnProcess = spawn,
}) {
  const child = spawnProcess(
    vscodeExecutablePath,
    buildExtensionTestLaunchArgs({
      launchArgs,
      extensionDevelopmentPath,
      extensionTestsPath,
    }),
    {
      env: { ...process.env, ...extensionTestsEnv },
      shell: false,
      // Chromium's --remote-debugging-pipe contract reads commands on FD 3
      // and writes NUL-delimited responses on FD 4.
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (chunk) => stdout.write(chunk));
  child.stderr?.on("data", (chunk) => stderr.write(chunk));
  const pipeWrite = child.stdio?.[3];
  const pipeRead = child.stdio?.[4];
  if (!pipeWrite || !pipeRead) {
    child.kill("SIGKILL");
    throw new Error("VS Code host did not expose CDP pipe FDs 3 and 4");
  }

  const outcome = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve(code);
      else {
        reject(
          new Error(
            `VS Code pipe host failed (code=${String(code)}, signal=${String(signal)})`,
          ),
        );
      }
    });
  });
  let stopRequests = 0;
  return {
    browserClient: new CdpClient(createCdpPipeSocket(pipeWrite, pipeRead)),
    outcome,
    requestStop() {
      stopRequests += 1;
      child.kill(stopRequests === 1 ? "SIGINT" : "SIGKILL");
    },
  };
}

function launchManagedExtensionHost({
  vscodeExecutablePath,
  launchArgs,
  extensionDevelopmentPath,
  extensionTestsPath,
  extensionTestsEnv,
  stdout = process.stdout,
  stderr = process.stderr,
  spawnProcess = spawn,
}) {
  const child = spawnProcess(
    vscodeExecutablePath,
    buildExtensionTestLaunchArgs({
      launchArgs,
      extensionDevelopmentPath,
      extensionTestsPath,
    }),
    {
      env: { ...process.env, ...extensionTestsEnv },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (chunk) => stdout.write(chunk));
  child.stderr?.on("data", (chunk) => stderr.write(chunk));
  const outcome = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve(code);
      else {
        reject(
          new Error(
            `VS Code managed host failed (code=${String(code)}, signal=${String(signal)})`,
          ),
        );
      }
    });
  });
  let stopRequests = 0;
  return {
    outcome,
    requestStop() {
      stopRequests += 1;
      child.kill(stopRequests === 1 ? "SIGINT" : "SIGKILL");
    },
  };
}

function parseDevToolsBrowserEndpoint(value, expectedPort) {
  if (
    !Number.isInteger(expectedPort) ||
    expectedPort < 1 ||
    expectedPort > 65_535
  ) {
    throw new Error(`invalid CDP port: ${expectedPort}`);
  }
  const input = String(value || "");
  const matches = input.matchAll(/DevTools listening on (ws:\/\/\S+)/g);
  for (const match of matches) {
    try {
      const endpoint = new URL(match[1]);
      const loopbackHost = ["127.0.0.1", "[::1]", "::1"].includes(
        endpoint.hostname,
      );
      if (
        endpoint.protocol === "ws:" &&
        loopbackHost &&
        Number(endpoint.port) === expectedPort &&
        endpoint.username === "" &&
        endpoint.password === "" &&
        endpoint.search === "" &&
        endpoint.hash === "" &&
        /^\/devtools\/browser\/[^/]+$/.test(endpoint.pathname)
      ) {
        return endpoint.href;
      }
    } catch {
      // Ignore unrelated or partially-written stderr lines.
    }
  }
  return null;
}

function parseElectronInspectorEndpoint(value, expectedPort) {
  if (
    !Number.isInteger(expectedPort) ||
    expectedPort < 1 ||
    expectedPort > 65_535
  ) {
    throw new Error(`invalid Electron inspector port: ${expectedPort}`);
  }
  const input = String(value || "");
  const matches = input.matchAll(/Debugger listening on (ws:\/\/\S+)/g);
  for (const match of matches) {
    try {
      const endpoint = new URL(match[1]);
      const loopbackHost = ["127.0.0.1", "[::1]", "::1"].includes(
        endpoint.hostname,
      );
      if (
        endpoint.protocol === "ws:" &&
        loopbackHost &&
        Number(endpoint.port) === expectedPort &&
        endpoint.username === "" &&
        endpoint.password === "" &&
        endpoint.search === "" &&
        endpoint.hash === "" &&
        /^\/[0-9a-f-]{16,}$/iu.test(endpoint.pathname)
      ) {
        return endpoint.href;
      }
    } catch {
      // Ignore unrelated or partially-written stderr lines.
    }
  }
  return null;
}

function createDevToolsEndpointCapture(expectedPort, output = process.stderr) {
  let buffered = "";
  let endpoint = null;
  const stderr = new PassThrough();
  stderr.on("data", (chunk) => {
    const text = Buffer.isBuffer(chunk)
      ? chunk.toString("utf8")
      : String(chunk);
    output.write(chunk);
    if (!endpoint) {
      buffered = `${buffered}${text}`.slice(-8_192);
      endpoint = parseDevToolsBrowserEndpoint(buffered, expectedPort);
    }
  });
  return {
    getEndpoint: () => endpoint,
    stderr,
  };
}

function createElectronInspectorEndpointCapture(
  expectedPort,
  output = process.stderr,
) {
  let buffered = "";
  let endpoint = null;
  const stderr = new PassThrough();
  stderr.on("data", (chunk) => {
    const text = Buffer.isBuffer(chunk)
      ? chunk.toString("utf8")
      : String(chunk);
    output.write(chunk);
    if (!endpoint) {
      buffered = `${buffered}${text}`.slice(-8_192);
      endpoint = parseElectronInspectorEndpoint(buffered, expectedPort);
    }
  });
  return {
    getEndpoint: () => endpoint,
    stderr,
  };
}

function waitForOutcome(promise, timeoutMs) {
  const timedOut = Symbol("timed-out");
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(timedOut), timeoutMs);
    }),
  ]).then((value) => {
    clearTimeout(timer);
    return value === timedOut ? null : value;
  });
}

async function settleHostAfterCdp({
  hostOutcome,
  phase,
  graceMs = 5_000,
  forceGraceMs = 15_000,
  emitSigint = () => process.emit("SIGINT"),
  journeyLabel = "CDP journey",
}) {
  let host = await waitForOutcome(hostOutcome, graceMs);
  if (host) return { host, managedTermination: false };

  process.stdout.write(
    `[extension-host-smoke] ${phase}: ${journeyLabel} settled; requesting host shutdown\n`,
  );
  emitSigint();
  host = await waitForOutcome(hostOutcome, graceMs);
  if (host) return { host, managedTermination: true };

  process.stderr.write(
    `[extension-host-smoke] ${phase}: host ignored graceful shutdown; terminating its process tree\n`,
  );
  emitSigint();
  host = await waitForOutcome(hostOutcome, forceGraceMs);
  if (!host) {
    throw new Error(
      `VS Code host did not exit after managed shutdown during ${phase}`,
    );
  }
  return { host, managedTermination: true };
}

async function stopManagedHostAfterActivationFailure({
  launched,
  phase,
  graceMs = 5_000,
  forceGraceMs = 15_000,
}) {
  const hostOutcome = launched.outcome.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  launched.requestStop();
  let host = await waitForOutcome(hostOutcome, graceMs);
  if (host !== null) return host;

  process.stderr.write(
    `[extension-host-smoke] ${phase}: activation-ready host ignored graceful shutdown; terminating its process tree\n`,
  );
  launched.requestStop();
  host = await waitForOutcome(hostOutcome, forceGraceMs);
  if (host === null) {
    throw new Error(
      `VS Code host did not exit after activation-ready failure during ${phase}`,
    );
  }
  return host;
}

async function runRealDomPhase({
  runTests,
  vscodeExecutablePath,
  workspaceDir,
  workspaceFolders,
  workspaceTarget,
  profileArgs,
  extensionsDir,
  profileHome,
  expectedVersion,
  phase,
  runtimeDir,
  journeyArtifactDir,
  fixture,
  useCdpPipe = false,
  useElectronMainInspector = false,
  useDomRelay = false,
}) {
  const launchTarget = workspaceTarget || workspaceDir;
  const expectedWorkspaceFolders = workspaceFolders || [workspaceDir];
  if (
    [useCdpPipe, useElectronMainInspector, useDomRelay].filter(Boolean).length >
    1
  ) {
    throw new Error("host DOM transports are mutually exclusive");
  }
  const { readyFile, resultFile } = hostPhaseSignalPaths(runtimeDir, phase);
  if (useDomRelay) {
    fs.mkdirSync(journeyArtifactDir, { recursive: true, mode: 0o700 });
    const hostDomToken = crypto.randomBytes(32).toString("hex");
    // A valid one-launch token lets the installed target invoke the test-only
    // driver's fixed contributed command after target activation returns. The
    // same transport is used on every release OS so Webview prompts are driven
    // in their real main world instead of relying on Chromium's unstable OOPIF
    // dialog ownership. No debugger transport is opened: every DOM action and
    // result crosses the token-gated Extension Host/Webview message relay.
    const sigintGuard = () => {};
    process.on("SIGINT", sigintGuard);
    let host;
    let relay;
    let managedTermination = false;
    try {
      const hostOutcome = Promise.resolve()
        .then(() =>
          runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath: path.join(__dirname, "driver"),
            extensionTestsPath: path.join(__dirname, "driver", "smoke.cjs"),
            launchArgs: buildHostDomRelayLaunchArgs({
              workspaceDir: launchTarget,
              profileArgs,
            }),
            extensionTestsEnv: {
              HOME: profileHome,
              USERPROFILE: profileHome,
              CHAINLESSCHAIN_SMOKE_EXTENSIONS_DIR: extensionsDir,
              CHAINLESSCHAIN_SMOKE_EXPECTED_VERSION: expectedVersion,
              CHAINLESSCHAIN_SMOKE_WORKSPACE: workspaceDir,
              CHAINLESSCHAIN_SMOKE_WORKSPACE_FOLDERS: JSON.stringify(
                expectedWorkspaceFolders,
              ),
              CHAINLESSCHAIN_HOST_JOURNEY_PHASE: phase,
              CHAINLESSCHAIN_HOST_JOURNEY_MODE: "dom-relay",
              CHAINLESSCHAIN_HOST_READY_FILE: readyFile,
              CHAINLESSCHAIN_HOST_RESULT_FILE: resultFile,
              CHAINLESSCHAIN_HOST_TRACE_FILE: path.join(
                journeyArtifactDir,
                "cdp-journey.jsonl",
              ),
              CHAINLESSCHAIN_HOST_ARTIFACT_DIR: journeyArtifactDir,
              CHAINLESSCHAIN_HOST_DOM_TOKEN: hostDomToken,
              CC_UI_FIXTURE_STATE: fixture.statePath,
              CC_UI_FIXTURE_TRACE: fixture.tracePath,
            },
          }),
        )
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      const relayOutcome = waitForFile(
        resultFile,
        HOST_DOM_RELAY_RESULT_TIMEOUT_MS,
      )
        .then(() => readJourneyResult(resultFile, phase))
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      const first = await Promise.race([
        hostOutcome.then((outcome) => ({ source: "host", outcome })),
        relayOutcome.then((outcome) => ({ source: "relay", outcome })),
      ]);
      if (first.source === "host") {
        host = first.outcome;
        relay = await relayOutcome;
      } else {
        relay = first.outcome;
        ({ host, managedTermination } = await settleHostAfterCdp({
          hostOutcome,
          phase,
          journeyLabel: "DOM relay journey",
        }));
      }
    } finally {
      process.removeListener("SIGINT", sigintGuard);
    }

    const hostError =
      managedTermination && !relay.error ? null : host && host.error;
    if (hostError && relay.error) {
      throw new AggregateError(
        [hostError, relay.error],
        `VS Code host and DOM relay journey failed during ${phase}: host=${String(
          hostError.message || hostError,
        )}; journey=${String(relay.error.message || relay.error)}`,
      );
    }
    if (hostError) throw hostError;
    if (relay.error) throw relay.error;
    return relay.value;
  }
  const inspectorPort = useElectronMainInspector
    ? await reserveLoopbackPort()
    : null;
  const cdpPort =
    useCdpPipe || useElectronMainInspector ? null : await reserveLoopbackPort();
  // Both Chromium CDP and Electron's Node inspector print their authoritative
  // endpoint before the Extension Host becomes ready. Capture only the exact
  // loopback URL allocated for this fresh host while teeing stderr to CI.
  const endpointCapture = useCdpPipe
    ? null
    : useElectronMainInspector
      ? createElectronInspectorEndpointCapture(inspectorPort)
      : createDevToolsEndpointCapture(cdpPort);
  const extensionDevelopmentPath = path.join(__dirname, "driver");
  const extensionTestsPath = path.join(__dirname, "driver", "smoke.cjs");
  const extensionTestsEnv = {
    HOME: profileHome,
    USERPROFILE: profileHome,
    CHAINLESSCHAIN_SMOKE_EXTENSIONS_DIR: extensionsDir,
    CHAINLESSCHAIN_SMOKE_EXPECTED_VERSION: expectedVersion,
    CHAINLESSCHAIN_SMOKE_WORKSPACE: workspaceDir,
    CHAINLESSCHAIN_SMOKE_WORKSPACE_FOLDERS: JSON.stringify(
      expectedWorkspaceFolders,
    ),
    CHAINLESSCHAIN_HOST_JOURNEY_PHASE: phase,
    CHAINLESSCHAIN_HOST_READY_FILE: readyFile,
    CHAINLESSCHAIN_HOST_RESULT_FILE: resultFile,
    CC_UI_FIXTURE_STATE: fixture.statePath,
    CC_UI_FIXTURE_TRACE: fixture.tracePath,
  };
  const pipeHost = useCdpPipe
    ? launchExtensionHostWithCdpPipe({
        vscodeExecutablePath,
        launchArgs: buildHostPipeLaunchArgs({
          workspaceDir: launchTarget,
          profileArgs,
        }),
        extensionDevelopmentPath,
        extensionTestsPath,
        extensionTestsEnv,
      })
    : null;
  const abortController = new AbortController();
  const journeyPromise = useElectronMainInspector
    ? runElectronMainHostJourney({
        getInspectorWebSocketUrl: endpointCapture?.getEndpoint,
        readyFile,
        resultFile,
        phase,
        artifactDir: journeyArtifactDir,
        signal: abortController.signal,
      })
    : runCdpHostJourney({
        port: cdpPort,
        getBrowserWebSocketUrl: endpointCapture?.getEndpoint,
        browserClient: pipeHost?.browserClient,
        readyFile,
        resultFile,
        phase,
        artifactDir: journeyArtifactDir,
        signal: abortController.signal,
      });
  const cdpOutcome = journeyPromise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  // @vscode/test-electron exposes cancellation through its SIGINT handlers.
  // Keep one outer listener installed so its managed shutdown path does not
  // call process.exit() before this runner can persist diagnostics/evidence.
  const sigintGuard = () => {};
  process.on("SIGINT", sigintGuard);
  let host;
  let cdp;
  let managedTermination = false;
  try {
    const hostPromise = pipeHost
      ? pipeHost.outcome
      : Promise.resolve().then(() =>
          runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath,
            stderr: endpointCapture.stderr,
            launchArgs: useElectronMainInspector
              ? buildHostInspectorLaunchArgs({
                  workspaceDir: launchTarget,
                  profileArgs,
                  inspectorPort,
                })
              : buildHostLaunchArgs({
                  workspaceDir: launchTarget,
                  profileArgs,
                  cdpPort,
                }),
            extensionTestsEnv,
          }),
        );
    const hostOutcome = hostPromise.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    const first = await Promise.race([
      hostOutcome.then((outcome) => ({ source: "host", outcome })),
      cdpOutcome.then((outcome) => ({ source: "cdp", outcome })),
    ]);
    if (first.source === "host") {
      host = first.outcome;
      if (host.error) abortController.abort(host.error);
      cdp = await cdpOutcome;
    } else {
      cdp = first.outcome;
      ({ host, managedTermination } = await settleHostAfterCdp({
        hostOutcome,
        phase,
        ...(pipeHost ? { emitSigint: pipeHost.requestStop } : {}),
      }));
    }
  } finally {
    process.removeListener("SIGINT", sigintGuard);
  }

  const hostError =
    managedTermination && !cdp.error ? null : host && host.error;
  if (hostError && cdp.error && cdp.error.name !== "AbortError") {
    throw new AggregateError(
      [hostError, cdp.error],
      `VS Code host and DOM journey failed during ${phase}: host=${String(
        hostError.message || hostError,
      )}; journey=${String(cdp.error.message || cdp.error)}`,
    );
  }
  if (hostError) throw hostError;
  if (cdp.error) throw cdp.error;
  return readJourneyResult(resultFile, phase);
}

async function runHostApiPhase({
  runTests,
  vscodeExecutablePath,
  workspaceDir,
  workspaceFolders,
  workspaceTarget,
  profileArgs,
  extensionsDir,
  profileHome,
  expectedVersion,
  phase,
  runtimeDir,
  fixture,
  companionWorkspace,
  multiWindowEvidenceFile,
  progressPath,
  includeMultiWindow = false,
  platform = process.platform,
  launchManagedHost = launchManagedExtensionHost,
  primaryActivationTimeoutMs = 90_000,
  managedHostShutdownGraceMs = 5_000,
  managedHostForceGraceMs = 15_000,
}) {
  const launchTarget = workspaceTarget || workspaceDir;
  const expectedWorkspaceFolders = workspaceFolders || [workspaceDir];
  const userDataDir = profileArgs
    .find((argument) => argument.startsWith("--user-data-dir="))
    ?.slice("--user-data-dir=".length);
  if (!userDataDir) throw new Error("host profile has no user-data directory");
  const { readyFile, resultFile } = hostPhaseSignalPaths(runtimeDir, phase);
  const traceFile = path.join(runtimeDir, "host-api-trace.jsonl");
  const primaryActivationReadyFile = path.join(
    runtimeDir,
    "multi-window-primary-activation-ready.json",
  );
  const useExternalCompanion = includeMultiWindow && platform !== "win32";
  const launchOptions = {
    vscodeExecutablePath,
    extensionDevelopmentPath: path.join(__dirname, "driver"),
    extensionTestsPath: path.join(__dirname, "driver", "smoke.cjs"),
    launchArgs: buildHostApiLaunchArgs({
      workspaceDir: launchTarget,
      profileArgs,
    }),
    extensionTestsEnv: {
      HOME: profileHome,
      USERPROFILE: profileHome,
      CHAINLESSCHAIN_SMOKE_EXTENSIONS_DIR: extensionsDir,
      CHAINLESSCHAIN_SMOKE_EXPECTED_VERSION: expectedVersion,
      CHAINLESSCHAIN_SMOKE_WORKSPACE: workspaceDir,
      CHAINLESSCHAIN_SMOKE_WORKSPACE_FOLDERS: JSON.stringify(
        expectedWorkspaceFolders,
      ),
      CHAINLESSCHAIN_HOST_JOURNEY_PHASE: phase,
      CHAINLESSCHAIN_HOST_JOURNEY_MODE: "host-api",
      CHAINLESSCHAIN_HOST_READY_FILE: readyFile,
      CHAINLESSCHAIN_HOST_RESULT_FILE: resultFile,
      CHAINLESSCHAIN_HOST_TRACE_FILE: traceFile,
      CC_UI_FIXTURE_STATE: fixture.statePath,
      CC_UI_FIXTURE_TRACE: fixture.tracePath,
      ...(includeMultiWindow
        ? {
            CHAINLESSCHAIN_MULTI_WINDOW_REQUIRED: "1",
            CHAINLESSCHAIN_SMOKE_COMPANION_WORKSPACE: companionWorkspace,
            CHAINLESSCHAIN_MULTI_WINDOW_EVIDENCE_FILE: multiWindowEvidenceFile,
            CHAINLESSCHAIN_MULTI_WINDOW_PROGRESS_FILE: progressPath,
            CHAINLESSCHAIN_MULTI_WINDOW_PRIMARY_READY_FILE:
              primaryActivationReadyFile,
            CHAINLESSCHAIN_SMOKE_VSCODE_EXECUTABLE: vscodeExecutablePath,
            CHAINLESSCHAIN_SMOKE_USER_DATA_DIR: userDataDir,
            ...(useExternalCompanion
              ? { CHAINLESSCHAIN_MULTI_WINDOW_EXTERNAL_COMPANION: "1" }
              : {}),
          }
        : {}),
    },
  };
  if (useExternalCompanion) {
    const primaryAttempts = platform === "darwin" ? 2 : 1;
    let primaryHost = null;
    let activationError = null;
    for (let attempt = 1; attempt <= primaryAttempts; attempt += 1) {
      fs.rmSync(primaryActivationReadyFile, { force: true });
      const attemptLaunchOptions =
        attempt === 1
          ? launchOptions
          : {
              ...launchOptions,
              launchArgs: launchOptions.launchArgs.map((argument) =>
                argument.startsWith("--user-data-dir=")
                  ? `${argument}-activation-retry-${attempt}`
                  : argument,
              ),
              extensionTestsEnv: {
                ...launchOptions.extensionTestsEnv,
                CHAINLESSCHAIN_SMOKE_USER_DATA_DIR: `${userDataDir}-activation-retry-${attempt}`,
              },
            };
      recordHostProgress(
        progressPath,
        "multi_window_primary_launch_requested",
        {
          actor: "orchestrator",
          transport: "managed-extension-host",
          attempt,
        },
      );
      primaryHost = launchManagedHost(attemptLaunchOptions);
      recordHostProgress(
        progressPath,
        "multi_window_primary_launch_dispatched",
        {
          actor: "orchestrator",
          transport: "managed-extension-host",
          attempt,
        },
      );
      const readyAbort = new AbortController();
      const primaryReadyOutcome = waitForFile(
        primaryActivationReadyFile,
        primaryActivationTimeoutMs,
        readyAbort.signal,
      ).then(
        () => ({ source: "ready" }),
        (error) => ({ source: "ready", error }),
      );
      const primaryHostOutcome = primaryHost.outcome.then(
        (value) => ({ source: "host", value }),
        (error) => ({ source: "host", error }),
      );
      const firstPrimaryOutcome = await Promise.race([
        primaryReadyOutcome,
        primaryHostOutcome,
      ]);
      readyAbort.abort();
      if (
        !firstPrimaryOutcome.error &&
        firstPrimaryOutcome.source === "ready"
      ) {
        activationError = null;
        break;
      }

      activationError =
        firstPrimaryOutcome.error ||
        new Error(
          "primary VS Code host exited before its activation-ready signal",
        );
      await stopManagedHostAfterActivationFailure({
        launched: primaryHost,
        phase,
        graceMs: managedHostShutdownGraceMs,
        forceGraceMs: managedHostForceGraceMs,
      });
      if (attempt < primaryAttempts) {
        recordHostProgress(progressPath, "multi_window_primary_launch_retry", {
          actor: "orchestrator",
          transport: "managed-extension-host",
          attempt: attempt + 1,
          reason: "activation-ready-timeout-or-early-exit",
        });
      }
    }
    if (activationError) throw activationError;
    recordHostProgress(
      progressPath,
      "multi_window_primary_activation_ready_observed",
      { actor: "orchestrator", transport: "managed-extension-host" },
    );
    recordHostProgress(
      progressPath,
      "multi_window_companion_launch_requested",
      { actor: "orchestrator", transport: "managed-extension-host" },
    );
    const companionHost = launchManagedHost({
      ...launchOptions,
      launchArgs: buildExternalCompanionHostLaunchArgs({
        workspaceDir: companionWorkspace,
        profileArgs,
      }),
    });
    recordHostProgress(
      progressPath,
      "multi_window_companion_launch_dispatched",
      { actor: "orchestrator", transport: "managed-extension-host" },
    );
    const managedHosts = [
      { label: "primary", launched: primaryHost },
      { label: "companion", launched: companionHost },
    ];
    const journey = await waitForFile(resultFile, 135_000)
      .then(() => readJourneyResult(resultFile, phase))
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    const hosts = await Promise.all(
      managedHosts.map(async ({ label, launched }) => {
        const hostOutcome = launched.outcome.then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        const settled = await settleHostAfterCdp({
          hostOutcome,
          phase,
          emitSigint: launched.requestStop,
          journeyLabel: `host API multi-window ${label}`,
        });
        return { label, ...settled };
      }),
    );
    const hostErrors = hosts
      .filter(
        ({ host, managedTermination }) =>
          host?.error && !(managedTermination && !journey.error),
      )
      .map(
        ({ label, host }) =>
          new Error(`${label} VS Code host failed: ${host.error.message}`, {
            cause: host.error,
          }),
      );
    const errors = [...hostErrors, ...(journey.error ? [journey.error] : [])];
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        `VS Code managed hosts and multi-window journey failed during ${phase}`,
      );
    }
    if (errors.length === 1) throw errors[0];
    return journey.value;
  }
  await runTests(launchOptions);
  return readJourneyResult(resultFile, phase);
}

function assertHostApiArtifacts({
  runtimeDir,
  extensionsDir,
  workspaceDir,
  workspaceFolders,
  expectedVersion,
}) {
  const traceFile = path.join(runtimeDir, "host-api-trace.jsonl");
  const records = readJsonLines(traceFile);
  const results = [];
  for (const phase of ["initial", "restart"]) {
    const { readyFile, resultFile } = hostPhaseSignalPaths(runtimeDir, phase);
    const ready = assertHostReadySignal({
      readyFile,
      phase,
      extensionsDir,
      workspaceDir,
      workspaceFolders,
    });
    if (ready.mode !== "host-api") {
      throw new Error(`host API ready signal mode mismatch: ${phase}`);
    }
    const result = readJourneyResult(resultFile, phase);
    if (result.mode !== "host-api") {
      throw new Error(`host API result mode mismatch: ${phase}`);
    }
    if (!isExactIsoTimestamp(result.completedAt)) {
      throw new Error(`host API result has no exact timestamp: ${phase}`);
    }

    const phaseRecords = records.filter((record) => record.phase === phase);
    const requiredStages = [
      "installed-vsix-discovered",
      "vsix-activated",
      "commands-verified",
      "bridge-verified",
      ...(phase === "initial" ? ["multi-window-verified"] : []),
      "view-command-dispatched",
      "phase-completed",
    ];
    let previousIndex = -1;
    for (const stage of requiredStages) {
      const index = phaseRecords.findIndex((record) => record.stage === stage);
      if (index <= previousIndex) {
        throw new Error(
          `host API trace stage is missing or out of order: ${phase}/${stage}`,
        );
      }
      const record = phaseRecords[index];
      if (!isExactIsoTimestamp(record.at)) {
        throw new Error(
          `host API trace has no exact timestamp: ${phase}/${stage}`,
        );
      }
      previousIndex = index;
    }
    const discovered = phaseRecords.find(
      (record) => record.stage === "installed-vsix-discovered",
    );
    if (discovered.extensionVersion !== expectedVersion) {
      throw new Error(`host API trace extension version mismatch: ${phase}`);
    }
    results.push({ phase, ready, result });
  }
  return { traceFile, results };
}

function assertInstalled(listOutput, version) {
  const wanted = `${EXTENSION_ID}@${version}`.toLowerCase();
  const installed = listOutput
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  if (!installed.includes(wanted)) {
    throw new Error(
      `VSIX install verification failed: expected ${wanted}; got ${installed.join(", ") || "<empty>"}`,
    );
  }
}

function findDiagnosticLogs(runRoot) {
  const candidates = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(target);
      } else if (
        entry.isFile() &&
        (entry.name === "exthost.log" ||
          entry.name === "renderer.log" ||
          entry.name.endsWith("ChainlessChain IDE.log"))
      ) {
        candidates.push(target);
      }
    }
  }
  walk(runRoot);
  return candidates.sort();
}

function dumpFailureDiagnostics(runRoot) {
  const candidates = findDiagnosticLogs(runRoot);
  if (candidates.length === 0) {
    process.stderr.write(
      `[extension-host-smoke] no diagnostic logs found under ${runRoot}\n`,
    );
    return;
  }
  for (const file of candidates) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      process.stderr.write(
        `[extension-host-smoke] could not read ${file}: ${error.message}\n`,
      );
      continue;
    }
    // Keep CI output bounded while retaining the final activation/bridge error.
    const tail = text.slice(-16 * 1024);
    process.stderr.write(
      `\n[extension-host-smoke] diagnostic tail: ${file}\n${tail}\n`,
    );
  }
}

function readJsonVersion(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return typeof value.version === "string" &&
      /^\d+\.\d+(?:\.\d+)?/.test(value.version)
      ? value.version
      : null;
  } catch {
    return null;
  }
}

async function resolveVsCodeHostVersion(executablePath, requestedVersion) {
  let current = path.dirname(path.resolve(executablePath));
  for (let depth = 0; depth < 7; depth += 1) {
    for (const relative of [
      path.join("resources", "app", "package.json"),
      path.join("Resources", "app", "package.json"),
    ]) {
      const version = readJsonVersion(path.join(current, relative));
      if (version) return version;
    }
    // @vscode/test-electron resolves channels such as "stable" before
    // extraction and records the exact version in its install directory, e.g.
    // vscode-win32-x64-archive-1.131.0. Windows archive layouts do not always
    // expose resources/app/package.json next to the returned executable, so
    // use that immutable cache identity before falling back to the CLI probe.
    const directoryVersion = path
      .basename(current)
      .match(/(?:^|[-_])(\d+\.\d+\.\d+)(?:$|[-_])/u);
    if (directoryVersion) return directoryVersion[1];
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // Fallback: ask the executable itself (handles channel downloads like "stable")
  if (executablePath && fs.existsSync(executablePath)) {
    try {
      const { spawnSync } = require("child_process");
      const r = spawnSync(executablePath, ["--version"], {
        encoding: "utf8",
        timeout: 15_000,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      });
      const m = (r.stdout || "").match(/(\d+\.\d+\.\d+)/);
      if (m) return m[1];
    } catch {
      /* fall through */
    }
  }
  return /^\d+\.\d+(?:\.\d+)?/.test(String(requestedVersion || ""))
    ? requestedVersion
    : null;
}

async function writeJourneyEvidence(options) {
  const evidenceModule = path.resolve(
    PACKAGE_ROOT,
    "..",
    "..",
    "scripts",
    "ide-journey-evidence.mjs",
  );
  const { writeIdeJourneyEvidence } = await import(
    pathToFileURL(evidenceModule).href
  );
  return writeIdeJourneyEvidence(options);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const vsixPath = path.resolve(options.vsix);
  if (!fs.statSync(vsixPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`VSIX does not exist: ${vsixPath}`);
  }

  const extensionManifest = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
  );
  const expectedVersion = extensionManifest.version;
  const runRoot = makeFreshRunRoot(options.workDir);
  const extensionsDir = path.join(runRoot, "extensions");
  const profileHome = path.join(runRoot, "profile-home");
  const journeyRuntimeDir = path.join(runRoot, "journey-runtime");
  const journeyArtifactDir = path.join(runRoot, "journey-artifacts");
  const artifactDir = path.resolve(
    options.artifactDir || path.join(runRoot, "journey-evidence"),
  );
  const progressPath = createHostProgressJournal(artifactDir);
  const hostApiMode = options.hostApiOnly;
  const hostJourneyTransport = resolveHostJourneyTransport(hostApiMode);
  recordHostProgress(progressPath, "prepared");
  const startedAt = new Date().toISOString();
  const cliVersion = readJsonVersion(
    path.resolve(PACKAGE_ROOT, "..", "cli", "package.json"),
  );
  for (const dir of [extensionsDir, profileHome, journeyRuntimeDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const fixture = createFixtureCli(
    runRoot,
    path.resolve(PACKAGE_ROOT, "..", ".."),
  );
  const { workspaceDir, workspaceFolders, workspaceTarget } =
    writeMultiRootWorkspace(runRoot, fixture.command);
  const companionWorkspace = writeCompanionWorkspace(runRoot, fixture.command);
  const multiWindowEvidenceFile = path.join(
    journeyRuntimeDir,
    "multi-window-evidence.json",
  );

  process.stdout.write(`[extension-host-smoke] fresh run root: ${runRoot}\n`);

  const downloadOptions = {
    version: options.vscodeVersion,
    spawn: { timeout: 120_000, killSignal: "SIGTERM" },
  };
  const installProfileArgs = buildProfileArgs({
    runRoot,
    extensionsDir,
    phase: "install",
  });
  let hostVersion = null;
  let journeyResult = "failed";
  let journeyError = null;
  let evidenceError = null;
  try {
    const { downloadAndUnzipVSCode, runTests, runVSCodeCommand } =
      requireTestElectron();
    recordHostProgress(progressPath, "install_started");
    const install = await retryTransientNetworkOperation(
      () =>
        runVSCodeCommand(
          [...installProfileArgs, "--install-extension", vsixPath, "--force"],
          downloadOptions,
        ),
      { label: `VS Code ${options.vscodeVersion} download/install` },
    );
    recordHostProgress(progressPath, "install_completed");
    if (install.stdout.trim()) {
      process.stdout.write(install.stdout);
    }
    if (install.stderr.trim()) {
      process.stderr.write(install.stderr);
    }

    recordHostProgress(progressPath, "list_started");
    const listed = await retryTransientNetworkOperation(
      () =>
        runVSCodeCommand(
          [...installProfileArgs, "--list-extensions", "--show-versions"],
          downloadOptions,
        ),
      { label: `VS Code ${options.vscodeVersion} extension listing` },
    );
    assertInstalled(listed.stdout, expectedVersion);
    recordHostProgress(progressPath, "list_completed");

    // Reuses the exact version already downloaded by the install command.
    recordHostProgress(progressPath, "download_started");
    const vscodeExecutablePath = await retryTransientNetworkOperation(
      () => downloadAndUnzipVSCode(downloadOptions),
      { label: `VS Code ${options.vscodeVersion} executable resolution` },
    );
    hostVersion = await resolveVsCodeHostVersion(
      vscodeExecutablePath,
      options.vscodeVersion,
    );
    recordHostProgress(progressPath, "download_completed");
    if (!hostApiMode) {
      recordHostProgress(progressPath, "multi_window_started");
      await runHostApiPhase({
        runTests,
        vscodeExecutablePath,
        workspaceDir,
        workspaceFolders,
        workspaceTarget,
        profileArgs: buildProfileArgs({
          runRoot,
          extensionsDir,
          phase: "multi-window",
        }),
        extensionsDir,
        profileHome,
        expectedVersion,
        phase: "initial",
        runtimeDir: path.join(journeyRuntimeDir, "multi-window-gate"),
        fixture,
        companionWorkspace,
        multiWindowEvidenceFile,
        progressPath,
        includeMultiWindow: true,
      });
      recordHostProgress(progressPath, "multi_window_completed");
    }
    for (const phase of ["initial", "restart"]) {
      const profileArgs = buildProfileArgs({ runRoot, extensionsDir, phase });
      recordHostProgress(progressPath, `${phase}_started`);
      const runHostPhase = hostApiMode ? runHostApiPhase : runRealDomPhase;
      await runHostPhase({
        runTests,
        vscodeExecutablePath,
        workspaceDir,
        workspaceFolders,
        workspaceTarget,
        profileArgs,
        extensionsDir,
        profileHome,
        expectedVersion,
        phase,
        runtimeDir: journeyRuntimeDir,
        journeyArtifactDir,
        fixture,
        companionWorkspace,
        multiWindowEvidenceFile,
        progressPath,
        includeMultiWindow: hostApiMode && phase === "initial",
        useCdpPipe: false,
        useElectronMainInspector: false,
        useDomRelay: hostJourneyTransport.useDomRelay,
      });
      recordHostProgress(progressPath, `${phase}_completed`);
    }
    if (hostApiMode) {
      assertHostApiArtifacts({
        runtimeDir: journeyRuntimeDir,
        extensionsDir,
        workspaceDir,
        workspaceFolders,
        expectedVersion,
      });
    } else {
      assertJourneyArtifacts({
        artifactDir: journeyArtifactDir,
        fixtureTracePath: fixture.tracePath,
        runtimeDir: journeyRuntimeDir,
        extensionsDir,
        workspaceDir,
        workspaceFolders,
      });
    }
    assertMultiWindowEvidence(multiWindowEvidenceFile);
    recordHostProgress(progressPath, "assertions_completed");
    journeyResult = "passed";
    process.stdout.write(
      `[extension-host-smoke] PASS ${EXTENSION_ID}@${expectedVersion} ${
        hostApiMode
          ? "host-API activation/view relaunch smoke"
          : "real-DOM control/Workbench/restart journey"
      } on ${hostVersion || options.vscodeVersion}\n`,
    );
  } catch (error) {
    journeyError = error;
    recordHostProgress(progressPath, "journey_failed");
    dumpFailureDiagnostics(runRoot);
  } finally {
    const diagnosticLogs = findDiagnosticLogs(runRoot);
    const sourceRoots = [];
    if (fs.statSync(journeyArtifactDir, { throwIfNoEntry: false })) {
      sourceRoots.push(journeyArtifactDir);
    }
    if (fs.statSync(journeyRuntimeDir, { throwIfNoEntry: false })) {
      sourceRoots.push(journeyRuntimeDir);
    }
    if (
      !hostApiMode &&
      fs.statSync(fixture.tracePath, { throwIfNoEntry: false })?.isFile()
    ) {
      sourceRoots.push(fixture.tracePath);
    }
    sourceRoots.push(...diagnosticLogs);
    if (sourceRoots.length === 0 && journeyError) {
      sourceRoots.push(path.join(runRoot, "__missing-host-diagnostics__"));
    }
    try {
      recordHostProgress(progressPath, "evidence_started");
      const result = await writeJourneyEvidence({
        artifactDir,
        journeyId: hostApiMode
          ? "vscode-installed-vsix-multiroot-multiwindow-host-api-activation-view-relaunch"
          : "vscode-installed-vsix-real-dom-multiroot-multiwindow-control-workbench-restart",
        host: "vscode",
        hostVersion: hostVersion || options.vscodeVersion,
        cliVersion,
        extensionVersion: expectedVersion,
        transport: hostJourneyTransport.evidenceTransport,
        workspaceFolders,
        result: journeyResult,
        startedAt,
        finishedAt: new Date().toISOString(),
        sourceRoots,
        artifactPaths: [vsixPath],
        repoRoot: path.resolve(PACKAGE_ROOT, "..", ".."),
        releaseCommit: options.releaseCommit,
        env: process.env,
      });
      process.stdout.write(
        `[extension-host-smoke] evidence: ${result.destination} (${result.evidence.evidenceDigest})\n`,
      );
      recordHostProgress(progressPath, "evidence_completed");
      if (!result.evidence.evidenceComplete) {
        evidenceError = new Error(
          `IDE journey evidence is incomplete: ${result.evidence.incidents
            .map((incident) => incident.code)
            .join(", ")}`,
        );
      }
    } catch (error) {
      evidenceError = error;
      recordHostProgress(progressPath, "evidence_failed");
      if (journeyError) {
        process.stderr.write(
          `[extension-host-smoke] evidence failure: ${error.message}\n`,
        );
      }
    }
  }
  if (journeyError) throw journeyError;
  if (evidenceError) throw evidenceError;
}

module.exports = {
  buildProfileArgs,
  buildExtensionTestLaunchArgs,
  buildExternalCompanionHostLaunchArgs,
  buildHostApiLaunchArgs,
  buildHostDomRelayLaunchArgs,
  buildHostInspectorLaunchArgs,
  buildHostLaunchArgs,
  buildHostPipeLaunchArgs,
  assertHostApiArtifacts,
  assertMultiWindowEvidence,
  createDevToolsEndpointCapture,
  createElectronInspectorEndpointCapture,
  createHostProgressJournal,
  findDiagnosticLogs,
  hostPhaseSignalPaths,
  makeFreshRunRoot,
  launchExtensionHostWithCdpPipe,
  launchManagedExtensionHost,
  parseArgs,
  parseDevToolsBrowserEndpoint,
  parseElectronInspectorEndpoint,
  recordHostProgress,
  isTransientNetworkError,
  retryTransientNetworkOperation,
  resolveHostJourneyTransport,
  resolveVsCodeHostVersion,
  runHostApiPhase,
  runRealDomPhase,
  settleHostAfterCdp,
  stopManagedHostAfterActivationFailure,
  writeMultiRootWorkspace,
  writeCompanionWorkspace,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `[extension-host-smoke] FAIL ${error && error.stack ? error.stack : error}\n`,
    );
    process.exitCode = 1;
  });
}
