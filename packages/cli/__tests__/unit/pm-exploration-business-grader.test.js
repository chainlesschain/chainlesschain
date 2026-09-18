import { createHash, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPmExplorationBusinessGrader,
  createPmExplorationReadOnlyOutcomeSource,
  inspectPmExplorationReadOnlyOutcomeSource,
  PM_EXPLORATION_OUTCOME_QUERY_SCHEMA,
  PM_EXPLORATION_OUTCOME_SOURCE_SCHEMA,
} from "../../src/lib/evolution/pm-exploration-business-grader.js";
import {
  createPmExplorationEvaluator,
  createPmExplorationExecutionHost,
  createPmExplorationExecutionManifest,
  createPmExplorationMerger,
  createPmExplorationRunner,
  executePmExplorationRound,
} from "../../src/lib/evolution/pm-exploration-execution-host.js";
import {
  createPmExplorationReceiptSigner,
  inspectPmExplorationReceiptAuthority,
} from "../../src/lib/evolution/pm-exploration-receipts.js";
import {
  createPmExplorationJournal,
  createPmExplorationPlan,
} from "../../src/lib/evolution/pm-exploration-rounds.js";

const TEMP_ROOTS = [];

function sha(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function signer(role, handlerArtifactDigest = sha(`${role}-handler`)) {
  const keys = generateKeyPairSync("ed25519");
  return createPmExplorationReceiptSigner({
    role,
    authorityId: `${role}-authority`,
    revision: 1,
    handlerArtifactDigest,
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
  });
}

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pm-grader-"));
  TEMP_ROOTS.push(root);
  return root;
}

function setup({
  expectations,
  readProjectState = null,
  readBoardExport = null,
  run,
} = {}) {
  const boundPlan = createPmExplorationPlan({
    planId: "business-grader-plan",
    suiteDigest: sha("suite"),
    trainingPartitionDigest: sha("training"),
    trainingTaskIds: ["task-one"],
    environmentDigest: sha("environment"),
    initialMemoryDigest: sha("initial-memory"),
    broadBranchIds: ["workflow"],
    maxRounds: 2,
    maxTokens: 100,
    maxToolCalls: 1,
    maxWallClockMs: 10_000,
    maxConsecutiveNoGain: 1,
  });
  const graderHandlerDigest = sha("signed-desktop-deployment");
  const signers = {
    execution: signer("execution"),
    grader: signer("grader", graderHandlerDigest),
    merge: signer("merge"),
    evaluator: signer("evaluator"),
  };
  const source = createPmExplorationReadOnlyOutcomeSource({
    descriptor: {
      sourceId: "desktop.pm.read-only",
      revision: 1,
      handlerArtifactDigest: graderHandlerDigest,
      environmentDigest: boundPlan.environmentDigest,
    },
    readProjectState,
    readBoardExport,
  });
  const runner = createPmExplorationRunner({
    signer: signers.execution,
    run:
      run ??
      (async (request) => ({
        outputMemoryDigest: sha(`${request.roundId}-memory`),
        traceDigest: sha(`${request.roundId}-trace`),
      })),
  });
  const businessGrader = createPmExplorationBusinessGrader({
    signer: signers.grader,
    source,
    planDigest: boundPlan.planDigest,
    expectations,
  });
  const merger = createPmExplorationMerger({
    signer: signers.merge,
    merge: async (request) => ({
      outputMemoryDigest: sha(`${request.mergeId}-memory`),
      conflictResolutionDigest: sha(`${request.mergeId}-conflicts`),
    }),
  });
  const evaluator = createPmExplorationEvaluator({
    signer: signers.evaluator,
    evaluate: async (request) => ({
      decision: "accept",
      scoreBasisPoints: 10_000,
      evaluationDigest: sha(`${request.requestDigest}-evaluation`),
    }),
  });
  const manifest = createPmExplorationExecutionManifest({
    planDigest: boundPlan.planDigest,
    environmentDigest: boundPlan.environmentDigest,
    runner: inspectPmExplorationReceiptAuthority(signers.execution),
    grader: inspectPmExplorationReceiptAuthority(signers.grader),
    merger: inspectPmExplorationReceiptAuthority(signers.merge),
    evaluator: inspectPmExplorationReceiptAuthority(signers.evaluator),
    toolIds: [],
    toolPolicyDigest: sha("no-tools"),
  });
  return {
    host: createPmExplorationExecutionHost({
      plan: boundPlan,
      manifest,
      runner,
      grader: businessGrader,
      merger,
      evaluator,
      invokeTool: async () => {
        throw new Error("tools are disabled");
      },
      now: () => Date.parse("2026-09-18T00:00:00.000Z"),
    }),
    journal: createPmExplorationJournal(boundPlan),
    plan: boundPlan,
    source,
  };
}

