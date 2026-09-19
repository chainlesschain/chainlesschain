import { createHash, generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createPmExplorationEvaluator,
  createPmExplorationExecutionHost,
  createPmExplorationExecutionManifest,
  createPmExplorationGrader,
  createPmExplorationMerger,
  createPmExplorationProcessEvaluator,
  createPmExplorationProcessCurriculum,
  createPmExplorationProcessGrader,
  createPmExplorationProcessMerger,
  createPmExplorationProcessRunner,
  createPmExplorationRunner,
  evaluatePmExplorationMemory,
  executePmExplorationRound,
  inspectPmExplorationEvaluatorIsolation,
  inspectPmExplorationCurriculumIsolation,
  inspectPmExplorationExecutionHost,
  inspectPmExplorationGraderIsolation,
  inspectPmExplorationMergerIsolation,
  inspectPmExplorationRunnerIsolation,
  mergePmExplorationBranches,
  selectPmExplorationTask,
  PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V6,
  PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V5,
} from "../../src/lib/evolution/pm-exploration-execution-host.js";
import {
  EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA,
  EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA,
} from "../../src/lib/evolution/evolution-eval-gate.js";
import { createEvolutionEvalProcessSupervisor } from "../../src/lib/evolution/evolution-eval-process-supervisor.js";
import { createEvolutionEvalChildEvidenceStorePort } from "../../src/lib/evolution/evolution-eval-child-evidence-ledger-adapter.js";
import {
  createPmExplorationEvidenceBundle,
  PM_EXPLORATION_CURRICULUM_EVIDENCE_BUNDLE_SCHEMA,
  verifyPmExplorationEvidenceBundle,
} from "../../src/lib/evolution/pm-exploration-evidence-bundle.js";
import {
  createPmExplorationReceiptSigner,
  getPmExplorationReceiptSignerAuthority,
  inspectPmExplorationReceiptAuthority,
  PM_EXPLORATION_EVALUATOR_RECEIPT_SCHEMA,
  PM_EXPLORATION_CURRICULUM_RECEIPT_SCHEMA,
  PM_EXPLORATION_MERGE_RECEIPT_SCHEMA,
  verifyPmExplorationReceipt,
} from "../../src/lib/evolution/pm-exploration-receipts.js";
import {
  createPmExplorationJournal,
  createPmExplorationPlan,
  enterPmExplorationDeepStage,
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

function plan(maxWallClockMs = 20_000) {
  return createPmExplorationPlan({
    planId: "isolated-reviewer-plan",
    suiteDigest: sha("suite"),
    trainingPartitionDigest: sha("training"),
    trainingTaskIds: ["task-one"],
    environmentDigest: sha("environment"),
    initialMemoryDigest: sha("initial-memory"),
    broadBranchIds: ["branch-one"],
    maxRounds: 2,
    maxTokens: 20,
    maxToolCalls: 1,
    maxWallClockMs,
    maxConsecutiveNoGain: 2,
  });
}

const ROLE = Object.freeze({
  curriculum: Object.freeze({
    exportName: "select",
    operation: "pm-exploration-select-task",
  }),
  runner: Object.freeze({
    exportName: "run",
    operation: "pm-exploration-run",
  }),
  grader: Object.freeze({
    exportName: "grade",
    operation: "pm-exploration-grade",
  }),
  merger: Object.freeze({
    exportName: "merge",
    operation: "pm-exploration-merge",
  }),
  evaluator: Object.freeze({
    exportName: "evaluate",
    operation: "pm-exploration-evaluate",
  }),
});

async function processFixture(
  role,
  source,
  maxWallClockMs = 2_000,
  childEvidenceStore = null,
) {
  const root = await mkdtemp(join(tmpdir(), `cc-pm-process-${role}-`));
  roots.push(root);
  const modulePath = join(root, `${role}.mjs`);
  await writeFile(modulePath, source);
  const config = ROLE[role];
  const target = Object.freeze({
    schema: EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA,
    handlerId: `pm-isolated-${role}`,
    handlerRevision: `${role}-v1`,
    operation: config.operation,
    isolation: "process",
    handlerArtifactDigest: sha(source),
    authority: trust(`${role}-target`),
  });
  const authorityDescriptor = {
    schema: EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA,
    handlerId: `pm-${role}-supervisor`,
    handlerRevision: "supervisor-v1",
    operation: "deadline-supervision",
    handlerArtifactDigest: sha(`${role}-supervisor-handler`),
    authority: trust(`${role}-supervisor`),
  };
  const attest = async ({ purpose, payloadDigest }) => ({
    ...trust(
      `${role}-${purpose.includes("invocation") ? "invocation" : "supervisor"}`,
    ),
    value: sha(`${role}:${purpose}:${payloadDigest}`),
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
          exportName: config.exportName,
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
    childEvidenceStore,
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
    spawnCalls,
    supervisor,
    target,
  };
}

function durableEvidenceFixture() {
  const records = new Map();
  const descriptor = {
    tenantId: "tenant:pm-process-roles",
    streamId: "stream:pm-process-roles",
    authorityId: "authority:pm-process-evidence",
    revision: 1,
    handlerArtifactDigest: sha("pm-process-evidence-handler"),
  };
  const port = createEvolutionEvalChildEvidenceStorePort({
    descriptor,
    retain: async (request) => {
      records.set(request.receiptDigest, structuredClone(request));
      return {
        authenticated: true,
        durable: true,
        kind: request.kind,
        receiptDigest: request.receiptDigest,
      };
    },
    resolve: async (request) => {
      const record = records.get(request.receiptDigest);
      return {
        authenticated: true,
        durable: true,
        ...descriptor,
        kind: request.kind,
        receiptDigest: request.receiptDigest,
        evidence: structuredClone(record.evidence),
      };
    },
  });
  return { port, records };
}

function provider(role, receiptSigner, fixture) {
  if (role === "curriculum") {
    return createPmExplorationProcessCurriculum({
      signer: receiptSigner,
      supervisor: fixture.supervisor,
      target: fixture.target,
      maxWallClockMs: fixture.maxWallClockMs,
    });
  }
  if (role === "runner") {
    return fixture === null
      ? createPmExplorationRunner({
          signer: receiptSigner,
          run: async (request) => ({
            outputMemoryDigest: sha(`${request.stage}-memory`),
            traceDigest: sha(`${request.stage}-trace`),
          }),
        })
      : createPmExplorationProcessRunner({
          signer: receiptSigner,
          supervisor: fixture.supervisor,
          target: fixture.target,
          maxWallClockMs: fixture.maxWallClockMs,
        });
  }
  if (role === "grader") {
    return fixture === null
      ? createPmExplorationGrader({
          signer: receiptSigner,
          grade: async () => ({
            decision: "accept",
            scoreBasisPoints: 10_000,
            resultDigest: sha("grade"),
          }),
        })
      : createPmExplorationProcessGrader({
          signer: receiptSigner,
          supervisor: fixture.supervisor,
          target: fixture.target,
          maxWallClockMs: fixture.maxWallClockMs,
        });
  }
  if (role === "merger") {
    return fixture === null
      ? createPmExplorationMerger({
          signer: receiptSigner,
          merge: async () => ({
            outputMemoryDigest: sha("merged-memory"),
            conflictResolutionDigest: sha("conflicts"),
          }),
        })
      : createPmExplorationProcessMerger({
          signer: receiptSigner,
          supervisor: fixture.supervisor,
          target: fixture.target,
          maxWallClockMs: fixture.maxWallClockMs,
        });
  }
  return fixture === null
    ? createPmExplorationEvaluator({
        signer: receiptSigner,
        evaluate: async () => ({
          decision: "accept",
          scoreBasisPoints: 10_000,
          evaluationDigest: sha("evaluation"),
        }),
      })
    : createPmExplorationProcessEvaluator({
        signer: receiptSigner,
        supervisor: fixture.supervisor,
        target: fixture.target,
        maxWallClockMs: fixture.maxWallClockMs,
      });
}

function hostFixture({
  boundPlan,
  curriculumFixture = null,
  runnerFixture = null,
  graderFixture = null,
  mergerFixture = null,
  evaluatorFixture = null,
}) {
  const signers = {
    ...(curriculumFixture === null ? {} : { curriculum: signer("curriculum") }),
    runner: signer("execution"),
    grader: signer("grader"),
    merger: signer("merge"),
    evaluator: signer("evaluator"),
  };
  const providers = {
    ...(curriculumFixture === null
      ? {}
      : {
          curriculum: provider(
            "curriculum",
            signers.curriculum,
            curriculumFixture,
          ),
        }),
    runner: provider("runner", signers.runner, runnerFixture),
    grader: provider("grader", signers.grader, graderFixture),
    merger: provider("merger", signers.merger, mergerFixture),
    evaluator: provider("evaluator", signers.evaluator, evaluatorFixture),
  };
  const manifest = createPmExplorationExecutionManifest({
    planDigest: boundPlan.planDigest,
    environmentDigest: boundPlan.environmentDigest,
    ...(curriculumFixture === null
      ? {}
      : {
          curriculum: inspectPmExplorationReceiptAuthority(signers.curriculum),
          curriculumIsolation: inspectPmExplorationCurriculumIsolation(
            providers.curriculum,
          ),
        }),
    runner: inspectPmExplorationReceiptAuthority(signers.runner),
    ...(runnerFixture === null
      ? {}
      : {
          runnerIsolation: inspectPmExplorationRunnerIsolation(
            providers.runner,
          ),
        }),
    grader: inspectPmExplorationReceiptAuthority(signers.grader),
    ...(graderFixture === null
      ? {}
      : {
          graderIsolation: inspectPmExplorationGraderIsolation(
            providers.grader,
          ),
        }),
    merger: inspectPmExplorationReceiptAuthority(signers.merger),
    ...(mergerFixture === null
      ? {}
      : {
          mergerIsolation: inspectPmExplorationMergerIsolation(
            providers.merger,
          ),
        }),
    evaluator: inspectPmExplorationReceiptAuthority(signers.evaluator),
    ...(evaluatorFixture === null
      ? {}
      : {
          evaluatorIsolation: inspectPmExplorationEvaluatorIsolation(
            providers.evaluator,
          ),
        }),
    toolIds: [],
    toolPolicyDigest: sha("no-tools"),
    preRunSealDigest: sha("pre-run-seal"),
  });
  return {
    authorities: {
      ...(curriculumFixture === null
        ? {}
        : {
            curriculum: getPmExplorationReceiptSignerAuthority(
              signers.curriculum,
            ),
          }),
      merger: getPmExplorationReceiptSignerAuthority(signers.merger),
      evaluator: getPmExplorationReceiptSignerAuthority(signers.evaluator),
    },
    host: createPmExplorationExecutionHost({
      plan: boundPlan,
      manifest,
      ...(curriculumFixture === null
        ? {}
        : { curriculum: providers.curriculum }),
      runner: providers.runner,
      grader: providers.grader,
      merger: providers.merger,
      evaluator: providers.evaluator,
      invokeTool: async () => {
        throw new Error("tools are forbidden");
      },
      now: () => Date.parse("2026-09-19T00:00:00.000Z"),
    }),
    manifest,
    providers,
    signers,
  };
}

async function runBroad(host, journal, boundPlan) {
  return executePmExplorationRound(host, journal, {
    roundId: "round-broad",
    stage: "broad",
    branchId: "branch-one",
    taskId: "task-one",
    inputMemoryDigest: boundPlan.initialMemoryDigest,
  });
}

async function runDeep(host, journal, merge) {
  enterPmExplorationDeepStage(journal, merge.merge.mergeDigest);
  return executePmExplorationRound(host, journal, {
    roundId: "round-deep",
    stage: "deep",
    branchId: null,
    taskId: "task-one",
    inputMemoryDigest: merge.merge.outputMemoryDigest,
  });
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

describe("PM exploration process reviewers", () => {
  it("runs all four PM roles in supervised processes and signs reviewer evidence", async () => {
    const durableEvidence = durableEvidenceFixture();
    const fixtures = {
      runner: await processFixture(
        "runner",
        `export async function run(request) { return { outputMemoryDigest: "${sha("process-memory")}", traceDigest: "${sha("process-trace")}" }; }`,
        2_000,
        durableEvidence.port,
      ),
      grader: await processFixture(
        "grader",
        `export async function grade() { return { decision: "accept", scoreBasisPoints: 10000, resultDigest: "${sha("process-grade")}" }; }`,
        2_000,
        durableEvidence.port,
      ),
      merger: await processFixture(
        "merger",
        `export async function merge() { return { outputMemoryDigest: "${sha("merged-memory")}", conflictResolutionDigest: "${sha("process-conflicts")}" }; }`,
        2_000,
        durableEvidence.port,
      ),
      evaluator: await processFixture(
        "evaluator",
        `export async function evaluate() { return { decision: "accept", scoreBasisPoints: 10000, evaluationDigest: "${sha("process-evaluation")}" }; }`,
        2_000,
        durableEvidence.port,
      ),
    };
    const boundPlan = plan();
    const configured = hostFixture({
      boundPlan,
      runnerFixture: fixtures.runner,
      graderFixture: fixtures.grader,
      mergerFixture: fixtures.merger,
      evaluatorFixture: fixtures.evaluator,
    });
    const journal = createPmExplorationJournal(boundPlan);
    await runBroad(configured.host, journal, boundPlan);
    const merge = await mergePmExplorationBranches(configured.host, journal, {
      mergeId: "merge-one",
    });
    const deep = await runDeep(configured.host, journal, merge);
    const evaluation = await evaluatePmExplorationMemory(
      configured.host,
      journal,
      {
        finalMemoryDigest: deep.checkpoint.outputMemoryDigest,
        mergeReceipt: merge.mergeReceipt,
      },
    );

    expect(configured.manifest.schema).toBe(
      PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V5,
    );
    expect(inspectPmExplorationExecutionHost(configured.host)).toMatchObject({
      runnerIsolation: { mode: "process" },
      graderIsolation: { mode: "process" },
      mergerIsolation: { mode: "process" },
      evaluatorIsolation: { mode: "process" },
    });
    expect(merge.mergeReceipt.schema).toBe(PM_EXPLORATION_MERGE_RECEIPT_SCHEMA);
    expect(merge.mergeReceipt.payload.mergerIsolationEvidenceDigest).toBe(
      merge.mergerIsolationEvidenceDigest,
    );
    expect(evaluation.evaluatorReceipt.schema).toBe(
      PM_EXPLORATION_EVALUATOR_RECEIPT_SCHEMA,
    );
    expect(
      evaluation.evaluatorReceipt.payload.evaluatorIsolationEvidenceDigest,
    ).toBe(evaluation.evaluatorIsolationEvidenceDigest);
    expect(
      durableEvidence.records.get(merge.mergerIsolationEvidenceDigest),
    ).toMatchObject({ kind: "supervision" });
    expect(
      durableEvidence.records.get(evaluation.evaluatorIsolationEvidenceDigest),
    ).toMatchObject({ kind: "supervision" });
    expect(
      [...durableEvidence.records.values()].reduce(
        (counts, record) => ({
          ...counts,
          [record.kind]: (counts[record.kind] ?? 0) + 1,
        }),
        {},
      ),
    ).toEqual({ invocation: 6, revocation: 6, supervision: 6 });
    expect(evaluation.frozen).not.toBeNull();
    const tampered = structuredClone(merge.mergeReceipt);
    tampered.payload.mergerIsolationEvidenceDigest = sha("substituted");
    expect(() =>
      verifyPmExplorationReceipt(configured.authorities.merger, tampered),
    ).toThrow("digest mismatch");
    const children = Object.values(fixtures).flatMap(
      (fixture) => fixture.children,
    );
    expect(children).toHaveLength(6);
    expect(children.every((child) => child.pid !== process.pid)).toBe(true);
    expect(new Set(children.map((child) => child.pid)).size).toBe(
      children.length,
    );
    for (const fixture of Object.values(fixtures)) {
      expect(
        fixture.spawnCalls.every((call) => call[2].env !== process.env),
      ).toBe(true);
    }
  });

  it("rejects in-process reviewers substituted under a process manifest", async () => {
    const durableEvidence = durableEvidenceFixture();
    const mergerSource = `export async function merge() { return { outputMemoryDigest: "${sha("merged-memory")}", conflictResolutionDigest: "${sha("conflicts")}" }; }`;
    const mergerFixture = await processFixture(
      "merger",
      mergerSource,
      2_000,
      durableEvidence.port,
    );
    const evaluatorFixture = await processFixture(
      "evaluator",
      `export async function evaluate() { return { decision: "accept", scoreBasisPoints: 10000, evaluationDigest: "${sha("evaluation")}" }; }`,
    );
    const boundPlan = plan();
    const configured = hostFixture({
      boundPlan,
      mergerFixture,
      evaluatorFixture,
    });
    const directMerger = createPmExplorationMerger({
      signer: configured.signers.merger,
      merge: async () => ({
        outputMemoryDigest: sha("direct-memory"),
        conflictResolutionDigest: sha("direct-conflicts"),
      }),
    });
    const directEvaluator = createPmExplorationEvaluator({
      signer: configured.signers.evaluator,
      evaluate: async () => ({
        decision: "reject",
        scoreBasisPoints: 0,
        evaluationDigest: sha("direct-evaluation"),
      }),
    });
    const nonDurableMergerFixture = await processFixture(
      "merger",
      mergerSource,
    );
    const nonDurableMerger = createPmExplorationProcessMerger({
      signer: configured.signers.merger,
      supervisor: nonDurableMergerFixture.supervisor,
      target: nonDurableMergerFixture.target,
      maxWallClockMs: nonDurableMergerFixture.maxWallClockMs,
    });
    const createHost = (merger, evaluator) =>
      createPmExplorationExecutionHost({
        plan: boundPlan,
        manifest: configured.manifest,
        runner: configured.providers.runner,
        grader: configured.providers.grader,
        merger,
        evaluator,
        invokeTool: async () => null,
        now: Date.now,
      });
    expect(() =>
      createHost(directMerger, configured.providers.evaluator),
    ).toThrow("merger isolation differs from the manifest");
    expect(() =>
      createHost(configured.providers.merger, directEvaluator),
    ).toThrow("evaluator isolation differs from the manifest");
    expect(() =>
      createHost(nonDurableMerger, configured.providers.evaluator),
    ).toThrow("merger isolation differs from the manifest");
  });

  it("fails closed before spawn when merger module bytes are replaced", async () => {
    const mergerSource = `export async function merge() { return { outputMemoryDigest: "${sha("merged-memory")}", conflictResolutionDigest: "${sha("conflicts")}" }; }`;
    const mergerFixture = await processFixture("merger", mergerSource);
    const evaluatorFixture = await processFixture(
      "evaluator",
      `export async function evaluate() { return { decision: "accept", scoreBasisPoints: 10000, evaluationDigest: "${sha("evaluation")}" }; }`,
    );
    const boundPlan = plan();
    const configured = hostFixture({
      boundPlan,
      mergerFixture,
      evaluatorFixture,
    });
    const journal = createPmExplorationJournal(boundPlan);
    await runBroad(configured.host, journal, boundPlan);
    await writeFile(mergerFixture.modulePath, `${mergerSource}\n// replaced`);
    const result = await mergePmExplorationBranches(configured.host, journal, {
      mergeId: "merge-one",
    });
    expect(result.merge).toBeNull();
    expect(result.mergeReceipt.payload).toMatchObject({
      status: "failed",
      mergerIsolationEvidenceDigest: null,
    });
    expect(mergerFixture.children).toHaveLength(0);
  });

  it("hard-terminates a merger that exceeds its target deadline", async () => {
    const mergerFixture = await processFixture(
      "merger",
      "export async function merge() { await new Promise(() => {}); }",
      150,
    );
    const evaluatorFixture = await processFixture(
      "evaluator",
      `export async function evaluate() { return { decision: "accept", scoreBasisPoints: 10000, evaluationDigest: "${sha("evaluation")}" }; }`,
    );
    const boundPlan = plan();
    const configured = hostFixture({
      boundPlan,
      mergerFixture,
      evaluatorFixture,
    });
    const journal = createPmExplorationJournal(boundPlan);
    await runBroad(configured.host, journal, boundPlan);
    const result = await mergePmExplorationBranches(configured.host, journal, {
      mergeId: "merge-one",
    });
    expect(result.mergeReceipt.payload).toMatchObject({
      status: "failed",
      mergerIsolationEvidenceDigest: null,
    });
    await waitForClose(mergerFixture.children[0]);
    expect(
      mergerFixture.children[0].exitCode !== null ||
        mergerFixture.children[0].signalCode !== null,
    ).toBe(true);
  });

  it("hard-terminates an evaluator and records explicit unsafe evidence", async () => {
    const mergerFixture = await processFixture(
      "merger",
      `export async function merge() { return { outputMemoryDigest: "${sha("merged-memory")}", conflictResolutionDigest: "${sha("conflicts")}" }; }`,
    );
    const evaluatorFixture = await processFixture(
      "evaluator",
      "export async function evaluate() { await new Promise(() => {}); }",
      150,
    );
    const boundPlan = plan();
    const configured = hostFixture({
      boundPlan,
      mergerFixture,
      evaluatorFixture,
    });
    const journal = createPmExplorationJournal(boundPlan);
    await runBroad(configured.host, journal, boundPlan);
    const merge = await mergePmExplorationBranches(configured.host, journal, {
      mergeId: "merge-one",
    });
    const deep = await runDeep(configured.host, journal, merge);
    const result = await evaluatePmExplorationMemory(configured.host, journal, {
      finalMemoryDigest: deep.checkpoint.outputMemoryDigest,
      mergeReceipt: merge.mergeReceipt,
    });
    expect(result.frozen).toBeNull();
    expect(result.evaluatorReceipt.payload).toMatchObject({
      decision: "unsafe",
      scoreBasisPoints: 0,
      evaluatorIsolationEvidenceDigest: null,
    });
    await waitForClose(evaluatorFixture.children[0]);
    expect(
      evaluatorFixture.children[0].exitCode !== null ||
        evaluatorFixture.children[0].signalCode !== null,
    ).toBe(true);
  });

  it("requires a one-time signed process Curriculum selection before Actor execution", async () => {
    const durableEvidence = durableEvidenceFixture();
    const curriculumSource = [
      'import { readFile } from "node:fs/promises";',
      "export async function select(request) {",
      "  let privateFileDenied = false;",
      '  try { await readFile("private-grader.json", "utf8"); } catch { privateFileDenied = true; }',
      '  if (!privateFileDenied) throw new Error("private grader data was visible");',
      `  return { taskId: request.candidateTaskIds[0], rationaleDigest: "${sha("curriculum-rationale")}" };`,
      "}",
    ].join("\n");
    const curriculumFixture = await processFixture(
      "curriculum",
      curriculumSource,
      2_000,
      durableEvidence.port,
    );
    const boundPlan = plan();
    const configured = hostFixture({ boundPlan, curriculumFixture });
    const journal = createPmExplorationJournal(boundPlan);
    const selectionInput = {
      selectionId: "selection-broad",
      roundId: "round-broad",
      stage: "broad",
      branchId: "branch-one",
      inputMemoryDigest: boundPlan.initialMemoryDigest,
    };
    const selection = await selectPmExplorationTask(
      configured.host,
      journal,
      selectionInput,
    );

    expect(configured.manifest.schema).toBe(
      PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V6,
    );
    expect(inspectPmExplorationExecutionHost(configured.host)).toMatchObject({
      curriculumIsolation: { mode: "process" },
    });
    expect(selection.selection).toMatchObject({ taskId: "task-one" });
    expect(selection.curriculumReceipt).toMatchObject({
      schema: PM_EXPLORATION_CURRICULUM_RECEIPT_SCHEMA,
      payload: {
        roundId: "round-broad",
        taskId: "task-one",
        status: "succeeded",
        curriculumIsolationEvidenceDigest: expect.stringMatching(/^sha256:/u),
      },
    });
    expect(
      durableEvidence.records.get(selection.curriculumIsolationEvidenceDigest),
    ).toMatchObject({ kind: "supervision" });
    expect(curriculumFixture.children[0].pid).not.toBe(process.pid);
    expect(curriculumFixture.spawnCalls[0][2].env).toEqual({});

    const roundInput = {
      roundId: selectionInput.roundId,
      stage: selectionInput.stage,
      branchId: selectionInput.branchId,
      taskId: selection.selection.taskId,
      inputMemoryDigest: selectionInput.inputMemoryDigest,
    };
    await expect(
      executePmExplorationRound(configured.host, journal, roundInput),
    ).rejects.toThrow("unexpected or accessor fields");
    const result = await executePmExplorationRound(configured.host, journal, {
      ...roundInput,
      taskSelectionReceipt: selection.curriculumReceipt,
    });
    expect(result.checkpoint).toMatchObject({
      taskId: "task-one",
      accepted: true,
    });
    for (const key of ["tokens", "toolCalls", "wallClockMs"]) {
      expect(result.checkpoint.metrics[key]).toBe(
        selection.curriculumReceipt.payload.metrics[key] +
          result.executionReceipt.payload.metrics[key] +
          result.graderReceipt.payload.metrics[key],
      );
    }
    const snapshot = exportPmExplorationRecoverySnapshot(journal);
    const bundle = createPmExplorationEvidenceBundle({
      plan: boundPlan,
      manifest: configured.manifest,
      snapshot,
      authorities: {
        curriculum: configured.authorities.curriculum,
        execution: getPmExplorationReceiptSignerAuthority(
          configured.signers.runner,
        ),
        grader: getPmExplorationReceiptSignerAuthority(
          configured.signers.grader,
        ),
        merge: configured.authorities.merger,
        evaluator: configured.authorities.evaluator,
      },
      receipts: {
        curriculum: [selection.curriculumReceipt],
        execution: [result.executionReceipt],
        grader: [result.graderReceipt],
        merge: null,
        evaluator: null,
      },
    });
    expect(bundle).toMatchObject({
      schema: PM_EXPLORATION_CURRICULUM_EVIDENCE_BUNDLE_SCHEMA,
      curriculumReceipts: [
        { receiptDigest: selection.curriculumReceipt.receiptDigest },
      ],
      authenticated: true,
      snapshotAuthenticated: true,
    });
    expect(
      verifyPmExplorationEvidenceBundle({
        plan: boundPlan,
        manifest: configured.manifest,
        authorities: {
          curriculum: configured.authorities.curriculum,
          execution: getPmExplorationReceiptSignerAuthority(
            configured.signers.runner,
          ),
          grader: getPmExplorationReceiptSignerAuthority(
            configured.signers.grader,
          ),
          merge: configured.authorities.merger,
          evaluator: configured.authorities.evaluator,
        },
        snapshot,
        bundle,
      }),
    ).toEqual(bundle);
    await expect(
      executePmExplorationRound(configured.host, journal, {
        ...roundInput,
        taskSelectionReceipt: selection.curriculumReceipt,
      }),
    ).rejects.toThrow("missing or replayed");

    const tampered = structuredClone(selection.curriculumReceipt);
    tampered.payload.taskId = "task-substituted";
    expect(() =>
      verifyPmExplorationReceipt(configured.authorities.curriculum, tampered),
    ).toThrow("digest mismatch");
  });

  it("signs a failed selection when Curriculum chooses outside the frozen task partition", async () => {
    const curriculumFixture = await processFixture(
      "curriculum",
      `export async function select() { return { taskId: "task-outside", rationaleDigest: "${sha("outside-task")}" }; }`,
    );
    const boundPlan = plan();
    const configured = hostFixture({ boundPlan, curriculumFixture });
    const result = await selectPmExplorationTask(
      configured.host,
      createPmExplorationJournal(boundPlan),
      {
        selectionId: "selection-outside",
        roundId: "round-broad",
        stage: "broad",
        branchId: "branch-one",
        inputMemoryDigest: boundPlan.initialMemoryDigest,
      },
    );
    expect(result.selection).toBeNull();
    expect(result.curriculumReceipt.payload).toMatchObject({
      taskId: null,
      status: "failed",
      failureClass: "infrastructure",
      curriculumIsolationEvidenceDigest: null,
    });
  });

  it("fails Curriculum closed before spawn when its module bytes change", async () => {
    const source = `export async function select(request) { return { taskId: request.candidateTaskIds[0], rationaleDigest: "${sha("selection")}" }; }`;
    const curriculumFixture = await processFixture("curriculum", source);
    const boundPlan = plan();
    const configured = hostFixture({ boundPlan, curriculumFixture });
    await writeFile(curriculumFixture.modulePath, `${source}\n// replaced`);
    const result = await selectPmExplorationTask(
      configured.host,
      createPmExplorationJournal(boundPlan),
      {
        selectionId: "selection-replaced",
        roundId: "round-broad",
        stage: "broad",
        branchId: "branch-one",
        inputMemoryDigest: boundPlan.initialMemoryDigest,
      },
    );
    expect(result.selection).toBeNull();
    expect(result.curriculumReceipt.payload.status).toBe("failed");
    expect(curriculumFixture.children).toHaveLength(0);
  });

  it("hard-terminates Curriculum at its target deadline", async () => {
    const curriculumFixture = await processFixture(
      "curriculum",
      "export async function select() { await new Promise(() => {}); }",
      150,
    );
    const boundPlan = plan();
    const configured = hostFixture({ boundPlan, curriculumFixture });
    const result = await selectPmExplorationTask(
      configured.host,
      createPmExplorationJournal(boundPlan),
      {
        selectionId: "selection-timeout",
        roundId: "round-broad",
        stage: "broad",
        branchId: "branch-one",
        inputMemoryDigest: boundPlan.initialMemoryDigest,
      },
    );
    expect(result.selection).toBeNull();
    expect(result.curriculumReceipt.payload).toMatchObject({
      status: "failed",
      curriculumIsolationEvidenceDigest: null,
    });
    await waitForClose(curriculumFixture.children[0]);
    expect(
      curriculumFixture.children[0].exitCode !== null ||
        curriculumFixture.children[0].signalCode !== null,
    ).toBe(true);
  });

  it("rejects a Curriculum supervisor with the durable store removed", async () => {
    const source = `export async function select(request) { return { taskId: request.candidateTaskIds[0], rationaleDigest: "${sha("selection")}" }; }`;
    const durableEvidence = durableEvidenceFixture();
    const durableFixture = await processFixture(
      "curriculum",
      source,
      2_000,
      durableEvidence.port,
    );
    const nonDurableFixture = await processFixture("curriculum", source);
    const boundPlan = plan();
    const configured = hostFixture({
      boundPlan,
      curriculumFixture: durableFixture,
    });
    const replacement = createPmExplorationProcessCurriculum({
      signer: configured.signers.curriculum,
      supervisor: nonDurableFixture.supervisor,
      target: nonDurableFixture.target,
      maxWallClockMs: nonDurableFixture.maxWallClockMs,
    });
    expect(() =>
      createPmExplorationExecutionHost({
        plan: boundPlan,
        manifest: configured.manifest,
        curriculum: replacement,
        runner: configured.providers.runner,
        grader: configured.providers.grader,
        merger: configured.providers.merger,
        evaluator: configured.providers.evaluator,
        invokeTool: async () => null,
        now: Date.now,
      }),
    ).toThrow("curriculum differs from the manifest");
  });
});
