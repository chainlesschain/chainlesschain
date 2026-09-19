import { createHash, generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createPmExplorationExecutionHost,
  createPmExplorationExecutionManifest,
  createPmExplorationEvaluator,
  createPmExplorationGrader,
  createPmExplorationMerger,
  createPmExplorationProcessGrader,
  createPmExplorationProcessRunner,
  createPmExplorationRunner,
  executePmExplorationRound,
  inspectPmExplorationExecutionHost,
  inspectPmExplorationGraderIsolation,
  inspectPmExplorationRunnerIsolation,
  PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA,
  PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V4,
} from "../../src/lib/evolution/pm-exploration-execution-host.js";
import {
  createPmExplorationMemoryRetrievalAuthority,
  createPmExplorationModelEgressAuthority,
  inspectPmExplorationEgressAuthority,
} from "../../src/lib/evolution/pm-exploration-egress-authority.js";
import {
  EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA,
  EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA,
} from "../../src/lib/evolution/evolution-eval-gate.js";
import { createEvolutionEvalProcessSupervisor } from "../../src/lib/evolution/evolution-eval-process-supervisor.js";
import {
  createPmExplorationEvidenceBundle,
  verifyPmExplorationEvidenceBundle,
} from "../../src/lib/evolution/pm-exploration-evidence-bundle.js";
import {
  createPmExplorationReceiptSigner,
  getPmExplorationReceiptSignerAuthority,
  inspectPmExplorationReceiptAuthority,
  PM_EXPLORATION_EXECUTION_RECEIPT_SCHEMA,
  PM_EXPLORATION_EXECUTION_RECEIPT_SCHEMA_V2,
  verifyPmExplorationReceipt,
} from "../../src/lib/evolution/pm-exploration-receipts.js";
import {
  createPmExplorationJournal,
  createPmExplorationPlan,
  exportPmExplorationRecoverySnapshot,
} from "../../src/lib/evolution/pm-exploration-rounds.js";

const roots = [];

function sha(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function trust(label) {
  return {
    algorithm: "ed25519",
    issuer: `${label}-issuer`,
    keyId: `${label}-key`,
    trustPolicyDigest: sha(`${label}-policy`),
  };
}

function signer(role) {
  const keys = generateKeyPairSync("ed25519");
  return createPmExplorationReceiptSigner({
    role,
    authorityId: `${role}-authority`,
    revision: 1,
    handlerArtifactDigest: sha(`${role}-handler`),
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
  });
}

function plan(overrides = {}) {
  return createPmExplorationPlan({
    planId: "isolated-runner-plan",
    suiteDigest: sha("suite"),
    trainingPartitionDigest: sha("training"),
    trainingTaskIds: ["task-one"],
    environmentDigest: sha("environment"),
    initialMemoryDigest: sha("initial-memory"),
    broadBranchIds: ["branch-one"],
    maxRounds: 1,
    maxTokens: 10,
    maxToolCalls: 2,
    maxWallClockMs: 5_000,
    maxConsecutiveNoGain: 1,
    ...overrides,
  });
}

async function processFixture(
  source,
  {
    exportName = "run",
    handlerId = "pm-isolated-actor",
    maxWallClockMs = 2_000,
    operation = "pm-exploration-run",
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "cc-pm-process-runner-"));
  roots.push(root);
  const modulePath = join(root, "runner.mjs");
  await writeFile(modulePath, source);
  const target = Object.freeze({
    schema: EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA,
    handlerId,
    handlerRevision: "runner-v1",
    operation,
    isolation: "process",
    handlerArtifactDigest: sha(source),
    authority: trust("runner-target"),
  });
  const authorityDescriptor = {
    schema: EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA,
    handlerId: "pm-runner-supervisor",
    handlerRevision: "supervisor-v1",
    operation: "deadline-supervision",
    handlerArtifactDigest: sha("supervisor-handler"),
    authority: trust("supervisor"),
  };
  const attest = async ({ purpose, payloadDigest }) => ({
    ...trust(purpose.includes("invocation") ? "invocation" : "supervisor"),
    value: sha(`${purpose}:${payloadDigest}`),
  });
  const children = [];
  const spawnCalls = [];
  const supervisor = createEvolutionEvalProcessSupervisor({
    targets: new Map([
      [
        target.handlerId,
        {
          target,
          modulePath,
          exportName,
          sandboxPolicy: { memoryLimitMb: 64 },
        },
      ],
    ]),
    authorityDescriptor,
    supervisorRevision: "supervisor-v1",
    invocationRevision: "invocation-v1",
    revocationRevision: "revocation-v1",
    attestSupervisor: attest,
    attestInvocation: attest,
    attestRevocation: attest,
    verifyEnforcement: () => true,
    spawnProcess: (...args) => {
      spawnCalls.push(args);
      const child = spawn(...args);
      children.push(child);
      return child;
    },
  });
  return {
    children,
    maxWallClockMs,
    modulePath,
    root,
    spawnCalls,
    supervisor,
    target,
  };
}

