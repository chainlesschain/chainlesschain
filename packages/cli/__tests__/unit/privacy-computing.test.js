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
  // V2 surface
  FL_STATUS_V2,
  MPC_STATUS_V2,
  DP_MECHANISM_V2,
  HE_SCHEME_V2,
  MPC_PROTOCOL_V2,
  PRIVACY_DEFAULT_MAX_ACTIVE_MPC_COMPUTATIONS,
  setMaxActiveMpcComputations,
  getMaxActiveMpcComputations,
  getActiveMpcCount,
  setPrivacyBudgetLimit,
  getPrivacyBudgetLimit,
  getPrivacyBudgetSpent,
  resetPrivacyBudget,
  createModelV2,
  trainRoundV2,
  aggregateRound,
  failModelV2,
  setFLStatusV2,
  createComputationV2,
  submitShareV2,
  failComputation,
  setMPCStatusV2,
  dpPublishV2,
  heQueryV2,
  getPrivacyStatsV2,
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

  /* ────────────────────────────────────────────────────────
   *  V2 — Phase 91 surface
   * ──────────────────────────────────────────────────────── */

  describe("V2 frozen enums", () => {
    it("FL_STATUS_V2 mirrors FL_STATUS", () => {
      expect(FL_STATUS_V2).toBe(FL_STATUS);
    });

    it("MPC_STATUS_V2 has 4 states", () => {
      expect(Object.values(MPC_STATUS_V2).sort()).toEqual(
        ["completed", "computing", "failed", "pending"].sort(),
      );
      expect(Object.isFrozen(MPC_STATUS_V2)).toBe(true);
    });

    it("DP_MECHANISM_V2 / HE_SCHEME_V2 / MPC_PROTOCOL_V2 are frozen id-only", () => {
      expect(DP_MECHANISM_V2.LAPLACE).toBe("laplace");
      expect(HE_SCHEME_V2.PAILLIER).toBe("paillier");
      expect(MPC_PROTOCOL_V2.SHAMIR).toBe("shamir");
      expect(Object.isFrozen(DP_MECHANISM_V2)).toBe(true);
      expect(Object.isFrozen(HE_SCHEME_V2)).toBe(true);
      expect(Object.isFrozen(MPC_PROTOCOL_V2)).toBe(true);
    });

    it("PRIVACY_DEFAULT_MAX_ACTIVE_MPC_COMPUTATIONS = 20", () => {
      expect(PRIVACY_DEFAULT_MAX_ACTIVE_MPC_COMPUTATIONS).toBe(20);
    });
  });

  describe("setMaxActiveMpcComputations", () => {
    it("defaults to 20", () => {
      expect(getMaxActiveMpcComputations()).toBe(20);
    });

    it("sets positive integer", () => {
      setMaxActiveMpcComputations(5);
      expect(getMaxActiveMpcComputations()).toBe(5);
    });

    it("floors non-integer", () => {
      setMaxActiveMpcComputations(3.7);
      expect(getMaxActiveMpcComputations()).toBe(3);
    });

    it("rejects ≤0, NaN, non-number", () => {
      expect(() => setMaxActiveMpcComputations(0)).toThrow();
      expect(() => setMaxActiveMpcComputations(-1)).toThrow();
      expect(() => setMaxActiveMpcComputations(NaN)).toThrow();
      expect(() => setMaxActiveMpcComputations("5")).toThrow();
    });

    it("_resetState restores default", () => {
      setMaxActiveMpcComputations(7);
      _resetState();
      expect(getMaxActiveMpcComputations()).toBe(20);
    });
  });

  describe("getActiveMpcCount", () => {
    it("returns 0 when empty", () => {
      expect(getActiveMpcCount()).toBe(0);
    });

    it("counts pending + computing", () => {
      createComputationV2(db, {
        computationType: "sum",
        participantIds: ["a", "b", "c"],
        sharesRequired: 3,
      });
      expect(getActiveMpcCount()).toBe(1);
      const c2 = createComputationV2(db, {
        computationType: "mul",
        participantIds: ["x", "y"],
        sharesRequired: 2,
      });
      submitShareV2(db, c2.id); // pending → computing
      expect(getActiveMpcCount()).toBe(2);
    });

    it("excludes terminal (completed/failed)", () => {
      const c = createComputationV2(db, {
        computationType: "sum",
        participantIds: ["a"],
        sharesRequired: 1,
      });
      submitShareV2(db, c.id); // completes
      expect(getActiveMpcCount()).toBe(0);
    });
  });

  describe("privacy budget config", () => {
    it("set/get/reset", () => {
      expect(getPrivacyBudgetLimit()).toBe(DEFAULT_CONFIG.maxBudget);
      setPrivacyBudgetLimit(50);
      expect(getPrivacyBudgetLimit()).toBe(50);
      dpPublishV2(db, { data: 1, epsilon: 3.0 });
      expect(getPrivacyBudgetSpent()).toBe(3.0);
      resetPrivacyBudget();
      expect(getPrivacyBudgetSpent()).toBe(0);
    });

    it("rejects ≤0 limit", () => {
      expect(() => setPrivacyBudgetLimit(0)).toThrow();
      expect(() => setPrivacyBudgetLimit(-1)).toThrow();
      expect(() => setPrivacyBudgetLimit(NaN)).toThrow();
    });
  });

  describe("createModelV2", () => {
    it("throws on missing name", () => {
      expect(() => createModelV2(db, {})).toThrow("name is required");
    });

    it("throws on invalid totalRounds", () => {
      expect(() => createModelV2(db, { name: "m1", totalRounds: 0 })).toThrow(
        "totalRounds",
      );
      expect(() => createModelV2(db, { name: "m1", totalRounds: -1 })).toThrow(
        "totalRounds",
      );
    });

    it("creates model in initializing", () => {
      const m = createModelV2(db, { name: "m1", totalRounds: 3 });
      expect(m.status).toBe("initializing");
      expect(m.total_rounds).toBe(3);
    });
  });

  describe("trainRoundV2", () => {
    it("auto-advances initializing → training", () => {
      const m = createModelV2(db, { name: "m1", totalRounds: 3 });
      const r = trainRoundV2(db, m.id);
      expect(r.status).toBe("training");
      expect(r.current_round).toBe(1);
    });

    it("throws for unknown model", () => {
      expect(() => trainRoundV2(db, "nope")).toThrow("Unknown model");
    });

    it("rejects from terminal (completed)", () => {
      const m = createModelV2(db, { name: "m1", totalRounds: 1 });
      trainRoundV2(db, m.id);
      aggregateRound(db, m.id); // → completed
      expect(() => trainRoundV2(db, m.id)).toThrow("Invalid transition");
    });
  });

  describe("aggregateRound", () => {
    it("transitions training → training next round", () => {
      const m = createModelV2(db, { name: "m1", totalRounds: 3 });
      trainRoundV2(db, m.id);
      const r = aggregateRound(db, m.id);
      expect(r.status).toBe("training");
    });

    it("transitions to completed at final round", () => {
      const m = createModelV2(db, { name: "m1", totalRounds: 1 });
      trainRoundV2(db, m.id);
      const r = aggregateRound(db, m.id);
      expect(r.status).toBe("completed");
    });

    it("rejects non-training state", () => {
      const m = createModelV2(db, { name: "m1", totalRounds: 3 });
      expect(() => aggregateRound(db, m.id)).toThrow("Invalid transition");
    });
  });

  describe("failModelV2", () => {
    it("transitions non-terminal → failed", () => {
      const m = createModelV2(db, { name: "m1", totalRounds: 3 });
      const r = failModelV2(db, m.id, { error: "oops" });
      expect(r.status).toBe("failed");
      expect(r.error_message).toBe("oops");
    });

    it("rejects terminal", () => {
      const m = createModelV2(db, { name: "m1", totalRounds: 1 });
      trainRoundV2(db, m.id);
      aggregateRound(db, m.id);
      expect(() => failModelV2(db, m.id)).toThrow("terminal");
    });
  });

  describe("setFLStatusV2", () => {
    it("throws on unknown status", () => {
      const m = createModelV2(db, { name: "m1" });
      expect(() => setFLStatusV2(db, m.id, "bogus")).toThrow(
        "Unknown FL status",
      );
    });

    it("rejects invalid transition", () => {
      const m = createModelV2(db, { name: "m1" });
      expect(() => setFLStatusV2(db, m.id, "completed")).toThrow(
        "Invalid transition",
      );
    });

    it("applies patch", () => {
      const m = createModelV2(db, { name: "m1" });
      const r = setFLStatusV2(db, m.id, "training", {
        accuracy: 0.9,
        loss: 0.1,
      });
      expect(r.accuracy).toBe(0.9);
      expect(r.loss).toBe(0.1);
    });
  });

  describe("createComputationV2", () => {
    it("throws on invalid protocol", () => {
      expect(() =>
        createComputationV2(db, {
          computationType: "sum",
          protocol: "bogus",
          participantIds: ["a"],
        }),
      ).toThrow("Invalid protocol");
    });

    it("throws on empty participantIds", () => {
      expect(() =>
        createComputationV2(db, {
          computationType: "sum",
          participantIds: [],
        }),
      ).toThrow("non-empty");
    });

    it("enforces active cap", () => {
      setMaxActiveMpcComputations(2);
      createComputationV2(db, {
        computationType: "a",
        participantIds: ["x"],
        sharesRequired: 2,
      });
      createComputationV2(db, {
        computationType: "b",
        participantIds: ["y"],
        sharesRequired: 2,
      });
      expect(() =>
        createComputationV2(db, {
          computationType: "c",
          participantIds: ["z"],
          sharesRequired: 2,
        }),
      ).toThrow("Max active MPC computations");
    });

    it("cap released after terminal", () => {
      setMaxActiveMpcComputations(1);
      const c = createComputationV2(db, {
        computationType: "a",
        participantIds: ["x"],
        sharesRequired: 1,
      });
      submitShareV2(db, c.id); // completes
      expect(() =>
        createComputationV2(db, {
          computationType: "b",
          participantIds: ["y"],
          sharesRequired: 1,
        }),
      ).not.toThrow();
    });
  });

  describe("submitShareV2", () => {
    it("transitions pending → computing → completed", () => {
      const c = createComputationV2(db, {
        computationType: "sum",
        participantIds: ["a", "b"],
        sharesRequired: 2,
      });
      const r1 = submitShareV2(db, c.id);
      expect(r1.status).toBe("computing");
      const r2 = submitShareV2(db, c.id);
      expect(r2.status).toBe("completed");
      expect(r2.result_hash).toBeTruthy();
    });

    it("rejects terminal", () => {
      const c = createComputationV2(db, {
        computationType: "sum",
        participantIds: ["a"],
        sharesRequired: 1,
      });
      submitShareV2(db, c.id);
      expect(() => submitShareV2(db, c.id)).toThrow("terminal");
    });
  });

  describe("failComputation", () => {
    it("transitions non-terminal → failed", () => {
      const c = createComputationV2(db, {
        computationType: "sum",
        participantIds: ["a"],
        sharesRequired: 2,
      });
      const r = failComputation(db, c.id, { error: "bad" });
      expect(r.status).toBe("failed");
      expect(r.error_message).toBe("bad");
    });

    it("rejects terminal", () => {
      const c = createComputationV2(db, {
        computationType: "sum",
        participantIds: ["a"],
        sharesRequired: 1,
      });
      submitShareV2(db, c.id);
      expect(() => failComputation(db, c.id)).toThrow("terminal");
    });
  });

  describe("setMPCStatusV2", () => {
    it("throws on unknown status", () => {
      const c = createComputationV2(db, {
        computationType: "sum",
        participantIds: ["a"],
      });
      expect(() => setMPCStatusV2(db, c.id, "bogus")).toThrow("Unknown MPC");
    });

    it("rejects invalid transition", () => {
      const c = createComputationV2(db, {
        computationType: "sum",
        participantIds: ["a"],
      });
      expect(() => setMPCStatusV2(db, c.id, "completed")).toThrow(
        "Invalid transition",
      );
    });

    it("auto-stamps completedAt + computation_time_ms on terminal", () => {
      const c = createComputationV2(db, {
        computationType: "sum",
        participantIds: ["a"],
      });
      setMPCStatusV2(db, c.id, "computing");
      const r = setMPCStatusV2(db, c.id, "completed", { resultHash: "abc" });
      expect(r.status).toBe("completed");
      expect(r.completed_at).toBeGreaterThan(0);
      expect(r.computation_time_ms).toBeGreaterThanOrEqual(0);
      expect(r.result_hash).toBe("abc");
    });
  });

  describe("dpPublishV2", () => {
    it("throws on invalid mechanism", () => {
      expect(() => dpPublishV2(db, { data: 1, mechanism: "bogus" })).toThrow(
        "Invalid DP mechanism",
      );
    });

    it("throws on exceeded budget", () => {
      setPrivacyBudgetLimit(1);
      expect(() => dpPublishV2(db, { data: 1, epsilon: 2 })).toThrow(
        "Privacy budget exceeded",
      );
    });

    it("throws on ≤0 epsilon", () => {
      expect(() => dpPublishV2(db, { data: 1, epsilon: 0 })).toThrow("epsilon");
    });
  });

  describe("heQueryV2", () => {
    it("throws on invalid scheme", () => {
      expect(() =>
        heQueryV2({ data: [1, 2], operation: "sum", scheme: "bogus" }),
      ).toThrow("Invalid HE scheme");
    });

    it("throws on invalid operation", () => {
      expect(() => heQueryV2({ data: [1, 2], operation: "bogus" })).toThrow(
        "Invalid HE operation",
      );
    });

    it("throws on empty data", () => {
      expect(() => heQueryV2({ data: [], operation: "sum" })).toThrow(
        "non-empty",
      );
    });
  });

  describe("getPrivacyStatsV2", () => {
    it("zero-inits all enum keys", () => {
      const s = getPrivacyStatsV2();
      expect(s.totalModels).toBe(0);
      expect(s.totalComputations).toBe(0);
      expect(s.activeMpcCount).toBe(0);
      expect(s.flByStatus).toEqual({
        initializing: 0,
        training: 0,
        aggregating: 0,
        completed: 0,
        failed: 0,
      });
      expect(s.mpcByStatus).toEqual({
        pending: 0,
        computing: 0,
        completed: 0,
        failed: 0,
      });
      expect(s.mpcByProtocol).toEqual({ shamir: 0, beaver: 0, gmw: 0 });
      expect(s.budget.spent).toBe(0);
      expect(s.avgAccuracy).toBe(0);
      expect(s.avgComputationTimeMs).toBe(0);
    });

    it("aggregates state correctly", () => {
      const m1 = createModelV2(db, { name: "m1", totalRounds: 1 });
      trainRoundV2(db, m1.id);
      aggregateRound(db, m1.id); // completed
      createModelV2(db, { name: "m2", totalRounds: 3 }); // initializing

      const c = createComputationV2(db, {
        computationType: "sum",
        protocol: "beaver",
        participantIds: ["a"],
        sharesRequired: 1,
      });
      submitShareV2(db, c.id); // completed

      const s = getPrivacyStatsV2();
      expect(s.totalModels).toBe(2);
      expect(s.flByStatus.completed).toBe(1);
      expect(s.flByStatus.initializing).toBe(1);
      expect(s.totalComputations).toBe(1);
      expect(s.mpcByStatus.completed).toBe(1);
      expect(s.mpcByProtocol.beaver).toBe(1);
      expect(s.avgAccuracy).toBeGreaterThan(0);
    });
  });
});
