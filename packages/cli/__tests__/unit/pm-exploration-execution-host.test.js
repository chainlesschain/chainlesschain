import { createHash, generateKeyPairSync } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestEvolutionCompositionFactory } from "../helpers/test-model-egress.js";
import {
  createPmExplorationExecutionHost,
  createPmExplorationExecutionManifest,
  createPmExplorationEvaluator,
  createPmExplorationGrader,
  createPmExplorationMerger,
  createPmExplorationRunner,
  evaluatePmExplorationMemory,
  executePmExplorationRound,
  inspectPmExplorationExecutionHost,
  mergePmExplorationBranches,
  PM_EXPLORATION_GRADE_REQUEST_SCHEMA_V1,
  PM_EXPLORATION_RUN_REQUEST_SCHEMA,
  verifyPmExplorationExecutionManifest,
} from "../../src/lib/evolution/pm-exploration-execution-host.js";
import {
  createPmExplorationEvidenceBundle,
  PM_EXPLORATION_PROVIDER_EVIDENCE_BUNDLE_SCHEMA,
  verifyPmExplorationEvidenceBundle,
} from "../../src/lib/evolution/pm-exploration-evidence-bundle.js";
import {
  createPmExplorationReceiptSigner,
  getPmExplorationReceiptSignerAuthority,
  inspectPmExplorationReceiptAuthority,
  issuePmExplorationReceipt,
} from "../../src/lib/evolution/pm-exploration-receipts.js";
import {
  PM_EXPLORATION_PROVIDER_PERSISTENCE_SCHEMA,
  createPmExplorationVolcengineProvider,
  invokePmExplorationVolcengine,
} from "../../src/lib/evolution/pm-exploration-volcengine-provider.js";
import {
  completePmExplorationRound,
  createPmExplorationJournal,
  createPmExplorationPlan,
  enterPmExplorationDeepStage,
  exportPmExplorationRecoverySnapshot,
  inspectPmExplorationJournal,
  startPmExplorationRound,
} from "../../src/lib/evolution/pm-exploration-rounds.js";

function sha(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function protocolHash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function createSigner(role, keys = generateKeyPairSync("ed25519")) {
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
    planId: "host-plan",
    suiteDigest: sha("suite"),
    trainingPartitionDigest: sha("training"),
    trainingTaskIds: ["task-one"],
    environmentDigest: sha("environment"),
    initialMemoryDigest: sha("initial-memory"),
    broadBranchIds: ["workflow"],
    maxRounds: 4,
    maxTokens: 100,
    maxToolCalls: 4,
    maxWallClockMs: 10_000,
    maxConsecutiveNoGain: 2,
    ...overrides,
  });
}

