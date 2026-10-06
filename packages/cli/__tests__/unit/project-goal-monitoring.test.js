import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  openSchedulerStore,
} = require("@chainlesschain/session-core/scheduler-store");
const {
  ProjectGoalMonitoringEngine,
} = require("@chainlesschain/session-core/project-goal-monitoring");
const owner = "did:chainless:owner";
const instant = 1791244800000;

describe("native personal goal monitoring with an independent scheduler ledger", () => {
  let directory, db, store, engine, actor, now;
  function open() {
    db = new Database(join(directory, "project.db"));
    // These domain tests use a trusted test opener, not a production ACL claim.
    store = openSchedulerStore({
      file: join(directory, "scheduler.db"),
      Database,
      protectStorage: () => true,
      clock: () => now,
    });
    engine = new ProjectGoalMonitoringEngine({
      db,
      store,
      getActor: () => actor,
      clock: () => now,
      leaseMs: 60_000,
    });
  }
  async function reopen() {
    await engine.close();
    db.close();
    open();
  }
  function goal(overrides = {}) {
    return engine.state.goals.create({
      projectId: "p1",
      objective: "Follow delivery risk",
      ...overrides,
    });
  }
  function request(g, requestId = "request-a") {
    return { id: g.id, expectedRevision: g.revision, requestId };
  }
  function start(g) {
    return engine.start({
      id: g.id,
      expectedRevision: g.revision,
      intervalMs: 60_000,
    });
  }
  function count(table, database = db) {
    return database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get()
      .total;
  }
  function counts() {
    return {
      reviews: count("cc_project_risk_reviews"),
      checks: count("cc_project_goal_checks"),
      occurrences: count("occurrences", store.db),
    };
  }
  function queue(g, requestId = "request-a") {
    const binding = engine._manualBinding(request(g, requestId));
    const job = engine._job(binding);
    return store.enqueueOccurrenceOncePerTrigger({
      jobId: job.id,
      scheduledFor: now,
      triggerKey: `manual:${requestId}`,
      payload: {
        storeId: g.storeId,
        goalId: g.id,
        goalRevision: g.revision,
        controlGeneration: g.controlGeneration,
        monitorRevision: null,
        schedulerPolicyRevision: binding.policyRevision,
        requestId,
      },
    });
  }
  function policy(overrides = {}) {
    const principal = { type: "user", id: owner };
    const old = store.getAuthorityPolicy(principal);
    return store.setAuthorityPolicy(principal, {
      capabilities: ["project.risk.read"],
      windowMs: 60_000,
      maxRuns: 100,
      maxUnits: 100,
      expectedRevision: old?.revision ?? 0,
      ...overrides,
    });
  }
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "cc-goal-monitor-"));
    actor = owner;
    now = instant;
    open();
    db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,
        due_date INTEGER,blocked_by TEXT,org_id TEXT,workspace_id TEXT);
      CREATE TABLE organization_projects(id TEXT PRIMARY KEY,org_id TEXT);
      CREATE TABLE workspace_resources(workspace_id TEXT,resource_type TEXT,resource_id TEXT);`);
    db.prepare("INSERT INTO projects VALUES (?,?,?,?,0)").run(
      "p1",
      owner,
      "active",
      instant,
    );
    db.prepare(
      "INSERT INTO project_tasks VALUES (?,?,?,?,0,?,NULL,NULL,NULL)",
    ).run("t1", "p1", "pending", instant, instant - 1);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await engine?.close();
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("does not create work merely by creating a goal", async () => {
    const g = goal();
    await engine.tick();
    expect(engine.status({ id: g.id })).toMatchObject({
      executionState: "idle",
      monitor: null,
      usage: { checks: 0, modelTokens: 0 },
    });
    expect(counts()).toEqual({ reviews: 0, checks: 0, occurrences: 0 });
  });
  it("retains complete risk checks when proposal generation or lifetime capacity is truncated", async () => {
    const insert = db.prepare(
      "INSERT INTO project_tasks VALUES (?,?,?,?,0,?,NULL,NULL,NULL)",
    );
    db.transaction(() => {
      for (let i = 2; i <= 501; i++)
        insert.run(`t${i}`, "p1", "pending", instant, instant - 1);
    }).immediate();
    const g = goal();
    for (let i = 0; i < 6; i++) {
      const outcome = await engine.checkNow(request(g, `capacity-${i}`));
      expect(outcome.error).toBeNull();
      expect(outcome).toMatchObject({ status: "succeeded" });
      expect(outcome.result.riskTaskCount).toBe(501);
    }
    expect(counts().checks).toBe(6);
    expect(count("cc_project_goal_workflow")).toBe(500);
    expect(engine.state.workflow.list({ goalId: g.id }).summary).toMatchObject({
      candidateCount: 1002,
      savedCount: 500,
      omittedCount: 502,
      newCount: 0,
      status: "truncated",
    });
  });
  it("explicitly checks live facts, records evidence and reserves existing authority units", async () => {
    const g = goal();
    const outcome = await engine.checkNow(request(g));
    expect(outcome).toMatchObject({
      status: "succeeded",
      result: { goalId: g.id, status: "evaluated", riskTaskCount: 1 },
    });
    expect(engine.status({ id: g.id })).toMatchObject({
      goal: { status: "active", completion: null },
      usage: { checks: 1, modelCostUsd: 0 },
      history: [{ reviewId: outcome.result.reviewId }],
    });
    expect(store.getAuthorityReservation(outcome.occurrenceId)).toMatchObject({
      units: 1,
      status: "succeeded",
    });
    expect(counts()).toEqual({ reviews: 1, checks: 1, occurrences: 1 });
  });
  it("replays an explicit request after reopen without checking or charging twice", async () => {
    const g = goal({ budgetPolicy: { maxRuns: 1 } });
    const first = await engine.checkNow(request(g));
    await reopen();
    now += 90_000;
    const second = await engine.checkNow(request(g));
    expect(second.result).toEqual(first.result);
    expect(counts()).toEqual({ reviews: 1, checks: 1, occurrences: 1 });
    expect(
      store.db
        .prepare("SELECT SUM(runs) AS total FROM scheduler_authority_usage")
        .get().total,
    ).toBe(1);
  });
  it("concurrent distinct manual requests retain stable job revisions", async () => {
    const g = goal();
    queue(g, "first");
    const outcomes = await Promise.all([
      engine.checkNow(request(g, "second")),
      engine.checkNow(request(g, "first")),
    ]);
    expect(outcomes.map((x) => x.status)).toEqual(["succeeded", "succeeded"]);
    expect(counts()).toEqual({ reviews: 2, checks: 2, occurrences: 2 });
    expect(count("jobs", store.db)).toBe(1);
  });
  it("coalesces offline timer periods and does not run before the next due time", async () => {
    const g = goal();
    start(g);
    now += 20 * 60_000;
    await engine.tick();
    await engine.tick();
    expect(counts()).toEqual({ reviews: 1, checks: 1, occurrences: 1 });
    expect(engine.status({ id: g.id }).monitor.next_check_at).toBe(
      now + 60_000,
    );
    now += 60_000;
    await engine.tick();
    expect(counts().checks).toBe(2);
  });
  it("persists explicit monitoring configuration across host restart", async () => {
    const g = goal();
    start(g);
    await reopen();
    await engine.tick();
    expect(counts().checks).toBe(1);
    expect(engine.status({ id: g.id }).monitor.enabled).toBe(1);
  });
  it("suppresses new occurrences when the lifetime goal budget is exhausted", async () => {
    const g = goal({ budgetPolicy: { maxRuns: 1 } });
    start(g);
    for (let i = 0; i < 3; i++) {
      await engine.tick();
      now += 60_000;
    }
    expect(counts()).toEqual({ reviews: 1, checks: 1, occurrences: 1 });
    expect(engine.status({ id: g.id })).toMatchObject({
      executionState: "blocked",
      blockedReason: "GOAL_MONITOR_BUDGET_EXHAUSTED",
    });
    await expect(engine.checkNow(request(g, "new"))).rejects.toThrow(
      "GOAL_MONITOR_BUDGET_EXHAUSTED",
    );
    await reopen();
    expect(() => start(g)).toThrow("GOAL_MONITOR_BUDGET_EXHAUSTED");
  });
  it("suppresses expired timers before enqueue and cannot start an expired goal", async () => {
    const g = goal({ expiresAt: new Date(now + 1000).toISOString() });
    start(g);
    now += 1000;
    await engine.tick();
    now += 60_000;
    await engine.tick();
    expect(counts().occurrences).toBe(0);
    expect(engine.status({ id: g.id }).blockedReason).toBe(
      "GOAL_MONITOR_EXPIRED",
    );
    expect(() => start(g)).toThrow("GOAL_MONITOR_EXPIRED");
  });
  function reserveUsage(g, operationId, extra = {}) {
    return db
      .transaction(() =>
        engine.state.usageLedger.reserve({
          goal: g,
          actor: owner,
          operationId,
          ...extra,
        }),
      )
      .immediate();
  }
  function settleUsage(g, operationId, status, usage = null) {
    return db
      .transaction(() =>
        engine.state.usageLedger.settle({
          goalId: g.id,
          actor: owner,
          operationId,
          status,
          usage,
        }),
      )
      .immediate();
  }
  it("shares lifetime runs with actions and blocks previously queued checks", async () => {
    const g = goal({ budgetPolicy: { maxRuns: 1 } });
    start(g);
    queue(g);
    reserveUsage(g, "action");
    await engine.tick();
    expect(counts()).toEqual({ reviews: 0, checks: 0, occurrences: 1 });
    expect(engine.status({ id: g.id })).toMatchObject({
      blockedReason: "GOAL_MONITOR_BUDGET_EXHAUSTED",
      usage: { totalRuns: 1, checks: 0, reservedRuns: 1 },
    });
    settleUsage(g, "action", "released");
    expect((await engine.checkNow(request(g, "after-release"))).status).toBe(
      "succeeded",
    );
    expect(() => reserveUsage(g, "another-action")).toThrow(
      "GOAL_USAGE_BUDGET_EXHAUSTED",
    );
  });
  it("shows partial unknown model usage and blocks finite budget monitoring across restart", async () => {
    const g = goal({
      budgetPolicy: { maxTokens: 100, maxCostUsd: 2, maxTimeMs: 100 },
    });
    start(g);
    reserveUsage(g, "model", {
      domain: "model",
      estimate: { runs: 1, tokens: 20, costUsd: 1, elapsedMs: 10 },
    });
    settleUsage(g, "model", "unknown", {
      runs: 1,
      tokens: 10,
      costUsd: 0.5,
      elapsedMs: 5,
    });
    await reopen();
    await engine.tick();
    expect(counts()).toEqual({ reviews: 0, checks: 0, occurrences: 0 });
    expect(engine.status({ id: g.id })).toMatchObject({
      blockedReason: "GOAL_USAGE_UNKNOWN",
      usage: {
        modelTokens: null,
        modelCostUsd: null,
        elapsedMs: null,
        knownModelTokens: 10,
        knownModelCostUsd: 0.5,
        knownElapsedMs: 5,
      },
    });
    await expect(engine.checkNow(request(g))).rejects.toThrow(
      "GOAL_USAGE_UNKNOWN",
    );
  });
  it.each(["maxTokens", "maxCostUsd"])(
    "blocks monitoring after actual model usage exceeds %s",
    async (dimension) => {
      const g = goal({ budgetPolicy: { [dimension]: 1 } });
      reserveUsage(g, "model", {
        domain: "model",
        estimate: { runs: 1, tokens: 1, costUsd: 1, elapsedMs: 0 },
      });
      settleUsage(g, "model", "settled", {
        runs: 1,
        tokens: 2,
        costUsd: 2,
        elapsedMs: 0,
      });
      await expect(engine.checkNow(request(g))).rejects.toThrow(
        "GOAL_MONITOR_BUDGET_EXHAUSTED",
      );
      expect(counts().checks).toBe(0);
    },
  );
  it("includes held action time in the atomic monitoring duration check", async () => {
    const g = goal({ budgetPolicy: { maxTimeMs: 10 } });
    reserveUsage(g, "action", {
      estimate: { runs: 1, tokens: 0, costUsd: 0, elapsedMs: 8 },
    });
    const evaluate = engine.state.risk.evaluateInTransaction.bind(
      engine.state.risk,
    );
    vi.spyOn(engine.state.risk, "evaluateInTransaction").mockImplementation(
      (input) => {
        const result = evaluate(input);
        now += 3;
        return result;
      },
    );
    expect((await engine.checkNow(request(g))).status).toBe("dead_letter");
    expect(counts()).toEqual({ reviews: 0, checks: 0, occurrences: 1 });
    expect(engine.status({ id: g.id }).usage).toMatchObject({
      totalRuns: 1,
      reservedElapsedMs: 8,
      knownElapsedMs: 0,
    });
  });
  it("replays a committed check without extra debit after another domain exhausts the budget", async () => {
    const g = goal({ budgetPolicy: { maxRuns: 2 } });
    const first = await engine.checkNow(request(g));
    reserveUsage(g, "action");
    settleUsage(g, "action", "settled", {
      runs: 1,
      tokens: 0,
      costUsd: 0,
      elapsedMs: 2,
    });
    await reopen();
    const replay = await engine.checkNow(request(g));
    expect(replay.result).toEqual(first.result);
    expect(counts()).toEqual({ reviews: 1, checks: 1, occurrences: 1 });
    expect(engine.status({ id: g.id }).usage).toMatchObject({
      totalRuns: 2,
      checks: 1,
      knownElapsedMs: 2,
    });
  });
  it("enforces time budget on the actual atomic check and rolls back overruns", async () => {
    const g = goal({ budgetPolicy: { maxTimeMs: 5 } });
    const evaluate = engine.state.risk.evaluateInTransaction.bind(
      engine.state.risk,
    );
    vi.spyOn(engine.state.risk, "evaluateInTransaction").mockImplementation(
      (input) => {
        const result = evaluate(input);
        now += 6;
        return result;
      },
    );
    expect(await engine.checkNow(request(g))).toMatchObject({
      status: "dead_letter",
    });
    expect(counts()).toEqual({ reviews: 0, checks: 0, occurrences: 1 });
  });
  it("rolls back a review if the goal expires during its evaluation", async () => {
    const g = goal({ expiresAt: new Date(now + 10).toISOString() });
    const evaluate = engine.state.risk.evaluateInTransaction.bind(
      engine.state.risk,
    );
    vi.spyOn(engine.state.risk, "evaluateInTransaction").mockImplementation(
      (input) => {
        const result = evaluate(input);
        now += 10;
        return result;
      },
    );
    expect(await engine.checkNow(request(g))).toMatchObject({
      status: "dead_letter",
    });
    expect(counts().reviews).toBe(0);
  });
  it("cannot reuse a request for a revised goal definition", async () => {
    const g = goal();
    await engine.checkNow(request(g));
    const next = engine.state.goals.revise({
      id: g.id,
      expectedRevision: 1,
      patch: { objective: "Updated" },
    });
    await expect(engine.checkNow(request(next))).rejects.toThrow(
      "GOAL_MONITOR_REQUEST_VERSION_CONFLICT",
    );
    expect(counts().checks).toBe(1);
  });
  it("denies a queued check bound to a stale goal generation", async () => {
    const g = goal();
    queue(g);
    engine.state.goals.revise({
      id: g.id,
      expectedRevision: 1,
      patch: { objective: "Updated" },
    });
    await engine.tick();
    expect(counts().checks).toBe(0);
  });
  it.each(["actor", "owner", "organization", "workspace"])(
    "rechecks current %s before executing queued work",
    async (kind) => {
      const g = goal();
      queue(g);
      if (kind === "actor") actor = "did:other";
      if (kind === "owner")
        db.prepare("UPDATE projects SET user_id=?").run("did:other");
      if (kind === "organization")
        db.exec("INSERT INTO organization_projects VALUES ('p1','org1')");
      if (kind === "workspace")
        db.exec("INSERT INTO workspace_resources VALUES ('w1','project','p1')");
      await engine.tick();
      expect(counts().checks).toBe(0);
    },
  );
  it("waits with no scheduling when identity is locked", async () => {
    const g = goal();
    start(g);
    actor = null;
    expect(await engine.tick()).toMatchObject({
      status: "waiting",
      reason: "identity-locked",
    });
    expect(counts().occurrences).toBe(0);
    await expect(engine.checkNow(request(g))).rejects.toThrow(
      "GOAL_IDENTITY_REQUIRED",
    );
  });
  it("uses existing global policy revocation and suppresses disabled timers", async () => {
    const g = goal();
    start(g);
    policy({ enabled: false });
    await engine.tick();
    now += 60_000;
    await engine.tick();
    expect(counts().occurrences).toBe(0);
    expect(await engine.checkNow(request(g))).toMatchObject({
      status: "dead_letter",
    });
    expect(counts().checks).toBe(0);
  });
  it("creates a newly bound manual intent after a policy change and keeps old replay identity", async () => {
    const g = goal();
    const first = await engine.checkNow(request(g));
    policy({ maxRuns: 200, maxUnits: 200 });
    const fresh = await engine.checkNow(request(g, "new-policy"));
    expect(fresh.status).toBe("succeeded");
    expect(fresh.occurrenceId).not.toBe(first.occurrenceId);
    expect(await engine.checkNow(request(g))).toMatchObject({
      occurrenceId: first.occurrenceId,
      result: first.result,
    });
    expect(counts().checks).toBe(2);
    expect(count("jobs", store.db)).toBe(2);
  });
  it("suppresses global budget-exhausted timer queues and resumes when the window resets", async () => {
    const g = goal();
    policy({ maxRuns: 1, maxUnits: 1, windowMs: 24 * 60 * 60 * 1000 });
    start(g);
    for (let i = 0; i < 3; i++) {
      await engine.tick();
      now += 60_000;
    }
    expect(counts()).toEqual({ reviews: 1, checks: 1, occurrences: 1 });
    expect(engine.status({ id: g.id })).toMatchObject({
      executionState: "blocked",
      blockedReason: "scheduler_authority_budget_exhausted",
    });
    now += 24 * 60 * 60 * 1000;
    await engine.tick();
    expect(counts().checks).toBe(2);
  });
  it("suppresses capability-denied timer queues and exposes their blocked reason", async () => {
    const g = goal();
    policy({ capabilities: ["other.read"] });
    start(g);
    await engine.tick();
    now += 60_000;
    await engine.tick();
    expect(counts().occurrences).toBe(0);
    expect(engine.status({ id: g.id })).toMatchObject({
      executionState: "blocked",
      blockedReason: "scheduler_authority_permission_denied",
    });
  });
  it("rechecks global authorization after reservation and before the domain commit", async () => {
    const g = goal();
    const evaluate = engine.state.risk.evaluateInTransaction.bind(
      engine.state.risk,
    );
    vi.spyOn(engine.state.risk, "evaluateInTransaction").mockImplementation(
      (input) => {
        const result = evaluate(input);
        policy({ enabled: false });
        return result;
      },
    );
    expect(await engine.checkNow(request(g))).toMatchObject({
      status: "dead_letter",
    });
    expect(counts().reviews).toBe(0);
  });
  it("records and rolls back both evidence tables on a domain storage failure", async () => {
    const g = goal();
    db.exec(
      "CREATE TRIGGER refuse_check BEFORE INSERT ON cc_project_goal_checks BEGIN SELECT RAISE(ABORT,'disk failure'); END",
    );
    expect(await engine.checkNow(request(g))).toMatchObject({
      status: "dead_letter",
    });
    expect(counts().reviews).toBe(0);
    expect(counts().checks).toBe(0);
  });
  it("rolls back domain evidence when the scheduler fence is lost", async () => {
    const g = goal();
    const evaluate = engine.state.risk.evaluateInTransaction.bind(
      engine.state.risk,
    );
    vi.spyOn(engine.state.risk, "evaluateInTransaction").mockImplementation(
      (input) => {
        const result = evaluate(input);
        now += 60_001;
        return result;
      },
    );
    await expect(engine.checkNow(request(g))).rejects.toMatchObject({
      code: "SCHEDULER_LEASE_LOST",
    });
    expect(counts().reviews).toBe(0);
    expect(counts().checks).toBe(0);
  });
  it("recovers a committed check after settlement failure without another review or debit", async () => {
    const g = goal({ budgetPolicy: { maxRuns: 1 } });
    const settlement = vi.spyOn(store, "settle").mockImplementation(() => {
      throw new Error("crash before scheduler settlement");
    });
    await expect(engine.checkNow(request(g))).rejects.toThrow(
      "crash before scheduler settlement",
    );
    const reviewId = engine.status({ id: g.id }).history[0].reviewId;
    settlement.mockRestore();
    await reopen();
    now += 60_001;
    expect(await engine.checkNow(request(g))).toMatchObject({
      status: "succeeded",
      result: { reviewId },
    });
    expect(counts()).toEqual({ reviews: 1, checks: 1, occurrences: 1 });
    expect(
      store.db
        .prepare("SELECT SUM(runs) AS total FROM scheduler_authority_usage")
        .get().total,
    ).toBe(1);
  });
  it.each(["result", "payload", "metadata", "review", "size"])(
    "rejects corrupted %s on history and terminal replay",
    async (kind) => {
      const g = goal();
      const first = await engine.checkNow(request(g));
      if (kind === "result")
        db.prepare("UPDATE cc_project_goal_checks SET result_json=?").run(
          JSON.stringify({ ...first.result, riskTaskCount: 999 }),
        );
      if (kind === "payload")
        db.exec("UPDATE cc_project_goal_checks SET request_digest='bad'");
      if (kind === "metadata")
        db.exec("UPDATE cc_project_goal_checks SET control_generation=999");
      if (kind === "review")
        db.exec("UPDATE cc_project_risk_reviews SET content_digest='bad'");
      if (kind === "size")
        db.prepare("UPDATE cc_project_goal_checks SET result_json=?").run(
          "x".repeat(4097),
        );
      expect(() => engine.status({ id: g.id })).toThrow();
      await expect(engine.checkNow(request(g))).rejects.toThrow();
      expect(counts().reviews).toBe(1);
    },
  );
  it("rechecks historical task access even for an already settled manual result", async () => {
    const g = goal();
    await engine.checkNow(request(g));
    db.exec("UPDATE project_tasks SET workspace_id='w1'");
    await expect(engine.checkNow(request(g))).rejects.toThrow();
    expect(() => engine.status({ id: g.id })).toThrow();
  });
  it("pauses goal generation and monitoring configuration atomically", async () => {
    const g = goal();
    start(g);
    queue(g);
    const paused = engine.stop({ id: g.id, expectedRevision: g.revision });
    expect(paused).toMatchObject({
      goal: { status: "paused", revision: 2, controlGeneration: 1 },
      monitor: { enabled: 0 },
      executionState: "paused",
    });
    await engine.tick();
    expect(counts().checks).toBe(0);
    expect(() => engine.stop({ id: g.id, expectedRevision: 1 })).toThrow(
      "GOAL_REVISION_CONFLICT",
    );
  });
  it("rolls back monitoring disable if the paused goal update cannot commit", () => {
    const g = goal();
    start(g);
    db.exec(
      "CREATE TRIGGER refuse_pause BEFORE UPDATE ON cc_project_goals BEGIN SELECT RAISE(ABORT,'disk failure'); END",
    );
    expect(() => engine.stop({ id: g.id, expectedRevision: 1 })).toThrow(
      "GOAL_STORAGE_FAILED",
    );
    expect(engine.status({ id: g.id })).toMatchObject({
      goal: { status: "active", revision: 1 },
      monitor: { enabled: 1 },
    });
  });
  it("does not claim stop confirmation while an earlier occurrence is still claimed", () => {
    const g = goal();
    const occurrence = queue(g);
    store.claimOccurrence({
      occurrenceId: occurrence.id,
      ownerId: "other-host",
      leaseMs: 60_000,
    });
    expect(engine.stop({ id: g.id, expectedRevision: 1 }).executionState).toBe(
      "pause-requested",
    );
  });
  it("filters activity by goal before the global enumeration limit", () => {
    const g = goal();
    const own = queue(g);
    store.claimOccurrence({
      occurrenceId: own.id,
      ownerId: "other-host",
      leaseMs: 60_000,
    });
    const definition = store.getJob(own.jobId);
    now++;
    for (let i = 0; i < 201; i++) {
      const job = store.createJob({
        id: `unrelated-${i}`,
        kind: definition.kind,
        trigger: definition.trigger,
        payload: definition.payload,
        authority: definition.authority,
        maxAttempts: 3,
      });
      const occurrence = store.enqueueOccurrence({
        jobId: job.id,
        scheduledFor: now,
        triggerKey: "manual",
      });
      store.claimOccurrence({
        occurrenceId: occurrence.id,
        ownerId: "unrelated-host",
        leaseMs: 60_000,
      });
    }
    expect(engine.stop({ id: g.id, expectedRevision: 1 })).toMatchObject({
      executionState: "pause-requested",
      active: [{ id: own.id }],
    });
  });
  it("rechecks identity inside the domain evidence transaction", async () => {
    const g = goal();
    const evaluate = engine.state.risk.evaluateInTransaction.bind(
      engine.state.risk,
    );
    vi.spyOn(engine.state.risk, "evaluateInTransaction").mockImplementation(
      (input) => {
        const result = evaluate(input);
        actor = "did:other";
        return result;
      },
    );
    expect(await engine.checkNow(request(g))).toMatchObject({
      status: "dead_letter",
    });
    expect(counts().reviews).toBe(0);
    expect(counts().checks).toBe(0);
  });
  it("does not let fifty revoked monitors starve a later owned project", async () => {
    for (let i = 0; i < 50; i++) start(goal());
    db.prepare("INSERT INTO projects VALUES (?,?,?,?,0)").run(
      "p2",
      owner,
      "active",
      instant,
    );
    const later = engine.state.goals.create({
      projectId: "p2",
      objective: "Later owned goal",
    });
    start(later);
    db.prepare(
      "UPDATE cc_project_goal_monitors SET next_check_at=? WHERE goal_id=?",
    ).run(now + 1, later.id);
    db.prepare("UPDATE projects SET user_id=? WHERE id='p1'").run("did:other");
    now++;
    await engine.tick();
    await engine.tick();
    expect(engine.status({ id: later.id }).usage.checks).toBe(1);
  });
  it("drains a pending manual authorization before closing and shares its close promise", async () => {
    const g = goal();
    let entered, release;
    const ready = new Promise((resolve) => {
      entered = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const original = engine.runtime.authorize;
    engine.runtime.authorize = async (context) => {
      entered();
      await gate;
      return original(context);
    };
    const checking = engine.checkNow(request(g));
    await ready;
    const closing = engine.close();
    expect(engine.close()).toBe(closing);
    expect(store.closed).toBe(false);
    release();
    await checking;
    await closing;
    expect(store.closed).toBe(true);
    expect(() => engine.status({ id: g.id })).toThrow(
      "GOAL_MONITOR_HOST_CLOSED",
    );
    expect(count("cc_project_goal_checks")).toBe(0);
  });
  it("aborts and drains the background loop during shutdown", async () => {
    const g = goal();
    start(g);
    const running = engine.startBackground({ intervalMs: 250 });
    await engine.close();
    await expect(running).resolves.toMatchObject({ status: "aborted" });
    expect(store.closed).toBe(true);
  });
  it("requires an owning native transaction for trusted review composition", () => {
    expect(() =>
      engine.state.risk.evaluateInTransaction({ projectId: "p1" }),
    ).toThrow("PROJECT_RISK_TRANSACTION_REQUIRED");
    expect(() =>
      engine.state.risk.getReviewInTransaction({ reviewId: "missing" }),
    ).toThrow("PROJECT_RISK_TRANSACTION_REQUIRED");
  });
  it.each([0, 59_999, 604_800_001, NaN])(
    "rejects unsupported check intervals %s",
    (intervalMs) => {
      const g = goal();
      expect(() =>
        engine.start({ id: g.id, expectedRevision: 1, intervalMs }),
      ).toThrow();
      expect(count("cc_project_goal_monitors")).toBe(0);
    },
  );
});
