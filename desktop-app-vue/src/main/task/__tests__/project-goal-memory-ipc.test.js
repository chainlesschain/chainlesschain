import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  ContextMemoryKernel,
} = require("@chainlesschain/context-memory-kernel");
const {
  createProjectGoalHost,
  registerProjectGoalIPC,
  CHANNELS,
} = require("../project-goal-ipc.js");
const owner = "did:chainless:owner";

describe("trusted native goal memory IPC and output boundaries", () => {
  let db, activeDb, actor, generation, window, event, electron, host, goal;
  beforeEach(() => {
    db = new Database(":memory:");
    activeDb = db;
    actor = owner;
    generation = 1;
    db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      INSERT INTO projects VALUES ('p1','${owner}','active',10,0);`);
    window = { isDestroyed: vi.fn(() => false) };
    event = {
      sender: {},
      senderFrame: { url: "http://localhost:5173", parent: null },
    };
    electron = {
      BrowserWindow: { fromWebContents: vi.fn(() => window) },
      ipcMain: { handle: vi.fn() },
    };
    host = createProjectGoalHost({
      database: { getDatabase: () => activeDb },
      getCurrentUserDid: () => actor,
      getAuthenticationGeneration: () => generation,
      electron,
      clock: () => 1791321600000,
      monitoringController: { initialize: vi.fn(), close: vi.fn() },
    });
    goal = host.create(event, {
      projectId: "p1",
      objective: "Follow delivery",
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (activeDb && activeDb !== db && activeDb.open) activeDb.close();
    if (db?.open) db.close();
  });
  const input = (requestId = "memory-1") => ({
    goalId: goal.id,
    expectedRevision: goal.revision,
    requestId,
    content: "Explicit owner fact",
    category: "user-fact",
  });
  const listing = () => host.memoryList(event, { goalId: goal.id });
  async function add() {
    const result = await host.memoryCreate(event, input());
    goal = result.goal;
    return result;
  }
  function target(item, requestId) {
    return {
      goalId: goal.id,
      expectedRevision: goal.revision,
      requestId,
      memoryId: item.memoryId,
      memoryVersion: item.currentVersion,
    };
  }
  function afterProposal(callback) {
    const propose = ContextMemoryKernel.prototype.proposeMemory;
    vi.spyOn(ContextMemoryKernel.prototype, "proposeMemory").mockImplementation(
      async function (request) {
        const result = await propose.call(this, request);
        callback();
        return result;
      },
    );
  }

  it("creates and corrects explicit Kernel memory while goal records contain only version references", async () => {
    await add();
    const before = listing().items[0];
    expect(before.record.content).toBe("Explicit owner fact");
    const result = await host.memoryCorrect(event, {
      ...target(before, "correct"),
      content: "Corrected owner fact",
      category: "user-fact",
    });
    goal = result.goal;
    const current = listing();
    expect(current.items.find((item) => !item.unavailable).record.content).toBe(
      "Corrected owner fact",
    );
    expect(
      current.items.find((item) => item.memoryId === before.memoryId).record,
    ).toBeNull();
    expect(JSON.stringify(host.read(event, { id: goal.id }))).not.toContain(
      "Corrected owner fact",
    );
  });

  it("revokes locally before output and permits a later owner-requested Kernel deletion", async () => {
    await add();
    const before = listing().items[0];
    goal = host.memoryRevoke(event, target(before, "revoke")).goal;
    const revoked = listing().items[0];
    expect(revoked.record).toBeNull();
    const deleted = await host.memoryDelete(event, target(revoked, "delete"));
    goal = deleted.goal;
    expect(deleted.operation.result.receipt).toMatchObject({
      status: "purged",
      memoryId: before.memoryId,
    });
    expect(listing().items[0]).toMatchObject({ state: "purged", record: null });
    expect(
      host.memoryOperations(event, { goalId: goal.id }).items,
    ).toHaveLength(3);
  });

  it.each(["actorDid", "scope", "allowedSinks", "activate", "approved"])(
    "rejects renderer authority field %s",
    async (key) => {
      await expect(
        host.memoryCreate(event, { ...input(), [key]: "forged" }),
      ).rejects.toMatchObject({ code: "GOAL_MEMORY_INVALID_REQUEST" });
      expect(listing().items).toEqual([]);
    },
  );

  it("denies untrusted frames and unauthenticated reads", async () => {
    await add();
    actor = null;
    expect(() => listing()).toThrow("GOAL_IDENTITY_REQUIRED");
    actor = owner;
    event.senderFrame.url = "https://untrusted.example";
    expect(() => listing()).toThrow("GOAL_UNTRUSTED_SENDER");
  });

  it.each([
    ["identity", () => "identity", "GOAL_MEMORY_AUTHENTICATION_CHANGED"],
    [
      "authentication generation",
      () => "generation",
      "GOAL_MEMORY_AUTHENTICATION_CHANGED",
    ],
    ["navigation", () => "navigation", "GOAL_MEMORY_WINDOW_CHANGED"],
    ["window replacement", () => "window", "GOAL_MEMORY_WINDOW_CHANGED"],
    ["database connection", () => "database", "GOAL_DATABASE_CHANGED"],
    ["logout", () => "logout", "GOAL_IDENTITY_REQUIRED"],
  ])(
    "rejects %s changes after awaited Kernel work",
    async (_, action, code) => {
      afterProposal(() => {
        const value = action();
        if (value === "identity") actor = "did:chainless:other";
        else if (value === "generation") generation++;
        else if (value === "navigation")
          event.senderFrame.url = "http://localhost:5173/another-project";
        else if (value === "window") window = { isDestroyed: () => false };
        else if (value === "database") activeDb = new Database(":memory:");
        else actor = null;
      });
      await expect(host.memoryCreate(event, input())).rejects.toMatchObject({
        code: "GOAL_AUTHORITY_UNAVAILABLE",
      });
      expect(
        db
          .prepare("SELECT count(*) AS n FROM cc_project_goal_memory_links")
          .get().n,
      ).toBe(0);
      expect(
        JSON.parse(
          db
            .prepare(
              "SELECT record_json FROM cc_project_goal_memory_operations",
            )
            .get().record_json,
        ).status,
      ).toBe("prepared");
    },
  );

  it("rechecks current personal ownership before associating a committed Kernel candidate", async () => {
    afterProposal(() =>
      db
        .prepare(
          "UPDATE projects SET user_id='did:chainless:other' WHERE id='p1'",
        )
        .run(),
    );
    await expect(host.memoryCreate(event, input())).rejects.toMatchObject({
      code: "GOAL_NOT_FOUND_OR_DENIED",
    });
    expect(() => listing()).toThrow("GOAL_NOT_FOUND_OR_DENIED");
  });

  it("recovers the same persisted deletion after its transport result is uncertain", async () => {
    await add();
    const request = target(listing().items[0], "delete-uncertain");
    const original = ContextMemoryKernel.prototype.deleteMemory;
    const spy = vi
      .spyOn(ContextMemoryKernel.prototype, "deleteMemory")
      .mockImplementation(async function (value) {
        await original.call(this, value);
        throw new Error("uncertain transport");
      });
    await expect(host.memoryDelete(event, request)).rejects.toThrow(
      "uncertain transport",
    );
    spy.mockRestore();
    goal = host.read(event, { id: goal.id });
    expect(listing().items[0]).toMatchObject({ state: "purged", record: null });
    const recovered = await host.memoryRecover(event, {
      goalId: goal.id,
      requestId: request.requestId,
    });
    expect(recovered.operation.result.receipt.status).toBe("purged");
  });

  it("registers all eight fixed memory capabilities with the trusted host", () => {
    registerProjectGoalIPC(
      { getDatabase: () => db },
      {
        electron,
        getCurrentUserDid: () => actor,
        monitoringController: { initialize: vi.fn(), close: vi.fn() },
      },
    );
    const registered = new Set(
      electron.ipcMain.handle.mock.calls.map(([channel]) => channel),
    );
    for (const key of [
      "memoryList",
      "memoryCreate",
      "memoryCorrect",
      "memoryDelete",
      "memoryRevoke",
      "memoryOperations",
      "memoryRecover",
      "memoryDiscard",
    ])
      expect(registered.has(CHANNELS[key])).toBe(true);
  });
});
