#!/usr/bin/env node
"use strict";

// Real installed IDE, deterministic local protocol peer. Never a formal
// VERIFY-01 observation or provider-quality/installation attestation.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { parseArgs } = require("node:util");
const { spawn } = require("node:child_process");
const { createFixtureCli } = require("./cdp-journey.cjs");

async function settleDiagnosticLauncher(handle, deadline, cleanupMs = 20000) {
  const { withinDeadline, stopOwned } =
    await import("../../../../scripts/lib/verify01-diagnostic-process.mjs");
  let exit = { code: null, signal: null };
  let failure, cleanupError;
  try {
    exit = await withinDeadline(
      handle.done,
      deadline,
      "outer VS Code diagnostic",
    );
  } catch (error) {
    failure = error.stack;
    // The inner launcher uses the same POSIX group. Request orderly cleanup,
    // then bound that wait and terminate the owned group/tree if necessary.
    if (handle.child.connected)
      handle.child.send({ type: "verify01-cancel" }, () => {});
    try {
      exit = await withinDeadline(
        handle.done,
        Date.now() + cleanupMs,
        "launcher cleanup",
      );
    } catch (error) {
      cleanupError = error.stack;
    }
  } finally {
    try {
      await stopOwned(handle);
    } catch (error) {
      cleanupError = error.stack;
    }
  }
  return { exit, failure, cleanupError };
}

async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      vsix: { type: "string" },
      "host-version": { type: "string" },
      "extension-version": { type: "string" },
      "artifact-dir": { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Real VS Code with a deterministic peer; no provider call or formal observations.\n--vsix FILE --host-version X.Y.Z --extension-version X.Y.Z [--artifact-dir NEW_DIRECTORY]\nPrepare the host in packages/vscode-extension/.vscode-test first. Evidence stays in a new OS temporary directory and is optionally archived.",
    );
    return;
  }
  if (!values.vsix || !values["host-version"] || !values["extension-version"])
    throw new Error(
      "--vsix, --host-version and --extension-version are required",
    );
  const vsix = path.resolve(values.vsix);
  const {
    reserveArtifactDirectory,
    archiveDiagnostic,
    verifyDiagnosticCapture,
  } = await import("../../../../scripts/lib/verify01-diagnostic-evidence.mjs");
  const destination = reserveArtifactDirectory(values["artifact-dir"]);
  const digest = (file) =>
    `sha256:${createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
  const vsixDigest = digest(vsix);
  // macOS tmpdir may traverse /var -> /private/var. Keep the capture writer's
  // existing no-symlink contract by supplying the canonical directory.
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-verify01-vscode-")),
  );
  const repo = path.resolve(__dirname, "../../../..");
  const fixture = createFixtureCli(root, repo);
  const dirs = Object.fromEntries(
    [
      "workspace",
      "captureDir",
      "profileHome",
      "userDataDir",
      "extensionsDir",
      "canonical",
    ].map((name) => [name, path.join(root, name)]),
  );
  for (const directory of Object.values(dirs)) fs.mkdirSync(directory);
  fs.mkdirSync(path.join(dirs.userDataDir, "User"));
  fs.writeFileSync(
    path.join(dirs.userDataDir, "User", "settings.json"),
    JSON.stringify(
      {
        "chainlesschain.ide.enabled": true,
        "chainlesschain.cli.managed.enabled": false,
        "chainlesschain.cli.path": fixture.command,
        "extensions.autoCheckUpdates": false,
        "extensions.autoUpdate": false,
        "telemetry.telemetryLevel": "off",
        "update.mode": "none",
      },
      null,
      2,
    ),
  );
  const config = {
    sampleId: "verify-02",
    prompt: "journey:history-A",
    provider: "ollama",
    model: "deterministic-host-peer",
    permissionMode: "acceptEdits",
    hostVersion: values["host-version"],
    extensionVersion: values["extension-version"],
    deadline: Date.now() + 10 * 60 * 1000,
    ...dirs,
  };
  const configFile = path.join(root, "diagnostic-config.json");
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  const log = fs.openSync(path.join(root, "host.log"), "wx", 0o600);
  let exit = { code: null, signal: null };
  let failure;
  let cleanupError;
  let handle;
  console.log(`Diagnostic evidence: ${root}`);
  try {
    const child = spawn(
      process.execPath,
      [
        path.join(__dirname, "verify01-run.cjs"),
        "--config",
        configFile,
        "--config-digest",
        digest(configFile),
        "--vsix",
        vsix,
        "--vsix-digest",
        vsixDigest,
        "--confirm-live",
      ],
      {
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", log, log, "ipc"],
        env: {
          ...process.env,
          CC_UI_FIXTURE_STATE: fixture.statePath,
          CC_UI_FIXTURE_TRACE: fixture.tracePath,
          CC_UI_CANONICAL_ROOT: dirs.canonical,
          CC_UI_CONVERSATION_RECOVERY: "1",
          CC_VERIFY01_PARENT_OWNS_PROCESS_GROUP: "1",
        },
      },
    );
    handle = {
      child,
      closed: false,
      done: null,
      logFile: path.join(root, "host.log"),
    };
    handle.done = new Promise((yes, no) => {
      child.once("error", no);
      child.once("close", (code, signal) => {
        handle.closed = true;
        yes({ code, signal });
      });
    });
    ({ exit, failure, cleanupError } = await settleDiagnosticLauncher(
      handle,
      config.deadline + 2000,
    ));
  } catch (error) {
    failure = error.stack;
  } finally {
    fs.closeSync(log);
  }
  const result = {
    scope: "real-installed-vscode-with-deterministic-protocol-peer",
    passed:
      !failure && !cleanupError && exit.code === 0 && exit.signal === null,
    exit,
    hostVersion: config.hostVersion,
    extensionVersion: config.extensionVersion,
    vsixDigest,
    providerAssessed: false,
    formalSample: false,
    observationsCreated: false,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    sourceCommit: process.env.GITHUB_SHA || null,
    ...(failure ? { error: failure } : {}),
    ...(cleanupError ? { cleanupError } : {}),
  };
  if (result.passed) {
    try {
      result.capture = verifyDiagnosticCapture(dirs.captureDir, "vscode");
    } catch (error) {
      result.passed = false;
      result.error = error.stack;
    }
  }
  fs.writeFileSync(
    path.join(root, "diagnostic-result.json"),
    JSON.stringify(result, null, 2),
  );
  archiveDiagnostic(root, destination);
  console.log(
    JSON.stringify({
      root,
      destination,
      passed: result.passed,
      error: result.error,
    }),
  );
  if (!result.passed) process.exitCode = 1;
}

module.exports = { main, settleDiagnosticLauncher };
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