function setup({
  plan: boundPlan = plan(),
  run,
  grade,
  merge,
  evaluate,
  invokeTool,
} = {}) {
  const runnerSigner = createSigner("execution");
  const graderSigner = createSigner("grader");
  const mergerSigner = createSigner("merge");
  const evaluatorSigner = createSigner("evaluator");
  const runner = createPmExplorationRunner({
    signer: runnerSigner,
    run:
      run ??
      (async (request, runtime) => {
        runtime.recordTokens(7);
        await runtime.invokeTool("project:get", { projectId: "project-one" });
        return {
          outputMemoryDigest: sha(`${request.roundId}-memory`),
          traceDigest: sha(`${request.roundId}-trace`),
        };
      }),
  });
  const grader = createPmExplorationGrader({
    signer: graderSigner,
    grade:
      grade ??
      (async (request, runtime) => {
        runtime.recordTokens(2);
        return {
          decision:
            request.executionStatus === "succeeded" ? "accept" : "unsafe",
          scoreBasisPoints: request.executionStatus === "succeeded" ? 9000 : 0,
          resultDigest: sha(`${request.roundId}-grade`),
        };
      }),
  });
  const merger = createPmExplorationMerger({
    signer: mergerSigner,
    merge:
      merge ??
      (async (request, runtime) => {
        runtime.recordTokens(3);
        return {
          outputMemoryDigest: sha(`${request.mergeId}-memory`),
          conflictResolutionDigest: sha(`${request.mergeId}-conflicts`),
        };
      }),
  });
  const evaluator = createPmExplorationEvaluator({
    signer: evaluatorSigner,
    evaluate:
      evaluate ??
      (async (request, runtime) => {
        runtime.recordTokens(3);
        return {
          decision: "accept",
          scoreBasisPoints: 9500,
          evaluationDigest: sha(`${request.finalMemoryDigest}-evaluation`),
        };
      }),
  });
  const manifest = createPmExplorationExecutionManifest({
    planDigest: boundPlan.planDigest,
    environmentDigest: boundPlan.environmentDigest,
    runner: inspectPmExplorationReceiptAuthority(runnerSigner),
    grader: inspectPmExplorationReceiptAuthority(graderSigner),
    merger: inspectPmExplorationReceiptAuthority(mergerSigner),
    evaluator: inspectPmExplorationReceiptAuthority(evaluatorSigner),
    toolIds: ["project:get"],
    toolPolicyDigest: sha("tool-policy"),
    preRunSealDigest: sha("pre-run-seal"),
  });
  const host = createPmExplorationExecutionHost({
    plan: boundPlan,
    manifest,
    runner,
    grader,
    merger,
    evaluator,
    invokeTool:
      invokeTool ??
      (async ({ input }) => ({ id: input.projectId, status: "active" })),
    now: () => Date.parse("2026-09-18T00:00:00.000Z"),
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
    plan: boundPlan,
    runner,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PM exploration execution host", () => {
  it("runs through an allow-listed tool broker and settles signed receipts", async () => {
    const calls = [];
    const {
      host,
      manifest,
      plan: boundPlan,
    } = setup({
      invokeTool: async ({ toolId, input, signal }) => {
        calls.push({ toolId, input, aborted: signal.aborted });
        return { id: input.projectId, status: "active" };
      },
    });
    const journal = createPmExplorationJournal(boundPlan);
    expect(inspectPmExplorationExecutionHost(host)).toEqual({
      planDigest: boundPlan.planDigest,
      environmentDigest: boundPlan.environmentDigest,
      manifestDigest: expect.stringMatching(/^sha256:/u),
      preRunSealDigest: sha("pre-run-seal"),
    });
    expect(() =>
      verifyPmExplorationExecutionManifest({
        ...manifest,
        preRunSealDigest: sha("substituted-pre-run-seal"),
      }),
    ).toThrow("manifest digest mismatch");
    const result = await executePmExplorationRound(host, journal, {
      roundId: "round-one",
      stage: "broad",
      branchId: "workflow",
      taskId: "task-one",
      inputMemoryDigest: boundPlan.initialMemoryDigest,
    });

    expect(result.receiptsAuthenticated).toBe(true);
    expect(result.budgetEnforced).toBe(true);
    expect(result.snapshotAuthenticated).toBe(false);
    expect(result.qualifiesForPromotion).toBe(false);
    expect(result.executionReceipt.payload.metrics.tokens).toBe(7);
    expect(result.graderReceipt.payload.metrics.tokens).toBe(2);
    expect(result.checkpoint).toMatchObject({
      accepted: true,
      authenticated: false,
      executionReceiptDigest: result.executionReceipt.receiptDigest,
      graderReceiptDigest: result.graderReceipt.receiptDigest,
      metrics: { tokens: 9, toolCalls: 1 },
    });
    expect(inspectPmExplorationJournal(journal).aggregateMetrics.tokens).toBe(
      9,
    );
    expect(calls).toHaveLength(1);
  });

  it("turns hard budget exhaustion into signed unsafe evidence", async () => {
    const boundPlan = plan({ maxTokens: 2 });
    const { host } = setup({
      plan: boundPlan,
      run: async (_request, runtime) => {
        runtime.recordTokens(3);
        return {
          outputMemoryDigest: sha("unreachable-memory"),
          traceDigest: sha("unreachable-trace"),
        };
      },
      grade: async () => ({
        decision: "accept",
        scoreBasisPoints: 10_000,
        resultDigest: sha("invalid-accept"),
      }),
    });
    const journal = createPmExplorationJournal(boundPlan);
    const result = await executePmExplorationRound(host, journal, {
      roundId: "round-budget",
      stage: "broad",
      branchId: "workflow",
      taskId: "task-one",
      inputMemoryDigest: boundPlan.initialMemoryDigest,
    });

    expect(result.executionReceipt.payload).toMatchObject({
      status: "aborted",
      failureClass: "budget",
      outputMemoryDigest: boundPlan.initialMemoryDigest,
    });
    expect(result.graderReceipt.payload.decision).toBe("unsafe");
    expect(result.checkpoint.disposition).toBe("rejected-budget");
    expect(result.checkpoint.effectiveMemoryDigest).toBe(
      boundPlan.initialMemoryDigest,
    );
    expect(inspectPmExplorationJournal(journal).stopReason).toBe(
      "budget-exhausted",
    );
  });

  it("binds signed merge and evaluator receipts across the full round flow", async () => {
    const { authorities, host, manifest, plan: boundPlan } = setup();
    const journal = createPmExplorationJournal(boundPlan);
    const broad = await executePmExplorationRound(host, journal, {
      roundId: "round-broad",
      stage: "broad",
      branchId: "workflow",
      taskId: "task-one",
      inputMemoryDigest: boundPlan.initialMemoryDigest,
    });
    const merged = await mergePmExplorationBranches(host, journal, {
      mergeId: "merge-one",
    });
    expect(merged.mergeReceipt.payload.status).toBe("succeeded");
    expect(merged.merge.conflictResolutionReceiptDigest).toBe(
      merged.mergeReceipt.receiptDigest,
    );

    const deep = enterPmExplorationDeepStage(journal, merged.merge.mergeDigest);
    const completed = await executePmExplorationRound(host, journal, {
      roundId: "round-deep",
      stage: "deep",
      branchId: null,
      taskId: "task-one",
      inputMemoryDigest: deep.inputMemoryDigest,
    });
    const evaluated = await evaluatePmExplorationMemory(host, journal, {
      finalMemoryDigest: completed.checkpoint.effectiveMemoryDigest,
      mergeReceipt: merged.mergeReceipt,
    });

    expect(evaluated.evaluatorReceipt.payload.decision).toBe("accept");
    expect(evaluated.frozen.evaluatorReceiptDigest).toBe(
      evaluated.evaluatorReceipt.receiptDigest,
    );
    expect(inspectPmExplorationJournal(journal).stage).toBe("frozen");
    expect(evaluated.snapshotAuthenticated).toBe(false);
    expect(evaluated.qualifiesForPromotion).toBe(false);

    const snapshot = exportPmExplorationRecoverySnapshot(journal);
    const bundle = createPmExplorationEvidenceBundle({
      plan: boundPlan,
      manifest,
      snapshot,
      authorities,
      receipts: {
        execution: [broad.executionReceipt, completed.executionReceipt],
        grader: [broad.graderReceipt, completed.graderReceipt],
        merge: merged.mergeReceipt,
        evaluator: evaluated.evaluatorReceipt,
      },
    });
    expect(bundle.snapshotAuthenticated).toBe(true);
    expect(bundle.qualifiesForPromotion).toBe(false);
    const restored = verifyPmExplorationEvidenceBundle({
      plan: boundPlan,
      manifest,
      authorities,
      snapshot: JSON.parse(JSON.stringify(snapshot)),
      bundle: JSON.parse(JSON.stringify(bundle)),
    });
    expect(restored.evidenceDigest).toBe(bundle.evidenceDigest);

    const tampered = JSON.parse(JSON.stringify(bundle));
    tampered.graderReceipts[0].payload.scoreBasisPoints = 10_000;
    expect(() =>
      verifyPmExplorationEvidenceBundle({
        plan: boundPlan,
        manifest,
        authorities,
        snapshot,
        bundle: tampered,
      }),
    ).toThrow(/digest mismatch/);
  });

  it("keeps authenticated v1 grader receipts readable as historical evidence", () => {
    const boundPlan = plan();
    const signers = {
      execution: createSigner("execution"),
      grader: createSigner("grader"),
      merge: createSigner("merge"),
      evaluator: createSigner("evaluator"),
    };
    const authorities = Object.fromEntries(
      Object.entries(signers).map(([role, signer]) => [
        role,
        getPmExplorationReceiptSignerAuthority(signer),
      ]),
    );
    const manifest = createPmExplorationExecutionManifest({
      planDigest: boundPlan.planDigest,
      environmentDigest: boundPlan.environmentDigest,
      runner: inspectPmExplorationReceiptAuthority(signers.execution),
      grader: inspectPmExplorationReceiptAuthority(signers.grader),
      merger: inspectPmExplorationReceiptAuthority(signers.merge),
      evaluator: inspectPmExplorationReceiptAuthority(signers.evaluator),
      toolIds: ["project:get"],
      toolPolicyDigest: sha("tool-policy"),
      preRunSealDigest: sha("pre-run-seal"),
    });
    const journal = createPmExplorationJournal(boundPlan);
    const roundInput = {
      roundId: "round-legacy",
      stage: "broad",
      branchId: "workflow",
      taskId: "task-one",
      inputMemoryDigest: boundPlan.initialMemoryDigest,
    };
    const round = startPmExplorationRound(journal, roundInput);
    const runCore = {
      schema: PM_EXPLORATION_RUN_REQUEST_SCHEMA,
      planDigest: boundPlan.planDigest,
      suiteDigest: boundPlan.suiteDigest,
      trainingPartitionDigest: boundPlan.trainingPartitionDigest,
      environmentDigest: boundPlan.environmentDigest,
      executionManifestDigest: manifest.manifestDigest,
      toolPolicyDigest: manifest.toolPolicyDigest,
      ...roundInput,
    };
    const executionRequestDigest = protocolHash(
      PM_EXPLORATION_RUN_REQUEST_SCHEMA,
      runCore,
    );
    const outputMemoryDigest = sha("legacy-output-memory");
    const traceDigest = sha("legacy-trace");
    const executionReceipt = issuePmExplorationReceipt(signers.execution, {
      planDigest: boundPlan.planDigest,
      environmentDigest: boundPlan.environmentDigest,
      requestDigest: executionRequestDigest,
      ...roundInput,
      outputMemoryDigest,
      traceDigest,
      status: "succeeded",
      failureClass: "none",
      metrics: { tokens: 3, toolCalls: 0, wallClockMs: 2 },
      issuedAt: "2026-09-18T00:00:00.000Z",
    });
    const legacyGradeCore = {
      schema: PM_EXPLORATION_GRADE_REQUEST_SCHEMA_V1,
      planDigest: boundPlan.planDigest,
      environmentDigest: boundPlan.environmentDigest,
      executionManifestDigest: manifest.manifestDigest,
      roundId: roundInput.roundId,
      inputMemoryDigest: roundInput.inputMemoryDigest,
      outputMemoryDigest,
      executionStatus: "succeeded",
      executionReceiptDigest: executionReceipt.receiptDigest,
      traceDigest,
    };
    const graderReceipt = issuePmExplorationReceipt(signers.grader, {
      planDigest: boundPlan.planDigest,
      environmentDigest: boundPlan.environmentDigest,
      requestDigest: protocolHash(
        PM_EXPLORATION_GRADE_REQUEST_SCHEMA_V1,
        legacyGradeCore,
      ),
      roundId: roundInput.roundId,
      executionReceiptDigest: executionReceipt.receiptDigest,
      outputMemoryDigest,
      decision: "accept",
      scoreBasisPoints: 10_000,
      resultDigest: sha("legacy-grade-result"),
      metrics: { tokens: 1, toolCalls: 0, wallClockMs: 1 },
      issuedAt: "2026-09-18T00:00:00.000Z",
    });
    completePmExplorationRound(journal, round, {
      executionReceiptDigest: executionReceipt.receiptDigest,
      graderReceiptDigest: graderReceipt.receiptDigest,
      outputMemoryDigest,
      decision: "accept",
      metrics: { tokens: 4, toolCalls: 0, wallClockMs: 3 },
    });
    const snapshot = exportPmExplorationRecoverySnapshot(journal);

    const bundle = createPmExplorationEvidenceBundle({
      plan: boundPlan,
      manifest,
      snapshot,
      authorities,
      receipts: {
        execution: [executionReceipt],
        grader: [graderReceipt],
        merge: null,
        evaluator: null,
      },
    });

    expect(bundle.graderReceipts[0].receiptDigest).toBe(
      graderReceipt.receiptDigest,
    );
    expect(
      verifyPmExplorationEvidenceBundle({
        plan: boundPlan,
        manifest,
        authorities,
        snapshot,
        bundle,
      }).evidenceDigest,
    ).toBe(bundle.evidenceDigest);
  });

  it("retains a provider usage settlement with the signed execution trace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"memory":"candidate"}' } }],
          usage: {
            prompt_tokens: 8,
            completion_tokens: 4,
            prompt_tokens_details: { cached_tokens: 0 },
          },
        }),
      })),
    );
    const composition = await createTestEvolutionCompositionFactory()({
      runId: "pm-provider-evidence",
    });
    const provider = createPmExplorationVolcengineProvider({
      apiKey: "local-test-secret",
      model: "deepseek-v4-flash-ga-260731",
      maxOutputTokens: 64,
      timeoutMs: 1_000,
      evolutionIngress: composition.evolutionIngress,
      persistSettlement: async (settlement) => ({
        schema: PM_EXPLORATION_PROVIDER_PERSISTENCE_SCHEMA,
        settlementDigest: settlement.settlementDigest,
        persisted: true,
        durable: true,
        recordDigest: sha(settlement.settlementDigest),
      }),
    });
    const {
      authorities,
      host,
      manifest,
      plan: boundPlan,
    } = setup({
      run: async (request, runtime) => {
        const result = await invokePmExplorationVolcengine(provider, {
          messages: [
            { role: "system", content: "Return a bounded candidate JSON." },
            { role: "user", content: "Propose the next PM memory candidate." },
          ],
          runtime,
          maxOutputTokens: 32,
          operationId: "runner.provider-evidence",
          executionRequestDigest: request.requestDigest,
        });
        return {
          outputMemoryDigest: sha(result.content),
          traceDigest: result.settlement.settlementDigest,
          providerSettlement: {
            settlement: result.settlement,
            persistence: result.persistence,
          },
        };
      },
    });
    const journal = createPmExplorationJournal(boundPlan);
    const result = await executePmExplorationRound(host, journal, {
      roundId: "round-provider",
      stage: "broad",
      branchId: "workflow",
      taskId: "task-one",
      inputMemoryDigest: boundPlan.initialMemoryDigest,
    });

    expect(result.executionReceipt.payload.traceDigest).toBe(
      result.providerSettlement.settlement.settlementDigest,
    );
    expect(result.executionReceipt.payload.metrics.tokens).toBe(12);
    const snapshot = exportPmExplorationRecoverySnapshot(journal);
    const bundle = createPmExplorationEvidenceBundle({
      plan: boundPlan,
      manifest,
      snapshot,
      authorities,
      receipts: {
        execution: [result.executionReceipt],
        grader: [result.graderReceipt],
        merge: null,
        evaluator: null,
      },
      providerSettlements: [result.providerSettlement],
    });
    expect(bundle.schema).toBe(PM_EXPLORATION_PROVIDER_EVIDENCE_BUNDLE_SCHEMA);
    expect(bundle.providerSettlements).toHaveLength(1);

    const restored = verifyPmExplorationEvidenceBundle({
      plan: boundPlan,
      manifest,
      authorities,
      snapshot: JSON.parse(JSON.stringify(snapshot)),
      bundle: JSON.parse(JSON.stringify(bundle)),
    });
    expect(restored.evidenceDigest).toBe(bundle.evidenceDigest);

    const tampered = JSON.parse(JSON.stringify(bundle));
    tampered.providerSettlements[0].settlement.usage.outputTokens = 99;
    expect(() =>
      verifyPmExplorationEvidenceBundle({
        plan: boundPlan,
        manifest,
        authorities,
        snapshot,
        bundle: tampered,
      }),
    ).toThrow(/usage total|cost does not match|digest mismatch/);
  });

  it("never dispatches tools outside the manifest allow-list", async () => {
    let brokerCalls = 0;
    const { host, plan: boundPlan } = setup({
      run: async (_request, runtime) => {
        await runtime.invokeTool("project:delete", { id: "project-one" });
        return {
          outputMemoryDigest: sha("unreachable-memory"),
          traceDigest: sha("unreachable-trace"),
        };
      },
      invokeTool: async () => {
        brokerCalls += 1;
        return {};
      },
    });
    const journal = createPmExplorationJournal(boundPlan);
    const result = await executePmExplorationRound(host, journal, {
      roundId: "round-policy",
      stage: "broad",
      branchId: "workflow",
      taskId: "task-one",
      inputMemoryDigest: boundPlan.initialMemoryDigest,
    });

    expect(brokerCalls).toBe(0);
    expect(result.executionReceipt.payload.status).toBe("aborted");
    expect(result.executionReceipt.payload.failureClass).toBe("sandbox");
    expect(result.graderReceipt.payload.decision).toBe("unsafe");
  });

  it("requires distinct runner and grader keys", () => {
    const shared = generateKeyPairSync("ed25519");
    const runnerSigner = createSigner("execution", shared);
    const graderSigner = createSigner("grader", shared);
    const mergerSigner = createSigner("merge");
    const evaluatorSigner = createSigner("evaluator");
    const boundPlan = plan();
    expect(() =>
      createPmExplorationExecutionManifest({
        planDigest: boundPlan.planDigest,
        environmentDigest: boundPlan.environmentDigest,
        runner: inspectPmExplorationReceiptAuthority(runnerSigner),
        grader: inspectPmExplorationReceiptAuthority(graderSigner),
        merger: inspectPmExplorationReceiptAuthority(mergerSigner),
        evaluator: inspectPmExplorationReceiptAuthority(evaluatorSigner),
        toolIds: [],
        toolPolicyDigest: sha("tool-policy"),
        preRunSealDigest: sha("pre-run-seal"),
      }),
    ).toThrow(/independent authorities/);
  });
});
