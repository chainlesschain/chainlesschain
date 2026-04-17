import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

import {
  FL_STATUS,
  MPC_PROTOCOL,
  DP_MECHANISM,
  HE_SCHEME,
  DEFAULT_CONFIG,
  ensurePrivacyTables,
  createModel,
  trainRound,
  failModel,
  getModel,
  listModels,
  createComputation,
  submitShare,
  getComputation,
  listComputations,
  dpPublish,
  heQuery,
  getPrivacyReport,
  _resetState,
} from "../../src/lib/privacy-computing.js";

describe("privacy-computing", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensurePrivacyTables(db);
  });

  /* ── Schema ──────────────────────────────────────── */

  describe("ensurePrivacyTables", () => {
    it("creates both tables", () => {
      expect(db.tables.has("fl_models")).toBe(true);
      expect(db.tables.has("mpc_computations")).toBe(true);
    });

    it("is idempotent", () => {
      ensurePrivacyTables(db);
      expect(db.tables.has("fl_models")).toBe(true);
    });
  });

  /* ── Catalogs ────────────────────────────────────── */

  describe("catalogs", () => {
    it("has 5 FL statuses", () => {
      expect(Object.keys(FL_STATUS)).toHaveLength(5);
    });

    it("has 3 MPC protocols", () => {
      expect(Object.keys(MPC_PROTOCOL)).toHaveLength(3);
    });

    it("has 3 DP mechanisms", () => {
      expect(Object.keys(DP_MECHANISM)).toHaveLength(3);
    });

    it("has 3 HE schemes", () => {
      expect(Object.keys(HE_SCHEME)).toHaveLength(3);
    });

    it("has sane defaults", () => {
      expect(DEFAULT_CONFIG.maxRounds).toBe(100);
      expect(DEFAULT_CONFIG.maxBudget).toBe(10.0);
    });
  });

  /* ── Federated Learning ──────────────────────────── */

  describe("createModel", () => {
    it("creates a model in initializing status", () => {
      const r = createModel(db, "test-model");
      expect(r.modelId).toBeTruthy();
      const m = getModel(db, r.modelId);
      expect(m.name).toBe("test-model");
      expect(m.status).toBe("initializing");
      expect(m.current_round).toBe(0);
    });

    it("accepts custom options", () => {
      const r = createModel(db, "custom", {
        modelType: "cnn",
        architecture: "resnet",
        totalRounds: 20,
        learningRate: 0.001,
        participants: 5,
      });
      const m = getModel(db, r.modelId);
      expect(m.model_type).toBe("cnn");
      expect(m.architecture).toBe("resnet");
      expect(m.total_rounds).toBe(20);
      expect(m.learning_rate).toBe(0.001);
      expect(m.participant_count).toBe(5);
    });
  });

  describe("trainRound", () => {
    it("advances round and improves accuracy", () => {
      const { modelId } = createModel(db, "train-test", { totalRounds: 5 });
      const r = trainRound(db, modelId);
      expect(r.trained).toBe(true);
      expect(r.round).toBe(1);
      expect(r.accuracy).toBeGreaterThan(0);
      expect(r.status).toBe("training");
    });

    it("completes after total rounds", () => {
      const { modelId } = createModel(db, "complete-test", { totalRounds: 2 });
      trainRound(db, modelId);
      const r = trainRound(db, modelId);
      expect(r.status).toBe("completed");
      expect(r.accuracy).toBeGreaterThan(0.9);
    });

    it("rejects training completed model", () => {
      const { modelId } = createModel(db, "done", { totalRounds: 1 });
      trainRound(db, modelId);
      const r = trainRound(db, modelId);
      expect(r.trained).toBe(false);
      expect(r.reason).toBe("already_completed");
    });

    it("rejects training failed model", () => {
      const { modelId } = createModel(db, "fail");
      failModel(db, modelId);
      const r = trainRound(db, modelId);
      expect(r.trained).toBe(false);
      expect(r.reason).toBe("model_failed");
    });

    it("rejects unknown model", () => {
      const r = trainRound(db, "nope");
      expect(r.trained).toBe(false);
      expect(r.reason).toBe("not_found");
    });
  });

  describe("failModel", () => {
    it("marks model as failed", () => {
      const { modelId } = createModel(db, "to-fail");
      const r = failModel(db, modelId);
      expect(r.failed).toBe(true);
      expect(getModel(db, modelId).status).toBe("failed");
    });

    it("rejects unknown model", () => {
      const r = failModel(db, "nope");
      expect(r.failed).toBe(false);
    });
  });

  describe("getModel / listModels", () => {
    it("returns null for unknown id", () => {
      expect(getModel(db, "nope")).toBeNull();
    });

    it("lists models with status filter", () => {
      createModel(db, "a");
      createModel(db, "b");
      const { modelId } = createModel(db, "c");
      failModel(db, modelId);

      expect(listModels(db)).toHaveLength(3);
      expect(listModels(db, { status: "failed" })).toHaveLength(1);
      expect(listModels(db, { status: "initializing" })).toHaveLength(2);
    });

    it("respects limit", () => {
      createModel(db, "x");
      createModel(db, "y");
      createModel(db, "z");
      expect(listModels(db, { limit: 2 })).toHaveLength(2);
    });
  });

  /* ── MPC Computation ─────────────────────────────── */

  describe("createComputation", () => {
    it("creates a computation", () => {
      const r = createComputation(db, "aggregate", {
        protocol: "shamir",
        participantIds: ["a", "b", "c"],
        sharesRequired: 2,
      });
      expect(r.computationId).toBeTruthy();
      const c = getComputation(db, r.computationId);
      expect(c.protocol).toBe("shamir");
      expect(c.shares_required).toBe(2);
    });

    it("rejects invalid protocol", () => {
      const r = createComputation(db, "test", { protocol: "invalid" });
      expect(r.computationId).toBeNull();
      expect(r.reason).toBe("invalid_protocol");
    });

    it("defaults shares_required to ceil(n/2)", () => {
      const r = createComputation(db, "test", {
        participantIds: ["a", "b", "c", "d"],
      });
      const c = getComputation(db, r.computationId);
      expect(c.shares_required).toBe(2);
    });
  });

  describe("submitShare", () => {
    it("submits and transitions to computing", () => {
      const { computationId } = createComputation(db, "sum", {
        participantIds: ["a", "b"],
        sharesRequired: 2,
      });
      const r = submitShare(db, computationId);
      expect(r.submitted).toBe(true);
      expect(r.status).toBe("computing");
    });

    it("completes when threshold reached", () => {
      const { computationId } = createComputation(db, "sum", {
        participantIds: ["a", "b"],
        sharesRequired: 2,
      });
      submitShare(db, computationId);
      const r = submitShare(db, computationId);
      expect(r.status).toBe("completed");
      const c = getComputation(db, computationId);
      expect(c.result_hash).toBeTruthy();
      expect(c.computation_time_ms).toBeGreaterThanOrEqual(0);
    });

    it("rejects share on completed computation", () => {
      const { computationId } = createComputation(db, "sum", {
        sharesRequired: 1,
      });
      submitShare(db, computationId);
      const r = submitShare(db, computationId);
      expect(r.submitted).toBe(false);
      expect(r.reason).toBe("already_completed");
    });

    it("rejects unknown computation", () => {
      const r = submitShare(db, "nope");
      expect(r.submitted).toBe(false);
    });
  });

  describe("getComputation / listComputations", () => {
    it("returns null for unknown id", () => {
      expect(getComputation(db, "nope")).toBeNull();
    });

    it("lists with protocol and status filters", () => {
      createComputation(db, "a", { protocol: "shamir" });
      createComputation(db, "b", { protocol: "beaver" });
      createComputation(db, "c", { protocol: "shamir" });

      expect(listComputations(db)).toHaveLength(3);
      expect(listComputations(db, { protocol: "shamir" })).toHaveLength(2);
      expect(listComputations(db, { protocol: "beaver" })).toHaveLength(1);
    });
  });

  /* ── Differential Privacy ────────────────────────── */

  describe("dpPublish", () => {
    it("publishes scalar with noise", () => {
      const r = dpPublish(db, { data: 100, epsilon: 1.0 });
      expect(r.published).toBe(true);
      expect(r.data).not.toBe(100); // noise added
      expect(typeof r.data).toBe("number");
      expect(r.budgetSpent).toBeGreaterThan(0);
    });

    it("publishes array with noise", () => {
      const r = dpPublish(db, { data: [10, 20, 30], epsilon: 0.5 });
      expect(r.published).toBe(true);
      expect(r.data).toHaveLength(3);
      expect(r.mechanism).toBe("laplace");
    });

    it("tracks privacy budget", () => {
      dpPublish(db, { data: 1, epsilon: 3.0 });
      dpPublish(db, { data: 2, epsilon: 3.0 });
      const r = dpPublish(db, { data: 3, epsilon: 3.0 });
      expect(r.published).toBe(true);
      expect(r.budgetSpent).toBe(9);
    });

    it("rejects when budget exceeded", () => {
      dpPublish(db, { data: 1, epsilon: 9.0 });
      const r = dpPublish(db, { data: 2, epsilon: 2.0 });
      expect(r.published).toBe(false);
      expect(r.reason).toBe("budget_exceeded");
    });

    it("supports gaussian mechanism", () => {
      const r = dpPublish(db, { data: 50, mechanism: "gaussian" });
      expect(r.published).toBe(true);
      expect(r.mechanism).toBe("gaussian");
    });

    it("passes non-numeric data unchanged", () => {
      const r = dpPublish(db, { data: "text", epsilon: 0.1 });
      expect(r.published).toBe(true);
      expect(r.data).toBe("text");
    });
  });

  /* ── Homomorphic Encryption ──────────────────────── */

  describe("heQuery", () => {
    it("computes sum", () => {
      const r = heQuery({ data: [1, 2, 3], operation: "sum" });
      expect(r.result).toBe(6);
      expect(r.encrypted).toBe(true);
    });

    it("computes product", () => {
      const r = heQuery({ data: [2, 3, 4], operation: "product" });
      expect(r.result).toBe(24);
    });

    it("computes mean", () => {
      const r = heQuery({ data: [10, 20, 30], operation: "mean" });
      expect(r.result).toBe(20);
    });

    it("computes count", () => {
      const r = heQuery({ data: [1, 2, 3, 4], operation: "count" });
      expect(r.result).toBe(4);
    });

    it("rejects unsupported scheme", () => {
      const r = heQuery({ data: [1], operation: "sum", scheme: "rsa" });
      expect(r.result).toBeNull();
      expect(r.reason).toBe("unsupported_scheme");
    });

    it("rejects unsupported operation", () => {
      const r = heQuery({ data: [1], operation: "decrypt" });
      expect(r.result).toBeNull();
      expect(r.reason).toBe("unsupported_operation");
    });

    it("rejects empty data", () => {
      const r = heQuery({ data: [], operation: "sum" });
      expect(r.result).toBeNull();
      expect(r.reason).toBe("invalid_data");
    });
  });

  /* ── Privacy Report ──────────────────────────────── */

  describe("getPrivacyReport", () => {
    it("returns zeros when empty", () => {
      const r = getPrivacyReport(db);
      expect(r.privacyBudget.spent).toBe(0);
      expect(r.privacyBudget.limit).toBe(10);
      expect(r.federatedLearning.totalModels).toBe(0);
      expect(r.mpc.totalComputations).toBe(0);
    });

    it("computes correct report", () => {
      createModel(db, "m1");
      const { modelId } = createModel(db, "m2", { totalRounds: 1 });
      trainRound(db, modelId);

      createComputation(db, "sum", { protocol: "shamir" });
      createComputation(db, "mul", { protocol: "beaver" });

      dpPublish(db, { data: 1, epsilon: 2.0 });

      const r = getPrivacyReport(db);
      expect(r.federatedLearning.totalModels).toBe(2);
      expect(r.federatedLearning.completed).toBe(1);
      expect(r.mpc.totalComputations).toBe(2);
      expect(r.mpc.byProtocol.shamir).toBe(1);
      expect(r.mpc.byProtocol.beaver).toBe(1);
      expect(r.privacyBudget.spent).toBeGreaterThan(0);
    });
  });
});
