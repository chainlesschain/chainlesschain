#!/usr/bin/env node
"use strict";

/** Opt-in real-provider launcher. Configuration, CLI installation and account
 * provisioning are operator inputs, kept outside the evaluated workspace.
 * This runner never substitutes the deterministic smoke CLI.
 */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash, randomBytes } = require("node:crypto");
const { parseArgs } = require("node:util");
const { spawn, spawnSync } = require("node:child_process");

// Only the keyless diagnostic parent supplies IPC plus this explicit marker.
// Sharing its POSIX group gives the independent outer deadline a complete
// cleanup scope if this launcher stops responding. Operator runs own a group.
const parentOwnsProcessGroup =
  process.connected &&
  process.env.CC_VERIFY01_PARENT_OWNS_PROCESS_GROUP === "1";

function terminateOwnedHost(child, signal) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  if (process.platform === "win32") {
    const result = spawnSync(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      {
        shell: false,
        windowsHide: true,
        timeout: 10000,
        encoding: "utf8",
      },
    );
    if (result.error) throw result.error;
    if (
      result.status !== 0 &&
      child.exitCode === null &&
      child.signalCode === null
    )
      throw new Error(
        `owned VS Code process-tree cleanup failed (${result.status})`,
      );
  } else {
    if (parentOwnsProcessGroup) {
      child.kill(signal);
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}

function validateConfig(config) {
  assert.match(config.sampleId || "", /^(?:verify-\d{2}|first-run-[\w-]+)$/u);
  assert.ok(
    typeof config.prompt === "string" &&
      config.prompt.length > 0 &&
      config.prompt.length <= 512,
  );
  assert.match(config.hostVersion || "", /^\d+\.\d+\.\d+$/u);
  assert.match(config.extensionVersion || "", /^\d+\.\d+\.\d+$/u);
  for (const key of ["provider", "model", "permissionMode"])
    assert.ok(
      typeof config[key] === "string" && config[key].length > 0,
      `${key} is required`,
    );
  assert.ok(
    ["default", "acceptEdits", "bypassPermissions"].includes(
      config.permissionMode,
    ),
    "permissionMode must be default, acceptEdits, or bypassPermissions; CLI aliases are not supported by the IDE panel",
  );
  assert.ok(
    Number.isSafeInteger(config.deadline) &&
      config.deadline > Date.now() &&
      config.deadline - Date.now() <= 1200000,
  );
  for (const key of [
    "workspace",
    "captureDir",
    "profileHome",
    "userDataDir",
    "extensionsDir",
  ])
    assert.ok(
      typeof config[key] === "string" && path.isAbsolute(config[key]),
      `${key} must be absolute`,
    );
  for (const key of [
    "captureDir",
    "profileHome",
    "userDataDir",
    "extensionsDir",
  ]) {
    const relative = path.relative(config.workspace, config[key]);
    assert.ok(
      relative &&
        (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)),
      `${key} must be outside the evaluated workspace`,
    );
  }
  return config;
}

