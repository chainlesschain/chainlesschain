"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { IdeMcpServer } = require("../../src/mcp-http-server.js");

const REPOSITORY_ROOT = path.resolve(__dirname, "../../../..");
const SHA_RE = /^[a-f0-9]{40}$/u;
const TOKEN_RE = /^[a-f0-9]{64}$/u;
const REQUIRED_PHASES = Object.freeze([
  "environment-attested",
  "unauthorized-request-denied",
  "initial-bridge-connected",
  "durable-checkpoint-1",
  "network-disconnect-survived",
  "bridge-process-killed",
  "old-listener-unreachable",
  "bridge-process-restarted",
  "durable-checkpoint-2",
]);

function parseArgs(argv) {
  const options = { child: false, environmentCheck: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--bridge-child") {
      options.child = true;
      continue;
    }
    const key = value
      .replace(/^--/u, "")
      .replace(/-([a-z])/gu, (_, c) => c.toUpperCase());
    if (!value.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(`invalid argument: ${value}`);
    }
    options[key] = argv[index + 1];
    index += 1;
  }
  return options;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function writeJsonDurable(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, `${canonicalJson(value)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, filePath);
  if (process.platform !== "win32") {
    const directory = fs.openSync(path.dirname(filePath), "r");
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveGitHead(root) {
  let gitDirectory = path.join(root, ".git");
  const stat = fs.statSync(gitDirectory);
  if (stat.isFile()) {
    const pointer = fs.readFileSync(gitDirectory, "utf8").trim();
    assert.match(pointer, /^gitdir: /u);
    gitDirectory = path.resolve(root, pointer.slice("gitdir: ".length));
  }
  const head = fs.readFileSync(path.join(gitDirectory, "HEAD"), "utf8").trim();
  if (SHA_RE.test(head)) return head;
  assert.match(head, /^ref: refs\//u);
  const ref = head.slice("ref: ".length);
  const loose = path.join(gitDirectory, ...ref.split("/"));
  if (fs.existsSync(loose)) {
    const value = fs.readFileSync(loose, "utf8").trim();
    assert.match(value, SHA_RE);
    return value;
  }
  const packed = fs.readFileSync(
    path.join(gitDirectory, "packed-refs"),
    "utf8",
  );
  const match = packed
    .split(/\r?\n/u)
    .map((line) => line.split(" "))
    .find((parts) => parts[1] === ref);
  assert.ok(match, `git ref is not materialized: ${ref}`);
  assert.match(match[0], SHA_RE);
  return match[0];
}

function environmentEvidence(transport, expectedCommit, check) {
  const version = fs.existsSync("/proc/version")
    ? fs.readFileSync("/proc/version", "utf8").trim().slice(0, 512)
    : os.version().slice(0, 512);
  const isWsl =
    process.platform === "linux" &&
    (Boolean(process.env.WSL_DISTRO_NAME) || /microsoft|wsl/iu.test(version));
  const isContainer =
    process.platform === "linux" &&
    (fs.existsSync("/.dockerenv") ||
      /docker|containerd|kubepods/iu.test(version));
  const isSsh =
    process.platform === "linux" &&
    typeof process.env.SSH_CONNECTION === "string" &&
    process.env.SSH_CONNECTION.trim().length > 0;
  if (check === "wsl") {
    assert.equal(transport, "wsl");
    assert.equal(isWsl, true, "the WSL cell did not run inside WSL");
  } else if (check === "devcontainer") {
    assert.equal(transport, "devcontainer");
    assert.equal(
      isContainer,
      true,
      "the devcontainer cell did not run in a container",
    );
    assert.equal(process.env.CC_IDE_ROADMAP_TRANSPORT, "devcontainer");
  } else if (check === "ssh") {
    assert.equal(transport, "ssh");
    assert.equal(isSsh, true, "the SSH cell did not run through sshd");
    assert.equal(process.env.CC_IDE_ROADMAP_TRANSPORT, "ssh");
  } else if (check !== "local") {
    throw new Error(`unsupported environment check: ${check}`);
  }
  assert.equal(resolveGitHead(REPOSITORY_ROOT), expectedCommit);
  return {
    schema: "chainlesschain.ide-host-environment.v1",
    transport,
    platform: process.platform,
    architecture: process.arch,
    release: os.release(),
    version,
    isWsl,
    isContainer,
    isSsh,
    sshConnectionDigest: isSsh
      ? sha256(Buffer.from(process.env.SSH_CONNECTION, "utf8"))
      : null,
    wslDistro: isWsl ? process.env.WSL_DISTRO_NAME || "detected" : null,
    nodeVersion: process.version,
    exactCommitBound: true,
  };
}

function postJson({ port, token, body, destroyAfterMs = null }) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "content-length": String(payload.length),
        },
        timeout: 5000,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode,
            body: text ? JSON.parse(text) : null,
          });
        });
      },
    );
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("request timeout")));
    request.end(payload);
    if (destroyAfterMs !== null) {
      setTimeout(
        () => request.destroy(new Error("injected network disconnect")),
        destroyAfterMs,
      );
    }
  });
}

function waitForFile(filePath, child, timeoutMs = 15000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (fs.existsSync(filePath)) return resolve(readJson(filePath));
      if (child.exitCode !== null)
        return reject(new Error(`bridge child exited ${child.exitCode}`));
      if (Date.now() - started > timeoutMs)
        return reject(new Error("bridge child readiness timeout"));
      setTimeout(poll, 25);
    };
    poll();
  });
}

function waitForExit(child, timeoutMs = 10000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("bridge child termination timeout")),
      timeoutMs,
    );
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function startBridgeChild({
  statePath,
  readyPath,
  token,
  generation,
  logPath,
}) {
  const output = fs.openSync(logPath, "a", 0o600);
  const child = spawn(
    process.execPath,
    [
      __filename,
      "--bridge-child",
      "--state",
      statePath,
      "--ready",
      readyPath,
      "--token",
      token,
      "--generation",
      String(generation),
    ],
    {
      stdio: ["ignore", output, output],
      env: { ...process.env, CC_BRIDGE_CHILD: "1" },
    },
  );
  fs.closeSync(output);
  return child;
}

async function runBridgeChild(options) {
  assert.match(options.token, TOKEN_RE);
  const generation = Number(options.generation);
  assert.ok(Number.isSafeInteger(generation) && generation > 0);
  const checkpoint = () => {
    const state = readJson(options.state);
    assert.match(state.releaseCommit, SHA_RE);
    const next = { ...state, sequence: state.sequence + 1, generation };
    writeJsonDurable(options.state, next);
    return {
      releaseCommit: next.releaseCommit,
      sequence: next.sequence,
      generation,
    };
  };
  const server = new IdeMcpServer({
    token: options.token,
    tools: [
      {
        name: "checkpoint",
        description: "Persist a recovery sequence",
        inputSchema: { type: "object", additionalProperties: false },
        handler: checkpoint,
      },
      {
        name: "hold",
        description: "Hold a request while its client disconnects",
        inputSchema: {
          type: "object",
          properties: { delayMs: { type: "integer" } },
        },
        handler: ({ delayMs }) =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ held: true }), Number(delayMs)),
          ),
      },
    ],
  });
  const port = await server.start();
  writeJsonDurable(options.ready, {
    schema: "chainlesschain.bridge-ready.v1",
    generation,
    port,
  });
  const stop = async () => {
    await server.stop();
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

function provenance(artifactName) {
  return {
    repository: process.env.GITHUB_REPOSITORY || "local",
    workflowRef: process.env.GITHUB_WORKFLOW_REF || "local",
    workflowSha: process.env.GITHUB_WORKFLOW_SHA || "local",
    runId: process.env.GITHUB_RUN_ID || "local",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || "local",
    job: process.env.GITHUB_JOB || "local",
    artifactName,
    eventName: process.env.GITHUB_EVENT_NAME || "local",
  };
}

function writeEvidenceBundle(artifactDir, documents) {
  fs.mkdirSync(artifactDir, { recursive: true });
  const hashes = {};
  for (const [name, value] of Object.entries(documents)) {
    const bytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
    fs.writeFileSync(path.join(artifactDir, name), bytes, { mode: 0o600 });
    hashes[name] = { sha256: sha256(bytes), bytes: bytes.length };
  }
  writeJsonDurable(path.join(artifactDir, "manifest.json"), {
    schema: "chainlesschain.ide-host-recovery-manifest.v1",
    files: hashes,
  });
}

async function runParent(options) {
  const releaseCommit = String(options.releaseCommit || "").toLowerCase();
  const transport = String(options.transport || "");
  const artifactDir = path.resolve(options.artifactDir || "");
  const artifactName = String(options.artifactName || "local-host-recovery");
  assert.match(releaseCommit, SHA_RE);
  assert.match(transport, /^(?:wsl|devcontainer|ssh|local)$/u);
  if (fs.existsSync(artifactDir) && fs.readdirSync(artifactDir).length > 0) {
    throw new Error(`artifact directory must be fresh: ${artifactDir}`);
  }
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-host-recovery-"));
  const statePath = path.join(runRoot, "state.json");
  const logPath = path.join(runRoot, "bridge.log");
  const token = crypto.randomBytes(32).toString("hex");
  const phases = [];
  let child = null;
  try {
    const environment = environmentEvidence(
      transport,
      releaseCommit,
      options.environmentCheck || transport,
    );
    phases.push("environment-attested");
    writeJsonDurable(statePath, { releaseCommit, sequence: 0, generation: 0 });

    const readyOnePath = path.join(runRoot, "ready-1.json");
    child = startBridgeChild({
      statePath,
      readyPath: readyOnePath,
      token,
      generation: 1,
      logPath,
    });
    const readyOne = await waitForFile(readyOnePath, child);
    const denied = await postJson({
      port: readyOne.port,
      token: "0".repeat(64),
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    assert.equal(denied.status, 401);
    phases.push("unauthorized-request-denied");
    const initialized = await postJson({
      port: readyOne.port,
      token,
      body: { jsonrpc: "2.0", id: 2, method: "initialize", params: {} },
    });
    assert.equal(initialized.status, 200);
    phases.push("initial-bridge-connected");
    const first = await postJson({
      port: readyOne.port,
      token,
      body: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "checkpoint", arguments: {} },
      },
    });
    assert.equal(
      first.body.result.content[0].text.includes('"sequence":1'),
      true,
    );
    phases.push("durable-checkpoint-1");
    await assert.rejects(
      postJson({
        port: readyOne.port,
        token,
        body: {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "hold", arguments: { delayMs: 250 } },
        },
        destroyAfterMs: 25,
      }),
      /injected network disconnect/u,
    );
    const survived = await postJson({
      port: readyOne.port,
      token,
      body: { jsonrpc: "2.0", id: 5, method: "initialize", params: {} },
    });
    assert.equal(survived.status, 200);
    phases.push("network-disconnect-survived");

    child.kill("SIGKILL");
    await waitForExit(child);
    child = null;
    phases.push("bridge-process-killed");
    await assert.rejects(
      postJson({
        port: readyOne.port,
        token,
        body: { jsonrpc: "2.0", id: 6, method: "initialize", params: {} },
      }),
      /ECONNREFUSED|socket hang up|ECONNRESET/u,
    );
    phases.push("old-listener-unreachable");

    const readyTwoPath = path.join(runRoot, "ready-2.json");
    child = startBridgeChild({
      statePath,
      readyPath: readyTwoPath,
      token,
      generation: 2,
      logPath,
    });
    const readyTwo = await waitForFile(readyTwoPath, child);
    assert.notEqual(readyTwo.generation, readyOne.generation);
    phases.push("bridge-process-restarted");
    const second = await postJson({
      port: readyTwo.port,
      token,
      body: {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "checkpoint", arguments: {} },
      },
    });
    assert.equal(
      second.body.result.content[0].text.includes('"sequence":2'),
      true,
    );
    assert.deepEqual(readJson(statePath), {
      releaseCommit,
      sequence: 2,
      generation: 2,
    });
    phases.push("durable-checkpoint-2");
    assert.deepEqual(phases, REQUIRED_PHASES);

    child.kill("SIGTERM");
    await waitForExit(child);
    child = null;
    const logBytes = fs.existsSync(logPath)
      ? fs.readFileSync(logPath)
      : Buffer.alloc(0);
    assert.equal(logBytes.includes(Buffer.from(token, "utf8")), false);
    const packageBytes = fs.readFileSync(
      path.join(REPOSITORY_ROOT, "packages/vscode-extension/package.json"),
    );
    const cliBytes = fs.readFileSync(
      path.join(REPOSITORY_ROOT, "packages/cli/package.json"),
    );
    const trustedProvenance = provenance(artifactName);
    writeEvidenceBundle(artifactDir, {
      "exact-commit.json": {
        schema: "chainlesschain.ide-host-recovery-exact-commit.v1",
        releaseCommit,
        gitHead: resolveGitHead(REPOSITORY_ROOT),
      },
      "host-environment.json": environment,
      "bridge-restart.json": {
        schema: "chainlesschain.ide-bridge-restart-evidence.v1",
        phases,
        initialGeneration: readyOne.generation,
        recoveredGeneration: readyTwo.generation,
        durableSequence: 2,
      },
      "network-fault.json": {
        schema: "chainlesschain.ide-network-fault-evidence.v1",
        injectedDisconnectCount: 1,
        reconnectCount: 1,
        staleListenerAcceptanceCount: 0,
      },
      "candidate-digests.json": {
        schema: "chainlesschain.ide-host-recovery-candidate-digests.v1",
        vscodePackage: sha256(packageBytes),
        cliPackage: sha256(cliBytes),
      },
      "redacted-diagnostics.json": {
        schema: "chainlesschain.ide-host-recovery-diagnostics.v1",
        bridgeLogDigest: sha256(logBytes),
        bridgeLogBytes: logBytes.length,
        credentialLeakCount: 0,
      },
      "outcome-observations.json": {
        schema: "chainlesschain.ide-host-recovery-outcome.v1",
        transport,
        success: true,
        exactCommitBound: true,
        unauthorizedAcceptanceCount: 0,
        lostCheckpointCount: 0,
        duplicateCheckpointCount: 0,
        staleListenerAcceptanceCount: 0,
        credentialLeakCount: 0,
        orphanProcessCount: 0,
        provenance: trustedProvenance,
      },
    });
  } catch (error) {
    fs.mkdirSync(artifactDir, { recursive: true });
    writeJsonDurable(path.join(artifactDir, "failure.json"), {
      schema: "chainlesschain.ide-host-recovery-failure.v1",
      transport,
      releaseCommit,
      error: String(error?.message || error).slice(0, 2048),
      phases,
      provenance: provenance(artifactName),
    });
    throw error;
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child).catch(() => {});
    }
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.child) {
    await runBridgeChild(options);
    return;
  }
  await runParent(options);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[host-recovery] FAIL ${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { REQUIRED_PHASES, canonicalJson, resolveGitHead, runParent };
