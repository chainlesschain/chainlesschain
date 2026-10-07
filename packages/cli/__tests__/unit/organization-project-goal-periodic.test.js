import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  OrganizationProjectAuthority,
} = require("../../../session-core/lib/organization-project-authority");
const {
  OrganizationProjectGoalService,
} = require("../../../session-core/lib/organization-project-goal-service");
const {
  OrganizationProjectGoalMonitoringEngine,
} = require("../../../session-core/lib/organization-project-goal-monitoring");
const {
  PersonalProjectGoalService,
} = require("../../../session-core/lib/project-goal-service");
const {
  GoalUsageLedger,
} = require("../../../session-core/lib/goal-usage-ledger");
const {
  createGoalRecord,
  validateGoalRecord,
} = require("../../../session-core/lib/goal-contract");
const {
  openSchedulerStore,
} = require("../../../session-core/lib/scheduler-store");
const {
  digestBusinessObjectContent: digest,
} = require("../../../session-core/lib/business-object-contract");

describe("organization periodic monitoring consent and scheduler recovery", () => {
  const owner = "did:owner",
    member = "did:member",
    second = "did:second",
    reader = "did:reader",
    riskReader = "did:risk-reader",
    updater = "did:updater";
  let directory,
    db,
    store,
    engine,
    goals,
    authority,
    actor,
    now,
    permissions,
    personal,
    personalGoal,
    generation;
  function open() {
    db = new Database(join(directory, "domain.db"));
    db.pragma("foreign_keys=ON");
    authority = new OrganizationProjectAuthority({
      db,
      getActor: () => actor,
      now: () => now,
      confirm: async () => true,
    });
    store = openSchedulerStore({
      file: join(directory, "scheduler.db"),
      Database,
      protectStorage: () => true,
      clock: () => now,
    });
    engine = new OrganizationProjectGoalMonitoringEngine({
      db,
      store,
      authority,
      getActor: () => actor,
      clock: () => now,
      leaseMs: 60000,
      getAuthenticationGeneration: () => generation,
    });
    goals = engine.state.goals;
  }
  async function attest() {
    actor = owner;
    const input = { orgId: "org1", permissions };
    await authority.attestPolicy({
      ...input,
      expectedDigest: authority.previewPolicy(input).digest,
    });
    actor = member;
  }
  function create(extra = {}) {
    const input = {
      projectId: "p1",
      requestId: "create-1",
      objective: "Track delivery risk",
      ...extra,
    };
    return goals.create(input, {
      expectedAuthority: goals.prepareCreate(input).authority,
    }).goal;
  }
  function revise(goal, patch, requestId = "revise-1") {
    const input = {
      id: goal.id,
      expectedRevision: goal.revision,
      requestId,
      patch,
    };
    return goals.revise(input, {
      expectedAuthority: goals.prepareRevise(input).authority,
    }).goal;
  }
  const checkInput = (goal, requestId = "check-1") => ({
    id: goal.id,
    expectedRevision: goal.revision,
    requestId,
  });
  const count = (table) =>
    db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "cc-organization-goal-"));
    now = 1791244800000;
    actor = owner;
    generation = 1;
    db = new Database(join(directory, "domain.db"));
    db.exec(`CREATE TABLE organization_info(org_id TEXT PRIMARY KEY,org_did TEXT,owner_did TEXT);
      CREATE TABLE organization_members(id TEXT PRIMARY KEY,org_id TEXT,member_did TEXT,role TEXT,status TEXT);
      CREATE TABLE organization_projects(id TEXT PRIMARY KEY,org_id TEXT,owner_did TEXT);
      CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,due_date INTEGER,blocked_by TEXT,description TEXT,org_id TEXT,workspace_id TEXT);
      CREATE TABLE workspace_resources(workspace_id TEXT,resource_type TEXT,resource_id TEXT);
      INSERT INTO organization_info VALUES('org1','did:org:1','${owner}');
      INSERT INTO organization_projects VALUES('op1','org1','${owner}');
      INSERT INTO projects VALUES('p1','${owner}','active',10,0);
      INSERT INTO project_tasks VALUES('t1','p1','pending',10,0,1,NULL,'Original',NULL,NULL);`);
    for (const [index, did] of [
      owner,
      member,
      second,
      reader,
      riskReader,
      updater,
    ].entries())
      db.prepare(
        "INSERT INTO organization_members VALUES(?,'org1',?,?,'active')",
      ).run(`m${index}`, did, did === owner ? "owner" : "member");
    db.close();
    open();
    personal = new PersonalProjectGoalService({
      db,
      getActor: () => actor,
      now: () => new Date(now).toISOString(),
    });
    personalGoal = personal.create({
      projectId: "p1",
      objective: "Private before migration",
    });
    permissions = [owner, member, second, reader, riskReader, updater].map(
      (actorDid) => ({
        actorDid,
        projectId: "p1",
        expiresAt: now + 86400000,
        permissions:
          actorDid === reader
            ? ["goal.read"]
            : actorDid === riskReader
              ? ["goal.read", "risk.read"]
              : actorDid === updater
                ? ["goal.read", "goal.update"]
                : [
                    "goal.read",
                    "goal.create",
                    "goal.update",
                    "goal.check",
                    "goal.monitor",
                    "risk.read",
                    "risk.evaluate",
                  ],
      }),
    );
    await attest();
    actor = owner;
    const input = {
      orgId: "org1",
      projectId: "p1",
      organizationProjectId: "op1",
    };
    await authority.bindProject({
      ...input,
      expectedDigest: authority.previewBinding(input).digest,
    });
    actor = member;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await engine?.close();
    store?.close();
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function startInput(goal, requestId = "start-1", extra = {}) {
    return {
      id: goal.id,
      expectedRevision: goal.revision,
      requestId,
      intervalMs: 60000,
      expiresAt: now + 3600000,
      ...extra,
    };
  }
  function start(goal, requestId = "start-1", extra = {}) {
    const input = startInput(goal, requestId, extra),
      prepared = engine.prepareStartMonitoring(input);
    return engine.startMonitoring(input, {
      expectedAuthority: prepared.authority,
      expectedMonitorId: prepared.expectedMonitorId,
    });
  }
  function stop(goal, monitor, mode = "periodic", requestId = "stop-1") {
    const input = { id: goal.id, monitorId: monitor.id, mode, requestId },
      prepared = engine.prepareStopMonitoring(input);
    return engine.stopMonitoring(input, {
      expectedAuthority: prepared.authority,
    });
  }
  const status = (goal) => engine.status({ id: goal.id }).monitor;
  const due = async () => {
    now += 60000;
    return engine.tick();
  };

  it("runs as the actual enabler and permits source updates between periodic reads", async () => {
    const goal = create();
    actor = second;
    const { monitor } = start(goal);
    expect(monitor).toMatchObject({
      executorDid: second,
      enabled: true,
      state: "waiting",
      resumeSameIdentity: true,
    });
    expect((await engine.tick()).checks).toHaveLength(0);
    db.prepare(
      "UPDATE project_tasks SET description='Changed',updated_at=11 WHERE id='t1'",
    ).run();
    expect((await due()).checks[0]).toMatchObject({
      status: "succeeded",
      monitorId: monitor.id,
    });
    const history = engine.history({ id: goal.id }).checks;
    expect(history).toHaveLength(1);
    expect(history[0].actorDid).toBe(second);
    expect(goals.get({ id: goal.id }).ownerRef).toBe(member);
    db.prepare("UPDATE projects SET updated_at=12 WHERE id='p1'").run();
    expect((await due()).checks[0].status).toBe("succeeded");
  });
  it("requires independent goal.monitor and all read/evaluate grants", async () => {
    const goal = create();
    permissions.find((p) => p.actorDid === member).permissions = [
      "goal.read",
      "goal.check",
      "risk.read",
      "risk.evaluate",
    ];
    await attest();
    expect(() => start(goal)).toThrow(/ORG_AUTH/);
    permissions.find((p) => p.actorDid === member).permissions = [
      "goal.read",
      "goal.monitor",
      "risk.read",
    ];
    await attest();
    expect(() => start(goal)).toThrow(/ORG_AUTH/);
    actor = reader;
    expect(() => start(goal)).toThrow(/ORG_AUTH/);
  });
  it.each([0, 59999, 86400001, 1.5])(
    "rejects invalid interval %s before consent",
    (intervalMs) => {
      expect(() => start(create(), "bad", { intervalMs })).toThrow(
        "GOAL_MONITOR_INVALID_REQUEST",
      );
      expect(count("cc_organization_project_goal_monitor_consents")).toBe(0);
    },
  );
  it("caps consent at 24h and at the goal deadline", () => {
    const goal = create();
    for (const expiresAt of [now, now - 1, now + 86400001])
      expect(() => start(goal, "bad", { expiresAt })).toThrow(
        "GOAL_MONITOR_INVALID_EXPIRY",
      );
    const short = create({
      requestId: "short",
      expiresAt: new Date(now + 600000).toISOString(),
    });
    expect(() => start(short)).toThrow("GOAL_MONITOR_INVALID_EXPIRY");
  });
  it("replaces one shared monitor and never re-enables an old start nonce", async () => {
    const goal = create(),
      originalInput = startInput(goal);
    const first = start(goal).monitor;
    actor = second;
    const secondMonitor = start(goal, "start-2").monitor;
    expect(status(goal).id).toBe(secondMonitor.id);
    expect(secondMonitor.generation).toBe(first.generation + 1);
    actor = member;
    expect(engine.startMonitoring(originalInput)).toMatchObject({
      replayed: true,
      monitor: { id: first.id, enabled: false, state: "replaced" },
    });
    expect((await due()).checks).toHaveLength(0);
    actor = second;
    expect((await engine.tick()).checks).toHaveLength(1);
    expect(count("cc_organization_project_goal_checks")).toBe(1);
  });
  it("fences start confirmation against replacement, source change, and session ABA", () => {
    const goal = create(),
      input = startInput(goal),
      prepared = engine.prepareStartMonitoring(input);
    start(goal, "intervening");
    expect(() =>
      engine.startMonitoring(input, {
        expectedAuthority: prepared.authority,
        expectedMonitorId: prepared.expectedMonitorId,
      }),
    ).toThrow("GOAL_MONITOR_VERSION_CONFLICT");
    const next = startInput(goal, "next"),
      nextPrepared = engine.prepareStartMonitoring(next);
    db.prepare(
      "UPDATE projects SET updated_at=updated_at+1 WHERE id='p1'",
    ).run();
    expect(() =>
      engine.startMonitoring(next, {
        expectedAuthority: nextPrepared.authority,
        expectedMonitorId: nextPrepared.expectedMonitorId,
      }),
    ).toThrow(/ORG_AUTH|GOAL_AUTHORITY/);
    const fresh = engine.prepareStartMonitoring(next);
    expect(() =>
      engine.startMonitoring(next, {
        expectedAuthority: fresh.authority,
        expectedMonitorId: fresh.expectedMonitorId,
        guard: () => {
          generation++;
          return actor;
        },
      }),
    ).toThrow("GOAL_IDENTITY_CHANGED");
  });
  it("coalesces all overdue intervals to one durable request", async () => {
    const goal = create();
    start(goal);
    now += 25 * 60000;
    expect((await engine.tick()).checks).toHaveLength(1);
    expect((await engine.tick()).checks).toHaveLength(0);
    expect(count("cc_organization_project_goal_manual_requests")).toBe(1);
    expect(status(goal).nextCheckAt).toBeGreaterThan(now);
  });
  it("suspends other identities and resumes the fixed consent on a new same-DID login", async () => {
    const goal = create();
    start(goal);
    now += 60000;
    actor = second;
    expect((await engine.tick()).checks).toHaveLength(0);
    actor = null;
    expect((await engine.tick()).suspended).toBe(true);
    actor = member;
    generation++;
    expect((await engine.tick()).checks[0].status).toBe("succeeded");
  });
  it("detects session ABA during evaluation and rolls back domain writes", async () => {
    const goal = create();
    start(goal);
    const evaluate = engine.risk.evaluateInTransaction.bind(engine.risk);
    vi.spyOn(engine.risk, "evaluateInTransaction").mockImplementation(
      (input) => {
        const result = evaluate(input);
        generation++;
        return result;
      },
    );
    const outcome = await due();
    expect(outcome.suspended).toBe(true);
    expect(count("cc_organization_project_goal_checks")).toBe(0);
    expect(count("cc_organization_project_risk_reviews")).toBe(0);
  });
  it("requires a fresh native start after policy renewal even with the same grants", async () => {
    const goal = create();
    start(goal);
    await attest();
    expect((await due()).blocked).toHaveLength(1);
    expect(status(goal)).toMatchObject({ enabled: false, state: "blocked" });
    await attest();
    expect((await due()).checks).toHaveLength(0);
    start(goal, "renewed");
    expect((await due()).checks[0].status).toBe("succeeded");
  });
  it("keeps membership ABA revoked even after policy repair", async () => {
    const goal = create();
    start(goal);
    db.prepare(
      "UPDATE organization_members SET status='inactive' WHERE member_did=?",
    ).run(member);
    db.prepare(
      "UPDATE organization_members SET status='active' WHERE member_did=?",
    ).run(member);
    expect((await due()).blocked).toHaveLength(1);
    await attest();
    expect((await due()).checks).toHaveLength(0);
    expect(status(goal).enabled).toBe(false);
  });
  it.each([
    { title: "Revised" },
    { status: "paused" },
    { status: "abandoned" },
  ])("blocks old consent after goal revision %o", async (patch) => {
    const goal = create();
    start(goal);
    revise(goal, patch);
    expect((await due()).checks).toHaveLength(0);
    expect(status(goal)).toMatchObject({ enabled: false, state: "blocked" });
  });
  it("expires durably and cannot be revived by replay", async () => {
    const goal = create(),
      input = startInput(goal, "short", { expiresAt: now + 60000 });
    const prepared = engine.prepareStartMonitoring(input);
    engine.startMonitoring(input, {
      expectedAuthority: prepared.authority,
      expectedMonitorId: prepared.expectedMonitorId,
    });
    expect((await due()).checks).toHaveLength(0);
    expect(status(goal).state).toBe("expired");
    expect(engine.startMonitoring(input).monitor.enabled).toBe(false);
  });
  it("retains shared usage across replacing executors and blocks exhausted starts", async () => {
    const goal = create({ budgetPolicy: { maxRuns: 1 } });
    start(goal);
    expect((await due()).checks[0].status).toBe("succeeded");
    actor = second;
    expect(() => start(goal, "replacement")).toThrow(/BUDGET/);
    expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(1);
  });
  it("graceful stop drains the admitted periodic request without another interval", async () => {
    const goal = create(),
      monitor = start(goal).monitor;
    now += 60000;
    const operation = engine.tick();
    expect(stop(goal, monitor).monitor).toMatchObject({
      enabled: false,
      state: "stopped",
      activeOccurrence: { status: "pending" },
    });
    expect((await operation).checks[0].status).toBe("succeeded");
    expect((await due()).checks).toHaveLength(0);
    expect(status(goal).activeOccurrence).toBeNull();
  });
  it("strong stop fences only this monitor, leaving independent manual requests intact", async () => {
    const goal = create(),
      monitor = start(goal).monitor;
    now += 60000;
    const periodic = engine.tick(),
      manual = engine.checkNow(checkInput(goal));
    stop(goal, monitor, "abort");
    await periodic;
    expect((await manual).status).toBe("succeeded");
    expect(count("cc_organization_project_goal_checks")).toBe(1);
    expect(engine.history({ id: goal.id }).checks[0].requestId).toBe("check-1");
    await engine.tick();
    expect(status(goal)).toMatchObject({
      state: "stopped",
      activeOccurrence: null,
    });
  });
  it("recovers a durable hard stop after a crashed claim without executing the check", async () => {
    const goal = create(),
      monitor = start(goal).monitor;
    now += 60000;
    const claim = store.claimOccurrence.bind(store);
    vi.spyOn(store, "claimOccurrence").mockImplementationOnce((input) => {
      claim({ ...input, ownerId: "crashed-owner" });
      return null;
    });
    expect((await engine.tick()).checks[0].status).toBe("busy");
    stop(goal, monitor, "abort");
    expect(status(goal).activeOccurrence.status).toBe("running");
    await engine.close();
    store.close();
    db.close();
    open();
    expect((await engine.tick()).checks).toHaveLength(0);
    expect(status(goal).activeOccurrence).not.toBeNull();
    now += 60001;
    await engine.tick();
    expect(status(goal)).toMatchObject({
      state: "stopped",
      activeOccurrence: null,
    });
    expect(count("cc_organization_project_goal_checks")).toBe(0);
    expect(count("cc_organization_project_risk_reviews")).toBe(0);
  });
  it("fences stale stop confirmation and reads its receipt without stopping a replacement", () => {
    const goal = create(),
      first = start(goal).monitor;
    const input = {
        id: goal.id,
        monitorId: first.id,
        mode: "abort",
        requestId: "stop-1",
      },
      prepared = engine.prepareStopMonitoring(input);
    start(goal, "replace-1");
    expect(() =>
      engine.stopMonitoring(input, { expectedAuthority: prepared.authority }),
    ).toThrow("GOAL_MONITOR_VERSION_CONFLICT");
    const current = status(goal);
    stop(goal, current, "abort", "stop-2");
    const replay = {
      id: goal.id,
      monitorId: current.id,
      mode: "abort",
      requestId: "stop-2",
    };
    const replacement = start(goal, "replace-2").monitor;
    expect(engine.stopMonitoring(replay)).toMatchObject({
      replayed: true,
      monitor: { id: current.id, enabled: false },
    });
    expect(status(goal)).toMatchObject({ id: replacement.id, enabled: true });
  });
  it("rejects changed start/stop nonce contents and renderer-forged periodic request IDs", () => {
    const goal = create(),
      monitor = start(goal).monitor;
    expect(() => start(goal, "start-1", { intervalMs: 120000 })).toThrow(
      "GOAL_MONITOR_REQUEST_VERSION_CONFLICT",
    );
    stop(goal, monitor);
    expect(() => stop(goal, monitor, "abort")).toThrow(
      "GOAL_MONITOR_REQUEST_VERSION_CONFLICT",
    );
    expect(() =>
      engine.checkNow(checkInput(goal, "org-periodic:forged")),
    ).toThrow("GOAL_MONITOR_INVALID_REQUEST");
  });
  it("recovers the same durable pending nonce after enqueue projection failure and reopen", async () => {
    const goal = create();
    start(goal);
    now += 60000;
    vi.spyOn(store, "enqueueOccurrenceOncePerTrigger").mockImplementationOnce(
      () => {
        const e = new Error("projection failed");
        e.code = "SCHEDULER_STORAGE_FAILED";
        throw e;
      },
    );
    expect((await engine.tick()).blocked[0].recoverable).toBe(true);
    const pending = status(goal).activeOccurrence.requestId;
    await engine.close();
    store.close();
    db.close();
    open();
    now += 5 * 60000;
    expect((await engine.tick()).checks[0].status).toBe("succeeded");
    expect(engine.history({ id: goal.id }).checks[0].requestId).toBe(pending);
    expect(count("cc_organization_project_goal_manual_requests")).toBe(1);
    expect((await engine.tick()).checks).toHaveLength(0);
  });
  it("does not skip an unresolved occurrence by allocating a newer tick after source change", async () => {
    const goal = create();
    start(goal);
    now += 60000;
    vi.spyOn(store, "enqueueOccurrenceOncePerTrigger").mockImplementationOnce(
      () => {
        const e = new Error("projection failed");
        e.code = "SCHEDULER_STORAGE_FAILED";
        throw e;
      },
    );
    await engine.tick();
    db.prepare(
      "UPDATE projects SET updated_at=updated_at+1 WHERE id='p1'",
    ).run();
    now += 600000;
    expect((await engine.tick()).checks).toHaveLength(0);
    expect(status(goal).enabled).toBe(false);
    expect(count("cc_organization_project_goal_manual_requests")).toBe(1);
    expect(count("cc_organization_project_goal_checks")).toBe(0);
  });
  it("recovers committed domain evidence after lost settlement without another review or charge", async () => {
    const goal = create();
    start(goal);
    now += 60000;
    const original = store.settle.bind(store);
    vi.spyOn(store, "settle").mockImplementation(() => {
      throw Object.assign(new Error("settlement lost"), {
        code: "SCHEDULER_STORAGE_FAILED",
      });
    });
    await engine.tick();
    expect(count("cc_organization_project_goal_checks")).toBe(1);
    expect(status(goal).activeOccurrence).not.toBeNull();
    store.settle.mockImplementation(original);
    db.prepare(
      "UPDATE projects SET updated_at=updated_at+1 WHERE id='p1'",
    ).run();
    const recovered = await engine.tick();
    expect(recovered.checks[0]).toMatchObject({
      status: "succeeded",
      replayed: true,
    });
    expect(count("cc_organization_project_goal_checks")).toBe(1);
    expect(count("cc_organization_project_risk_reviews")).toBe(1);
    expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(1);
    expect(status(goal).activeOccurrence).toBeNull();
  });
  it("waits for an existing scheduler lease then recovers the same occurrence", async () => {
    const goal = create();
    start(goal);
    now += 60000;
    const claim = store.claimOccurrence.bind(store);
    let stolen;
    vi.spyOn(store, "claimOccurrence").mockImplementationOnce((input) => {
      stolen = claim({ ...input, ownerId: "crashed-owner" });
      return null;
    });
    expect((await engine.tick()).checks[0].status).toBe("busy");
    const requestId = status(goal).activeOccurrence.requestId;
    expect(stolen).toBeTruthy();
    expect((await engine.tick()).checks[0].status).toBe("busy");
    now += 60001;
    expect((await engine.tick()).checks[0].status).toBe("succeeded");
    expect(engine.history({ id: goal.id }).checks[0].requestId).toBe(requestId);
    expect(count("cc_organization_project_goal_manual_requests")).toBe(1);
  });
  it("serves monitor status to goal-only readers without leaking risk history", async () => {
    const goal = create();
    start(goal);
    await due();
    actor = reader;
    expect(status(goal)).toMatchObject({
      executorDid: member,
      state: "waiting",
    });
    expect(() => engine.history({ id: goal.id })).toThrow(/ORG_AUTH/);
  });
  it("starts its main-process loop without a renderer and close leaves the caller store open", async () => {
    const goal = create();
    start(goal);
    now += 60000;
    await engine.startBackground();
    await engine.tick();
    expect(count("cc_organization_project_goal_checks")).toBe(1);
    engine.stopBackground();
    await engine.close();
    expect(() =>
      store.listOccurrencesByTrigger({ jobId: "unused", triggerKey: "unused" }),
    ).not.toThrow();
  });
});
