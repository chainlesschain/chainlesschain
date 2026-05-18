/**
 * E2E test: real CodingAgentBridge against a real `chainlesschain serve`
 * subprocess. Validates the actual WebSocket protocol surface — session
 * create, list, close, shutdown — without involving Electron or any UI.
 *
 * Slow: spawns Node.js subprocess + Vitest forks pool. Marked with a generous
 * timeout to tolerate cold-start on Windows.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import path from "path";
import fs from "fs";

const repoRoot = path.resolve(__dirname, "../../..");
const cliEntry = path.join(
  repoRoot,
  "packages",
  "cli",
  "bin",
  "chainlesschain.js",
);

const cliExists = fs.existsSync(cliEntry);

const bridgeModule = require("../../src/main/ai-engine/code-agent/coding-agent-bridge.js");
const { CodingAgentBridge } = bridgeModule;

describe.skipIf(!cliExists)("CodingAgentBridge ↔ real CLI server (e2e)", () => {
  let bridge;

  beforeAll(() => {
    if (!cliExists) {
      console.warn("[e2e] Skipping — CLI bin not found at", cliEntry);
    }
  });

  afterEach(async () => {
    if (bridge) {
      try {
        await bridge.shutdown();
      } catch (_err) {
        // Ignore shutdown failures during cleanup.
      }
      bridge = null;
    }
  });

  it("starts CLI serve, creates a session, lists, then closes it", async () => {
    bridge = new CodingAgentBridge({
      cwd: repoRoot,
      projectRoot: repoRoot,
      cliEntry,
    });

    const ready = await bridge.ensureReady();
    expect(ready).toMatchObject({
      host: "127.0.0.1",
    });
    expect(typeof ready.port).toBe("number");
    expect(bridge.connected).toBe(true);

    // 1. createSession — provider/apiKey are optional, the CLI will
    //    create the session record even if no LLM credentials are set.
    const created = await bridge.createSession({
      provider: "openai",
      model: "gpt-4o-mini",
    });
    expect(created.type).toBe("session.started");
    expect(typeof created.sessionId).toBe("string");
    expect(created.sessionId.length).toBeGreaterThan(0);
    expect(created.record).toBeDefined();
    const sessionId = created.sessionId;

    // 2. listSessions returns a well-formed result. We don't assert on the
    //    presence of the just-created session because the CLI's session
    //    persistence depends on better-sqlite3 native bindings, which may
    //    not be installed in every CI environment. The protocol surface
    //    (type/array shape) is what we care about here.
    const list = await bridge.listSessions();
    expect(list.type).toBe("session.list");
    expect(Array.isArray(list.sessions)).toBe(true);

    // 3. closeSession returns a command.response message.
    const closed = await bridge.closeSession(sessionId);
    expect(closed.type).toBe("command.response");
    expect(closed.success).toBe(true);
  }, 120_000);

  it("round-trips a task graph (create → add → update → advance → state) against real CLI", async () => {
    bridge = new CodingAgentBridge({
      cwd: repoRoot,
      projectRoot: repoRoot,
      cliEntry,
    });

    await bridge.ensureReady();

    // Seed a session — the task graph lives on the session.
    const created = await bridge.createSession({
      provider: "openai",
      model: "gpt-4o-mini",
    });
    const sessionId = created.sessionId;
    expect(typeof sessionId).toBe("string");

    // 1. createTaskGraph with two nodes (b depends on a)
    const graphCreated = await bridge.createTaskGraph(sessionId, {
      title: "Desktop E2E Plan",
      nodes: [
        { id: "a", title: "First step" },
        { id: "b", title: "Second step", dependsOn: ["a"] },
      ],
    });
    expect(graphCreated.graph).toBeDefined();
    expect(graphCreated.graph.order).toEqual(["a", "b"]);
    expect(graphCreated.graph.nodes.a.status).toBe("pending");

    // 2. Add a third node depending on b
    const added = await bridge.addTaskNode(sessionId, {
      id: "c",
      title: "Third step",
      dependsOn: ["b"],
    });
    expect(added.graph.order).toEqual(["a", "b", "c"]);

    // 3. Mark a as completed → bridge unwraps task-graph.node.completed
    const updated = await bridge.updateTaskNode(sessionId, "a", {
      status: "completed",
    });
    expect(updated.graph.nodes.a.status).toBe("completed");

    // 4. Advance — b should become ready
    const advanced = await bridge.advanceTaskGraph(sessionId);
    expect(advanced.becameReady).toEqual(["b"]);
    expect(advanced.graph.nodes.b.status).toBe("ready");
    expect(advanced.graph.nodes.c.status).toBe("pending");

    // 5. State query reflects persisted graph
    const state = await bridge.getTaskGraph(sessionId);
    expect(state.graph.nodes.a.status).toBe("completed");
    expect(state.graph.nodes.b.status).toBe("ready");
  }, 120_000);

  it("rejects pending requests when bridge.shutdown() is called mid-flight", async () => {
    bridge = new CodingAgentBridge({
      cwd: repoRoot,
      projectRoot: repoRoot,
      cliEntry,
    });

    await bridge.ensureReady();

    // Start a long-running list and immediately shut down — pending must reject.
    const pending = bridge.request("session-list", {}, ["session-list-result"]);
    // Race shutdown against the request to make sure pending is canceled
    // even when the response would normally arrive.
    await bridge.shutdown();

    await expect(pending).rejects.toThrow();
    expect(bridge.connected).toBe(false);
  }, 120_000);
});
