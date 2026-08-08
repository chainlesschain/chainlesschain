#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeTool } from "../src/runtime/agent-core.js";
import { MCPClient } from "../src/harness/mcp-client.js";
import { createMcpCallLedger } from "../src/lib/mcp-call-ledger.js";
import { mcpEffectDescriptorFields } from "../src/lib/mcp-effect-contract.js";
import { issueMcpStdioExecutionAuthority } from "../src/lib/mcp-stdio-execution-authority.js";
import {
  applySandbox,
  SANDBOX_BOUNDARIES,
} from "../src/lib/process-execution-broker/platform-sandbox.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(cliRoot, "..", "..");
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "ide-roadmap");
const manifestPath = path.join(fixtureRoot, "manifest.json");
const roadmapFixturePath = path.join(fixtureRoot, "s0-skill-mcp.json");
const serverFixturePath = path.join(
  cliRoot,
  "__tests__",
  "fixtures",
  "mcp-adversarial-effect-server.mjs",
);
const evidenceSchema = "chainlesschain.ide-roadmap-mcp-security-evidence.v4";
const aggregateSchema =
  "chainlesschain.ide-roadmap-mcp-security-evidence-aggregate.v4";
const releaseCommitPattern = /^[0-9a-f]{40}$/;
const serverName = "adversarial";
const toolCases = Object.freeze([
  "claimed_read_mutation",
  "unknown_mutation",
  "declared_write",
]);
const expectedUnapprovedEffects = Object.freeze({
  claimed_read_mutation: "unknown",
  unknown_mutation: "unknown",
  declared_write: "write",
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256File(filePath) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function executableIdentity(filePath) {
  const realpath = fs.realpathSync.native || fs.realpathSync;
  const realPath = realpath(path.resolve(filePath));
  const stat = fs.statSync(realPath);
  return Object.freeze({
    contractVersion: 1,
    realPath,
    sha256: crypto
      .createHash("sha256")
      .update(fs.readFileSync(realPath))
      .digest("hex"),
    bytes: stat.size,
    fileId: Object.freeze({
      dev: String(stat.dev),
      ino: String(stat.ino),
    }),
    mtimeMs: stat.mtimeMs,
    attestation: "realpath-file-id-sha256",
  });
}

function directoryIdentity(directoryPath) {
  const realpath = fs.realpathSync.native || fs.realpathSync;
  const realPath = realpath(path.resolve(directoryPath));
  const stat = fs.statSync(realPath);
  return Object.freeze({
    contractVersion: 1,
    realPath,
    fileId: Object.freeze({
      dev: String(stat.dev),
      ino: String(stat.ino),
    }),
  });
}

function spawnCodeSnapshotProbe(plan) {
  return new Promise((resolvePromise) => {
    const child = spawn(plan.command, plan.args, plan.options);
    const stdout = [];
    const stderr = [];
    let settled = false;
    let timer = null;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        ...value,
      });
    };
    const retain = (target, chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (
        target.reduce((total, value) => total + value.length, 0) <
        64 * 1024
      ) {
        target.push(bytes);
      }
    };
    child.stdout?.on("data", (chunk) => retain(stdout, chunk));
    child.stderr?.on("data", (chunk) => retain(stderr, chunk));
    child.once("error", (error) =>
      settle({
        status: null,
        signal: null,
        errorCode: error?.code || error?.name || "spawn-error",
      }),
    );
    child.once("close", (status, signal) =>
      settle({ status, signal, errorCode: null }),
    );
    timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The timeout remains authoritative.
      }
      settle({ status: null, signal: "timeout", errorCode: "ETIMEDOUT" });
    }, 30_000);
    timer.unref?.();
  });
}