function hostFixture({
  boundPlan,
  fixture,
  graderFixture = null,
  toolIds = ["project:get"],
  invokeTool,
  egress = null,
}) {
  const runnerSigner = signer("execution");
  const graderSigner = signer("grader");
  const mergerSigner = signer("merge");
  const evaluatorSigner = signer("evaluator");
  const privateExpected = "grader-private-answer";
  const runner = createPmExplorationProcessRunner({
    signer: runnerSigner,
    supervisor: fixture.supervisor,
    target: fixture.target,
    maxWallClockMs: fixture.maxWallClockMs,
    ...(egress === null ? {} : { egressBrokered: true }),
  });
  const grader =
    graderFixture === null
      ? createPmExplorationGrader({
          signer: graderSigner,
          grade: async (request) => ({
            decision:
              request.executionStatus === "succeeded" ? "accept" : "unsafe",
            scoreBasisPoints:
              request.executionStatus === "succeeded" ? 10_000 : 0,
            resultDigest: sha(
              `${privateExpected}:${request.executionReceiptDigest}`,
            ),
          }),
        })
      : createPmExplorationProcessGrader({
          signer: graderSigner,
          supervisor: graderFixture.supervisor,
          target: graderFixture.target,
          maxWallClockMs: graderFixture.maxWallClockMs,
        });
  const merger = createPmExplorationMerger({
    signer: mergerSigner,
    merge: async () => ({
      outputMemoryDigest: sha("merged-memory"),
      conflictResolutionDigest: sha("conflicts"),
    }),
  });
  const evaluator = createPmExplorationEvaluator({
    signer: evaluatorSigner,
    evaluate: async () => ({
      decision: "accept",
      scoreBasisPoints: 10_000,
      evaluationDigest: sha("evaluation"),
    }),
  });
  const manifest = createPmExplorationExecutionManifest({
    planDigest: boundPlan.planDigest,
    environmentDigest: boundPlan.environmentDigest,
    runner: inspectPmExplorationReceiptAuthority(runnerSigner),
    runnerIsolation: inspectPmExplorationRunnerIsolation(runner),
    ...(egress === null
      ? {}
      : {
          memoryRetrieval: inspectPmExplorationEgressAuthority(
            egress.memoryRetrieval,
          ),
          modelEgress: inspectPmExplorationEgressAuthority(egress.modelEgress),
        }),
    grader: inspectPmExplorationReceiptAuthority(graderSigner),
    ...(graderFixture === null
      ? {}
      : { graderIsolation: inspectPmExplorationGraderIsolation(grader) }),
    merger: inspectPmExplorationReceiptAuthority(mergerSigner),
    evaluator: inspectPmExplorationReceiptAuthority(evaluatorSigner),
    toolIds,
    toolPolicyDigest: sha("tool-policy"),
    preRunSealDigest: sha("pre-run-seal"),
  });
  const host = createPmExplorationExecutionHost({
    plan: boundPlan,
    manifest,
    runner,
    ...(egress === null ? {} : egress),
    grader,
    merger,
    evaluator,
    invokeTool,
    now: () => Date.parse("2026-09-19T00:00:00.000Z"),
  });
  return {
    authorities: {
      execution: getPmExplorationReceiptSignerAuthority(runnerSigner),
      grader: getPmExplorationReceiptSignerAuthority(graderSigner),
      merge: getPmExplorationReceiptSignerAuthority(mergerSigner),
      evaluator: getPmExplorationReceiptSignerAuthority(evaluatorSigner),
    },
    evaluator,
    grader,
    host,
    manifest,
    merger,
    privateExpected,
    runner,
    runnerAuthority: getPmExplorationReceiptSignerAuthority(runnerSigner),
    runnerSigner,
  };
}

