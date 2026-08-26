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
});
