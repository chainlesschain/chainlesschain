/**
 * PrivacyComputing unit tests — Phase 91
 *
 * Covers: initialize, federatedTrain, mpcCompute, dpPublish, heQuery,
 *         getPrivacyReport, configure, getModelStatus, exportModel
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ─────────────────────────────────────────────────────────────
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
const { PrivacyComputing } = require("../privacy-computing");

// ─── Helpers ─────────────────────────────────────────────────────────────────
function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue(prep),
    _prep: prep,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe("PrivacyComputing", () => {
  let pc;
  let db;

  beforeEach(() => {
    pc = new PrivacyComputing();
    db = createMockDB();
    vi.clearAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────────
  it("should construct with default config", () => {
    expect(pc.initialized).toBe(false);
    expect(pc._config.epsilon).toBe(1.0);
    expect(pc._models.size).toBe(0);
  });

  // ── initialize ───────────────────────────────────────────────────────────
  it("should initialize with database", async () => {
    await pc.initialize(db);
    expect(pc.initialized).toBe(true);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  it("should skip double initialization", async () => {
    await pc.initialize(db);
    await pc.initialize(db);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  // ── federatedTrain ───────────────────────────────────────────────────────
  it("should start federated training", async () => {
    await pc.initialize(db);
    const model = await pc.federatedTrain(null, {
      name: "test-fl",
      participants: 5,
      rounds: 20,
    });
    expect(model.id).toMatch(/^fl-model-/);
    expect(model.type).toBe("federated");
    expect(model.status).toBe("training");
    expect(model.participants).toBe(5);
    expect(model.rounds).toBe(20);
  });

  it("should use provided modelId", async () => {
    await pc.initialize(db);
    const model = await pc.federatedTrain("custom-id", {});
    expect(model.id).toBe("custom-id");
  });

  it("should emit privacy:training-started event", async () => {
    await pc.initialize(db);
    const listener = vi.fn();
    pc.on("privacy:training-started", listener);
    await pc.federatedTrain(null, {});
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: "federated" }),
    );
  });

  // ── mpcCompute ───────────────────────────────────────────────────────────
  it("should perform MPC computation", async () => {
    await pc.initialize(db);
    const result = await pc.mpcCompute("sum", ["alice", "bob"], [10, 20]);
    expect(result.id).toMatch(/^mpc-/);
    expect(result.type).toBe("mpc");
    expect(result.status).toBe("completed");
    expect(result.partyCount).toBe(2);
    expect(result.privacyGuarantee).toBe("information-theoretic");
  });

  it("should emit privacy:mpc-completed event", async () => {
    await pc.initialize(db);
    const listener = vi.fn();
    pc.on("privacy:mpc-completed", listener);
    await pc.mpcCompute("multiply", ["a", "b"], []);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "multiply" }),
    );
  });

  // ── dpPublish ────────────────────────────────────────────────────────────
  it("should publish with differential privacy", async () => {
    await pc.initialize(db);
    const result = await pc.dpPublish([1, 2, 3, 4, 5]);
    expect(result.id).toMatch(/^dp-/);
    expect(result.type).toBe("differential-privacy");
    expect(result.originalSize).toBe(5);
    expect(result.noiseAdded).toBe(true);
    expect(result.published).toBe(true);
    expect(result.epsilon).toBe(1.0);
  });

  it("should use custom epsilon", async () => {
    await pc.initialize(db);
    const result = await pc.dpPublish([1, 2], { epsilon: 0.5 });
    expect(result.epsilon).toBe(0.5);
  });

  it("should emit privacy:dp-published event", async () => {
    await pc.initialize(db);
    const listener = vi.fn();
    pc.on("privacy:dp-published", listener);
    await pc.dpPublish([1]);
    expect(listener).toHaveBeenCalled();
  });

  // ── heQuery ──────────────────────────────────────────────────────────────
  it("should execute homomorphic encryption query", async () => {
    await pc.initialize(db);
    const result = await pc.heQuery("encrypted-data", "SELECT SUM(amount)");
    expect(result.id).toMatch(/^he-/);
    expect(result.type).toBe("homomorphic");
    expect(result.computedOnEncrypted).toBe(true);
    expect(result.decryptionRequired).toBe(true);
  });

  it("should emit privacy:he-query-completed event", async () => {
    await pc.initialize(db);
    const listener = vi.fn();
    pc.on("privacy:he-query-completed", listener);
    await pc.heQuery("data", "query");
    expect(listener).toHaveBeenCalled();
  });

  // ── getPrivacyReport ─────────────────────────────────────────────────────
  it("should return privacy report", async () => {
    await pc.initialize(db);
    await pc.federatedTrain(null, {});
    await pc.dpPublish([1, 2, 3]);
    const report = pc.getPrivacyReport();
    expect(report.models).toBe(1);
    expect(report.computations).toBe(1);
    expect(report.config).toBeDefined();
    expect(report.privacyBudgetUsed).toBe(1.0);
  });

  // ── configure ────────────────────────────────────────────────────────────
  it("should update configuration", async () => {
    await pc.initialize(db);
    const config = pc.configure({ epsilon: 2.0, maxParticipants: 200 });
    expect(config.epsilon).toBe(2.0);
    expect(config.maxParticipants).toBe(200);
    expect(config.delta).toBe(1e-5); // unchanged
  });

  // ── getModelStatus ───────────────────────────────────────────────────────
  it("should return model status", async () => {
    await pc.initialize(db);
    const model = await pc.federatedTrain("my-model", {});
    const status = pc.getModelStatus("my-model");
    expect(status.id).toBe("my-model");
    expect(status.status).toBe("training");
  });

  it("should return null for unknown model", async () => {
    await pc.initialize(db);
    expect(pc.getModelStatus("nonexistent")).toBeNull();
  });

  // ── exportModel ──────────────────────────────────────────────────────────
  it("should export existing model", async () => {
    await pc.initialize(db);
    await pc.federatedTrain("export-me", { name: "test" });
    const exported = pc.exportModel("export-me");
    expect(exported.id).toBe("export-me");
    expect(exported.exportedAt).toBeDefined();
  });

  it("should return null for unknown model export", async () => {
    await pc.initialize(db);
    expect(pc.exportModel("unknown")).toBeNull();
  });
});