async function runCodeSnapshotRaceAttempt(workspace, iteration) {
  const operatingSystem = normalizeOperatingSystem();
  if (operatingSystem !== "linux") {
    throw new Error(`unsupported MCP code snapshot host: ${operatingSystem}`);
  }

  const realpath = fs.realpathSync.native || fs.realpathSync;
  const root = realpath(
    fs.mkdtempSync(path.join(workspace, "code-snapshot-race-")),
  );
  const entryPath = path.join(root, "server.cjs");
  const markerPath = path.join(root, "malicious-marker.txt");
  const expectedStdout = `safe-snapshot-${iteration}\n`;
  fs.writeFileSync(
    entryPath,
    `process.stdout.write(${JSON.stringify(expectedStdout)});\n`,
  );
  const runtimeIdentity = executableIdentity(process.execPath);
  const entryIdentity = executableIdentity(entryPath);
  const contract = Object.freeze({
    contractVersion: 1,
    kind: "strict-mcp-node-capsule",
    pluginRoot: root,
    workingDirectory: root,
    runtimePath: runtimeIdentity.realPath,
    rootIdentity: directoryIdentity(root),
    entryIdentity,
    runtimeIdentity,
  });
  const plan = applySandbox(
    runtimeIdentity.realPath,
    [entryIdentity.realPath],
    { cwd: root, shell: false, stdio: "pipe" },
    {
      profile: "default",
      requiredBoundaries: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
      executionContract: contract,
      sync: true,
    },
  );
  try {
    if (
      plan.applied !== true ||
      !plan.guarantees.includes(SANDBOX_BOUNDARIES.CODE_SNAPSHOT) ||
      plan.runtimeProbe?.handleAtomic !== true ||
      plan.runtimeProbe?.entrySnapshotAtomic !== true ||
      plan.runtimeProbe?.runtimeLaunchAtomic !== true ||
      plan.runtimeProbe?.sharedLibraryClosure !== false
    ) {
      const probeReason = plan.runtimeProbe?.reason
        ? ` (${plan.runtimeProbe.reason})`
        : "";
      throw new Error(
        `MCP code snapshot unavailable: ${plan.reason || "unknown"}${probeReason}`,
      );
    }

    fs.writeFileSync(
      entryPath,
      `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "executed");\n`,
    );
    const replacementDigest = executableIdentity(entryPath).sha256;
    const result = await spawnCodeSnapshotProbe(plan);
    const originalSnapshotExecuted = result.stdout === expectedStdout;
    const maliciousPathExecuted = fs.existsSync(markerPath);
    const pass =
      result.status === 0 &&
      replacementDigest !== entryIdentity.sha256 &&
      originalSnapshotExecuted &&
      !maliciousPathExecuted;
    if (!pass) {
      throw new Error(
        `MCP code snapshot pathname race escaped on ${operatingSystem}: status=${result.status} signal=${result.signal || "none"} error=${result.errorCode || "none"} stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`,
      );
    }
    return Object.freeze({
      id: `code-snapshot-race-${iteration}`,
      iteration,
      pass: true,
      backend: plan.backend,
      mechanism: plan.runtimeProbe.contentSnapshotMechanism,
      handleAtomic: plan.runtimeProbe.handleAtomic,
      entrySnapshotAtomic: plan.runtimeProbe.entrySnapshotAtomic,
      runtimeLaunchAtomic: plan.runtimeProbe.runtimeLaunchAtomic,
      sharedLibraryClosure: false,
      sourceReplacementObserved: true,
      originalSnapshotExecuted: true,
      maliciousPathExecuted: false,
      exitCode: result.status,
      stdoutBytes: Buffer.byteLength(result.stdout || ""),
      stderrBytes: Buffer.byteLength(result.stderr || ""),
    });
  } finally {
    plan.cleanup?.();
  }
}

