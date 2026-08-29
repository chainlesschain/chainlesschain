import { EventEmitter } from "events";
import { readFileSync } from "fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MemoryRolloutStore } from "../../../../../../packages/cli/src/lib/app-server/rollout-store.js";
import { AppServerGraphRuntime } from "../../../../../../packages/cli/src/lib/app-server/graph-runtime.js";

const {
  DesktopAppServerPilot,
  MAX_PARAMS_BYTES,
  normalizeParams,
} = require("../app-server-pilot.js");

class FakePilotClient extends EventEmitter {
  static options = null;

  constructor(options) {
    super();
    FakePilotClient.options = options;
    this.status = {
      running: false,
      initialized: false,
      pendingRequestCount: 0,
      capabilities: null,
      lastError: null,
    };
    for (const method of [
      "threadStart",
      "threadResume",
      "threadFork",
      "threadRead",
      "threadList",
      "threadArchive",
      "turnStart",
      "turnInterrupt",
      "graphCompile",
      "graphRun",
      "graphStatus",
      "graphHistory",
      "graphCancel",
      "graphReconcile",
    ]) {
      this[method] = vi.fn(async (params) => ({ method, params }));
    }
    this.start = vi.fn(async () => ({ protocolVersion: 1 }));
    this.close = vi.fn(async () => undefined);
  }
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe("DesktopAppServerPilot", () => {
  it("consumes the shared quorum and separation-of-duties product scenarios", async () => {
    const fixture = JSON.parse(
      readFileSync(
        path.resolve(
          __dirname,
          "../../../../../../packages/agent-protocol/test/fixtures/human-task-settlement-conformance.json",
        ),
        "utf8",
      ),
    );

    for (const scenario of fixture.scenarios.filter(({ surfaces }) =>
      surfaces.includes("desktop_app_server"),
    )) {
      let currentActor = null;
      let currentTime = 1_700_000_000_000;
      let requestedTask = null;
      let lastTask = null;
      let runSettled = false;
      const pilot = new DesktopAppServerPilot({
        ClientClass: FakePilotClient,
        resolveActorDid: () => currentActor,
      });
      pilot.on("human-task-requested", (task) => {
        requestedTask = task;
        lastTask = task;
      });
      const runtime = new AppServerGraphRuntime({
        rolloutStore: new MemoryRolloutStore({ now: () => currentTime }),
        now: () => currentTime,
        executeNode: async () => {
          throw new Error("HumanTask must not enter the Agent executor");
        },
        requestHumanTask: ({ task }) =>
          FakePilotClient.options.onServerRequest({
            jsonrpc: "2.0",
            id: `server:${scenario.name}`,
            method: "humanTask/decide",
            params: { task },
          }),
      });
      const runPromise = runtime.run({
        definition: {
          schemaVersion: 1,
          id: `desktop-${scenario.name}`,
          revision: 1,
          nodes: [
            {
              id: "review",
              kind: "human",
              dependsOn: [],
              inputs: [],
              outputs: [],
              effectClass: "none",
              join: "quorum",
              quorum: scenario.quorum,
            },
          ],
          edges: [],
          loops: [],
          subgraphCalls: [],
          budget: { turns: 1 },
          allowedCapabilities: [],
        },
        runId: `desktop-${scenario.name}-run`,
        inputs: { review: { prompt: `Review ${scenario.name}` } },
        waitForCompletion: true,
      });
      void runPromise.finally(() => {
        runSettled = true;
      });

      for (const step of scenario.steps) {
        if (step.action === "advance") {
          currentTime += step.milliseconds;
          continue;
        }
        await waitFor(() => requestedTask !== null || runSettled);
        currentActor = step.actor_id;
        const task = requestedTask || lastTask;
        const settle = () =>
          pilot.respondHumanTask({
            humanTaskId: task.id,
            runId: task.runId,
            revisionDigest: task.revisionDigest,
            operationDigest: task.operationDigest,
            nonce: task.nonce,
            decision:
              step.action === "approve"
                ? { kind: "acceptOnce" }
                : { kind: "decline", reason: "fixture-declined" },
          });
        if (step.expect.desktop_app_server === "rejected") {
          expect(settle, scenario.name).toThrow();
        } else {
          expect(settle(), scenario.name).toMatchObject({ accepted: true });
          requestedTask = null;
        }
      }

      const projection = await runPromise;
      const expected = scenario.expected.desktop_app_server;
      const task = runtime.humanTasks(projection.id)[0];
      expect(task.status, scenario.name).toBe(expected.task_status);
      expect(task.decisions, scenario.name).toHaveLength(
        expected.decision_count,
      );
      expect(task.decision?.kind || null, scenario.name).toBe(
        expected.decision_kind,
      );
      expect(projection.status, scenario.name).toBe(expected.run_status);
      expect(projection.completedAt, scenario.name).toEqual(expect.any(String));
      expect(projection.nodes[0].status, scenario.name).toBe(
        expected.node_status,
      );
      await pilot.close();
    }
  });

  it("settles a HumanTask only with the authenticated Desktop actor and exact binding", async () => {
    const pilot = new DesktopAppServerPilot({
      ClientClass: FakePilotClient,
      resolveActorDid: vi.fn(() => "did:chainless:reviewer-2"),
    });
    const task = {
      id: "human-task-1",
      runId: "run-1",
      nodeId: "review",
      revisionDigest: `sha256:${"a".repeat(64)}`,
      operationDigest: `sha256:${"b".repeat(64)}`,
      operation: { prompt: "Publish the exact release candidate" },
      authorityDigest: `sha256:${"c".repeat(64)}`,
      status: "open",
      nonce: "nonce-1",
      quorum: 2,
      separationOfDuties: true,
      decisions: [
        {
          actorId: "did:chainless:reviewer-1",
          decision: { kind: "acceptOnce" },
          decidedAt: "2026-08-29T00:00:00.000Z",
        },
      ],
      claimActorId: null,
      claimLeaseId: null,
      claimExpiresAt: null,
      expiresAt: "2026-08-30T00:00:00.000Z",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
      decision: null,
    };
    const requested = vi.fn();
    pilot.on("human-task-requested", requested);
    const decisionPromise = FakePilotClient.options.onServerRequest({
      jsonrpc: "2.0",
      id: "server:1",
      method: "humanTask/decide",
      params: { task },
    });
    expect(requested).toHaveBeenCalledWith(task);
    expect(() =>
      pilot.respondHumanTask({
        humanTaskId: task.id,
        runId: task.runId,
        revisionDigest: task.revisionDigest,
        operationDigest: `sha256:${"d".repeat(64)}`,
        nonce: task.nonce,
        decision: { kind: "acceptOnce" },
      }),
    ).toThrow(/stale operationDigest/u);
    expect(() =>
      pilot.respondHumanTask({
        humanTaskId: task.id,
        runId: task.runId,
        revisionDigest: task.revisionDigest,
        operationDigest: task.operationDigest,
        nonce: task.nonce,
        decision: { kind: "acceptOnce", unexpected: true },
      }),
    ).toThrow(/decision fields are invalid/u);

    expect(
      pilot.respondHumanTask({
        humanTaskId: task.id,
        runId: task.runId,
        revisionDigest: task.revisionDigest,
        operationDigest: task.operationDigest,
        nonce: task.nonce,
        actorId: "did:chainless:spoofed-renderer",
        decision: { kind: "acceptOnce" },
      }),
    ).toEqual({
      accepted: true,
      humanTaskId: task.id,
      actorId: "did:chainless:reviewer-2",
    });
    await expect(decisionPromise).resolves.toEqual({
      humanTaskId: task.id,
      runId: task.runId,
      revisionDigest: task.revisionDigest,
      operationDigest: task.operationDigest,
      nonce: task.nonce,
      actorId: "did:chainless:reviewer-2",
      decision: { kind: "acceptOnce" },
    });
  });

  it("rejects a repeated actor before satisfying separation of duties", async () => {
    const pilot = new DesktopAppServerPilot({
      ClientClass: FakePilotClient,
      resolveActorDid: () => "did:chainless:reviewer-1",
    });
    const task = {
      id: "human-task-sod",
      runId: "run-sod",
      nodeId: "review",
      revisionDigest: `sha256:${"a".repeat(64)}`,
      operationDigest: `sha256:${"b".repeat(64)}`,
      operation: {},
      status: "open",
      nonce: "nonce-sod",
      quorum: 2,
      separationOfDuties: true,
      decisions: [
        {
          actorId: "did:chainless:reviewer-1",
          decision: { kind: "acceptOnce" },
        },
      ],
    };
    const decisionPromise = FakePilotClient.options.onServerRequest({
      method: "humanTask/decide",
      params: { task },
    });
    expect(() =>
      pilot.respondHumanTask({
        humanTaskId: task.id,
        runId: task.runId,
        revisionDigest: task.revisionDigest,
        operationDigest: task.operationDigest,
        nonce: task.nonce,
        decision: { kind: "acceptOnce" },
      }),
    ).toThrow(/different authenticated reviewer/u);
    pilot.close();
    await expect(decisionPromise).rejects.toThrow(/host closed/u);
  });

  it("uses the shared fixed-capability client through the Desktop process broker", async () => {
    const child = {};
    const spawnProcess = vi.fn(() => child);
    const pilot = new DesktopAppServerPilot({
      ClientClass: FakePilotClient,
      cliPath: "C:/repo/packages/cli/bin/chainlesschain.js",
      cwd: "C:/repo",
      spawnProcess,
    });

    expect(
      await pilot.turnStart({ threadId: "thread-1", input: "hello" }),
    ).toEqual({
      method: "turnStart",
      params: { threadId: "thread-1", input: "hello" },
    });
    expect("request" in pilot).toBe(false);
    expect(
      await pilot.graphRun({ runId: "graph-1", definition: { id: "d" } }),
    ).toEqual({
      method: "graphRun",
      params: { runId: "graph-1", definition: { id: "d" } },
    });
    expect(pilot.status).toMatchObject({ enabled: true, surface: "desktop" });
    await expect(
      pilot.graphHistory({ runId: "graph-1", snapshotLimit: 20 }),
    ).resolves.toEqual({
      method: "graphHistory",
      params: { runId: "graph-1", snapshotLimit: 20 },
    });

    expect(
      FakePilotClient.options.spawn("node", ["cli.js"], {
        cwd: "C:/repo",
        stdio: ["pipe", "pipe", "pipe"],
      }),
    ).toBe(child);
    expect(spawnProcess).toHaveBeenCalledWith(
      "node",
      ["cli.js"],
      expect.objectContaining({
        cwd: "C:/repo",
        shell: false,
        origin: "desktop:coding-agent-app-server-pilot",
        provenance: { component: "coding-agent-app-server-pilot" },
      }),
    );
  });

  it("bounds and clones renderer parameters before they reach the client", () => {
    const source = { threadId: "thread-1", metadata: { safe: true } };
    const normalized = normalizeParams(source);
    expect(normalized).toEqual(source);
    expect(normalized).not.toBe(source);

    expect(() => normalizeParams([])).toThrow(/must be an object/u);
    expect(() => normalizeParams(new Date())).toThrow(/must be an object/u);
    expect(() =>
      normalizeParams({ input: "x".repeat(MAX_PARAMS_BYTES + 1) }),
    ).toThrow(/exceed 256 KiB/u);
  });

  it("forwards lifecycle events without unhandled host errors", () => {
    const pilot = new DesktopAppServerPilot({ ClientClass: FakePilotClient });
    const notification = vi.fn();
    pilot.on("notification", notification);
    pilot.client.emit("notification", { method: "turn/completed" });
    expect(notification).toHaveBeenCalledWith({ method: "turn/completed" });
    expect(() =>
      pilot.client.emit("error", new Error("broken pipe")),
    ).not.toThrow();
  });
});