async function execute(fixture) {
  return executePmExplorationRound(fixture.host, fixture.journal, {
    roundId: "round-one",
    stage: "broad",
    branchId: "workflow",
    taskId: "task-one",
    inputMemoryDigest: fixture.plan.initialMemoryDigest,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  while (TEMP_ROOTS.length > 0) {
    const root = TEMP_ROOTS.pop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("PM exploration business grader", () => {
  it("reads project state through a private source and signs an accepting grade", async () => {
    const queries = [];
    const signals = [];
    const fixture = setup({
      expectations: [
        {
          taskId: "task-one",
          expected: {
            kind: "project-state",
            id: "project-one",
            name: "Launch",
            status: "active",
          },
        },
      ],
      readProjectState: async (query, signal) => {
        queries.push(query);
        signals.push(signal);
        return {
          success: true,
          id: "project-one",
          name: "Launch",
          status: "active",
        };
      },
    });

    const result = await execute(fixture);

    expect(result.graderReceipt.payload).toMatchObject({
      decision: "accept",
      scoreBasisPoints: 10_000,
    });
    expect(result.checkpoint.accepted).toBe(true);
    expect(queries).toHaveLength(1);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0].aborted).toBe(false);
    expect(queries[0]).toEqual({
      schema: PM_EXPLORATION_OUTCOME_QUERY_SCHEMA,
      planDigest: fixture.plan.planDigest,
      environmentDigest: fixture.plan.environmentDigest,
      sourceDigest: inspectPmExplorationReadOnlyOutcomeSource(fixture.source)
        .sourceDigest,
      roundId: "round-one",
      taskId: "task-one",
      executionRequestDigest: expect.stringMatching(/^sha256:/u),
      executionReceiptDigest: result.executionReceipt.receiptDigest,
      outputMemoryDigest: sha("round-one-memory"),
      traceDigest: sha("round-one-trace"),
    });
    expect(JSON.stringify(queries[0])).not.toContain("Launch");
  });

  it("rejects an Actor-successful round when the independent database state differs", async () => {
    const fixture = setup({
      expectations: [
        {
          taskId: "task-one",
          expected: {
            kind: "project-state",
            id: "project-one",
            name: "Expected",
            status: "done",
          },
        },
      ],
      readProjectState: async () => ({
        success: true,
        id: "project-one",
        name: "Actor claimed success",
        status: "active",
      }),
    });

    const result = await execute(fixture);

    expect(result.executionReceipt.payload.status).toBe("succeeded");
    expect(result.graderReceipt.payload).toMatchObject({
      decision: "reject",
      scoreBasisPoints: 0,
    });
    expect(result.checkpoint.accepted).toBe(false);
  });

  it("checks board, task and sprint identities from the read-only source", async () => {
    const fixture = setup({
      expectations: [
        {
          taskId: "task-one",
          expected: {
            kind: "board-export",
            boardId: "board-one",
            taskIds: ["task-a", "task-b"],
            sprintIds: ["sprint-one"],
          },
        },
      ],
      readBoardExport: async () => ({
        success: true,
        board: { id: "board-one" },
        tasks: [{ id: "task-b" }, { id: "task-a" }],
        sprints: [{ id: "sprint-one" }],
      }),
    });

    await expect(execute(fixture)).resolves.toMatchObject({
      graderReceipt: { payload: { decision: "accept" } },
    });
  });

  it("captures a fresh export baseline before the Actor and reads the real bytes", async () => {
    const root = workspace();
    const relativePath = "exports/result.md";
    const bytes = Buffer.from("verified export\n");
    const fixture = setup({
      expectations: [
        {
          taskId: "task-one",
          expected: {
            kind: "file-export",
            relativePath,
            sha256: sha(bytes),
          },
          artifactRoot: root,
        },
      ],
      run: async (request) => {
        expect(fs.existsSync(path.join(root, relativePath))).toBe(false);
        fs.mkdirSync(path.join(root, "exports"));
        fs.writeFileSync(path.join(root, relativePath), bytes);
        return {
          outputMemoryDigest: sha(`${request.roundId}-memory`),
          traceDigest: sha(`${request.roundId}-trace`),
        };
      },
    });

    const result = await execute(fixture);

    expect(result.graderReceipt.payload.decision).toBe("accept");
  });

  it("rejects newly written export bytes that do not match the private digest", async () => {
    const root = workspace();
    const fixture = setup({
      expectations: [
        {
          taskId: "task-one",
          expected: {
            kind: "file-export",
            relativePath: "result.md",
            sha256: sha("expected"),
          },
          artifactRoot: root,
        },
      ],
      run: async (request) => {
        fs.writeFileSync(path.join(root, "result.md"), "wrong");
        return {
          outputMemoryDigest: sha(`${request.roundId}-memory`),
          traceDigest: sha(`${request.roundId}-trace`),
        };
      },
    });

    const result = await execute(fixture);

    expect(result.executionReceipt.payload.status).toBe("succeeded");
    expect(result.graderReceipt.payload.decision).toBe("reject");
  });

  it("fails closed before execution when the export target already exists", async () => {
    const root = workspace();
    fs.writeFileSync(path.join(root, "result.md"), "stale");
    const run = vi.fn(async (request) => ({
      outputMemoryDigest: sha(`${request.roundId}-memory`),
      traceDigest: sha(`${request.roundId}-trace`),
    }));
    const fixture = setup({
      expectations: [
        {
          taskId: "task-one",
          expected: {
            kind: "file-export",
            relativePath: "result.md",
            sha256: sha("stale"),
          },
          artifactRoot: root,
        },
      ],
      run,
    });

    const result = await execute(fixture);

    expect(result.executionReceipt.payload.status).toBe("failed");
    expect(result.graderReceipt.payload.decision).toBe("unsafe");
    expect(run).not.toHaveBeenCalled();
  });

  it("does not query business state after a failed execution", async () => {
    const readProjectState = vi.fn(async () => ({
      id: "project-one",
      name: "Launch",
      status: "active",
    }));
    const fixture = setup({
      expectations: [
        {
          taskId: "task-one",
          expected: {
            kind: "project-state",
            id: "project-one",
            name: "Launch",
            status: "active",
          },
        },
      ],
      readProjectState,
      run: async () => {
        throw new Error("actor failed");
      },
    });

    const result = await execute(fixture);

    expect(result.executionReceipt.payload.status).toBe("failed");
    expect(result.graderReceipt.payload.decision).toBe("unsafe");
    expect(readProjectState).not.toHaveBeenCalled();
  });

  it("rejects forged sources, duplicate tasks and accessor expectations", () => {
    const graderSigner = signer("grader", sha("signed-desktop-deployment"));
    expect(() =>
      createPmExplorationBusinessGrader({
        signer: graderSigner,
        source: Object.freeze({}),
        planDigest: sha("plan"),
        expectations: [],
      }),
    ).toThrow("branded");

    const source = createPmExplorationReadOnlyOutcomeSource({
      descriptor: {
        sourceId: "desktop.pm.read-only",
        revision: 1,
        handlerArtifactDigest: sha("signed-desktop-deployment"),
        environmentDigest: sha("environment"),
      },
      readProjectState: async () => ({}),
      readBoardExport: null,
    });
    const expected = {
      kind: "project-state",
      id: "project-one",
      name: "Launch",
      status: "active",
    };
    expect(() =>
      createPmExplorationBusinessGrader({
        signer: graderSigner,
        source,
        planDigest: sha("plan"),
        expectations: [
          { taskId: "task-one", expected },
          { taskId: "task-one", expected },
        ],
      }),
    ).toThrow("unique");

    const accessor = { taskId: "task-one" };
    Object.defineProperty(accessor, "expected", {
      enumerable: true,
      get: () => expected,
    });
    expect(() =>
      createPmExplorationBusinessGrader({
        signer: graderSigner,
        source,
        planDigest: sha("plan"),
        expectations: [accessor],
      }),
    ).toThrow("plain data");
  });

  it("exposes only an immutable source descriptor, never callbacks", () => {
    const fixture = setup({
      expectations: [
        {
          taskId: "task-one",
          expected: {
            kind: "project-state",
            id: "project-one",
            name: "Launch",
            status: "active",
          },
        },
      ],
      readProjectState: async () => ({}),
    });

    expect(fixture.source).toEqual({});
    expect(Object.isFrozen(fixture.source)).toBe(true);
    expect(inspectPmExplorationReadOnlyOutcomeSource(fixture.source)).toEqual({
      schema: PM_EXPLORATION_OUTCOME_SOURCE_SCHEMA,
      sourceId: "desktop.pm.read-only",
      revision: 1,
      handlerArtifactDigest: sha("signed-desktop-deployment"),
      environmentDigest: fixture.plan.environmentDigest,
      sourceDigest: expect.stringMatching(/^sha256:/u),
    });
  });
});