function runMacCodeSnapshotFailClosedProbe(workspace) {
  const realpath = fs.realpathSync.native || fs.realpathSync;
  const root = realpath(
    fs.mkdtempSync(path.join(workspace, "code-snapshot-fail-closed-")),
  );
  const entryPath = path.join(root, "server.cjs");
  fs.writeFileSync(entryPath, 'process.stdout.write("must-not-execute\\n");\n');
  const runtimeIdentity = executableIdentity(process.execPath);
  const entryIdentity = executableIdentity(entryPath);
  const contract = Object.freeze({
    contractVersion: 1,
    kind: "strict-mcp-node-capsule",
    pluginRoot: root,
    workingDirectory: root,
    runtimePath: runtimeIdentity.realPath,
    rootIdentity: directoryIdentity(root),
    entryIdentity,
    runtimeIdentity,
  });
  const plan = applySandbox(
    runtimeIdentity.realPath,
    [entryIdentity.realPath],
    { cwd: root, shell: false, stdio: "pipe" },
    {
      profile: "strict",
      requiredBoundaries: [
        SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
      executionContract: contract,
      sync: true,
    },
  );
  try {
    if (
      plan.applied !== false ||
      plan.backend !== null ||
      plan.candidateBackend !== "macos-fd-code-snapshot" ||
      plan.policyAttested !== false ||
      plan.reason !== "macos_atomic_runtime_exec_unavailable" ||
      plan.guarantees.length !== 0 ||
      plan.runtimeProbe?.attempted !== true ||
      plan.runtimeProbe?.runnable !== false ||
      plan.runtimeProbe?.reason !== "public_api_has_no_descriptor_bound_exec" ||
      plan.runtimeProbe?.contentSnapshot !== false ||
      plan.runtimeProbe?.entrySnapshotAtomic !== false ||
      plan.runtimeProbe?.runtimeLaunchAtomic !== false
    ) {
      throw new Error(
        `macOS MCP CODE_SNAPSHOT did not fail closed: ${plan.reason || "unknown"}`,
      );
    }
    return Object.freeze({
      required: false,
      pass: true,
      reason: "macos-atomic-runtime-exec-unavailable-fail-closed",
      failClosed: true,
      candidateBackend: plan.candidateBackend,
      adapterReason: plan.reason,
      runtimeProbeReason: plan.runtimeProbe.reason,
      entrySnapshotAtomic: false,
      runtimeLaunchAtomic: false,
      requiredRuns: 0,
      sampleCount: 0,
      passCount: 0,
      samples: Object.freeze([]),
    });
  } finally {
    plan.cleanup?.();
  }
}

async function runCodeSnapshotRaceProbe(workspace, runs) {
  const operatingSystem = normalizeOperatingSystem();
  if (operatingSystem === "windows") {
    return Object.freeze({
      required: false,
      pass: true,
      reason: "windows-atomic-launch-covered-by-filter-oplock-gate",
      requiredRuns: 0,
      sampleCount: 0,
      passCount: 0,
      samples: Object.freeze([]),
    });
  }
  if (operatingSystem === "macos") {
    return runMacCodeSnapshotFailClosedProbe(workspace);
  }
  const samples = [];
  for (let iteration = 0; iteration < runs; iteration += 1) {
    samples.push(await runCodeSnapshotRaceAttempt(workspace, iteration));
  }
  const first = samples[0];
  const stableMetadata = [
    "backend",
    "mechanism",
    "handleAtomic",
    "entrySnapshotAtomic",
    "runtimeLaunchAtomic",
    "sharedLibraryClosure",
  ];
  if (
    !first ||
    samples.some((sample) =>
      stableMetadata.some((field) => sample[field] !== first[field]),
    )
  ) {
    throw new Error("MCP code snapshot race matrix changed launch semantics");
  }
  return Object.freeze({
    required: true,
    pass: true,
    backend: first.backend,
    mechanism: first.mechanism,
    handleAtomic: first.handleAtomic,
    entrySnapshotAtomic: first.entrySnapshotAtomic,
    runtimeLaunchAtomic: first.runtimeLaunchAtomic,
    sharedLibraryClosure: first.sharedLibraryClosure,
    requiredRuns: runs,
    sampleCount: samples.length,
    passCount: samples.filter((sample) => sample.pass).length,
    sourceReplacementObserved: samples.every(
      (sample) => sample.sourceReplacementObserved,
    ),
    originalSnapshotExecuted: samples.every(
      (sample) => sample.originalSnapshotExecuted,
    ),
    maliciousPathExecuted: samples.some(
      (sample) => sample.maliciousPathExecuted,
    ),
    exitCode: samples.every((sample) => sample.exitCode === 0) ? 0 : null,
    stdoutBytes: samples.reduce(
      (total, sample) => total + sample.stdoutBytes,
      0,
    ),
    stderrBytes: samples.reduce(
      (total, sample) => total + sample.stderrBytes,
      0,
    ),
    samples: Object.freeze(
      samples.map((sample) =>
        Object.freeze({
          id: sample.id,
          iteration: sample.iteration,
          pass: sample.pass,
          sourceReplacementObserved: sample.sourceReplacementObserved,
          originalSnapshotExecuted: sample.originalSnapshotExecuted,
          maliciousPathExecuted: sample.maliciousPathExecuted,
          exitCode: sample.exitCode,
          stdoutBytes: sample.stdoutBytes,
          stderrBytes: sample.stderrBytes,
        }),
      ),
    ),
  });
}

function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeOperatingSystem(platform = process.platform) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  return platform;
}

function normalizeReleaseCommit(candidate) {
  const value = String(
    candidate ||
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repoRoot,
        encoding: "utf8",
      }),
  )
    .trim()
    .toLowerCase();
  if (!releaseCommitPattern.test(value)) {
    throw new Error(`release commit must be a full 40-character SHA: ${value}`);
  }
  return value;
}

function fixtureContract() {
  const manifest = readJson(manifestPath);
  const roadmapFixture = readJson(roadmapFixturePath);
  const manifestCase = manifest.cases?.find(
    (entry) => entry.id === "s0-skill-mcp",
  );
  if (!manifestCase?.required || manifestCase.priority !== "P0-S") {
    throw new Error("s0-skill-mcp must remain a required P0-S manifest case");
  }
  if (!manifestCase.matrix?.transports?.includes("stdio-mcp")) {
    throw new Error("s0-skill-mcp must declare the stdio-mcp transport");
  }
  for (const invariant of [
    "defaultConfirmationRequired",
    "claimedReadRemainsUnknownWithoutHostAuthorization",
    "staleHostReadCannotDowngradeRisk",
  ]) {
    if (roadmapFixture.expected?.[invariant] !== true) {
      throw new Error(`s0-skill-mcp must require ${invariant}`);
    }
  }
  return {
    manifestVersion: manifest.manifestVersion,
    roadmapFixture,
    digests: {
      manifest: sha256File(manifestPath),
      roadmapFixture: sha256File(roadmapFixturePath),
      adversarialServer: sha256File(serverFixturePath),
    },
  };
}

function parseCallLog(workspace) {
  const callLogPath = path.join(workspace, "transport-calls.jsonl");
  if (!fs.existsSync(callLogPath)) return [];
  const raw = fs.readFileSync(callLogPath, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => JSON.parse(line));
}

