#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const REPOSITORY_ROOT = path.resolve(PACKAGE_ROOT, "..", "..");
const REMOTE_USER = "cc-roadmap";
const REMOTE_HOME = `/home/${REMOTE_USER}`;
const REMOTE_DRIVER = `${REMOTE_HOME}/driver`;
const REMOTE_RUNTIME = `${REMOTE_HOME}/runtime`;
const REMOTE_WORKSPACES = Object.freeze([
  `${REMOTE_HOME}/workspace-primary`,
  `${REMOTE_HOME}/workspace-secondary`,
]);

const PINNED_VSCODE_VERSION = "1.96.4";
const PINNED_CONTAINER_IMAGE =
  "ubuntu@sha256:019e8eb29a85e74d64925745884f2ec79aa27e3feab36353d24656f4d6b89467";
const PINNED_REMOTE_SSH = Object.freeze({
  id: "ms-vscode-remote.remote-ssh",
  version: "0.120.0",
  source:
    "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/ms-vscode-remote/vsextensions/remote-ssh/0.120.0/vspackage",
  transportSha256:
    "sha256:4caa944dc6c81c8e1a345f3aefed2c0b8efacfe91ba46dff04cb6da2238b949e",
  sha256:
    "sha256:0fd6262ca183b486f6c067cb3516dccea2f87f32c049b642ff9eb77b0cea195d",
});
const STRICT_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function sha256Buffer(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function redact(value) {
  return String(value)
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/giu, "$1[REDACTED]")
    .replace(
      /((?:token|api[_-]?key|secret|password)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/giu,
      "$1[REDACTED]",
    )
    .replace(
      /\b(?:(?:ovsxat_|github_pat_|gh[pousr]_|npm_)[A-Za-z0-9._-]{8,}|glpat-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|sk-[A-Za-z0-9._-]{8,}|AKIA[0-9A-Z]{16})\b/gu,
      "[REDACTED]",
    );
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function parseArgs(argv) {
  const options = { vscodeVersion: PINNED_VSCODE_VERSION };
  const fields = new Map([
    ["--vsix", "vsix"],
    ["--candidate-manifest", "candidateManifest"],
    ["--remote-ssh-vsix", "remoteSshVsix"],
    ["--remote-ssh-payload", "remoteSshPayload"],
    ["--artifact-dir", "artifactDir"],
    ["--release-commit", "releaseCommit"],
    ["--repository", "repository"],
    ["--workflow-ref", "workflowRef"],
    ["--workflow-sha", "workflowSha"],
    ["--run-id", "runId"],
    ["--run-attempt", "runAttempt"],
    ["--job", "job"],
    ["--artifact-name", "artifactName"],
    ["--event-name", "eventName"],
    ["--server-url", "serverUrl"],
    ["--vscode-version", "vscodeVersion"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const field = fields.get(argv[index]);
    const value = argv[index + 1];
    if (!field || !value) throw new Error(`invalid argument: ${argv[index]}`);
    options[field] = value;
    index += 1;
  }
  for (const field of [
    "vsix",
    "candidateManifest",
    "remoteSshVsix",
    "remoteSshPayload",
    "artifactDir",
    "releaseCommit",
    "repository",
    "workflowRef",
    "workflowSha",
    "runId",
    "runAttempt",
    "job",
    "artifactName",
    "eventName",
    "serverUrl",
  ]) {
    if (!options[field])
      throw new Error(
        `missing --${field.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)}`,
      );
  }
  return options;
}

function runCommand(
  command,
  args,
  { cwd, diagnostics, allowFailure = false } = {},
) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10 * 60_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  diagnostics?.push({
    command,
    args: args.map((value) =>
      /(?:identityfile|knownhostsfile)/iu.test(value)
        ? value.replace(/=.*/u, "=[REDACTED_PATH]")
        : value,
    ),
    status: result.status,
    signal: result.signal,
    stdout: redact(result.stdout || "").slice(-16_384),
    stderr: redact(result.stderr || "").slice(-16_384),
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(
      `${command} failed with exit code ${String(result.status)}`,
    );
  }
  return result;
}

function assertExactCleanCheckout(releaseCommit) {
  assert.match(releaseCommit, /^[a-f0-9]{40}$/u);
  const head = runCommand("git", ["rev-parse", "HEAD"], {
    cwd: REPOSITORY_ROOT,
  }).stdout.trim();
  const dirty = runCommand(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: REPOSITORY_ROOT },
  ).stdout.trim();
  assert.equal(head, releaseCommit, "remote journey requires exact source SHA");
  assert.equal(dirty, "", "remote journey requires a clean checkout");
  return head;
}

function assertPinnedRemoteSshVsix(filePath) {
  const actual = sha256File(filePath);
  assert.equal(
    actual,
    PINNED_REMOTE_SSH.sha256,
    "official Remote-SSH VSIX digest mismatch",
  );
  return actual;
}

function assertPinnedRemoteSshPayload(filePath) {
  const actual = sha256File(filePath);
  assert.equal(
    actual,
    PINNED_REMOTE_SSH.transportSha256,
    "official Remote-SSH transport payload digest mismatch",
  );
  return actual;
}

async function verifyCandidateReleaseBinding({
  vsixPath,
  manifestPath,
  releaseCommit,
  repository,
  runId,
  serverUrl,
  packageName,
  publisher,
  version,
  verifyReleaseArtifact,
}) {
  assert.match(releaseCommit, /^[a-f0-9]{40}$/u);
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u);
  assert.match(runId, /^[1-9]\d*$/u);
  assert.equal(serverUrl, "https://github.com");
  assert.match(
    version,
    STRICT_SEMVER,
    "candidate version must be strict semver",
  );
  const resolvedVsix = path.resolve(vsixPath);
  const resolvedManifest = path.resolve(manifestPath);
  assert.ok(fs.statSync(resolvedVsix, { throwIfNoEntry: false })?.isFile());
  assert.ok(fs.statSync(resolvedManifest, { throwIfNoEntry: false })?.isFile());
  const manifest = JSON.parse(fs.readFileSync(resolvedManifest, "utf8"));
  const verifier =
    verifyReleaseArtifact ||
    (
      await import(
        pathToFileURL(
          path.join(PACKAGE_ROOT, "scripts", "vsix-release-artifact.mjs"),
        ).href
      )
    ).verifyVsixReleaseArtifact;
  const workflowRun = `${serverUrl}/${repository}/actions/runs/${runId}`;
  verifier(resolvedVsix, manifest, {
    packageName,
    publisher,
    version,
    commit: releaseCommit,
    workflowRun,
  });
  const vsixBytes = fs.readFileSync(resolvedVsix);
  const manifestBytes = fs.readFileSync(resolvedManifest);
  return Object.freeze({
    vsixSha256: sha256Buffer(vsixBytes),
    vsixBytes: vsixBytes.length,
    manifestSha256: sha256Buffer(manifestBytes),
    manifestBytes: manifestBytes.length,
    packageName: manifest.package,
    publisher: manifest.publisher,
    version: manifest.version,
    releaseCommit: manifest.commit,
    workflowRun: manifest.workflowRun,
  });
}

function assertCandidateReleaseBindingUnchanged(initial, final) {
  assert.deepEqual(
    final,
    initial,
    "candidate VSIX or manifest changed during the remote journey",
  );
}

function dockerExec(container, script, diagnostics, options = []) {
  return runCommand(
    "docker",
    ["exec", ...options, container, "bash", "-lc", script],
    { diagnostics },
  );
}

function createKnownHostsEntry(host, port, publicKeyLine) {
  assert.match(host, /^[A-Za-z0-9.-]+$/u, "invalid SSH host");
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535);
  const [algorithm, publicKey, ...remainder] = String(publicKeyLine)
    .trim()
    .split(/\s+/u);
  assert.equal(algorithm, "ssh-ed25519", "unexpected SSH host key algorithm");
  assert.match(publicKey, /^[A-Za-z0-9+/]+={0,2}$/u, "invalid SSH host key");
  assert.ok(remainder.length <= 1, "unexpected SSH host key fields");
  return `[${host}]:${port} ${algorithm} ${publicKey}\n`;
}

function waitForSshReady({ sshConfig, host, diagnostics, attempts = 30 }) {
  assert.ok(Number.isSafeInteger(attempts) && attempts > 0);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = runCommand(
      "ssh",
      ["-F", sshConfig, "-o", "BatchMode=yes", host, "true"],
      { diagnostics, allowFailure: true },
    );
    if (result.status === 0) return attempt;
    if (attempt < attempts) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
    }
  }
  throw new Error(`SSH server did not become ready after ${attempts} attempts`);
}