async function execute(host, boundPlan) {
  return executePmExplorationRound(
    host,
    createPmExplorationJournal(boundPlan),
    {
      roundId: "round-one",
      stage: "broad",
      branchId: "branch-one",
      taskId: "task-one",
      inputMemoryDigest: boundPlan.initialMemoryDigest,
    },
  );
}

async function waitForClose(child) {
  if (child.exitCode === null && child.signalCode === null)
    await new Promise((resolve) => child.once("close", resolve));
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("PM exploration process runner", () => {
  it("runs the Actor in a restricted process while the parent owns budgets and tools", async () => {
    const source = [
      'import { readFile } from "node:fs/promises";',
      "export async function run(request, runtime) {",
      "  let fsDenied = false;",
      '  try { await readFile("forbidden-private-grader.json", "utf8"); }',
      "  catch { fsDenied = true; }",
      "  await runtime.recordTokens(7);",
      '  await runtime.invokeTool("project:get", { projectId: "project-one", childPid: process.pid, fsDenied });',
      `  return { outputMemoryDigest: "${sha("changed-memory")}", traceDigest: "${sha("actor-trace")}" };`,
      "}",
    ].join("\n");
    const fixture = await processFixture(source);
    const graderFixture = await processFixture(
      [
        "export async function grade(request) {",
        "  return {",
        '    decision: request.executionStatus === "succeeded" ? "accept" : "unsafe",',
        '    scoreBasisPoints: request.executionStatus === "succeeded" ? 10000 : 0,',
        `    resultDigest: "${sha("grader-private-answer")}",`,
        "  };",
        "}",
      ].join("\n"),
      {
        exportName: "grade",
        handlerId: "pm-private-grader",
        operation: "pm-exploration-grade",
      },
    );
    const toolCalls = [];
    const boundPlan = plan();
    const configured = hostFixture({
      boundPlan,
      fixture,
      graderFixture,
      invokeTool: async (request) => {
        toolCalls.push({
          toolId: request.toolId,
          input: structuredClone(request.input),
        });
        return { id: request.input.projectId, status: "active" };
      },
    });
    const journal = createPmExplorationJournal(boundPlan);
    const result = await executePmExplorationRound(configured.host, journal, {
      roundId: "round-one",
      stage: "broad",
      branchId: "branch-one",
      taskId: "task-one",
      inputMemoryDigest: boundPlan.initialMemoryDigest,
    });

    expect(configured.manifest.schema).toBe(
      PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V4,
    );
    expect(inspectPmExplorationExecutionHost(configured.host)).toMatchObject({
      runnerIsolation: {
        mode: "process",
        brokerMode: "parent-budgeted-tools",
      },
      graderIsolation: { mode: "process" },
    });
    expect(result.executionReceipt.payload).toMatchObject({
      status: "succeeded",
      metrics: { tokens: 7, toolCalls: 1 },
      runnerIsolationEvidenceDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(result.executionReceipt.schema).toBe(
      PM_EXPLORATION_EXECUTION_RECEIPT_SCHEMA_V2,
    );
    expect(
      verifyPmExplorationReceipt(
        configured.runnerAuthority,
        result.executionReceipt,
      ).payload.runnerIsolationEvidenceDigest,
    ).toBe(result.runnerIsolationEvidenceDigest);
    const tamperedReceipt = structuredClone(result.executionReceipt);
    tamperedReceipt.payload.runnerIsolationEvidenceDigest = sha("substituted");
    expect(() =>
      verifyPmExplorationReceipt(configured.runnerAuthority, tamperedReceipt),
    ).toThrow("digest mismatch");
    expect(result.graderReceipt.payload.decision).toBe("accept");
    expect(result.runnerIsolationEvidenceDigest).toMatch(/^sha256:/u);
    expect(toolCalls).toEqual([
      {
        toolId: "project:get",
        input: {
          projectId: "project-one",
          childPid: expect.any(Number),
          fsDenied: true,
        },
      },
    ]);
    expect(toolCalls[0].input.childPid).not.toBe(process.pid);
    expect(JSON.stringify(toolCalls)).not.toContain(configured.privateExpected);
    expect(fixture.spawnCalls[0][2].env).toEqual({});
    expect(graderFixture.children).toHaveLength(1);
    expect(graderFixture.children[0].pid).not.toBe(process.pid);
  });

  it("brokers Memory retrieval and model egress in the parent and signs their transcript", async () => {
    const boundPlan = plan();
    const source = [
      "export async function run(request, runtime) {",
      `  const memory = await runtime.retrieveMemory({ memoryDigest: request.inputMemoryDigest, query: { taskId: request.taskId } });`,
      `  const model = await runtime.invokeModel({ purpose: "actor-step", input: { taskId: request.taskId, memory }, maxOutputTokens: 2 });`,
      `  if (model.output.answer !== "ok") throw new Error("unexpected model output");`,
      `  return { outputMemoryDigest: "${sha("egress-memory")}", traceDigest: "${sha("egress-trace")}" };`,
      "}",
    ].join("\n");
    const fixture = await processFixture(source);
    const retrievals = [];
    const modelCalls = [];
    const memoryRetrieval = createPmExplorationMemoryRetrievalAuthority({
      authorityId: "pm-memory-retrieval",
      revision: 1,
      handlerArtifactDigest: sha("memory-handler"),
      policyDigest: sha("memory-policy"),
      retrieve: async (request) => {
        retrievals.push(structuredClone(request));
        return { items: [{ digest: request.memoryDigest, text: "lesson" }] };
      },
    });
    const modelEgress = createPmExplorationModelEgressAuthority({
      authorityId: "pm-model-egress",
      revision: 1,
      handlerArtifactDigest: sha("model-handler"),
      policyDigest: sha("model-policy"),
      invoke: async (request) => {
        modelCalls.push(structuredClone(request));
        return {
          output: { answer: "ok" },
          usage: { inputTokens: 3, outputTokens: 2 },
        };
      },
    });
    const configured = hostFixture({
      boundPlan,
      fixture,
      egress: { memoryRetrieval, modelEgress },
      invokeTool: async () => null,
    });
    const journal = createPmExplorationJournal(boundPlan);
    const result = await executePmExplorationRound(configured.host, journal, {
      roundId: "round-one",
      stage: "broad",
      branchId: "branch-one",
      taskId: "task-one",
      inputMemoryDigest: boundPlan.initialMemoryDigest,
    });

    expect(configured.manifest.schema).toBe(
      PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA,
    );
    expect(() =>
      createPmExplorationExecutionManifest({
        planDigest: configured.manifest.planDigest,
        environmentDigest: configured.manifest.environmentDigest,
        runner: configured.manifest.runner,
        runnerIsolation: configured.manifest.runnerIsolation,
        grader: configured.manifest.grader,
        merger: configured.manifest.merger,
        evaluator: configured.manifest.evaluator,
        toolIds: configured.manifest.toolIds,
        toolPolicyDigest: configured.manifest.toolPolicyDigest,
        preRunSealDigest: configured.manifest.preRunSealDigest,
      }),
    ).toThrow("must be paired");
    expect(inspectPmExplorationExecutionHost(configured.host)).toMatchObject({
      runnerIsolation: {
        brokerMode: "parent-budgeted-tools-memory-model",
      },
    });
    expect(result.executionReceipt.schema).toBe(
      PM_EXPLORATION_EXECUTION_RECEIPT_SCHEMA,
    );
    expect(result.executionReceipt.payload).toMatchObject({
      status: "succeeded",
      metrics: { tokens: 5, toolCalls: 2 },
      egressEvidenceDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(result.egressEvidenceDigest).toBe(
      result.executionReceipt.payload.egressEvidenceDigest,
    );
    expect(retrievals).toHaveLength(1);
    expect(retrievals[0]).toMatchObject({
      inputMemoryDigest: boundPlan.initialMemoryDigest,
      memoryDigest: boundPlan.initialMemoryDigest,
      taskId: "task-one",
      query: { taskId: "task-one" },
    });
    expect(modelCalls).toHaveLength(1);
    expect(modelCalls[0]).toMatchObject({
      purpose: "actor-step",
      maxOutputTokens: 2,
      remainingTokens: 10,
      taskId: "task-one",
    });
    const tampered = structuredClone(result.executionReceipt);
    tampered.payload.egressEvidenceDigest = sha("substituted-egress");
    expect(() =>
      verifyPmExplorationReceipt(configured.runnerAuthority, tampered),
    ).toThrow("digest mismatch");
    const snapshot = exportPmExplorationRecoverySnapshot(journal);
    const bundle = createPmExplorationEvidenceBundle({
      plan: boundPlan,
      manifest: configured.manifest,
      snapshot,
      authorities: configured.authorities,
      receipts: {
        execution: [result.executionReceipt],
        grader: [result.graderReceipt],
        merge: null,
        evaluator: null,
      },
    });
    expect(
      verifyPmExplorationEvidenceBundle({
        plan: boundPlan,
        manifest: configured.manifest,
        authorities: configured.authorities,
        snapshot,
        bundle,
      }),
    ).toEqual(bundle);
    const downgradedReceipt = structuredClone(result.executionReceipt);
    delete downgradedReceipt.payload.egressEvidenceDigest;
    expect(() =>
      createPmExplorationEvidenceBundle({
        plan: boundPlan,
        manifest: configured.manifest,
        snapshot,
        authorities: configured.authorities,
        receipts: {
          execution: [downgradedReceipt],
          grader: [result.graderReceipt],
          merge: null,
          evaluator: null,
        },
      }),
    ).toThrow();
  });

  it("fails closed when a child requests Memory outside its round snapshot", async () => {
    const boundPlan = plan();
    const source = [
      "export async function run(request, runtime) {",
      `  try { await runtime.retrieveMemory({ memoryDigest: "${sha("other-memory")}", query: {} }); } catch {}`,
      `  return { outputMemoryDigest: "${sha("changed-memory")}", traceDigest: "${sha("actor-trace")}" };`,
      "}",
    ].join("\n");
    const fixture = await processFixture(source);
    const memoryRetrieval = createPmExplorationMemoryRetrievalAuthority({
      authorityId: "pm-memory-retrieval",
      revision: 1,
      handlerArtifactDigest: sha("memory-handler"),
      policyDigest: sha("memory-policy"),
      retrieve: async () => ({ items: [] }),
    });
    const modelEgress = createPmExplorationModelEgressAuthority({
      authorityId: "pm-model-egress",
      revision: 1,
      handlerArtifactDigest: sha("model-handler"),
      policyDigest: sha("model-policy"),
      invoke: async () => ({
        output: null,
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    });
    const configured = hostFixture({
      boundPlan,
      fixture,
      egress: { memoryRetrieval, modelEgress },
      invokeTool: async () => null,
    });

    const result = await execute(configured.host, boundPlan);
    expect(result.executionReceipt.payload).toMatchObject({
      status: "aborted",
      failureClass: "sandbox",
      egressEvidenceDigest: null,
    });
    expect(result.graderReceipt.payload.decision).toBe("unsafe");
  });

  it("kills an Actor that requests a tool outside the manifest allow-list", async () => {
    const source = [
      "export async function run(request, runtime) {",
      '  try { await runtime.invokeTool("private:grader", { taskId: request.taskId }); } catch {}',
      `  return { outputMemoryDigest: "${sha("changed-memory")}", traceDigest: "${sha("actor-trace")}" };`,
      "}",
    ].join("\n");
    const fixture = await processFixture(source);
    const parentCalls = [];
    const boundPlan = plan();
    const configured = hostFixture({
      boundPlan,
      fixture,
      invokeTool: async (request) => {
        parentCalls.push(request);
        return null;
      },
    });
    const result = await execute(configured.host, boundPlan);
    expect(result.executionReceipt.payload).toMatchObject({
      status: "aborted",
      failureClass: "sandbox",
    });
    expect(result.graderReceipt.payload.decision).toBe("unsafe");
    expect(parentCalls).toHaveLength(0);
    await waitForClose(fixture.children[0]);
    expect(fixture.children[0].signalCode).not.toBeNull();
  });

  it("kills an Actor at the token budget before accepting its output", async () => {
    const source = [
      "export async function run(request, runtime) {",
      "  try { await runtime.recordTokens(11); } catch {}",
      `  return { outputMemoryDigest: "${sha("changed-memory")}", traceDigest: "${sha("actor-trace")}" };`,
      "}",
    ].join("\n");
    const fixture = await processFixture(source);
    const boundPlan = plan({ maxTokens: 10 });
    const configured = hostFixture({
      boundPlan,
      fixture,
      invokeTool: async () => null,
    });
    const result = await execute(configured.host, boundPlan);
    expect(result.executionReceipt.payload).toMatchObject({
      status: "aborted",
      failureClass: "budget",
      metrics: { tokens: 11 },
    });
    expect(result.graderReceipt.payload.decision).toBe("unsafe");
    await waitForClose(fixture.children[0]);
  });

  it("rejects a process manifest paired with an in-process runner", async () => {
    const source = `export async function run() { return { outputMemoryDigest: "${sha("changed-memory")}", traceDigest: "${sha("actor-trace")}" }; }`;
    const fixture = await processFixture(source);
    const boundPlan = plan();
    const configured = hostFixture({
      boundPlan,
      fixture,
      invokeTool: async () => null,
    });
    const direct = createPmExplorationRunner({
      signer: configured.runnerSigner,
      run: async () => ({
        outputMemoryDigest: sha("changed-memory"),
        traceDigest: sha("direct-trace"),
      }),
    });
    expect(inspectPmExplorationRunnerIsolation(direct)).toBeNull();
    expect(() =>
      createPmExplorationExecutionHost({
        plan: boundPlan,
        manifest: configured.manifest,
        runner: direct,
        grader: configured.grader,
        merger: configured.merger,
        evaluator: configured.evaluator,
        invokeTool: async () => null,
        now: Date.now,
      }),
    ).toThrow("runner isolation differs from the manifest");
  });

  it("fails closed before spawn when Actor module bytes are replaced", async () => {
    const source = `export async function run() { return { outputMemoryDigest: "${sha("changed-memory")}", traceDigest: "${sha("actor-trace")}" }; }`;
    const fixture = await processFixture(source);
    const boundPlan = plan();
    const configured = hostFixture({
      boundPlan,
      fixture,
      invokeTool: async () => null,
    });
    await writeFile(fixture.modulePath, `${source}\n// substituted`);
    const result = await execute(configured.host, boundPlan);
    expect(result.executionReceipt.payload.status).toBe("failed");
    expect(result.graderReceipt.payload.decision).toBe("unsafe");
    expect(fixture.children).toHaveLength(0);
  });

  it("hard-terminates an Actor that exceeds its target deadline", async () => {
    const source = `export async function run() { await new Promise(() => {}); }`;
    const fixture = await processFixture(source, { maxWallClockMs: 150 });
    const boundPlan = plan();
    const configured = hostFixture({
      boundPlan,
      fixture,
      invokeTool: async () => null,
    });
    const result = await execute(configured.host, boundPlan);
    expect(result.executionReceipt.payload.status).toBe("failed");
    expect(result.graderReceipt.payload.decision).toBe("unsafe");
    await waitForClose(fixture.children[0]);
    expect(
      fixture.children[0].exitCode !== null ||
        fixture.children[0].signalCode !== null,
    ).toBe(true);
  });
});
