import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let InferenceScheduler, getInferenceScheduler;

beforeEach(async () => {
  const mod =
    await import("../../../src/main/ai-engine/inference/inference-scheduler.js");
  InferenceScheduler = mod.InferenceScheduler;
  getInferenceScheduler = mod.getInferenceScheduler;
});

describe("InferenceScheduler", () => {
  let scheduler;
  beforeEach(() => {
    scheduler = new InferenceScheduler(null);
  });

  it("should initialize", async () => {
    await scheduler.initialize();
    expect(scheduler.initialized).toBe(true);
  });
  it("should throw if model missing", async () => {
    await expect(scheduler.submitTask({})).rejects.toThrow("Model is required");
  });
  it("should submit task", async () => {
    const t = await scheduler.submitTask({ model: "llama" });
    expect(t.status).toBe("completed");
  });
  it("should throw on missing task id", async () => {
    await expect(scheduler.getTaskStatus()).rejects.toThrow(
      "Task ID is required",
    );
  });
  it("should start federated round", async () => {
    const r = await scheduler.startFederatedRound({ model: "llama" });
    expect(r.status).toBe("running");
  });
  it("should get network stats", async () => {
    const s = await scheduler.getNetworkStats();
    expect(s.totalTasks).toBe(0);
  });
  it("should close", async () => {
    await scheduler.close();
    expect(scheduler.initialized).toBe(false);
  });
});
