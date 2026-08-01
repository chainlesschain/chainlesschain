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
 *   npm install --no-save --no-package-lock @vscode/test-electron@3.0.0
 *   npm run test:extension-host -- --vsix chainlesschain-ide.vsix
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

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
          "`npm install --no-save --no-package-lock @vscode/test-electron@3.0.0` first.",
        { cause: error },
      );
    }
    throw error;
  }
}

function makeFreshRunRoot(parent, vscodeVersion) {
  const base = path.resolve(parent || os.tmpdir());
  fs.mkdirSync(base, { recursive: true });
  const slug = String(vscodeVersion).replace(/[^a-zA-Z0-9._-]/g, "_");
  return fs.mkdtempSync(path.join(base, `chainlesschain-vscode-${slug}-`));
}

function writeWorkspace(workspaceDir) {
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
        "chainlesschain.cli.path": "__chainlesschain_smoke_missing_cc__",
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

function resolveVsCodeHostVersion(executablePath, requestedVersion) {
  let current = path.dirname(path.resolve(executablePath));
  for (let depth = 0; depth < 7; depth += 1) {
    for (const relative of [
      path.join("resources", "app", "package.json"),
      path.join("Resources", "app", "package.json"),
    ]) {
      const version = readJsonVersion(path.join(current, relative));
      if (version) return version;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
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
  const runRoot = makeFreshRunRoot(options.workDir, options.vscodeVersion);
  const userDataDir = path.join(runRoot, "user-data");
  const extensionsDir = path.join(runRoot, "extensions");
  const profileHome = path.join(runRoot, "profile-home");
  const workspaceDir = path.join(runRoot, "workspace");
  const artifactDir = path.resolve(
    options.artifactDir || path.join(runRoot, "journey-evidence"),
  );
  const startedAt = new Date().toISOString();
  const cliVersion = readJsonVersion(
    path.resolve(PACKAGE_ROOT, "..", "cli", "package.json"),
  );
  for (const dir of [userDataDir, extensionsDir, profileHome, workspaceDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  writeWorkspace(workspaceDir);

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
    hostVersion = resolveVsCodeHostVersion(
      vscodeExecutablePath,
      options.vscodeVersion,
    );
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: path.join(__dirname, "driver"),
      extensionTestsPath: path.join(__dirname, "driver", "smoke.cjs"),
      launchArgs: [
        workspaceDir,
        ...profileArgs,
        "--disable-extension-update-checks",
        "--disable-telemetry",
        "--disable-crash-reporter",
      ],
      extensionTestsEnv: {
        HOME: profileHome,
        USERPROFILE: profileHome,
        CHAINLESSCHAIN_SMOKE_EXTENSIONS_DIR: extensionsDir,
        CHAINLESSCHAIN_SMOKE_EXPECTED_VERSION: expectedVersion,
        CHAINLESSCHAIN_SMOKE_WORKSPACE: workspaceDir,
      },
    });
    journeyResult = "passed";
    process.stdout.write(
      `[extension-host-smoke] PASS ${EXTENSION_ID}@${expectedVersion} on ${hostVersion || options.vscodeVersion}\n`,
    );
  } catch (error) {
    journeyError = error;
    dumpFailureDiagnostics(runRoot);
  } finally {
    const diagnosticLogs = findDiagnosticLogs(runRoot);
    const sourceRoots =
      diagnosticLogs.length > 0
        ? diagnosticLogs
        : journeyError
          ? [path.join(runRoot, "__missing-host-diagnostics__")]
          : [];
    try {
      const result = await writeJourneyEvidence({
        artifactDir,
        journeyId: "vscode-extension-host-activation-bridge",
        host: "vscode",
        hostVersion: hostVersion || options.vscodeVersion,
        cliVersion,
        extensionVersion: expectedVersion,
        transport: "local-ide-bridge",
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
  findDiagnosticLogs,
  parseArgs,
  resolveVsCodeHostVersion,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `[extension-host-smoke] FAIL ${error && error.stack ? error.stack : error}\n`,
    );
    process.exitCode = 1;
  });
}