function buildToolHarness({
  client,
  rawTool,
  workspace,
  permissionConfirm,
  hostPolicy,
}) {
  const name = `mcp__${serverName}__${rawTool.name}`;
  const records = [];
  const ledger = createMcpCallLedger({
    sink: async (record) => records.push(record),
  });
  return {
    name,
    records,
    context: {
      cwd: workspace,
      sessionId: "formal-adversarial-session",
      turnId: "formal-adversarial-turn",
      mcpClient: client,
      mcpCallLedger: ledger,
      ...(permissionConfirm ? { permissionConfirm } : {}),
      ...(hostPolicy
        ? {
            hostManagedToolPolicy: {
              tools: { [name]: hostPolicy },
            },
          }
        : {}),
      externalToolDescriptors: {
        [name]: {
          name,
          kind: "mcp",
          category: "mcp",
          source: `mcp:${serverName}`,
          ...mcpEffectDescriptorFields(rawTool, {
            sourceTrusted: false,
            provenance: "project:formal-adversarial-fixture",
          }),
        },
      },
      externalToolExecutors: {
        [name]: {
          kind: "mcp",
          serverName,
          toolName: rawTool.name,
        },
      },
    },
  };
}

function safeError(error) {
  return {
    name: error?.name || "Error",
    code: error?.code || null,
    message: String(error?.message || error || "unknown error")
      .replace(/\s+/g, " ")
      .slice(0, 500),
  };
}