async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      "config-digest": { type: "string" },
      vsix: { type: "string" },
      "vsix-digest": { type: "string" },
      "confirm-live": { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Real installed VS Code initial/restart capture; does not create formal observations.\n" +
        "--config FILE --config-digest sha256:... --vsix FILE --vsix-digest sha256:... --confirm-live\n" +
        "Config requires sampleId/prompt/hostVersion/extensionVersion/deadline and absolute workspace/captureDir/profileHome/userDataDir/extensionsDir. Provision the real CLI and account in that isolated home before launch. Capture includes raw task text and tool output.",
    );
    return;
  }
  assert.equal(
    values["confirm-live"],
    true,
    "real-provider invocation requires --confirm-live",
  );
  const digest = (bytes) =>
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const configBytes = fs.readFileSync(values.config);
  assert.equal(
    digest(configBytes),
    values["config-digest"],
    "external config byte binding differs",
  );
  const config = validateConfig(JSON.parse(configBytes));
  const vsix = path.resolve(values.vsix);
  assert.equal(
    digest(fs.readFileSync(vsix)),
    values["vsix-digest"],
    "external VSIX byte binding differs",
  );
  const cachePath = path.resolve(__dirname, "../../.vscode-test");
  const { systemDefaultPlatform } = require("@vscode/test-electron/out/util");
  assert.ok(
    fs.existsSync(
      path.join(
        cachePath,
        `vscode-${systemDefaultPlatform}-${config.hostVersion}`,
        "is-complete",
      ),
    ),
    `Prepare VS Code ${config.hostVersion} in ${cachePath} before starting the timed capture; downloads have no task-wide cancellation`,
  );
  const configFile = path.join(config.captureDir, "launcher-config.json");
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  const {
    downloadAndUnzipVSCode,
    runVSCodeCommand,
  } = require("@vscode/test-electron");
  const {
    launchManagedExtensionHost,
    buildHostDomRelayLaunchArgs,
    stopManagedHostAfterActivationFailure,
  } = require("./run.cjs");
  const profileArgs = [
    "--user-data-dir",
    config.userDataDir,
    "--extensions-dir",
    config.extensionsDir,
  ];
  const token = randomBytes(32).toString("hex");
  const install = await runVSCodeCommand(
    [...profileArgs, "--install-extension", vsix],
    {
      version: config.hostVersion,
      cachePath,
      timeout: Math.min(15000, config.deadline - Date.now()),
      spawn: {
        timeout: Math.max(1, config.deadline - Date.now()),
        windowsHide: true,
      },
    },
  );
  fs.writeFileSync(
    path.join(config.captureDir, "vscode-install.json"),
    JSON.stringify(
      {
        hostVersion: config.hostVersion,
        vsixDigest: values["vsix-digest"],
        stdout: install.stdout,
        stderr: install.stderr,
        completedAt: new Date().toISOString(),
        installationVerified: false,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  assert.ok(
    Date.now() < config.deadline,
    "task deadline expired during installation",
  );
  const executable = await downloadAndUnzipVSCode({
    version: config.hostVersion,
    cachePath,
    timeout: Math.min(15000, config.deadline - Date.now()),
  });
  for (const phase of ["initial", "restart"]) {
    if (
      phase === "restart" &&
      JSON.parse(
        fs.readFileSync(
          path.join(config.captureDir, "vscode-initial.json"),
          "utf8",
        ),
      ).recoveryRequired === false
    )
      break;
    assert.ok(
      Date.now() < config.deadline,
      "task deadline expired before host launch",
    );
    let ownedHost;
    const launched = launchManagedExtensionHost({
      spawnProcess: (command, args, options) => {
        ownedHost = spawn(command, args, {
          ...options,
          detached: process.platform !== "win32" && !parentOwnsProcessGroup,
          windowsHide: true,
        });
        return ownedHost;
      },
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: path.join(__dirname, "driver"),
      persistentStorage: true,
      launchArgs: buildHostDomRelayLaunchArgs({
        workspaceDir: config.workspace,
        profileArgs,
      }),
      extensionTestsEnv: {
        HOME: config.profileHome,
        USERPROFILE: config.profileHome,
        CHAINLESSCHAIN_HOME: path.join(config.profileHome, ".chainlesschain"),
        CHAINLESSCHAIN_HOST_DOM_TOKEN: token,
        CHAINLESSCHAIN_VERIFY01_CAPTURE_DIR: config.captureDir,
        CHAINLESSCHAIN_VERIFY01_CONFIG: configFile,
        CHAINLESSCHAIN_VERIFY01_PHASE: phase,
      },
    });
    let stopCount = 0;
    launched.requestStop = () =>
      terminateOwnedHost(ownedHost, ++stopCount === 1 ? "SIGTERM" : "SIGKILL");
    let timer;
    let cancel;
    const cancelled = new Promise((_, reject) => {
      cancel = (message) => {
        if (parentOwnsProcessGroup && message?.type === "verify01-cancel")
          reject(new Error("diagnostic parent cancelled host capture"));
      };
      process.on("message", cancel);
    });
    try {
      await Promise.race([
        launched.outcome,
        cancelled,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("host exceeded task deadline")),
            Math.max(1, config.deadline - Date.now()),
          );
        }),
      ]);
      assert.ok(
        fs.existsSync(path.join(config.captureDir, `vscode-${phase}.json`)),
        "host exited without completing its UI capture",
      );
    } catch (error) {
      await stopManagedHostAfterActivationFailure({ launched, phase });
      throw error;
    } finally {
      clearTimeout(timer);
      process.removeListener("message", cancel);
    }
  }
  console.log(
    JSON.stringify({
      captureDir: config.captureDir,
      status: "CAPTURED",
      observationsCreated: false,
      identityVerified: false,
      productionAttested: false,
    }),
  );
}

module.exports = { main, validateConfig, terminateOwnedHost };
if (require.main === module)
  main()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => {
      if (process.connected) process.disconnect();
    });
