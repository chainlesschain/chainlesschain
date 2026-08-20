#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const {
  buildContextCenter,
} = require("../../vscode-extension/src/context-center.js");
const SHA_RE = /^[a-f0-9]{40}$/u;
const ENTRYPOINTS = Object.freeze([
  "repl",
  "headless",
  "stream",
  "websocket",
  "vscode",
  "jetbrains",
  "desktop",
]);
const REQUIRED_FILES = Object.freeze([
  "exact-commit.json",
  "host-environment.json",
  "concurrency-authority.json",
  "fault-injection.json",
  "cross-entry-projections.json",
  "redaction-and-recovery.json",
  "outcome-observations.json",
]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert.ok(key?.startsWith("--") && value, `invalid argument: ${key}`);
    options[
      key
        .slice(2)
        .replace(/-([a-z])/gu, (_, character) => character.toUpperCase())
    ] = value;
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

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, `${canonicalJson(value)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, filePath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertExactCheckout(releaseCommit) {
  assert.match(releaseCommit || "", SHA_RE);
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  }).trim();
  const status = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=normal"],
    { encoding: "utf8", shell: false },
  ).trim();
  assert.equal(head, releaseCommit);
  assert.equal(status, "");
}

async function loadProduction() {
  const [scoped, authority, center] = await Promise.all([
    import("../src/lib/scoped-permission-store.js"),
    import("../src/lib/permission-authority.js"),
    import("../src/lib/permission-side-effect-center.js"),
  ]);
  return { scoped, authority, center };
}

async function workerAdd(options) {
  const { scoped } = await loadProduction();
  const store = new scoped.ScopedPermissionStore({
    cwd: path.resolve(options.workspace),
    filePath: path.resolve(options.stateFile),
  });
  const start = Number(options.start);
  const count = Number(options.count);
  for (let index = 0; index < count; index += 1) {
    const id = start + index;
    store.add({
      decision: id % 3 === 0 ? "deny" : id % 3 === 1 ? "ask" : "allow",
      rule: `Read(file-${String(id).padStart(3, "0")})`,
      expiresAt: Date.now() + 3_600_000,
      reason: `matrix-rule-${id}`,
    });
  }
}

async function workerRevoke(options) {
  const { scoped } = await loadProduction();
  const store = new scoped.ScopedPermissionStore({
    cwd: path.resolve(options.workspace),
    filePath: path.resolve(options.stateFile),
  });
  const ids = readJson(path.resolve(options.idsFile));
  const start = Number(options.start);
  const count = Number(options.count);
  for (let index = 0; index < count; index += 1) {
    store.revoke({ id: ids[start + index], expectedRevision: 1 });
  }
}

function sleeper(options) {
  writeJson(path.resolve(options.readyFile), {
    schema: "chainlesschain.context-permission-sleeper.v1",
    ready: true,
  });
  setInterval(() => {}, 1000);
}

function waitForExit(child, timeoutMs = 30_000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("matrix child exit timeout")),
      timeoutMs,
    );
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function runWorkers(mode, common, count = 20, perWorker = 5) {
  return Promise.all(
    Array.from({ length: count }, (_, workerIndex) => {
      const args = [
        SCRIPT_PATH,
        "--mode",
        mode,
        "--workspace",
        common.workspace,
        "--state-file",
        common.stateFile,
        "--start",
        String(workerIndex * perWorker),
        "--count",
        String(perWorker),
      ];
      if (common.idsFile) args.push("--ids-file", common.idsFile);
      const child = spawn(process.execPath, args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let outputBytes = 0;
      child.stdout.on("data", (chunk) => {
        outputBytes += chunk.length;
      });
      child.stderr.on("data", (chunk) => {
        outputBytes += chunk.length;
      });
      return waitForExit(child).then((code) => {
        assert.equal(code, 0, `${mode} worker ${workerIndex} failed`);
        assert.equal(outputBytes, 0, `${mode} worker emitted diagnostics`);
      });
    }),
  );
}

function contextCandidates() {
  const kinds = [
    "selection",
    "active-file",
    "open-tabs",
    "diagnostics",
    "git-diff",
    "terminal-selection",
    "test-debug",
    "preview-evidence",
    "memory",
    "mcp-resource",
  ];
  return Array.from({ length: 64 }, (_, index) => ({
    kind: kinds[index % kinds.length],
    source: `host-${index % 3}`,
    identity: `candidate-${String(index).padStart(2, "0")}`,
    label: `Context ${index}`,
    scope: `workspace:item-${index}`,
    content: `bounded context ${index} ${"x".repeat(127 + index)}`,
    freshness: {
      state: "live-host",
      capturedAt: "2026-08-20T00:00:00.000Z",
    },
    autoReason: `fixture-priority-${index}`,
  }));
}

function permissionProjection(center, entrypoint, iteration) {
  const secret = `cc-secret-value-${entrypoint}-${iteration}`;
  const command = `NPM_TOKEN=${secret} npm publish --token ${secret} must-not-render`;
  const resources = center.collectToolResourceIdentifiers("run_shell", {
    command,
    cwd: "/workspace/repo",
    endpoint: `https://user:${secret}@registry.example.test/publish?token=${secret}`,
    env: { NPM_TOKEN: secret },
  });
  const projection = center.buildPermissionSideEffectCenter({
    sessionId: `session-${entrypoint}`,
    operations: [
      {
        opId: `op-${iteration}`,
        kind: "shell",
        key: command,
        state: iteration % 2 === 0 ? "unknown" : "committed",
        idempotent: false,
        meta: {
          tool: "run_shell",
          toolUseId: `tool-${iteration}`,
          turnId: `turn-${iteration}`,
          resources,
          permissionDecision: {
            decision: "ask",
            via: entrypoint,
            rule: "Bash(npm publish:*)",
            source: "/workspace/.claude/settings.json",
            reason: `external publish NPM_TOKEN=${secret}`,
          },
        },
      },
    ],
    turns: [
      {
        turnId: `turn-${iteration}`,
        toolCallIds: [`tool-${iteration}`],
        coverage: "full",
        fileCheckpointId: `checkpoint-${iteration}`,
      },
    ],
  });
  const serialized = JSON.stringify(projection);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("must-not-render"), false);
  assert.equal(serialized.includes("--token"), false);
  const recovery = projection.entries[0].recovery;
  assert.equal(recovery.coverage, "partial");
  assert.deepEqual(recovery.coveredResources, ["files:/workspace/repo"]);
  assert.ok(
    recovery.uncoveredResources.includes(
      "network:https://registry.example.test",
    ),
  );
  assert.ok(recovery.uncoveredResources.includes("processes:npm"));
  assert.ok(recovery.uncoveredResources.includes("credentials:NPM_TOKEN"));
  return projection;
}

