#!/usr/bin/env node
"use strict";

/**
 * Install the packaged ChainlessChain VSIX into a brand-new VS Code profile,
 * then launch a real Electron Extension Host with a separate test-driver
 * extension. The driver proves that the loaded target came from the fresh
 * extensions directory (not --extensionDevelopmentPath), activates it, and
 * checks its command/bridge surface.
 *
 * @vscode/test-electron is intentionally installed by CI with
 * --no-save --no-package-lock so this leaf package keeps its lockfile-free
 * packaging workflow. Local usage:
 *   npm install --no-save --no-package-lock @vscode/test-electron@3.1.0 playwright-core@1.61.1
 *   npm run test:extension-host -- --vsix chainlesschain-ide.vsix
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { pathToFileURL } = require("node:url");
const {
  assertJourneyArtifacts,
  createFixtureCli,
  readJourneyResult,
  reserveLoopbackPort,
  runCdpHostJourney,
} = require("./cdp-journey.cjs");
const {
  buildPlaywrightHostArgs,
  runPlaywrightHostJourney,
} = require("./playwright-journey.cjs");

const EXTENSION_ID = "chainlesschain.chainlesschain-ide";
const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");

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

function requirePlaywrightElectron() {
  try {
    const playwright = require("playwright-core");
    if (!playwright?._electron?.launch) {
      throw new Error("playwright-core does not expose its Electron launcher");
    }
    return playwright._electron;
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") {
      throw new Error(
        "playwright-core is required for the macOS real-DOM host gate. Run " +
          "`npm install --no-save --no-package-lock playwright-core@1.61.1` first.",
        { cause: error },
      );
    }
    throw error;
  }
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
  if (!/^(?:install|initial|restart)$/.test(phase)) {
    throw new Error(`unknown host profile phase: ${phase}`);
  }
  return [
    `--extensions-dir=${extensionsDir}`,
    `--user-data-dir=${path.join(runRoot, `user-data-${phase}`)}`,
  ];
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

function recordHostProgress(progressPath, stage) {
  if (!/^[a-z][a-z0-9_]*$/.test(stage)) {
    throw new Error(`invalid host progress stage: ${stage}`);
  }
  fs.appendFileSync(
    progressPath,
    `${JSON.stringify({ stage, at: new Date().toISOString() })}\n`,
    "utf8",
  );
}

function writeWorkspace(workspaceDir, fixtureCliCommand) {
  const vscodeDir = path.join(workspaceDir, ".vscode");
  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "hello.txt"),
    "ChainlessChain Extension Host smoke workspace\n",
    "utf8",
  );
  // Keep activation deterministic and offline. The managed-CLI command still
  // has to be registered; only its asynchronous startup probe is disabled.
  fs.writeFileSync(
    path.join(vscodeDir, "settings.json"),
    `${JSON.stringify(
      {
        "chainlesschain.ide.enabled": true,
        "chainlesschain.cli.managed.enabled": false,
        "chainlesschain.cli.path": fixtureCliCommand,
        "extensions.autoCheckUpdates": false,
        "extensions.autoUpdate": false,
        "telemetry.telemetryLevel": "off",
        "update.mode": "none",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
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
    // Chromium rejects DevTools WebSocket origins unless explicitly allowed.
    // The debugging socket is still bound to a random loopback-only port in a
    // fresh test profile, so this does not expose the host beyond the runner.
    "--remote-allow-origins=*",
    "--disable-extension-update-checks",
    "--disable-telemetry",
    "--disable-crash-reporter",
    // Keep the positional workspace after every host switch. Some Electron /
    // VS Code launch paths stop interpreting Chromium switches once a
    // positional argument has been consumed.
    workspaceDir,
  ];
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
}) {
  let host = await waitForOutcome(hostOutcome, graceMs);
  if (host) return { host, managedTermination: false };

  process.stdout.write(
    `[extension-host-smoke] ${phase}: CDP journey settled; requesting host shutdown\n`,
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

async function runRealDomPhase({
  runTests,
  vscodeExecutablePath,
  workspaceDir,
  profileArgs,
  extensionsDir,
  profileHome,
  expectedVersion,
  phase,
  runtimeDir,
  journeyArtifactDir,
  fixture,
}) {
  const cdpPort = await reserveLoopbackPort();
  const { readyFile, resultFile } = hostPhaseSignalPaths(runtimeDir, phase);
  // Chromium prints its authoritative browser websocket endpoint before the
  // Extension Host becomes ready. Capture that loopback-only URL while still
  // teeing stderr to the workflow log. macOS hosts have intermittently left
  // the secondary /json/version discovery request pending even though this
  // endpoint is already listening; using the announced endpoint avoids that
  // redundant HTTP dependency without weakening target/DOM assertions.
  const devToolsEndpoint = createDevToolsEndpointCapture(cdpPort);
  const abortController = new AbortController();
  const cdpOutcome = runCdpHostJourney({
    port: cdpPort,
    getBrowserWebSocketUrl: devToolsEndpoint.getEndpoint,
    readyFile,
    resultFile,
    phase,
    artifactDir: journeyArtifactDir,
    signal: abortController.signal,
  }).then(
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
    const hostOutcome = Promise.resolve()
      .then(() =>
        runTests({
          vscodeExecutablePath,
          extensionDevelopmentPath: path.join(__dirname, "driver"),
          extensionTestsPath: path.join(__dirname, "driver", "smoke.cjs"),
          stderr: devToolsEndpoint.stderr,
          launchArgs: buildHostLaunchArgs({
            workspaceDir,
            profileArgs,
            cdpPort,
          }),
          extensionTestsEnv: {
            HOME: profileHome,
            USERPROFILE: profileHome,
            CHAINLESSCHAIN_SMOKE_EXTENSIONS_DIR: extensionsDir,
            CHAINLESSCHAIN_SMOKE_EXPECTED_VERSION: expectedVersion,
            CHAINLESSCHAIN_SMOKE_WORKSPACE: workspaceDir,
            CHAINLESSCHAIN_HOST_JOURNEY_PHASE: phase,
            CHAINLESSCHAIN_HOST_READY_FILE: readyFile,
            CHAINLESSCHAIN_HOST_RESULT_FILE: resultFile,
            CC_UI_FIXTURE_STATE: fixture.statePath,
            CC_UI_FIXTURE_TRACE: fixture.tracePath,
          },
        }),
      )
      .then(
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
      `VS Code host and CDP journey failed during ${phase}`,
    );
  }
  if (hostError) throw hostError;
  if (cdp.error) throw cdp.error;
  return readJourneyResult(resultFile, phase);
}

function processExitOutcome(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function closePlaywrightElectron(electronApp, timeoutMs = 15_000) {
  const close = Promise.resolve()
    .then(() => electronApp.close())
    .then(
      () => ({ closed: true }),
      (error) => ({ error }),
    );
  const outcome = await waitForOutcome(close, timeoutMs);
  if (!outcome) {
    throw new Error(
      `Playwright Electron host did not close within ${timeoutMs}ms`,
    );
  }
  if (outcome.error) throw outcome.error;
}

async function runPlaywrightRealDomPhase({
  vscodeExecutablePath,
  workspaceDir,
  profileArgs,
  extensionsDir,
  profileHome,
  expectedVersion,
  phase,
  runtimeDir,
  journeyArtifactDir,
  fixture,
}) {
  const { readyFile, resultFile } = hostPhaseSignalPaths(runtimeDir, phase);
  const extensionDevelopmentPath = path.join(__dirname, "driver");
  const extensionTestsPath = path.join(__dirname, "driver", "smoke.cjs");
  const extensionTestsEnv = {
    HOME: profileHome,
    USERPROFILE: profileHome,
    CHAINLESSCHAIN_SMOKE_EXTENSIONS_DIR: extensionsDir,
    CHAINLESSCHAIN_SMOKE_EXPECTED_VERSION: expectedVersion,
    CHAINLESSCHAIN_SMOKE_WORKSPACE: workspaceDir,
    CHAINLESSCHAIN_HOST_JOURNEY_PHASE: phase,
    CHAINLESSCHAIN_HOST_READY_FILE: readyFile,
    CHAINLESSCHAIN_HOST_RESULT_FILE: resultFile,
    CC_UI_FIXTURE_STATE: fixture.statePath,
    CC_UI_FIXTURE_TRACE: fixture.tracePath,
  };
  const abortController = new AbortController();
  let electronApp;
  let hostOutcome;
  let journeyOutcome;
  try {
    electronApp = await requirePlaywrightElectron().launch({
      executablePath: vscodeExecutablePath,
      args: buildPlaywrightHostArgs({
        workspaceDir,
        profileArgs,
        extensionDevelopmentPath,
        extensionTestsPath,
      }),
      env: { ...process.env, ...extensionTestsEnv },
      timeout: 60_000,
    });
    hostOutcome = processExitOutcome(electronApp.process());
    journeyOutcome = runPlaywrightHostJourney({
      electronApp,
      readyFile,
      resultFile,
      phase,
      artifactDir: journeyArtifactDir,
      signal: abortController.signal,
    }).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );

    const first = await Promise.race([
      hostOutcome.then((outcome) => ({ source: "host", outcome })),
      journeyOutcome.then((outcome) => ({ source: "journey", outcome })),
    ]);
    if (first.source === "host") {
      abortController.abort(
        new Error(
          `Playwright VS Code host exited before ${phase} DOM journey completed`,
        ),
      );
      const journey = await journeyOutcome;
      throw new Error(
        `Playwright VS Code host exited before ${phase} DOM journey completed (code=${String(first.outcome.code)}, signal=${String(first.outcome.signal)})`,
        { cause: journey.error },
      );
    }

    const journey = first.outcome;
    let host = await waitForOutcome(hostOutcome, 10_000);
    let managedTermination = false;
    if (!host) {
      managedTermination = true;
      await closePlaywrightElectron(electronApp);
      host = await waitForOutcome(hostOutcome, 5_000);
    }
    if (journey.error) throw journey.error;
    if (!host) {
      throw new Error(`Playwright VS Code host did not exit during ${phase}`);
    }
    if (!managedTermination && host.code !== 0) {
      throw new Error(
        `Playwright VS Code host failed during ${phase} (code=${String(host.code)}, signal=${String(host.signal)})`,
      );
    }
    return readJourneyResult(resultFile, phase);
  } finally {
    abortController.abort(new Error(`${phase} Playwright host phase ended`));
    if (electronApp && electronApp.process().exitCode === null) {
      try {
        await closePlaywrightElectron(electronApp);
      } catch {
        // The phase's primary error and evidence remain authoritative.
      }
    }
  }
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
  const workspaceDir = path.join(runRoot, "workspace");
  const journeyRuntimeDir = path.join(runRoot, "journey-runtime");
  const journeyArtifactDir = path.join(runRoot, "journey-artifacts");
  const artifactDir = path.resolve(
    options.artifactDir || path.join(runRoot, "journey-evidence"),
  );
  const progressPath = createHostProgressJournal(artifactDir);
  recordHostProgress(progressPath, "prepared");
  const startedAt = new Date().toISOString();
  const cliVersion = readJsonVersion(
    path.resolve(PACKAGE_ROOT, "..", "cli", "package.json"),
  );
  for (const dir of [
    extensionsDir,
    profileHome,
    workspaceDir,
    journeyRuntimeDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const fixture = createFixtureCli(
    runRoot,
    path.resolve(PACKAGE_ROOT, "..", ".."),
  );
  writeWorkspace(workspaceDir, fixture.command);

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
    const install = await runVSCodeCommand(
      [...installProfileArgs, "--install-extension", vsixPath, "--force"],
      downloadOptions,
    );
    recordHostProgress(progressPath, "install_completed");
    if (install.stdout.trim()) {
      process.stdout.write(install.stdout);
    }
    if (install.stderr.trim()) {
      process.stderr.write(install.stderr);
    }

    recordHostProgress(progressPath, "list_started");
    const listed = await runVSCodeCommand(
      [...installProfileArgs, "--list-extensions", "--show-versions"],
      downloadOptions,
    );
    assertInstalled(listed.stdout, expectedVersion);
    recordHostProgress(progressPath, "list_completed");

    // Reuses the exact version already downloaded by the install command.
    recordHostProgress(progressPath, "download_started");
    const vscodeExecutablePath = await downloadAndUnzipVSCode(downloadOptions);
    hostVersion = await resolveVsCodeHostVersion(
      vscodeExecutablePath,
      options.vscodeVersion,
    );
    recordHostProgress(progressPath, "download_completed");
    for (const phase of ["initial", "restart"]) {
      const profileArgs = buildProfileArgs({ runRoot, extensionsDir, phase });
      recordHostProgress(progressPath, `${phase}_started`);
      const runHostPhase =
        process.platform === "darwin"
          ? runPlaywrightRealDomPhase
          : runRealDomPhase;
      await runHostPhase({
        ...(process.platform === "darwin" ? {} : { runTests }),
        vscodeExecutablePath,
        workspaceDir,
        profileArgs,
        extensionsDir,
        profileHome,
        expectedVersion,
        phase,
        runtimeDir: journeyRuntimeDir,
        journeyArtifactDir,
        fixture,
      });
      recordHostProgress(progressPath, `${phase}_completed`);
    }
    assertJourneyArtifacts({
      artifactDir: journeyArtifactDir,
      fixtureTracePath: fixture.tracePath,
      runtimeDir: journeyRuntimeDir,
      extensionsDir,
      workspaceDir,
    });
    recordHostProgress(progressPath, "assertions_completed");
    journeyResult = "passed";
    process.stdout.write(
      `[extension-host-smoke] PASS ${EXTENSION_ID}@${expectedVersion} real-DOM control/restart journey on ${hostVersion || options.vscodeVersion}\n`,
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
    if (fs.statSync(fixture.tracePath, { throwIfNoEntry: false })?.isFile()) {
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
        journeyId: "vscode-installed-vsix-real-dom-control-resume",
        host: "vscode",
        hostVersion: hostVersion || options.vscodeVersion,
        cliVersion,
        extensionVersion: expectedVersion,
        transport:
          process.platform === "darwin"
            ? "local-ide-bridge+playwright-electron"
            : "local-ide-bridge+loopback-cdp",
        result: journeyResult,
        startedAt,
        finishedAt: new Date().toISOString(),
        sourceRoots,
        artifactPaths: [vsixPath],
        repoRoot: path.resolve(PACKAGE_ROOT, "..", ".."),
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
  buildHostLaunchArgs,
  createDevToolsEndpointCapture,
  createHostProgressJournal,
  findDiagnosticLogs,
  hostPhaseSignalPaths,
  makeFreshRunRoot,
  parseArgs,
  parseDevToolsBrowserEndpoint,
  recordHostProgress,
  resolveVsCodeHostVersion,
  runPlaywrightRealDomPhase,
  runRealDomPhase,
  settleHostAfterCdp,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `[extension-host-smoke] FAIL ${error && error.stack ? error.stack : error}\n`,
    );
    process.exitCode = 1;
  });
}