export async function runMcpSecurityMatrix(options = {}) {
  const startedAt = new Date().toISOString();
  const releaseCommit = normalizeReleaseCommit(options.releaseCommit);
  const runs = Number(options.runs ?? 100);
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 1_000) {
    throw new Error("runs must be an integer between 1 and 1000");
  }
  const fixture = fixtureContract();
  const cliPackage = readJson(path.join(cliRoot, "package.json"));
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-formal-mcp-security-"),
  );
  const originalTrust = process.env.CC_MCP_EXECUTABLE_TRUST;
  const originalTrustStore = process.env.CC_MCP_EXECUTABLE_TRUST_STORE;
  let client = null;
  let evidence;

  try {
    process.env.CC_MCP_EXECUTABLE_TRUST = "1";
    process.env.CC_MCP_EXECUTABLE_TRUST_STORE = path.join(
      workspace,
      "executable-identities.json",
    );
    client = new MCPClient();
    const config = {
      command: process.execPath,
      args: [serverFixturePath],
      env: {
        ...process.env,
        CC_MCP_ADVERSARIAL_MARKER_ROOT: workspace,
      },
      requestTimeoutMs: 10_000,
      processTreeCleanupTimeoutMs: 5_000,
    };
    config.mcpStdioExecutionAuthority = issueMcpStdioExecutionAuthority({
      serverName,
      config,
      approvalKind: "explicit-config",
      approvalSource: "formal-adversarial-mcp-gate",
    });
    await client.connect(serverName, config);

    const inventory = client.listTools(serverName);
    const rawTools = Object.fromEntries(
      toolCases.map((toolName) => {
        const rawTool = inventory.find((tool) => tool?.name === toolName);
        if (!rawTool) throw new Error(`fixture omitted MCP tool ${toolName}`);
        return [toolName, rawTool];
      }),
    );
    const samples = [];
    let unapprovedMutationCount = 0;
    let unapprovedLedgerRecordCount = 0;

    for (let iteration = 0; iteration < runs; iteration += 1) {
      for (const toolName of toolCases) {
        const markerPath = `${toolName}-${iteration}.txt`;
        const harness = buildToolHarness({
          client,
          rawTool: rawTools[toolName],
          workspace,
        });
        const result = await executeTool(
          harness.name,
          { path: markerPath },
          harness.context,
        );
        const mutated = fs.existsSync(path.join(workspace, markerPath));
        unapprovedMutationCount += mutated ? 1 : 0;
        unapprovedLedgerRecordCount += harness.records.length;
        const pass =
          result?.policy?.code === "CC_MCP_EFFECT_CONFIRMATION_REQUIRED" &&
          result?.policy?.decision === "ask" &&
          result?.policy?.trusted === false &&
          !mutated &&
          harness.records.length === 0;
        samples.push({
          id: `${toolName}-${iteration}`,
          toolName,
          iteration,
          pass,
          decision: result?.policy?.decision || null,
          code: result?.policy?.code || null,
          effect: result?.policy?.effect || null,
          trusted: result?.policy?.trusted === true,
          mutationCount: mutated ? 1 : 0,
          ledgerRecordCount: harness.records.length,
        });
        if (!pass) {
          throw Object.assign(
            new Error(`unapproved MCP sample failed: ${toolName}/${iteration}`),
            { sample: samples.at(-1) },
          );
        }
      }
    }

    const unapprovedTransportCalls = parseCallLog(workspace);
    if (unapprovedTransportCalls.length !== 0) {
      throw new Error("an unapproved MCP tool reached the stdio transport");
    }

    // Simulate host metadata that became stale after a server changed an
    // unmarked/write tool. The peer declaration must be a monotonic risk
    // floor: an old host `read` authorization cannot bypass confirmation,
    // downgrade the ledger effect, or reach the real stdio transport.
    const staleHostReadCases = [
      {
        toolName: "unknown_mutation",
        expectedEffect: "unknown",
      },
      {
        toolName: "declared_write",
        expectedEffect: "write",
      },
    ];
    const staleHostReadSamples = [];
    for (const testCase of staleHostReadCases) {
      const markerPath = `stale-host-read-${testCase.toolName}.txt`;
      const harness = buildToolHarness({
        client,
        rawTool: rawTools[testCase.toolName],
        workspace,
        hostPolicy: {
          allowed: true,
          authorizedEffect: "read",
          sourceTrusted: true,
          effectContract: {
            authorizedEffect: "read",
            trusted: true,
            provenance: "formal:stale-host-read-policy",
          },
        },
      });
      const result = await executeTool(
        harness.name,
        { path: markerPath },
        harness.context,
      );
      const mutated = fs.existsSync(path.join(workspace, markerPath));
      const pass =
        result?.policy?.code === "CC_MCP_EFFECT_CONFIRMATION_REQUIRED" &&
        result?.policy?.decision === "ask" &&
        result?.policy?.effect === testCase.expectedEffect &&
        result?.policy?.trusted === false &&
        !mutated &&
        harness.records.length === 0;
      staleHostReadSamples.push({
        toolName: testCase.toolName,
        expectedEffect: testCase.expectedEffect,
        observedEffect: result?.policy?.effect || null,
        decision: result?.policy?.decision || null,
        code: result?.policy?.code || null,
        trusted: result?.policy?.trusted === true,
        transportCallCount: parseCallLog(workspace).length,
        mutationCount: mutated ? 1 : 0,
        ledgerRecordCount: harness.records.length,
        pass,
      });
      if (!pass || parseCallLog(workspace).length !== 0) {
        throw new Error(
          `stale host read policy lowered MCP risk: ${testCase.toolName}`,
        );
      }
    }

    const permissionConfirmCalls = [];
    const approvedHarness = buildToolHarness({
      client,
      rawTool: rawTools.claimed_read_mutation,
      workspace,
      permissionConfirm: async (request) => {
        permissionConfirmCalls.push(request);
        return true;
      },
    });
    const approvedPath = "approved-claimed-read.txt";
    const approvedResult = await executeTool(
      approvedHarness.name,
      { path: approvedPath },
      approvedHarness.context,
    );
    const transportCalls = parseCallLog(workspace);
    const approvedStarted = approvedHarness.records[0];
    const approvedSettled = approvedHarness.records.at(-1);
    const approvedProbePass =
      !approvedResult?.error &&
      permissionConfirmCalls.length === 1 &&
      transportCalls.length === 1 &&
      transportCalls[0]?.tool === "claimed_read_mutation" &&
      transportCalls[0]?.path === approvedPath &&
      fs.existsSync(path.join(workspace, approvedPath)) &&
      approvedStarted?.effectContract?.effect === "unknown" &&
      approvedStarted?.effectContract?.trusted === false &&
      approvedStarted?.resourceScopes?.includes(`path:${approvedPath}`) &&
      approvedSettled?.status === "completed";
    if (!approvedProbePass) {
      throw new Error(
        "approved adversarial MCP probe did not preserve unknown-effect evidence",
      );
    }
    const codeSnapshotRaceProbe = await runCodeSnapshotRaceProbe(
      workspace,
      runs,
    );

    evidence = {
      schema: evidenceSchema,
      releaseCommit,
      result: "passed",
      startedAt,
      finishedAt: new Date().toISOString(),
      runner: {
        operatingSystem: normalizeOperatingSystem(),
        architecture: process.arch,
        nodeVersion: process.version,
      },
      cliVersion: cliPackage.version,
      transport: "stdio-mcp",
      fixture: {
        manifestVersion: fixture.manifestVersion,
        digests: fixture.digests,
      },
      matrix: {
        requiredRunsPerTool: runs,
        tools: [...toolCases],
        sampleCount: samples.length,
        passCount: samples.filter((sample) => sample.pass).length,
        unapprovedTransportCallCount: unapprovedTransportCalls.length,
        unapprovedMutationCount,
        unapprovedLedgerRecordCount,
        samples,
      },
      approvedProbe: {
        pass: true,
        permissionPromptCount: permissionConfirmCalls.length,
        transportCallCount: transportCalls.length,
        declaredEffect: "read",
        authorizedEffect: "unknown",
        trusted: false,
        ledgerStarted: approvedStarted?.status === "started",
        ledgerSettled: approvedSettled?.status === "completed",
        resourceScopes: approvedStarted?.resourceScopes || [],
      },
      staleHostReadPolicyProbe: {
        pass: staleHostReadSamples.every((sample) => sample.pass),
        sampleCount: staleHostReadSamples.length,
        transportCallCount: 0,
        mutationCount: 0,
        ledgerRecordCount: 0,
        samples: staleHostReadSamples,
      },
      codeSnapshotRaceProbe,
      invariants: {
        annotationsAreHintsOnly: true,
        defaultConfirmationRequired: true,
        hostAuthorizationRequiredForTrustedRead: true,
        unapprovedEffectsBeforeTransport: 0,
        unapprovedMutations: 0,
        unapprovedLedgerWrites: 0,
        claimedReadRemainsUnknownWithoutHostAuthorization: true,
        staleHostReadCannotDowngradeRisk: true,
      },
    };
  } catch (error) {
    evidence = {
      schema: evidenceSchema,
      releaseCommit,
      result: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      runner: {
        operatingSystem: normalizeOperatingSystem(),
        architecture: process.arch,
        nodeVersion: process.version,
      },
      transport: "stdio-mcp",
      fixture: {
        manifestVersion: fixture.manifestVersion,
        digests: fixture.digests,
      },
      validationError: safeError(error),
      ...(error?.sample ? { failedSample: error.sample } : {}),
    };
  } finally {
    try {
      await client?.disconnect(serverName);
    } catch {
      // The failed evidence remains authoritative; cleanup must still continue.
    }
    if (originalTrust === undefined) {
      delete process.env.CC_MCP_EXECUTABLE_TRUST;
    } else {
      process.env.CC_MCP_EXECUTABLE_TRUST = originalTrust;
    }
    if (originalTrustStore === undefined) {
      delete process.env.CC_MCP_EXECUTABLE_TRUST_STORE;
    } else {
      process.env.CC_MCP_EXECUTABLE_TRUST_STORE = originalTrustStore;
    }
    fs.rmSync(workspace, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 50,
    });
  }

  if (options.output) writeJson(options.output, evidence);
  if (evidence.result !== "passed") {
    throw Object.assign(
      new Error(
        evidence.validationError?.message || "MCP security gate failed",
      ),
      { evidence },
    );
  }
  return evidence;
}

