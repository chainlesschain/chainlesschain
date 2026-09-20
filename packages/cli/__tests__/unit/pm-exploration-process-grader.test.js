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
  createPmExplorationRunner,
  executePmExplorationRound,
  inspectPmExplorationExecutionHost,
  inspectPmExplorationGraderIsolation,
  PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V3,
} from "../../src/lib/evolution/pm-exploration-execution-host.js";
import {
  EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA,
  EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA,
} from "../../src/lib/evolution/evolution-eval-gate.js";
import { createEvolutionEvalProcessSupervisor } from "../../src/lib/evolution/evolution-eval-process-supervisor.js";
import {
  createPmExplorationReceiptSigner,
  inspectPmExplorationReceiptAuthority,
} from "../../src/lib/evolution/pm-exploration-receipts.js";
import {
  createPmExplorationJournal,
  createPmExplorationPlan,
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

function plan(maxWallClockMs = 5_000) {
  return createPmExplorationPlan({
    planId: "isolated-grader-plan",
    suiteDigest: sha("suite"),
    trainingPartitionDigest: sha("training"),
    trainingTaskIds: ["task-one"],
    environmentDigest: sha("environment"),
    initialMemoryDigest: sha("initial-memory"),
    broadBranchIds: ["branch-one"],
    maxRounds: 1,
    maxTokens: 10,
    maxToolCalls: 1,
    maxWallClockMs,
    maxConsecutiveNoGain: 1,
  });
}

async function processFixture(
  source,
  { fsRead = [], hiddenSource = null, maxWallClockMs = 10_000 } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "cc-pm-process-grader-"));
  roots.push(root);
  const modulePath = join(root, "grader.mjs");
  await writeFile(modulePath, source);
  const hiddenPath = join(root, "hidden.json");
  if (hiddenSource !== null) await writeFile(hiddenPath, hiddenSource);
  const target = Object.freeze({
    schema: EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA,
    handlerId: "pm-private-grader",
    handlerRevision: "grader-v1",
    operation: "pm-exploration-grade",
    isolation: "process",
    handlerArtifactDigest: sha(source),
    authority: trust("target"),
  });
  const authorityDescriptor = {
    schema: EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA,
    handlerId: "pm-process-supervisor",
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
          exportName: "grade",
          sandboxPolicy: {
            fsRead: hiddenSource === null ? fsRead : [...fsRead, hiddenPath],
            memoryLimitMb: 64,
          },
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
    hiddenPath,
    maxWallClockMs,
    modulePath,
    root,
    spawnCalls,
    supervisor,
    target,
  };
}

