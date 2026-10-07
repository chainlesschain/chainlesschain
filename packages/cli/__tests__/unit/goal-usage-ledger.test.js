import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  GoalUsageLedger,
} = require("@chainlesschain/session-core/goal-usage-ledger");
const {
  PersonalProjectGoalService,
} = require("@chainlesschain/session-core/project-goal-service");
const {
  digestBusinessObjectContent: digest,
} = require("@chainlesschain/session-core/business-object-contract");
describe("cross-domain personal goal usage reservations", () => {
  const actor = "did:owner";
  let db, goals, ledger;
  const tx = (fn) => db.transaction(fn).immediate();
  const goal = (budgetPolicy) =>
    goals.create({
      projectId: "p1",
      objective: "Follow delivery",
      budgetPolicy,
    });
  const reserve = (g, id, extra = {}) =>
    tx(() => ledger.reserve({ goal: g, actor, operationId: id, ...extra }));
  const summary = (g) => tx(() => ledger.summary(g, actor));
  const settle = (g, id, status, usage = null) =>
    tx(() =>
      ledger.settle({ goalId: g.id, actor, operationId: id, status, usage }),
    );
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(
      "CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER);INSERT INTO projects VALUES ('p1','did:owner','active',1)",
    );
    goals = new PersonalProjectGoalService({ db, getActor: () => actor });
    ledger = new GoalUsageLedger({ db });
  });
  afterEach(() => db.close());
  it("requires an owning native transaction and host-owned goal scope", () => {
    const g = goal({ maxRuns: 2 });
    expect(() => ledger.summary(g, actor)).toThrow(
      "GOAL_USAGE_TRANSACTION_REQUIRED",
    );
    expect(() => tx(() => ledger.summary(g, "did:other"))).toThrow(
      "GOAL_USAGE_SCOPE_DENIED",
    );
  });
  it("deduplicates reservations and actual settlement without resetting run budgets", () => {
    const g = goal({ maxRuns: 1 });
    const first = reserve(g, "a");
    expect(reserve(g, "a")).toEqual(first);
    expect(summary(g)).toMatchObject({
      totalRuns: 1,
      reservedRuns: 1,
      modelCostUsd: 0,
    });
    const usage = { runs: 1, tokens: 0, costUsd: 0, elapsedMs: 5 };
    settle(g, "a", "settled", usage);
    settle(g, "a", "settled", usage);
    expect(summary(g)).toMatchObject({
      totalRuns: 1,
      reservedRuns: 0,
      elapsedMs: 5,
    });
    expect(() => reserve(g, "b")).toThrow("GOAL_USAGE_BUDGET_EXHAUSTED");
  });
  it("combines canonical check evidence with separately reserved action usage", () => {
    const g = goal({ maxRuns: 2 });
    db.exec(
      "CREATE TABLE cc_project_goal_checks(goal_id TEXT,actor_did TEXT,elapsed_ms INTEGER)",
    );
    db.prepare("INSERT INTO cc_project_goal_checks VALUES (?,?,7)").run(
      g.id,
      actor,
    );
    reserve(g, "action");
    expect(summary(g)).toMatchObject({
      checks: 1,
      totalRuns: 2,
      knownElapsedMs: 7,
    });
    expect(() => reserve(g, "another")).toThrow("GOAL_USAGE_BUDGET_EXHAUSTED");
  });
  it("releases cancelled reservations while retaining immutable audit records", () => {
    const g = goal({ maxRuns: 1 });
    reserve(g, "a");
    settle(g, "a", "released");
    reserve(g, "b");
    expect(summary(g).totalRuns).toBe(1);
    expect(() =>
      settle(g, "a", "settled", {
        runs: 1,
        tokens: 0,
        costUsd: 0,
        elapsedMs: 1,
      }),
    ).toThrow("GOAL_USAGE_OPERATION_CONFLICT");
  });
  it("accounts for independent native verification in the same cumulative run and time limits", () => {
    const g = goal({ maxRuns: 1, maxTimeMs: 10 });
    reserve(g, "verify", { domain: "native-verifier" });
    settle(g, "verify", "settled", {
      runs: 1,
      tokens: 0,
      costUsd: 0,
      elapsedMs: 3,
    });
    expect(summary(g)).toMatchObject({
      totalRuns: 1,
      elapsedMs: 3,
      modelTokens: 0,
      modelCostUsd: 0,
    });
    expect(() => reserve(g, "next")).toThrow("GOAL_USAGE_BUDGET_EXHAUSTED");
  });
  it.each([
    { tokens: 1, costUsd: 0 },
    { tokens: 0, costUsd: 1 },
  ])("rejects model charges on a native verifier domain: %j", (charges) => {
    const g = goal({ maxRuns: 2 });
    expect(() =>
      reserve(g, "verify", {
        domain: "native-verifier",
        estimate: { runs: 1, elapsedMs: 0, ...charges },
      }),
    ).toThrow("GOAL_USAGE_INVALID_REQUEST");
    expect(summary(g).totalRuns).toBe(0);
  });
  it("does not report unsettled model usage or cost as zero", () => {
    const g = goal({ maxRuns: 2 });
    reserve(g, "model", {
      domain: "model",
      estimate: { runs: 1, tokens: 20, costUsd: 0.1, elapsedMs: 5 },
    });
    expect(summary(g)).toMatchObject({
      modelTokens: null,
      modelCostUsd: null,
      elapsedMs: null,
      reservedTokens: 20,
      reservedCostUsd: 0.1,
    });
    settle(g, "model", "settled", {
      runs: 1,
      tokens: 12,
      costUsd: 0.05,
      elapsedMs: 3,
    });
    expect(summary(g)).toMatchObject({
      modelTokens: 12,
      modelCostUsd: 0.05,
      elapsedMs: 3,
    });
  });
  it("refuses unknown estimates under finite token/cost/time limits", () => {
    const g = goal({
      maxRuns: 2,
      maxTokens: 10,
      maxCostUsd: 0.2,
      maxTimeMs: 20,
    });
    expect(() =>
      reserve(g, "model", {
        domain: "model",
        estimate: { runs: 1, tokens: null, costUsd: null, elapsedMs: null },
      }),
    ).toThrow("GOAL_USAGE_UNKNOWN");
    expect(summary(g).totalRuns).toBe(0);
  });
  it("accounts for held time estimates before admitting another action", () => {
    const g = goal({ maxRuns: 3, maxTimeMs: 10 });
    reserve(g, "a", {
      estimate: { runs: 1, tokens: 0, costUsd: 0, elapsedMs: 8 },
    });
    expect(() =>
      reserve(g, "b", {
        estimate: { runs: 1, tokens: 0, costUsd: 0, elapsedMs: 3 },
      }),
    ).toThrow("GOAL_USAGE_BUDGET_EXHAUSTED");
  });
  it("retains unknown operations and blocks bounded dispatch instead of resetting usage", () => {
    const g = goal({ maxRuns: 3, maxTimeMs: 10 });
    reserve(g, "a");
    settle(g, "a", "unknown");
    expect(summary(g)).toMatchObject({ totalRuns: 1, elapsedMs: null });
    expect(() => reserve(g, "b")).toThrow("GOAL_USAGE_UNKNOWN");
  });
  it("records real model overruns truthfully and prevents subsequent dispatch", () => {
    const g = goal({ maxRuns: 3, maxTokens: 10, maxCostUsd: 1 });
    reserve(g, "model", {
      domain: "model",
      estimate: { runs: 1, tokens: 9, costUsd: 0.5, elapsedMs: 0 },
    });
    settle(g, "model", "settled", {
      runs: 1,
      tokens: 12,
      costUsd: 1.2,
      elapsedMs: 1,
    });
    expect(summary(g)).toMatchObject({ modelTokens: 12, modelCostUsd: 1.2 });
    expect(() => reserve(g, "next")).toThrow("GOAL_USAGE_BUDGET_EXHAUSTED");
  });
  it("rejects corrupted, foreign and version-mismatched operation records", () => {
    const g = goal({ maxRuns: 3 });
    reserve(g, "a");
    const changed = goals.revise({
      id: g.id,
      expectedRevision: 1,
      patch: { objective: "Other" },
    });
    expect(() => reserve(changed, "a")).toThrow(
      "GOAL_USAGE_OPERATION_CONFLICT",
    );
    db.exec("UPDATE cc_project_goal_usage SET content_digest='bad'");
    expect(() => summary(g)).toThrow("GOAL_USAGE_RECORD_CORRUPT");
  });
  it.each(["settled", "released", "unknown"])(
    "does not authorize dispatch by replaying a %s operation",
    (status) => {
      const g = goal({ maxRuns: 3 });
      reserve(g, "a");
      settle(
        g,
        "a",
        status,
        status === "settled"
          ? { runs: 1, tokens: 0, costUsd: 0, elapsedMs: 2 }
          : null,
      );
      expect(() => reserve(g, "a")).toThrow("GOAL_USAGE_OPERATION_TERMINAL");
    },
  );
  it("refuses to erase consumed or uncertain usage through release", () => {
    const g = goal({ maxRuns: 3 });
    reserve(g, "a");
    expect(() =>
      settle(g, "a", "released", {
        runs: 1,
        tokens: 0,
        costUsd: 0,
        elapsedMs: 4,
      }),
    ).toThrow("GOAL_USAGE_INVALID_REQUEST");
    settle(g, "a", "unknown");
    expect(() => settle(g, "a", "released")).toThrow(
      "GOAL_USAGE_OPERATION_CONFLICT",
    );
    expect(summary(g)).toMatchObject({ totalRuns: 1, elapsedMs: null });
  });
  it("retains partial actual overruns and the unused estimate without double counting", () => {
    const g = goal({ maxRuns: 10 });
    reserve(g, "a", {
      domain: "model",
      estimate: { runs: 1, tokens: 20, costUsd: 2, elapsedMs: 10 },
    });
    const partial = { runs: 2, tokens: 30, costUsd: 1, elapsedMs: 4 };
    settle(g, "a", "unknown", partial);
    settle(g, "a", "unknown", partial);
    expect(summary(g)).toMatchObject({
      totalRuns: 2,
      reservedRuns: 0,
      knownModelTokens: 30,
      reservedTokens: 0,
      knownModelCostUsd: 1,
      reservedCostUsd: 1,
      knownElapsedMs: 4,
      reservedElapsedMs: 6,
      modelTokens: null,
      modelCostUsd: null,
      elapsedMs: null,
    });
    for (const status of ["unknown", "settled"]) {
      expect(() => settle(g, "a", status, { ...partial, tokens: 29 })).toThrow(
        "GOAL_USAGE_OPERATION_CONFLICT",
      );
      expect(() =>
        settle(g, "a", status, { ...partial, costUsd: null }),
      ).toThrow("GOAL_USAGE_OPERATION_CONFLICT");
    }
    expect(() => settle(g, "a", "unknown")).toThrow(
      "GOAL_USAGE_OPERATION_CONFLICT",
    );
    settle(g, "a", "settled", { ...partial, elapsedMs: 12 });
    expect(summary(g)).toMatchObject({
      totalRuns: 2,
      modelTokens: 30,
      modelCostUsd: 1,
      elapsedMs: 12,
      reservedCostUsd: 0,
    });
  });
  it("keeps an unknown native elapsed estimate visible as unknown", () => {
    const g = goal({ maxRuns: 3 });
    reserve(g, "a", {
      estimate: { runs: 1, tokens: 0, costUsd: 0, elapsedMs: null },
    });
    expect(summary(g)).toMatchObject({
      elapsedMs: null,
      unknownTime: 1,
      modelTokens: 0,
      modelCostUsd: 0,
    });
    const revised = goals.revise({
      id: g.id,
      expectedRevision: g.revision,
      patch: { budgetPolicy: { ...g.budgetPolicy, maxTimeMs: 100 } },
    });
    expect(() => reserve(revised, "b")).toThrow("GOAL_USAGE_UNKNOWN");
  });
  it.each([
    (record) => ({ ...record, extra: true }),
    (record) => ({
      ...record,
      usage: { runs: 1, tokens: 0, costUsd: 0, elapsedMs: 0 },
    }),
    (record) => ({
      ...record,
      status: "released",
      usage: { runs: 1, tokens: 0, costUsd: 0, elapsedMs: 0 },
    }),
    (record) => ({ ...record, goalRevision: record.goalRevision + 1 }),
    (record) => ({
      ...record,
      controlGeneration: record.controlGeneration + 1,
    }),
    (record) => ({ ...record, operationId: "bad id" }),
  ])(
    "rejects structurally invalid records even with a matching digest (%#)",
    (change) => {
      const g = goal({ maxRuns: 3 });
      const record = change(reserve(g, "a"));
      db.prepare(
        "UPDATE cc_project_goal_usage SET operation_id=?,record_json=?,content_digest=?",
      ).run(record.operationId, JSON.stringify(record), digest(record));
      expect(() => summary(g)).toThrow("GOAL_USAGE_RECORD_CORRUPT");
    },
  );
  it("rejects oversized direct replay reads and invalid goals before persisting", () => {
    const g = goal({ maxRuns: 3 });
    expect(() => reserve({ ...g, revision: undefined }, "a")).toThrow(
      "GOAL_USAGE_INVALID_REQUEST",
    );
    expect(() => reserve({ ...g, budgetPolicy: {} }, "a")).toThrow(
      "GOAL_USAGE_INVALID_REQUEST",
    );
    expect(summary(g).totalRuns).toBe(0);
    reserve(g, "a");
    db.prepare("UPDATE cc_project_goal_usage SET record_json=?").run(
      " ".repeat(8193),
    );
    expect(() => reserve(g, "a")).toThrow("GOAL_USAGE_RECORD_CORRUPT");
    expect(() => settle(g, "a", "released")).toThrow(
      "GOAL_USAGE_RECORD_CORRUPT",
    );
  });
});
