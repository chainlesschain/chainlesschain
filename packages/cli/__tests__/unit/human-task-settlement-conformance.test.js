import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateProtocolDefinition } from "../../../agent-protocol/src/index.mjs";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import { createGraphAuthorityBinding } from "../../src/lib/graph-kernel/authority.js";
import { compileGraphDefinition } from "../../src/lib/graph-kernel/compiler.js";
import { GraphEventStore } from "../../src/lib/graph-kernel/event-store.js";
import { GraphKernel } from "../../src/lib/graph-kernel/runtime.js";

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../agent-protocol/test/fixtures/human-task-settlement-conformance.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function expectCanonicalHumanTask(task) {
  expect(task).not.toHaveProperty("claimExpiresAtMs");
  expect(task).not.toHaveProperty("expiresAtMs");
  expect(validateProtocolDefinition("HumanTask", task)).toEqual({
    ok: true,
    errors: [],
  });
}

function compiledGraph(id) {
  return compileGraphDefinition({
    schemaVersion: 1,
    id: `human-task-${id}`,
    revision: 1,
    nodes: [
      {
        id: "approval",
        kind: "human",
        dependsOn: [],
        inputs: [],
        outputs: [],
        effectClass: "none",
      },
    ],
    edges: [],
    loops: [],
    subgraphCalls: [],
    budget: { turns: 10, tokens: 1_000 },
  });
}

function createHarness(scenario) {
  let currentTime = 1_700_000_000_000;
  let authorityGeneration = 1;
  let kernel;
  const now = () => currentTime;
  const eventStore = new GraphEventStore({
    rolloutStore: new MemoryRolloutStore({ now }),
  });
  const runId = `run-${scenario.name}`;
  const taskId = `task-${scenario.name}`;

  const createKernel = (generation) =>
    new GraphKernel({
      eventStore,
      now,
      createId: () => `generated-${scenario.name}`,
      writerId: `human-task-writer-${generation}`,
      writerLeaseId: `human-task-writer-lease-${generation}`,
      authorityGeneration: generation,
    });

  kernel = createKernel(authorityGeneration);
  kernel.startRun(compiledGraph(scenario.name), { runId });
  kernel.sealRun(runId);
  kernel.registerAgent(runId, { agentId: "agent-1", capacity: 1 });
  const attempt = kernel.assignNode(runId, "approval", "agent-1", {
    attemptId: `attempt-${scenario.name}`,
    leaseId: `attempt-lease-${scenario.name}`,
    ttlMs: 60_000,
  });
  const binding = kernel.createHumanTask(runId, {
    humanTaskId: taskId,
    attemptId: attempt.id,
    leaseId: attempt.leaseId,
    fence: attempt.fence,
    operation: {
      tool: "run_shell",
      args: { command: "npm test" },
    },
    nonce: `nonce-${scenario.name}`,
    quorum: scenario.quorum,
    separationOfDuties: scenario.separation_of_duties,
  });
  expectCanonicalHumanTask(binding);

  const restart = () => {
    const events = eventStore.read(runId);
    const latest = events.at(-1);
    const previous = [...events]
      .reverse()
      .find((event) => event.payload?.state?.authority).payload.state.authority;
    authorityGeneration += 1;
    kernel = createKernel(authorityGeneration);
    kernel.recoverRun(runId, {
      authority: createGraphAuthorityBinding({
        ...previous,
        authorityGeneration,
        writerId: `human-task-writer-${authorityGeneration}`,
        writerLeaseId: `human-task-writer-lease-${authorityGeneration}`,
        writerLeaseExpiresAt: new Date(now() + 60_000).toISOString(),
        eventHead: latest.hash,
      }),
    });
  };

  const execute = (step, index) => {
    if (step.action === "restart") {
      restart();
      return;
    }
    if (step.action === "advance") {
      currentTime += step.milliseconds;
      return;
    }
    if (step.action === "cancel") {
      expectCanonicalHumanTask(
        kernel.cancelHumanTask(runId, taskId, "fixture-cancelled"),
      );
      return;
    }

    const claim = kernel.claimHumanTask(runId, taskId, step.actor_id, {
      claimLeaseId: `claim-${index}-${step.actor_id}`,
      ttlMs: 10,
    });
    expectCanonicalHumanTask(claim);
    expectCanonicalHumanTask(
      kernel.decideHumanTask(runId, taskId, {
        actorId: step.actor_id,
        claimLeaseId: claim.claimLeaseId,
        revisionDigest: binding.revisionDigest,
        operationDigest: binding.operationDigest,
        nonce: binding.nonce,
        decision:
          step.action === "approve"
            ? { kind: "acceptOnce" }
            : { kind: "decline", reason: "fixture-declined" },
      }),
    );
  };

  return {
    execute,
    state() {
      return {
        run: kernel.getRun(runId),
        tasks: kernel.humanTasks(runId),
      };
    },
  };
}

describe("shared HumanTask settlement conformance", () => {
  for (const scenario of fixture.scenarios.filter(({ surfaces }) =>
    surfaces.includes("graph"),
  )) {
    it(scenario.name, () => {
      const harness = createHarness(scenario);
      for (const [index, step] of scenario.steps.entries()) {
        const expected = step.expect.graph;
        if (expected === "rejected") {
          expect(
            () => harness.execute(step, index),
            `${scenario.name}:${step.action}`,
          ).toThrowError(
            expect.objectContaining({ code: expect.stringMatching(/^CC_/) }),
          );
        } else {
          expect(
            () => harness.execute(step, index),
            `${scenario.name}:${step.action}`,
          ).not.toThrow();
        }
      }

      const { run, tasks } = harness.state();
      expect(tasks).toHaveLength(1);
      const task = tasks[0];
      expectCanonicalHumanTask(task);
      expect(task).toMatchObject({
        status: scenario.expected.graph.task_status,
        decisions: expect.any(Array),
      });
      expect(task.decisions).toHaveLength(
        scenario.expected.graph.decision_count,
      );
      expect(task.decision?.kind || null).toBe(
        scenario.expected.graph.decision_kind,
      );
      expect(run.status).toBe(scenario.expected.graph.run_status);
      expect(run.nodes).toMatchObject([
        { nodeId: "approval", status: scenario.expected.graph.node_status },
      ]);
    });
  }
});