function hostFixture({ boundPlan, processGrader, isolation }) {
  const runnerSigner = signer("execution");
  const graderSigner = signer("grader");
  const mergerSigner = signer("merge");
  const evaluatorSigner = signer("evaluator");
  const actorRequests = [];
  const runner = createPmExplorationRunner({
    signer: runnerSigner,
    run: async (request) => {
      actorRequests.push(structuredClone(request));
      return {
        outputMemoryDigest: sha("changed-memory"),
        traceDigest: sha("actor-trace"),
      };
    },
  });
  const grader = processGrader(graderSigner);
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
    grader: inspectPmExplorationReceiptAuthority(graderSigner),
    graderIsolation: isolation(grader),
    merger: inspectPmExplorationReceiptAuthority(mergerSigner),
    evaluator: inspectPmExplorationReceiptAuthority(evaluatorSigner),
    toolIds: [],
    toolPolicyDigest: sha("no-tools"),
    preRunSealDigest: sha("pre-run-seal"),
  });
  return {
    actorRequests,
    evaluator,
    grader,
    graderSigner,
    host: createPmExplorationExecutionHost({
      plan: boundPlan,
      manifest,
      runner,
      grader,
      merger,
      evaluator,
      invokeTool: async () => {
        throw new Error("tools are forbidden");
      },
      now: () => Date.parse("2026-09-19T00:00:00.000Z"),
    }),
    manifest,
    merger,
    runner,
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

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("PM exploration process grader", () => {
  it(
    "keeps hidden grading data in a restricted child process and binds its supervision",
    { timeout: 240_000 },
    async () => {
      const privateExpected = "private-answer-never-shared-with-actor";
      const hiddenSource = JSON.stringify({
        taskId: "task-one",
        expected: privateExpected,
      });
      const source = `
      import { createHash } from "node:crypto";
      import { readFile } from "node:fs/promises";
      import { join } from "node:path";
      const sha = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");
      export async function grade(request) {
        const hidden = JSON.parse(await readFile(join(process.cwd(), "hidden.json"), "utf8"));
        let denied = false;
        try { await readFile(join(process.cwd(), "forbidden.json"), "utf8"); }
        catch { denied = true; }
        if (!denied) throw new Error("sandbox failed");
        return {
          decision: request.taskId === hidden.taskId ? "accept" : "reject",
          scoreBasisPoints: request.taskId === hidden.taskId ? 10000 : 0,
          resultDigest: sha(hidden.expected + ":" + process.pid),
        };
      }
    `;
      const fixture = await processFixture(source, {
        hiddenSource,
        maxWallClockMs: 120_000,
      });
      const boundPlan = plan(180_000);
      const configured = hostFixture({
        boundPlan,
        processGrader: (graderSigner) =>
          createPmExplorationProcessGrader({
            signer: graderSigner,
            supervisor: fixture.supervisor,
            target: fixture.target,
            maxWallClockMs: fixture.maxWallClockMs,
          }),
        isolation: inspectPmExplorationGraderIsolation,
      });
      const result = await execute(configured.host, boundPlan);

      expect(configured.manifest.schema).toBe(
        PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V3,
      );
      expect(inspectPmExplorationExecutionHost(configured.host)).toMatchObject({
        graderIsolation: {
          mode: "process",
          targetDigest: expect.stringMatching(/^sha256:/u),
        },
      });
      expect(result.graderReceipt.payload.decision).toBe("accept");
      expect(result.graderReceipt.payload.scoreBasisPoints).toBe(10_000);
      expect(result.graderReceipt.payload.resultDigest).toMatch(/^sha256:/u);
      expect(fixture.children).toHaveLength(1);
      expect(fixture.children[0].pid).not.toBe(process.pid);
      expect(fixture.spawnCalls[0][2].env).toEqual({});
      expect(JSON.stringify(configured.actorRequests)).not.toContain(
        privateExpected,
      );
      expect(JSON.stringify(configured.actorRequests)).not.toContain(
        fixture.hiddenPath,
      );
    },
  );

  it("rejects a process manifest paired with an in-process grader", async () => {
    const source = `export async function grade() { return { decision: "reject", scoreBasisPoints: 0, resultDigest: "${sha("grade")}" }; }`;
    const fixture = await processFixture(source);
    const boundPlan = plan();
    const configured = hostFixture({
      boundPlan,
      processGrader: (graderSigner) =>
        createPmExplorationProcessGrader({
          signer: graderSigner,
          supervisor: fixture.supervisor,
          target: fixture.target,
          maxWallClockMs: fixture.maxWallClockMs,
        }),
      isolation: inspectPmExplorationGraderIsolation,
    });
    const direct = createPmExplorationGrader({
      signer: configured.graderSigner,
      grade: async () => ({
        decision: "reject",
        scoreBasisPoints: 0,
        resultDigest: sha("direct"),
      }),
    });
    expect(inspectPmExplorationGraderIsolation(direct)).toBeNull();
    expect(() =>
      createPmExplorationExecutionHost({
        plan: boundPlan,
        manifest: configured.manifest,
        runner: configured.runner,
        grader: direct,
        merger: configured.merger,
        evaluator: configured.evaluator,
        invokeTool: async () => null,
        now: Date.now,
      }),
    ).toThrow("grader isolation differs from the manifest");
  });

  it("fails closed when target bytes change after supervisor capture", async () => {
    const source = `export async function grade() { return { decision: "accept", scoreBasisPoints: 10000, resultDigest: "${sha("grade")}" }; }`;
    const fixture = await processFixture(source);
    const boundPlan = plan();
    const configured = hostFixture({
      boundPlan,
      processGrader: (graderSigner) =>
        createPmExplorationProcessGrader({
          signer: graderSigner,
          supervisor: fixture.supervisor,
          target: fixture.target,
          maxWallClockMs: fixture.maxWallClockMs,
        }),
      isolation: inspectPmExplorationGraderIsolation,
    });
    await writeFile(
      fixture.modulePath,
      source.replace('decision: "accept"', 'decision: "reject"'),
    );
    const result = await execute(configured.host, boundPlan);
    expect(result.graderReceipt.payload).toMatchObject({
      decision: "unsafe",
      scoreBasisPoints: 0,
    });
    expect(fixture.children).toHaveLength(0);
  });

  it("hard-terminates a grader that exceeds its declared deadline", async () => {
    const source = `export async function grade() { await new Promise(() => {}); }`;
    const fixture = await processFixture(source, { maxWallClockMs: 150 });
    const boundPlan = plan(5_000);
    const configured = hostFixture({
      boundPlan,
      processGrader: (graderSigner) =>
        createPmExplorationProcessGrader({
          signer: graderSigner,
          supervisor: fixture.supervisor,
          target: fixture.target,
          maxWallClockMs: fixture.maxWallClockMs,
        }),
      isolation: inspectPmExplorationGraderIsolation,
    });
    const result = await execute(configured.host, boundPlan);
    expect(result.graderReceipt.payload.decision).toBe("unsafe");
    expect(fixture.children).toHaveLength(1);
    if (
      fixture.children[0].exitCode === null &&
      fixture.children[0].signalCode === null
    ) {
      await new Promise((resolve) =>
        fixture.children[0].once("close", resolve),
      );
    }
    expect(
      fixture.children[0].exitCode !== null ||
        fixture.children[0].signalCode !== null,
    ).toBe(true);
  });

  it("hard-terminates the child when the enclosing PM budget expires first", async () => {
    const source = `export async function grade() { await new Promise(() => {}); }`;
    const fixture = await processFixture(source, { maxWallClockMs: 2_000 });
    const boundPlan = plan(200);
    const configured = hostFixture({
      boundPlan,
      processGrader: (graderSigner) =>
        createPmExplorationProcessGrader({
          signer: graderSigner,
          supervisor: fixture.supervisor,
          target: fixture.target,
          maxWallClockMs: fixture.maxWallClockMs,
        }),
      isolation: inspectPmExplorationGraderIsolation,
    });
    const result = await execute(configured.host, boundPlan);
    expect(result.graderReceipt.payload.decision).toBe("unsafe");
    expect(fixture.children).toHaveLength(1);
    if (
      fixture.children[0].exitCode === null &&
      fixture.children[0].signalCode === null
    ) {
      await new Promise((resolve) =>
        fixture.children[0].once("close", resolve),
      );
    }
    expect(
      fixture.children[0].exitCode !== null ||
        fixture.children[0].signalCode !== null,
    ).toBe(true);
  });
});
