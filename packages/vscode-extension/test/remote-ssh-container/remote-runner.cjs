"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");

const EXTENSION_ID = "chainlesschain.chainlesschain-ide";

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function writeImmutableJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function loadConfig() {
  const configPath = path.join(__dirname, "remote-config.json");
  const value = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(value.schema, "chainlesschain.remote-ssh-container-config.v1");
  return value;
}

async function run() {
  const config = loadConfig();
  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  assert.equal(
    vscode.env.remoteName,
    "ssh-remote",
    "the journey must execute in the Remote-SSH extension host",
  );
  assert.equal(workspaceFolders.length, 2, "two remote roots are required");
  assert.deepEqual(
    workspaceFolders.map((folder) => folder.uri.scheme),
    ["vscode-remote", "vscode-remote"],
    "workspace roots must be VS Code remote resources",
  );
  for (const folder of workspaceFolders) {
    assert.equal(folder.uri.authority, config.remoteAuthority);
  }
  assert.equal(os.hostname(), config.containerHostname);
  const marker = fs.readFileSync(config.containerMarkerPath);
  assert.equal(sha256(marker), config.containerMarkerDigest);
  const remoteHome = fs.realpathSync(path.dirname(config.runtimeDirectory));
  const extensionHostCwd = fs.realpathSync(process.cwd());
  const cwdRelativeToRemoteHome = path.relative(remoteHome, extensionHostCwd);
  assert.ok(
    cwdRelativeToRemoteHome === "" ||
      (cwdRelativeToRemoteHome !== ".." &&
        !cwdRelativeToRemoteHome.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(cwdRelativeToRemoteHome)),
    `extension-host cwd is not inside the container user home: ${extensionHostCwd}`,
  );

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `installed extension ${EXTENSION_ID} was not found`);
  const exactExtensionPath = `/home/cc-roadmap/.vscode-server/extensions/chainlesschain.chainlesschain-ide-${config.extensionVersion}`;
  assert.equal(
    fs.realpathSync(extension.extensionPath),
    exactExtensionPath,
    `target extension is not installed at the exact remote VS Code Server path: ${extension.extensionPath}`,
  );
  assert.equal(extension.packageJSON.version, config.extensionVersion);
  const remoteCandidateBytes = fs.readFileSync(config.candidateVsixPath);
  assert.equal(sha256(remoteCandidateBytes), config.candidateVsixSha256);
  assert.equal(remoteCandidateBytes.length, config.candidateVsixBytes);

  Object.assign(process.env, config.smokeEnvironment);
  const remoteEnvironmentPath = path.join(
    config.runtimeDirectory,
    "remote-environment.json",
  );
  const base = {
    schema: "chainlesschain.remote-ssh-container-observation.v1",
    remoteName: vscode.env.remoteName,
    remoteAuthority: workspaceFolders[0].uri.authority,
    workspaceSchemes: workspaceFolders.map((folder) => folder.uri.scheme),
    orderedWorkspacePaths: workspaceFolders.map((folder) => folder.uri.fsPath),
    extensionHostPid: process.pid,
    extensionHostCwd,
    extensionPath: fs.realpathSync(extension.extensionPath),
    extensionVersion: extension.packageJSON.version,
    candidateVsixSha256: sha256(remoteCandidateBytes),
    candidateVsixBytes: remoteCandidateBytes.length,
    containerHostname: os.hostname(),
    containerMarkerDigest: sha256(marker),
    releaseCommit: config.releaseCommit,
    journeyPassed: false,
  };
  try {
    const smoke = require("./smoke.cjs");
    await smoke.run();
    const trace = fs
      .readFileSync(
        config.smokeEnvironment.CHAINLESSCHAIN_HOST_TRACE_FILE,
        "utf8",
      )
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const stages = new Set(trace.map((entry) => entry.stage));
    const requiredStages = [
      "installed-vsix-discovered",
      "vsix-activated",
      "commands-verified",
      "bridge-verified",
      "view-command-dispatched",
      "phase-completed",
    ];
    for (const stage of requiredStages) {
      assert.ok(stages.has(stage), `real host journey did not record ${stage}`);
    }
    writeImmutableJson(remoteEnvironmentPath, {
      ...base,
      journeyPassed: true,
      hostJourneyStages: requiredStages,
    });
  } catch (error) {
    writeImmutableJson(remoteEnvironmentPath, {
      ...base,
      failureDigest: sha256(String(error?.stack || error)),
    });
    throw error;
  }
}

module.exports = { run };

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(
      `[remote-ssh-container] FAIL ${error?.stack || error}\n`,
    );
    process.exitCode = 1;
  });
}