function stageRemoteDriver({ runRoot, config }) {
  const staged = path.join(runRoot, "remote-driver");
  fs.cpSync(
    path.join(PACKAGE_ROOT, "test", "extension-host", "driver"),
    staged,
    {
      recursive: true,
      errorOnExist: true,
    },
  );
  fs.copyFileSync(
    path.join(__dirname, "remote-runner.cjs"),
    path.join(staged, "remote-runner.cjs"),
  );
  fs.copyFileSync(
    path.join(__dirname, "remote-driver-package.json"),
    path.join(staged, "package.json"),
  );
  writeJson(path.join(staged, "remote-config.json"), config);
  return staged;
}

function createRemoteWorkspace(runRoot, cliVersion) {
  const staged = path.join(runRoot, "remote-workspace");
  fs.mkdirSync(staged, { recursive: true });
  fs.writeFileSync(
    path.join(staged, "primary.txt"),
    "remote primary\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(staged, "secondary.txt"),
    "remote secondary\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(staged, "cc"),
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "chainlesschain ${cliVersion}"; exit 0; fi\necho '{}'\n`,
    { encoding: "utf8", mode: 0o700 },
  );
  return staged;
}

function requiredArtifactNegativeControl(paths) {
  const names = [
    "exact-commit",
    "host-environment",
    "remote-environment",
    "outcome-observations",
    "redacted-diagnostics",
    "artifact-digests",
    "candidate-vsix",
    "candidate-manifest",
  ];
  const assertComplete = (candidate) => {
    for (const name of names) {
      if (
        !candidate[name] ||
        !fs.statSync(candidate[name], { throwIfNoEntry: false })?.isFile()
      ) {
        throw new Error(`missing required artifact: ${name}`);
      }
    }
  };
  assertComplete(paths);
  const incomplete = { ...paths };
  delete incomplete["remote-environment"];
  assert.throws(() => assertComplete(incomplete), /missing required artifact/u);
  return true;
}

async function writeJourneyEvidence({
  options,
  runRoot,
  semanticPaths,
  diagnosticsPath,
  remoteSshVsix,
  remoteSshPayload,
  extensionVersion,
  cliVersion,
  startedAt,
}) {
  const modulePath = path.join(
    REPOSITORY_ROOT,
    "scripts",
    "ide-journey-evidence.mjs",
  );
  const { writeIdeJourneyEvidence } = await import(
    pathToFileURL(modulePath).href
  );
  return writeIdeJourneyEvidence({
    artifactDir: path.resolve(options.artifactDir),
    journeyId:
      "vscode-installed-vsix-remote-ssh-container-host-api-multiroot-control",
    host: "vscode",
    hostVersion: options.vscodeVersion,
    operatingSystem: "linux",
    architecture: "x64",
    cliVersion,
    extensionVersion,
    transport: "remote-ssh-container",
    remoteWorkspaceFolders: [...REMOTE_WORKSPACES],
    result: semanticPaths.remoteJourneyPassed ? "passed" : "failed",
    startedAt,
    finishedAt: new Date().toISOString(),
    sourceRoots: [path.join(runRoot, "remote-runtime"), diagnosticsPath],
    artifactPaths: [remoteSshPayload, remoteSshVsix],
    roadmapArtifactPaths: Object.fromEntries(
      Object.entries(semanticPaths).filter(
        ([, value]) => typeof value === "string",
      ),
    ),
    dependencies: [PINNED_REMOTE_SSH],
    repoRoot: REPOSITORY_ROOT,
    releaseCommit: options.releaseCommit,
    requireTrustedProvenance: true,
    ciProvenance: {
      repository: options.repository,
      workflowRef: options.workflowRef,
      workflowSha: options.workflowSha,
      runId: options.runId,
      runAttempt: options.runAttempt,
      job: options.job,
      artifactName: options.artifactName,
      eventName: options.eventName,
    },
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const targetVsix = path.resolve(options.vsix);
  const candidateManifest = path.resolve(options.candidateManifest);
  const remoteSshVsix = path.resolve(options.remoteSshVsix);
  const remoteSshPayload = path.resolve(options.remoteSshPayload);
  const artifactDir = path.resolve(options.artifactDir);
  if (fs.existsSync(artifactDir) && fs.readdirSync(artifactDir).length > 0) {
    throw new Error(`artifact directory must be fresh: ${artifactDir}`);
  }
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-remote-ssh-"));
  const diagnostics = [];
  const startedAt = new Date().toISOString();
  const nonce = crypto.randomBytes(12).toString("hex");
  const container = `cc-roadmap-ssh-${nonce}`;
  const containerHostname = container;
  const remoteAuthority = `ssh-remote+${container}`;
  const marker = `chainlesschain-remote-ssh-container:${nonce}\n`;
  const markerDigest = sha256Buffer(marker);
  const extensionManifest = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
  );
  const cliManifest = JSON.parse(
    fs.readFileSync(
      path.join(REPOSITORY_ROOT, "packages", "cli", "package.json"),
      "utf8",
    ),
  );
  const semanticDir = path.join(runRoot, "semantic");
  fs.mkdirSync(semanticDir, { recursive: true });
  let containerStarted = false;
  let journeyError = null;
  let remoteEnvironment = null;
  let dockerImageId = null;
  let candidateBinding = null;
  try {
    assert.equal(options.vscodeVersion, PINNED_VSCODE_VERSION);
    assert.ok(fs.statSync(targetVsix, { throwIfNoEntry: false })?.isFile());
    assert.ok(
      fs.statSync(candidateManifest, { throwIfNoEntry: false })?.isFile(),
    );
    assert.ok(fs.statSync(remoteSshVsix, { throwIfNoEntry: false })?.isFile());
    assert.ok(
      fs.statSync(remoteSshPayload, { throwIfNoEntry: false })?.isFile(),
    );
    assertExactCleanCheckout(options.releaseCommit);
    assert.match(
      extensionManifest.version,
      STRICT_SEMVER,
      "extension version must be strict semver",
    );
    assert.match(
      cliManifest.version,
      STRICT_SEMVER,
      "CLI version must be strict semver",
    );
    candidateBinding = await verifyCandidateReleaseBinding({
      vsixPath: targetVsix,
      manifestPath: candidateManifest,
      releaseCommit: options.releaseCommit,
      repository: options.repository,
      runId: options.runId,
      serverUrl: options.serverUrl,
      packageName: extensionManifest.name,
      publisher: extensionManifest.publisher,
      version: extensionManifest.version,
    });
    assertPinnedRemoteSshVsix(remoteSshVsix);
    assertPinnedRemoteSshPayload(remoteSshPayload);

    runCommand("docker", ["pull", PINNED_CONTAINER_IMAGE], { diagnostics });
    dockerImageId = runCommand(
      "docker",
      ["image", "inspect", "--format={{.Id}}", PINNED_CONTAINER_IMAGE],
      { diagnostics },
    ).stdout.trim();
    runCommand(
      "docker",
      [
        "run",
        "--detach",
        "--name",
        container,
        "--hostname",
        containerHostname,
        "--publish",
        "127.0.0.1::22",
        PINNED_CONTAINER_IMAGE,
        "sleep",
        "infinity",
      ],
      { diagnostics },
    );
    containerStarted = true;
    dockerExec(
      container,
      "export DEBIAN_FRONTEND=noninteractive; apt-get update; apt-get install -y --no-install-recommends ca-certificates openssh-server unzip nodejs; useradd --create-home --shell /bin/bash cc-roadmap; mkdir -p /run/sshd",
      diagnostics,
    );
    runCommand(
      "ssh-keygen",
      ["-q", "-t", "ed25519", "-N", "", "-f", path.join(runRoot, "id_ed25519")],
      { diagnostics },
    );
    runCommand(
      "docker",
      [
        "cp",
        `${path.join(runRoot, "id_ed25519.pub")}`,
        `${container}:/tmp/authorized_key`,
      ],
      { diagnostics },
    );
    dockerExec(
      container,
      `install -d -m 700 -o ${REMOTE_USER} -g ${REMOTE_USER} ${REMOTE_HOME}/.ssh; install -m 600 -o ${REMOTE_USER} -g ${REMOTE_USER} /tmp/authorized_key ${REMOTE_HOME}/.ssh/authorized_keys; printf '%s' '${marker.trim()}' > /etc/chainlesschain-remote-id; chmod 0444 /etc/chainlesschain-remote-id; ssh-keygen -A`,
      diagnostics,
    );
    runCommand(
      "docker",
      ["exec", "--detach", container, "/usr/sbin/sshd", "-D", "-e"],
      { diagnostics },
    );
    const portOutput = runCommand("docker", ["port", container, "22/tcp"], {
      diagnostics,
    }).stdout.trim();
    const port = Number(portOutput.match(/:(\d+)$/u)?.[1]);
    assert.ok(
      Number.isInteger(port) && port > 0,
      `invalid SSH port: ${portOutput}`,
    );
    const hostPublicKey = dockerExec(
      container,
      "cat /etc/ssh/ssh_host_ed25519_key.pub",
      diagnostics,
    ).stdout;
    const knownHosts = createKnownHostsEntry("127.0.0.1", port, hostPublicKey);
    const knownHostsPath = path.join(runRoot, "known_hosts");
    fs.writeFileSync(knownHostsPath, knownHosts, {
      mode: 0o600,
    });
    const sshConfigPath = path.join(runRoot, "ssh_config");
    const sshConfig = [
      `Host ${container}`,
      "  HostName 127.0.0.1",
      `  Port ${port}`,
      `  User ${REMOTE_USER}`,
      `  IdentityFile ${path.join(runRoot, "id_ed25519")}`,
      "  IdentitiesOnly yes",
      "  StrictHostKeyChecking yes",
      `  UserKnownHostsFile ${knownHostsPath}`,
      "  ConnectTimeout 1",
      "  ConnectionAttempts 1",
      "",
    ].join("\n");
    fs.writeFileSync(sshConfigPath, sshConfig, {
      mode: 0o600,
    });
    waitForSshReady({
      sshConfig: sshConfigPath,
      host: container,
      diagnostics,
    });

    const remoteConfig = {
      schema: "chainlesschain.remote-ssh-container-config.v1",
      releaseCommit: options.releaseCommit,
      extensionVersion: extensionManifest.version,
      candidateVsixPath: "/tmp/chainlesschain-ide.vsix",
      candidateVsixSha256: candidateBinding.vsixSha256,
      candidateVsixBytes: candidateBinding.vsixBytes,
      remoteAuthority,
      containerHostname,
      containerMarkerPath: "/etc/chainlesschain-remote-id",
      containerMarkerDigest: markerDigest,
      runtimeDirectory: REMOTE_RUNTIME,
      smokeEnvironment: {
        CHAINLESSCHAIN_SMOKE_EXTENSIONS_DIR: `${REMOTE_HOME}/.vscode-server/extensions`,
        CHAINLESSCHAIN_SMOKE_EXPECTED_VERSION: extensionManifest.version,
        CHAINLESSCHAIN_SMOKE_WORKSPACE: REMOTE_WORKSPACES[0],
        CHAINLESSCHAIN_SMOKE_WORKSPACE_FOLDERS:
          JSON.stringify(REMOTE_WORKSPACES),
        CHAINLESSCHAIN_HOST_JOURNEY_PHASE: "initial",
        CHAINLESSCHAIN_HOST_JOURNEY_MODE: "host-api",
        CHAINLESSCHAIN_HOST_READY_FILE: `${REMOTE_RUNTIME}/host-ready.json`,
        CHAINLESSCHAIN_HOST_RESULT_FILE: `${REMOTE_RUNTIME}/host-result.json`,
        CHAINLESSCHAIN_HOST_TRACE_FILE: `${REMOTE_RUNTIME}/host-trace.jsonl`,
        CC_UI_FIXTURE_STATE: `${REMOTE_RUNTIME}/fixture-state.json`,
        CC_UI_FIXTURE_TRACE: `${REMOTE_RUNTIME}/fixture-trace.jsonl`,
      },
    };
    const stagedDriver = stageRemoteDriver({ runRoot, config: remoteConfig });
    const stagedWorkspace = createRemoteWorkspace(runRoot, cliManifest.version);
    runCommand(
      "docker",
      ["cp", stagedDriver, `${container}:${REMOTE_DRIVER}`],
      { diagnostics },
    );
    const preCopyBinding = await verifyCandidateReleaseBinding({
      vsixPath: targetVsix,
      manifestPath: candidateManifest,
      releaseCommit: options.releaseCommit,
      repository: options.repository,
      runId: options.runId,
      serverUrl: options.serverUrl,
      packageName: extensionManifest.name,
      publisher: extensionManifest.publisher,
      version: extensionManifest.version,
    });
    assertCandidateReleaseBindingUnchanged(candidateBinding, preCopyBinding);
    runCommand(
      "docker",
      ["cp", targetVsix, `${container}:/tmp/chainlesschain-ide.vsix`],
      { diagnostics },
    );
    dockerExec(
      container,
      `mkdir -p ${REMOTE_WORKSPACES.join(" ")} ${REMOTE_RUNTIME} ${REMOTE_HOME}/bin`,
      diagnostics,
    );
    runCommand(
      "docker",
      [
        "cp",
        path.join(stagedWorkspace, "primary.txt"),
        `${container}:${REMOTE_WORKSPACES[0]}/primary.txt`,
      ],
      { diagnostics },
    );
    runCommand(
      "docker",
      [
        "cp",
        path.join(stagedWorkspace, "secondary.txt"),
        `${container}:${REMOTE_WORKSPACES[1]}/secondary.txt`,
      ],
      { diagnostics },
    );
    runCommand(
      "docker",
      [
        "cp",
        path.join(stagedWorkspace, "cc"),
        `${container}:${REMOTE_HOME}/bin/cc`,
      ],
      { diagnostics },
    );
    const workspace = {
      folders: REMOTE_WORKSPACES.map((folder, index) => ({
        name: index === 0 ? "primary" : "secondary",
        path: folder,
      })),
      settings: {
        "chainlesschain.ide.enabled": true,
        "chainlesschain.cli.managed.enabled": false,
        "chainlesschain.cli.path": `${REMOTE_HOME}/bin/cc`,
        "extensions.autoCheckUpdates": false,
        "extensions.autoUpdate": false,
        "telemetry.telemetryLevel": "off",
        "update.mode": "none",
      },
    };
    const workspaceFile = path.join(runRoot, "chainlesschain.code-workspace");
    fs.writeFileSync(workspaceFile, `${JSON.stringify(workspace, null, 2)}\n`);
    runCommand(
      "docker",
      [
        "cp",
        workspaceFile,
        `${container}:${REMOTE_HOME}/chainlesschain.code-workspace`,
      ],
      { diagnostics },
    );
    dockerExec(
      container,
      `set -euo pipefail; test "$(sha256sum /tmp/chainlesschain-ide.vsix | cut -d ' ' -f 1)" = "${candidateBinding.vsixSha256.slice("sha256:".length)}"; test "$(stat -c %s /tmp/chainlesschain-ide.vsix)" = "${candidateBinding.vsixBytes}"; mkdir -p /tmp/cc-vsix ${REMOTE_HOME}/.vscode-server/extensions; unzip -q /tmp/chainlesschain-ide.vsix -d /tmp/cc-vsix; test -f /tmp/cc-vsix/extension/package.json; mv /tmp/cc-vsix/extension ${REMOTE_HOME}/.vscode-server/extensions/chainlesschain.chainlesschain-ide-${extensionManifest.version}; chmod 700 ${REMOTE_HOME}/bin/cc; chown -R ${REMOTE_USER}:${REMOTE_USER} ${REMOTE_HOME}`,
      diagnostics,
    );

    const {
      downloadAndUnzipVSCode,
      runTests,
      runVSCodeCommand,
    } = require("@vscode/test-electron");
    const vscodeOptions = { version: options.vscodeVersion };
    const vscodeExecutablePath = await downloadAndUnzipVSCode(vscodeOptions);
    const localExtensions = path.join(runRoot, "local-extensions");
    const userData = path.join(runRoot, "user-data");
    fs.mkdirSync(path.join(userData, "User"), { recursive: true });
    fs.writeFileSync(
      path.join(userData, "User", "settings.json"),
      `${JSON.stringify(
        {
          "remote.SSH.configFile": sshConfigPath,
          "remote.SSH.remotePlatform": { [container]: "linux" },
          "remote.SSH.localServerDownload": "always",
          "remote.SSH.useLocalServer": false,
          "remote.SSH.enableDynamicForwarding": true,
          "telemetry.telemetryLevel": "off",
          "update.mode": "none",
        },
        null,
        2,
      )}\n`,
    );
    await runVSCodeCommand(
      [
        `--extensions-dir=${localExtensions}`,
        `--user-data-dir=${userData}`,
        "--install-extension",
        remoteSshVsix,
        "--force",
      ],
      { ...vscodeOptions, vscodeExecutablePath },
    );
    const listed = await runVSCodeCommand(
      [
        `--extensions-dir=${localExtensions}`,
        `--user-data-dir=${userData}`,
        "--list-extensions",
        "--show-versions",
      ],
      { ...vscodeOptions, vscodeExecutablePath },
    );
    assert.ok(
      listed.stdout
        .toLowerCase()
        .split(/\r?\n/u)
        .includes(`${PINNED_REMOTE_SSH.id}@${PINNED_REMOTE_SSH.version}`),
      "pinned Remote-SSH extension was not installed",
    );
    const vscodeLog = fs.createWriteStream(
      path.join(runRoot, "vscode-remote-ssh.log"),
      { flags: "wx", mode: 0o600 },
    );
    try {
      await runTests({
        vscodeExecutablePath,
        extensionDevelopmentPath: REMOTE_DRIVER,
        extensionTestsPath: `${REMOTE_DRIVER}/remote-runner.cjs`,
        launchArgs: [
          `--extensions-dir=${localExtensions}`,
          `--user-data-dir=${userData}`,
          `--remote=${remoteAuthority}`,
          `--file-uri=vscode-remote://${remoteAuthority}${REMOTE_HOME}/chainlesschain.code-workspace`,
          "--disable-extension-update-checks",
          "--disable-telemetry",
          "--disable-crash-reporter",
        ],
        reuseMachineInstall: true,
        stdout: vscodeLog,
        stderr: vscodeLog,
      });
    } finally {
      await new Promise((resolve) => vscodeLog.end(resolve));
    }
    runCommand(
      "docker",
      [
        "cp",
        `${container}:${REMOTE_RUNTIME}`,
        path.join(runRoot, "remote-runtime"),
      ],
      { diagnostics },
    );
    remoteEnvironment = JSON.parse(
      fs.readFileSync(
        path.join(runRoot, "remote-runtime", "remote-environment.json"),
        "utf8",
      ),
    );
    assert.equal(remoteEnvironment.journeyPassed, true);
  } catch (error) {
    journeyError = error;
  } finally {
    if (candidateBinding) {
      try {
        const finalBinding = await verifyCandidateReleaseBinding({
          vsixPath: targetVsix,
          manifestPath: candidateManifest,
          releaseCommit: options.releaseCommit,
          repository: options.repository,
          runId: options.runId,
          serverUrl: options.serverUrl,
          packageName: extensionManifest.name,
          publisher: extensionManifest.publisher,
          version: extensionManifest.version,
        });
        assertCandidateReleaseBindingUnchanged(candidateBinding, finalBinding);
      } catch (error) {
        journeyError = journeyError
          ? new AggregateError(
              [journeyError, error],
              "remote journey and final candidate verification failed",
            )
          : error;
      }
    }
    if (containerStarted) {
      runCommand("docker", ["rm", "--force", container], {
        diagnostics,
        allowFailure: true,
      });
    }
  }

  const diagnosticsPath = path.join(semanticDir, "redacted-diagnostics.json");
  writeJson(diagnosticsPath, {
    schema: "chainlesschain.ide-redacted-diagnostics.v1",
    records: diagnostics,
    journeyFailureDigest: journeyError
      ? sha256Buffer(String(journeyError?.stack || journeyError))
      : null,
  });
  const exactCommitPath = path.join(semanticDir, "exact-commit.json");
  writeJson(exactCommitPath, {
    releaseCommit: options.releaseCommit,
    gitHead: options.releaseCommit,
  });
  const hostEnvironmentPath = path.join(semanticDir, "host-environment.json");
  writeJson(hostEnvironmentPath, {
    schema: "chainlesschain.ide-host-environment.v1",
    operatingSystem: process.platform,
    architecture: process.arch,
    orchestratorPid: process.pid,
    orchestratorHostname: os.hostname(),
    dockerImageId,
    containerImageRef: PINNED_CONTAINER_IMAGE,
    containerHostname,
    containerMarkerDigest: markerDigest,
    remoteSsh: PINNED_REMOTE_SSH,
    candidate: candidateBinding,
    vscodeVersion: options.vscodeVersion,
  });
  const remoteEnvironmentPath = path.join(
    semanticDir,
    "remote-environment.json",
  );
  writeJson(
    remoteEnvironmentPath,
    remoteEnvironment || {
      schema: "chainlesschain.remote-ssh-container-observation.v1",
      journeyPassed: false,
      failureDigest: sha256Buffer(String(journeyError?.stack || journeyError)),
    },
  );
  const artifactDigestsPath = path.join(semanticDir, "artifact-digests.json");
  writeJson(artifactDigestsPath, {
    targetVsix: sha256File(targetVsix),
    candidateManifest: sha256File(candidateManifest),
    candidateVersion: candidateBinding?.version || null,
    candidateReleaseCommit: candidateBinding?.releaseCommit || null,
    remoteSshVsix: sha256File(remoteSshVsix),
    remoteSshTransportPayload: sha256File(remoteSshPayload),
    remoteSshSource: PINNED_REMOTE_SSH.source,
    dockerImageId,
  });
  const semanticPaths = {
    "exact-commit": exactCommitPath,
    "host-environment": hostEnvironmentPath,
    "remote-environment": remoteEnvironmentPath,
    "redacted-diagnostics": diagnosticsPath,
    "artifact-digests": artifactDigestsPath,
    "candidate-vsix": targetVsix,
    "candidate-manifest": candidateManifest,
  };
  const outcomePath = path.join(semanticDir, "outcome-observations.json");
  semanticPaths["outcome-observations"] = outcomePath;
  const immutabilityProbe = path.join(runRoot, "immutable-probe.json");
  writeJson(immutabilityProbe, { nonce });
  let replacementCount = 0;
  try {
    writeJson(immutabilityProbe, { replacement: true });
    replacementCount += 1;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const credentialPattern =
    /\b(?:(?:ovsxat_|github_pat_|gh[pousr]_|npm_)[A-Za-z0-9._-]{8,}|glpat-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|sk-[A-Za-z0-9._-]{8,}|AKIA[0-9A-Z]{16})\b/gu;
  const credentialLeakCount = Object.values(semanticPaths)
    .filter(
      (value) =>
        typeof value === "string" &&
        fs.existsSync(value) &&
        [".json", ".log", ".txt"].includes(path.extname(value).toLowerCase()) &&
        fs.statSync(value).size <= 1024 * 1024,
    )
    .reduce(
      (count, filePath) =>
        count +
        (fs.readFileSync(filePath, "utf8").match(credentialPattern)?.length ||
          0),
      0,
    );
  writeJson(outcomePath, {
    schema: "chainlesschain.ide-roadmap-outcome-observations.v1",
    missingRequiredArtifactsFail:
      requiredArtifactNegativeControl(semanticPaths),
    credentialLeakCount,
    wrongCommitBindingCount:
      remoteEnvironment?.releaseCommit === options.releaseCommit ? 0 : 1,
    evidenceReplacementCount: replacementCount,
    orderedWorkspaceRootsBound:
      JSON.stringify(remoteEnvironment?.orderedWorkspacePaths) ===
      JSON.stringify(REMOTE_WORKSPACES),
    workspaceRootCount: remoteEnvironment?.orderedWorkspacePaths?.length || 0,
    remoteTransportExercised:
      remoteEnvironment?.remoteName === "ssh-remote" &&
      remoteEnvironment?.journeyPassed === true,
  });
  semanticPaths.remoteJourneyPassed = remoteEnvironment?.journeyPassed === true;
  const evidence = await writeJourneyEvidence({
    options,
    runRoot,
    semanticPaths,
    diagnosticsPath,
    remoteSshVsix,
    remoteSshPayload,
    extensionVersion: extensionManifest.version,
    cliVersion: cliManifest.version,
    startedAt,
  });
  process.stdout.write(
    `${JSON.stringify({ destination: evidence.destination, evidenceDigest: evidence.evidence.evidenceDigest })}\n`,
  );
  if (journeyError) throw journeyError;
  if (!evidence.evidence.evidenceComplete) {
    throw new Error("Remote-SSH journey evidence is incomplete");
  }
}

module.exports = {
  PINNED_REMOTE_SSH,
  PINNED_CONTAINER_IMAGE,
  PINNED_VSCODE_VERSION,
  assertPinnedRemoteSshVsix,
  assertPinnedRemoteSshPayload,
  assertCandidateReleaseBindingUnchanged,
  createKnownHostsEntry,
  parseArgs,
  requiredArtifactNegativeControl,
  verifyCandidateReleaseBinding,
  waitForSshReady,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `[remote-ssh-container] FAIL ${error?.stack || error}\n`,
    );
    process.exitCode = 1;
  });
}
