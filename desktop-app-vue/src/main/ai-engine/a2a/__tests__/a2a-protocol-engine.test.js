import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return { exec: vi.fn(), prepare: vi.fn().mockReturnValue(prep), _prep: prep };
}

const { A2AProtocolEngine } = require("../a2a-protocol-engine");

describe("A2AProtocolEngine", () => {
  let engine;
  let db;

  beforeEach(() => {
    engine = new A2AProtocolEngine();
    db = createMockDB();
    vi.clearAllMocks();
  });

  // --- Initialization ---

  it("should start with empty state", () => {
    expect(engine.initialized).toBe(false);
    expect(engine._agentCards.size).toBe(0);
    expect(engine._tasks.size).toBe(0);
    expect(engine._subscriptions.size).toBe(0);
  });

  it("should initialize with database", async () => {
    await engine.initialize(db);
    expect(engine.initialized).toBe(true);
    expect(db.exec).toHaveBeenCalled();
    expect(db.prepare).toHaveBeenCalled();
  });

  it("should skip double initialization", async () => {
    await engine.initialize(db);
    const callCount = db.exec.mock.calls.length;
    await engine.initialize(db);
    expect(db.exec.mock.calls.length).toBe(callCount);
  });

  // --- Agent Card Management ---

  it("should register a card with provided id", async () => {
    await engine.initialize(db);
    const card = engine.registerCard({
      id: "agent-1",
      name: "TestAgent",
      capabilities: ["code"],
    });
    expect(card.id).toBe("agent-1");
    expect(card.name).toBe("TestAgent");
    expect(card.capabilities).toEqual(["code"]);
    expect(engine._agentCards.has("agent-1")).toBe(true);
  });

  it("should register a card with auto-generated id", async () => {
    await engine.initialize(db);
    const card = engine.registerCard({ name: "AutoId" });
    expect(card.id).toMatch(/^agent-/);
    expect(card.name).toBe("AutoId");
  });

  it("should emit card:registered on register", async () => {
    await engine.initialize(db);
    const handler = vi.fn();
    engine.on("card:registered", handler);
    engine.registerCard({ id: "a1", name: "Agent1" });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a1", name: "Agent1" }),
    );
  });

  it("should update an existing card", async () => {
    await engine.initialize(db);
    engine.registerCard({ id: "a1", name: "Original" });
    const updated = engine.updateCard("a1", { name: "Updated" });
    expect(updated.name).toBe("Updated");
    expect(engine._agentCards.get("a1").name).toBe("Updated");
  });

  it("should return null when updating non-existent card", async () => {
    await engine.initialize(db);
    expect(engine.updateCard("no-exist", { name: "x" })).toBeNull();
  });

  // --- Discovery ---

  it("should discover all agents without filter", async () => {
    await engine.initialize(db);
    engine.registerCard({ id: "a1", name: "Agent1", capabilities: ["code"] });
    engine.registerCard({ id: "a2", name: "Agent2", capabilities: ["search"] });
    const results = engine.discoverAgents();
    expect(results).toHaveLength(2);
  });

  it("should filter agents by capability", async () => {
    await engine.initialize(db);
    engine.registerCard({ id: "a1", name: "Coder", capabilities: ["code"] });
    engine.registerCard({
      id: "a2",
      name: "Searcher",
      capabilities: ["search"],
    });
    const results = engine.discoverAgents({ capability: "code" });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Coder");
  });

  it("should filter agents by skill", async () => {
    await engine.initialize(db);
    engine.registerCard({
      id: "a1",
      name: "A1",
      skills: [{ id: "s1", name: "summarize" }],
    });
    engine.registerCard({
      id: "a2",
      name: "A2",
      skills: [{ id: "s2", name: "translate" }],
    });
    const results = engine.discoverAgents({ skill: "summarize" });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("a1");
  });

  it("should filter agents by name (case-insensitive)", async () => {
    await engine.initialize(db);
    engine.registerCard({ id: "a1", name: "Code Helper" });
    engine.registerCard({ id: "a2", name: "Data Analyst" });
    const results = engine.discoverAgents({ name: "code" });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("a1");
  });

  // --- Tasks ---

  it("should send a task to a registered agent", async () => {
    await engine.initialize(db);
    engine.registerCard({ id: "a1", name: "Worker" });
    const result = await engine.sendTask(
      "a1",
      { prompt: "hello" },
      { autoProcess: false },
    );
    expect(result.taskId).toMatch(/^task-/);
    expect(result.status).toBe("submitted");
    expect(engine._tasks.size).toBe(1);
  });

  it("should throw when sending task to unknown agent", async () => {
    await engine.initialize(db);
    await expect(engine.sendTask("unknown", {})).rejects.toThrow(
      "Agent 'unknown' not found",
    );
  });

  it("should get task status", async () => {
    await engine.initialize(db);
    engine.registerCard({ id: "a1", name: "W" });
    const { taskId } = await engine.sendTask(
      "a1",
      { q: "test" },
      { autoProcess: false },
    );
    const status = engine.getTaskStatus(taskId);
    expect(status).toBeDefined();
    expect(status.status).toBe("submitted");
  });

  it("should return null for unknown task", () => {
    expect(engine.getTaskStatus("no-task")).toBeNull();
  });

  it("should complete a task", async () => {
    await engine.initialize(db);
    engine.registerCard({ id: "a1", name: "W" });
    const { taskId } = await engine.sendTask("a1", {}, { autoProcess: false });
    const completed = engine.completeTask(taskId, { result: "done" }, [
      { name: "file.txt" },
    ]);
    expect(completed.status).toBe("completed");
    expect(completed.output).toEqual({ result: "done" });
    expect(completed.artifacts).toHaveLength(1);
  });

  it("should fail a task", async () => {
    await engine.initialize(db);
    engine.registerCard({ id: "a1", name: "W" });
    const { taskId } = await engine.sendTask("a1", {}, { autoProcess: false });
    const failed = engine.failTask(taskId, "something broke");
    expect(failed.status).toBe("failed");
    expect(failed.output.error).toBe("something broke");
  });

  it("should request input for a task", async () => {
    await engine.initialize(db);
    engine.registerCard({ id: "a1", name: "W" });
    const { taskId } = await engine.sendTask("a1", {}, { autoProcess: false });
    const result = engine.requestInput(taskId, "Need more info");
    expect(result.status).toBe("input-required");
  });

  // --- Subscriptions ---

  it("should subscribe to task updates", async () => {
    await engine.initialize(db);
    engine.registerCard({ id: "a1", name: "W" });
    const { taskId } = await engine.sendTask("a1", {}, { autoProcess: false });
    const callback = vi.fn();
    const subId = engine.subscribeToTask(taskId, callback);
    expect(subId).toMatch(/^sub-/);
    engine.completeTask(taskId, "done");
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].status).toBe("completed");
  });

  // --- Capability Negotiation ---

  it("should negotiate capability - all supported", async () => {
    await engine.initialize(db);
    engine.registerCard({
      id: "a1",
      name: "W",
      capabilities: ["code", "search", "chat"],
    });
    const result = engine.negotiateCapability("a1", ["code", "search"]);
    expect(result.compatible).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.supported).toEqual(["code", "search"]);
  });

  it("should negotiate capability - some missing", async () => {
    await engine.initialize(db);
    engine.registerCard({ id: "a1", name: "W", capabilities: ["code"] });
    const result = engine.negotiateCapability("a1", ["code", "vision"]);
    expect(result.compatible).toBe(false);
    expect(result.missing).toEqual(["vision"]);
  });

  it("should return all missing for unknown agent", () => {
    const result = engine.negotiateCapability("unknown", ["a", "b"]);
    expect(result.compatible).toBe(false);
    expect(result.missing).toEqual(["a", "b"]);
  });

  // --- List Peers ---

  it("should list peers with summary info", async () => {
    await engine.initialize(db);
    engine.registerCard({
      id: "a1",
      name: "Agent1",
      capabilities: ["c1"],
      url: "http://a1",
    });
    engine.registerCard({
      id: "a2",
      name: "Agent2",
      capabilities: ["c2"],
      url: "http://a2",
    });
    const peers = engine.listPeers();
    expect(peers).toHaveLength(2);
    expect(peers[0]).toHaveProperty("id");
    expect(peers[0]).toHaveProperty("name");
    expect(peers[0]).toHaveProperty("capabilities");
    expect(peers[0]).toHaveProperty("url");
  });
});