function validateEvidence(value, { releaseCommit, minimumRuns = 100 } = {}) {
  const issues = [];
  const fixture = fixtureContract();
  if (value?.schema !== evidenceSchema) issues.push("schema");
  if (value?.releaseCommit !== releaseCommit) issues.push("release commit");
  if (value?.result !== "passed") issues.push("result");
  if (value?.transport !== "stdio-mcp") issues.push("transport");
  if (!value?.startedAt || !value?.finishedAt) issues.push("time window");
  if (value?.fixture?.manifestVersion !== fixture.manifestVersion) {
    issues.push("manifest version");
  }
  if (
    JSON.stringify(value?.fixture?.digests) !== JSON.stringify(fixture.digests)
  ) {
    issues.push("fixture digests");
  }
  const runs = value?.matrix?.requiredRunsPerTool;
  if (!Number.isSafeInteger(runs) || runs < minimumRuns)
    issues.push("run count");
  if (value?.matrix?.sampleCount !== runs * toolCases.length) {
    issues.push("sample count");
  }
  if (value?.matrix?.passCount !== runs * toolCases.length) {
    issues.push("pass count");
  }
  if (value?.matrix?.samples?.length !== runs * toolCases.length) {
    issues.push("sample evidence");
  }
  if (value?.matrix?.samples?.some((sample) => sample.pass !== true)) {
    issues.push("failed sample");
  }
  if (JSON.stringify(value?.matrix?.tools) !== JSON.stringify(toolCases)) {
    issues.push("tool cases");
  }
  const sampleById = new Map(
    (Array.isArray(value?.matrix?.samples) ? value.matrix.samples : []).map(
      (sample) => [sample?.id, sample],
    ),
  );
  if (sampleById.size !== runs * toolCases.length) {
    issues.push("unique sample ids");
  } else {
    for (let iteration = 0; iteration < runs; iteration += 1) {
      for (const toolName of toolCases) {
        const sample = sampleById.get(`${toolName}-${iteration}`);
        if (
          sample?.toolName !== toolName ||
          sample?.iteration !== iteration ||
          sample?.pass !== true ||
          sample?.decision !== "ask" ||
          sample?.code !== "CC_MCP_EFFECT_CONFIRMATION_REQUIRED" ||
          sample?.effect !== expectedUnapprovedEffects[toolName] ||
          sample?.trusted !== false ||
          sample?.mutationCount !== 0 ||
          sample?.ledgerRecordCount !== 0
        ) {
          issues.push("unapproved sample contract");
          iteration = runs;
          break;
        }
      }
    }
  }
  for (const field of [
    "unapprovedTransportCallCount",
    "unapprovedMutationCount",
    "unapprovedLedgerRecordCount",
  ]) {
    if (value?.matrix?.[field] !== 0) issues.push(field);
  }
  if (
    value?.approvedProbe?.pass !== true ||
    value?.approvedProbe?.permissionPromptCount !== 1 ||
    value?.approvedProbe?.transportCallCount !== 1 ||
    value?.approvedProbe?.declaredEffect !== "read" ||
    value?.approvedProbe?.authorizedEffect !== "unknown" ||
    value?.approvedProbe?.trusted !== false ||
    value?.approvedProbe?.ledgerStarted !== true ||
    value?.approvedProbe?.ledgerSettled !== true
  ) {
    issues.push("approved probe");
  }
  const staleHostReadSamples = value?.staleHostReadPolicyProbe?.samples;
  const expectedStaleHostReadSamples = [
    ["unknown_mutation", "unknown"],
    ["declared_write", "write"],
  ];
  if (
    value?.staleHostReadPolicyProbe?.pass !== true ||
    value?.staleHostReadPolicyProbe?.sampleCount !==
      expectedStaleHostReadSamples.length ||
    value?.staleHostReadPolicyProbe?.transportCallCount !== 0 ||
    value?.staleHostReadPolicyProbe?.mutationCount !== 0 ||
    value?.staleHostReadPolicyProbe?.ledgerRecordCount !== 0 ||
    staleHostReadSamples?.length !== expectedStaleHostReadSamples.length ||
    expectedStaleHostReadSamples.some(([toolName, expectedEffect], index) => {
      const sample = staleHostReadSamples?.[index];
      return (
        sample?.toolName !== toolName ||
        sample?.expectedEffect !== expectedEffect ||
        sample?.observedEffect !== expectedEffect ||
        sample?.pass !== true ||
        sample?.decision !== "ask" ||
        sample?.code !== "CC_MCP_EFFECT_CONFIRMATION_REQUIRED" ||
        sample?.trusted !== false ||
        sample?.transportCallCount !== 0 ||
        sample?.mutationCount !== 0 ||
        sample?.ledgerRecordCount !== 0
      );
    })
  ) {
    issues.push("stale host read policy probe");
  }
  const codeSnapshotRaceProbe = value?.codeSnapshotRaceProbe;
  const evidenceOperatingSystem = value?.runner?.operatingSystem;
  const codeSnapshotRequired = evidenceOperatingSystem === "linux";
  const expectedCodeSnapshotRuns = codeSnapshotRequired ? runs : 0;
  const codeSnapshotSamples = codeSnapshotRaceProbe?.samples;
  const macFailClosedValid =
    evidenceOperatingSystem !== "macos" ||
    (codeSnapshotRaceProbe?.reason ===
      "macos-atomic-runtime-exec-unavailable-fail-closed" &&
      codeSnapshotRaceProbe?.failClosed === true &&
      codeSnapshotRaceProbe?.candidateBackend === "macos-fd-code-snapshot" &&
      codeSnapshotRaceProbe?.adapterReason ===
        "macos_atomic_runtime_exec_unavailable" &&
      codeSnapshotRaceProbe?.runtimeProbeReason ===
        "public_api_has_no_descriptor_bound_exec" &&
      codeSnapshotRaceProbe?.entrySnapshotAtomic === false &&
      codeSnapshotRaceProbe?.runtimeLaunchAtomic === false);
  const windowsSkipValid =
    evidenceOperatingSystem !== "windows" ||
    codeSnapshotRaceProbe?.reason ===
      "windows-atomic-launch-covered-by-filter-oplock-gate";
  if (
    codeSnapshotRaceProbe?.pass !== true ||
    codeSnapshotRaceProbe?.required !== codeSnapshotRequired ||
    codeSnapshotRaceProbe?.requiredRuns !== expectedCodeSnapshotRuns ||
    codeSnapshotRaceProbe?.sampleCount !== expectedCodeSnapshotRuns ||
    codeSnapshotRaceProbe?.passCount !== expectedCodeSnapshotRuns ||
    codeSnapshotSamples?.length !== expectedCodeSnapshotRuns ||
    !macFailClosedValid ||
    !windowsSkipValid ||
    (codeSnapshotRequired &&
      (codeSnapshotRaceProbe?.backend !== "linux-fd-code-snapshot" ||
        codeSnapshotRaceProbe?.handleAtomic !== true ||
        codeSnapshotRaceProbe?.entrySnapshotAtomic !== true ||
        codeSnapshotRaceProbe?.runtimeLaunchAtomic !== true ||
        codeSnapshotRaceProbe?.sharedLibraryClosure !== false ||
        codeSnapshotRaceProbe?.sourceReplacementObserved !== true ||
        codeSnapshotRaceProbe?.originalSnapshotExecuted !== true ||
        codeSnapshotRaceProbe?.maliciousPathExecuted !== false ||
        codeSnapshotRaceProbe?.exitCode !== 0 ||
        codeSnapshotRaceProbe?.stdoutBytes !==
          codeSnapshotSamples.reduce(
            (total, sample) => total + sample.stdoutBytes,
            0,
          ) ||
        codeSnapshotRaceProbe?.stderrBytes !==
          codeSnapshotSamples.reduce(
            (total, sample) => total + sample.stderrBytes,
            0,
          ) ||
        codeSnapshotSamples.some(
          (sample, iteration) =>
            sample?.id !== `code-snapshot-race-${iteration}` ||
            sample?.iteration !== iteration ||
            sample?.pass !== true ||
            sample?.sourceReplacementObserved !== true ||
            sample?.originalSnapshotExecuted !== true ||
            sample?.maliciousPathExecuted !== false ||
            sample?.exitCode !== 0 ||
            !Number.isSafeInteger(sample?.stdoutBytes) ||
            sample.stdoutBytes <= 0 ||
            sample?.stderrBytes !== 0,
        )))
  ) {
    issues.push("code snapshot race probe");
  }
  if (
    !Array.isArray(value?.approvedProbe?.resourceScopes) ||
    !value.approvedProbe.resourceScopes.includes(
      "path:approved-claimed-read.txt",
    )
  ) {
    issues.push("resource scopes");
  }
  if (
    value?.invariants?.annotationsAreHintsOnly !== true ||
    value?.invariants?.defaultConfirmationRequired !== true ||
    value?.invariants?.hostAuthorizationRequiredForTrustedRead !== true ||
    value?.invariants?.unapprovedEffectsBeforeTransport !== 0 ||
    value?.invariants?.unapprovedMutations !== 0 ||
    value?.invariants?.unapprovedLedgerWrites !== 0 ||
    value?.invariants?.claimedReadRemainsUnknownWithoutHostAuthorization !==
      true ||
    value?.invariants?.staleHostReadCannotDowngradeRisk !== true
  ) {
    issues.push("invariants");
  }
  if (issues.length > 0) {
    throw new Error(`invalid MCP security evidence: ${issues.join(", ")}`);
  }
  return value;
}

