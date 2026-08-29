"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const { IdeAppServerPilot } = require("../src/app-server-pilot.js");

class FakeClient extends EventEmitter {
  static options = null;

  constructor(options) {
    super();
    FakeClient.options = options;
    this.status = {
      running: false,
      initialized: false,
      pendingRequestCount: 0,
    };
  }

  async start() {
    this.status.running = true;
    this.status.initialized = true;
    return { protocolVersion: 1 };
  }

  async close() {
    this.status.running = false;
  }

  async threadStart(params) {
    return { thread: { id: params.threadId || "thread-1" } };
  }

  async threadList(params) {
    return { threads: [], params };
  }

  async turnStart(params) {
    return { turn: { id: "turn-1", threadId: params.threadId } };
  }

  async turnInterrupt(params) {
    return { interrupted: params.turnId };
  }

  async contextPlan(params) {
    return { schema: "chainlesschain.context-plan/v1", ...params };
  }

  async contextCompact(params) {
    return { status: "committed", ...params };
  }

  async memoryRecall(params) {
    return { results: [], ...params };
  }

  async memoryPropose(params) {
    return { operation: "propose", ...params };
  }

  async memoryDecide(params) {
    return { operation: "decide", ...params };
  }

  async memoryDelete(params) {
    return { status: "purged", ...params };
  }

  async memoryReconcile(params) {
    return { status: "purged", ...params };
  }
}

test("VS Code pilot uses the shared fixed-capability client lazily", async () => {
  const pilot = new IdeAppServerPilot({
    ClientClass: FakeClient,
    getCliPath: () => "C:/bin/cc.cmd",
    getCwd: () => "C:/workspace",
  });

  assert.equal(pilot.status.running, false);
  assert.deepEqual(await pilot.start(), { protocolVersion: 1 });
  assert.equal(FakeClient.options.cliPath, "C:/bin/cc.cmd");
  assert.equal(FakeClient.options.cwd, "C:/workspace");
  assert.equal(FakeClient.options.maxPendingRequests, 128);
  assert.equal("request" in pilot, false);

  assert.deepEqual(await pilot.threadStart({ title: "Pilot" }), {
    thread: { id: "thread-1" },
  });
  assert.deepEqual(
    await pilot.turnStart({ threadId: "thread-1", input: "hello" }),
    { turn: { id: "turn-1", threadId: "thread-1" } },
  );
  assert.equal(pilot.status.lastThreadId, "thread-1");
  assert.equal(pilot.status.lastTurnId, "turn-1");
  assert.equal((await pilot.contextPlan({ memoryRevision: 2 })).memoryRevision, 2);
  assert.equal((await pilot.contextCompact({ operationId: "compact-1" })).status, "committed");
  assert.deepEqual((await pilot.memoryRecall({ query: "fact" })).results, []);
  assert.equal((await pilot.memoryPropose({ content: "fact" })).operation, "propose");
  assert.equal((await pilot.memoryDecide({ memoryId: "memory-1" })).operation, "decide");
  assert.equal((await pilot.memoryDelete({ memoryId: "memory-1" })).status, "purged");
  assert.equal((await pilot.memoryReconcile({ operationId: "delete-1" })).status, "purged");
});

test("VS Code pilot forwards canonical events and contains host errors", () => {
  const client = new FakeClient({});
  const pilot = new IdeAppServerPilot({ client });
  let notification = null;
  pilot.on("notification", (value) => {
    notification = value;
  });

  client.emit("notification", { method: "turn/completed" });
  assert.deepEqual(notification, { method: "turn/completed" });
  assert.doesNotThrow(() => client.emit("error", new Error("broken pipe")));

  const digest = `sha256:${"a".repeat(64)}`;
  client.emit("notification", {
    method: "context/event",
    params: {
      type: "context.plan.created",
      plan: { memoryRevision: 4, digest },
    },
  });
  client.emit("notification", {
    method: "memory/event",
    params: {
      type: "memory.activated",
      memory_id: "memory-1",
      record: { memoryId: "memory-1", digest },
    },
  });
  assert.equal(pilot.status.contextMemory.memoryRevision, 4);
  assert.equal(pilot.status.contextMemory.memories[0].memoryId, "memory-1");
  client.emit("notification", {
    method: "memory/event",
    params: { type: "memory.purged", memory_id: "memory-1" },
  });
  assert.equal(pilot.status.contextMemory.memories.length, 0);
});