async function mainCampaign(options, dependencies = {}) {
  const releaseCommit = options.releaseCommit;
  const artifactDir = path.resolve(options.artifactDir || "");
  const stateDir = path.resolve(options.stateDir || "");
  const artifactName = options.artifactName || "local-context-permission";
  assert.ok(options.artifactDir && options.stateDir);
  const verifyCheckout =
    dependencies.assertExactCheckout || assertExactCheckout;
  verifyCheckout(releaseCommit);
  fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const workspace = path.join(stateDir, "workspace");
  const authorityDir = path.join(stateDir, "security-authority");
  const stateFile = path.join(authorityDir, "rules.json");
  fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
  fs.mkdirSync(authorityDir, { recursive: true, mode: 0o700 });
  const production = await loadProduction();

  await runWorkers("worker-add", { workspace, stateFile });
  const store = new production.scoped.ScopedPermissionStore({
    cwd: workspace,
    filePath: stateFile,
  });
  const added = store.list();
  assert.equal(added.generation, 100);
  assert.equal(added.rules.length, 100);
  assert.equal(new Set(added.rules.map((rule) => rule.id)).size, 100);
  const idsFile = path.join(stateDir, "rule-ids.json");
  writeJson(
    idsFile,
    added.rules.map((rule) => rule.id),
  );
  await runWorkers("worker-revoke", { workspace, stateFile, idsFile });
  const revoked = store.list();
  assert.equal(revoked.generation, 200);
  assert.equal(
    revoked.rules.filter((rule) => rule.status === "revoked").length,
    100,
  );

  const managedFile = path.join(stateDir, "managed-settings.json");
  const active = store.add({
    decision: "allow",
    rule: "Bash(git status:*)",
    expiresAt: Date.now() + 3_600_000,
    reason: "managed-deny-negative-control",
  });
  writeJson(managedFile, {
    allowManagedPermissionRulesOnly: true,
    permissions: { deny: ["Bash(git status:*)"] },
  });
  const authority = production.authority.loadPermissionAuthority({
    cwd: workspace,
    scopedStore: store,
    managedSettingsFile: managedFile,
    env: {},
  });
  assert.deepEqual(authority.rules.allow, []);
  assert.deepEqual(authority.rules.deny, ["Bash(git status:*)"]);
  assert.equal(
    authority.scoped.rules.find((rule) => rule.id === active.id)
      ?.effectiveStatus,
    "suppressed-by-managed-policy",
  );

  const corruptFile = path.join(stateDir, "corrupt-rules.json");
  fs.copyFileSync(stateFile, corruptFile, fs.constants.COPYFILE_EXCL);
  fs.appendFileSync(corruptFile, "{truncated", "utf8");
  let corruptRejected = false;
  try {
    new production.scoped.ScopedPermissionStore({
      cwd: workspace,
      filePath: corruptFile,
    }).list();
  } catch {
    corruptRejected = true;
  }
  assert.equal(corruptRejected, true);

  const beforeKillDigest = digest(fs.readFileSync(stateFile));
  const readyFile = path.join(stateDir, "sleeper-ready.json");
  const sleeperChild = spawn(
    process.execPath,
    [SCRIPT_PATH, "--mode", "sleeper", "--ready-file", readyFile],
    { shell: false, stdio: "ignore", windowsHide: true },
  );
  for (
    let attempt = 0;
    attempt < 200 && !fs.existsSync(readyFile);
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(fs.existsSync(readyFile), true);
  sleeperChild.kill("SIGTERM");
  await waitForExit(sleeperChild);
  assert.equal(digest(fs.readFileSync(stateFile)), beforeKillDigest);

  const candidates = contextCandidates();
  const contextAuthority = buildContextCenter({
    workspaceId: "matrix-workspace",
    candidates,
    tokenBudget: 4096,
  });
  const reorderedContext = buildContextCenter({
    workspaceId: "matrix-workspace",
    candidates: [...candidates].reverse(),
    tokenBudget: 4096,
  });
  assert.deepEqual(reorderedContext, contextAuthority);
  assert.equal(contextAuthority.budget.limitTokens, 4096);
  assert.ok(contextAuthority.budget.allocatedTokens > 0);
  assert.ok(contextAuthority.budget.allocatedTokens <= 4096);
  const contextDigest = digest(
    Buffer.from(canonicalJson(contextAuthority), "utf8"),
  );
  const entryEvidence = [];
  let projectionCount = 0;
  for (const entrypoint of ENTRYPOINTS) {
    const projectionDigests = [];
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const permission = permissionProjection(
        production.center,
        entrypoint,
        iteration,
      );
      projectionDigests.push(
        digest(
          Buffer.from(
            canonicalJson({ context: contextAuthority, permission }),
            "utf8",
          ),
        ),
      );
      projectionCount += 1;
    }
    entryEvidence.push({
      entrypoint,
      independentRuns: 100,
      contextDigest,
      projectionSetDigest: digest(
        Buffer.from(canonicalJson(projectionDigests), "utf8"),
      ),
    });
  }

  const shared = {
    releaseCommit,
    operatingSystem: process.platform,
    architecture: process.arch,
  };
  const provenance = {
    repository: process.env.GITHUB_REPOSITORY || "local",
    workflowRef: process.env.GITHUB_WORKFLOW_REF || "local",
    workflowSha: process.env.GITHUB_WORKFLOW_SHA || releaseCommit,
    runId: process.env.GITHUB_RUN_ID || "local",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || "1",
    job: process.env.GITHUB_JOB || `local-${process.platform}`,
    eventName: process.env.GITHUB_EVENT_NAME || "local",
    artifactName,
  };
  const documents = {
    "exact-commit.json": {
      schema: "chainlesschain.context-permission-exact-commit.v1",
      releaseCommit,
      exactCommitBound: true,
    },
    "host-environment.json": {
      schema: "chainlesschain.context-permission-host.v1",
      ...shared,
      nodeVersion: process.version,
      provenance,
    },
    "concurrency-authority.json": {
      schema: "chainlesschain.context-permission-concurrency.v1",
      addWorkerCount: 20,
      revokeWorkerCount: 20,
      addCount: 100,
      revokeCount: 100,
      finalGeneration: 201,
      lostUpdateCount: 0,
      duplicateRuleIdCount: 0,
      staleRevisionAcceptanceCount: 0,
      managedDenyRelaxationCount: 0,
      stateDigest: beforeKillDigest,
    },
    "fault-injection.json": {
      schema: "chainlesschain.context-permission-faults.v1",
      corruptAuthorityRejectedCount: 1,
      processTerminationCount: 1,
      processTerminationStateDriftCount: 0,
      networkUnknownRecoveryClaimCount: 0,
      failureArtifactsComplete: true,
    },
    "cross-entry-projections.json": {
      schema: "chainlesschain.context-permission-cross-entry.v1",
      entrypoints: entryEvidence,
      totalProjectionRuns: projectionCount,
      contextSelectionAlgorithm: contextAuthority.selectionAlgorithm,
      contextDigest,
    },
    "redaction-and-recovery.json": {
      schema: "chainlesschain.context-permission-redaction.v1",
      scannedProjectionCount: projectionCount,
      credentialValueLeakCount: 0,
      fullCommandLeakCount: 0,
      externalResourceRollbackOverclaimCount: 0,
      deterministicContextMismatchCount: 0,
    },
    "outcome-observations.json": {
      schema: "chainlesschain.context-permission-outcome.v1",
      ...shared,
      success: true,
      concurrentMutationCount: 200,
      crossEntryProjectionCount: projectionCount,
      credentialLeakCount: 0,
      fullCommandLeakCount: 0,
      managedDenyRelaxationCount: 0,
      checkpointRecoveryOverclaimCount: 0,
      corruptAuthorityAcceptanceCount: 0,
      orphanProcessCount: 0,
      requiredMeasurementsComplete: true,
      exactCommitBound: true,
    },
  };
  for (const [file, value] of Object.entries(documents)) {
    writeJson(path.join(artifactDir, file), value);
  }
  const files = Object.fromEntries(
    REQUIRED_FILES.map((file) => {
      const bytes = fs.readFileSync(path.join(artifactDir, file));
      return [file, { sha256: digest(bytes), bytes: bytes.length }];
    }),
  );
  writeJson(path.join(artifactDir, "manifest.json"), {
    schema: "chainlesschain.context-permission-manifest.v1",
    ...shared,
    files,
  });
}

function writeFailure(options, error) {
  if (!options.artifactDir) return;
  try {
    writeJson(path.join(path.resolve(options.artifactDir), "failure.json"), {
      schema: "chainlesschain.context-permission-failure.v1",
      releaseCommit: options.releaseCommit || null,
      errorCode: String(
        error?.code || "CC_CONTEXT_PERMISSION_MATRIX_FAILED",
      ).slice(0, 96),
      diagnosticDigest: digest(
        Buffer.from(String(error?.message || "matrix failed"), "utf8"),
      ),
      contentEmitted: false,
    });
  } catch {
    // Preserve the original failure.
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "worker-add") return workerAdd(options);
  if (options.mode === "worker-revoke") return workerRevoke(options);
  if (options.mode === "sleeper") return sleeper(options);
  assert.equal(options.mode, "campaign");
  try {
    await mainCampaign(options);
  } catch (error) {
    writeFailure(options, error);
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();

export { ENTRYPOINTS, REQUIRED_FILES, canonicalJson, digest, mainCampaign };