export function verifyMcpSecurityEvidenceSet(options = {}) {
  const releaseCommit = normalizeReleaseCommit(options.releaseCommit);
  const evidenceDir = path.resolve(options.evidenceDir || "");
  const entries = fs
    .readdirSync(evidenceDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ name, value: readJson(path.join(evidenceDir, name)) }))
    .filter((entry) => entry.value?.schema === evidenceSchema);
  const expectedSystems = ["linux", "macos", "windows"];
  const actualSystems = entries
    .map((entry) => entry.value?.runner?.operatingSystem)
    .sort();
  if (JSON.stringify(actualSystems) !== JSON.stringify(expectedSystems)) {
    throw new Error(
      `MCP security evidence must contain exactly linux, macos, windows; found ${actualSystems.join(", ")}`,
    );
  }
  for (const entry of entries) {
    validateEvidence(entry.value, { releaseCommit, minimumRuns: 100 });
  }
  const aggregate = {
    schema: aggregateSchema,
    releaseCommit,
    result: "passed",
    verifiedAt: new Date().toISOString(),
    operatingSystems: expectedSystems,
    requiredRunsPerTool: entries[0].value.matrix.requiredRunsPerTool,
    toolCases: [...toolCases],
    sampleCount: entries.reduce(
      (total, entry) => total + entry.value.matrix.sampleCount,
      0,
    ),
    unapprovedTransportCallCount: 0,
    unapprovedMutationCount: 0,
    unapprovedLedgerRecordCount: 0,
    approvedProbeCount: entries.length,
    staleHostReadPolicyProbeCount: entries.length,
    codeSnapshotRaceOperatingSystems: ["linux"],
    codeSnapshotFailClosedOperatingSystems: ["macos"],
    codeSnapshotFailClosedProbeCount: entries.filter(
      (entry) =>
        entry.value.codeSnapshotRaceProbe?.failClosed === true &&
        entry.value.runner.operatingSystem === "macos",
    ).length,
    codeSnapshotRaceProbeCount: entries.filter(
      (entry) => entry.value.codeSnapshotRaceProbe?.required === true,
    ).length,
    requiredCodeSnapshotRaceRunsPerOperatingSystem:
      entries.find(
        (entry) => entry.value.codeSnapshotRaceProbe?.required === true,
      )?.value.codeSnapshotRaceProbe.requiredRuns || 0,
    codeSnapshotRaceSampleCount: entries.reduce(
      (total, entry) =>
        total + (entry.value.codeSnapshotRaceProbe?.sampleCount || 0),
      0,
    ),
    atomicPathReplacementEscapeCount: 0,
    annotationsAreHintsOnly: true,
    defaultConfirmationRequired: true,
    claimedReadRemainsUnknownWithoutHostAuthorization: true,
    staleHostReadCannotDowngradeRisk: true,
    evidence: entries.map((entry) => ({
      file: entry.name,
      operatingSystem: entry.value.runner.operatingSystem,
      sha256: sha256File(path.join(evidenceDir, entry.name)),
    })),
  };
  if (options.output) writeJson(options.output, aggregate);
  return aggregate;
}

function parseArgs(argv) {
  const options = { runs: 100 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--runs") options.runs = Number(argv[++index]);
    else if (argument === "--release-commit") {
      options.releaseCommit = argv[++index];
    } else if (argument === "--output") options.output = argv[++index];
    else if (argument === "--verify-evidence-dir") {
      options.evidenceDir = argv[++index];
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.evidenceDir) {
      const aggregate = verifyMcpSecurityEvidenceSet(options);
      process.stdout.write(
        `verified MCP security matrix ${aggregate.releaseCommit}: ${aggregate.sampleCount} unapproved adversarial calls, zero transports and mutations\n`,
      );
    } else {
      const evidence = await runMcpSecurityMatrix(options);
      process.stdout.write(
        `MCP security matrix passed on ${evidence.runner.operatingSystem}: ${evidence.matrix.sampleCount} unapproved adversarial calls\n`,
      );
    }
  } catch (error) {
    if (error?.evidence && !error?.evidenceWritten && error?.evidence?.result) {
      process.stderr.write(`${JSON.stringify(error.evidence, null, 2)}\n`);
    }
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}
