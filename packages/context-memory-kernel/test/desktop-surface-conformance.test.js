const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  DesktopAppServerPilot,
} = require("../../../desktop-app-vue/src/main/ai-engine/code-agent/app-server-pilot.js");
const {
  APP_SERVER_PILOT_IPC_CHANNELS,
  registerCodingAgentIPCV3,
} = require("../../../desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-ipc-v3.js");
const {
  applyDesktopContextMemoryProductionDefault,
  assertDesktopLegacyMutationAllowed,
} = require("../../../desktop-app-vue/src/main/context-memory/authority.js");
const {
  IdeAppServerPilot,
} = require("../../vscode-extension/src/app-server-pilot.js");

const FIXED_METHODS = Object.freeze([
  "contextPlan",
  "contextCompact",
  "memoryRecall",
  "memoryPropose",
  "memoryDecide",
  "memoryDelete",
  "memoryReconcile",
]);

class FakePilotClient extends EventEmitter {
  constructor() {
    super();
    this.status = { running: true, initialized: true };
    for (const method of FIXED_METHODS) {
      this[method] = async (params) => ({ method, params });
    }
  }

  async start() {
    return { protocolVersion: 1 };
  }

  async close() {}
}

function crossSurfaceFixture() {
  const rows = readFileSync(
    path.resolve(
      __dirname,
      "..",
      "fixtures",
      "cross-surface-projection-v1.tsv",
    ),
    "utf8",
  )
    .trim()
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => {
      const [
        method,
        type,
        memoryId,
        memoryRevision,
        recordMemoryId,
        expectedMemoryCount,
      ] = line.split("\t");
      return {
        method,
        type,
        memoryId: memoryId === "-" ? "" : memoryId,
        memoryRevision: memoryRevision !== "-" ? Number(memoryRevision) : null,
        recordMemoryId: recordMemoryId === "-" ? "" : recordMemoryId,
        expectedMemoryCount: expectedMemoryCount !== "-"
          ? Number(expectedMemoryCount)
          : null,
      };
    });
  const expected = rows.find((row) => row.method === "expected");
  const notifications = rows
    .filter((row) => row.method !== "expected")
    .map((row) => {
      const params = { type: row.type };
      if (row.memoryId) params.memory_id = row.memoryId;
      if (row.recordMemoryId) {
        params.record = { memoryId: row.recordMemoryId };
      }
      if (row.type === "context.plan.created") {
        params.plan = { memoryRevision: row.memoryRevision };
      }
      if (row.type === "memory.recalled") {
        params.result = { memoryRevision: row.memoryRevision };
      }
      return { method: row.method, params };
    });
  return { notifications, expected };
}

test("Desktop exposes only fixed Context/Memory capabilities and bounded projection", async () => {
  const pilot = new DesktopAppServerPilot({ client: new FakePilotClient() });
  for (const method of FIXED_METHODS) {
    const result = await pilot[method]({ marker: method });
    assert.deepEqual(result, { method, params: { marker: method } });
  }
  assert.equal("request" in pilot, false);

  pilot.client.emit("notification", {
    method: "context/event",
    params: {
      type: "context.plan.created",
      plan: { planId: "plan-1", memoryRevision: 3 },
    },
  });
  for (let index = 0; index < 300; index += 1) {
    pilot.client.emit("notification", {
      method: "memory/event",
      params: {
        type: "memory.activated",
        memory_id: `memory-${index}`,
        record: { memoryId: `memory-${index}`, revision: 1 },
      },
    });
  }
  assert.equal(pilot.status.contextMemory.memoryRevision, 3);
  assert.equal(pilot.status.contextMemory.memories.length, 256);
  pilot.client.emit("notification", {
    method: "memory/event",
    params: { type: "memory.purged", memory_id: "memory-299" },
  });
  assert.equal(pilot.status.contextMemory.memories.length, 255);
});

test("Desktop fixed IPC routes Context/Memory without a generic RPC escape hatch", async () => {
  const handlers = new Map();
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => handlers.delete(channel),
  };
  const pilot = new EventEmitter();
  pilot.status = { enabled: true, running: true, initialized: true };
  for (const method of FIXED_METHODS) {
    pilot[method] = async (params) => ({ method, params });
  }
  pilot.start = async () => ({});
  pilot.close = async () => {};
  pilot.listPendingHumanTasks = () => [];
  pilot.respondHumanTask = () => ({ accepted: true });
  const service = {
    repoRoot: process.cwd(),
    bridge: {},
    mainWindow: null,
  };
  const dispose = registerCodingAgentIPCV3({
    service,
    ipcMain,
    appServerPilot: pilot,
    artifactClient: {},
  });
  assert.equal(
    APP_SERVER_PILOT_IPC_CHANNELS.includes(
      "coding-agent:app-server-context-plan",
    ),
    true,
  );
  assert.equal(
    APP_SERVER_PILOT_IPC_CHANNELS.includes(
      "coding-agent:app-server-request",
    ),
    false,
  );
  const result = await handlers.get("coding-agent:app-server-memory-recall")(
    {},
    { query: "release" },
  );
  assert.deepEqual(result, {
    success: true,
    result: { method: "memoryRecall", params: { query: "release" } },
  });
  dispose();
});

test("Desktop legacy writers fail closed after canonical cutover", () => {
  const productionEnv = {};
  assert.equal(
    applyDesktopContextMemoryProductionDefault(productionEnv).canonical,
    true,
  );
  assert.equal(
    productionEnv.CHAINLESSCHAIN_CONTEXT_MEMORY_DESKTOP_STAGE,
    "canonical_default",
  );
  assert.throws(
    () =>
      assertDesktopLegacyMutationAllowed({
        env: {
          CHAINLESSCHAIN_CONTEXT_MEMORY_DESKTOP_STAGE: "canonical_default",
        },
        scopeKey: "desktop:test",
        replacement: "coding-agent:app-server-memory-propose",
      }),
    (error) =>
      error.code === "CONTEXT_MEMORY_LEGACY_WRITER_FENCED" &&
      error.replacement === "coding-agent:app-server-memory-propose",
  );
});

test("Desktop and VS Code consume the same canonical projection fixture", () => {
  const client = new FakePilotClient();
  const desktop = new DesktopAppServerPilot({ client });
  const vscode = new IdeAppServerPilot({ client });
  const { notifications, expected } = crossSurfaceFixture();
  for (const notification of notifications) {
    client.emit("notification", notification);
  }
  assert.deepEqual(desktop.status.contextMemory, vscode.status.contextMemory);
  assert.equal(
    desktop.status.contextMemory.memoryRevision,
    expected.memoryRevision,
  );
  assert.equal(
    desktop.status.contextMemory.memories.length,
    expected.expectedMemoryCount,
  );
});
