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
 *   npm install --no-save --no-package-lock @vscode/test-electron@3.1.0
 *   npm run test:extension-host -- --vsix chainlesschain-ide.vsix
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  assertJourneyArtifacts,
  createFixtureCli,
  readJourneyResult,
  reserveLoopbackPort,
  runCdpHostJourney,
} = require("./cdp-journey.cjs");

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
    workspaceDir,
    ...profileArgs,
    `--remote-debugging-port=${cdpPort}`,
    "--remote-debugging-address=127.0.0.1",
    "--disable-extension-update-checks",
    "--disable-telemetry",
    "--disable-crash-reporter",
  ];
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
  const abortController = new AbortController();
  const cdpOutcome = runCdpHostJourney({
    port: cdpPort,
    readyFile,
    resultFile,
    phase,
    artifactDir: journeyArtifactDir,
    signal: abortController.signal,
  }).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );

  let hostError = null;
  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: path.join(__dirname, "driver"),
      extensionTestsPath: path.join(__dirname, "driver", "smoke.cjs"),
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
    });
  } catch (error) {
    hostError = error;
    abortController.abort(error);
  }

  const cdp = await cdpOutcome;
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
  const logsRoot = path.join(runRoot, "user-data", "logs");
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
  walk(logsRoot);
  return candidates.sort();
}

function dumpFailureDiagnostics(runRoot) {
  const logsRoot = path.join(runRoot, "user-data", "logs");
  const candidates = findDiagnosticLogs(runRoot);
  if (candidates.length === 0) {
    process.stderr.write(
      `[extension-host-smoke] no diagnostic logs found under ${logsRoot}\n`,
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
  const userDataDir = path.join(runRoot, "user-data");
  const extensionsDir = path.join(runRoot, "extensions");
  const profileHome = path.join(runRoot, "profile-home");
  const workspaceDir = path.join(runRoot, "workspace");
  const journeyRuntimeDir = path.join(runRoot, "journey-runtime");
  const journeyArtifactDir = path.join(runRoot, "journey-artifacts");
  const artifactDir = path.resolve(
    options.artifactDir || path.join(runRoot, "journey-evidence"),
  );
  const startedAt = new Date().toISOString();
  const cliVersion = readJsonVersion(
    path.resolve(PACKAGE_ROOT, "..", "cli", "package.json"),
  );
  for (const dir of [
    userDataDir,
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

  const downloadOptions = { version: options.vscodeVersion };
  const profileArgs = [
    `--extensions-dir=${extensionsDir}`,
    `--user-data-dir=${userDataDir}`,
  ];
  let hostVersion = null;
  let journeyResult = "failed";
  let journeyError = null;
  let evidenceError = null;
  try {
    const { downloadAndUnzipVSCode, runTests, runVSCodeCommand } =
      requireTestElectron();
    const install = await runVSCodeCommand(
      [...profileArgs, "--install-extension", vsixPath, "--force"],
      downloadOptions,
    );
    if (install.stdout.trim()) {
      process.stdout.write(install.stdout);
    }
    if (install.stderr.trim()) {
      process.stderr.write(install.stderr);
    }

    const listed = await runVSCodeCommand(
      [...profileArgs, "--list-extensions", "--show-versions"],
      downloadOptions,
    );
    assertInstalled(listed.stdout, expectedVersion);

    // Reuses the exact version already downloaded by the install command.
    const vscodeExecutablePath = await downloadAndUnzipVSCode(downloadOptions);
    hostVersion = await resolveVsCodeHostVersion(
      vscodeExecutablePath,
      options.vscodeVersion,
    );
    for (const phase of ["initial", "restart"]) {
      if (phase === "restart") {
        // Electron 39 can return from the first Extension Host while its
        // profile mutex and renderer teardown are still settling. Give that
        // bounded teardown a moment before launching the same isolated profile
        // again, otherwise the second test process can exit before its driver
        // receives the CDP result.
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
      await runRealDomPhase({
        runTests,
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
    }
    assertJourneyArtifacts({
      artifactDir: journeyArtifactDir,
      fixtureTracePath: fixture.tracePath,
      runtimeDir: journeyRuntimeDir,
      extensionsDir,
      workspaceDir,
    });
    journeyResult = "passed";
    process.stdout.write(
      `[extension-host-smoke] PASS ${EXTENSION_ID}@${expectedVersion} real-DOM control/restart journey on ${hostVersion || options.vscodeVersion}\n`,
    );
  } catch (error) {
    journeyError = error;
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
      const result = await writeJourneyEvidence({
        artifactDir,
        journeyId: "vscode-installed-vsix-real-dom-control-resume",
        host: "vscode",
        hostVersion: hostVersion || options.vscodeVersion,
        cliVersion,
        extensionVersion: expectedVersion,
        transport: "local-ide-bridge+loopback-cdp",
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
      if (!result.evidence.evidenceComplete) {
        evidenceError = new Error(
          `IDE journey evidence is incomplete: ${result.evidence.incidents
            .map((incident) => incident.code)
            .join(", ")}`,
        );
      }
    } catch (error) {
      evidenceError = error;
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
  buildHostLaunchArgs,
  findDiagnosticLogs,
  hostPhaseSignalPaths,
  makeFreshRunRoot,
  parseArgs,
  resolveVsCodeHostVersion,
  runRealDomPhase,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `[extension-host-smoke] FAIL ${error && error.stack ? error.stack : error}\n`,
    );
    process.exitCode = 1;
  });
}
