import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let mockRunStmt, mockAllStmt, mockDb;
let InferenceNodeRegistry, getInferenceNodeRegistry;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (sql.includes("INSERT") || sql.includes("UPDATE")) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };
  const mod =
    await import("../../../src/main/ai-engine/inference/inference-node-registry.js");
  InferenceNodeRegistry = mod.InferenceNodeRegistry;
  getInferenceNodeRegistry = mod.getInferenceNodeRegistry;
});

describe("InferenceNodeRegistry", () => {
  let registry;
  beforeEach(() => {
    registry = new InferenceNodeRegistry({ db: mockDb });
  });

  it("should initialize", async () => {
    await registry.initialize();
    expect(registry.initialized).toBe(true);
  });
  it("should create tables", () => {
    registry._ensureTables();
    expect(mockDb.exec.mock.calls[0][0]).toContain("inference_nodes");
  });
  it("should throw if name missing", async () => {
    await expect(registry.registerNode({})).rejects.toThrow(
      "Node name is required",
    );
  });
  it("should register node", async () => {
    const n = await registry.registerNode({ name: "gpu-1" });
    expect(n.name).toBe("gpu-1");
    expect(n.status).toBe("online");
  });
  it("should list nodes", async () => {
    const r = new InferenceNodeRegistry(null);
    r._nodes.set("n1", { status: "online" });
    expect(await r.listNodes()).toHaveLength(1);
  });
  it("should get network stats", async () => {
    const s = await registry.getNetworkStats();
    expect(s.totalNodes).toBe(0);
  });
  it("should close", async () => {
    await registry.close();
    expect(registry._nodes.size).toBe(0);
  });
});
